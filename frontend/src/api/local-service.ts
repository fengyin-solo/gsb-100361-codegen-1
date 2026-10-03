import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  FARMS,
  currentShiftId,
  farmName,
  recordCode,
  recordKey,
  resolveFarm,
  resolveShift,
  shiftId,
} from '@/data/domain'
import {
  appendStatusEvent,
  completeTodo,
  getEvents,
  getOverrides,
  getShifts,
  getTodos,
  sealShift,
  setFarmOverride,
} from '@/data/system-store'
import type {
  ActionResult,
  BackfillRow,
  EntryRow,
  MetricTriad,
  ModuleMeta,
  PageResult,
  SituationResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

function zero(): MetricTriad {
  return { total: 0, pending: 0, abnormal: 0 }
}

function bump(triad: MetricTriad, row: EntryRow): void {
  triad.total += 1
  if (row.pending) triad.pending += 1
  if (row.abnormal) triad.abnormal += 1
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  // 状态流转记入变化事件流，态势页「最近变化最多三处」按此排名。
  appendStatusEvent(key, updated, action, target)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

type FarmMatrix = Record<string, Record<string, MetricTriad>>

function newFarmMatrix(): FarmMatrix {
  return Object.fromEntries(FARMS.map((farm) => [farm.key, {}]))
}

function addMatrix(matrix: FarmMatrix, farm: string, module: string, triad: MetricTriad): void {
  const cell = matrix[farm]?.[module] ?? zero()
  cell.total += triad.total
  cell.pending += triad.pending
  cell.abnormal += triad.abnormal
  matrix[farm][module] = cell
}

function daysAgo(base: string, offset: number): string {
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() - offset)
  return d.toISOString().slice(0, 10)
}

/**
 * 林火态势总览：
 * 已封存班次沿用封存快照，未封存班次按当前记录实时重算，两部分相加得到「林场×模块」矩阵。
 */
export function loadSituation(): SituationResult {
  const overrides = getOverrides()
  const sealedIds = new Set(getShifts().filter((shift) => shift.sealed).map((shift) => shift.id))

  const matrix = newFarmMatrix()
  const liveByShift = new Map<string, MetricTriad>()
  const backfillRows: BackfillRow[] = []
  const provenanceCount = { field: 0, rule: 0, manual: 0 }

  // 未封存班次：实时重算（含当前班次）。
  for (const meta of MODULES) {
    for (const row of allRows()[meta.key] ?? []) {
      const attribution = resolveFarm(meta.key, row, overrides)
      if (attribution.provenance === 'manual') {
        provenanceCount.manual += 1
      } else if (attribution.provenance === 'field') {
        provenanceCount.field += 1
      } else {
        provenanceCount.rule += 1
        backfillRows.push({
          key: meta.key,
          name: meta.name,
          id: Number(row.id),
          code: recordCode(meta.key, row),
          farm: attribution.farm,
          provenance: 'rule-hash',
          hintField: attribution.hintField,
          hintValue: attribution.hintValue,
        })
      }

      const { date, session } = resolveShift(meta.key, row)
      const sid = shiftId(date, session)
      const shiftLive = liveByShift.get(sid) ?? zero()
      bump(shiftLive, row)
      liveByShift.set(sid, shiftLive)

      if (!sealedIds.has(sid)) {
        const triad = zero()
        bump(triad, row)
        addMatrix(matrix, attribution.farm, meta.key, triad)
      }
    }
  }

  // 已封存班次：只取封存时的快照，后续记录怎么变都不触发重算。
  for (const shift of getShifts()) {
    if (!shift.sealed || !shift.snapshot) {
      continue
    }
    for (const farm of FARMS) {
      const snap = shift.snapshot.byFarm[farm.key]
      if (!snap) continue
      for (const [module, triad] of Object.entries(snap.modules)) {
        addMatrix(matrix, farm.key, module, triad)
      }
    }
  }

  const moduleRows = MODULES.map((meta) => {
    const byFarm: Record<string, MetricTriad> = {}
    const total = zero()
    for (const farm of FARMS) {
      const triad = matrix[farm.key][meta.key] ?? zero()
      byFarm[farm.key] = triad
      total.total += triad.total
      total.pending += triad.pending
      total.abnormal += triad.abnormal
    }
    return { key: meta.key, name: meta.name, byFarm, total }
  })

  const farmTotals: Record<string, MetricTriad> = {}
  const grand = zero()
  for (const farm of FARMS) {
    const sum = zero()
    for (const meta of MODULES) {
      const triad = matrix[farm.key][meta.key] ?? zero()
      sum.total += triad.total
      sum.pending += triad.pending
      sum.abnormal += triad.abnormal
    }
    farmTotals[farm.key] = sum
    grand.total += sum.total
    grand.pending += sum.pending
    grand.abnormal += sum.abnormal
  }

  // 最近变化最多三处：近 7 天按林场汇总变化事件。
  const since = daysAgo('2026-10-03', 6)
  const changeMap = new Map<
    string,
    { count: number; latestAt: string; modules: Map<string, string> }
  >()
  for (const event of getEvents()) {
    if (!event.farm || event.date < since) continue
    const entry =
      changeMap.get(event.farm) ?? { count: 0, latestAt: '', modules: new Map() }
    entry.count += 1
    if (event.at > entry.latestAt) entry.latestAt = event.at
    if (event.module) entry.modules.set(event.module, event.moduleName)
    changeMap.set(event.farm, entry)
  }
  const changes = [...changeMap.entries()]
    .map(([farm, entry]) => ({
      farm,
      farmName: farmName(farm),
      count: entry.count,
      latestAt: entry.latestAt,
      modules: [...entry.modules.values()],
    }))
    .sort((a, b) => b.count - a.count || b.latestAt.localeCompare(a.latestAt))
    .slice(0, 3)

  const sessionOrder = (session: string) => (session === '夜班' ? 1 : 0)
  const shifts = getShifts()
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || sessionOrder(b.session) - sessionOrder(a.session))
    .map((shift) => {
      const live = liveByShift.get(shift.id) ?? zero()
      const snap = shift.snapshot?.totals
      const drift = Boolean(
        snap && (snap.total !== live.total || snap.pending !== live.pending || snap.abnormal !== live.abnormal),
      )
      return { ...shift, live, drift }
    })

  const todos = getTodos().slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === '待处理' ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  })

  const pendingTodos = todos.filter((todo) => todo.status === '待处理').length
  const cards = [
    { label: '林场数量', value: FARMS.length },
    { label: '登记总量', value: grand.total },
    { label: '待处理', value: grand.pending },
    { label: '异常量', value: grand.abnormal },
    { label: '已封存班次', value: getShifts().filter((shift) => shift.sealed).length },
    { label: '封存待办', value: pendingTodos },
  ]

  return {
    cards,
    farms: FARMS.map((farm) => ({ key: farm.key, name: farm.name })),
    moduleRows,
    farmTotals,
    grand,
    changes,
    todos,
    shifts,
    currentShiftId: currentShiftId(),
    sealedCount: getShifts().filter((shift) => shift.sealed).length,
    unsealedCount: getShifts().filter((shift) => !shift.sealed).length,
    backfill: { ...provenanceCount, rows: backfillRows },
  }
}

/** 封存班次：两个终端对同一班次的提交只落一份版本（见 system-store 的幂等逻辑）。 */
export function sealShiftAction(shiftIdValue: string, terminal: string, operator: string): ActionResult {
  return sealShift(shiftIdValue, terminal, operator)
}

export function completeTodoAction(id: number): void {
  completeTodo(id)
}

/** 手工回填林场归属：仅写覆盖表，不动原始记录。 */
export function setBackfillFarm(moduleKey: string, rowId: number, farm: string): void {
  setFarmOverride(moduleKey, rowId, farm)
}

export function backfillKey(moduleKey: string, rowId: number): string {
  return recordKey(moduleKey, { id: rowId } as EntryRow)
}

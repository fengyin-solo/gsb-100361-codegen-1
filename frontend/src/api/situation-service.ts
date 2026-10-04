import { MODULES, MODULE_BY_KEY } from '@/data/modules'
import { allRows } from '@/data/local-store'
import { extractShiftDate, locationOf, resolveFarm } from '@/data/situation-config'
import { situationState, updateSituation } from '@/data/situation-store'
import type {
  ChangeEvent,
  ChangeSpot,
  EntryRow,
  Farm,
  FarmOverview,
  ShiftRecord,
  ShiftSnapshot,
  SituationResult,
  SituationTodo,
} from '@/data/types'
import { FARMS, UNASSIGNED_FARM } from '@/data/types'

// 林火态势总览汇总服务。
// 口径：已封存班次沿用封存时刻的快照；未封存班次（以及没有班次日期的日常台账）每次实时重算。
// 归属与封存都落在派生层，业务原始记录只读不改。

type Bucket = Record<string, Record<string, { total: number; pending: number; abnormal: number }>>

function emptyFarmBucket(): Bucket {
  const bucket: Bucket = {}
  for (const farm of FARMS) {
    bucket[farm] = {}
  }
  return bucket
}

function addCount(bucket: Bucket, farm: Farm, moduleKey: string, row: EntryRow): void {
  const byModule = bucket[farm] ?? (bucket[farm] = {})
  const stat = byModule[moduleKey] ?? (byModule[moduleKey] = { total: 0, pending: 0, abnormal: 0 })
  stat.total += 1
  if (row.pending) stat.pending += 1
  if (row.abnormal) stat.abnormal += 1
}

function mergeSnapshot(bucket: Bucket, snapshot: ShiftSnapshot): void {
  for (const [farm, byModule] of Object.entries(snapshot)) {
    for (const [moduleKey, count] of Object.entries(byModule)) {
      const target = (bucket[farm] ?? (bucket[farm] = {}))[moduleKey] ?? { total: 0, pending: 0, abnormal: 0 }
      target.total += count.total
      target.pending += count.pending
      target.abnormal += count.abnormal
      bucket[farm][moduleKey] = target
    }
  }
}

export type ResolvedRow = {
  moduleKey: string
  moduleName: string
  row: EntryRow
  farm: Farm
  source: 'override' | 'field' | 'rule' | 'none'
  shiftDate: string | null
  sealed: boolean
}

function rowKey(moduleKey: string, id: number): string {
  return `${moduleKey}:${id}`
}

// 把每条业务记录解析成「林场 + 班次 + 是否封存」，汇总和回填管理共用这一份口径。
function resolveAllRows(): ResolvedRow[] {
  const state = situationState()
  const rows = allRows()
  const resolved: ResolvedRow[] = []
  for (const meta of MODULES) {
    for (const row of rows[meta.key] ?? []) {
      const override = state.farmOverrides[rowKey(meta.key, Number(row.id))]
      const { farm, source } = resolveFarm(meta.key, row, override ? { farm: override, source: 'override' } : undefined)
      const shiftDate = extractShiftDate(row, meta.key)
      resolved.push({
        moduleKey: meta.key,
        moduleName: meta.name,
        row,
        farm,
        source,
        shiftDate,
        sealed: Boolean(shiftDate && state.sealed[shiftDate]),
      })
    }
  }
  return resolved
}

function buildFarmOverviews(bucket: Bucket, resolved: ResolvedRow[]): FarmOverview[] {
  // 「推断」标记：该林场的实时口径里是否含有关键词推断归属的记录，提示值班员核对。
  const inferredFarms = new Set<Farm>()
  for (const item of resolved) {
    if (!item.sealed && item.source === 'rule') {
      inferredFarms.add(item.farm)
    }
  }
  return FARMS.map((farm) => {
    const byModule = bucket[farm] ?? {}
    const modules = MODULES.map((meta) => {
      const stat = byModule[meta.key] ?? { total: 0, pending: 0, abnormal: 0 }
      return { key: meta.key, name: meta.name, ...stat }
    }).filter((item) => item.total > 0)
    const total = modules.reduce((sum, item) => sum + item.total, 0)
    const pending = modules.reduce((sum, item) => sum + item.pending, 0)
    const abnormal = modules.reduce((sum, item) => sum + item.abnormal, 0)
    return { farm, inferred: inferredFarms.has(farm), modules, total, pending, abnormal }
  })
}

// 最近变化最多的三处：近 7 天变化事件按「林场 + 位置」聚合。
// 基准时间取当前时间与最新事件的较新者，保证新登记的变化能立刻进入榜单。
function topChangeSpots(events: ChangeEvent[], limit = 3): ChangeSpot[] {
  if (events.length === 0) return []
  const latest = events.reduce((max, item) => (item.at > max ? item.at : max), events[0].at)
  const reference = Math.max(Date.now(), new Date(latest).getTime())
  const cutoff = new Date(reference - 7 * 24 * 60 * 60 * 1000).getTime()
  const groups = new Map<string, ChangeSpot>()
  for (const event of events) {
    if (new Date(event.at).getTime() < cutoff) continue
    const key = `${event.farm}|${event.location}`
    const current =
      groups.get(key) ?? {
        farm: event.farm,
        moduleName: event.moduleName,
        location: event.location,
        count: 0,
        pending: 0,
        abnormal: 0,
        lastAt: event.at,
      }
    current.count += 1
    if (event.pending) current.pending += 1
    if (event.abnormal) current.abnormal += 1
    if (event.at > current.lastAt) {
      current.lastAt = event.at
      current.moduleName = event.moduleName
    }
    groups.set(key, current)
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
    .slice(0, limit)
}

function buildShifts(resolved: ResolvedRow[]): ShiftRecord[] {
  const state = situationState()
  const dateRows = new Map<string, number>()
  for (const item of resolved) {
    if (!item.shiftDate) continue
    dateRows.set(item.shiftDate, (dateRows.get(item.shiftDate) ?? 0) + 1)
  }
  const shiftIds = new Set<string>([...dateRows.keys(), ...Object.keys(state.sealed)])
  const shifts: ShiftRecord[] = []
  for (const id of shiftIds) {
    const sealed = state.sealed[id]
    const frozenCount = sealed
      ? Object.values(sealed.snapshot).reduce(
          (sum, byModule) => sum + Object.values(byModule).reduce((n, stat) => n + stat.total, 0),
          0,
        )
      : 0
    shifts.push({
      id,
      label: `班次 ${id}（白班 08:00-20:00）`,
      sealed: Boolean(sealed),
      sealedAt: sealed?.sealedAt ?? null,
      version: sealed?.version ?? 0,
      terminals: sealed?.terminals ?? [],
      recordCount: sealed ? frozenCount : dateRows.get(id) ?? 0,
    })
  }
  return shifts.sort((a, b) => b.id.localeCompare(a.id))
}

export function loadSituation(): SituationResult {
  const state = situationState()
  const resolved = resolveAllRows()
  const sealedDates = new Set(Object.keys(state.sealed))

  // 实时口径：未封存班次 + 无班次日期的日常台账。
  const bucket = emptyFarmBucket()
  for (const item of resolved) {
    if (item.shiftDate && sealedDates.has(item.shiftDate)) continue
    addCount(bucket, item.farm, item.moduleKey, item.row)
  }
  // 封存口径：逐班次叠加原快照，不重新统计快照内的记录。
  for (const sealed of Object.values(state.sealed)) {
    mergeSnapshot(bucket, sealed.snapshot)
  }

  const farms = buildFarmOverviews(bucket, resolved)
  const known = farms.filter((item) => item.farm !== UNASSIGNED_FARM)
  const cards = [
    { label: '在管林场', value: known.filter((item) => item.total > 0).length },
    { label: '登记总量', value: known.reduce((sum, item) => sum + item.total, 0) },
    { label: '待处理', value: known.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: known.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '已封存班次', value: Object.keys(state.sealed).length },
    { label: '未封存班次', value: new Set(resolved.filter((r) => r.shiftDate && !r.sealed).map((r) => r.shiftDate)).size },
    { label: '归属待回填', value: farms.find((item) => item.farm === UNASSIGNED_FARM)?.total ?? 0 },
  ]

  return {
    generatedAt: new Date().toISOString(),
    sealedShiftCount: Object.keys(state.sealed).length,
    openShiftCount: cards[5].value,
    cards,
    farms,
    topSpots: topChangeSpots(state.events),
    shifts: buildShifts(resolved),
    todos: [...state.todos].sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt)),
  }
}

export type SealResult = { ok: boolean; message: string; duplicated?: boolean }

// 封存班次：落一份版本（恒为 v1）+ 快照，并生成巡护任务复核与火情报告待办。
// 同一班次第二个终端再提交，只登记终端名，沿用同一版本，不重生快照、不重发待办。
export function sealShift(shiftId: string, terminal: string): SealResult {
  const state = situationState()
  const existing = state.sealed[shiftId]
  if (existing) {
    if (existing.terminals.includes(terminal)) {
      return { ok: false, duplicated: true, message: `班次 ${shiftId} 已由「${terminal}」提交封存，沿用版本 v${existing.version}，无需重复提交` }
    }
    updateSituation((draft) => {
      draft.sealed[shiftId].terminals.push(terminal)
    })
    return {
      ok: true,
      duplicated: true,
      message: `班次 ${shiftId} 已封存（v${existing.version}），已补登终端「${terminal}」；仍是同一份版本，快照与待办不重复生成`,
    }
  }

  const resolved = resolveAllRows()
  const inShift = resolved.filter((item) => item.shiftDate === shiftId)
  const snapshot: ShiftSnapshot = {}
  for (const item of inShift) {
    const byModule = snapshot[item.farm] ?? (snapshot[item.farm] = {})
    const stat = byModule[item.moduleKey] ?? (byModule[item.moduleKey] = { total: 0, pending: 0, abnormal: 0 })
    stat.total += 1
    if (item.row.pending) stat.pending += 1
    if (item.row.abnormal) stat.abnormal += 1
  }

  const sealedAt = new Date().toISOString()
  const todos: SituationTodo[] = []
  // 封存同时生成两类待办：巡护任务逐条复核、火情报告逐条跟进。
  for (const item of inShift) {
    if (item.moduleKey !== 'patrol' && item.moduleKey !== 'firereport') continue
    const meta = MODULE_BY_KEY.get(item.moduleKey)
    const refField = meta?.fields[0] ?? 'id'
    const refCode = String(item.row[refField] ?? item.row.id)
    todos.push({
      id: `seal-${shiftId}-${item.moduleKey}-${refCode}`,
      kind: item.moduleKey === 'patrol' ? '巡护任务复核' : '火情报告待办',
      shiftId,
      title:
        item.moduleKey === 'patrol'
          ? `复核封存班次内的巡护任务 ${refCode}`
          : `跟进封存班次内的火情报告 ${refCode}`,
      refCode,
      farm: item.farm,
      createdAt: sealedAt,
      done: false,
    })
  }

  updateSituation((draft) => {
    draft.sealed[shiftId] = { shiftId, sealedAt, version: 1, terminals: [terminal], snapshot }
    const knownIds = new Set(draft.todos.map((todo) => todo.id))
    for (const todo of todos) {
      if (!knownIds.has(todo.id)) draft.todos.push(todo)
    }
  })
  return {
    ok: true,
    message: `班次 ${shiftId} 已封存为 v1，沿用该口径生成快照；同时生成 ${todos.filter((t) => t.kind === '巡护任务复核').length} 条巡护复核、${todos.filter((t) => t.kind === '火情报告待办').length} 条火情待办`,
  }
}

// 状态流转时追加一条变化事件，供「变化最多的三处」统计。
export function recordChange(
  moduleKey: string,
  row: EntryRow,
  action: string,
): void {
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (!meta) return
  const state = situationState()
  const override = state.farmOverrides[rowKey(moduleKey, Number(row.id))]
  const { farm } = resolveFarm(moduleKey, row, override ? { farm: override, source: 'override' } : undefined)
  const refCode = String(row[meta.fields[0]] ?? row.id)
  updateSituation((draft) => {
    draft.eventSeq += 1
    draft.events.push({
      id: draft.eventSeq,
      at: new Date().toISOString(),
      moduleKey,
      moduleName: meta.name,
      refCode,
      farm,
      location: locationOf(moduleKey, row),
      action,
      pending: row.pending,
      abnormal: row.abnormal,
    })
    // 事件只留最近 500 条，避免本机长期使用后 localStorage 膨胀。
    if (draft.events.length > 500) {
      draft.events = draft.events.slice(draft.events.length - 500)
    }
  })
}

// ---- 归属回填管理（只写派生层，不改原始记录）----

export function listResolvedRows(moduleFilter = ''): ResolvedRow[] {
  const rows = resolveAllRows()
  const filtered = moduleFilter ? rows.filter((item) => item.moduleKey === moduleFilter) : rows
  return filtered.sort((a, b) => {
    const rank = (s: ResolvedRow['source']) => (s === 'none' ? 0 : s === 'rule' ? 1 : 2)
    const diff = rank(a.source) - rank(b.source)
    return diff !== 0 ? diff : a.moduleKey.localeCompare(b.moduleKey) || Number(a.row.id) - Number(b.row.id)
  })
}

export function setFarmOverride(moduleKey: string, id: number, farm: Farm): void {
  updateSituation((draft) => {
    draft.farmOverrides[rowKey(moduleKey, id)] = farm
  })
}

export function clearFarmOverride(moduleKey: string, id: number): void {
  updateSituation((draft) => {
    delete draft.farmOverrides[rowKey(moduleKey, id)]
  })
}

export function completeTodo(id: string): void {
  updateSituation((draft) => {
    const todo = draft.todos.find((item) => item.id === id)
    if (todo) todo.done = true
  })
}

import { allRows } from './local-store'
import {
  FARMS,
  farmName,
  nowAt,
  recordCode,
  resolveFarm,
  resolveShift,
  shiftId,
  TODAY,
} from './domain'
import { MODULE_BY_KEY, MODULES } from './modules'
import type {
  ChangeEvent,
  EntryRow,
  MetricTriad,
  ShiftRecord,
  ShiftSnapshot,
  SituationTodo,
  TodoKind,
} from './types'

// 系统台账独立于业务记录存放：班次快照、封存待办、变化事件、归属覆盖各一份。
// 覆盖关系只存这里，原始 EntryRow 永远不被改写。
const SYSTEM_KEY = 'forest-fire-patrol:system'

type SystemState = {
  shifts: ShiftRecord[]
  todos: SituationTodo[]
  events: ChangeEvent[]
  overrides: Record<string, string>
  todoSeq: number
  eventSeq: number
}

function zero(): MetricTriad {
  return { total: 0, pending: 0, abnormal: 0 }
}

function add(acc: MetricTriad, row: EntryRow): void {
  acc.total += 1
  if (row.pending) acc.pending += 1
  if (row.abnormal) acc.abnormal += 1
}

/** 把一个班次桶里的全部记录固化为「林场×模块」快照；封存后统计只认这份快照。 */
function buildSnapshot(
  bucket: { module: string; row: EntryRow }[],
  overrides: Record<string, string>,
  sealedAt: string,
  sealedBy: string,
  terminals: string[],
): ShiftSnapshot {
  const byFarm: ShiftSnapshot['byFarm'] = {}
  for (const farm of FARMS) {
    byFarm[farm.key] = { totals: zero(), modules: {} }
  }
  for (const { module, row } of bucket) {
    const { farm } = resolveFarm(module, row, overrides)
    const cell = byFarm[farm]
    add(cell.totals, row)
    const triad = cell.modules[module] ?? zero()
    add(triad, row)
    cell.modules[module] = triad
  }
  const totals = zero()
  for (const farm of FARMS) {
    totals.total += byFarm[farm.key].totals.total
    totals.pending += byFarm[farm.key].totals.pending
    totals.abnormal += byFarm[farm.key].totals.abnormal
  }
  return { version: 1, sealedAt, sealedBy, terminals, totals, byFarm }
}

/** 按班次给全部业务记录分桶（只用于封存出快照，不写回记录）。 */
function shiftBuckets(overrides: Record<string, string>): Map<string, { module: string; row: EntryRow }[]> {
  const buckets = new Map<string, { module: string; row: EntryRow }[]>()
  for (const meta of MODULES) {
    for (const row of allRows()[meta.key] ?? []) {
      const { date, session } = resolveShift(meta.key, row)
      const id = shiftId(date, session)
      const bucket = buckets.get(id) ?? []
      bucket.push({ module: meta.key, row })
      buckets.set(id, bucket)
    }
  }
  return buckets
}

function todoText(kind: TodoKind, date: string, sessionText: string, bucket: { module: string; row: EntryRow }[]): string {
  if (kind === 'patrol-review') {
    const rows = bucket.filter((item) => item.module === 'patrol')
    const pending = rows.filter((item) => item.row.pending).length
    if (rows.length === 0) {
      return `复核 ${date} ${sessionText} 巡护任务：本班无巡护登记，抽查交接班记录与到岗情况`
    }
    return `复核 ${date} ${sessionText} 巡护任务（共 ${rows.length} 条，待处理 ${pending} 条），核对巡护轨迹与火情发现登记`
  }
  const rows = bucket.filter((item) => item.module === 'firereport')
  const pending = rows.filter((item) => item.row.pending).length
  if (rows.length === 0) {
    return `核实 ${date} ${sessionText} 火情报告：本班无火情上报，确认瞭望与监测点无漏报`
  }
  return `核实 ${date} ${sessionText} 火情报告（共 ${rows.length} 条，待核实 ${pending} 条），确认火势等级与出警扑救情况`
}

// 固定种子的伪随机，保证每次播种的「最近变化」演示数据一致。
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedSystem(): SystemState {
  const overrides: Record<string, string> = {}
  const buckets = shiftBuckets(overrides)
  const shifts: ShiftRecord[] = []
  const todos: SituationTodo[] = []
  const events: ChangeEvent[] = []
  let todoSeq = 0
  let eventSeq = 0

  const historicalDates = ['2026-09-01', '2026-09-02', '2026-09-03']
  const sealedSet = new Set(['2026-09-01-day', '2026-09-01-night', '2026-09-02-day', '2026-09-02-night'])

  const pushTodos = (id: string, date: string, sessionText: string, bucket: { module: string; row: EntryRow }[], oldest: boolean) => {
    const kinds: TodoKind[] = ['patrol-review', 'fire-report']
    kinds.forEach((kind, index) => {
      todoSeq += 1
      const done = oldest
      todos.push({
        id: todoSeq,
        shiftId: id,
        date,
        session: sessionText,
        kind,
        title: kind === 'patrol-review' ? '巡护任务复核事项' : '火情报告待办',
        detail: todoText(kind, date, sessionText, bucket),
        status: done ? '已完成' : '待处理',
        createdAt: nowAt(date, index === 0 ? 20 : 21, 5),
        doneAt: done ? nowAt(date, 22, 30) : null,
        dedupeKey: `${id}:${kind}`,
      })
    })
  }

  historicalDates.forEach((date, dayIndex) => {
    (['day', 'night'] as const).forEach((session) => {
      const id = shiftId(date, session)
      const sessionText = session === 'day' ? '白班' : '夜班'
      const bucket = buckets.get(id) ?? []
      const sealed = sealedSet.has(id)
      const snapshot = sealed
        ? buildSnapshot(
            bucket,
            overrides,
            nowAt(date, session === 'day' ? 20 : 8, session === 'day' ? 5 : 10),
            '值班管理员',
            ['值班室终端', '移动巡护终端'],
          )
        : null
      shifts.push({
        id,
        date,
        session: sessionText,
        sealed,
        version: sealed ? 1 : null,
        sealedAt: snapshot?.sealedAt ?? null,
        sealedBy: snapshot?.sealedBy ?? null,
        terminals: sealed ? ['值班室终端', '移动巡护终端'] : [],
        snapshot,
      })
      if (sealed) {
        pushTodos(id, date, sessionText, bucket, dayIndex === 0 && session === 'day')
      }
    })
  })
  // 当前班次：未封存，等待终端提交。
  shifts.push({
    id: shiftId(TODAY, 'day'),
    date: TODAY,
    session: '白班',
    sealed: false,
    version: null,
    sealedAt: null,
    sealedBy: null,
    terminals: [],
    snapshot: null,
  })

  // 最近 7 天变化事件：让「变化最多三处」排名有真实数据。
  const rng = mulberry32(20261003)
  const windowDates = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']
  const perDay = [3, 4, 5, 4, 6, 5, 7]
  const phrases: Record<string, string[]> = {
    status: ['状态流转', '执行处置动作', '更新预警等级'],
    register: ['新增登记', '补录历史记录'],
    backfill: ['回填林场归属', '修正林场归属'],
  }
  windowDates.forEach((date, dayIndex) => {
    for (let i = 0; i < perDay[dayIndex]; i += 1) {
      eventSeq += 1
      const meta = MODULES[Math.floor(rng() * MODULES.length)]
      const farm = FARMS[Math.floor(rng() * FARMS.length)].key
      const roll = rng()
      const kind = roll < 0.72 ? 'status' : roll < 0.9 ? 'register' : 'backfill'
      const phrase = phrases[kind][Math.floor(rng() * phrases[kind].length)]
      events.push({
        id: eventSeq,
        at: nowAt(date, 8 + Math.floor(rng() * 12), Math.floor(rng() * 60)),
        date,
        farm,
        module: meta.key,
        moduleName: meta.name,
        kind,
        text: `${meta.entity}${phrase}`,
      })
    }
  })

  return { shifts, todos, events, overrides, todoSeq, eventSeq }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: SystemState | null = null

function readSystem(): SystemState {
  if (cache) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = seedSystem()
    return cache
  }
  const raw = window.localStorage.getItem(SYSTEM_KEY)
  if (!raw) {
    cache = seedSystem()
    window.localStorage.setItem(SYSTEM_KEY, JSON.stringify(cache))
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as SystemState
    cache = {
      shifts: parsed.shifts ?? [],
      todos: parsed.todos ?? [],
      events: parsed.events ?? [],
      overrides: parsed.overrides ?? {},
      todoSeq: parsed.todoSeq ?? 0,
      eventSeq: parsed.eventSeq ?? 0,
    }
    return cache
  } catch {
    cache = seedSystem()
    window.localStorage.setItem(SYSTEM_KEY, JSON.stringify(cache))
    return cache
  }
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage && cache) {
    window.localStorage.setItem(SYSTEM_KEY, JSON.stringify(cache))
  }
}

export function getShifts(): ShiftRecord[] {
  return readSystem().shifts
}

export function getShift(id: string): ShiftRecord | undefined {
  return readSystem().shifts.find((shift) => shift.id === id)
}

export function getTodos(): SituationTodo[] {
  return readSystem().todos
}

export function getEvents(): ChangeEvent[] {
  return readSystem().events
}

export function getOverrides(): Record<string, string> {
  return readSystem().overrides
}

export type SealOutcome = {
  ok: boolean
  message: string
  duplicated: boolean
}

/**
 * 封存班次（幂等）：
 * - 首次提交：固化快照（版本 v1），同时生成巡护任务复核事项与火情报告待办
 * - 同一班次两个终端重复提交：沿用原版本，不重出快照、不重复生成待办，只登记终端
 */
export function sealShift(id: string, terminal: string, sealedBy: string): SealOutcome {
  const state = readSystem()
  const shift = state.shifts.find((item) => item.id === id)
  if (!shift) {
    return { ok: false, message: `班次 ${id} 不在台账中`, duplicated: false }
  }
  if (shift.sealed) {
    if (!shift.terminals.includes(terminal)) {
      shift.terminals.push(terminal)
    }
    persist()
    return {
      ok: true,
      duplicated: true,
      message: `班次 ${shift.date} ${shift.session} 已封存（版本 v${shift.version ?? 1}），${terminal} 的重复提交未另出版本，待办沿用原事项`,
    }
  }

  const bucket: { module: string; row: EntryRow }[] = []
  for (const meta of MODULES) {
    for (const row of allRows()[meta.key] ?? []) {
      const { date, session } = resolveShift(meta.key, row)
      if (shiftId(date, session) === id) {
        bucket.push({ module: meta.key, row })
      }
    }
  }
  const sealedAt = `${TODAY} ${new Date().toTimeString().slice(0, 5)}`
  shift.sealed = true
  shift.version = 1
  shift.sealedAt = sealedAt
  shift.sealedBy = sealedBy
  shift.terminals = [terminal]
  shift.snapshot = buildSnapshot(bucket, state.overrides, sealedAt, sealedBy, [terminal])

  const kinds: TodoKind[] = ['patrol-review', 'fire-report']
  for (const kind of kinds) {
    const dedupeKey = `${id}:${kind}`
    if (state.todos.some((todo) => todo.dedupeKey === dedupeKey)) {
      continue
    }
    state.todoSeq += 1
    state.todos.unshift({
      id: state.todoSeq,
      shiftId: id,
      date: shift.date,
      session: shift.session,
      kind,
      title: kind === 'patrol-review' ? '巡护任务复核事项' : '火情报告待办',
      detail: todoText(kind, shift.date, shift.session, bucket),
      status: '待处理',
      createdAt: sealedAt,
      doneAt: null,
      dedupeKey,
    })
  }

  state.eventSeq += 1
  state.events.push({
    id: state.eventSeq,
    at: sealedAt,
    date: shift.date,
    farm: '',
    module: '',
    moduleName: '班次封存',
    kind: 'seal',
    text: `${shift.date} ${shift.session}封存，生成快照版本 v1`,
  })

  persist()
  return {
    ok: true,
    duplicated: false,
    message: `班次 ${shift.date} ${shift.session} 已封存为版本 v1，并生成巡护任务复核事项、火情报告待办各 1 条`,
  }
}

export function completeTodo(id: number): void {
  const state = readSystem()
  const todo = state.todos.find((item) => item.id === id)
  if (todo && todo.status !== '已完成') {
    todo.status = '已完成'
    todo.doneAt = `${TODAY} ${new Date().toTimeString().slice(0, 5)}`
    persist()
  }
}

/** 手工指定归属：只写覆盖表，原始记录保持不动。 */
export function setFarmOverride(moduleKey: string, rowId: number, farm: string): void {
  const state = readSystem()
  state.overrides[`${moduleKey}#${rowId}`] = farm
  state.eventSeq += 1
  const meta = MODULE_BY_KEY.get(moduleKey)
  state.events.push({
    id: state.eventSeq,
    at: `${TODAY} ${new Date().toTimeString().slice(0, 5)}`,
    date: TODAY,
    farm,
    module: moduleKey,
    moduleName: meta?.name ?? moduleKey,
    kind: 'backfill',
    text: `${meta?.entity ?? moduleKey}林场归属手工指定为「${farmName(farm)}」`,
  })
  persist()
}

export function appendStatusEvent(moduleKey: string, row: EntryRow, action: string, target: string): void {
  const state = readSystem()
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (!meta) {
    return
  }
  const { farm } = resolveFarm(moduleKey, row, state.overrides)
  state.eventSeq += 1
  state.events.push({
    id: state.eventSeq,
    at: `${TODAY} ${new Date().toTimeString().slice(0, 5)}`,
    date: TODAY,
    farm,
    module: moduleKey,
    moduleName: meta.name,
    kind: 'status',
    text: `${meta.entity} ${recordCode(moduleKey, row)} 执行「${action}」→ ${target}`,
  })
  persist()
}

export function resetSystem(): void {
  cache = null
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(SYSTEM_KEY)
  }
  readSystem()
}

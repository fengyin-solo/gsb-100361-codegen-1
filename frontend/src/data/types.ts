/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 登记总量 / 待处理 / 异常量 三元组，态势矩阵的最小统计单元。 */
export type MetricTriad = {
  total: number
  pending: number
  abnormal: number
}

/** 班次封存时固化的快照：口径调整后，已封存班次一律沿用这份数据，不再随记录状态重算。 */
export type ShiftSnapshot = {
  version: number
  sealedAt: string
  sealedBy: string
  terminals: string[]
  totals: MetricTriad
  /** 按林场拆分的快照：林场 -> 模块 -> 三元组，支撑按林场并排的态势矩阵。 */
  byFarm: Record<
    string,
    { totals: MetricTriad; modules: Record<string, MetricTriad> }
  >
}

export type ShiftRecord = {
  id: string
  date: string
  session: string
  sealed: boolean
  version: number | null
  sealedAt: string | null
  sealedBy: string | null
  terminals: string[]
  snapshot: ShiftSnapshot | null
}

export type TodoKind = 'patrol-review' | 'fire-report'

export type SituationTodo = {
  id: number
  shiftId: string
  date: string
  session: string
  kind: TodoKind
  title: string
  detail: string
  status: '待处理' | '已完成'
  createdAt: string
  doneAt: string | null
  dedupeKey: string
}

export type ChangeEventKind = 'status' | 'register' | 'seal' | 'backfill'

export type ChangeEvent = {
  id: number
  at: string
  date: string
  /** 林场 key；班次级事件（如封存）为空串，不参与按林场的变化排名。 */
  farm: string
  module: string
  moduleName: string
  kind: ChangeEventKind
  text: string
}

export type Provenance = 'manual' | 'field' | 'rule-hash'

export type BackfillRow = {
  key: string
  name: string
  id: number
  code: string
  farm: string
  provenance: Provenance
  hintField: string
  hintValue: string
}

export type SituationResult = {
  cards: { label: string; value: number }[]
  farms: { key: string; name: string }[]
  moduleRows: {
    key: string
    name: string
    byFarm: Record<string, MetricTriad>
    total: MetricTriad
  }[]
  farmTotals: Record<string, MetricTriad>
  grand: MetricTriad
  changes: {
    farm: string
    farmName: string
    count: number
    latestAt: string
    modules: string[]
  }[]
  todos: SituationTodo[]
  shifts: (ShiftRecord & { live: MetricTriad; drift: boolean })[]
  currentShiftId: string
  sealedCount: number
  unsealedCount: number
  backfill: { field: number; rule: number; manual: number; rows: BackfillRow[] }
}

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

// ---- 林火态势总览 ----

// 林火口径下的林场清单；UNASSIGNED 表示历史数据无法判定归属、等待回填。
export const FARMS = ['青石林场', '苍石林场', '云岭林场', '未归属'] as const
export type Farm = (typeof FARMS)[number]
export const UNASSIGNED_FARM: Farm = '未归属'

export type FarmModuleStat = {
  key: string
  name: string
  total: number
  pending: number
  abnormal: number
}

export type FarmOverview = {
  farm: Farm
  inferred: boolean // 该林场的数字是否包含规则推断的归属
  modules: FarmModuleStat[]
  total: number
  pending: number
  abnormal: number
}

export type ShiftStatus = '未封存' | '已封存'

export type ShiftRecord = {
  id: string // 班次号，取业务日期 YYYY-MM-DD
  label: string
  sealed: boolean
  sealedAt: string | null
  version: number // 封存版本，同一班次两个终端提交只落一份版本
  terminals: string[] // 提交终端
  recordCount: number // 班内业务记录数（实时口径，封存后不再变）
}

// 封存快照：farm -> moduleKey -> 三个计数。已封存记录沿用这份快照，不再重算。
export type ShiftSnapshot = Record<string, Record<string, { total: number; pending: number; abnormal: number }>>

export type ChangeSpot = {
  farm: Farm
  moduleName: string
  location: string
  count: number
  pending: number
  abnormal: number
  lastAt: string
}

export type SituationTodo = {
  id: string
  kind: '巡护任务复核' | '火情报告待办'
  shiftId: string
  title: string
  refCode: string
  farm: Farm
  createdAt: string
  done: boolean
}

export type ChangeEvent = {
  id: number
  at: string
  moduleKey: string
  moduleName: string
  refCode: string
  farm: Farm
  location: string
  action: string
  pending: boolean
  abnormal: boolean
}

export type SituationResult = {
  generatedAt: string
  sealedShiftCount: number
  openShiftCount: number
  cards: { label: string; value: number }[]
  farms: FarmOverview[]
  topSpots: ChangeSpot[]
  shifts: ShiftRecord[]
  todos: SituationTodo[]
}

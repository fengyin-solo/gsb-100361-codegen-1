import type { ChangeEvent, Farm, ShiftSnapshot, SituationTodo } from './types'

// 林火态势层的本地持久化：封存快照、变化事件、封存待办、归属人工订正都放这里。
// 与业务登记数据（forest-fire-patrol:entries）分开存，回填/封存都不碰原始记录。
const STORAGE_KEY = 'forest-fire-patrol:situation'

export type SituationState = {
  // 已封存班次：shiftId -> 封存结果（快照、版本、终端）。汇总只重算未封存班次。
  sealed: Record<
    string,
    {
      shiftId: string
      sealedAt: string
      version: number
      terminals: string[]
      snapshot: ShiftSnapshot
    }
  >
  events: ChangeEvent[]
  todos: SituationTodo[]
  // 归属人工订正：moduleKey:rowId -> 林场。只存在派生层，不改业务行。
  farmOverrides: Record<string, Farm>
  eventSeq: number
}

// 封存首日班次（2026-09-01）的快照：这是「沿用原快照」的演示基线。
const seedSnapshot: ShiftSnapshot = {
  青石林场: {
    patrol: { total: 1, pending: 1, abnormal: 0 },
    firewatch: { total: 1, pending: 1, abnormal: 0 },
    firereport: { total: 1, pending: 1, abnormal: 0 },
    drone: { total: 1, pending: 1, abnormal: 0 },
  },
  苍石林场: {
    patrol: { total: 1, pending: 1, abnormal: 1 },
    firewatch: { total: 1, pending: 1, abnormal: 1 },
    firereport: { total: 1, pending: 1, abnormal: 1 },
    drone: { total: 1, pending: 1, abnormal: 1 },
  },
  云岭林场: {
    patrol: { total: 1, pending: 0, abnormal: 0 },
    firewatch: { total: 1, pending: 0, abnormal: 0 },
    firereport: { total: 1, pending: 0, abnormal: 0 },
    drone: { total: 1, pending: 0, abnormal: 0 },
  },
}

// 近几天的变化事件：用于「最近变化最多的三处」；含一处明显高发的苍石二号瞭望区。
function seedEvents(): ChangeEvent[] {
  const list: ChangeEvent[] = []
  let id = 0
  const push = (
    at: string,
    moduleKey: string,
    moduleName: string,
    refCode: string,
    farm: Farm,
    location: string,
    action: string,
    pending: boolean,
    abnormal: boolean,
  ) => {
    list.push({ id: (id += 1), at, moduleKey, moduleName, refCode, farm, location, action, pending, abnormal })
  }
  const day = (d: number, h: string) => `2026-10-0${d}T${h}:00+08:00`
  // 苍石林场 · 二号瞭望区：三天连续预警升级，变化最集中
  push(day(1, '08:20'), 'firewatch', '火险监测', 'FIRE-0102', '苍石林场', '苍石二号瞭望区', '升级预警', true, true)
  push(day(1, '11:05'), 'patrol', '巡护任务', 'PATR-0102', '苍石林场', '苍石二号瞭望区', '开始巡护', true, false)
  push(day(2, '07:50'), 'firewatch', '火险监测', 'FIRE-0102', '苍石林场', '苍石二号瞭望区', '更新等级', true, true)
  push(day(2, '15:32'), 'firereport', '火情报告', 'FIRE-0207', '苍石林场', '苍石二号瞭望区北坡', '核实火情', true, true)
  push(day(3, '06:40'), 'drone', '无人机巡查', 'DRON-0102', '苍石林场', '苍石二号瞭望区', '开始飞行', true, false)
  push(day(3, '09:15'), 'firewatch', '火险监测', 'FIRE-0102', '苍石林场', '苍石二号瞭望区', '升级预警', true, true)
  push(day(3, '10:02'), 'firereport', '火情报告', 'FIRE-0207', '苍石林场', '苍石二号瞭望区北坡', '出动扑救', true, true)
  // 青石林场 · 东山村检查站
  push(day(2, '09:12'), 'checkpoint', '防火检查站', 'CHEC-0201', '青石林场', '青石东山村检查站', '升级检查', false, false)
  push(day(3, '08:05'), 'patrol', '巡护任务', 'PATR-0201', '青石林场', '青石东山村一带', '开始巡护', true, false)
  push(day(3, '16:40'), 'checkpoint', '防火检查站', 'CHEC-0201', '青石林场', '青石东山村检查站', '安排换岗', true, false)
  // 云岭林场 · 云顶隔离带
  push(day(1, '14:10'), 'firebreak', '防火隔离带', 'FIRE-0301', '云岭林场', '云顶三号隔离带', '安排维护', true, true)
  push(day(3, '11:25'), 'firebreak', '防火隔离带', 'FIRE-0301', '云岭林场', '云顶三号隔离带', '确认恢复', false, false)
  // 其余零散变化
  push(day(2, '10:48'), 'equipment', '消防装备', 'EQUI-0205', '苍石林场', '苍石物资库', '送检登记', true, true)
  push(day(3, '13:30'), 'burnpermit', '焚烧审批', 'BURN-0302', '云岭林场', '云岭南岭村组', '批准申请', false, false)
  push(day(3, '17:05'), 'weather', '气象观测', 'WEAT-0301', '青石林场', '青石东山气象点', '标记异常', true, true)
  return list
}

function seedState(): SituationState {
  return {
    sealed: {
      '2026-09-01': {
        shiftId: '2026-09-01',
        sealedAt: '2026-09-01T20:05:00+08:00',
        version: 1,
        terminals: ['值班终端A'],
        snapshot: seedSnapshot,
      },
    },
    events: seedEvents(),
    todos: [
      {
        id: 'seal-2026-09-01-patrol-PATR-0001',
        kind: '巡护任务复核',
        shiftId: '2026-09-01',
        title: '复核封存班次内的巡护任务 PATR-0001',
        refCode: 'PATR-0001',
        farm: '青石林场',
        createdAt: '2026-09-01T20:05:00+08:00',
        done: false,
      },
      {
        id: 'seal-2026-09-01-patrol-PATR-0002',
        kind: '巡护任务复核',
        shiftId: '2026-09-01',
        title: '复核封存班次内的巡护任务 PATR-0002',
        refCode: 'PATR-0002',
        farm: '苍石林场',
        createdAt: '2026-09-01T20:05:00+08:00',
        done: false,
      },
      {
        id: 'seal-2026-09-01-patrol-PATR-0003',
        kind: '巡护任务复核',
        shiftId: '2026-09-01',
        title: '复核封存班次内的巡护任务 PATR-0003',
        refCode: 'PATR-0003',
        farm: '云岭林场',
        createdAt: '2026-09-01T20:05:00+08:00',
        done: false,
      },
      {
        id: 'seal-2026-09-01-firereport-FIRE-0001',
        kind: '火情报告待办',
        shiftId: '2026-09-01',
        title: '跟进封存班次内的火情报告 FIRE-0001',
        refCode: 'FIRE-0001',
        farm: '青石林场',
        createdAt: '2026-09-01T20:05:00+08:00',
        done: false,
      },
      {
        id: 'seal-2026-09-01-firereport-FIRE-0002',
        kind: '火情报告待办',
        shiftId: '2026-09-01',
        title: '跟进封存班次内的火情报告 FIRE-0002',
        refCode: 'FIRE-0002',
        farm: '苍石林场',
        createdAt: '2026-09-01T20:05:00+08:00',
        done: false,
      },
      {
        id: 'seal-2026-09-01-firereport-FIRE-0003',
        kind: '火情报告待办',
        shiftId: '2026-09-01',
        title: '跟进封存班次内的火情报告 FIRE-0003',
        refCode: 'FIRE-0003',
        farm: '云岭林场',
        createdAt: '2026-09-01T20:05:00+08:00',
        done: false,
      },
    ],
    farmOverrides: {},
    eventSeq: 15,
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): SituationState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SituationState>
    return {
      sealed: parsed.sealed ?? fallback.sealed,
      events: parsed.events ?? fallback.events,
      todos: parsed.todos ?? fallback.todos,
      farmOverrides: parsed.farmOverrides ?? fallback.farmOverrides,
      eventSeq: typeof parsed.eventSeq === 'number' ? parsed.eventSeq : fallback.eventSeq,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: SituationState | null = null

export function situationState(): SituationState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveSituationState(state: SituationState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function updateSituation(mutate: (state: SituationState) => void): SituationState {
  const next = clone(situationState())
  mutate(next)
  saveSituationState(next)
  return next
}

export function situationStorageKey(): string {
  return STORAGE_KEY
}

import { MODULES } from './modules'
import type { EntryRow } from './types'

/**
 * 林火态势领域规则：林场归属、班次划分、哈希回填都集中在这里。
 * 纯函数、无副作用；系统台账（班次快照、待办、事件、覆盖表）在 system-store 里。
 */

export const FARMS = [
  { key: 'qinglong', name: '青龙林场' },
  { key: 'yunfeng', name: '云峰林场' },
  { key: 'baisha', name: '白沙林场' },
  { key: 'songling', name: '松岭林场' },
] as const

export type FarmKey = (typeof FARMS)[number]['key']

export const FARM_BY_KEY = new Map(FARMS.map((farm) => [farm.key, farm]))

export function farmName(key: string): string {
  return FARM_BY_KEY.get(key as FarmKey)?.name ?? '未归属'
}

/** 各模块记录里携带日期信息的字段（优先顺序），用于把记录归入对应班次。 */
const DATE_FIELDS: Record<string, string[]> = {
  patrol: ['巡护日期', '巡护时段'],
  firewatch: ['监测时间'],
  lookout: [],
  firebreak: ['最近维护日期', '建成日期'],
  fireteam: [],
  equipment: ['最近检修日', '购入日期'],
  weather: ['观测时间'],
  firereport: ['起火时间'],
  drone: ['起飞时间', '降落时间'],
  campaign: ['活动日期'],
  checkpoint: ['值班日期'],
  duty: ['值勤日期', '值勤时段'],
  supply: [],
  forestroad: ['最近巡检日'],
  firebelt: [],
  drill: ['演练日期'],
  burnpermit: ['计划时段'],
  treegrowth: [],
}

/** 各模块记录里能推断林场归属的原生字段；没有原生归属字段的模块只能走规则回填或手工覆盖。 */
const FARM_HINT_FIELDS: Record<string, string[]> = {
  patrol: ['巡护区域'],
  firewatch: ['监测区域'],
  lookout: ['所在山头'],
  firebreak: ['所属林区'],
  fireteam: ['所属林场'],
  equipment: ['保管林场'],
  weather: ['观测站点'],
  firereport: ['起火地点'],
  drone: ['飞行区域'],
  campaign: ['覆盖村组'],
  checkpoint: ['站点位置'],
  duty: ['值勤岗位'],
  supply: ['储备林场'],
  forestroad: ['起点位置', '终点位置'],
  firebelt: ['所属林区', '林带名称'],
  drill: ['参演队伍'],
  burnpermit: ['用火地点'],
  treegrowth: ['样地编号', '林分类型'],
}

/** 演示环境里的业务“今天”，种子数据围绕它构造；真实接后端时改为服务端时间即可。 */
export const TODAY = '2026-10-03'
const DAY_START_HOUR = 8
const NIGHT_START_HOUR = 20

export function sessionLabel(session: 'day' | 'night'): string {
  return session === 'day' ? '白班' : '夜班'
}

export function shiftId(date: string, session: 'day' | 'night'): string {
  return `${date}-${session}`
}

export function currentShiftId(): string {
  return shiftId(TODAY, 'day')
}

/** 录入终端：同一班次两个终端提交，只落一份版本。 */
export const TERMINALS = ['值班室终端', '移动巡护终端']

export function nowAt(date: string, hour = 9, minute = 12): string {
  return `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function djb2(text: string): number {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

/** 稳定哈希回填：同一条记录永远落到同一个林场，且各模块间均匀摊开。 */
export function hashFarm(seed: string): string {
  return FARMS[djb2(seed) % FARMS.length].key
}

function firstValue(row: EntryRow, fields: string[]): { field: string; value: string } {
  for (const field of fields) {
    const raw = row[field]
    const value = raw === undefined || raw === null ? '' : String(raw).trim()
    if (value) {
      return { field, value }
    }
  }
  return { field: '', value: '' }
}

export type Attribution = { farm: string; provenance: 'manual' | 'field' | 'rule-hash'; hintField: string; hintValue: string }

/**
 * 林场归属三级解析（全程只读，不改写任何原始记录）：
 * 1. 手工覆盖（独立覆盖表，缺归属的历史数据可在态势页指定）
 * 2. 原生归属字段内容匹配林场名
 * 3. 稳定哈希规则回填，并在页面标注来源
 */
export function resolveFarm(
  moduleKey: string,
  row: EntryRow,
  overrides: Record<string, string>,
): Attribution {
  const code = recordKey(moduleKey, row)
  const override = overrides[code]
  if (override) {
    return { farm: override, provenance: 'manual', hintField: '手工覆盖', hintValue: farmName(override) }
  }
  const hint = firstValue(row, FARM_HINT_FIELDS[moduleKey] ?? [])
  if (hint.value) {
    for (const farm of FARMS) {
      if (hint.value.includes(farm.name) || hint.value.includes(farm.name.slice(0, 2))) {
        return { farm: farm.key, provenance: 'field', hintField: hint.field, hintValue: hint.value }
      }
    }
  }
  return {
    farm: hashFarm(`${moduleKey}:${code}`),
    provenance: 'rule-hash',
    hintField: hint.field,
    hintValue: hint.value,
  }
}

export function recordKey(moduleKey: string, row: EntryRow): string {
  return `${moduleKey}#${row.id}`
}

/** 从记录里解析可作为编号展示的字段（各模块第一个登记字段）。 */
const CODE_FIELD: Record<string, string> = Object.fromEntries(
  MODULES.map((meta) => [meta.key, meta.fields[0]]),
)

export function recordCode(moduleKey: string, row: EntryRow): string {
  const field = CODE_FIELD[moduleKey]
  return field ? String(row[field] ?? `#${row.id}`) : `#${row.id}`
}

function parseDate(value: string): string {
  const match = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/.exec(value)
  if (!match) {
    return ''
  }
  const [, y, m, d] = match
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/**
 * 记录归属班次：按日期字段落班；
 * 历史脏数据解析不出日期时，按编号稳定摊到 9/1–9/3 的历史班次，避免老数据混进当前班。
 */
export function resolveShift(moduleKey: string, row: EntryRow): { date: string; session: 'day' | 'night' } {
  const dateField = firstValue(row, DATE_FIELDS[moduleKey] ?? [])
  const date = parseDate(dateField.value)
  if (date) {
    return { date, session: 'day' }
  }
  const seed = djb2(`${moduleKey}:${row.id}`)
  const day = (seed % 3) + 1
  return { date: `2026-09-0${day}`, session: seed % 2 === 0 ? 'day' : 'night' }
}

/** 当前班次（演示固定白班）对应的班时区间文本，封存时沿用。 */
export function shiftSessionRange(session: 'day' | 'night'): string {
  return session === 'day'
    ? `白班 08:00-20:00`
    : `夜班 20:00-次日08:00`
}

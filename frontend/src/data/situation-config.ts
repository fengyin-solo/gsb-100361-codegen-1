import type { EntryRow, Farm } from './types'
import { UNASSIGNED_FARM } from './types'

// 林火态势总览的口径配置：每个业务模块从哪一列读林场、位置、班次日期，都集中在这里。
// 页面与汇总服务都只读这份配置，不再各自判断字段。

export type ModuleSituationConfig = {
  // 记录里直接登记了林场的字段（如「所属林场」）；缺省走关键词规则推断。
  farmField?: string
  // 变化热点里展示的位置字段。
  locationField: string
  // 业务日期字段：有这一列的模块按日期归入班次，封存时只冻结对应日期的记录。
  dateField?: string
}

export const MODULE_SITUATION: Record<string, ModuleSituationConfig> = {
  patrol: { farmField: '巡护区域', locationField: '巡护区域', dateField: '巡护日期' },
  firewatch: { farmField: '监测区域', locationField: '监测区域', dateField: '监测时间' },
  lookout: { farmField: '所在山头', locationField: '所在山头' },
  firebreak: { farmField: '所属林区', locationField: '所属林区', dateField: '最近维护日期' },
  fireteam: { farmField: '所属林场', locationField: '队伍名称' },
  equipment: { farmField: '保管林场', locationField: '装备名称' },
  weather: { farmField: '观测站点', locationField: '观测站点', dateField: '观测时间' },
  firereport: { farmField: '起火地点', locationField: '起火地点', dateField: '起火时间' },
  drone: { farmField: '飞行区域', locationField: '飞行区域', dateField: '起飞时间' },
  campaign: { farmField: '覆盖村组', locationField: '覆盖村组', dateField: '活动日期' },
  checkpoint: { farmField: '站点位置', locationField: '站点位置', dateField: '值班日期' },
  duty: { locationField: '值勤岗位', dateField: '值勤日期' },
  supply: { farmField: '储备林场', locationField: '物资名称' },
  forestroad: { farmField: '起点位置', locationField: '道路名称', dateField: '最近巡检日' },
  firebelt: { farmField: '所属林区', locationField: '林带名称' },
  drill: { farmField: '参演队伍', locationField: '演练主题', dateField: '演练日期' },
  burnpermit: { farmField: '用火地点', locationField: '用火地点', dateField: '计划时段' },
  treegrowth: { farmField: '样地编号', locationField: '样地编号' },
}

// 关键词推断规则：历史记录没有林场归属时，按登记文本里的片区关键词回填。
// 只在「归属派生层」生效，绝不改写原始记录。
// 「样例N」只用于归属/位置字段本身的匹配——全行文本里多个字段都会带样例序号，
// 拿它做兜底会把整行误判给规则表里的第一个林场。
const FARM_KEYWORDS: Array<{ farm: Farm; words: string[] }> = [
  { farm: '青石林场', words: ['青石', '东山', '北坡', '一号'] },
  { farm: '苍石林场', words: ['苍石', '西山', '南坡', '二号'] },
  { farm: '云岭林场', words: ['云岭', '云顶', '南岭', '三号'] },
]
const FARM_SAMPLE_WORDS: Array<{ farm: Farm; word: string }> = [
  { farm: '青石林场', word: '样例1' },
  { farm: '苍石林场', word: '样例2' },
  { farm: '云岭林场', word: '样例3' },
]

// 记录里显式写出了完整林场名的，直接采用。
function matchExplicitFarm(text: string): Farm | null {
  if (text.includes('青石')) return '青石林场'
  if (text.includes('苍石')) return '苍石林场'
  if (text.includes('云岭')) return '云岭林场'
  return null
}

function matchKeywordFarm(text: string, allowSample: boolean): Farm {
  const explicit = matchExplicitFarm(text)
  if (explicit) return explicit
  if (allowSample) {
    const sample = FARM_SAMPLE_WORDS.find((rule) => text.includes(rule.word))
    if (sample) return sample.farm
  }
  for (const rule of FARM_KEYWORDS) {
    if (rule.words.some((word) => word && text.includes(word))) {
      return rule.farm
    }
  }
  return UNASSIGNED_FARM
}

export function inferFarmFromText(text: string): Farm {
  return matchKeywordFarm(text, true)
}

// 归属回填：人工订正 > 记录内归属/位置字段 > 关键词推断 > 未归属。
export function resolveFarm(
  moduleKey: string,
  row: EntryRow,
  override: { farm?: Farm; source?: string } | undefined,
): { farm: Farm; source: 'override' | 'field' | 'rule' | 'none' } {
  if (override?.farm && override.farm !== UNASSIGNED_FARM) {
    return { farm: override.farm, source: 'override' }
  }
  const config = MODULE_SITUATION[moduleKey]
  // 只在归属/位置字段上做关键词（含样例序号）匹配，避免跨字段误判。
  const fieldNames = [config?.farmField, config?.locationField].filter(Boolean) as string[]
  for (const fieldName of fieldNames) {
    const text = String(row[fieldName] ?? '')
    if (text.trim() === '') continue
    const fromField = matchKeywordFarm(text, true)
    if (fromField !== UNASSIGNED_FARM) {
      return { farm: fromField, source: 'field' }
    }
  }
  // 兜底：全行文本只认真实片区关键词，不认样例序号。
  const joined = Object.values(row).map((value) => String(value)).join(' ')
  const inferred = matchKeywordFarm(joined, false)
  return { farm: inferred, source: inferred === UNASSIGNED_FARM ? 'none' : 'rule' }
}

// 从业务字段里取班次日期；只认 YYYY-MM-DD 前缀，取不出来就不归属任何班次。
export function extractShiftDate(row: EntryRow, moduleKey: string): string | null {
  const field = MODULE_SITUATION[moduleKey]?.dateField
  if (!field) return null
  const raw = String(row[field] ?? '')
  const matched = raw.match(/(\d{4}-\d{2}-\d{2})/)
  return matched ? matched[1] : null
}

export function locationOf(moduleKey: string, row: EntryRow): string {
  const field = MODULE_SITUATION[moduleKey]?.locationField ?? 'id'
  return String(row[field] ?? row.id ?? '未登记位置')
}

export function dateFieldOf(moduleKey: string): string | undefined {
  return MODULE_SITUATION[moduleKey]?.dateField
}

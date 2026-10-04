// 态势口径端到端验证：用内存版 localStorage 驱动数据层与态势服务。
import { allRows, saveRows } from '../src/data/local-store'
import { situationState } from '../src/data/situation-store'
import {
  clearFarmOverride,
  completeTodo,
  listResolvedRows,
  loadSituation,
  recordChange,
  sealShift,
  setFarmOverride,
} from '../src/api/situation-service'
import { runAction } from '../src/api/local-service'

function assert(cond: boolean, label: string) {
  if (!cond) {
    console.error('FAIL:', label)
    process.exitCode = 1
  } else {
    console.log('PASS:', label)
  }
}

const s = loadSituation()

// 1. 种子：09-01 已封存，09-02 / 09-03 未封存；三个林场并排都有数据
assert(s.sealedShiftCount === 1, '种子含 1 个已封存班次')
assert(s.openShiftCount === 2, `有 2 个未封存班次（实际 ${s.openShiftCount}）`)
const farmNames = s.farms.map((f) => f.farm)
assert(farmNames.includes('青石林场') && farmNames.includes('苍石林场') && farmNames.includes('云岭林场'), '按林场并排输出')

// 2. 每个林场各模块含 登记/待处理/异常
// 口径 = 09-01 封存快照（每林场巡护 1 条）+ 09-02/09-03 未封存实时（样例2→苍石、样例3→云岭）
const qs = s.farms.find((f) => f.farm === '青石林场')!
const cs = s.farms.find((f) => f.farm === '苍石林场')!
const yl = s.farms.find((f) => f.farm === '云岭林场')!
const qp = qs.modules.find((m) => m.key === 'patrol')!
const cp = cs.modules.find((m) => m.key === 'patrol')!
const yp = yl.modules.find((m) => m.key === 'patrol')!
assert(qp.total === 1 && qp.pending === 1, `青石巡护=快照1（实际 总${qp.total}/待${qp.pending}）`)
assert(cp.total === 2 && cp.pending === 2 && cp.abnormal === 2, `苍石巡护=快照1+实时1（实际 总${cp.total}/待${cp.pending}/异${cp.abnormal}）`)
assert(yp.total === 2 && yp.pending === 0, `云岭巡护=快照1+实时1（实际 总${yp.total}/待${yp.pending}）`)

// 3. 变化最多的三处，榜首是苍石二号瞭望区（种子 5 次；火情发生在相邻的北坡点位单列）
assert(s.topSpots.length === 3, '列出最近变化最多的三处')
assert(s.topSpots[0].location === '苍石二号瞭望区', `榜首位置（实际 ${s.topSpots[0].location}）`)
assert(s.topSpots[0].count === 5, `榜首变化 5 次（实际 ${s.topSpots[0].count}）`)
assert(s.topSpots[1].count >= 2 && s.topSpots[2].count >= 2, '前三处变化均不少于 2 次')

// 4. 封存 09-02：生成 v1、待办（当日巡护 1 + 火情 1，逐记录生成）
const beforeTodos = s.todos.length
const seal0902 = sealShift('2026-09-02', '值班终端A')
assert(seal0902.ok, '封存 09-02 成功：' + seal0902.message)
const s2 = loadSituation()
assert(s2.sealedShiftCount === 2, '封存后已封存班次=2')
const sealed2 = s2.shifts.find((x) => x.id === '2026-09-02')!
assert(sealed2.version === 1 && sealed2.terminals.join() === '值班终端A', '首终端落 v1')
const newTodos = s2.todos.length - beforeTodos
assert(newTodos === 2, `封存生成 2 条联动待办（实际 ${newTodos}）`)
assert(s2.todos.some((t) => t.kind === '巡护任务复核' && t.shiftId === '2026-09-02'), '生成巡护任务复核事项')
assert(s2.todos.some((t) => t.kind === '火情报告待办' && t.shiftId === '2026-09-02'), '生成火情报告待办')

// 5. 同一班次第二终端提交：仍是同一份版本，不重生快照/待办
const dup = sealShift('2026-09-02', '值班终端B')
const s3 = loadSituation()
const sealed3 = s3.shifts.find((x) => x.id === '2026-09-02')!
assert(dup.ok && dup.duplicated, '第二终端识别为重复提交')
assert(sealed3.version === 1, `版本仍为 v1（实际 v${sealed3.version}）`)
assert(sealed3.terminals.join() === '值班终端A,值班终端B', '两个终端都登记在同一份版本上')
assert(s3.todos.length === s2.todos.length, '重复提交不重复生成待办')

// 同终端再点：幂等拒绝
const dupSame = sealShift('2026-09-02', '值班终端A')
assert(!dupSame.ok && dupSame.duplicated, '同终端重复提交被拒绝')

// 6. 已封存记录沿用原快照：改 09-01 的巡护记录，总览数字不变
const rowsBefore = JSON.stringify(loadSituation().farms)
// 直接改状态并保存（绕过动作也无所谓，快照口径不受影响）
const row0901 = allRows()['patrol'].find((r) => String(r['巡护日期']) === '2026-09-01')!
// 直接改状态并保存（绕过动作也无所谓，快照口径不受影响）
saveRows('patrol', allRows()['patrol'].map((r) => (Number(r.id) === Number(row0901.id) ? { ...r, pending: false, abnormal: true, status: '已完成' } : r)))
const s4 = loadSituation()
assert(JSON.stringify(s4.farms) === rowsBefore, '改已封存班次记录，总览仍沿用原快照')
// 09-03 此刻仍未封存（09-02 已在第 4 步封存）：改它会实时重算；该日巡护归属云岭
const farmLive = listResolvedRows('patrol').find((x) => String(x.row['巡护日期']) === '2026-09-03')!.farm
assert(farmLive === '云岭林场', '09-03 巡护归属云岭（字段关键词推断）')
const beforePending = s4.farms.find((f) => f.farm === farmLive)!.modules.find((m) => m.key === 'patrol')!.pending
// 该样例行原始 pending=false：先翻成 true 看实时 +1，再翻回来看复原（每次都按 id 取当前数组）
const flip = (value: boolean) =>
  saveRows(
    'patrol',
    allRows()['patrol'].map((r) => (String(r['巡护日期']) === '2026-09-03' ? { ...r, pending: value } : r)),
  )
flip(true)
const afterPlus = loadSituation().farms.find((f) => f.farm === farmLive)!.modules.find((m) => m.key === 'patrol')!.pending
flip(false)
const s5 = loadSituation()
const afterPending = s5.farms.find((f) => f.farm === farmLive)!.modules.find((m) => m.key === 'patrol')!.pending
assert(afterPlus === beforePending + 1 && afterPending === beforePending, `未封存班次改动后实时重算（before=${beforePending}, plus=${afterPlus}, after=${afterPending}）`)

// 7. 状态流转写入变化事件
const eventsBefore = situationState().events.length
const firewatchRow = allRows()['firewatch'].find((r) => String(r['监测时间']) === '2026-09-03')!
runAction('firewatch', Number(firewatchRow.id), '升级预警')
assert(situationState().events.length === eventsBefore + 1, '状态流转追加变化事件')

// 8. 归属回填：不改原始记录
const target = allRows()['patrol'].find((r) => String(r['巡护日期']) === '2026-09-03')!
const targetId = Number(target.id)
const originalJson = JSON.stringify(allRows()['patrol'].find((r) => Number(r.id) === targetId))
setFarmOverride('patrol', targetId, '云岭林场')
const afterJson = JSON.stringify(allRows()['patrol'].find((r) => Number(r.id) === targetId))
assert(originalJson === afterJson, '人工回填不回写原始记录')
const resolved = listResolvedRows('patrol').find((x) => Number(x.row.id) === targetId)!
assert(resolved.farm === '云岭林场' && resolved.source === 'override', '回填生效且来源标记为人工订正')
clearFarmOverride('patrol', targetId)
const restored = listResolvedRows('patrol').find((x) => Number(x.row.id) === targetId)!
assert(restored.source !== 'override', '撤销订正后恢复推断口径')

// 9. 待办办结
const todoId = s3.todos.find((t) => !t.done)!.id
completeTodo(todoId)
assert(loadSituation().todos.find((t) => t.id === todoId)!.done, '待办可办结')

// 10. 未归属林场列存在（种子里无未归属，卡片应为 0；造一条无关键词记录验证回填链）
const weird = { id: 999, status: '待执行', pending: true, abnormal: false, 任务编号: 'PATR-X', 巡护区域: '无法识别的地点', 巡护日期: '2026-09-03' } as any
saveRows('patrol', [...allRows()['patrol'], weird])
const s6 = loadSituation()
assert((s6.farms.find((f) => f.farm === '未归属')?.total ?? 0) >= 1, '无法判定的记录进入未归属林场')
recordChange('patrol', weird, '开始巡护')

console.log(process.exitCode ? '--- 有失败用例 ---' : '--- 全部用例通过 ---')

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>林火态势总览</h2>
        <p class="page-desc">按林场并排展示各业务模块的登记总量、待处理与异常量；已封存班次沿用快照，未封存班次实时重算。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in data.cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="board">
      <h3 class="board-title">最近变化最多的三处林场（近 7 天）</h3>
      <div v-if="data.changes.length" class="change-grid">
        <article v-for="(item, index) in data.changes" :key="item.farm" class="change-card">
          <div class="change-head">
            <span class="change-rank">No.{{ index + 1 }}</span>
            <strong>{{ item.farmName }}</strong>
          </div>
          <p class="change-count">{{ item.count }} <span>次变化</span></p>
          <p class="change-time">最近：{{ item.latestAt }}</p>
          <p class="change-modules">
            <span v-for="name in item.modules.slice(0, 5)" :key="name" class="chip">{{ name }}</span>
            <span v-if="item.modules.length > 5" class="chip">等 {{ item.modules.length }} 个模块</span>
          </p>
        </article>
      </div>
      <p v-else class="empty-inline">近 7 天各林场暂无变化记录</p>
    </section>

    <section class="board">
      <h3 class="board-title">分林场业务态势（登记总量 / 待处理 / 异常量）</h3>
      <div class="table-scroll">
        <table class="data-table matrix-table">
          <thead>
            <tr>
              <th rowspan="2" class="sticky-col">业务模块</th>
              <th v-for="farm in data.farms" :key="farm.key" colspan="3" class="farm-head">{{ farm.name }}</th>
              <th colspan="3" class="total-head">全场合计</th>
            </tr>
            <tr>
              <template v-for="farm in data.farms" :key="farm.key">
                <th>登记总量</th><th>待处理</th><th>异常量</th>
              </template>
              <th>登记总量</th><th>待处理</th><th>异常量</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.moduleRows" :key="row.key">
              <td class="sticky-col">{{ row.name }}</td>
              <template v-for="farm in data.farms" :key="farm.key">
                <td class="num strong">{{ cell(row, farm.key).total }}</td>
                <td class="num" :class="{ warn: cell(row, farm.key).pending > 0 }">{{ cell(row, farm.key).pending }}</td>
                <td class="num" :class="{ danger: cell(row, farm.key).abnormal > 0 }">{{ cell(row, farm.key).abnormal }}</td>
              </template>
              <td class="num strong">{{ row.total.total }}</td>
              <td class="num" :class="{ warn: row.total.pending > 0 }">{{ row.total.pending }}</td>
              <td class="num" :class="{ danger: row.total.abnormal > 0 }">{{ row.total.abnormal }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="sticky-col strong">林场合计</td>
              <template v-for="farm in data.farms" :key="farm.key">
                <td class="num strong">{{ data.farmTotals[farm.key].total }}</td>
                <td class="num" :class="{ warn: data.farmTotals[farm.key].pending > 0 }">{{ data.farmTotals[farm.key].pending }}</td>
                <td class="num" :class="{ danger: data.farmTotals[farm.key].abnormal > 0 }">{{ data.farmTotals[farm.key].abnormal }}</td>
              </template>
              <td class="num strong">{{ data.grand.total }}</td>
              <td class="num" :class="{ warn: data.grand.pending > 0 }">{{ data.grand.pending }}</td>
              <td class="num" :class="{ danger: data.grand.abnormal > 0 }">{{ data.grand.abnormal }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="board-note">
        汇总口径：已封存班次 {{ data.sealedCount }} 个，取封存时按「林场 × 模块」固化的快照，记录后续变化不重算；
        未封存班次 {{ data.unsealedCount }} 个（含当前班次）按当前登记实时重算。
      </p>
    </section>

    <section class="board">
      <h3 class="board-title">班次台账与封存</h3>
      <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>班次</th><th>封存状态</th><th>版本</th><th>封存时间 / 操作人</th>
            <th>提交终端</th><th>快照（总/待/异）</th><th>实时参考（总/待/异）</th><th>封存操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="shift in data.shifts" :key="shift.id" :class="{ 'current-shift': shift.id === data.currentShiftId }">
            <td>{{ shift.date }} {{ shift.session }}</td>
            <td>
              <span :class="shift.sealed ? 'tag tag-sealed' : 'tag tag-live'">
                {{ shift.sealed ? '已封存' : '未封存' }}
              </span>
              <span v-if="shift.id === data.currentShiftId" class="tag tag-current">当前班次</span>
            </td>
            <td>{{ shift.sealed ? `v${shift.version}` : '—' }}</td>
            <td>
              <template v-if="shift.sealed">{{ shift.sealedAt }}<br /><span class="muted">{{ shift.sealedBy }}</span></template>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-for="t in shift.terminals" :key="t" class="chip">{{ t }}</span>
              <span v-if="!shift.terminals.length" class="muted">—</span>
            </td>
            <td class="nowrap">
              <template v-if="shift.snapshot">
                {{ shift.snapshot.totals.total }} /
                <span :class="{ warn: shift.snapshot.totals.pending > 0 }">{{ shift.snapshot.totals.pending }}</span> /
                <span :class="{ danger: shift.snapshot.totals.abnormal > 0 }">{{ shift.snapshot.totals.abnormal }}</span>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td class="nowrap" :class="{ 'drift-cell': shift.drift }" :title="shift.drift ? '实时值已偏离封存快照，态势汇总仍以快照为准' : ''">
              {{ shift.live.total }} /
              <span :class="{ warn: shift.live.pending > 0 }">{{ shift.live.pending }}</span> /
              <span :class="{ danger: shift.live.abnormal > 0 }">{{ shift.live.abnormal }}</span>
              <span v-if="shift.drift" class="drift-flag">偏离</span>
            </td>
            <td>
              <template v-if="!shift.sealed">
                <select v-model="terminalChoice[shift.id]" class="terminal-select">
                  <option v-for="t in terminals" :key="t" :value="t">{{ t }}</option>
                </select>
                <button class="btn primary seal-btn" type="button" @click="seal(shift.id)">封存本班</button>
              </template>
              <template v-else>
                <select v-model="terminalChoice[shift.id]" class="terminal-select">
                  <option v-for="t in terminals" :key="t" :value="t">{{ t }}</option>
                </select>
                <button class="btn seal-btn" type="button" @click="seal(shift.id)">另一终端重复提交</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="board-note">
        同一班次两个终端重复提交只落一份版本（v1）：快照与待办沿用首次封存，不重复生成，仅追加终端记录。
      </p>
    </section>

    <section class="board">
      <h3 class="board-title">封存联动待办（每封存一个班次各生成 1 条，按班次去重）</h3>
      <table class="data-table">
        <thead>
          <tr><th>事项</th><th>来源班次</th><th>内容</th><th>状态</th><th>生成时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="todo in data.todos" :key="todo.id">
            <td>
              <span :class="todo.kind === 'patrol-review' ? 'tag tag-patrol' : 'tag tag-fire'">{{ todo.title }}</span>
            </td>
            <td class="nowrap">{{ todo.date }} {{ todo.session }}</td>
            <td>{{ todo.detail }}</td>
            <td><span :class="todo.status === '待处理' ? 'tag tag-live' : 'tag tag-done'">{{ todo.status }}</span></td>
            <td class="nowrap">{{ todo.createdAt }}</td>
            <td>
              <button v-if="todo.status === '待处理'" class="link" type="button" @click="finishTodo(todo.id)">办结</button>
              <span v-else class="muted">{{ todo.doneAt }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="board">
      <h3 class="board-title">历史林场归属回填（只读原始记录，归属另存覆盖表）</h3>
      <p class="provenance-line">
        <span class="chip">原生字段匹配：{{ data.backfill.field }} 条</span>
        <span class="chip">稳定规则回填：{{ data.backfill.rule }} 条</span>
        <span class="chip">手工覆盖：{{ data.backfill.manual }} 条</span>
      </p>
      <p class="board-note">
        缺林场归属的历史数据按「模块 + 编号」稳定哈希回填，同一条记录每次结果一致；
        也可在下表手工指定，只写入归属覆盖表，<strong>不改写任何原始登记记录</strong>。
      </p>
      <table v-if="data.backfill.rows.length" class="data-table">
        <thead>
          <tr><th>业务模块</th><th>记录编号</th><th>归属线索</th><th>当前回填林场</th><th>手工指定</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in backfillPage" :key="`${item.key}-${item.id}`">
            <td>{{ item.name }}</td>
            <td>{{ item.code }}</td>
            <td class="muted">{{ item.hintField ? `${item.hintField}：${item.hintValue || '空'}` : '无归属字段' }}</td>
            <td>{{ farmName(item.farm) }}</td>
            <td>
              <select
                class="terminal-select"
                :value="item.farm"
                @change="assignFarm(item.key, item.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">保持规则回填</option>
                <option v-for="farm in data.farms" :key="farm.key" :value="farm.key">{{ farm.name }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-inline">没有缺归属的历史记录</p>
      <div v-if="data.backfill.rows.length > backfillLimit" class="pager">
        <button class="btn" type="button" :disabled="backfillLimit <= 10" @click="backfillLimit = 10">收起</button>
        <span class="muted">显示前 {{ Math.min(backfillLimit, data.backfill.rows.length) }} / {{ data.backfill.rows.length }} 条</span>
        <button class="btn" type="button" @click="backfillLimit += 10">再看 10 条</button>
      </div>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器；封存快照、待办、归属覆盖与业务登记分开存放</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  completeTodoAction,
  loadSituation,
  sealShiftAction,
  setBackfillFarm,
} from '@/api/local-service'
import { FARMS, farmName, TERMINALS } from '@/data/domain'
import { useSessionStore } from '@/stores/session'
import type { MetricTriad, SituationResult } from '@/data/types'

const store = useSessionStore()
const terminals = TERMINALS

const data = ref<SituationResult>(emptySituation())
const message = ref('')
const messageOk = ref(true)
const backfillLimit = ref(10)
const terminalChoice = reactive<Record<string, string>>({})

function emptySituation(): SituationResult {
  return {
    cards: [],
    farms: FARMS.map((farm) => ({ key: farm.key, name: farm.name })),
    moduleRows: [],
    farmTotals: {},
    grand: { total: 0, pending: 0, abnormal: 0 },
    changes: [],
    todos: [],
    shifts: [],
    currentShiftId: '',
    sealedCount: 0,
    unsealedCount: 0,
    backfill: { field: 0, rule: 0, manual: 0, rows: [] },
  }
}

const zero: MetricTriad = { total: 0, pending: 0, abnormal: 0 }

function cell(row: SituationResult['moduleRows'][number], farm: string): MetricTriad {
  return row.byFarm[farm] ?? zero
}

const backfillPage = computed(() => data.value.backfill.rows.slice(0, backfillLimit.value))

function refresh() {
  data.value = loadSituation()
  for (const shift of data.value.shifts) {
    if (!terminalChoice[shift.id]) {
      terminalChoice[shift.id] = TERMINALS[0]
    }
  }
}

function seal(id: string) {
  const result = sealShiftAction(id, terminalChoice[id] ?? TERMINALS[0], store.operator)
  message.value = result.message
  messageOk.value = result.ok
  refresh()
}

function finishTodo(id: number) {
  completeTodoAction(id)
  refresh()
}

function assignFarm(moduleKey: string, rowId: number, farm: string) {
  if (!farm) {
    return
  }
  setBackfillFarm(moduleKey, rowId, farm)
  message.value = '已写入归属覆盖表，原始登记记录未改动；态势汇总已按新归属重算未封存部分'
  messageOk.value = true
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.page-actions { display: flex; gap: 8px; }
.board { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin: 14px 0; }
.board-title { margin: 0 0 10px; font-size: 15px; }
.board-note { margin: 8px 0 0; font-size: 12px; color: var(--muted); line-height: 1.6; }
.empty-inline { color: var(--muted); font-size: 13px; margin: 4px 0; }
.muted { color: var(--muted); font-size: 12px; }
.strong { font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.nowrap { white-space: nowrap; font-variant-numeric: tabular-nums; }
.warn { color: #b54708; font-weight: 600; }
.danger { color: #b42318; font-weight: 600; }
.ok-text { color: #067647; font-size: 13px; }

.change-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.change-card { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: #fbfdff; }
.change-head { display: flex; align-items: center; gap: 8px; }
.change-rank { background: var(--brand); color: #fff; border-radius: 4px; font-size: 12px; padding: 1px 8px; }
.change-count { font-size: 22px; font-weight: 700; margin: 6px 0 2px; }
.change-count span { font-size: 12px; font-weight: 400; color: var(--muted); }
.change-time { font-size: 12px; color: var(--muted); margin: 0 0 6px; }
.change-modules { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.chip { background: #eef2f7; border-radius: 999px; padding: 2px 10px; font-size: 12px; }

.table-scroll { overflow-x: auto; }
.matrix-table { min-width: 1080px; border-collapse: separate; border-spacing: 0; }
.matrix-table th, .matrix-table td { border-right: 1px solid var(--border); }
.farm-head { background: #eaf1fb; text-align: center; border-bottom: 2px solid var(--brand); }
.total-head { background: #f3f6fb; text-align: center; border-bottom: 2px solid #334155; }
.matrix-table tfoot td { background: #f8fafc; }
.sticky-col { position: sticky; left: 0; background: #fff; z-index: 1; min-width: 110px; }
.matrix-table tfoot .sticky-col { background: #f8fafc; }

.tag { display: inline-block; border-radius: 999px; padding: 1px 9px; font-size: 12px; margin-right: 4px; }
.tag-sealed { background: #ecfdf3; color: #067647; }
.tag-live { background: #fffaeb; color: #b54708; }
.tag-current { background: #eaf1fb; color: var(--brand); }
.tag-done { background: #f1f5f9; color: var(--muted); }
.tag-patrol { background: #eef4ff; color: #1d4ed8; }
.tag-fire { background: #fef3f2; color: #b42318; }

.current-shift { background: #fcfdff; }
.terminal-select { padding: 3px 6px; font-size: 12px; margin-right: 6px; }
.seal-btn { padding: 3px 10px; font-size: 12px; }
.drift-cell { background: #fff7ed; }
.drift-flag { display: inline-block; margin-left: 4px; font-size: 11px; color: #b54708; border: 1px solid #fedf89; border-radius: 4px; padding: 0 4px; }

.provenance-line { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
.pager { display: flex; gap: 10px; align-items: center; justify-content: center; margin-top: 10px; font-size: 12px; }
.pager .btn:disabled { opacity: 0.5; cursor: default; }
</style>

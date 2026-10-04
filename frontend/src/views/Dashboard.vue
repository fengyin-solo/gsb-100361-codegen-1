<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>林火态势总览</h2>
        <p class="page-desc">按林场并排汇总各业务模块的登记总量、待处理与异常量；已封存班次沿用快照，未封存班次实时重算。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <!-- 全域关键指标 -->
    <div class="stat-row">
      <article v-for="card in situation.cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value" :class="{ warn: card.label === '异常量' && card.value > 0 }">{{ card.value }}</strong>
      </article>
    </div>

    <!-- 各林场并排：登记总量 / 待处理 / 异常量 -->
    <h3 class="section-title">分林场业务态势</h3>
    <div class="farm-grid">
      <article v-for="farm in situation.farms" :key="farm.farm" class="farm-card" :class="{ unassigned: farm.farm === '未归属' }">
        <header class="farm-head">
          <span class="farm-name">{{ farm.farm }}</span>
          <span v-if="farm.inferred" class="tag tag-inferred" title="该林场含按关键词规则推断的归属，可在下方回填区核对">含推断</span>
        </header>
        <div class="farm-summary">
          <span>登记 <strong>{{ farm.total }}</strong></span>
          <span>待处理 <strong :class="{ warn: farm.pending > 0 }">{{ farm.pending }}</strong></span>
          <span>异常 <strong :class="{ danger: farm.abnormal > 0 }">{{ farm.abnormal }}</strong></span>
        </div>
        <table class="mini-table">
          <thead>
            <tr><th>业务模块</th><th>登记</th><th>待处理</th><th>异常</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in farm.modules" :key="item.key">
              <td>{{ item.name }}</td>
              <td>{{ item.total }}</td>
              <td :class="{ warn: item.pending > 0 }">{{ item.pending }}</td>
              <td :class="{ danger: item.abnormal > 0 }">{{ item.abnormal }}</td>
            </tr>
            <tr v-if="!farm.modules.length">
              <td colspan="4" class="empty-state">暂无登记数据</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>

    <div class="two-col">
      <!-- 最近变化最多的三处 -->
      <section class="panel">
        <h3 class="section-title">最近变化最多的三处（近 7 天）</h3>
        <table class="data-table">
          <thead>
            <tr><th>#</th><th>林场 / 位置</th><th>关联模块</th><th>变化次数</th><th>待处理</th><th>异常</th><th>最近变化</th></tr>
          </thead>
          <tbody>
            <tr v-for="(spot, index) in situation.topSpots" :key="`${spot.farm}-${spot.location}`">
              <td>{{ index + 1 }}</td>
              <td>
                <strong>{{ spot.farm }}</strong>
                <span class="spot-location">{{ spot.location }}</span>
              </td>
              <td>{{ spot.moduleName }}</td>
              <td><strong class="hot-count">{{ spot.count }}</strong></td>
              <td :class="{ warn: spot.pending > 0 }">{{ spot.pending }}</td>
              <td :class="{ danger: spot.abnormal > 0 }">{{ spot.abnormal }}</td>
              <td>{{ formatTime(spot.lastAt) }}</td>
            </tr>
            <tr v-if="!situation.topSpots.length">
              <td colspan="7" class="empty-state">近 7 天暂无变化记录</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 班次封存 -->
      <section class="panel">
        <h3 class="section-title">班次封存口径</h3>
        <p class="panel-tip">封存后该班次只沿用快照；同一班次两个终端提交只落一份版本，并生成巡护复核与火情待办。</p>
        <div class="terminal-line">
          <label>
            当前终端：
            <select v-model="terminal">
              <option>值班终端A</option>
              <option>值班终端B</option>
            </select>
          </label>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>班次</th><th>状态</th><th>版本/终端</th><th>记录</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="shift in situation.shifts" :key="shift.id">
              <td>{{ shift.id }}</td>
              <td>
                <span :class="shift.sealed ? 'tag tag-sealed' : 'tag tag-open'">
                  {{ shift.sealed ? '已封存' : '未封存' }}
                </span>
              </td>
              <td class="terminal-cell">
                <template v-if="shift.sealed">
                  v{{ shift.version }}<br />
                  <span class="terminal-list">{{ shift.terminals.join('、') }}</span>
                </template>
                <span v-else class="muted">实时口径</span>
              </td>
              <td>{{ shift.recordCount }}</td>
              <td>
                <button v-if="!shift.sealed" class="link" type="button" @click="seal(shift.id)">封本班次</button>
                <button v-else class="link" type="button" @click="seal(shift.id)">用{{ terminal === '值班终端A' ? 'B' : 'A' }}重复提交</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 封存生成的待办 -->
    <h3 class="section-title">封存联动待办（巡护任务复核 · 火情报告待办）</h3>
    <table class="data-table">
      <thead>
        <tr><th>类型</th><th>事项</th><th>来源班次</th><th>归属林场</th><th>生成时间</th><th>状态</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="todo in situation.todos" :key="todo.id" :class="{ done: todo.done }">
          <td><span :class="todo.kind === '巡护任务复核' ? 'tag tag-review' : 'tag tag-fire'">{{ todo.kind }}</span></td>
          <td>{{ todo.title }}</td>
          <td>{{ todo.shiftId }}</td>
          <td>{{ todo.farm }}</td>
          <td>{{ formatTime(todo.createdAt) }}</td>
          <td>{{ todo.done ? '已办结' : '待办' }}</td>
          <td><button v-if="!todo.done" class="link" type="button" @click="finishTodo(todo.id)">办结</button></td>
        </tr>
        <tr v-if="!situation.todos.length">
          <td colspan="7" class="empty-state">暂无封存联动待办</td>
        </tr>
      </tbody>
    </table>

    <!-- 历史林场归属回填：只写派生层，不动原始记录 -->
    <section class="panel backfill-panel">
      <header class="backfill-head">
        <div>
          <h3 class="section-title">历史林场归属回填</h3>
          <p class="panel-tip">
            回填只保存在归属派生层（{{ backfillStorageKey }}），不回写业务原始记录；
            「规则推断」来自关键词规则，「未归属」需要人工订正。已封存记录即使订正归属，封存快照仍保持原样。
          </p>
        </div>
        <div class="backfill-controls">
          <select v-model="backfillModule">
            <option value="">全部模块</option>
            <option v-for="meta in moduleOptions" :key="meta.key" :value="meta.key">{{ meta.name }}</option>
          </select>
          <label class="check-line">
            <input v-model="backfillShowResolved" type="checkbox" />
            同时显示已判定归属
          </label>
        </div>
      </header>
      <table class="data-table">
        <thead>
          <tr><th>业务模块</th><th>记录编号</th><th>登记位置</th><th>班次</th><th>当前归属</th><th>来源</th><th>人工订正</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in visibleBackfill" :key="`${item.moduleKey}-${item.row.id}`">
            <td>{{ item.moduleName }}</td>
            <td>{{ refCode(item.moduleKey, item.row) }}</td>
            <td>{{ locationOf(item.moduleKey, item.row) }}</td>
            <td>{{ item.shiftDate ?? '—' }}<span v-if="item.sealed" class="tag tag-sealed">已封存</span></td>
            <td>{{ item.farm }}</td>
            <td>{{ sourceLabel[item.source] }}</td>
            <td class="backfill-actions">
              <select
                :value="item.source === 'override' ? item.farm : ''"
                @change="assignFarm(item.moduleKey, Number(item.row.id), ($event.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>选择林场…</option>
                <option v-for="farm in assignableFarms" :key="farm" :value="farm">{{ farm }}</option>
              </select>
              <button
                v-if="item.source === 'override'"
                class="link"
                type="button"
                @click="clearAssign(item.moduleKey, Number(item.row.id))"
              >
                撤销订正
              </button>
            </td>
          </tr>
          <tr v-if="!visibleBackfill.length">
            <td colspan="7" class="empty-state">没有需要回填归属的历史记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot situation-foot">
      <span>汇总口径：已封存 {{ situation.sealedShiftCount }} 个班次沿用封存快照；未封存 {{ situation.openShiftCount }} 个班次与无班次台账实时重算。</span>
      <span>最近重算：{{ formatTime(situation.generatedAt) }} · 数据保存在本机浏览器</span>
    </footer>
    <p v-if="message" class="action-message" :class="{ error: messageIsError }">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  clearFarmOverride,
  completeTodo,
  listResolvedRows,
  loadSituation,
  sealShift,
  setFarmOverride,
} from '@/api/situation-service'
import { MODULES } from '@/data/modules'
import { situationStorageKey } from '@/data/situation-store'
import { locationOf } from '@/data/situation-config'
import type { EntryRow, Farm, SituationResult } from '@/data/types'

const emptySituation = (): SituationResult => ({
  generatedAt: '',
  sealedShiftCount: 0,
  openShiftCount: 0,
  cards: [],
  farms: [],
  topSpots: [],
  shifts: [],
  todos: [],
})

const situation = ref<SituationResult>(emptySituation())
const terminal = ref('值班终端B')
const message = ref('')
const messageIsError = ref(false)

const backfillModule = ref('')
const backfillShowResolved = ref(false)
const moduleOptions = MODULES
const assignableFarms: Farm[] = ['青石林场', '苍石林场', '云岭林场']
const backfillStorageKey = situationStorageKey()

const sourceLabel: Record<string, string> = {
  override: '人工订正',
  field: '记录字段',
  rule: '规则推断',
  none: '未归属',
}

const backfillRows = computed(() => listResolvedRows(backfillModule.value))
const visibleBackfill = computed(() =>
  backfillRows.value.filter((item) => backfillShowResolved.value || item.source === 'none' || item.source === 'rule'),
)

function refCode(moduleKey: string, row: EntryRow): string {
  const meta = MODULES.find((item) => item.key === moduleKey)
  return String(row[meta?.fields[0] ?? 'id'] ?? row.id)
}

function formatTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function notify(text: string, isError = false) {
  message.value = text
  messageIsError.value = isError
}

function refresh() {
  situation.value = loadSituation()
}

function seal(shiftId: string) {
  const result = sealShift(shiftId, terminal.value)
  notify(result.message, !result.ok)
  refresh()
}

function finishTodo(id: string) {
  completeTodo(id)
  refresh()
}

function assignFarm(moduleKey: string, id: number, farm: string) {
  if (!farm) return
  setFarmOverride(moduleKey, id, farm as Farm)
  notify(`已在派生层把该记录的归属订正为「${farm}」，原始记录未改动`)
  refresh()
}

function clearAssign(moduleKey: string, id: number) {
  clearFarmOverride(moduleKey, id)
  notify('已撤销人工订正，恢复按记录字段与关键词规则推断')
  refresh()
}

onMounted(refresh)
</script>

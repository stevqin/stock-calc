<script setup lang="ts">
import DateTimeField from "./components/DateTimeField.vue";
import {
  computed,
  ref,
  shallowRef,
  watch,
  onBeforeUnmount,
  nextTick,
} from "vue";
import Decimal from "decimal.js";
import type { Account, Security } from "./sim/model";
import { shanghaiDate, nextDate } from "./sim/model";
import type { ChartData } from "./sim/chart";
import {
  analyzeAccount,
  summarizeAnalysis,
  monthSequence,
  shiftMonth,
} from "./sim/analysis";
import { marketCharts, marketQuotes } from "./market";
import { loadAnalysisHistory } from "./analysisHistory";

const props = defineProps<{ account: Account; today?: string }>();
const clock = ref(Date.now());
const clockTimer = setInterval(() => (clock.value = Date.now()), 60000);
const today = computed(
  () => props.today ?? shanghaiDate(new Date(clock.value)),
);
const currentMonth = computed(() => today.value.slice(0, 7));
const firstDate = computed(
  () =>
    [
      ...props.account.entries.map((e) => e.date),
      ...(props.account.cashEntries ?? []).map((e) => e.date),
    ].sort()[0] ?? today.value,
);
const hasRecords = computed(
  () => props.account.entries.length > 0 || !!props.account.cashEntries?.length,
);
const preset = ref("1m");
const customStart = ref(shiftMonth(today.value, -1));
const customEnd = ref(today.value);
const range = computed(() => ({
  start:
    preset.value === "custom"
      ? customStart.value
      : preset.value === "all"
        ? firstDate.value
        : shiftMonth(
            today.value,
            preset.value === "6m" ? -6 : preset.value === "1y" ? -12 : -1,
          ),
  end: preset.value === "custom" ? customEnd.value : today.value,
}));
const validRange = computed(
  () =>
    /^\d{4}-\d{2}-\d{2}$/.test(range.value.start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(range.value.end) &&
    range.value.start <= range.value.end &&
    range.value.end <= today.value,
);
const calendarView = ref<"all" | "year" | "month">("month");
const selectedYear = ref(today.value.slice(0, 4));
const selectedMonth = ref(currentMonth.value);
const selectedDay = ref("");
const dayDetail = ref<HTMLDialogElement>();
let dayTrigger: HTMLElement | undefined;
function openDay(date: string, event: MouseEvent) {
  dayTrigger = event.currentTarget as HTMLElement;
  selectedDay.value = date;
}
function closeDay() {
  dayDetail.value?.close();
  selectedDay.value = "";
  dayTrigger?.focus({ preventScroll: true });
}
watch(selectedDay, async (date) => {
  await nextTick();
  if (date && selectedDay.value === date) dayDetail.value?.showModal();
});
const years = computed(() =>
  Array.from(
    {
      length: Math.max(
        1,
        Number(today.value.slice(0, 4)) -
          Number(firstDate.value.slice(0, 4)) +
          1,
      ),
    },
    (_, i) => String(Number(firstDate.value.slice(0, 4)) + i),
  ),
);
const months = computed(() =>
  monthSequence(
    /^\d{4}-\d{2}$/.test(selectedMonth.value)
      ? selectedMonth.value
      : currentMonth.value,
  ),
);
function lastDay(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
function monthLabel(month: string) {
  return `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
}
const calendarRange = computed(() =>
  calendarView.value === "all"
    ? { start: firstDate.value, end: today.value }
    : calendarView.value === "year"
      ? {
          start: `${selectedYear.value}-01-01`,
          end: `${selectedYear.value}-12-31`,
        }
      : { start: `${months.value.at(-1)!}-01`, end: lastDay(months.value[0]) },
);
const neededYears = computed(() => {
  const set = new Set<number>();
  for (const r of [
    validRange.value ? range.value : calendarRange.value,
    calendarRange.value,
  ]) {
    const start = Math.max(
      Number(r.start.slice(0, 4)),
      Number(firstDate.value.slice(0, 4)),
    );
    const end = Math.min(
      Number(r.end.slice(0, 4)),
      Number(today.value.slice(0, 4)),
    );
    for (let y = start; y <= end; y++) set.add(y);
  }
  return [...set].sort();
});
const tradedSecurities = computed(() =>
  props.account.securities.filter((s) =>
    props.account.entries.some((e) => e.securityId === s.id),
  ),
);
const benchmark: Security = {
  id: "sh000001",
  market: "sh",
  code: "000001",
  name: "交易日历",
  asset: "stock",
  category: "stock",
  settlement: "T+1",
};
const history = shallowRef<Record<string, ChartData>>({});
const loading = ref(false),
  errors = ref<string[]>([]),
  retryToken = ref(0);
let handledRetryToken = 0;
let generation = 0,
  disposed = false;
watch(
  () =>
    `${tradedSecurities.value.map((s) => s.id).join()}|${neededYears.value.join()}|${today.value}|${retryToken.value}`,
  async () => {
    const ticket = ++generation;
    const force = retryToken.value !== handledRetryToken;
    handledRetryToken = retryToken.value;
    if (!tradedSecurities.value.length) {
      loading.value = false;
      errors.value = [];
      return;
    }
    loading.value = true;
    errors.value = [];
    const failed: string[] = [];
    const requests = [...tradedSecurities.value, benchmark].flatMap((s) =>
      neededYears.value
        .filter((year) => {
          if (s.id === benchmark.id) return true;
          const entries = props.account.entries
            .filter((e) => e.securityId === s.id)
            .sort((a, b) => a.time.localeCompare(b.time));
          if (!entries.length) return false;
          let quantity = new Decimal(0);
          for (const e of entries)
            quantity =
              e.kind === "opening"
                ? new Decimal(e.quantity)
                : e.kind === "buy"
                  ? quantity.plus(e.quantity)
                  : quantity.minus(e.quantity);
          const lastYear = quantity.gt(0)
            ? Number(today.value.slice(0, 4))
            : Number(entries.at(-1)!.date.slice(0, 4));
          return (
            year >= Number(entries[0].date.slice(0, 4)) && year <= lastYear
          );
        })
        .map((year) => ({ s, year })),
    );
    await Promise.all(
      requests.map(async ({ s, year }) => {
        try {
          const data = await loadAnalysisHistory(s, year, { force });
          if (!disposed)
            history.value = { ...history.value, [`${s.id}:${year}`]: data };
        } catch (e) {
          failed.push(
            `${s.name} ${year}年：${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }),
    );
    if (!disposed && ticket === generation) {
      errors.value = failed;
      loading.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  clearInterval(clockTimer);
});
const charts = computed(() => {
  const result: Record<string, ChartData> = {};
  const sources = [
    ...Object.values(history.value),
    ...Object.values(marketCharts).filter((c) => c.mode === "daily-raw"),
  ].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  for (const chart of sources) {
    if (chart.adjustment !== "不复权") continue;
    const rows = new Map(
      (result[chart.symbol]?.bars ?? []).map((b) => [b.date, b]),
    );
    for (const bar of chart.bars) rows.set(bar.date, bar);
    result[chart.symbol] = {
      ...chart,
      suspensions: [
        ...new Map(
          [
            ...(result[chart.symbol]?.suspensions ?? []),
            ...(chart.suspensions ?? []),
          ].map((e) => [e.date, e]),
        ).values(),
      ],
      bars: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
  return result;
});
const calendarCoverage = computed(() =>
  Object.values(history.value)
    .filter((c) => c.symbol === benchmark.id && c.bars.length > 0)
    .map((c) => ({ start: c.bars[0].date, end: c.bars.at(-1)!.date })),
);
const analysis = computed(() =>
  analyzeAccount(props.account, charts.value, marketQuotes, today.value, {
    calendar: charts.value[benchmark.id],
    calendarCoverage: calendarCoverage.value,
    now: new Date(clock.value),
  }),
);
const summary = computed(() =>
  summarizeAnalysis(analysis.value, range.value.start, range.value.end),
);
const missingRanges = computed(() => {
  const ranges: { start: string; end: string }[] = [];
  for (const day of analysis.value.days) {
    if (
      day.date < range.value.start ||
      day.date > range.value.end ||
      day.profit !== null
    )
      continue;
    const previous = ranges.at(-1);
    if (previous && nextDate(previous.end) === day.date)
      previous.end = day.date;
    else ranges.push({ start: day.date, end: day.date });
  }
  return ranges;
});
const dailyMap = computed(
  () => new Map(analysis.value.days.map((d) => [d.date, d])),
);
const calendarDates = computed(
  () => new Set(charts.value[benchmark.id]?.bars.map((b) => b.date) ?? []),
);
function money(value?: string | null, sign = false) {
  if (value == null) return "—";
  const n = new Decimal(value);
  return `${sign && n.gt(0) ? "+" : ""}${n.toNumber().toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function percent(value?: string | null) {
  return value == null ? "—" : `${money(value, true)}%`;
}
function tone(value?: string | null) {
  return value == null
    ? "unknown"
    : new Decimal(value).gt(0)
      ? "gain"
      : new Decimal(value).lt(0)
        ? "loss"
        : "flat";
}
function period(start: string, end: string) {
  if (start > today.value)
    return {
      profit: null,
      returnRate: null,
      rateReason: "无有效证券资金基数",
      label: "尚未发生",
      missingDays: 0,
    };
  if (end < firstDate.value || !hasRecords.value)
    return {
      profit: null,
      returnRate: null,
      rateReason: "无有效证券资金基数",
      label: "无记录",
      missingDays: 0,
    };
  const s = summarizeAnalysis(
    analysis.value,
    start < firstDate.value ? firstDate.value : start,
    end > today.value ? today.value : end,
  );
  return {
    ...s,
    label: s.missingDays
      ? `${s.missingDays}日数据不足`
      : end > today.value
        ? "截至今日"
        : "",
  };
}
const periodCells = computed(() =>
  calendarView.value === "all"
    ? years.value.map((y) => ({
        key: y,
        ...period(`${y}-01-01`, `${y}-12-31`),
      }))
    : Array.from({ length: 12 }, (_, i) => {
        const key = `${selectedYear.value}-${String(i + 1).padStart(2, "0")}`;
        return { key, ...period(`${key}-01`, lastDay(key)) };
      }),
);
function openPeriod(key: string) {
  if (calendarView.value === "all") {
    selectedYear.value = key;
    calendarView.value = "year";
  } else if (key <= currentMonth.value) {
    selectedMonth.value = key;
    calendarView.value = "month";
  }
}
function dateStatus(date: string) {
  if (date > today.value) return "尚未发生";
  if (date < firstDate.value || !hasRecords.value) return "无记录";
  const day = dailyMap.value.get(date);
  if (day?.status === "missing") return "数据不足";
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const rest =
    weekday === 0 ||
    weekday === 6 ||
    (calendarCoverage.value.some((r) => date >= r.start && date <= r.end) &&
      !calendarDates.value.has(date));
  if (
    rest &&
    (!day?.profit || new Decimal(day.profit).isZero()) &&
    !props.account.entries.some((e) => e.date === date)
  )
    return "休市";
  return "";
}
const monthCalendars = computed(() =>
  months.value.map((month) => {
    const [year, m] = month.split("-").map(Number);
    const padding = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
    const count = Number(lastDay(month).slice(8));
    return {
      month,
      label: monthLabel(month),
      total: period(`${month}-01`, lastDay(month)),
      padding: padding < 5 ? padding : 0,
      days: Array.from({ length: count }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, "0")}`;
        return {
          date,
          number: i + 1,
          day: dailyMap.value.get(date),
          status: dateStatus(date),
        };
      }).filter(({ date }) => {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        return weekday !== 0 && weekday !== 6;
      }),
    };
  }),
);
const detail = computed(() => dailyMap.value.get(selectedDay.value));
const dayEntries = computed(() =>
  props.account.entries.filter((e) => e.date === selectedDay.value),
);
const dayCash = computed(() =>
  (props.account.cashEntries ?? []).filter((e) => e.date === selectedDay.value),
);
const names = computed(
  () => new Map(props.account.securities.map((s) => [s.id, s.name])),
);
const cashNames: Record<string, string> = {
  deposit: "入金（不计收益）",
  withdraw: "出金（不计收益）",
  "repo-interest": "逆回购利息",
  interest: "利息",
  "other-income": "其他收入",
  "legacy-balance": "期初资金（不计收益）",
};
const contributions = computed(() =>
  [...summary.value.contributions].sort(
    (a, b) => Number(b.profit ?? -Infinity) - Number(a.profit ?? -Infinity),
  ),
);
const chart = computed(() => {
  const days = analysis.value.days.filter(
    (d) => d.date >= range.value.start && d.date <= range.value.end,
  );
  let total = new Decimal(0),
    missing = false;
  const points = days
    .map((day, i) => {
      if (day.profit === null) missing = true;
      if (missing) return null;
      total = total.plus(day.profit!);
      return {
        date: day.date,
        value: total.toNumber(),
        x: 52 + (i / Math.max(days.length - 1, 1)) * 648,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const min = Math.min(0, ...points.map((p) => p.value)),
    max = Math.max(0, ...points.map((p) => p.value));
  const spread = max - min || 1;
  const y = (value: number) => 170 - ((value - min) / spread) * 136;
  return {
    points: points.map((p) => ({ ...p, y: y(p.value) })),
    path: points
      .map((p, i) => `${i ? "L" : "M"}${p.x},${y(p.value)}`)
      .join(" "),
    min,
    max,
    zero: y(0),
    missing,
    start: days[0]?.date,
    end: days.at(-1)?.date,
  };
});
</script>

<template>
  <section class="pnl-analysis">
    <header class="pnl-heading">
      <div>
        <h2>盈亏分析</h2>
        <p>回看收益，了解每一段交易的得失</p>
      </div>
      <span class="pnl-data-origin">账本起点 {{ firstDate }} · 金额 / 元</span>
    </header>
    <div class="pnl-range-toolbar">
      <div class="pnl-segments">
        <button
          v-for="p in [
            { id: '1m', label: '最近一月' },
            { id: '6m', label: '最近半年' },
            { id: '1y', label: '最近一年' },
            { id: 'all', label: '开户至今' },
            { id: 'custom', label: '自定义' },
          ]"
          :key="p.id"
          :class="{ active: preset === p.id }"
          @click="preset = p.id"
        >
          {{ p.label }}
        </button>
      </div>
      <div v-if="preset === 'custom'" class="pnl-date-range">
        <DateTimeField
          v-model="customStart"
          mode="date"
          test-id="analysis-start-date"
          :max="customEnd"
        /><span>至</span
        ><DateTimeField
          v-model="customEnd"
          mode="date"
          test-id="analysis-end-date"
          :min="customStart"
          :max="today"
        />
      </div>
      <span v-else class="pnl-range-label"
        >{{ range.start }} — {{ range.end }}</span
      >
    </div>
    <p v-if="!validRange" class="pnl-warning">
      请选择有效的起止日期，结束日期不能晚于今天。
    </p>
    <p v-if="!hasRecords" class="pnl-empty">
      还没有账本记录。录入交易或资金流水后，即可查看收益分析。
    </p>
    <div v-if="loading" class="pnl-loading">
      正在补充历史行情，已有数据可继续查看…
    </div>
    <details v-if="errors.length" class="pnl-warning">
      <summary>
        {{ errors.length }} 项历史行情未能获取，缺失收益标为「—」
      </summary>
      <ul>
        <li v-for="error in errors" :key="error">{{ error }}</li>
      </ul>
      <button :disabled="loading" @click="retryToken++">重新获取</button>
    </details>
    <template v-if="validRange">
      <div class="pnl-metrics">
        <div class="pnl-metric pnl-total">
          <span>区间总盈亏</span
          ><strong :class="tone(summary.profit)">{{
            money(hasRecords ? summary.profit : null, true)
          }}</strong
          ><span class="pnl-total-return" :title="summary.rateReason"
            >证券盈亏率
            <b class="range-return" :class="tone(summary.returnRate)">{{
              percent(summary.returnRate)
            }}</b></span
          ><small>含持仓涨跌及利息等收入，已扣交易费用</small>
        </div>
        <div class="pnl-metric">
          <span>区间卖出盈亏</span
          ><strong :class="tone(summary.realized)">{{
            money(hasRecords ? summary.realized : null, true)
          }}</strong
          ><small
            >卖出盈亏＝卖出净收入−按 FIFO
            匹配的买入成本，包含部分卖出和已经清仓的交易。</small
          >
        </div>
        <div class="pnl-metric">
          <span>浮动盈亏变化</span
          ><strong :class="tone(summary.unrealizedChange)">{{
            money(hasRecords ? summary.unrealizedChange : null, true)
          }}</strong
          ><small>区间内未实现盈亏的变化</small>
        </div>
        <div class="pnl-metric">
          <span>交易手续费</span
          ><strong>{{ money(hasRecords ? summary.fees : null) }}</strong
          ><small>已计入盈亏，不再重复扣除</small>
        </div>
      </div>
      <div class="pnl-outcomes">
        <div>
          <span>胜率</span
          ><b>{{ summary.winRate === null ? "—" : summary.winRate + "%" }}</b>
        </div>
        <div>
          <span>已结束轮次</span><b>{{ summary.closed }}</b
          ><small
            >{{ summary.wins }} 盈 / {{ summary.losses }} 亏 /
            {{ summary.flat }} 平</small
          >
        </div>
        <div>
          <span>平均盈利</span
          ><b class="gain">{{ money(summary.averageWin, true) }}</b>
        </div>
        <div>
          <span>平均亏损</span
          ><b class="loss">{{ money(summary.averageLoss) }}</b>
        </div>
        <div>
          <span>利息等收入</span
          ><b :class="tone(summary.income)">{{
            money(summary.income, true)
          }}</b>
        </div>
      </div>
      <p class="pnl-note">
        胜率按区间内结束的完整持仓轮次计算；盈利轮次 ÷
        全部结束轮次（含持平）。未清仓与今日待结算轮次不参与。
      </p>
      <details
        v-if="summary.missingDays"
        class="pnl-warning pnl-missing-ranges"
      >
        <summary>
          所选区间有 {{ summary.missingDays }} 日缺少收益基准，查看缺失日期
        </summary>
        <p>完整总盈亏暂不可用；区间卖出盈亏和手续费仍按账本展示。</p>
        <button :disabled="loading" @click="retryToken++">补充历史行情</button>
        <ul>
          <li v-for="item in missingRanges" :key="item.start">
            {{ item.start
            }}{{ item.end !== item.start ? " — " + item.end : "" }}
          </li>
        </ul>
      </details>
      <div class="pnl-insights">
        <section class="pnl-panel">
          <header>
            <h3>累计盈亏</h3>
            <span>所选区间 · 元</span>
          </header>
          <svg
            v-if="chart.points.length && hasRecords"
            class="pnl-trend"
            viewBox="0 0 720 204"
          >
            <line
              x1="52"
              x2="700"
              :y1="chart.zero"
              :y2="chart.zero"
              class="pnl-chart-zero"
            />
            <text x="46" y="30" text-anchor="end">
              {{ money(String(chart.max)) }}
            </text>
            <text x="46" y="174" text-anchor="end">
              {{ money(String(chart.min)) }}
            </text>
            <path
              :d="chart.path"
              :class="tone(String(chart.points.at(-1)?.value ?? 0))"
            />
            <circle
              v-for="p in chart.points"
              :key="p.date"
              :cx="p.x"
              :cy="p.y"
              r="3"
            >
              <title>
                {{ p.date }} 累计 {{ money(String(p.value), true) }} 元
              </title>
            </circle>
            <text x="52" y="199">{{ chart.start }}</text>
            <text x="700" y="199" text-anchor="end">{{ chart.end }}</text>
          </svg>
          <p v-else class="pnl-empty">暂无完整的收益曲线数据</p>
          <p v-if="chart.missing" class="pnl-note">
            曲线截至首个收益缺失日，不跨越数据缺口。
          </p>
        </section>
        <section class="pnl-panel pnl-contribution">
          <header>
            <h3>证券盈亏贡献</h3>
            <span>所选区间</span>
          </header>
          <div class="pnl-contribution-scroll">
            <table>
              <thead>
                <tr>
                  <th>证券</th>
                  <th>区间盈亏</th>
                  <th>区间卖出盈亏</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in contributions" :key="item.securityId">
                  <td>
                    {{ names.get(item.securityId) ?? item.securityId
                    }}<small>{{ item.securityId.slice(2) }}</small>
                  </td>
                  <td :class="tone(item.profit)">
                    {{ money(item.profit, true) }}
                  </td>
                  <td :class="tone(item.realized)">
                    {{ money(item.realized, true) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!contributions.length" class="pnl-empty">
              该区间暂无证券记录
            </p>
          </div>
        </section>
      </div>
    </template>
    <section class="pnl-panel pnl-calendar">
      <header class="pnl-calendar-header">
        <div>
          <h3>收益日历</h3>
          <p>
            {{
              calendarView === "month"
                ? "最近12个月 · 最新月份在前 · 红盈绿亏"
                : "独立查看完整年月 · 红盈绿亏"
            }}
          </p>
        </div>
        <div class="pnl-calendar-controls">
          <div class="pnl-segments">
            <button
              v-for="v in [
                { id: 'all', label: '全部' },
                { id: 'year', label: '年' },
                { id: 'month', label: '月' },
              ] as const"
              :key="v.id"
              :class="{ active: calendarView === v.id }"
              @click="calendarView = v.id"
            >
              {{ v.label }}
            </button>
          </div>
          <select
            v-if="calendarView === 'year'"
            v-model="selectedYear"
            class="pnl-year-select"
          >
            <option v-for="year in years" :key="year" :value="year">
              {{ year }}年
            </option></select
          ><DateTimeField
            v-if="calendarView === 'month'"
            v-model="selectedMonth"
            mode="month"
            test-id="analysis-month"
            :max="currentMonth"
          />
        </div>
      </header>
      <div v-if="calendarView !== 'month'" class="pnl-period-grid">
        <button
          v-for="cell in periodCells"
          :key="cell.key"
          class="pnl-period-cell"
          :data-period="cell.key"
          :disabled="
            cell.label === '尚未发生' ||
            (cell.key.length === 7 && cell.key > currentMonth)
          "
          @click="openPeriod(cell.key)"
        >
          <span>{{
            cell.key.length === 4
              ? cell.key + "年"
              : Number(cell.key.slice(5)) + "月"
          }}</span
          ><strong :class="tone(cell.profit)">{{
            money(cell.profit, true)
          }}</strong
          ><b
            class="pnl-period-return"
            :class="tone(cell.returnRate)"
            :title="cell.rateReason"
            >{{ percent(cell.returnRate) }}</b
          ><small>{{ cell.label }}</small>
        </button>
      </div>
      <div v-else class="pnl-months">
        <div class="pnl-month-grid">
          <article
            v-for="month in monthCalendars"
            :key="month.month"
            class="pnl-month"
            :class="{ 'is-selected': month.month === selectedMonth }"
          >
            <header>
              <h3>{{ month.label }}</h3>
              <div class="pnl-month-result">
                <strong :class="tone(month.total.profit)">{{
                  money(month.total.profit, true)
                }}</strong
                ><b
                  class="pnl-month-return"
                  :class="tone(month.total.returnRate)"
                  :title="month.total.rateReason"
                  >{{ percent(month.total.returnRate) }}</b
                >
              </div>
            </header>
            <p class="pnl-month-note">
              {{ month.total.label || "当月收益 / 元" }}
            </p>
            <div class="pnl-weekdays">
              <span v-for="day in ['一', '二', '三', '四', '五']" :key="day">{{
                day
              }}</span>
            </div>
            <div class="pnl-days">
              <span
                v-for="i in month.padding"
                :key="'pad' + i"
                class="pnl-day-blank"
              /><button
                v-for="cell in month.days"
                :key="cell.date"
                :data-date="cell.date"
                class="pnl-day"
                :class="[
                  tone(cell.status ? null : cell.day?.profit),
                  {
                    selected: selectedDay === cell.date,
                    today: cell.date === today,
                  },
                ]"
                :disabled="
                  cell.date > today || cell.date < firstDate || !hasRecords
                "
                :title="
                  cell.day?.reasons.join('；') ||
                  cell.day?.rateReason ||
                  `${cell.date} ${cell.status || money(cell.day?.profit, true) + ' 元'}，证券盈亏率 ${percent(cell.day?.returnRate)}`
                "
                @click="openDay(cell.date, $event)"
              >
                <span>{{ cell.number }}</span
                ><small>{{
                  cell.status || money(cell.day?.profit, true)
                }}</small
                ><small
                  class="pnl-day-return"
                  :class="tone(cell.day?.returnRate)"
                  >{{ cell.status ? "" : percent(cell.day?.returnRate) }}</small
                >
              </button>
            </div>
          </article>
        </div>
      </div>
      <p class="pnl-note">
        月历仅展示周一至周五，月汇总仍包含周末入账的收益。「—」代表数据不足；盘中收益为估算。开户至今以账本最早记录为起点。
      </p>
      <p class="pnl-note">
        证券盈亏率按「证券当日盈亏 ÷（日初持仓市值 +
        当日净买入正值）」计算，排除闲置现金和利息等收入。月、年及区间按未舍入的每日收益率复利累计；无有效基数时显示「—」。
      </p>
    </section>
    <dialog
      v-if="selectedDay"
      ref="dayDetail"
      class="pnl-panel pnl-day-detail"
      @cancel.prevent="closeDay"
      @click.self="closeDay"
    >
      <div class="pnl-day-dialog-content">
        <header>
          <h3 id="pnl-day-title">{{ selectedDay }} · 收益明细</h3>
          <button autofocus class="pnl-day-close" @click="closeDay">
            关闭
          </button>
        </header>
        <div class="pnl-day-totals">
          <span
            >当日收益
            <b :class="tone(detail?.profit)">{{
              money(detail?.profit, true)
            }}</b></span
          ><span :title="detail?.rateReason"
            >证券盈亏率
            <b class="day-return" :class="tone(detail?.returnRate)">{{
              percent(detail?.returnRate)
            }}</b></span
          ><span>手续费 {{ money(detail?.fees) }}</span
          ><span>利息等收入 {{ money(detail?.income, true) }}</span>
        </div>
        <p v-if="detail?.reasons.length" class="pnl-warning">
          {{ detail.reasons.join("；") }}
        </p>
        <table>
          <thead>
            <tr>
              <th>证券</th>
              <th>当日盈亏</th>
              <th>当日卖出盈亏</th>
              <th>手续费</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in detail?.contributions ?? []"
              :key="item.securityId"
            >
              <td>{{ names.get(item.securityId) ?? item.securityId }}</td>
              <td :class="tone(item.profit)">{{ money(item.profit, true) }}</td>
              <td>{{ money(item.realized, true) }}</td>
              <td>{{ money(item.fees) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="pnl-day-records">
          <div>
            <h4>当日成交</h4>
            <p v-if="!dayEntries.length" class="pnl-note">
              当日无成交，持仓价格变化仍会影响收益。
            </p>
            <p v-for="entry in dayEntries" :key="entry.id">
              {{ names.get(entry.securityId) }} ·
              {{
                entry.kind === "buy"
                  ? "买入"
                  : entry.kind === "sell"
                    ? "卖出"
                    : "期初持仓"
              }}
              {{ entry.quantity }} × {{ entry.price
              }}<small>手续费 {{ money(entry.fees?.total ?? "0") }}</small>
            </p>
          </div>
          <div>
            <h4>资金流水</h4>
            <p v-if="!dayCash.length" class="pnl-note">当日无资金流水</p>
            <p v-for="entry in dayCash" :key="entry.id">
              {{ cashNames[entry.kind] }} <b>{{ money(entry.amount) }}</b
              ><small>{{ entry.note }}</small>
            </p>
          </div>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style src="./analysis.css"></style>

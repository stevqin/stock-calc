<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import Decimal from "decimal.js";
import type { Security, TableView } from "../sim/model";
import type {
  DailyPerformance,
  SecurityContribution,
} from "../sim/performance";
import type { Position } from "../sim/model";
import {
  holdingPerformance,
  fiveDayChange,
  dailyReturnPercent,
} from "../sim/performance";
import {
  columnLabels,
  resolvedColumnWidths,
  type TableViewKind,
} from "../sim/workspaceState";
import { marketQuotes, marketCharts, marketErrors, chartKey } from "../market";
import { quoteAge } from "../quotes";
import { marketFundFlows, fundFlowErrors } from "../market";
import { flowAmount, flowHint, formatFlow } from "../fundFlow";
import MiniChart from "./MiniChart.vue";
const props = defineProps<{
  rows: Security[];
  view: TableView;
  mode: "daily" | "intraday";
  positions: Record<string, Position>;
  holdingDays?: Record<string, number | null>;
  recordedIds: string[];
  daily: Record<string, DailyPerformance>;
  contributions?: Record<string, SecurityContribution>;
  variant?: TableViewKind;
  selected: string;
  checked: string[];
}>();
const emit = defineEmits<{
  select: [id: string];
  detail: [id: string];
  check: [ids: string[]];
  config: [view: TableView];
  visible: [ids: string[]];
  pnl: [id: string];
  context: [target: { id: string; x: number; y: number }];
}>();
const root = ref<HTMLElement>();
const hovered = ref(false);
const frozen = ref<string[]>([]);
const visibleIds = new Set<string>();
let selectionAnchor = "";
function selectRow(id: string, event: MouseEvent) {
  const ids = ordered.value.map((s) => s.id);
  if (event.shiftKey && ids.includes(selectionAnchor)) {
    const a = ids.indexOf(selectionAnchor),
      b = ids.indexOf(id);
    const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    emit(
      "check",
      event.metaKey || event.ctrlKey
        ? [...new Set([...props.checked, ...range])]
        : range,
    );
  } else {
    emit(
      "check",
      event.metaKey || event.ctrlKey
        ? props.checked.includes(id)
          ? props.checked.filter((v) => v !== id)
          : [...props.checked, id]
        : [id],
    );
    selectionAnchor = id;
  }
  emit("select", id);
}
function contextRow(id: string, event: MouseEvent | KeyboardEvent) {
  event.preventDefault();
  const row = (event.target as HTMLElement).closest("tr");
  const trigger = row?.querySelector<HTMLElement>(".security-name");
  trigger?.focus({ preventScroll: true });
  const rect = trigger?.getBoundingClientRect();
  emit("context", {
    id,
    x: event instanceof MouseEvent ? event.clientX : (rect?.left ?? 8),
    y: event instanceof MouseEvent ? event.clientY : (rect?.bottom ?? 8),
  });
}
function rowKey(id: string, event: KeyboardEvent) {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    contextRow(id, event);
}
function hasHistory(s: Security) {
  return (
    props.recordedIds.includes(s.id) ||
    new Decimal(props.positions[s.id]?.quantity ?? 0).gt(0)
  );
}
function boardBadge(s: Security) {
  if (s.asset === "etf") return { text: "基", title: "场内ETF" };
  if (s.market === "sz" && /^(300|301)/.test(s.code))
    return { text: "创", title: "创业板" };
  if (s.market === "sh" && /^688/.test(s.code))
    return { text: "科", title: "科创板" };
  return null;
}
function identityBadge(s: Security) {
  return (
    boardBadge(s) ?? {
      text: s.market.toUpperCase(),
      title: s.market === "sh" ? "上海证券交易所" : "深圳证券交易所",
    }
  );
}
const headerText: Record<string, [string, string]> = {
  change: ["涨跌幅", "涨跌额（元）"],
  fiveDay: ["5日涨跌幅", ""],
  peRatio: ["市盈率", "PE（倍）"],
  pbRatio: ["市净率", "PB（倍）"],
  activity: ["活跃度", "量比 / 换手率"],
  sizeVolume: ["规模 / 成交", "亿元 / 万手"],
  volumeRatio: ["量比", "（倍）"],
  turnover: ["换手率", ""],
  amplitude: ["振幅", ""],
  flow: ["主力净流入", "（元）"],
  floatCap: ["流通市值", "（亿元）"],
  volume: ["成交量", "（万手）"],
  quantity: ["持仓数量", "（股/份）"],
  marketValue: ["市值（元）", "持仓（可卖）"],
  dailyPnl: ["今日盈亏", "收益率"],
  cyclePnl: ["本轮盈亏", "收益率"],
  totalContribution: ["累计收益贡献", "组内占比"],
  realizedContribution: ["历史已实现", "（元）"],
  holdingContribution: ["当前持仓", "浮盈亏（元）"],
  contributionBreakdown: ["贡献拆分", "历史 / 持仓"],
};
let observer: IntersectionObserver | undefined;
const availableWidth = ref(0);
let sizeObserver: ResizeObserver | undefined;
const widths = computed(() =>
  resolvedColumnWidths(
    props.view,
    availableWidth.value,
    props.variant ?? "holdings",
  ),
);
const priceWidth = computed(() =>
  (props.variant ?? "holdings") === "holdings" ? 100 : 90,
);
const tableWidth = computed(
  () =>
    110 +
    priceWidth.value +
    Object.values(widths.value).reduce((a, b) => a + b, 0),
);
function changeAmount(s: Security) {
  const q = marketQuotes[s.id];
  if (!q?.previousClose) return "—";
  const amount = new Decimal(q.latest).minus(q.previousClose);
  return `${amount.gt(0) ? "+" : ""}${amount.toFixed(s.asset === "etf" ? 3 : 2)}`;
}
function holdingQuantity(s: Security) {
  const p = props.positions[s.id];
  const quantity = (v?: string) =>
    new Decimal(v ?? 0).toNumber().toLocaleString("zh-CN");
  const held = quantity(p?.quantity);
  return new Decimal(p?.quantity ?? 0).eq(p?.available ?? 0)
    ? held
    : `${held}（${quantity(p?.available)}）`;
}
function percent(v: string | null, signed = true) {
  if (v === null) return "—";
  const n = new Decimal(v).toDecimalPlaces(2);
  return `${signed && n.gt(0) ? "+" : ""}${n.toFixed(2)}%`;
}
function dailyPercent(s: Security) {
  return hasHistory(s) ? percent(dailyReturnPercent(props.daily[s.id])) : "—";
}
function cyclePercent(s: Security) {
  if (!hasHistory(s)) return "—";
  const v = holdingPerformance(
    props.positions[s.id],
    marketQuotes[s.id],
  ).cyclePnlPercent;
  return percent(v);
}
function value(s: Security, c: string): string | null {
  const q = marketQuotes[s.id],
    p = props.positions[s.id],
    h = holdingPerformance(p, q);
  if (c === "latest") return q?.latest ?? null;
  if (c === "fiveDay")
    return fiveDayChange(q, marketCharts[chartKey(s.id, "daily")]);
  if (c === "activity") return q?.volumeRatio ?? null;
  if (c === "sizeVolume") return q?.floatCap ?? null;
  if (c === "contributionBreakdown")
    return props.contributions?.[s.id]?.realized ?? null;
  if (c === "quantity") return p?.quantity ?? "0";
  if (
    ["marketValue", "cyclePnl", "dailyPnl", "dilutedCost"].includes(c) &&
    !hasHistory(s)
  )
    return null;
  if (c === "marketValue") return h.marketValue;
  if (c === "cyclePnl") return h.cyclePnl;
  if (c === "dilutedCost") return p?.dilutedCost ?? null;
  if (c === "dailyPnl") return props.daily[s.id]?.profit ?? null;
  if (c === "totalContribution")
    return props.contributions?.[s.id]?.total ?? null;
  if (c === "realizedContribution")
    return props.contributions?.[s.id]?.realized ?? null;
  if (c === "holdingContribution")
    return props.contributions?.[s.id]?.holding ?? null;
  if (c === "flow") return flowAmount(marketFundFlows[s.id], q?.quoteTime);
  return (q as unknown as Record<string, string | null>)?.[c] ?? null;
}
const sorted = computed(() => {
  const list = [...props.rows],
    key = props.view.sort;
  if (!key || key === "chart") return list;
  return list.sort((a, b) => {
    const x = value(a, key),
      y = value(b, key);
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    return new Decimal(x).cmp(y) * (props.view.direction === "asc" ? 1 : -1);
  });
});
const ordered = computed(() => {
  if (!hovered.value || !frozen.value.length) return sorted.value;
  const byId = new Map(props.rows.map((s) => [s.id, s]));
  return [
    ...frozen.value.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    ...props.rows.filter((s) => !frozen.value.includes(s.id)),
  ];
});
function freeze() {
  frozen.value = ordered.value.map((s) => s.id);
  hovered.value = true;
}
function sort(c: string) {
  if (c === "chart") return;
  frozen.value = [];
  emit("config", {
    ...props.view,
    sort: props.view.sort === c && props.view.direction === "asc" ? "" : c,
    direction:
      props.view.sort === c && props.view.direction === "desc" ? "asc" : "desc",
  });
}
watch(
  () => [
    props.view.sort,
    props.view.direction,
    props.rows.map((s) => s.id).join(),
  ],
  () => {
    frozen.value = [];
  },
);
function fmt(s: Security, c: string) {
  const v = value(s, c);
  if (v === null) return "—";
  if (c === "flow") return formatFlow(v) + (fundFlowErrors[s.id] ? " *" : "");
  const n = new Decimal(v);
  if (["change", "fiveDay", "turnover", "amplitude"].includes(c))
    return percent(v, ["change", "fiveDay"].includes(c));
  if (c === "volumeRatio") return n.toFixed(2);
  if (["peRatio", "pbRatio"].includes(c)) return n.toFixed(2);
  if (c === "floatCap") return n.toFixed(2);
  if (c === "volume") return n.div(10000).toFixed(2);
  if (c === "quantity") return n.toFixed(0);
  if (c === "latest") return n.toFixed(s.asset === "etf" ? 3 : 2);
  const amount = n.toNumber().toLocaleString("zh-CN", {
    minimumFractionDigits: c === "dilutedCost" ? 4 : 2,
    maximumFractionDigits: c === "dilutedCost" ? 4 : 2,
  });
  const signedAmount = [
    "dailyPnl",
    "cyclePnl",
    "totalContribution",
    "realizedContribution",
    "holdingContribution",
  ].includes(c);
  return `${signedAmount && n.toDecimalPlaces(2).gt(0) ? "+" : ""}${amount}`;
}
function tone(s: Security, c: string) {
  if (
    ![
      "latest",
      "change",
      "fiveDay",
      "dailyPnl",
      "cyclePnl",
      "flow",
      "totalContribution",
      "realizedContribution",
      "holdingContribution",
    ].includes(c)
  )
    return "";
  const v = value(s, c === "latest" ? "change" : c);
  return v === null
    ? ""
    : new Decimal(v).gt(0)
      ? "gain"
      : new Decimal(v).lt(0)
        ? "loss"
        : "flat";
}
function hint(s: Security, c: string) {
  if (
    ["marketValue", "cyclePnl", "dailyPnl", "dilutedCost"].includes(c) &&
    !hasHistory(s)
  )
    return "尚无持仓或成交记录，此项不适用";
  if (c === "flow")
    return flowHint(
      marketFundFlows[s.id],
      fundFlowErrors[s.id],
      marketQuotes[s.id]?.quoteTime,
    );
  if (c === "dailyPnl")
    return (
      props.daily[s.id]?.reason ||
      "今日收益率＝今日盈亏÷〔日初市值＋max(当日买入总支出−卖出净收入, 0)〕；基数≤0时不适用。点击核对收支与费用"
    );
  if (c === "cyclePnl")
    return "本轮收益＝市值−本轮净投入；收益率＝本轮收益÷本轮净投入。净投入≤0时收益率不适用。不是剩余仓位FIFO浮盈";
  if (c === "marketValue")
    return `持仓（可卖）：${holdingQuantity(s)} ${s.asset === "etf" ? "份" : "股"}；相等时只显示一个数值，可卖数量为估算，以券商账户为准`;
  if (c === "volume" && marketQuotes[s.id]?.volume)
    return `成交量：${marketQuotes[s.id].volume}手；表内单位为万手`;
  if (c === "dilutedCost")
    return "本轮净投入÷剩余股数（做T摊薄成本，可为负），不是FIFO成本";
  if (c === "totalContribution")
    return "累计收益贡献＝历次卖出已实现FIFO收益＋当前剩余持仓浮盈亏；组内占比按盈利组正收益或亏损组绝对亏损计算";
  if (c === "realizedContribution")
    return "该证券全部历史卖出净收入减去其匹配的FIFO成本，包含已经清仓的历史轮次";
  if (c === "holdingContribution")
    return "当前持仓浮盈亏＝当前市值−剩余FIFO持仓成本；缺少报价时不估算";
  if (c === "floatCap") return "腾讯流通市值字段（亿元），不是ETF净资产";
  if (c === "peRatio")
    return s.asset === "stock"
      ? "腾讯行情市盈率（PE）；亏损股票可能为负，可能延迟"
      : "ETF不使用股票市盈率口径";
  if (c === "pbRatio")
    return s.asset === "stock"
      ? "腾讯行情市净率（PB）；可能延迟"
      : "ETF不使用股票市净率口径";
  if (c === "activity") return "第一行量比（倍），第二行换手率（%）";
  if (c === "sizeVolume") return "第一行流通市值（亿元），第二行成交量（万手）";
  if (c === "contributionBreakdown")
    return "第一行历史已实现FIFO收益，第二行当前持仓浮盈亏";
  return (
    marketErrors[s.id] ||
    `腾讯公开行情 · ${marketQuotes[s.id]?.quoteTime ?? "未获取"} · 可能延迟`
  );
}
async function observe() {
  await nextTick();
  observer?.disconnect();
  visibleIds.clear();
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.symbol!;
        if (e.isIntersecting) visibleIds.add(id);
        else visibleIds.delete(id);
      }
      emit("visible", [...visibleIds]);
    },
    { root: root.value, rootMargin: "60px 0px" },
  );
  root.value
    ?.querySelectorAll("tr[data-symbol]")
    .forEach((row) => observer!.observe(row));
}
watch(() => props.rows.map((s) => s.id).join(), observe);
onMounted(() => {
  void observe();
  if (root.value) {
    availableWidth.value = root.value.clientWidth;
    if (typeof ResizeObserver !== "undefined") {
      sizeObserver = new ResizeObserver(() => {
        availableWidth.value = root.value?.clientWidth ?? 0;
      });
      sizeObserver.observe(root.value);
    }
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  sizeObserver?.disconnect();
  emit("visible", []);
});
</script>
<template>
  <div
    ref="root"
    class="securities-scroll"
    @pointerenter="freeze"
    @pointerleave="hovered = false"
    @focusin="freeze"
    @focusout="hovered = false"
  >
    <table class="securities-table" :style="{ width: tableWidth + 'px' }">
      <colgroup>
        <col style="width: 110px" />
        <col :style="{ width: priceWidth + 'px' }" />
        <col
          v-for="c in view.columns"
          :key="c"
          :data-column="c"
          :style="{ width: widths[c] + 'px' }"
        />
      </colgroup>
      <thead>
        <tr>
          <th class="pin-name">证券 / 代码</th>
          <th class="pin-price">
            <button aria-label="现价" @click="sort('latest')">
              现价（元）
              {{
                view.sort === "latest"
                  ? view.direction === "desc"
                    ? "↓"
                    : "↑"
                  : ""
              }}
            </button>
            <button
              v-if="(variant ?? 'holdings') === 'holdings'"
              class="header-secondary"
              aria-label="持仓成本单价"
              title="做T摊薄成本（元），点击按成本排序"
              @click="sort('dilutedCost')"
            >
              成本（元）{{
                view.sort === "dilutedCost"
                  ? view.direction === "desc"
                    ? " ↓"
                    : " ↑"
                  : ""
              }}
            </button>
          </th>
          <th
            v-for="c in view.columns"
            :key="c"
            :aria-sort="
              view.sort === c
                ? view.direction === 'desc'
                  ? 'descending'
                  : 'ascending'
                : 'none'
            "
          >
            <button
              :aria-label="columnLabels[c]"
              :title="
                c === 'marketValue'
                  ? '上行市值（元）；下行持仓（可卖），相等时只显示一个数值；股票为股、ETF为份'
                  : c === 'dailyPnl' || c === 'cyclePnl'
                    ? '上行盈亏金额（元）；下行收益率（%），点击按金额排序'
                    : columnLabels[c]
              "
              @click="sort(c)"
            >
              {{ headerText[c]?.[0] ?? columnLabels[c]
              }}{{
                view.sort === c
                  ? view.direction === "desc"
                    ? " ↓"
                    : " ↑"
                  : ""
              }}<small v-if="headerText[c]?.[1]" class="header-secondary">{{
                headerText[c][1]
              }}</small>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="s in ordered"
          :key="s.id"
          :data-symbol="s.id"
          :class="{
            selected: checked.length
              ? checked.includes(s.id)
              : selected === s.id,
          }"
          @click="selectRow(s.id, $event)"
          @contextmenu="contextRow(s.id, $event)"
          @keydown="rowKey(s.id, $event)"
          @dblclick="
            !($event.target as HTMLElement).closest('input,button') &&
            emit('detail', s.id)
          "
        >
          <td class="pin-name" :class="{ 'has-long-name': s.name.length > 10 }">
            <div class="security-title-line">
              <button
                class="security-name"
                :class="{ 'security-name-long': s.name.length > 10 }"
                :title="`${s.name} · 双击或Enter查看详情；右键或Shift+F10打开操作菜单`"
                @click.stop="selectRow(s.id, $event)"
                @dblclick.stop="emit('detail', s.id)"
                @keydown.enter.prevent="emit('detail', s.id)"
              >
                {{ s.name }}</button
              ><em
                v-if="positions[s.id]?.quantity === '0' && hasHistory(s)"
                class="security-closed"
                title="当前持仓数量为0，保留历史收益和交易记录"
                >已清仓</em
              >
            </div>
            <small class="security-meta">
              <em class="security-identity" :title="identityBadge(s).title">{{
                identityBadge(s).text
              }}</em>
              <span>{{ s.code }}</span>
              <em
                v-if="s.asset === 'etf' && s.settlement === 'T+0'"
                class="security-t0"
                title="支持当日回转交易；仍请核对该基金实际交易规则"
                >T+0</em
              >
              <small
                v-if="props.holdingDays?.[s.id]"
                class="holding-days"
                :title="`当前持仓轮次自建仓日起，按实际日K统计 ${props.holdingDays[s.id]} 个交易日`"
                >{{ props.holdingDays[s.id] }}日</small
              >
            </small>
          </td>
          <td
            class="pin-price numeric"
            :class="tone(s, 'latest')"
            :title="hint(s, 'latest')"
          >
            <span>{{ fmt(s, "latest") }}</span>
            <small
              v-if="(variant ?? 'holdings') === 'holdings'"
              class="cost-secondary"
              :title="hint(s, 'dilutedCost')"
              >{{
                new Decimal(positions[s.id]?.quantity ?? 0).gt(0)
                  ? fmt(s, "dilutedCost")
                  : "—"
              }}</small
            >
            <small
              v-if="marketQuotes[s.id] && quoteAge(marketQuotes[s.id]) > 120000"
              >延迟 / 缓存</small
            ><small v-else-if="!marketQuotes[s.id]">未获取</small>
          </td>
          <td
            v-for="c in view.columns"
            :key="c"
            class="numeric"
            :data-metric="c"
            :class="tone(s, c)"
            :title="hint(s, c)"
          >
            <MiniChart v-if="c === 'chart'" :security="s" :mode="mode" />
            <template v-else-if="c === 'change'"
              ><span>{{ fmt(s, c) }}</span
              ><small class="metric-secondary">{{
                changeAmount(s)
              }}</small></template
            >
            <template v-else-if="c === 'activity'"
              ><span>{{ fmt(s, "volumeRatio") }}</span
              ><small class="metric-secondary">{{
                fmt(s, "turnover")
              }}</small></template
            >
            <template v-else-if="c === 'sizeVolume'"
              ><span>{{ fmt(s, "floatCap") }}</span
              ><small class="metric-secondary">{{
                fmt(s, "volume")
              }}</small></template
            >
            <template v-else-if="c === 'marketValue'"
              ><span>{{ fmt(s, c) }}</span
              ><small class="holding-quantity" :title="holdingQuantity(s)">{{
                holdingQuantity(s)
              }}</small></template
            >
            <template v-else-if="c === 'cyclePnl'"
              ><span>{{ fmt(s, c) }}</span
              ><small class="metric-secondary">{{
                cyclePercent(s)
              }}</small></template
            >
            <template v-else-if="c === 'totalContribution'"
              ><span>{{ fmt(s, c) }}</span
              ><small class="metric-secondary">{{
                percent(props.contributions?.[s.id]?.share ?? null, false)
              }}</small></template
            >
            <template v-else-if="c === 'contributionBreakdown'">
              <span class="metric-composite-line"
                ><i>历</i
                ><b :class="tone(s, 'realizedContribution')">{{
                  fmt(s, "realizedContribution")
                }}</b></span
              ><small class="metric-secondary metric-composite-line"
                ><i>持</i
                ><b :class="tone(s, 'holdingContribution')">{{
                  fmt(s, "holdingContribution")
                }}</b></small
              >
            </template>
            <button
              v-else-if="c === 'dailyPnl'"
              class="pnl-link"
              @click.stop="emit('pnl', s.id)"
            >
              <span>{{ fmt(s, c) }}</span>
              <small class="metric-secondary">{{
                dailyPercent(s)
              }}</small></button
            ><template v-else>{{ fmt(s, c) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!rows.length" class="table-empty">
      <template v-if="(variant ?? 'holdings') === 'contribution'">
        <b>暂无可归类的收益贡献</b>
        <p>持仓证券需要有效报价；累计收益为0的证券不会进入盈利或亏损组。</p>
      </template>
      <template v-else>
        <b>这个视图还没有证券</b>
        <p>添加自选，或调整筛选条件。持仓由实际录入的历史记录自动生成。</p>
      </template>
    </div>
  </div>
</template>

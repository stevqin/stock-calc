<script setup lang="ts">
import { computed, ref, watch, useId, nextTick, onBeforeUnmount } from "vue";
import Decimal from "decimal.js";
import type { Entry, CashEntry } from "../sim/model";
import {
  smoothPath,
  accountTrendEvents,
  axisRangeLabels,
  groupNearbyEvents,
} from "../sim/accountTrend";
interface Day {
  date: string;
  profit: string | null;
  cumulativeProfit?: string | null;
  assets?: string | null;
  cash?: string;
  marketValue?: string | null;
  assetReasons?: string[];
}
const props = withDefaults(
  defineProps<{
    days: Day[];
    rangeStart: string;
    rangeEnd: string;
    hasRecords: boolean;
    entries?: Entry[];
    cashEntries?: CashEntry[];
    securityNames?: Record<string, string>;
  }>(),
  { entries: () => [], cashEntries: () => [], securityNames: () => ({}) },
);
const showProfit = ref(true),
  showAssets = ref(false);
const hasVisibleSeries = computed(() => showProfit.value || showAssets.value);
const profitMode = ref<"cumulative" | "interval">("cumulative");
const modeLabel = computed(() =>
  profitMode.value === "cumulative" ? "累计盈亏" : "区间盈亏",
);
const helpId = useId();
const positiveClipId = `${helpId}-positive`;
const negativeClipId = `${helpId}-negative`;
const activeIndex = ref<number | null>(null),
  pinned = ref(false);
const inputMode = ref<"pointer" | "keyboard">("pointer");
const stage = ref<HTMLElement>();
const plotWidth = ref(400);
let pointerPosition: { x: number; y: number } | null = null;
const tooltipStyle = ref<Record<string, string>>({});
const tooltip = ref<HTMLElement>();
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let moveTimer: ReturnType<typeof setTimeout> | undefined;
function cancelMove() {
  if (moveTimer !== undefined) clearTimeout(moveTimer);
  moveTimer = undefined;
}
function keepOpen() {
  if (closeTimer !== undefined) clearTimeout(closeTimer);
  closeTimer = undefined;
}
function leaveSurface() {
  cancelMove();
  keepOpen();
  if (!pinned.value) closeTimer = setTimeout(clear, 200);
}
onBeforeUnmount(() => {
  keepOpen();
  cancelMove();
});
watch(tooltip, (element, _previous, onCleanup) => {
  if (!element || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(positionTooltip);
  observer.observe(element);
  onCleanup(() => observer.disconnect());
});
function positionTooltip() {
  const box = stage.value?.getBoundingClientRect();
  if (!box || typeof window === "undefined") return;
  const width = Math.min(360, window.innerWidth - 24);
  const maxHeight = window.innerHeight - 24;
  const height = Math.min(tooltip.value?.scrollHeight || 280, maxHeight);
  const x =
    pointerPosition?.x ??
    box.left + ((selected.value?.x ?? 0) / 1000) * box.width;
  const y =
    pointerPosition?.y ??
    box.top + ((selected.value?.y ?? 28) / 280) * box.height;
  const left =
    x + width + 16 <= window.innerWidth - 12 ? x + 16 : x - width - 16;
  tooltipStyle.value = {
    left: `${Math.max(12, Math.min(window.innerWidth - width - 12, left))}px`,
    top: `${Math.max(12, Math.min(window.innerHeight - height - 12, y + 16))}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  };
}
watch(stage, (element, _previous, onCleanup) => {
  if (!element) return;
  const measure = () => {
    plotWidth.value = element.getBoundingClientRect().width || 400;
  };
  measure();
  window.addEventListener("resize", positionTooltip);
  window.addEventListener("scroll", positionTooltip, true);
  const observer =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(measure);
  observer?.observe(element);
  onCleanup(() => {
    window.removeEventListener("resize", positionTooltip);
    window.removeEventListener("scroll", positionTooltip, true);
    observer?.disconnect();
  });
});
const events = computed(() =>
  accountTrendEvents(props.entries, props.cashEntries),
);
function scale(values: number[], zero: boolean) {
  if (!values.length) return { min: -1, max: 1, y: (_value: number) => 108 };
  let min = Math.min(...values, ...(zero ? [0] : [])),
    max = Math.max(...values, ...(zero ? [0] : []));
  if (min === max) {
    const pad = Math.max(Math.abs(max) * 0.01, 1);
    min -= pad;
    max += pad;
  }
  return {
    min,
    max,
    y: (value: number) => 188 - ((value - min) / (max - min)) * 160,
  };
}
const chart = computed(() => {
  let total = new Decimal(0),
    missingHistory = false;
  const lifetime = props.days.map((day) => {
    if (day.profit === null) missingHistory = true;
    if (!missingHistory) total = total.plus(day.profit!);
    return day.cumulativeProfit !== undefined
      ? day.cumulativeProfit
      : missingHistory
        ? null
        : total.toFixed(2);
  });
  const baseline = lifetime[0] ?? null;
  const points = props.days.map((day, i) => ({
    ...day,
    value:
      profitMode.value === "cumulative"
        ? lifetime[i]
        : baseline === null || lifetime[i] === null
          ? null
          : new Decimal(lifetime[i]!).minus(baseline).toFixed(2),
    assets: day.assets ?? null,
    x: props.days.length === 1 ? 500 : (i / (props.days.length - 1)) * 1000,
    events: events.value.get(day.date),
  }));
  const profitValues = points.flatMap((p) =>
    p.value === null ? [] : [Number(p.value)],
  );
  const assetValues = points.flatMap((p) =>
    p.assets === null ? [] : [Number(p.assets)],
  );
  const profitScale = scale(profitValues, true),
    assetScale = scale(assetValues, false);
  const located = points.map((p) => ({
    ...p,
    y: p.value === null ? null : profitScale.y(Number(p.value)),
    assetY: p.assets === null ? null : assetScale.y(Number(p.assets)),
  }));
  return {
    points: located,
    profitScale,
    assetScale,
    profitKnown: profitValues.length > 0,
    assetKnown: assetValues.length > 0,
    zero: profitScale.y(0),
    missing: points.some((point) => point.value === null),
    assetMissing: points.some((p) => p.assets === null),
    path: smoothPath(located),
    assetPath: smoothPath(located.map((p) => ({ x: p.x, y: p.assetY }))),
  };
});
const isolatedPoints = computed(() =>
  chart.value.points.flatMap((point, index) =>
    (["y", "assetY"] as const).flatMap((key) => {
      if (key === "assetY" ? !showAssets.value : !showProfit.value) return [];
      const y = point[key];
      if (
        y === null ||
        (index > 0 && chart.value.points[index - 1][key] !== null) ||
        (index < chart.value.points.length - 1 &&
          chart.value.points[index + 1][key] !== null)
      )
        return [];
      return [
        {
          x: point.x,
          y,
          asset: key === "assetY",
          date: point.date,
          value: point.value,
        },
      ];
    }),
  ),
);
const selected = computed(
  () => chart.value.points[activeIndex.value ?? chart.value.points.length - 1],
);
const interactive = computed(
  () => props.hasRecords && chart.value.points.length > 0,
);
const pointVisible = computed(
  () =>
    showProfit.value &&
    selected.value?.y != null &&
    (activeIndex.value !== null || chart.value.points.length === 1),
);
const assetPointVisible = computed(
  () =>
    showAssets.value &&
    selected.value?.assetY != null &&
    (activeIndex.value !== null || chart.value.points.length === 1),
);
const eventPoints = computed(() =>
  chart.value.points
    .map((point, index) => ({ ...point, index }))
    .filter((point) => point.events),
);
function money(value: string | null | undefined, signed = true) {
  if (value == null) return "数据不足";
  const number = new Decimal(value);
  return (signed && number.gt(0) ? "+" : "") + number.toFixed(2);
}
function tone(value: string | null | undefined) {
  if (value == null) return "";
  return new Decimal(value).gt(0)
    ? "gain"
    : new Decimal(value).lt(0)
      ? "loss"
      : "";
}
const profitLabels = computed(() =>
  axisRangeLabels(chart.value.profitScale.min, chart.value.profitScale.max),
);
const assetLabels = computed(() =>
  axisRangeLabels(chart.value.assetScale.min, chart.value.assetScale.max),
);
const axisWidths = computed(() => ({
  "--profit-axis-width": `${Math.min(110, Math.max(44, ...Object.values(profitLabels.value).map((label) => label.length * 6 + 12)))}px`,
  "--asset-axis-width": `${Math.min(110, Math.max(44, ...Object.values(assetLabels.value).map((label) => label.length * 6 + 12)))}px`,
}));
const markerGroups = computed(() =>
  (["trade", "transfer"] as const)
    .filter((kind) => (kind === "trade" ? showProfit.value : showAssets.value))
    .flatMap((kind) =>
      groupNearbyEvents(
        eventPoints.value.filter((point) =>
          kind === "trade"
            ? point.events?.trades.length
            : point.events?.transfers.length,
        ),
        plotWidth.value,
        kind === "transfer" ? 40 : 24,
        // Thin only the painted labels; each marker and tooltip still describes one day.
      ).map((points) => ({ kind, point: points[0] })),
    ),
);
watch([activeIndex, plotWidth, pinned, () => selected.value], positionTooltip, {
  flush: "post",
});
function selectMarker(group: (typeof markerGroups.value)[number]) {
  selectEvent(group.point.index);
}
function markerTitle(group: (typeof markerGroups.value)[number]) {
  return group.kind === "trade"
    ? tradeTitle(group.point)
    : transferTitle(group.point);
}

function move(event: PointerEvent) {
  keepOpen();
  if (pinned.value) return;
  const box = stage.value?.getBoundingClientRect();
  if (!box?.width || !interactive.value || !hasVisibleSeries.value) return;
  inputMode.value = "pointer";
  pointerPosition = { x: event.clientX, y: event.clientY ?? box.top };
  positionTooltip();
  const index = Math.round(
    Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) *
      (chart.value.points.length - 1),
  );
  cancelMove();
  if (index === activeIndex.value) return;
  const apply = () => {
    activeIndex.value = index;
    moveTimer = undefined;
  };
  // A short mouse dwell avoids replacing the date while crossing toward its tooltip.
  if (event.pointerType === "mouse" && activeIndex.value !== null)
    moveTimer = setTimeout(apply, 60);
  else apply();
}
function moveOverTooltip(event: PointerEvent) {
  keepOpen();
  if (pinned.value) return;
  const box = stage.value?.parentElement?.getBoundingClientRect();
  if (
    box &&
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom
  )
    move(event);
}
function pointerDown(event: PointerEvent) {
  if ((event.target as HTMLElement).closest("button")) return;
  pinned.value = false;
  move(event);
  if (event.pointerType === "touch") pinned.value = true;
}
function reset() {
  cancelMove();
  keepOpen();
  pinned.value = false;
  activeIndex.value = null;
  pointerPosition = null;
}
function clear() {
  if (!pinned.value) {
    activeIndex.value = null;
  }
}
function selectEvent(index: number) {
  cancelMove();
  keepOpen();
  activeIndex.value = index;
  pinned.value = true;
  inputMode.value = "keyboard";
}
function chartEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || (activeIndex.value === null && !pinned.value))
    return;
  event.preventDefault();
  event.stopPropagation();
  reset();
  void nextTick(() => stage.value?.focus({ preventScroll: true }));
}
function keys(event: KeyboardEvent) {
  cancelMove();
  if (
    !interactive.value ||
    !hasVisibleSeries.value ||
    !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)
  )
    return;
  event.preventDefault();
  inputMode.value = "keyboard";
  pointerPosition = null;
  pinned.value = false;
  const last = chart.value.points.length - 1;
  if (event.key === "Escape") reset();
  else if (event.key === "Home") activeIndex.value = 0;
  else if (event.key === "End") activeIndex.value = last;
  else
    activeIndex.value = Math.max(
      0,
      Math.min(
        last,
        (activeIndex.value ?? last) + (event.key === "ArrowLeft" ? -1 : 1),
      ),
    );
}
function tradeLabel(point: (typeof chart.value.points)[number]) {
  const entries = point.events?.trades.flatMap((group) => group.entries) ?? [];
  const buy = entries.some((entry) => entry.kind === "buy");
  const sell = entries.some((entry) => entry.kind === "sell");
  return buy && sell ? "T" : buy ? "B" : sell ? "S" : "";
}
function transferLabel(point: (typeof chart.value.points)[number]) {
  const flows = point.events?.transfers ?? [];
  const incoming = flows.some((flow) => flow.kind === "deposit");
  const outgoing = flows.some((flow) => flow.kind === "withdraw");
  return incoming && outgoing ? "入/出" : incoming ? "入" : "出";
}
function tradeTitle(point: (typeof chart.value.points)[number]) {
  return `${point.date} ${point.events?.trades.map((group) => `${group.label} ${props.securityNames[group.securityId] ?? group.securityId} ${group.entries.length}笔`).join("；")}${point.value === null ? "；该日区间盈亏数据不足，标记列于事件栏" : ""}`;
}
function transferTitle(point: (typeof chart.value.points)[number]) {
  return `${point.date} ${point.events?.transfers.map((flow) => `${flow.kind === "deposit" ? "转入" : "转出"} ${money(flow.amount, false)}元`).join("；")}${point.assets === null ? "；该日资产估值不足，标记列于事件栏" : ""}`;
}
function time(raw: string) {
  return new Date(raw).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
watch(
  [
    () => props.days.map((day) => day.date).join("|"),
    () => props.rangeStart,
    () => props.rangeEnd,
    () => props.hasRecords,
    profitMode,
    showProfit,
    showAssets,
  ],
  reset,
);
</script>
<template>
  <section
    class="pnl-panel pnl-profit-panel"
    aria-label="区间盈亏走势"
    :style="axisWidths"
    @keydown.capture="chartEscape"
  >
    <header>
      <h3>区间盈亏走势</h3>
      <div
        class="pnl-profit-mode"
        :style="{ visibility: showProfit ? 'visible' : 'hidden' }"
        role="group"
        aria-label="盈亏曲线统计口径"
      >
        <button
          v-for="mode in ['cumulative', 'interval'] as const"
          :key="mode"
          type="button"
          :data-profit-mode="mode"
          :aria-pressed="profitMode === mode"
          @click="profitMode = mode"
        >
          {{ mode === "cumulative" ? "累计盈亏" : "区间盈亏" }}
        </button>
      </div>
    </header>
    <template v-if="interactive">
      <div class="pnl-trend-legend">
        <button
          type="button"
          data-series-toggle="profit"
          class="profit-series"
          :aria-pressed="showProfit"
          @click="showProfit = !showProfit"
          title="点击显示或隐藏盈亏"
        >
          {{ modeLabel }} · 左轴（红盈绿亏）
        </button>
        <button
          type="button"
          data-series-toggle="assets"
          class="asset-series"
          :aria-pressed="showAssets"
          @click="showAssets = !showAssets"
          title="点击显示或隐藏总资产"
        >
          账面总资产 · 右轴
        </button>
      </div>
      <div
        class="pnl-profit-figure"
        @pointermove="move"
        @pointerdown="pointerDown"
        @pointerenter="
          cancelMove();
          keepOpen();
        "
        @pointerleave="leaveSurface"
      >
        <div
          class="pnl-profit-axis"
          :style="{ visibility: showProfit ? 'visible' : 'hidden' }"
          aria-hidden="true"
        >
          <span>{{ chart.profitKnown ? profitLabels.max : "—" }}</span
          ><span>{{ chart.profitKnown ? profitLabels.min : "—" }}</span
          ><span
            v-if="chart.profitScale.min < 0 && chart.profitScale.max > 0"
            class="pnl-zero-label"
            :style="{ top: `${chart.zero / 2.8}%` }"
            >0</span
          >
        </div>
        <div
          ref="stage"
          class="pnl-profit-plot"
          data-profit-plot
          tabindex="0"
          role="group"
          aria-label="盈亏与账面总资产曲线，使用左右方向键查看每日数据"
          :aria-describedby="helpId"
          @blur="leaveSurface"
          @keydown="keys"
        >
          <span v-if="!hasVisibleSeries" class="pnl-series-empty"
            >点击图例，选择要显示的走势</span
          >
          <svg
            v-show="hasVisibleSeries"
            viewBox="0 0 1000 280"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <clipPath :id="positiveClipId" clipPathUnits="userSpaceOnUse">
                <rect
                  data-positive-clip
                  x="-4"
                  y="0"
                  width="1008"
                  :height="chart.zero"
                />
              </clipPath>
              <clipPath :id="negativeClipId" clipPathUnits="userSpaceOnUse">
                <rect
                  data-negative-clip
                  x="-4"
                  :y="chart.zero"
                  width="1008"
                  :height="280 - chart.zero"
                />
              </clipPath>
            </defs>
            <line x1="0" x2="1000" y1="28" y2="28" class="pnl-profit-grid" />
            <line x1="0" x2="1000" y1="188" y2="188" class="pnl-profit-grid" />
            <line
              v-if="showProfit"
              x1="0"
              x2="1000"
              :y1="chart.zero"
              :y2="chart.zero"
              class="pnl-profit-zero"
            />
            <path
              v-if="showAssets && chart.assetPath"
              data-asset-curve
              :d="chart.assetPath"
              class="pnl-asset-curve"
            />
            <path
              v-if="showProfit && chart.path"
              data-profit-curve
              data-profit-positive
              :d="chart.path"
              :clip-path="`url(#${positiveClipId})`"
              class="pnl-profit-curve pnl-profit-positive"
            />
            <path
              v-if="showProfit && chart.path"
              data-profit-negative
              :d="chart.path"
              :clip-path="`url(#${negativeClipId})`"
              class="pnl-profit-curve pnl-profit-negative"
            />
          </svg>
          <span
            v-for="point in isolatedPoints"
            :key="point.date + point.asset"
            class="pnl-isolated-dot"
            :class="[
              { 'is-asset': point.asset },
              point.asset ? '' : tone(point.value),
            ]"
            :style="{ left: `${point.x / 10}%`, top: `${point.y / 2.8}%` }"
            aria-hidden="true"
          ></span>
          <span
            v-if="activeIndex !== null"
            data-profit-crosshair
            class="pnl-profit-crosshair"
            :style="{ left: `${(selected?.x ?? 0) / 10}%` }"
            aria-hidden="true"
          ></span>
          <span
            v-if="pointVisible"
            data-profit-dot
            class="pnl-profit-dot"
            :class="tone(selected?.value)"
            :style="{
              left: `${(selected?.x ?? 0) / 10}%`,
              top: `${(selected?.y ?? 0) / 2.8}%`,
            }"
            aria-hidden="true"
          ></span>
          <span
            v-if="assetPointVisible"
            data-asset-dot
            class="pnl-profit-dot pnl-asset-dot"
            :style="{
              left: `${(selected?.x ?? 0) / 10}%`,
              top: `${(selected?.assetY ?? 0) / 2.8}%`,
            }"
            aria-hidden="true"
          ></span>
          <button
            v-for="group in markerGroups"
            :key="group.kind + group.point.date"
            type="button"
            class="pnl-trend-event"
            :class="[
              group.kind === 'trade'
                ? 'pnl-trade-marker'
                : 'pnl-transfer-marker',
              {
                'is-unvalued':
                  group.kind === 'trade'
                    ? group.point.y === null
                    : group.point.assetY === null,
              },
            ]"
            :data-trade-marker="group.kind === 'trade' ? '' : undefined"
            :data-transfer-marker="group.kind === 'transfer' ? '' : undefined"
            :style="{
              left: `${group.point.x / 10}%`,
              top: `${(group.kind === 'trade' ? (group.point.y ?? 224) : (group.point.assetY ?? 252)) / 2.8}%`,
            }"
            :aria-label="markerTitle(group) + '，查看明细'"
            @pointerenter="move($event)"
            @pointermove.stop="move($event)"
            @focus="selectMarker(group)"
            @click.stop="selectMarker(group)"
          >
            {{
              group.kind === "trade"
                ? tradeLabel(group.point)
                : transferLabel(group.point)
            }}
          </button>
        </div>
        <div
          class="pnl-profit-axis pnl-asset-axis"
          :style="{ visibility: showAssets ? 'visible' : 'hidden' }"
          aria-hidden="true"
        >
          <span>{{ chart.assetKnown ? assetLabels.max : "—" }}</span
          ><span>{{ chart.assetKnown ? assetLabels.min : "—" }}</span>
        </div>
      </div>
      <div class="pnl-profit-dates" aria-label="实际绘图日期">
        <span>{{ chart.points[0]?.date }}</span
        ><span>{{ chart.points.at(-1)?.date }}</span>
      </div>
      <div class="pnl-trend-event-key">
        <span v-if="showProfit">B 仅买入 · S 仅卖出 · T 当日有买有卖</span
        ><span v-if="showAssets">入 转入 · 出 转出</span>
      </div>
      <aside
        v-if="activeIndex !== null"
        ref="tooltip"
        data-trend-tooltip
        class="pnl-trend-tooltip"
        @pointermove="moveOverTooltip"
        @pointerenter="
          cancelMove();
          keepOpen();
        "
        @pointerleave="leaveSurface"
        @focusin="keepOpen"
        @focusout="leaveSurface"
        :class="{ 'is-pinned': pinned }"
        :style="tooltipStyle"
        :aria-live="inputMode === 'keyboard' ? 'polite' : 'off'"
        :role="pinned ? 'region' : 'tooltip'"
        aria-label="当日盈亏、资产与交易详情"
      >
        <header>
          <strong data-profit-date>{{ selected?.date }}</strong>
          <button type="button" @click="reset" aria-label="关闭日期详情">
            ×
          </button>
        </header>
        <dl v-if="showProfit" class="pnl-tooltip-amounts">
          <div class="pnl-tooltip-primary">
            <dt>{{ modeLabel }}</dt>
            <dd data-period-profit :class="tone(selected?.value)">
              {{ money(selected?.value)
              }}<small v-if="selected?.value != null"> 元</small>
            </dd>
          </div>
          <div>
            <dt>当日盈亏</dt>
            <dd data-daily-profit :class="tone(selected?.profit)">
              {{ money(selected?.profit)
              }}<small v-if="selected?.profit != null"> 元</small>
            </dd>
          </div>
        </dl>
        <section
          v-if="showAssets"
          class="pnl-tooltip-assets"
          :class="{ 'is-only-series': !showProfit }"
        >
          <dl class="pnl-tooltip-amounts">
            <div>
              <dt>账面总资产</dt>
              <dd data-book-assets class="pnl-book-assets">
                {{ money(selected?.assets, false)
                }}<small v-if="selected?.assets != null"> 元</small>
              </dd>
            </div>
            <div v-if="selected?.cash !== undefined">
              <dt>现金余额</dt>
              <dd>{{ money(selected.cash, false) }} 元</dd>
            </div>
            <div v-if="selected?.marketValue !== undefined">
              <dt>持仓市值</dt>
              <dd>{{ money(selected.marketValue, false) }} 元</dd>
            </div>
          </dl>
        </section>
        <p
          class="pnl-tooltip-basis"
          v-if="showProfit && profitMode === 'interval'"
        >
          期初：{{ chart.points[0]?.date }} 首日日终<br />期初资产
          {{ money(chart.points[0]?.assets, false) }}
          元；盈亏扣除后续转入转出，首日不计入。
        </p>
        <p class="pnl-tooltip-basis" v-else-if="showProfit">
          账本起点以来的累计盈亏，已扣除转入转出及持仓成本。
        </p>
        <p
          v-if="showAssets && selected?.assetReasons?.length"
          class="pnl-tooltip-note"
        >
          {{ selected.assetReasons.join("；") }}
        </p>
        <div
          v-if="
            selected?.events &&
            ((showProfit && selected.events.trades.length) ||
              (showAssets && selected.events.transfers.length))
          "
          data-day-events
          class="pnl-day-events"
        >
          <header>
            <strong>当日流水</strong
            ><small>{{
              showProfit && selected.events.trades.length
                ? "价格 / 元 · 数量 / 股或份"
                : "金额 / 元"
            }}</small>
          </header>
          <div class="pnl-day-event-scroll">
            <div
              v-for="group in showProfit ? selected.events.trades : []"
              :key="group.securityId"
              class="pnl-day-event-group"
            >
              <strong>{{
                securityNames[group.securityId] ?? group.securityId
              }}</strong>
              <div
                v-for="entry in group.entries"
                :key="entry.id"
                class="pnl-trade-row"
              >
                <time>{{ time(entry.time).slice(0, 5) }}</time>
                <span :class="entry.kind === 'buy' ? 'gain' : 'loss'">{{
                  entry.kind === "buy" ? "买入" : "卖出"
                }}</span>
                <b>{{ entry.price }}</b
                ><span>× {{ entry.quantity }}</span>
              </div>
            </div>
            <div
              v-for="flow in showAssets ? selected.events.transfers : []"
              :key="flow.id"
              class="pnl-transfer-row"
            >
              <time>{{ time(flow.time).slice(0, 5) }}</time
              ><span>{{ flow.kind === "deposit" ? "转入" : "转出" }}</span>
              <b>{{ money(flow.amount, false) }} 元</b
              ><small v-if="flow.note">{{ flow.note }}</small>
            </div>
          </div>
        </div>
      </aside>
      <p :id="helpId" class="pnl-profit-help">
        悬停查看金额与流水，点击标记固定详情。资产＝现金＋持仓市值。
      </p>
      <p v-if="showProfit && chart.missing" class="pnl-note">
        {{
          profitMode === "interval"
            ? "期初或当日估值不足时，区间盈亏保留断点。"
            : "缺少当日持仓估值时，累计盈亏保留断点。"
        }}
      </p>
      <p v-if="showAssets && chart.assetMissing" class="pnl-note">
        资产估值缺失处保留断点，悬停查看缺失原因。
      </p>
    </template>
    <p v-else class="pnl-empty">暂无区间盈亏走势数据</p>
  </section>
</template>
<style scoped src="./period-profit-chart.css"></style>

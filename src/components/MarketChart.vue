<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import * as echarts from "echarts/core";
import {
  CandlestickChart,
  LineChart,
  BarChart,
  CustomChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  chartSeries,
  intradayAxisLabel,
  type ChartData,
  type ChartMode,
} from "../sim/chart";
import type { Security, Entry } from "../sim/model";
import { tradeMarkers, type TradeMarker } from "../sim/tradeMarkers";
import { getChart, liveDaily, marketQuotes } from "../market";
import { MARKET_COLORS, marketColor } from "../marketTheme";
echarts.use([
  CandlestickChart,
  LineChart,
  BarChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  CanvasRenderer,
]);
const props = defineProps<{
  security: Security;
  mode: ChartMode;
  trades?: Entry[];
}>();
const el = ref<HTMLElement>();
const error = ref("");
const loading = ref(false);
const meta = ref("");
const markedCount = ref(0);
const snapshot = ref<
  { label: string; value: string; tone?: "gain" | "loss" | "flat" }[]
>([]);
let latestData: ChartData | undefined;
let chart: echarts.ECharts | undefined,
  observer: ResizeObserver | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  generation = 0,
  busy = false,
  disposed = false;
const n = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const signed = (value: number, digits = 2, suffix = "") =>
  Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`
    : "—";
const volumeText = (value: number) =>
  !Number.isFinite(value)
    ? "—"
    : value >= 10000
      ? `${(value / 10000).toFixed(2)}万手`
      : `${Math.round(value)}手`;
function tone(value: number): "gain" | "loss" | "flat" {
  return value > 0 ? "gain" : value < 0 ? "loss" : "flat";
}
function tradeLines(markers: TradeMarker[], index: number) {
  const entries = markers
    .filter((marker) => marker.index === index)
    .flatMap((marker) => marker.trades)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!entries.length) return [];
  return [
    "──────── 交易记录 ────────",
    ...entries.map((entry) => {
      const time = new Date(entry.time).toLocaleTimeString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${entry.kind === "buy" ? "B 买入" : "S 卖出"}  ${time}  ${entry.price}元 × ${entry.quantity}`;
    }),
  ];
}
function tooltipText(
  params: unknown,
  d: ChartData,
  line: ReturnType<typeof chartSeries>,
  markers: TradeMarker[],
) {
  const list = Array.isArray(params) ? params : [params];
  const primary = list.find((item) =>
    ["line", "candlestick"].includes(
      String((item as { seriesType?: string })?.seriesType),
    ),
  ) as { dataIndex?: number; axisValue?: string } | undefined;
  const index = Number(primary?.dataIndex ?? 0);
  if (!Number.isInteger(index) || index < 0) return "";
  const trades = tradeLines(markers, index);
  if (d.mode === "daily" || d.mode === "daily-raw") {
    const bar = d.bars[index];
    if (!bar) return "";
    const previous = Number(d.bars[index - 1]?.close ?? bar.open);
    const close = Number(bar.close);
    const change = close - previous;
    const percent = previous > 0 ? (change / previous) * 100 : NaN;
    const amplitude =
      previous > 0
        ? ((Number(bar.high) - Number(bar.low)) / previous) * 100
        : NaN;
    return [
      bar.date,
      `开盘  ${n(Number(bar.open))}    最高  ${n(Number(bar.high))}`,
      `收盘  ${n(close)}    最低  ${n(Number(bar.low))}`,
      `涨跌  ${signed(change)}    涨跌幅  ${signed(percent, 2, "%")}`,
      `振幅  ${n(amplitude)}%    成交量  ${volumeText(Number(bar.volume))}`,
      ...trades,
    ].join("\n");
  }
  const price = Number(line.price[index]);
  const baselineValue = Number(line.baseline[index]);
  const baseline =
    baselineValue > 0
      ? baselineValue
      : Number(line.price.find((value) => value !== null) ?? price);
  const change = price - baseline;
  const percent = baseline > 0 ? (change / baseline) * 100 : NaN;
  return [
    primary?.axisValue ?? line.labels[index] ?? "",
    `价格  ${n(price, props.security.asset === "etf" ? 3 : 2)}    涨跌  ${signed(change, props.security.asset === "etf" ? 3 : 2)}`,
    `涨跌幅  ${signed(percent, 2, "%")}    均价  ${line.average[index] == null ? "—" : n(Number(line.average[index]), props.security.asset === "etf" ? 3 : 2)}`,
    `分钟量  ${volumeText(Number(line.volume[index]))}`,
    ...trades,
  ].join("\n");
}
function updateSnapshot(d: ChartData) {
  if (d.mode === "daily" || d.mode === "daily-raw") {
    snapshot.value = [];
    return;
  }
  const session = d.sessions.at(-1);
  const points = session?.points ?? [];
  const prices = points
    .map((point) => Number(point.price))
    .filter(Number.isFinite);
  if (!session || !prices.length) {
    snapshot.value = [];
    return;
  }
  const open = prices[0],
    close = prices.at(-1)!,
    previous = Number(session.previousClose),
    change = close - previous,
    percent = previous > 0 ? (change / previous) * 100 : NaN,
    digits = props.security.asset === "etf" ? 3 : 2;
  snapshot.value = [
    {
      label: "日期",
      value: `${session.date.slice(4, 6)}-${session.date.slice(6)}`,
    },
    { label: "开盘", value: n(open, digits) },
    { label: "最高", value: n(Math.max(...prices), digits), tone: "gain" },
    { label: "最低", value: n(Math.min(...prices), digits), tone: "loss" },
    { label: "收盘 / 最新", value: n(close, digits), tone: tone(change) },
    { label: "昨收", value: n(previous, digits) },
    { label: "涨跌幅", value: signed(percent, 2, "%"), tone: tone(change) },
    { label: "成交量", value: volumeText(Number(points.at(-1)?.volume)) },
  ];
}
function draw(d: ChartData) {
  if (!chart) return;
  latestData = d;
  const markers = tradeMarkers(d, props.trades ?? []);
  markedCount.value = markers.reduce((sum, m) => sum + m.trades.length, 0);
  const daily = d.mode === "daily" || d.mode === "daily-raw";
  const markerSides = props.trades
    ? daily
      ? (["buy", "sell", "t"] as const)
      : (["buy", "sell"] as const)
    : [];
  const markerSeries = markerSides.map((side) => ({
    name: side === "t" ? "T 同日买卖" : side === "buy" ? "B 买入" : "S 卖出",
    type: "custom" as const,
    z: 10,
    clip: false,
    encode: { x: 0, y: 1 },
    tooltip: { show: false },
    renderItem: (
      _params: unknown,
      api: {
        value: (index: number) => number;
        coord: (value: number[]) => number[];
      },
    ) => {
      const point = api.coord([api.value(0), api.value(1)]);
      const direction = side === "buy" ? 1 : -1;
      const badgeY = point[1] + direction * 32;
      const color =
        side === "t"
          ? "#3268cf"
          : side === "buy"
            ? MARKET_COLORS.gain
            : MARKET_COLORS.loss;
      return {
        type: "group",
        children: [
          {
            type: "line",
            shape: { x1: point[0], y1: point[1], x2: point[0], y2: badgeY },
            style: { stroke: color, lineWidth: 1.5 },
          },
          {
            type: "circle",
            shape: { cx: point[0], cy: point[1], r: 2.5 },
            style: { fill: "#fff", stroke: color, lineWidth: 1.5 },
          },
          {
            type: "circle",
            shape: { cx: point[0], cy: badgeY, r: 10 },
            style: { fill: color, stroke: "#fff", lineWidth: 1.5 },
          },
          {
            type: "text",
            style: {
              x: point[0],
              y: badgeY,
              text: side === "t" ? "T" : side === "buy" ? "B" : "S",
              fill: "#fff",
              font: "700 11px -apple-system, PingFang SC, sans-serif",
              align: "center",
              verticalAlign: "middle",
            },
          },
        ],
      };
    },
    data: markers
      .filter((m) => m.side === side)
      .map((marker) => ({ value: [marker.index, marker.anchor], marker })),
  }));
  const line = chartSeries(d);
  const labels = daily ? d.bars.map((b) => b.date) : line.labels;
  const priceDigits = props.security.asset === "etf" ? 3 : 2;
  updateSnapshot(d);
  const priceColor = marketColor(
    Number(line.price.filter((v) => v !== null).at(-1)) -
      Number(line.baseline.filter((v) => v !== null).at(-1)),
  );
  if (!labels.length) throw new Error("当前周期暂无数据");
  const axes = [0, 1].map((gridIndex) => ({
    type: "category",
    gridIndex,
    data: labels,
    boundaryGap: daily,
    axisLine: { lineStyle: { color: "#dce4ef" } },
    axisLabel: {
      color: "#8391a5",
      show: gridIndex === 1,
      hideOverlap: daily,
      showMinLabel: true,
      showMaxLabel: true,
      fontSize: 10,
      margin: 6,
      ...(!daily
        ? {
            interval: (_index: number, value: string) =>
              Boolean(intradayAxisLabel(value, d.mode)),
            formatter: (value: string) => intradayAxisLabel(value, d.mode),
          }
        : {}),
    },
    axisTick: { show: false },
  }));
  const visiblePrices = line.price.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const baselineCandidate = Number(
    d.sessions.at(-1)?.previousClose ??
      [...line.baseline].reverse().find((value) => value !== null),
  );
  const ratioBaseline =
    baselineCandidate > 0 ? baselineCandidate : (visiblePrices[0] ?? 1);
  const maxDeviation = Math.max(
    ...visiblePrices.map((value) => Math.abs(value - ratioBaseline)),
    ratioBaseline * 0.005,
  );
  const priceRange =
    !daily && ratioBaseline > 0
      ? {
          min: ratioBaseline - maxDeviation * 1.08,
          max: ratioBaseline + maxDeviation * 1.08,
        }
      : {};
  chart.setOption(
    {
      animation: false,
      color: [priceColor, "#c6923c", "#aeb9c9"],
      legend: {
        top: 4,
        left: 12,
        textStyle: { fontSize: 11, color: "#7e8b9e" },
      },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        confine: true,
        backgroundColor: "rgba(255,255,255,0.97)",
        borderColor: "#dce4ef",
        borderWidth: 1,
        padding: [9, 11],
        textStyle: {
          color: "#203149",
          fontFamily: "SF Mono, Menlo, monospace",
          fontSize: 11,
          lineHeight: 18,
        },
        axisPointer: { type: "cross", snap: true },
        formatter: (params: unknown) => tooltipText(params, d, line, markers),
      },
      grid: [
        { left: 64, right: daily ? 20 : 64, top: 32, bottom: daily ? 88 : 64 },
        {
          left: 64,
          right: daily ? 20 : 64,
          bottom: daily ? 38 : 22,
          height: 30,
        },
      ],
      xAxis: axes,
      yAxis: [
        {
          scale: true,
          splitNumber: 3,
          ...priceRange,
          splitLine: { lineStyle: { color: "#edf1f6" } },
          axisLabel: {
            color: "#8391a5",
            formatter: (value: number) => n(value, priceDigits),
          },
          axisPointer: {
            label: {
              formatter: ({ value }: { value: number }) =>
                n(Number(value), priceDigits),
            },
          },
        },
        ...(!daily
          ? [
              {
                scale: true,
                position: "right",
                min: priceRange.min,
                max: priceRange.max,
                splitNumber: 3,
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: {
                  color: "#8391a5",
                  formatter: (value: number) =>
                    signed(
                      ((value - ratioBaseline) / ratioBaseline) * 100,
                      2,
                      "%",
                    ),
                },
                axisPointer: {
                  label: {
                    formatter: ({ value }: { value: number }) =>
                      signed(
                        ((Number(value) - ratioBaseline) / ratioBaseline) * 100,
                        2,
                        "%",
                      ),
                  },
                },
              },
            ]
          : []),
        {
          gridIndex: 1,
          splitNumber: 1,
          axisLabel: {
            color: "#8391a5",
            formatter: (v: number) =>
              v >= 10000
                ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万`
                : Math.round(v).toLocaleString("zh-CN"),
          },
          splitLine: { show: false },
        },
      ],
      dataZoom: daily
        ? [
            { type: "inside", xAxisIndex: [0, 1], start: 65, end: 100 },
            {
              type: "slider",
              xAxisIndex: [0, 1],
              bottom: 0,
              height: 14,
              start: 65,
              end: 100,
              borderColor: "#edf1f6",
            },
          ]
        : [],
      series: [
        ...(daily
          ? [
              {
                name: "日K",
                type: "candlestick",
                data: d.bars.map((b) => ({
                  value: [+b.open, +b.close, +b.low, +b.high],
                  itemStyle: {
                    color: marketColor(+b.close - +b.open),
                    color0: marketColor(+b.close - +b.open),
                    borderColor: marketColor(+b.close - +b.open),
                    borderColor0: marketColor(+b.close - +b.open),
                  },
                })),
                itemStyle: {
                  color: MARKET_COLORS.gain,
                  color0: MARKET_COLORS.loss,
                  borderColor: MARKET_COLORS.gain,
                  borderColor0: MARKET_COLORS.loss,
                },
              },
              {
                name: "成交量（手）",
                type: "bar",
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: d.bars.map((b) => ({
                  value: +b.volume,
                  itemStyle: {
                    color: marketColor(+b.close - +b.open),
                  },
                })),
              },
            ]
          : [
              {
                name: "价格",
                type: "line",
                symbol: "none",
                data: line.price,
                lineStyle: {
                  width: 1.5,
                  color: priceColor,
                },
                itemStyle: { color: priceColor },
                areaStyle: { color: priceColor, opacity: 0.055 },
              },
              {
                name: "均价",
                type: "line",
                symbol: "none",
                data: line.average,
                lineStyle: { width: 1 },
              },
              {
                name: "昨收",
                type: "line",
                symbol: "none",
                data: line.baseline,
                lineStyle: { width: 1, type: "dashed" },
              },
              {
                name: "分钟量（手）",
                type: "bar",
                xAxisIndex: 1,
                yAxisIndex: 2,
                data: line.volume,
                itemStyle: { color: "#a3b9dd" },
              },
            ]),
        ...markerSeries,
      ],
    },
    true,
  );
  meta.value = `${d.adjustment} · ${daily ? d.bars.at(-1)?.date : d.sessions.at(-1)?.date} · 获取 ${new Date(d.fetchedAt).toLocaleTimeString("zh-CN", { hour12: false })}`;
}
async function refresh() {
  if (disposed || document.hidden || busy) return;
  clearTimeout(timer);
  const token = generation;
  busy = true;
  loading.value = true;
  try {
    if (!isTauri())
      throw new Error("浏览器预览不连接行情，请在Mac桌面版查看真实图表");
    const data = await getChart(props.security, props.mode, () => !disposed);
    if (token !== generation) return;
    if (data.symbol !== props.security.id || data.mode !== props.mode)
      throw new Error("图表证券不匹配");
    draw(liveDaily(data, marketQuotes[props.security.id]));
    error.value = "";
  } catch (e) {
    if (token === generation)
      error.value = String(e instanceof Error ? e.message : e);
  } finally {
    busy = false;
    if (token === generation) loading.value = false;
    if (!disposed && !document.hidden) {
      if (token !== generation) void refresh();
      else timer = setTimeout(refresh, error.value ? 60000 : 30000);
    }
  }
}
function reset() {
  generation++;
  latestData = undefined;
  markedCount.value = 0;
  chart?.clear();
  meta.value = "";
  snapshot.value = [];
  error.value = "";
  void refresh();
}
function visibility() {
  generation++;
  clearTimeout(timer);
  if (!document.hidden) void refresh();
}
watch(() => [props.security.id, props.mode], reset);
watch(
  () => props.trades,
  () => {
    if (
      latestData &&
      latestData.symbol === props.security.id &&
      latestData.mode === props.mode
    )
      draw(latestData);
  },
  { deep: true },
);
onMounted(() => {
  chart = echarts.init(el.value);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(el.value!);
  document.addEventListener("visibilitychange", visibility);
  void refresh();
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  clearTimeout(timer);
  observer?.disconnect();
  chart?.dispose();
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
  <dl
    v-if="snapshot.length"
    class="chart-snapshot"
    aria-label="当前分时行情摘要"
  >
    <div v-for="item in snapshot" :key="item.label">
      <dt>{{ item.label }}</dt>
      <dd :class="item.tone ? `is-${item.tone}` : undefined">
        {{ item.value }}
      </dd>
    </div>
  </dl>
  <div class="chart-wrap">
    <div ref="el" class="chart-canvas" aria-label="证券行情图表"></div>
    <div v-if="error" class="chart-notice">
      <span>{{ error }}</span
      ><button @click="refresh">重试</button>
    </div>
    <span v-else-if="loading" class="chart-loading">更新行情…</span>
  </div>
  <div class="chart-caption">
    <span
      >腾讯公开行情 · 可能延迟 · 不保证成交<span
        v-if="trades"
        title="B买入、S卖出；日K同一天同时买卖合并为T，不要求数量相同。仅显示当前图表范围内的手工成交，期初快照不标注。日K按K线定位，悬停查看各笔方向和原始成交价，不是交易建议。"
      >
        · BS成交 {{ markedCount }}笔</span
      ></span
    ><span>{{ meta }}</span>
  </div>
</template>

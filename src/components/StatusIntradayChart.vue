<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import {
  chartKey,
  getChart,
  marketCharts,
  marketErrors,
  type MarketSecurity,
} from "../market";
import { chartSeries } from "../sim/chart";
import { tradeMarkers } from "../sim/tradeMarkers";
import type { StatusTrade } from "../statusBar";

const props = defineProps<{
  security: MarketSecurity & { name: string };
  trades?: StatusTrade[];
  active: boolean;
}>();
const key = computed(() => chartKey(props.security.id, "intraday"));
const data = computed(() => marketCharts[key.value]);
const series = computed(() => (data.value ? chartSeries(data.value) : null));
let busy = false;

function path(values: (number | null)[], y: (value: number) => number) {
  let drawing = false;
  return values
    .map((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        return "";
      }
      const x = 7 + (index / Math.max(1, values.length - 1)) * 262;
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${x.toFixed(1)},${y(value).toFixed(1)}`;
    })
    .join(" ");
}
const geometry = computed(() => {
  const values = series.value;
  if (!values) return null;
  const prices = [
    ...values.price,
    ...values.average,
    ...values.baseline,
  ].filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || Math.max(max * 0.001, 0.001);
  const y = (value: number) => 75 - ((value - min) / span) * 64;
  const volumeMax = Math.max(
    1,
    ...values.volume.filter((value): value is number => value !== null),
  );
  const count = Math.max(1, values.volume.length);
  return {
    pricePath: path(values.price, y),
    averagePath: path(values.average, y),
    baselineY: y(values.baseline.find((value) => value !== null) ?? min),
    markers: tradeMarkers(data.value!, props.trades ?? []).map((marker) => {
      const x = 7 + (marker.index / Math.max(1, values.price.length - 1)) * 262;
      const anchorY = y(marker.anchor);
      const direction = marker.side === "buy" ? 1 : -1;
      return {
        side: marker.side,
        x,
        anchorY,
        badgeY: Math.max(7, Math.min(79, anchorY + direction * 11)),
      };
    }),
    volumes: values.volume.flatMap((value, index) => {
      if (value === null) return [];
      const height = Math.max(0.8, (value / volumeMax) * 22);
      return [
        {
          x: 7 + (index / count) * 262,
          y: 108 - height,
          width: Math.max(0.45, 262 / count - 0.25),
          height,
          tone: (values.volumeChange[index] ?? 0) >= 0 ? "up" : "down",
        },
      ];
    }),
  };
});
const quoteTime = computed(() => {
  const last = data.value?.sessions.at(-1)?.points.at(-1)?.time;
  return last ? `${last.slice(0, 2)}:${last.slice(2)}` : "";
});

async function refresh() {
  if (!props.active || busy) return;
  busy = true;
  try {
    await getChart(props.security, "intraday", () => props.active, true, true);
  } catch {
    // The last successful chart remains visible while the next refresh retries.
  } finally {
    busy = false;
  }
}
watch(
  () => [props.security.id, props.active],
  () => void refresh(),
  { immediate: true },
);
const timer = setInterval(() => void refresh(), 3000);
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="status-chart-card">
    <header>
      <div>
        <strong>{{ security.name }}</strong>
        <span>{{ security.id.toUpperCase() }}</span>
      </div>
      <time>{{ quoteTime || (data ? "已更新" : "等待行情") }}</time>
    </header>
    <svg v-if="geometry" viewBox="0 0 276 124" preserveAspectRatio="none">
      <line class="chart-grid" x1="7" x2="269" y1="43" y2="43" />
      <line class="chart-grid" x1="7" x2="269" y1="75" y2="75" />
      <line
        class="previous-close"
        x1="7"
        x2="269"
        :y1="geometry.baselineY"
        :y2="geometry.baselineY"
      />
      <path class="average-line" :d="geometry.averagePath" />
      <path class="price-line" :d="geometry.pricePath" />
      <g
        v-for="(marker, index) in geometry.markers"
        :key="`${marker.side}-${index}`"
        class="trade-marker"
        :class="marker.side"
      >
        <line
          :x1="marker.x"
          :x2="marker.x"
          :y1="marker.anchorY"
          :y2="marker.badgeY"
        />
        <circle
          class="marker-anchor"
          :cx="marker.x"
          :cy="marker.anchorY"
          r="1.8"
        />
        <circle
          class="marker-badge"
          :cx="marker.x"
          :cy="marker.badgeY"
          r="6.5"
        />
        <text
          :x="marker.x"
          :y="marker.badgeY"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {{ marker.side === "buy" ? "B" : "S" }}
        </text>
      </g>
      <line class="volume-divider" x1="7" x2="269" y1="82" y2="82" />
      <rect
        v-for="(bar, index) in geometry.volumes"
        :key="index"
        class="volume-bar"
        :class="bar.tone"
        :x="bar.x"
        :y="bar.y"
        :width="bar.width"
        :height="bar.height"
      />
      <text x="7" y="121">09:30</text>
      <text x="138" y="121" text-anchor="middle">11:30/13:00</text>
      <text x="269" y="121" text-anchor="end">15:00</text>
    </svg>
    <div v-else class="chart-empty">
      {{ marketErrors[key] ? "分时暂缺，自动重试中" : "正在获取分时走势…" }}
    </div>
  </section>
</template>

<style scoped>
.status-chart-card {
  flex: 0 0 150px;
  min-height: 150px;
  margin: 0 8px 7px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.44);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.52),
    0 5px 18px rgba(22, 36, 58, 0.035);
}
.status-chart-card header {
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  color: var(--text-primary);
}
.status-chart-card header div {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.status-chart-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}
.status-chart-card header span,
.status-chart-card time {
  color: var(--text-tertiary);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}
.status-chart-card svg {
  display: block;
  width: 100%;
  height: 124px;
}
.chart-grid,
.volume-divider {
  stroke: var(--line);
  stroke-width: 0.7;
}
.previous-close {
  stroke: rgba(112, 126, 145, 0.62);
  stroke-width: 0.75;
  stroke-dasharray: 3 3;
}
.price-line,
.average-line {
  fill: none;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.price-line {
  stroke: #3487d7;
  stroke-width: 1.25;
}
.average-line {
  stroke: #d39a2c;
  stroke-width: 0.85;
  opacity: 0.86;
}
.trade-marker line,
.trade-marker .marker-anchor {
  fill: #fff;
  stroke-width: 1.1;
  vector-effect: non-scaling-stroke;
}
.trade-marker .marker-badge {
  stroke: #fff;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.trade-marker.buy line,
.trade-marker.buy .marker-anchor {
  stroke: var(--gain);
}
.trade-marker.buy .marker-badge {
  fill: var(--gain);
}
.trade-marker.sell line,
.trade-marker.sell .marker-anchor {
  stroke: var(--loss);
}
.trade-marker.sell .marker-badge {
  fill: var(--loss);
}
.status-chart-card .trade-marker text {
  fill: #fff;
  font-size: 7px;
  font-weight: 700;
}
.volume-bar.up {
  fill: var(--gain);
  opacity: 0.56;
}
.volume-bar.down {
  fill: var(--loss);
  opacity: 0.56;
}
.status-chart-card text {
  fill: var(--text-tertiary);
  font-size: 8px;
}
.chart-empty {
  height: 124px;
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  font-size: 10px;
}
@media (prefers-color-scheme: dark) {
  .status-chart-card {
    border-color: rgba(255, 255, 255, 0.13);
    background: rgba(255, 255, 255, 0.045);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.1);
  }
  .price-line {
    stroke: #67aef2;
  }
  .average-line {
    stroke: #e2b45a;
  }
}
</style>

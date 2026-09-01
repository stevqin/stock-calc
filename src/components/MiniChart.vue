<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from "vue";
import type { Security } from "../sim/model";
import { marketColor } from "../marketTheme";
import {
  getChart,
  chartKey,
  liveDaily,
  marketCharts,
  marketQuotes,
  marketErrors,
} from "../market";
const props = defineProps<{ security: Security; mode: "daily" | "intraday" }>();
const root = ref<HTMLElement>();
const visible = ref(false);
let observer: IntersectionObserver | undefined,
  timer: ReturnType<typeof setInterval>;
const emit = defineEmits<{ visible: [id: string, visible: boolean] }>();
const key = computed(() => chartKey(props.security.id, props.mode));
const data = computed(() => {
  const d = marketCharts[key.value];
  return d ? liveDaily(d, marketQuotes[props.security.id]) : null;
});
const geometry = computed(() => {
  const d = data.value;
  if (!d) return null;
  const bars = d.bars.slice(-60),
    points = d.sessions.at(-1)?.points ?? [];
  const values =
    props.mode === "daily"
      ? bars.flatMap((b) => [Number(b.high), Number(b.low)])
      : points.map((p) => Number(p.price));
  const base =
    props.mode === "intraday"
      ? Number(d.sessions.at(-1)?.previousClose || values[0])
      : Number(bars[0]?.open);
  if (!values.length) return null;
  const min = Math.min(...values, base),
    max = Math.max(...values, base),
    span = max - min || Math.max(max * 0.001, 0.001);
  const y = (n: number) => 48 - ((n - min) / span) * 40;
  const minuteX = (t: string) => {
    const n = Number(t.slice(0, 2)) * 60 + Number(t.slice(2));
    return 4 + ((n <= 690 ? n - 570 : n - 780 + 120) / 240) * 172;
  };
  return {
    baseline: y(base),
    path: points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${minuteX(p.time).toFixed(1)},${y(Number(p.price)).toFixed(1)}`,
      )
      .join(" "),
    candles: bars.map((b, i) => ({
      x: 4 + (i * 172) / Math.max(1, bars.length),
      high: y(+b.high),
      low: y(+b.low),
      top: y(Math.max(+b.open, +b.close)),
      height: Math.max(1, Math.abs(y(+b.open) - y(+b.close))),
      color: marketColor(+b.close - +b.open),
    })),
    width: Math.max(1, 172 / Math.max(1, bars.length) - 1),
    color: marketColor(
      (props.mode === "daily"
        ? Number(bars.at(-1)?.close)
        : Number(points.at(-1)?.price)) - base,
    ),
  };
});
async function refresh() {
  if (!visible.value || document.hidden) return;
  await getChart(props.security, props.mode, () => visible.value).catch(
    () => {},
  );
}
watch(() => [props.security.id, props.mode], refresh);
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    visible.value = entries[0].isIntersecting;
    emit("visible", props.security.id, visible.value);
    if (visible.value) void refresh();
  });
  observer.observe(root.value!);
  timer = setInterval(refresh, 30000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  observer?.disconnect();
  emit("visible", props.security.id, false);
});
</script>
<template>
  <div
    ref="root"
    class="mini-chart"
    :title="
      data
        ? `${data.adjustment} · 获取 ${new Date(data.fetchedAt).toLocaleString('zh-CN')}`
        : marketErrors[key] || '等待可见行行情'
    "
  >
    <svg
      v-if="geometry"
      viewBox="0 0 180 56"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`${security.name}${mode === 'daily' ? '近60交易日日K' : '分时'}走势`"
    >
      <line
        x1="0"
        x2="180"
        :y1="geometry.baseline"
        :y2="geometry.baseline"
        stroke="#a6b4c7"
        stroke-dasharray="3 3"
      />
      <path
        v-if="mode === 'intraday'"
        :d="geometry.path"
        fill="none"
        :stroke="geometry.color"
        stroke-width="1.3"
      />
      <g
        v-else
        v-for="(c, i) in geometry.candles"
        :key="i"
        :stroke="c.color"
        :fill="c.color"
      >
        <line
          :x1="c.x + geometry.width / 2"
          :x2="c.x + geometry.width / 2"
          :y1="c.high"
          :y2="c.low"
        />
        <rect
          :x="c.x"
          :y="c.top"
          :width="geometry.width"
          :height="c.height"
          stroke-width="0"
        />
      </g></svg
    ><span v-else class="mini-empty">{{
      marketErrors[key] ? "走势暂缺" : "等待走势"
    }}</span>
    <span
      v-if="
        data &&
        Date.now() - Date.parse(data.fetchedAt) > 120000 &&
        mode === 'intraday'
      "
      class="cache-tag"
      >缓存</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{
  priceLevels?: unknown;
  signalConditions?: any;
  referenceText?: string;
  levelIds?: string[];
}>();
const ids = computed(
  () =>
    new Set([
      ...(props.levelIds ?? []),
      ...(`${props.referenceText ?? ""} ${JSON.stringify(props.signalConditions ?? {})}`.match(
        /\bL\d+\b/g,
      ) ?? []),
    ]),
);
const levels = computed(() =>
  (Array.isArray(props.priceLevels) ? props.priceLevels : []).filter((l: any) =>
    ids.value.has(l.id),
  ),
);
const unknown = computed(() =>
  [...ids.value].filter((id) => !levels.value.some((l: any) => l.id === id)),
);
</script>
<template>
  <div class="ai-report-signals">
    <div v-if="levels.length" class="ai-level-map" aria-label="价格编号对照">
      <span v-for="l in levels" :key="l.id"
        ><b>{{ l.id }}＝{{ l.price }} 元</b><small>{{ l.name }}</small></span
      >
    </div>
    <p v-if="unknown.length" class="ai-data-gap">
      未能核验 {{ unknown.join("、") }} 对应价格，请核对原报告资料。
    </p>
    <div
      v-if="signalConditions"
      class="ai-signal-conditions"
      aria-label="行情确认条件"
    >
      <div>
        <strong>怎样确认下跌企稳</strong>
        <p>{{ signalConditions.stabilization }}</p>
      </div>
      <div>
        <strong>怎样确认上涨动能不足</strong>
        <p>{{ signalConditions.weakening }}</p>
      </div>
      <small class="ai-signal-pending"
        >以上是需要观察和核验的条件，不表示当前已经满足。</small
      >
    </div>
  </div>
</template>

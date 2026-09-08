<script setup lang="ts">
import { computed } from "vue";
import Decimal from "decimal.js";
const props = defineProps<{
  price: string;
  previousClose?: string | null;
}>();
const change = computed(() => {
  try {
    const price = new Decimal(props.price);
    const close = new Decimal(props.previousClose ?? "");
    if (!price.isFinite() || !close.isFinite() || price.lte(0) || close.lte(0))
      return null;
    return price.minus(close).div(close).mul(100).toDecimalPlaces(2);
  } catch {
    return null;
  }
});
const tone = computed(() =>
  change.value?.gt(0) ? "gain" : change.value?.lt(0) ? "loss" : "flat",
);
</script>
<template>
  <span
    class="price-change"
    :class="tone"
    title="（输入价 − 当前行情昨收价）÷ 当前行情昨收价 × 100%"
    >较昨收
    {{
      change == null ? "—" : `${change.gt(0) ? "+" : ""}${change.toFixed(2)}%`
    }}</span
  >
</template>
<style scoped>
.price-change {
  display: inline-block;
  margin-left: 8px;
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>

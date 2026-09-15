<script setup lang="ts">
import { computed } from "vue";
import type { ChartData } from "../sim/chart";
import type { Quote } from "../quotes";
import { chipEstimate } from "../sim/indicators";
const props = defineProps<{
  data?: ChartData;
  quote?: Quote;
  error?: string;
}>();
const chip = computed(() =>
  chipEstimate(props.data?.bars ?? [], props.quote?.rawFields?.[72] ?? ""),
);
</script>
<template>
  <aside class="daily-studies">
    <h4>筹码统计 <small>估算</small></h4>
    <template v-if="chip">
      <dl>
        <div>
          <dt title="按筹码权重计算的加权平均价格">平均成本</dt>
          <dd>{{ chip.average.toFixed(2) }}</dd>
        </div>
        <div>
          <dt>获利比例</dt>
          <dd>{{ chip.profit.toFixed(2) }}%</dd>
        </div>
        <div>
          <dt>90%成本区间</dt>
          <dd>{{ chip.lower.toFixed(2) }}–{{ chip.upper.toFixed(2) }}</dd>
        </div>
        <div>
          <dt title="(区间上限−下限)÷(区间上限＋下限)×100%，数值越小越集中">
            90%集中度
          </dt>
          <dd>{{ chip.concentration90.toFixed(2) }}%</dd>
        </div>
        <div>
          <dt>70%成本区间</dt>
          <dd>{{ chip.lower70.toFixed(2) }}–{{ chip.upper70.toFixed(2) }}</dd>
        </div>
        <div>
          <dt title="(区间上限−下限)÷(区间上限＋下限)×100%，数值越小越集中">
            70%集中度
          </dt>
          <dd>{{ chip.concentration70.toFixed(2) }}%</dd>
        </div>
      </dl>
      <details class="chip-method">
        <summary>估算口径 · {{ chip.date }}</summary>
        <p>
          {{ chip.start }} 至 {{ chip.date }}，{{ chip.count }} 根{{
            data?.adjustment
          }}日线。假设流通股本等于当前值，以日成交量估算换手衰减，按当日高低价和均价分配筹码。历史股本变化、日内成交分布及区间前持仓未知，结果可能与其他软件不同。
        </p>
      </details>
    </template>
    <p v-else>
      {{ error || "需至少60根有效日线及流通股本，暂无法估算筹码。" }}
    </p>
  </aside>
</template>
<style scoped>
.daily-studies {
  border-top: 1px solid #e6eaf0;
  padding: 6px 0;
  font-variant-numeric: tabular-nums;
  min-width: 0;
}
h4 {
  font-size: 12px;
  margin: 3px 0 7px;
}
h4 small {
  font-size: 9px;
  font-weight: 400;
  color: #8b94a3;
}
svg {
  width: 100%;
  display: block;
}
text {
  font-size: 9px;
  fill: #8190a0;
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  margin: 3px 0;
}
dl > div {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin: 3px 0;
  font-size: 10px;
}
dt {
  color: #8290a0;
}
dd {
  margin: 0;
  text-align: right;
}
p,
summary {
  font-size: 9px;
  color: #8290a0;
  line-height: 1.6;
}
summary {
  cursor: pointer;
}
.chip-method[open] p {
  position: absolute;
  right: 0;
  width: 240px;
  padding: 10px;
  background: #fff;
  border: 1px solid #dce4ee;
  box-shadow: 0 4px 16px #20314918;
  z-index: 5;
}
</style>

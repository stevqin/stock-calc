<script setup lang="ts">
import { computed, ref } from "vue";
const selected = ref("today");
const props = defineProps<{ claims: unknown }>();
const definitions = [
  { type: "today", label: "今日操作", time: "今日 / 下一交易日准备" },
  { type: "week", label: "本周操作", time: "本周剩余交易日 / 复盘" },
  { type: "conservative", label: "稳健方案", time: "风险与底仓管理" },
  { type: "shortTerm", label: "短期 / 做 T", time: "未来1～5个交易日" },
  { type: "mediumLongTerm", label: "中长期", time: "1～3个月" },
];
const rows = computed(() =>
  definitions
    .map((d) => ({
      ...d,
      claim: (Array.isArray(props.claims) ? props.claims : []).find(
        (c: any) => c.operationType === d.type,
      ),
    }))
    .filter((d) => d.claim),
);
const states: Record<string, string> = {
  actionable: "条件已满足",
  conditional: "条件观察",
  wait: "等待条件",
  insufficient: "资料不足",
  notApplicable: "暂不适用",
};
const labels = Object.fromEntries(definitions.map((d) => [d.type, d.label]));
</script>
<template>
  <section class="ai-v2-operations" aria-label="五类操作建议">
    <div class="ai-v2-section-heading">
      <h3>五类操作建议</h3>
      <small>动作与约束直接展示，详细依据按需展开</small>
    </div>
    <div role="tablist" aria-label="五类操作建议" class="ai-operation-tabs">
      <button
        v-for="row in rows"
        :key="row.type"
        role="tab"
        :aria-selected="selected === row.type"
        @click="selected = row.type"
      >
        {{ row.label }}
      </button>
    </div>
    <article
      v-for="row in rows.filter((r) => r.type === selected)"
      :key="row.type"
      role="tabpanel"
      :aria-label="row.label"
      class="ai-v2-operation"
    >
      <div class="ai-v2-type">
        <strong>{{ row.label }}</strong
        ><small>{{ row.time }}</small
        ><span
          :class="[
            'ai-v2-status',
            { 'ai-v2-warning': row.claim.status === 'insufficient' },
          ]"
          >{{ states[row.claim.status] ?? row.claim.status }}</span
        >
      </div>
      <div class="ai-v2-body">
        <h4>{{ row.claim.text }}</h4>
        <details>
          <summary>展开判断、触发条件与资金依据</summary>
          <p class="ai-v2-reason">{{ row.claim.reason }}</p>
          <div class="ai-v2-conditions">
            <div>
              <small>触发条件</small>
              <p>{{ row.claim.trigger }}</p>
            </div>
            <div>
              <small>停止 / 失效条件</small>
              <p>{{ row.claim.invalidation }}</p>
            </div>
          </div>
          <div class="ai-v2-basis">
            <p><strong>数量约束：</strong>{{ row.claim.quantityBasis }}</p>
            <p><strong>资金依据：</strong>{{ row.claim.cashBasis }}</p>
          </div>
          <p v-if="row.claim.conflictsWith?.length" class="ai-data-gap">
            与
            {{
              row.claim.conflictsWith.map((x: string) => labels[x]).join("、")
            }}
            的适用条件不同，不同时执行。
          </p>
          <details>
            <summary>展开时间、费用与模型依据</summary>
            <dl class="ai-condition-list">
              <dt>适用时间</dt>
              <dd>{{ row.claim.horizon }}</dd>
              <dt>费用影响</dt>
              <dd>{{ row.claim.feeImpact }}</dd>
            </dl>
            <slot name="evidence" :claim="row.claim" />
          </details>
        </details>
      </div>
    </article>
  </section>
</template>

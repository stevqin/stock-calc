<script setup lang="ts">
import { computed, ref } from "vue";
const props = defineProps<{ plan: any }>();
const choice = ref("");
const labels: Record<string, string> = {
  tRoundTrip: "先卖后买做 T",
  riskReduction: "减仓控风险",
  entry: "加仓 / 入场",
};
const selected = computed(
  () =>
    choice.value ||
    (props.plan.preferredScenario === "wait"
      ? "tRoundTrip"
      : props.plan.preferredScenario),
);
const branch = computed(() => props.plan.scenarios[selected.value]);
const context = computed(() => props.plan.context);
const effects = computed(() => branch.value?.effects);
function band(lo: unknown, hi: unknown) {
  return lo === hi ? String(lo ?? "—") : `${lo ?? "—"}～${hi ?? "—"}`;
}
</script>
<template>
  <section class="ai-execution" aria-label="具体操作预案">
    <div class="ai-execution-heading">
      <small>具体操作预案 · {{ context.targetSession }}</small
      ><span>触发后再执行</span>
    </div>
    <p v-if="context.cutoffAt" class="ai-muted">
      资料冻结于
      {{
        new Date(context.cutoffAt).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        })
      }}；历史预案需更新行情与账户后再使用。
    </p>
    <h3>{{ plan.headline ?? plan.decision }}</h3>
    <div class="ai-execution-limits">
      <span
        >保留底仓 <b>{{ context.reserveQuantity }} 股</b></span
      ><span
        >单轮做 T ≤ <b>{{ context.maxTQuantity }} 股</b></span
      ><span
        >账本余额 <b>{{ context.cash?.balance ?? "未提供" }} 元</b></span
      >
    </div>
    <p v-if="context.nextSession" class="ai-muted">
      下一交易日预计可卖 {{ context.sellCapacity }} 股；当前可卖
      {{ context.currentAvailable }} 股。执行前核对券商可卖数量及涨跌停范围。
    </p>
    <div role="tablist" aria-label="互斥操作分支" class="ai-operation-tabs">
      <button
        v-for="(label, key) in labels"
        :key="key"
        role="tab"
        :aria-selected="selected === key"
        @click="choice = key"
      >
        {{ label }}<small v-if="plan.preferredScenario === key"> · 首选</small>
      </button>
    </div>
    <div role="tabpanel" :aria-label="labels[selected]">
      <p class="ai-execution-reason">{{ branch.reason }}</p>
      <div v-if="branch.steps.length" class="ai-trend-scroll">
        <table class="ai-execution-table">
          <thead>
            <tr>
              <th>顺序 / 动作</th>
              <th>条件价位（元）</th>
              <th>股数</th>
              <th>何时执行</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(step, i) in branch.steps" :key="i">
              <th>
                {{ Number(i) + 1 }} ·
                {{ step.side === "sell" ? "卖出" : "买入 / 买回" }}
              </th>
              <td>{{ band(step.priceLow, step.priceHigh) }}</td>
              <td>
                <b>{{ step.quantity }}</b>
              </td>
              <td>
                {{ step.trigger
                }}<strong
                  v-if="step.dependency === 'sellFilled'"
                  class="ai-execution-dependency"
                  >先确认卖出成交与券商回款可用，再买回</strong
                ><strong
                  v-if="step.dependency === 'cashAvailable'"
                  class="ai-execution-dependency"
                  >先核对券商实际可用资金</strong
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ai-data-gap">
        {{ branch.status === "insufficient" ? "资料不足" : "等待条件" }} ·
        观察价位 {{ branch.watchPrices?.join(" / ") || "暂无可核验价位" }} 元
      </p>
      <div v-if="effects" class="ai-execution-effects">
        <div v-if="effects.netProfitMin !== null">
          <small>两步成交后的净差额（含费用）</small
          ><b>{{ band(effects.netProfitMin, effects.netProfitMax) }} 元</b>
        </div>
        <div>
          <small>预计往返 / 本步费用</small
          ><b>{{ band(effects.totalFeeMin, effects.totalFeeMax) }} 元</b>
        </div>
        <div>
          <small>完成后摊薄成本</small
          ><b>{{ band(effects.dilutedCostMin, effects.dilutedCostMax) }} 元</b>
        </div>
        <div>
          <small>完成后持仓 / 可卖</small
          ><b
            >{{ effects.remainingQuantity }} /
            {{ effects.remainingAvailable }} 股</b
          >
        </div>
        <div>
          <small>完成后账本余额</small
          ><b>{{ band(effects.cashAfterMin, effects.cashAfterMax) }} 元</b>
        </div>
      </div>
      <p
        v-if="selected === 'tRoundTrip' && branch.steps.length"
        class="ai-execution-partial"
      >
        <strong>如果只卖出、未买回：</strong>持仓
        {{ branch.steps[0].remainingQuantity }} 股，余额
        {{ band(branch.steps[0].cashAfterMin, branch.steps[0].cashAfterMax) }}
        元，剩余摊薄成本
        {{
          band(branch.steps[0].dilutedCostMin, branch.steps[0].dilutedCostMax)
        }}
        元。此时做 T 未完成，不能计为降成本；取消条件触发后不追价买回。
      </p>
      <p v-if="branch.entryFunding" class="ai-data-gap">
        按观察价买入最低 {{ branch.entryFunding.quantity }} 股，含费用需
        {{
          band(branch.entryFunding.requiredMin, branch.entryFunding.requiredMax)
        }}
        元；账本资金缺口
        {{ band(branch.entryFunding.gapMin, branch.entryFunding.gapMax) }} 元。
      </p>
      <p class="ai-execution-cancel">
        <strong>停止 / 取消：</strong>{{ branch.invalidation }}
      </p>
    </div>
    <details>
      <summary>查看模型判断、冻结价位与计算依据</summary>
      <p>{{ plan.decision }}</p>
      <p>
        底仓 {{ context.policy.reservePercent }}%，单轮
        {{ context.policy.tPercent }}%；{{
          context.rules.note
        }}。费用按已确认账本费率测算。成交滑点与实际费用可能改变结果；本机余额需与券商核对。
      </p>
      <p v-for="level in context.priceLevels" :key="level.id">
        {{ level.name }}：{{ level.price }} 元
      </p>
    </details>
  </section>
</template>

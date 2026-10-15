<script setup lang="ts">
import { computed, ref } from "vue";
import ReportSignals from "./ReportSignals.vue";
import { readableReportText } from "./reportText";
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
const primary = computed(() =>
  props.plan.preferredScenario === "wait"
    ? null
    : props.plan.scenarios[props.plan.preferredScenario],
);
const waitReason = computed(() =>
  readableReportText(
    props.plan.decision ||
      context.value.tUnavailableReasons?.[0] ||
      "等待确认条件",
  ),
);
const primarySell = computed(() =>
  primary.value?.steps?.find((s: any) => s.side === "sell"),
);
const holding = computed(() => context.value.position?.quantity ?? null);
const hasHolding = computed(
  () => holding.value !== null && Number(holding.value) > 0,
);
const unit = computed(() => context.value.quantityUnit ?? "股");
const branchLevelIds = computed(() => [
  ...(branch.value?.watchLevelIds ?? []),
  ...(branch.value?.steps ?? [])
    .flatMap((s: any) => [s.lowId, s.highId])
    .filter(Boolean),
]);
function confirmation(step: any) {
  return step.side === "sell"
    ? props.plan.signalConditions?.weakening
    : props.plan.signalConditions?.stabilization;
}
function idRange(step: any) {
  return step.lowId === step.highId
    ? step.lowId
    : `${step.lowId}～${step.highId}`;
}
function band(lo: unknown, hi: unknown) {
  return lo === hi ? String(lo ?? "—") : `${lo ?? "—"}～${hi ?? "—"}`;
}
</script>
<template>
  <section class="ai-execution" aria-label="具体操作预案">
    <div class="ai-execution-heading">
      <small>操作清单 · {{ context.targetSession }}</small
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
    <div class="ai-action-sheet" aria-label="一眼看操作">
      <div class="ai-action-now">
        <strong>{{
          primary?.steps?.length
            ? hasHolding
              ? "先持有，满足条件再操作"
              : "先等待，满足条件再买入"
            : "暂不买卖"
        }}</strong>
        <p v-if="!primary?.steps?.length">{{ waitReason }}</p>
      </div>
      <div v-if="!primary?.steps?.length" class="ai-action-empty">
        <span data-primary-sell>暂不卖出</span
        ><span data-primary-buy>暂不买入</span>
      </div>
      <div
        v-for="(step, i) in primary?.steps ?? []"
        :key="i"
        data-order-row
        :data-primary-sell="step.side === 'sell' ? '' : undefined"
        :data-primary-buy="step.side === 'buy' ? '' : undefined"
        :class="[
          'ai-action-row',
          step.side === 'sell' ? 'ai-action-sell' : 'ai-action-buy',
        ]"
      >
        <div class="ai-action-order">
          <b>{{ Number(i) + 1 }}</b
          ><strong>{{
            step.side === "sell"
              ? "卖出"
              : plan.preferredScenario === "tRoundTrip"
                ? "买回"
                : "买入"
          }}</strong>
        </div>
        <div class="ai-action-price">
          <strong
            >{{ band(step.priceLow, step.priceHigh) }}<small>元</small></strong
          ><span>{{ idRange(step) || "旧报告未保存价格编号" }}</span>
        </div>
        <b class="ai-action-quantity"
          >{{ step.quantity }}<small>{{ unit }}</small></b
        >
        <div class="ai-action-condition">
          <small>执行条件</small>
          <p>{{ readableReportText(step.trigger) }}</p>
          <p
            v-if="
              confirmation(step) && !step.trigger?.includes(confirmation(step))
            "
            class="ai-action-confirmation"
          >
            {{ readableReportText(confirmation(step)) }}
          </p>
          <strong v-if="step.dependency === 'sellFilled'"
            >先确认卖出成交与券商回款可用，再买回</strong
          >
          <strong v-if="step.dependency === 'cashAvailable'"
            >先核对券商实际可用资金</strong
          >
        </div>
      </div>
      <div data-primary-hold class="ai-action-hold">
        <span>{{ primarySell ? "卖出后持有" : "继续持有" }}</span>
        <strong
          >{{ primarySell?.remainingQuantity ?? holding ?? "未提供"
          }}<small v-if="holding !== null"> {{ unit }}</small></strong
        >
        <small v-if="primarySell"
          >底仓至少 {{ context.reserveQuantity }}
          {{ unit }}；买回后持仓见测算</small
        >
        <small v-else>{{
          hasHolding
            ? "现有持仓暂不变"
            : holding === null
              ? "未提供账户资料"
              : "当前无持仓"
        }}</small>
      </div>
      <p v-if="primary?.steps?.length" class="ai-action-stop">
        <strong>取消条件</strong>{{ readableReportText(primary.invalidation) }}
      </p>
    </div>
    <aside
      v-if="plan.warnings?.length"
      data-branch-warnings
      class="ai-branch-warnings"
    >
      <strong
        >{{ plan.warnings.length }} 个方案不可用，其他有效结论已保留</strong
      >
      <p v-if="plan.selectionNotice">{{ plan.selectionNotice }}</p>
      <p v-for="(warning, i) in plan.warnings" :key="i">
        {{ warning.message }}
      </p>
    </aside>
    <details data-plan-details class="ai-plan-details">
      <summary>展开备选方案、行情条件与费用测算</summary>
      <details class="ai-headline-details">
        <summary>展开首选方案说明</summary>
        <p>{{ readableReportText(plan.headline ?? plan.decision) }}</p>
      </details>
      <aside
        v-if="context.tUnavailableReasons?.length"
        class="ai-wait-reasons"
        aria-label="暂不做T的原因"
      >
        <strong>为什么暂不安排做 T</strong>
        <p v-for="(reason, i) in context.tUnavailableReasons" :key="i">
          {{ reason }}
        </p>
        <small>{{ context.policyExplanation }}</small>
      </aside>
      <div class="ai-execution-limits">
        <span
          >保留底仓 <b>{{ context.reserveQuantity }} {{ unit }}</b></span
        ><span
          >单轮做 T ≤ <b>{{ context.maxTQuantity }} {{ unit }}</b></span
        ><span
          >账本余额 <b>{{ context.cash?.balance ?? "未提供" }} 元</b></span
        >
      </div>
      <p v-if="context.nextSession" class="ai-muted">
        下一交易日预计可卖 {{ context.sellCapacity }} {{ unit }}；当前可卖
        {{ context.currentAvailable }}
        {{ unit }}。执行前核对券商可卖数量及涨跌停范围。
      </p>
      <div role="tablist" aria-label="互斥操作分支" class="ai-operation-tabs">
        <button
          v-for="(label, key) in labels"
          :key="key"
          role="tab"
          :aria-selected="selected === key"
          @click="choice = key"
        >
          {{ label
          }}<small v-if="plan.preferredScenario === key"> · 首选</small>
        </button>
      </div>
      <div role="tabpanel" :aria-label="labels[selected]">
        <p v-if="branch.unavailableReason" class="ai-branch-unavailable">
          <strong>方案不可用</strong> · {{ branch.unavailableReason }}
        </p>
        <p v-else class="ai-execution-reason">
          {{ readableReportText(branch.reason) }}
        </p>
        <ReportSignals
          :price-levels="context.priceLevels"
          :signal-conditions="plan.signalConditions"
          :reference-text="
            branch.reason +
            ' ' +
            branch.invalidation +
            ' ' +
            (branch.steps ?? []).map((s: any) => s.trigger).join(' ')
          "
          :level-ids="branchLevelIds"
        />
        <p v-if="!plan.signalConditions" class="ai-muted">
          这份旧报告未单独保存企稳与动能不足的明确条件，重新分析后补充。
        </p>
        <div v-if="branch.steps.length" class="ai-trend-scroll">
          <table class="ai-execution-table">
            <thead>
              <tr>
                <th>顺序 / 动作</th>
                <th>条件价位（元）</th>
                <th>数量（{{ unit }}）</th>
                <th>何时执行</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(step, i) in branch.steps" :key="i">
                <th>
                  {{ Number(i) + 1 }} ·
                  {{ step.side === "sell" ? "卖出" : "买入 / 买回" }}
                </th>
                <td>
                  {{ band(step.priceLow, step.priceHigh)
                  }}<small class="ai-step-level">{{ idRange(step) }}</small>
                </td>
                <td>
                  <b>{{ step.quantity }}</b>
                </td>
                <td>
                  {{ readableReportText(step.trigger)
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
            ><b
              >{{ band(effects.dilutedCostMin, effects.dilutedCostMax) }} 元</b
            >
          </div>
          <div>
            <small>完成后持仓 / 可卖</small
            ><b
              >{{ effects.remainingQuantity }} /
              {{ effects.remainingAvailable }} {{ unit }}</b
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
          {{ branch.steps[0].remainingQuantity }} {{ unit }}，余额
          {{ band(branch.steps[0].cashAfterMin, branch.steps[0].cashAfterMax) }}
          元，剩余摊薄成本
          {{
            band(branch.steps[0].dilutedCostMin, branch.steps[0].dilutedCostMax)
          }}
          元。此时做 T 未完成，不能计为降成本；取消条件触发后不追价买回。
        </p>
        <p v-if="branch.entryFunding" class="ai-data-gap">
          按观察价买入最低 {{ branch.entryFunding.quantity }}
          {{ unit }}，含费用需
          {{
            band(
              branch.entryFunding.requiredMin,
              branch.entryFunding.requiredMax,
            )
          }}
          元；账本资金缺口
          {{ band(branch.entryFunding.gapMin, branch.entryFunding.gapMax) }}
          元。
        </p>
        <p class="ai-execution-cancel">
          <strong>停止 / 取消：</strong
          >{{ readableReportText(branch.invalidation) }}
        </p>
      </div>
      <details>
        <summary>查看模型判断、冻结价位与计算依据</summary>
        <p>{{ readableReportText(plan.decision) }}</p>
        <p>
          底仓 {{ context.policy.reservePercent }}%，单轮
          {{ context.policy.tPercent }}%；{{
            context.rules.note
          }}。费用按已确认账本费率测算。成交滑点与实际费用可能改变结果；本机余额需与券商核对。
        </p>
        <p v-for="level in context.priceLevels" :key="level.id">
          {{ level.id }} · {{ level.name }}：{{ level.price }} 元
        </p>
      </details>
    </details>
  </section>
</template>

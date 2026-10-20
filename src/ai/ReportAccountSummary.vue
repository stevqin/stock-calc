<script setup lang="ts">
import type { CashContext } from "./accountContext";
interface AccountPosition {
  quantity?: string;
  available?: string;
  dilutedCost?: string | null;
  averageCost?: string | null;
  settlement?: string;
  roundStart?: string;
  trades?: {
    id: string;
    kind: string;
    quantity?: string;
    price?: string;
    time: string;
    note?: string;
    fees?: { total?: string } | null;
  }[];
}
defineProps<{
  position?: AccountPosition | null;
  cash?: CashContext | null;
  unit: string;
}>();
function capitalRecovered(v: unknown) {
  return (
    typeof v === "string" &&
    v.trim() !== "" &&
    Number.isFinite(Number(v)) &&
    Number(v) <= 0
  );
}
function amount(v: unknown) {
  return typeof v === "string" && v.trim() && Number.isFinite(Number(v))
    ? Number(v).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    : "未提供";
}
function tradeLabel(kind: string) {
  return (
    (
      { buy: "买入", sell: "卖出", opening: "期初持仓" } as Record<
        string,
        string
      >
    )[kind] ?? kind
  );
}
function time(v: string) {
  const d = new Date(v);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Shanghai",
      })
    : "时间未知";
}
</script>
<template>
  <div class="ai-account-summary">
    <dl
      v-if="position || cash"
      class="ai-account-grid"
      :class="{ 'cash-only': !position }"
    >
      <template v-if="position">
        <div>
          <dt>本股持仓</dt>
          <dd class="ai-account-value">
            {{ position?.quantity ?? "未提供"
            }}<small v-if="position?.quantity">{{ unit }}</small>
          </dd>
        </div>
        <div>
          <dt>可卖数量</dt>
          <dd class="ai-account-value">
            {{ position?.available ?? "未提供"
            }}<small v-if="position?.available">{{ unit }}</small>
          </dd>
        </div>
        <div>
          <dt>本轮回本参考价</dt>
          <dd class="ai-account-value">
            {{
              capitalRecovered(position?.dilutedCost)
                ? "本金已收回"
                : (position?.dilutedCost ?? "未提供")
            }}<small
              v-if="
                position?.dilutedCost &&
                !capitalRecovered(position?.dilutedCost)
              "
              >元/{{ unit }}</small
            >
          </dd>
        </div>
      </template>
      <div>
        <dt>可用于买入的现金</dt>
        <dd class="ai-account-value">
          {{ amount(cash?.balance) }}<small v-if="cash">元</small>
        </dd>
      </div>
    </dl>
    <p v-else class="ai-account-explain">未提供持仓与现金记录。</p>
    <p
      v-if="
        cash &&
        (!cash.initialized || cash.hasWarnings || Number(cash.balance) < 0)
      "
      class="ai-account-notice"
    >
      现金记录有待核对，请检查期初资金、余额与异常流水。
    </p>
    <details v-if="position" class="ai-account-trades">
      <summary>
        本轮交易与成本说明<span
          >{{ position.trades?.length ?? 0 }} 笔 ·
          {{ position.settlement ?? "结算规则待核对" }}</span
        >
      </summary>
      <div class="ai-account-basis">
        <span>剩余持仓成本均价（先入先出）</span
        ><strong>{{ position.averageCost ?? "未提供" }}</strong>
      </div>
      <p class="ai-account-explain">
        剩余持仓均价按先入先出法计算；本轮回本参考价还计入卖出回款，但不包含未来卖出费用，也不是技术支撑位。
      </p>
      <ol v-if="position.trades?.length" class="ai-account-trade-list">
        <li v-for="t in position.trades" :key="t.id">
          <div>
            <strong>{{ tradeLabel(t.kind) }} {{ t.quantity }} {{ unit }}</strong
            ><span>{{ time(t.time) }}</span>
          </div>
          <p>
            价格 {{ t.price ?? "未知" }} 元 · 费用
            {{ t.fees?.total ?? "未知" }} 元
          </p>
          <p v-if="t.note" class="ai-account-trade-note">{{ t.note }}</p>
        </li>
      </ol>
      <p v-else class="ai-account-explain">本次资料未附本轮交易明细。</p>
    </details>
  </div>
</template>
<style scoped>
.ai-account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin: 0;
  padding: 12px;
  background: #f6f8fb;
  border-radius: 8px;
}
.ai-account-grid.cash-only {
  grid-template-columns: 1fr;
}
.ai-account-grid.cash-only > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-account-grid > div {
  min-width: 0;
}
.ai-account-grid dt {
  font-size: 11px;
  color: #758293;
  margin-bottom: 5px;
}
.ai-account-grid dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #243b58;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
  letter-spacing: normal;
}
.ai-account-grid small {
  display: inline;
  font-size: 10px;
  font-weight: 400;
  color: #758293;
  margin-left: 4px;
}
.ai-account-trades {
  margin-top: 10px;
}
.ai-account-trades summary {
  font-size: 12px;
  color: #52677e;
  cursor: pointer;
  line-height: 1.6;
}
.ai-account-trades summary > span {
  display: block;
  margin-left: 14px;
  color: #8593a4;
  font-size: 10px;
}
.ai-account-basis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  font-size: 11px;
  color: #62748a;
}
.ai-account-basis strong {
  font-weight: 500;
  color: #354d68;
}
.ai-account-explain {
  font-size: 11px;
  color: #758293;
  line-height: 1.6;
  margin: 6px 0;
}
.ai-account-trade-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
}
.ai-account-trade-list li {
  padding: 9px 0;
  border-top: 1px solid #e7edf4;
}
.ai-account-trade-list li > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.ai-account-trade-list strong {
  font-weight: 500;
  color: #354d68;
}
.ai-account-trade-list span {
  font-size: 10px;
  color: #8593a4;
  white-space: nowrap;
}
.ai-account-trade-list p {
  margin: 4px 0 0;
  font-size: 11px;
  color: #62748a;
  line-height: 1.5;
}
.ai-account-trade-list .ai-account-trade-note {
  color: #8593a4;
  overflow-wrap: anywhere;
}
.ai-account-notice {
  font-size: 11px;
  color: #996723;
  background: #fff8eb;
  padding: 8px 10px;
  border-radius: 6px;
  line-height: 1.6;
}
</style>

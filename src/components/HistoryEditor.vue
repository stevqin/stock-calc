<script setup lang="ts">
import FloatingNotice from "./FloatingNotice.vue";
import { computed, reactive } from "vue";
import type { Account } from "../sim/model";
import { localDateTime, fromShanghaiInput } from "../sim/model";
import { replay } from "../sim/ledger";
import { cashLabels } from "../sim/record";
import {
  editTrade,
  editCash,
  deleteHistory,
  type HistoryTarget,
  type TradeEdit,
  type CashEdit,
} from "../sim/history";
import Decimal from "decimal.js";
const props = defineProps<{
  account: Account;
  target: HistoryTarget;
  saving: boolean;
}>();
const emit = defineEmits<{ save: [account: Account]; cancel: [] }>();
const trade =
  props.target.scope === "trade"
    ? props.account.entries.find((e) => e.id === props.target.id)
    : undefined;
const cash =
  props.target.scope === "cash"
    ? props.account.cashEntries?.find((e) => e.id === props.target.id)
    : undefined;
const original = trade ?? cash;
const originalTime = original ? localDateTime(new Date(original.time)) : "";
const time = reactive({ value: originalTime });
const tradeForm = reactive<TradeEdit>({
  kind: trade?.kind ?? "buy",
  price: trade?.price ?? "",
  quantity: trade?.quantity ?? "",
  available: trade?.available ?? "0",
  time: trade?.time ?? "",
  note: trade?.note ?? "",
  feeSource: trade?.feeSource ?? "estimated",
  actualFees: {
    commission: trade?.fees?.commission ?? "0",
    stamp: trade?.fees?.stamp ?? "0",
    transfer: trade?.fees?.transfer ?? "0",
  },
});
const cashForm = reactive<CashEdit>({
  kind: cash?.kind ?? "deposit",
  amount: cash?.amount ?? "",
  time: cash?.time ?? "",
  note: cash?.note ?? "",
});
const deleting = props.target.action === "delete";
const kindLabel = (kind: string) =>
  kind === "opening" ? "期初持仓" : kind === "buy" ? "买入" : "卖出";
const securityName = trade
  ? props.account.securities.find((s) => s.id === trade.securityId)?.name
  : "";
const title = `${deleting ? "删除" : "修改"}${trade ? kindLabel(trade.kind) + "记录" : "资金流水"}`;
const before = computed(() => replay(props.account));
const preview = computed(() => {
  try {
    if (!original) throw new Error("记录已不存在，请关闭后重新加载");
    // Keep sub-second precision on a no-op edit, preserving same-time FIFO order.
    const timestamp =
      time.value === originalTime
        ? original.time
        : fromShanghaiInput(time.value);
    const next = deleting
      ? deleteHistory(props.account, props.target.scope, props.target.id)
      : trade
        ? editTrade(props.account, props.target.id, {
            ...tradeForm,
            time: timestamp,
          })
        : editCash(props.account, props.target.id, {
            ...cashForm,
            time: timestamp,
          });
    return { next, ledger: replay(next), error: "" };
  } catch (e) {
    return {
      next: null,
      ledger: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
});
function money(v: string | undefined) {
  return v === undefined ? "—" : new Decimal(v).toFixed(2);
}
function submit() {
  if (!props.saving && preview.value.next) emit("save", preview.value.next);
}
</script>

<template>
  <form class="history-editor" @submit.prevent="submit">
    <h2>{{ title }}</h2>
    <p class="record-summary" v-if="original">
      {{ localDateTime(new Date(original.time)).replace("T", " ") }}<br />
      <template v-if="trade"
        >{{ securityName }} · {{ trade.securityId }} ·
        {{ kindLabel(trade.kind) }} {{ trade.quantity }} 股/份 ×
        {{ trade.price }} 元</template
      >
      <template v-else-if="cash"
        >{{ cashLabels[cash.kind] }} · {{ cash.amount }} 元 ·
        {{ cash.note || "无备注" }}</template
      >
    </p>
    <div class="history-body" :class="{ 'history-deleting': deleting }">
      <p v-if="deleting" class="history-delete-note">
        仅删除这一条记录，不会自动删除后续成交。请核对以下重算结果；建议先导出账户备份。
      </p>
      <fieldset v-else :disabled="saving">
        <div
          class="history-time-fields"
          :class="{ 'with-direction': trade && trade.kind !== 'opening' }"
        >
          <label
            >发生时间<input v-model="time.value" type="datetime-local" step="1"
          /></label>
          <label v-if="trade && trade.kind !== 'opening'"
            >成交方向<select v-model="tradeForm.kind">
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select></label
          >
        </div>
        <template v-if="trade">
          <div class="form-grid">
            <label
              >{{
                trade.kind === "opening"
                  ? "期初每股成本 · 元"
                  : "成交均价 · 元"
              }}<input v-model="tradeForm.price" inputmode="decimal"
            /></label>
            <label
              >数量 · 股/份<input
                v-model="tradeForm.quantity"
                inputmode="numeric"
            /></label>
          </div>
          <label v-if="trade.kind === 'opening'"
            >期初当日可卖数量<input
              v-model="tradeForm.available"
              inputmode="numeric"
          /></label>
          <template v-else>
            <label
              >手续费口径<select v-model="tradeForm.feeSource">
                <option value="estimated">按本条记录原费率估算</option>
                <option value="actual">按交割单填写实际手续费</option>
              </select></label
            >
            <div v-if="tradeForm.feeSource === 'actual'" class="actual-fees">
              <label
                >佣金 · 元<input
                  v-model="tradeForm.actualFees.commission"
                  inputmode="decimal"
              /></label>
              <label
                >印花税 · 元<input
                  v-model="tradeForm.actualFees.stamp"
                  inputmode="decimal"
              /></label>
              <label
                >过户费 · 元<input
                  v-model="tradeForm.actualFees.transfer"
                  inputmode="decimal"
              /></label>
            </div>
            <p class="footnote" v-else>
              使用历史佣金万{{ trade.profile?.commissionWan }}、最低{{
                trade.profile?.minimum
              }}元，卖出印花税{{ trade.profile?.stampPercent }}%、双向过户费{{
                trade.profile?.transferPercent
              }}%，不使用当前账户设置。
            </p>
            <p class="footnote" v-if="tradeForm.feeSource === 'actual'">
              实际费用保持所填金额；修改价格或数量后请同步核对交割单。
            </p>
          </template>
          <label
            >备注（选填）<input v-model="tradeForm.note" maxlength="500"
          /></label>
          <p class="footnote">
            本次不改变所属证券。证券录错请先处理依赖的后续成交，再删除重录。
          </p>
        </template>
        <template v-else-if="cash">
          <label
            >流水类型<select v-model="cashForm.kind">
              <option
                v-for="(label, kind) in cashLabels"
                :key="kind"
                :value="kind"
                :disabled="
                  kind === 'legacy-balance' && cash.kind !== 'legacy-balance'
                "
              >
                {{ label }}
              </option>
            </select></label
          >
          <label
            >金额 · 元（填正数）<input
              v-model="cashForm.amount"
              inputmode="decimal"
          /></label>
          <label
            >备注（选填）<input v-model="cashForm.note" maxlength="500"
          /></label>
        </template>
      </fieldset>
      <div
        v-if="preview.ledger"
        class="history-impact"
        aria-label="账本重算预览"
      >
        <b>全账户：当前 → {{ deleting ? "删除后" : "修改后" }}</b>
        <dl>
          <div>
            <dt>账面资金</dt>
            <dd>{{ money(before.cash) }} → {{ money(preview.ledger.cash) }}</dd>
          </div>
          <div>
            <dt>净本金</dt>
            <dd>
              {{ money(before.capital) }} → {{ money(preview.ledger.capital) }}
            </dd>
          </div>
          <div>
            <dt>FIFO已实现</dt>
            <dd>
              {{ money(before.realized) }} →
              {{ money(preview.ledger.realized) }}
            </dd>
          </div>
          <div>
            <dt>利息等收入</dt>
            <dd>
              {{ money(before.income) }} → {{ money(preview.ledger.income) }}
            </dd>
          </div>
          <template v-if="trade">
            <div>
              <dt>该证券持仓</dt>
              <dd>
                {{ before.positions[trade.securityId]?.quantity || "0" }} →
                {{
                  preview.ledger.positions[trade.securityId]?.quantity || "0"
                }}
              </dd>
            </div>
            <div>
              <dt>剩余FIFO成本</dt>
              <dd>
                {{ money(before.positions[trade.securityId]?.cost ?? "0") }} →
                {{
                  money(preview.ledger.positions[trade.securityId]?.cost ?? "0")
                }}
              </dd>
            </div>
            <div v-if="!deleting && trade.kind !== 'opening'">
              <dt>本笔手续费</dt>
              <dd>
                {{ money(trade.fees?.total) }} →
                {{
                  money(
                    preview.next?.entries.find((e) => e.id === trade?.id)?.fees
                      ?.total,
                  )
                }}
              </dd>
            </div>
          </template>
        </dl>
        <p v-if="preview.ledger.cashWarnings" class="order-hint">
          改动后仍有历史负资金余额，需继续核对流水；不会因此虚构或补入本金。
        </p>
      </div>
    </div>
    <FloatingNotice
      :message="
        preview.error
          ? `无法${deleting ? '删除' : '保存'}：${preview.error}。原记录未改变；如后续卖出依赖此记录，请先修正后续成交。`
          : ''
      "
    />
    <div class="backup-actions">
      <button type="button" :disabled="saving" @click="emit('cancel')">
        取消
      </button>
      <button
        type="submit"
        :class="deleting ? 'destructive' : 'primary'"
        :disabled="saving || !preview.next"
      >
        {{
          saving
            ? "正在保存…"
            : deleting
              ? "确认删除这条记录"
              : "确认修改并重算"
        }}
      </button>
    </div>
  </form>
</template>

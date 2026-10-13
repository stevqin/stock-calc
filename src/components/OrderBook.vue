<script setup lang="ts">
import { computed, ref } from "vue";
import Decimal from "decimal.js";
import type { Quote } from "../quotes";
import { formatQuoteField, fieldValue } from "../quoteDetails";
const props = defineProps<{ quote?: Quote; compact?: boolean }>();
const unit = ref<"lots" | "amount">("lots");
const raw = computed(() => props.quote?.rawFields ?? []);
const rows = computed(() =>
  [5, 4, 3, 2, 1, -1, -2, -3, -4, -5].map((level) => {
    const sell = level > 0;
    const index = (sell ? 19 : 9) + (Math.abs(level) - 1) * 2;
    return {
      label: `${sell ? "卖" : "买"}${["一", "二", "三", "四", "五"][Math.abs(level) - 1]}`,
      sell,
      price: fieldValue(props.quote, {
        index,
        label: "",
        fallback: Math.abs(level) === 1 ? (sell ? "ask" : "bid") : undefined,
      }),
      volume: raw.value[index + 1] ?? "",
    };
  }),
);
const maxVolume = computed(() =>
  Math.max(1, ...rows.value.map((row) => Number(displayValue(row)) || 0)),
);
const difference = computed(() => {
  try {
    if (
      rows.value.some(
        (row) =>
          !row.volume.trim() ||
          !new Decimal(row.volume).isFinite() ||
          new Decimal(row.volume).lt(0),
      )
    )
      return "";
    return rows.value
      .reduce(
        (sum, row) => sum.plus(new Decimal(row.volume).mul(row.sell ? -1 : 1)),
        new Decimal(0),
      )
      .toFixed(0);
  } catch {
    return "";
  }
});
function price(value: string) {
  return Number(value) > 0 ? formatQuoteField(value, "元").slice(0, -1) : "—";
}
function priceTone(value: string) {
  const previous = fieldValue(props.quote, {
    index: 4,
    label: "",
    fallback: "previousClose",
  });
  if (!(Number(value) > 0) || !(Number(previous) > 0)) return "";
  return Number(value) > Number(previous)
    ? "up"
    : Number(value) < Number(previous)
      ? "down"
      : "";
}
function displayValue(row: { price: string; volume: string }) {
  try {
    if (!row.volume.trim()) return "";
    const lots = new Decimal(row.volume);
    if (!lots.isFinite() || lots.lt(0)) return "";
    if (unit.value === "lots") return lots.toString();
    if (!row.price.trim()) return "";
    const value = new Decimal(row.price);
    if (!value.isFinite() || value.lte(0)) return "";
    return value.mul(lots).mul(100).toString();
  } catch {
    return "";
  }
}
function displayText(row: { price: string; volume: string }) {
  const value = displayValue(row);
  if (!value) return "—";
  if (unit.value === "lots") return formatQuoteField(value);
  const amount = new Decimal(value);
  return amount.gte(10000)
    ? formatQuoteField(amount.div(10000).toString(), "万元", 2)
    : `${formatQuoteField(value, "", 2)}元`;
}
function depth(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? `${Math.min(100, (n / maxVolume.value) * 100)}%`
    : "0%";
}
</script>
<template>
  <aside class="quote-book">
    <h4>五档盘口</h4>
    <dl v-if="!compact" class="book-summary">
      <div>
        <dt>委比</dt>
        <dd>{{ formatQuoteField(raw[74] ?? "", "%") }}</dd>
      </div>
      <div>
        <dt title="五档买入委托量减去卖出委托量，单位为手">五档委差</dt>
        <dd>{{ formatQuoteField(difference) }}</dd>
      </div>
    </dl>
    <div class="book-columns">
      <span>档位</span><span>价格</span
      ><span class="book-unit"
        ><button
          type="button"
          :class="{ active: unit === 'lots' }"
          @click="unit = 'lots'"
        >
          手</button
        ><span>/</span
        ><button
          type="button"
          :class="{ active: unit === 'amount' }"
          title="委托额：每档价格 × 手数 × 100，单位元"
          @click="unit = 'amount'"
        >
          额
        </button></span
      >
    </div>
    <template v-for="(row, index) in rows" :key="row.label">
      <div v-if="index === 5 && !compact" class="book-last">
        <span>最新</span
        ><b :class="priceTone(quote?.latest ?? '')">{{
          price(quote?.latest ?? "")
        }}</b
        ><span :class="priceTone(quote?.latest ?? '')">{{
          formatQuoteField(
            fieldValue(quote, { index: 32, label: "", fallback: "change" }),
            "%",
          )
        }}</span>
      </div>
      <div
        class="book-row"
        :class="[row.sell ? 'sell' : 'buy', { 'book-buy-start': index === 5 }]"
      >
        <span>{{ row.label }}</span
        ><b :class="priceTone(row.price)">{{ price(row.price) }}</b>
        <span class="book-volume"
          ><i :style="{ width: depth(displayValue(row)) }"></i
          ><span>{{ displayText(row) }}</span></span
        >
      </div>
    </template>
    <dl v-if="!compact" class="book-summary book-bottom">
      <div>
        <dt>外盘</dt>
        <dd>{{ formatQuoteField(raw[7] ?? "", "手") }}</dd>
      </div>
      <div>
        <dt>内盘</dt>
        <dd>{{ formatQuoteField(raw[8] ?? "", "手") }}</dd>
      </div>
    </dl>
  </aside>
</template>
<style scoped>
.quote-book {
  min-width: 0;
  color: #26364a;
  font-variant-numeric: tabular-nums;
  border-left: 1px solid #e6eaf0;
  padding: 0 12px;
  background: #fff;
}
h4 {
  margin: 0;
  height: 32px;
  line-height: 32px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid #e6eaf0;
}
.book-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 9px 0;
  font-size: 10px;
}
.book-summary div {
  display: flex;
  flex: 1;
  justify-content: space-between;
  gap: 6px;
  white-space: nowrap;
}
dt {
  color: #7b8797;
}
dd {
  margin: 0;
}
.book-columns,
.book-row,
.book-last {
  display: grid;
  grid-template-columns: 30px minmax(44px, 1fr) minmax(60px, 1.2fr);
  gap: 6px;
  align-items: center;
}
.book-columns {
  font-size: 10px;
  color: #8390a1;
  height: 22px;
}
.book-columns > :not(:first-child),
.book-row > :not(:first-child),
.book-last > :not(:first-child) {
  text-align: right;
}
.book-row {
  height: 26px;
  min-height: 26px;
  box-sizing: border-box;
  white-space: nowrap;
  font-size: 11px;
}
.book-row > span:first-child {
  color: #657186;
}
.book-row b {
  font-weight: 500;
}
.book-volume {
  position: relative;
  line-height: 21px;
}
.book-volume i {
  position: absolute;
  right: 0;
  top: 2px;
  bottom: 2px;
  background: #e4435011;
}
.sell .book-volume i {
  background: #18936812;
}
.book-volume span {
  position: relative;
  padding-right: 2px;
}
.book-last {
  border-top: 1px solid #e6eaf0;
  border-bottom: 1px solid #e6eaf0;
  height: 34px;
  margin: 5px 0;
  font-size: 11px;
}
.book-last b {
  font-size: 15px;
  font-weight: 650;
}
.book-bottom {
  border-top: 1px solid #e6eaf0;
  padding-top: 10px;
  flex-direction: column;
}
.up {
  color: #c63c49;
}
.down {
  color: #16825d;
}
.book-buy-start {
  border-top: 1px solid #e6eaf0;
}
.book-unit {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
}
.book-unit button {
  appearance: none;
  padding: 0;
  margin: 0;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font: inherit;
  color: #8390a1;
  cursor: pointer;
}
.book-unit button.active {
  color: #3268cf;
  font-weight: 600;
}
.book-unit button:focus-visible {
  outline: none;
  text-decoration: underline;
}
</style>

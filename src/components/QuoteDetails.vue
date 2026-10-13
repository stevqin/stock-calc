<script setup lang="ts">
import { computed, watch, ref, onBeforeUnmount } from "vue";
import DailyStudies from "./DailyStudies.vue";
import { getChart, liveDaily } from "../market";
import type { Security } from "../sim/model";
import type { ChartData, ChartMode } from "../sim/chart";
import { yearReturn } from "../sim/indicators";
import OrderBook from "./OrderBook.vue";
import Decimal from "decimal.js";
import type { Quote } from "../quotes";
import {
  fieldLabels,
  fieldValue,
  formatQuoteField,
  quoteGroups,
  type QuoteField,
} from "../quoteDetails";
const props = defineProps<{
  quote?: Quote;
  security?: Security;
  mode?: ChartMode;
  heroOnly?: boolean;
  hideHero?: boolean;
}>();
const chipsVisible = ref(true);
function setChipVisible(visible: boolean) {
  chipsVisible.value = visible;
}
const dailyData = ref<ChartData>();
const currentDaily = computed(() =>
  dailyData.value ? liveDaily(dailyData.value, props.quote) : undefined,
);
const historyError = ref("");
let generation = 0;
watch(
  () => props.security?.id,
  async () => {
    const run = ++generation;
    dailyData.value = undefined;
    historyError.value = "";
    if (!props.security) return;
    try {
      const data = await getChart(
        props.security,
        "daily",
        () => run === generation,
      );
      if (run === generation) dailyData.value = data;
    } catch {
      if (run === generation) historyError.value = "历史行情暂不可用";
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
const week52 = computed(() =>
  yearReturn(
    dailyData.value?.bars ?? [],
    props.quote?.latest ?? "",
    (props.quote?.quoteTime ?? "").replace(
      /^(\d{4})(\d{2})(\d{2}).*/,
      "$1-$2-$3",
    ),
  ),
);
const phaseFields = [
  { index: 63, label: "5日", unit: "%" },
  { index: 70, label: "20日", unit: "%" },
  { index: 62, label: "年初至今", unit: "%" },
];
const catalog = new Map(
  quoteGroups
    .flatMap((group) => group.fields)
    .map((field) => [field.index, field]),
);
catalog.set(39, { index: 39, label: "市盈率 TTM", fallback: "peRatio" });
catalog.set(64, { index: 64, label: "股息率 TTM", unit: "%" });
catalog.set(58, { index: 58, label: "盘后成交额", unit: "万元" });
catalog.set(59, { index: 59, label: "盘后成交量", unit: "手" });
const columns = [
  [5, 4, 38, 49, 74, 47, 48, 67, 68, 64],
  [33, 34, 39, 52, 53, 46, 51, 8, 7],
  [36, 57, 45, 73, 44, 72, 43, 59, 58],
].map((indices) => indices.map((index) => catalog.get(index)!));
const primary = new Set([
  3,
  31,
  32,
  63,
  70,
  62,
  ...columns.flat().map((field) => field.index),
]);
const extras = computed(() =>
  quoteGroups
    .flatMap((group) => group.fields)
    .filter(
      (field) =>
        !primary.has(field.index) &&
        (props.quote?.kind === "etf" ||
          ![77, 78, 81].includes(field.index) ||
          fieldValue(props.quote, field).trim()),
    ),
);
const raw = computed(() => props.quote?.rawFields ?? []);
const signedFields = new Set([31, 32, 62, 63, 70, 74, 77]);
const priceFields = new Set([3, 5, 33, 34, 47, 48, 51]);
function tone(field: QuoteField): string {
  const value = fieldValue(props.quote, field);
  if (!value.trim()) return "";
  try {
    let change = new Decimal(value);
    if (priceFields.has(field.index)) {
      const previous = fieldValue(props.quote, {
        index: 4,
        label: "",
        fallback: "previousClose",
      });
      if (!previous || change.lte(0)) return "";
      change = change.minus(previous);
    } else if (!signedFields.has(field.index)) return "";
    return change.gt(0) ? "quote-up" : change.lt(0) ? "quote-down" : "";
  } catch {
    return "";
  }
}
</script>
<template>
  <section
    class="quote-details"
    :aria-label="heroOnly ? '股价概览' : '完整行情指标'"
  >
    <div v-if="!hideHero" class="quote-hero">
      <strong :class="tone({ index: 3, label: '', fallback: 'latest' })">{{
        formatQuoteField(quote?.latest ?? "", "元").replace(/元$/, "")
      }}</strong>
      <div
        class="quote-hero-change"
        :class="tone({ index: 32, label: '', fallback: 'change' })"
      >
        <span>{{
          formatQuoteField(fieldValue(quote, { index: 31, label: "" }), "元")
        }}</span
        ><span>{{
          formatQuoteField(
            fieldValue(quote, { index: 32, label: "", fallback: "change" }),
            "%",
          )
        }}</span>
      </div>
      <time>{{
        quote?.quoteTime?.replace(
          /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
          "$1-$2-$3 $4:$5:$6",
        ) || "等待行情"
      }}</time>
      <dl class="quote-phases">
        <div v-for="field in phaseFields" :key="field.index">
          <dt>{{ field.label }}</dt>
          <dd :class="tone(field)">
            {{ formatQuoteField(fieldValue(quote, field), "%", 2) }}
          </dd>
        </div>
        <div>
          <dt title="按52周前最近交易日收盘价及历史日线复权口径计算">52周</dt>
          <dd
            :class="
              week52 == null
                ? ''
                : week52 > 0
                  ? 'quote-up'
                  : week52 < 0
                    ? 'quote-down'
                    : ''
            "
          >
            {{
              week52 == null ? "—" : formatQuoteField(String(week52), "%", 2)
            }}
          </dd>
        </div>
      </dl>
    </div>
    <template v-if="!heroOnly">
      <div class="quote-reference-grid">
        <dl v-for="(column, index) in columns" :key="index">
          <div
            v-for="field in column"
            :key="field.index"
            :data-field="field.index"
          >
            <dt>{{ field.label }}</dt>
            <dd
              :class="tone(field)"
              :title="fieldValue(quote, field) || '接口未提供'"
            >
              {{ formatQuoteField(fieldValue(quote, field), field.unit, 2) }}
            </dd>
          </div>
        </dl>
      </div>
      <div
        class="quote-market-view"
        :class="{
          'quote-market-wide': mode === 'daily' || mode === 'five-day',
        }"
      >
        <div v-if="$slots.toolbar" class="quote-chart-toolbar">
          <slot name="toolbar" />
        </div>
        <div class="quote-chart-main">
          <slot name="chart" :set-chip-visible="setChipVisible" />
        </div>
        <DailyStudies
          v-if="mode === 'daily' && chipsVisible"
          :data="currentDaily"
          :quote="quote"
          :error="historyError"
        />
        <OrderBook
          v-else-if="!mode || mode === 'intraday'"
          :quote="quote"
          compact
        />
      </div>
      <details class="quote-extra">
        <summary>更多指标</summary>
        <dl class="quote-extra-grid">
          <div
            v-for="field in extras"
            :key="field.index"
            :data-field="field.index"
          >
            <dt>{{ field.label }}</dt>
            <dd :class="tone(field)">
              {{ formatQuoteField(fieldValue(quote, field), field.unit, 2) }}
            </dd>
          </div>
        </dl>
      </details>
      <details class="quote-raw">
        <summary>
          全部接口字段 <span>{{ raw.length }} 项</span>
        </summary>
        <p class="quote-detail-note">
          保留接口原值与顺序，空值显示“—”；未确认含义的字段按编号列出。
        </p>
        <p v-if="!raw.length" class="quote-detail-note">
          当前缓存未包含完整字段，获取新报价后补齐。
        </p>
        <dl>
          <div v-for="(value, index) in raw" :key="index">
            <dt>
              <small>{{ String(index).padStart(2, "0") }}</small
              >{{ fieldLabels.get(index) ?? "扩展字段" }}
            </dt>
            <dd>{{ value.trim() ? value : "—" }}</dd>
          </div>
        </dl>
      </details>
    </template>
  </section>
</template>
<style scoped>
.quote-details {
  color: #243044;
  font-variant-numeric: tabular-nums;
}
.quote-hero {
  position: relative;
  padding: 2px 0 10px;
}
.quote-hero > strong {
  display: block;
  font-size: 40px;
  line-height: 1.1;
  font-weight: 500;
  letter-spacing: -1px;
}
.quote-hero-change {
  display: flex;
  gap: 20px;
  font-size: 17px;
  margin-top: 7px;
}
.quote-hero time {
  position: absolute;
  right: 0;
  top: 7px;
  color: #8993a2;
  font-size: 11px;
}
.quote-reference-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
  padding: 2px 0 4px;
}
dl {
  margin: 0;
}
.quote-reference-grid dl > div,
.quote-extra-grid > div {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  min-height: 20px;
}
dt {
  color: #87919e;
  font-size: 12px;
  white-space: nowrap;
}
dd {
  margin: 0;
  text-align: right;
  font-size: 14px;
  font-weight: 450;
  overflow-wrap: anywhere;
}
.quote-up {
  color: #c83c4a;
}
.quote-down {
  color: #188552;
}
.quote-market-view {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 226px;
  border-top: 1px solid #e8edf2;
  margin-bottom: 12px;
}
.quote-chart-main {
  min-width: 0;
}
.quote-extra,
.quote-raw {
  padding: 10px 0;
  border-top: 1px solid #edf0f5;
  font-size: 11px;
}
summary {
  cursor: pointer;
  color: #788494;
}
summary span {
  margin-left: 8px;
}
.quote-extra-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px 26px;
  padding-top: 12px;
}
.quote-detail-note {
  font-size: 11px;
  color: #788494;
  line-height: 1.6;
}
.quote-raw dl > div {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #edf0f5;
}
.quote-raw dt small {
  display: inline;
  margin-right: 9px;
  font-size: 10px;
}
.quote-raw dd {
  font-size: 11px;
  white-space: pre-wrap;
}
@media (max-width: 760px) {
  .quote-reference-grid {
    gap: 16px;
  }
  dt {
    font-size: 10px;
  }
  dd {
    font-size: 12px;
  }
  .quote-market-view {
    grid-template-columns: minmax(0, 1fr) 190px;
  }
}
@media (max-width: 540px) {
  .quote-reference-grid {
    gap: 10px;
  }
  .quote-reference-grid dl > div {
    flex-direction: column;
    gap: 2px;
    margin-bottom: 9px;
  }
  .quote-market-view {
    grid-template-columns: minmax(0, 1fr) 160px;
  }
  .quote-extra-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.quote-phases {
  position: absolute;
  right: 0;
  top: 29px;
  display: grid;
  grid-template-columns: repeat(2, minmax(72px, 1fr));
  gap: 7px 18px;
  width: 220px;
}
.quote-phases > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.quote-phases dt {
  font-size: 10px;
}
.quote-phases dd {
  font-size: 12px;
}
.quote-market-view {
  grid-template-columns: minmax(0, 1fr) 180px;
}
.quote-reference-grid {
  gap: 16px;
}
.quote-reference-grid dt {
  font-size: 10px;
}
.quote-reference-grid dd {
  font-size: 12px;
}
@media (max-width: 540px) {
  .quote-phases {
    width: 185px;
    gap: 7px 10px;
  }
  .quote-market-view {
    grid-template-columns: minmax(0, 1fr) 155px;
  }
}
.quote-market-view.quote-market-wide {
  grid-template-columns: minmax(0, 1fr);
}
.quote-chart-toolbar {
  grid-column: 1 / -1;
}
.quote-chart-toolbar :deep(.segmented) {
  margin-top: 0;
  margin-bottom: 4px;
}
.quote-chart-main :deep(.drawer-chart) {
  height: 408px;
  min-height: 408px;
}
.quote-market-view {
  position: relative;
}
.quote-market-wide > :deep(.daily-studies) {
  position: absolute;
  top: 262px;
  right: 0;
  width: 134px;
  padding: 4px 0;
  background: white;
}
</style>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import Decimal from "decimal.js";
import PriceField from "./components/PriceField.vue";
import {
  calculateRoundTrip,
  holdingCost,
  priceDecimals,
  priceInput,
  solvePrice,
  tickSize,
  type FeeProfile,
} from "./core/calculator";
import { initialState, loadState, STORAGE_KEY } from "./state";
import { QuotePoller, quoteAge, validSymbol, type Quote } from "./quotes";

let restored = initialState();
try {
  restored = loadState(localStorage);
} catch {
  /* Use defaults when storage is disabled. */
}
const state = reactive(restored);
const quote = ref<Quote | null>(null);
const status = ref("输入代码获取参考行情，也可直接手动测算");
const notice = ref("");
const saveError = ref("");
const now = ref(Date.now());
const feeDetails = ref<HTMLDetailsElement | null>(null);
const assetLabel = computed(() => (state.asset === "stock" ? "股票" : "ETF"));
const unit = computed(() => (state.asset === "stock" ? "股" : "份"));
const precision = computed(() => priceDecimals(state.asset));
const tick = computed(() => tickSize(state.asset));
const fees = computed(() => state.profiles[state.asset]);
const buyFirst = computed(() => state.direction === "buy-first");
const variableLabel = computed(() =>
  buyFirst.value ? "卖出价" : "回补买入价",
);
const args = computed(() => ({
  asset: state.asset,
  quantity: state.quantity,
  buyPrice: state.buyPrice,
  sellPrice: state.sellPrice,
  fees: fees.value,
}));
function outcome<T>(fn: () => T): { value: T | null; error: string } {
  try {
    return { value: fn(), error: "" };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}
const result = computed(() => outcome(() => calculateRoundTrip(args.value)));
const solveArgs = computed(() => ({
  ...args.value,
  direction: state.direction,
  anchor: buyFirst.value ? state.buyPrice : state.sellPrice,
}));
const thresholds = computed(() =>
  outcome(() => ({
    breakEven: solvePrice({ ...solveArgs.value, target: "0" }),
    positive: solvePrice({ ...solveArgs.value, target: "0.01" }),
  })),
);
const targetResult = computed(() =>
  state.target === ""
    ? { value: null, error: "" }
    : outcome(() => solvePrice({ ...solveArgs.value, target: state.target })),
);
const holding = computed(() =>
  !state.holdingPrice || !state.holdingQuantity || !result.value.value
    ? { value: null, error: "" }
    : outcome(() =>
        holdingCost(
          state.holdingQuantity,
          state.holdingPrice,
          state.quantity,
          result.value.value!.net,
        ),
      ),
);
const feeRows: {
  key: keyof FeeProfile;
  label: string;
  unit: string;
  max: string;
}[] = [
  {
    key: "commissionWan",
    label: "佣金率（含规费）",
    unit: "万分之",
    max: "30",
  },
  { key: "minimum", label: "每边最低佣金", unit: "元", max: "10000" },
  { key: "stampPercent", label: "卖出印花税率", unit: "%", max: "1" },
  { key: "transferPercent", label: "双向过户费率", unit: "%", max: "1" },
];
const costRows = [
  { key: "amount", label: "成交金额" },
  { key: "commission", label: "佣金" },
  { key: "transfer", label: "过户费" },
  { key: "stamp", label: "印花税" },
  { key: "total", label: "手续费合计" },
  { key: "cash", label: "实际支出 / 收入" },
] as const;
const quoteIsOld = computed(
  () => !!quote.value && quoteAge(quote.value, now.value) > 60000,
);
const typeMismatch = computed(
  () =>
    quote.value &&
    quote.value.kind !== "unknown" &&
    quote.value.kind !== state.asset,
);
const rule = computed(() => {
  if (state.asset === "stock" || state.etfKind === "domestic")
    return "T+1 · 日内做T需已有可卖底仓。当天新买入的股票 / 境内股票ETF不能当天卖出。";
  if (state.etfKind === "unconfirmed")
    return "ETF类别未确认 · 仅计算利润，请先核对该基金是否支持T+0。";
  return "T+0品类 · 跨境、黄金、债券ETF通常支持当日回转，具体以该基金规则为准；先卖后买仍需可卖持仓。";
});
function format(
  value: string | undefined | null,
  digits = 2,
  signed = false,
): string {
  if (value == null) return "—";
  const d = new Decimal(value);
  const fixed = d.toFixed(digits);
  const [integer, fraction] = fixed.split(".");
  return `${signed && d.gt(0) ? "+" : ""}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? "." + fraction : ""}`;
}
const tone = (value?: string | null) =>
  value == null || new Decimal(value).isZero()
    ? ""
    : new Decimal(value).gt(0)
      ? "profit"
      : "loss";
const spreadRequired = computed(() => {
  const p = thresholds.value.value?.breakEven;
  if (!p) return null;
  return (
    buyFirst.value
      ? new Decimal(p).minus(state.buyPrice)
      : new Decimal(state.sellPrice).minus(p)
  ).toFixed(precision.value);
});
const ladder = computed(() => {
  const p = thresholds.value.value?.breakEven;
  if (!p) return [];
  return [-2, -1, 0, 1, 2].flatMap((offset) => {
    const price = new Decimal(p).plus(new Decimal(tick.value).mul(offset));
    if (price.lt(tick.value) || price.gt(1000000)) return [];
    const text = price.toFixed(precision.value);
    const r = calculateRoundTrip({
      ...args.value,
      buyPrice: buyFirst.value ? state.buyPrice : text,
      sellPrice: buyFirst.value ? text : state.sellPrice,
    });
    return [{ price: text, profit: r.net, offset }];
  });
});
function usePrice(value: string | null, field: "buyPrice" | "sellPrice") {
  if (!value) return;
  if (typeMismatch.value) {
    notice.value = "行情品种与测算品种不同，请先确认品种，避免套用错误费率。";
    return;
  }
  try {
    priceInput(value, state.asset);
    state[field] = new Decimal(value).toFixed(precision.value);
    notice.value = `已填入${field === "buyPrice" ? "买入价" : "卖出价"}，后续行情刷新不会覆盖`;
  } catch (e) {
    notice.value = e instanceof Error ? e.message : String(e);
  }
}
function applyThreshold(price: string | null | undefined) {
  if (price) state[buyFirst.value ? "sellPrice" : "buyPrice"] = price;
}
function rememberType() {
  if (validSymbol(state.market, state.code))
    state.confirmations[state.market + state.code] = {
      asset: state.asset,
      etfKind: state.etfKind,
    };
}
watch(
  () => [state.market, state.code],
  () => {
    poller.stop();
    quote.value = null;
    notice.value = "";
    status.value = "代码已修改，点击获取行情";
    const saved = state.confirmations[state.market + state.code];
    if (saved) {
      state.asset = saved.asset;
      state.etfKind = saved.etfKind;
    } else state.etfKind = "unconfirmed";
  },
  { flush: "sync" },
);
watch(
  state,
  () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveError.value = "";
    } catch {
      saveError.value = "本机保存不可用；当前仍可计算，但重启后不会保留输入。";
    }
  },
  { deep: true },
);
const poller = new QuotePoller(
  async (market, code) => {
    if (!isTauri()) throw new Error("浏览器预览不连接行情，请在Mac应用中使用");
    return invoke<Quote>("fetch_quote", { market, code });
  },
  (q) => {
    quote.value = q;
  },
  (s) => {
    status.value = s;
  },
);
function lookup() {
  quote.value = null;
  notice.value = "";
  poller.select(state.market, state.code);
}
function visibility() {
  poller.setVisible(document.visibilityState === "visible");
}
let clock: ReturnType<typeof setInterval>;
onMounted(() => {
  document.addEventListener("visibilitychange", visibility);
  visibility();
  clock = setInterval(() => {
    now.value = Date.now();
  }, 3000);
  if (validSymbol(state.market, state.code)) lookup();
});
onUnmounted(() => {
  poller.stop();
  clearInterval(clock);
  document.removeEventListener("visibilitychange", visibility);
});
</script>

<template>
  <div class="shell">
    <header class="app-header">
      <div class="brand">
        <div class="brand-mark">T<span>↗</span></div>
        <div>
          <h1>T刻 <span>做T计算器</span></h1>
          <p>先算清价差，再做决定。</p>
        </div>
      </div>
      <a
        class="settings-link"
        href="#fee-settings"
        @click="feeDetails && (feeDetails.open = true)"
        >费率设置 <span>↗</span></a
      >
    </header>

    <section class="quote-strip" aria-label="参考行情">
      <div class="quote-search">
        <span class="eyebrow">参考行情</span>
        <form @submit.prevent="lookup">
          <select v-model="state.market" aria-label="交易市场">
            <option value="sh">沪市</option>
            <option value="sz">深市</option></select
          ><input
            v-model="state.code"
            aria-label="证券代码"
            inputmode="numeric"
            maxlength="6"
            placeholder="输入6位代码"
          /><button class="primary compact" type="submit">获取行情</button>
        </form>
        <p class="quote-status">{{ status }}</p>
      </div>
      <div v-if="quote" class="quote-data">
        <div>
          <strong>{{ quote.name }}</strong
          ><span class="ticker"
            >{{ quote.market.toUpperCase() }} {{ quote.code }}</span
          ><b class="quote-price">{{ quote.latest }}</b>
        </div>
        <div class="quote-actions">
          <span>填入买价</span
          ><button @click="usePrice(quote.latest, 'buyPrice')">
            最新 {{ quote.latest }}</button
          ><button
            :disabled="!quote.ask"
            @click="usePrice(quote.ask, 'buyPrice')"
          >
            卖一 {{ quote.ask || "—" }}</button
          ><span>填入卖价</span
          ><button @click="usePrice(quote.latest, 'sellPrice')">
            最新 {{ quote.latest }}</button
          ><button
            :disabled="!quote.bid"
            @click="usePrice(quote.bid, 'sellPrice')"
          >
            买一 {{ quote.bid || "—" }}
          </button>
        </div>
        <p class="quote-time" :class="{ warning: quoteIsOld }">
          {{ quoteIsOld ? "非新鲜报价（可能休市 / 停牌 / 延迟） · " : "" }}报价
          {{ quote.quoteTime.slice(0, 8) }}
          {{ quote.quoteTime.slice(8).replace(/(..)(..)(..)/, "$1:$2:$3") }} ·
          腾讯公开行情，可能延迟
        </p>
      </div>
      <div v-else class="quote-empty">
        <span class="connection-icon">⌁</span>
        <div>
          <strong>行情作参考，测算由你掌握</strong>
          <p>输入价格即可计算 · 无网络也能使用</p>
        </div>
      </div>
    </section>
    <p v-if="typeMismatch" class="banner warning" role="alert">
      行情品种与当前测算品种不一致。请先切换下方「股票 / ETF」，再使用报价。
    </p>
    <p v-if="notice || saveError" class="banner" role="status">
      {{ saveError || notice }}
    </p>

    <main class="workspace">
      <section class="panel inputs-panel">
        <div class="section-heading">
          <h2>交易计划</h2>
          <span class="subtle">输入即算</span>
        </div>
        <div class="segmented asset-tabs" aria-label="证券品种">
          <button
            :class="{ active: state.asset === 'stock' }"
            :aria-pressed="state.asset === 'stock'"
            @click="
              state.asset = 'stock';
              rememberType();
            "
          >
            A股股票</button
          ><button
            :class="{ active: state.asset === 'etf' }"
            :aria-pressed="state.asset === 'etf'"
            @click="
              state.asset = 'etf';
              rememberType();
            "
          >
            场内 ETF
          </button>
        </div>
        <div v-if="state.asset === 'etf'" class="etf-kind">
          <label for="etf-kind">确认ETF类别</label
          ><select id="etf-kind" v-model="state.etfKind" @change="rememberType">
            <option value="unconfirmed">尚未确认</option>
            <option value="domestic">境内股票 ETF</option>
            <option value="cross-border">跨境 ETF</option>
            <option value="gold">黄金 ETF</option>
            <option value="bond">债券 ETF</option>
          </select>
        </div>
        <div class="direction-tabs" aria-label="做T方向">
          <button
            :class="{ selected: buyFirst }"
            :aria-pressed="buyFirst"
            @click="state.direction = 'buy-first'"
          >
            <span>↗</span> 先买后卖</button
          ><button
            :class="{ selected: !buyFirst }"
            :aria-pressed="!buyFirst"
            @click="state.direction = 'sell-first'"
          >
            <span>↘</span> 先卖后买
          </button>
        </div>
        <div class="prices" :class="{ reverse: !buyFirst }">
          <div class="buy-field">
            <PriceField
              id="buy-price"
              v-model="state.buyPrice"
              :label="buyFirst ? '买入价' : '回补买入价'"
              :tick="tick"
              :decimals="precision"
            />
          </div>
          <div class="sell-field">
            <PriceField
              id="sell-price"
              v-model="state.sellPrice"
              label="卖出价"
              :tick="tick"
              :decimals="precision"
            />
          </div>
        </div>
        <label class="field-label" for="quantity"
          >交易数量 <span>{{ unit }} · 买卖数量相同</span></label
        ><input
          id="quantity"
          v-model="state.quantity"
          class="quantity-input"
          inputmode="numeric"
          autocomplete="off"
        />
        <div class="quantity-shortcuts">
          <button
            v-for="q in [100, 200, 500, 1000]"
            :key="q"
            :class="{ selected: state.quantity === String(q) }"
            @click="state.quantity = String(q)"
          >
            {{ q }}{{ unit }}
          </button>
        </div>
        <div class="target-input">
          <label class="field-label" for="target"
            >想净赚多少 <span>选填 · 元</span></label
          ><input
            id="target"
            v-model="state.target"
            inputmode="decimal"
            placeholder="填写目标，反推成交价格"
          />
          <div v-if="state.target !== ''" class="target-answer">
            <span v-if="targetResult.error" class="warning">{{
              targetResult.error
            }}</span
            ><template v-else-if="targetResult.value"
              ><span
                >{{ buyFirst ? "至少卖到" : "最高回补价" }}
                <b>{{ format(targetResult.value, precision) }}</b></span
              ><button @click="applyThreshold(targetResult.value)">
                填入价格 ↗
              </button></template
            ><span v-else>支持的价格范围内无解</span>
          </div>
        </div>
        <p class="rule-note"><span>ⓘ</span>{{ rule }}</p>
      </section>

      <section class="panel result-panel" aria-label="测算结果">
        <div class="section-heading">
          <h2>这次做T，能赚多少？</h2>
          <span class="estimate-tag">扣费后估算</span>
        </div>
        <div v-if="result.error" class="invalid-state" role="alert">
          <span>—</span>
          <h3>补全交易计划</h3>
          <p>{{ result.error }}</p>
        </div>
        <template v-else-if="result.value">
          <div class="profit-summary" aria-live="polite">
            <span class="eyebrow">本次净利润</span>
            <div class="net-value" :class="tone(result.value.net)">
              <span class="currency">¥</span
              >{{ format(result.value.net, 2, true) }}
            </div>
            <p>
              {{
                new Decimal(result.value.net).gt(0)
                  ? "价差已覆盖预估手续费"
                  : new Decimal(result.value.net).lt(0)
                    ? "当前价差尚未覆盖手续费"
                    : "刚好覆盖手续费，尚未盈利"
              }}
            </p>
          </div>
          <div class="profit-equation">
            <div>
              <span>价差收益</span><b>{{ format(result.value.gross) }}</b>
            </div>
            <span class="operator">−</span>
            <div>
              <span>买卖手续费</span><b>{{ format(result.value.totalFees) }}</b>
            </div>
            <span class="operator">=</span>
            <div>
              <span>净利润</span
              ><b :class="tone(result.value.net)">{{
                format(result.value.net, 2, true)
              }}</b>
            </div>
          </div>
          <div class="thresholds">
            <div>
              <span>{{ buyFirst ? "保本最低卖价" : "保本最高回补价" }}</span
              ><strong
                >{{ format(thresholds.value?.breakEven, precision) }}
                <small>元</small></strong
              >
              <p>
                需要价差 {{ format(spreadRequired, precision) }} 元 / {{ unit }}
              </p>
            </div>
            <div>
              <span>{{ buyFirst ? "开始盈利卖价" : "开始盈利回补价" }}</span
              ><strong
                >{{ format(thresholds.value?.positive, precision) }}
                <small>元</small></strong
              >
              <p>扣费后净利润至少 0.01 元</p>
            </div>
          </div>
          <p v-if="thresholds.error" class="warning">{{ thresholds.error }}</p>
          <p v-else-if="!thresholds.value?.breakEven" class="warning">
            支持的价格范围内无保本解。
          </p>
          <div v-if="ladder.length" class="ladder">
            <div class="ladder-heading">
              <h3>差一档，会怎样？</h3>
              <span>点击价格，带入测算</span>
            </div>
            <div class="ladder-table">
              <button
                v-for="row in ladder"
                :key="row.price"
                :class="{ 'break-even': row.offset === 0 }"
                @click="applyThreshold(row.price)"
                :aria-label="`使用${variableLabel}${row.price}`"
              >
                <span>{{
                  row.offset === 0
                    ? "保本档"
                    : `${row.offset > 0 ? "+" : ""}${row.offset}档`
                }}</span
                ><strong>{{ format(row.price, precision) }}</strong
                ><b :class="tone(row.profit)">{{
                  format(row.profit, 2, true)
                }}</b>
              </button>
            </div>
            <p>{{ variableLabel }} / 元 <span>下行为扣费后净利润 / 元</span></p>
          </div>
          <div class="cash-summary">
            <div>
              <span>买入总支出</span
              ><b>¥ {{ format(result.value.buy.cash) }}</b>
            </div>
            <div>
              <span>卖出净收入</span
              ><b>¥ {{ format(result.value.sell.cash) }}</b>
            </div>
            <div>
              <span>本次买入含费单价</span
              ><b>¥ {{ format(result.value.unitCost, 4) }}</b>
            </div>
          </div>
        </template>
      </section>
    </main>

    <section class="bottom-grid">
      <details id="fee-settings" ref="feeDetails" class="panel details-panel">
        <summary>
          <span
            >手续费明细与设置
            <small
              >{{ assetLabel }} · 当前佣金万{{ fees.commissionWan }} / 最低{{
                fees.minimum
              }}元</small
            ></span
          ><span class="disclosure">＋</span>
        </summary>
        <div class="details-body">
          <p class="muted">
            初始为示例费率，非你的账户实际标准。请按交割单校准；佣金已含规费，不重复收取。
          </p>
          <div class="fee-inputs">
            <label v-for="field in feeRows" :key="field.key"
              >{{ field.label }}
              <div>
                <input
                  v-model="fees[field.key]"
                  :aria-label="`${assetLabel}${field.label}`"
                  inputmode="decimal"
                /><span>{{ field.unit }}</span>
              </div></label
            >
          </div>
          <table v-if="result.value" class="fee-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>买入 / 元</th>
                <th>卖出 / 元</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in costRows" :key="row.key">
                <td>{{ row.label }}</td>
                <td>{{ format(result.value.buy[row.key]) }}</td>
                <td>{{ format(result.value.sell[row.key]) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="warning">{{ result.error }}</p>
          <p class="muted">
            每项费用独立四舍五入到分，以实际交割单为准。股票、ETF设置分别保存在本机。
          </p>
        </div>
      </details>
      <details class="panel details-panel">
        <summary>
          <span>做T后持仓成本 <small>选填 · 查看每股摊薄变化</small></span
          ><span class="disclosure">＋</span>
        </summary>
        <div class="details-body">
          <div class="holding-inputs">
            <label
              >原持仓数量（{{ unit }}）<input
                v-model="state.holdingQuantity"
                aria-label="原持仓数量"
                inputmode="numeric"
                placeholder="例如 1000" /></label
            ><label
              >原每股 / 份成本（元）<input
                v-model="state.holdingPrice"
                aria-label="原每股成本"
                inputmode="decimal"
                placeholder="例如 10.00"
            /></label>
          </div>
          <div v-if="holding.value" class="holding-result">
            <span
              >{{ holding.value.before }} <i>→</i>
              <strong>{{ holding.value.after }}</strong></span
            >
            <p>
              每股 / 份{{
                new Decimal(holding.value.reduction).gte(0) ? "降低" : "增加"
              }}
              {{
                format(new Decimal(holding.value.reduction).abs().toString(), 4)
              }}
              元
            </p>
          </div>
          <p v-if="holding.error" class="warning">{{ holding.error }}</p>
          <p class="muted">
            按原持仓不变测算：（原总成本 − 本次净利润）÷
            原持仓。与买入均价不同，也不保证与券商成本显示一致。
          </p>
        </div>
      </details>
    </section>
    <footer>
      <p>
        仅做测算，不构成投资建议。假设买卖均按输入价成交，不保证成交、滑点或实际盈利；未计拆单的多次最低佣金。
      </p>
      <span>本机保存 · 无账户连接</span>
    </footer>
  </div>
</template>

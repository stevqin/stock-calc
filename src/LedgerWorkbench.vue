<script setup lang="ts">
import FloatingNotice from "./components/FloatingNotice.vue";
import {
  computed,
  onMounted,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  nextTick,
} from "vue";
import Decimal from "decimal.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import MarketChart from "./components/MarketChart.vue";
import StepField from "./components/StepField.vue";
import HistoryEditor from "./components/HistoryEditor.vue";
import SecuritySearch from "./components/SecuritySearch.vue";
import type { SecurityHit } from "./securitySearch";
import type { HistoryTarget } from "./sim/history";
import { QuotePoller, quoteAge, type Quote } from "./quotes";
import {
  replay,
  dayPair,
  validateAccount,
  validateSecurity,
} from "./sim/ledger";
import { loadAccount, saveAccount, exportAccount } from "./sim/repository";
import {
  shanghaiDate,
  localDateTime,
  fromShanghaiInput,
  type Account,
  type Security,
  type CashEntry,
} from "./sim/model";
import {
  manualAccount,
  upgradeAccount,
  draftRecord,
  insertRecord,
  draftCash,
  cashLabels,
} from "./sim/record";
import { estimatePlan, projectHolding, solvePlan } from "./sim/planner";
import type { ChartMode } from "./sim/chart";
import { validateFees, type Asset } from "./core/calculator";
import { readDraft, writeDraft, flushDrafts } from "./sim/drafts";
import { upgradeWorkspace } from "./sim/workspaceState";
import { marketQuotes } from "./market";
import { tradeLabels } from "./sim/tradeLabels";
const props = defineProps<{
  embedded?: boolean;
  initialTab?: string;
  symbol?: string;
  historySecurityId?: string;
  historyReadOnly?: boolean;
  action?: "record" | "cash" | "opening" | "security";
  snapshot?: { account: Account; revision: number };
}>();
const emit = defineEmits<{
  saved: [account: Account, revision: number];
  close: [];
}>();
defineExpose({
  flush: async () => {
    if (orderBusy.value) throw new Error("成交正在保存，请稍候再关闭");
    await flushDrafts();
  },
});
const orderBusy = ref(false),
  orderSaved = ref(false);
const duplicateDirection = ref<"buy" | "sell" | null>(null);
const legacyDrafts = ref<
  { key: string; label: string; data: Record<string, unknown> }[]
>([]);
const loadedLegacy = ref("");
const duplicateWarning = ref(false),
  duplicateAck = ref(false),
  draftReady = ref(false),
  draftError = ref("");
const account = ref<Account>(manualAccount()),
  ready = ref(false),
  fatal = ref(""),
  saving = ref(false),
  message = ref(""),
  error = ref("");
let revision = 0;
const selected = ref("sh510300"),
  mode = ref<ChartMode>("intraday"),
  tab = ref("holdings"),
  modal = ref<"cash" | "security" | "opening" | "restore" | "history" | "">("");
const historyTarget = ref<HistoryTarget>();
const tradeTypeLabels = computed(() => tradeLabels(account.value.entries));
const historyFilterId = ref("");
const historySearchKey = ref(0);
const historyFilterSecurity = computed(() =>
  account.value.securities.find((s) => s.id === historyFilterId.value),
);
const historySecurities = computed<SecurityHit[]>(() => {
  const ids = new Set(account.value.entries.map((entry) => entry.securityId));
  return account.value.securities.filter((security) => ids.has(security.id));
});
const historyCompact = computed(
  () => !!props.historySecurityId && !!props.historyReadOnly,
);
const effectiveHistorySecurityId = computed(
  () => props.historySecurityId || historyFilterId.value,
);
const tradeRows = computed(() =>
  account.value.entries
    .filter(
      (e) =>
        !effectiveHistorySecurityId.value ||
        e.securityId === effectiveHistorySecurityId.value,
    )
    .slice()
    .reverse(),
);
function openHistory(
  scope: HistoryTarget["scope"],
  id: string,
  action: HistoryTarget["action"],
) {
  if (saving.value) return;
  error.value = "";
  historyTarget.value = { scope, id, action };
  modal.value = "history";
}
function filterHistory(hit: SecurityHit) {
  historyFilterId.value = hit.market + hit.code;
}
function clearHistoryFilter() {
  historyFilterId.value = "";
  historySearchKey.value += 1;
}
async function saveHistory(next: Account) {
  const deleting = historyTarget.value?.action === "delete";
  if (
    await commit(
      (a) => Object.assign(a, next),
      deleting
        ? "记录已删除，持仓、资金与收益已重算；可通过操作前账户备份恢复"
        : "历史记录已修改，持仓、资金与收益已重算",
    )
  )
    modal.value = "";
}
const query = ref(""),
  orderPrice = ref(""),
  orderQty = ref("100");
const orderPriceInput = ref<HTMLInputElement>();
const tradePriceLocked = ref(false);
const tradeTime = ref(localDateTime()),
  tradeNote = ref(""),
  feeSource = ref<"estimated" | "actual">("estimated");
const actualFees = reactive({ commission: "", stamp: "", transfer: "" });
const cashForm = reactive({
  kind: "deposit" as Exclude<CashEntry["kind"], "legacy-balance">,
  amount: "",
  time: localDateTime(),
  note: "",
});
const cashRows = computed(() =>
  [...(account.value.cashEntries ?? [])].sort((a, b) =>
    b.time.localeCompare(a.time),
  ),
);
function recordTime() {
  return fromShanghaiInput(tradeTime.value);
}
let previousFocus: HTMLElement | null = null;
watch(modal, async (value) => {
  if (value) {
    previousFocus = document.activeElement as HTMLElement;
    await nextTick();
    document
      .querySelector<HTMLElement>(".modal input, .modal select, .modal button")
      ?.focus();
  } else previousFocus?.focus();
});
function dialogKeys(e: KeyboardEvent) {
  if (!modal.value) return;
  if (e.key === "Escape" && !saving.value) {
    modal.value = "";
    return;
  }
  if (e.key !== "Tab") return;
  const nodes = [
    ...document.querySelectorAll<HTMLElement>(
      ".modal button:not(:disabled),.modal input:not(:disabled),.modal select:not(:disabled)",
    ),
  ];
  if (!nodes.length) return;
  const first = nodes[0],
    last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
const quotes = reactive<Record<string, Quote>>({}),
  quoteStatus = ref("等待行情"),
  clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval>;
const security = computed(
  () =>
    account.value.securities.find((s) => s.id === selected.value) ??
    account.value.securities[0],
);
const ledger = computed(() =>
  replay(account.value, shanghaiDate(new Date(clock.value))),
);
const position = computed(() =>
  security.value ? ledger.value.positions[security.value.id] : undefined,
);
const quote = computed(() =>
  security.value ? quotes[security.value.id] : undefined,
);
const todayPair = computed(() =>
  dayPair(
    account.value.entries,
    selected.value,
    shanghaiDate(new Date(clock.value)),
  ),
);
const securities = computed(() =>
  account.value.securities.filter((s) =>
    `${s.name}${s.code}`.includes(query.value.trim()),
  ),
);
const holdings = computed(() =>
  account.value.securities.filter((s) =>
    new Decimal(ledger.value.positions[s.id]?.quantity ?? 0).gt(0),
  ),
);
const valuation = computed(() => {
  let market = new Decimal(0),
    cost = new Decimal(0),
    missing = 0,
    stale = 0;
  for (const s of holdings.value) {
    const p = ledger.value.positions[s.id],
      q = quotes[s.id];
    cost = cost.plus(p.cost);
    if (!q) {
      missing++;
      continue;
    }
    if (quoteAge(q, clock.value) > 60000) stale++;
    market = market.plus(new Decimal(p.quantity).mul(q.latest));
  }
  return {
    market: missing ? null : market.toFixed(2),
    floating: missing ? null : market.minus(cost).toFixed(2),
    total: missing ? null : market.plus(ledger.value.cash).toFixed(2),
    missing,
    stale,
  };
});
function previewOrder(direction: "buy" | "sell") {
  try {
    const value = draftRecord(
      account.value,
      selected.value,
      direction,
      orderPrice.value,
      orderQty.value,
      recordTime(),
      tradeNote.value,
      feeSource.value === "actual" ? { ...actualFees } : undefined,
    );
    return { value, error: "" };
  } catch (e) {
    return { value: null, error: String(e instanceof Error ? e.message : e) };
  }
}
const orderPreviews = computed(() => ({
  buy: previewOrder("buy"),
  sell: previewOrder("sell"),
}));
const sellProfitPreview = computed(() => {
  const preview = orderPreviews.value.sell.value;
  if (!preview) return null;
  try {
    const entry = preview.entry;
    const prior = replay(
      {
        ...account.value,
        entries: account.value.entries.filter(
          (item) => item.time <= entry.time,
        ),
      },
      entry.date,
    ).positions[selected.value];
    let remaining = new Decimal(entry.quantity),
      fifoCost = new Decimal(0);
    for (const lot of prior?.lots ?? []) {
      if (remaining.lte(0)) break;
      const quantity = new Decimal(lot.quantity);
      const taken = Decimal.min(remaining, quantity);
      fifoCost = fifoCost.plus(new Decimal(lot.cost).mul(taken).div(quantity));
      remaining = remaining.minus(taken);
    }
    if (remaining.gt(0)) return null;
    const profit = new Decimal(entry.fees!.cash).minus(fifoCost);
    return {
      cost: fifoCost.toFixed(2),
      profit: profit.toFixed(2),
      percent: fifoCost.gt(0) ? profit.div(fifoCost).mul(100).toFixed(2) : null,
    };
  } catch {
    return null;
  }
});
function fillAvailablePosition() {
  const available = position.value?.available;
  if (available && new Decimal(available).gt(0)) orderQty.value = available;
}
const feeForms = reactive(
  JSON.parse(JSON.stringify(account.value.profiles)) as Account["profiles"],
);
const addForm = reactive({
  market: "sh" as "sh" | "sz",
  code: "",
  name: "",
  asset: "etf" as Asset,
  category: "domestic" as Security["category"],
  settlement: "T+1" as Security["settlement"],
});
const opening = reactive({
  quantity: "1000",
  price: "",
  available: "1000",
  time: localDateTime(),
});
const plan = reactive({
  buyPrice: "",
  sellPrice: "",
  buyQty: "100",
  sellQty: "100",
});
const plannerMode = ref<"forward" | "reverse">("forward");
const reversePlan = reactive({
  fixedPrice: "",
  buyQty: "100",
  sellQty: "100",
  target: "10",
  direction: "sell" as "buy" | "sell",
});
const priceLocked = reactive({
  buyPrice: false,
  sellPrice: false,
  reverse: false,
});
const priceTick = computed(() =>
  security.value?.asset === "stock" ? "0.01" : "0.001",
);
const priceDecimals = computed(() =>
  security.value?.asset === "stock" ? 2 : 3,
);
let planTimer: ReturnType<typeof setInterval>;
function followTradePrice() {
  if (
    !ready.value ||
    document.hidden ||
    tradePriceLocked.value ||
    orderBusy.value ||
    orderSaved.value ||
    saving.value ||
    (props.embedded && (props.action !== "record" || !draftReady.value))
  )
    return;
  const q = quote.value;
  if (!q || q.market + q.code !== selected.value) return;
  try {
    const price = new Decimal(q.latest);
    if (price.isFinite() && price.gt(0))
      orderPrice.value = price
        .toNearest(priceTick.value)
        .toFixed(priceDecimals.value);
  } catch {
    /* Unavailable/invalid quotes must not erase the current price. */
  }
}
function resumeTradePrice() {
  tradePriceLocked.value = false;
  followTradePrice();
}
watch(() => [ready.value, draftReady.value, quote.value], followTradePrice);
function followPrices() {
  if (!ready.value || tab.value !== "planner" || document.hidden) return;
  const q = quote.value;
  if (!q || q.market + q.code !== selected.value) return;
  try {
    const price = new Decimal(q.latest);
    if (!price.isFinite() || !price.gt(0)) return;
    for (const key of ["buyPrice", "sellPrice"] as const)
      if (!priceLocked[key])
        plan[key] = price
          .toNearest(priceTick.value)
          .toFixed(priceDecimals.value);
    if (!priceLocked.reverse)
      reversePlan.fixedPrice = price
        .toNearest(priceTick.value)
        .toFixed(priceDecimals.value);
  } catch {
    /* Invalid/missing quotes never overwrite a price. */
  }
}
function editPlanPrice(
  key: "buyPrice" | "sellPrice" | "reverse",
  value: string,
) {
  priceLocked[key] = true;
  if (key === "reverse") reversePlan.fixedPrice = value;
  else plan[key] = value;
}
function resumePrice(key: "buyPrice" | "sellPrice" | "reverse") {
  priceLocked[key] = false;
  followPrices();
}
watch(() => [ready.value, tab.value, quote.value], followPrices);
watch(selected, () => {
  tradePriceLocked.value = false;
  plan.buyPrice = "";
  plan.sellPrice = "";
  reversePlan.fixedPrice = "";
  priceLocked.buyPrice = false;
  priceLocked.sellPrice = false;
  priceLocked.reverse = false;
  followPrices();
});
const tradeDraftKey = () => `trade:${selected.value}:entry`;
function validTradeDraft(d: unknown): d is Record<string, unknown> {
  return (
    !!d &&
    typeof d === "object" &&
    ["price", "quantity", "time", "note", "feeSource"].every(
      (k) => typeof (d as Record<string, unknown>)[k] === "string",
    )
  );
}
function restoreTradeDraft(d: Record<string, unknown>) {
  orderPrice.value = d.price as string;
  // Older drafts with a price are manual: never replace historical fills.
  tradePriceLocked.value =
    d.priceMode === "manual" ||
    (d.priceMode !== "follow" && !!orderPrice.value);
  orderQty.value = d.quantity as string;
  tradeTime.value = d.time as string;
  tradeNote.value = d.note as string;
  feeSource.value = d.feeSource === "actual" ? "actual" : "estimated";
  for (const key of ["commission", "stamp", "transfer"] as const) {
    const v =
      d.fees && typeof d.fees === "object"
        ? (d.fees as Record<string, unknown>)[key]
        : "";
    actualFees[key] = typeof v === "string" ? v : "";
  }
  const legacyKeys = ["buy", "sell"]
    .map((side) => `trade:${selected.value}:${side}`)
    .concat(`trade:${selected.value}`);
  loadedLegacy.value =
    typeof d.legacyKey === "string" && legacyKeys.includes(d.legacyKey)
      ? d.legacyKey
      : "";
}
function loadLegacyDraft(key: string) {
  const d = legacyDrafts.value.find((d) => d.key === key);
  if (!d) return;
  restoreTradeDraft(d.data);
  tradePriceLocked.value = true;
  loadedLegacy.value = key;
}
function holdingAfter(result: ReturnType<typeof estimatePlan>) {
  const position = ledger.value.positions[selected.value];
  return projectHolding(
    result,
    position?.quantity ?? "0",
    position?.netInvestment ?? "0",
    quote.value?.latest,
  );
}
const forwardResult = computed(() => {
  try {
    if (!security.value || !account.value.feeConfirmed[security.value.asset])
      throw new Error("先在费用设置中确认实际佣金率");
    const p = {
      ...plan,
      asset: security.value.asset,
      fees: account.value.profiles[security.value.asset],
    };
    const result = estimatePlan(p);
    return { result, holding: holdingAfter(result), error: "" };
  } catch (e) {
    return {
      result: null,
      holding: null,
      error: String(e instanceof Error ? e.message : e),
    };
  }
});
const reverseResult = computed(() => {
  try {
    if (!security.value || !account.value.feeConfirmed[security.value.asset])
      throw new Error("先在费用设置中确认实际佣金率");
    const p = {
      asset: security.value.asset,
      fees: account.value.profiles[security.value.asset],
      buyQty: reversePlan.buyQty,
      sellQty: reversePlan.sellQty,
      buyPrice: reversePlan.fixedPrice,
      sellPrice: reversePlan.fixedPrice,
    };
    const solved = solvePlan(
      p,
      reversePlan.direction,
      reversePlan.target || "0",
    );
    if (!solved) throw new Error("当前条件下目标价格无解");
    const solvedPlan = {
      ...p,
      [reversePlan.direction === "sell" ? "sellPrice" : "buyPrice"]: solved,
    };
    const result = estimatePlan(solvedPlan),
      breakeven = solvePlan(p, reversePlan.direction, "0"),
      profit = solvePlan(p, reversePlan.direction, "0.01");
    const tick = new Decimal(security.value.asset === "stock" ? ".01" : ".001");
    const levels = breakeven
      ? [-2, -1, 0, 1, 2]
          .map((i) => new Decimal(breakeven).plus(tick.mul(i)))
          .filter((p) => p.gt(0))
          .map((price) => ({
            price: price.toFixed(security.value!.asset === "stock" ? 2 : 3),
            profit: estimatePlan({
              ...p,
              [reversePlan.direction === "sell" ? "sellPrice" : "buyPrice"]:
                price.toString(),
            }).profit,
          }))
      : [];
    return {
      result,
      holding: holdingAfter(result),
      solved,
      breakeven,
      profit,
      levels,
      error: "",
    };
  } catch (e) {
    return {
      result: null,
      holding: null,
      solved: null,
      breakeven: null,
      profit: null,
      levels: [],
      error: String(e instanceof Error ? e.message : e),
    };
  }
});
const backupFile = ref<HTMLInputElement>(),
  pendingRestore = ref<Account>();
function money(value: string | number | null | undefined, digits = 2) {
  if (value == null) return "—";
  try {
    return new Decimal(value).toNumber().toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return "—";
  }
}
function percent(value: string | null | undefined) {
  return value == null
    ? "—"
    : `${new Decimal(value).gt(0) ? "+" : ""}${money(value)}%`;
}
function tone(value: string | null | undefined) {
  return value && new Decimal(value).gt(0)
    ? "gain"
    : value && new Decimal(value).lt(0)
      ? "loss"
      : "flat";
}
function notifyError(e: unknown) {
  error.value = e instanceof Error ? e.message : String(e);
  message.value = "";
}
function reload() {
  window.location.reload();
}
async function commit(change: (a: Account) => void, success = "已保存到本机") {
  if (saving.value) return false;
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    const next = JSON.parse(JSON.stringify(account.value)) as Account;
    change(next);
    validateAccount(next);
    revision = await saveAccount(next, revision);
    account.value = next;
    message.value = success;
    emit("saved", next, revision);
    return true;
  } catch (e) {
    notifyError(e);
    return false;
  } finally {
    saving.value = false;
  }
}
const poller = new QuotePoller(
  async (market, code) => {
    if (!isTauri()) throw new Error("浏览器预览，请打开桌面版");
    return invoke<Quote>("fetch_quote", { market, code });
  },
  (q) => {
    quotes[q.market + q.code] = q;
  },
  (s) => (quoteStatus.value = s),
);
async function select(s: Security) {
  if (saving.value || selected.value === s.id) return;
  selected.value = s.id;
  orderPrice.value = "";
  plan.buyPrice = "";
  plan.sellPrice = "";
  poller.select(s.market, s.code);
  await commit((a) => (a.selectedId = s.id), "已切换证券");
}
function visibility() {
  poller.setVisible(!document.hidden);
}
function fill(price: string | null | undefined) {
  if (price) {
    tradePriceLocked.value = true;
    orderPrice.value = price;
  }
}
async function saveCash() {
  if (
    await commit((a) => {
      const e = draftCash(
        cashForm.kind,
        cashForm.amount,
        fromShanghaiInput(cashForm.time),
        cashForm.note,
      );
      a.cashEntries!.push(e);
      a.cashEntries!.sort((a, b) => a.time.localeCompare(b.time));
    }, "资金流水已保存，余额和收益已重新计算")
  ) {
    modal.value = "";
    cashForm.amount = "";
    cashForm.note = "";
    tab.value = "cash";
  }
}
async function placeOrder(direction: "buy" | "sell") {
  if (orderBusy.value || orderSaved.value || saving.value) return;
  const preview = orderPreviews.value[direction];
  if (!preview.value) {
    error.value = preview.error;
    return;
  }
  let time = "";
  try {
    time = recordTime();
  } catch (e) {
    notifyError(e);
    return;
  }
  const duplicate = account.value.entries.some(
    (e) =>
      e.securityId === selected.value &&
      e.kind === direction &&
      e.time.slice(0, 19) === time.slice(0, 19) &&
      new Decimal(e.price).eq(orderPrice.value) &&
      new Decimal(e.quantity).eq(orderQty.value),
  );
  if (
    duplicate &&
    (!duplicateAck.value || duplicateDirection.value !== direction)
  ) {
    duplicateDirection.value = direction;
    duplicateAck.value = false;
    duplicateWarning.value = true;
    return;
  }
  orderBusy.value = true;
  try {
    if (
      await commit((a) => {
        const { entry } = draftRecord(
          a,
          selected.value,
          direction,
          orderPrice.value,
          orderQty.value,
          time,
          tradeNote.value,
          feeSource.value === "actual" ? { ...actualFees } : undefined,
        );
        insertRecord(a, entry);
      }, "历史成交已记录，仅更新本机账本，不发送委托")
    ) {
      orderSaved.value = true;
      draftReady.value = false;
      tab.value = "trades";
      tradeNote.value = "";
      duplicateWarning.value = false;
      duplicateAck.value = false;
      if (props.embedded) {
        try {
          if (loadedLegacy.value) await writeDraft(loadedLegacy.value, null);
          await writeDraft(tradeDraftKey(), null);
          orderBusy.value = false;
          emit("close");
        } catch {
          error.value =
            "成交已保存，但旧草稿清理失败。请勿重复录入，重新打开前先核对历史成交。";
        }
      } else {
        orderPrice.value = "";
        orderSaved.value = false;
      }
    }
  } finally {
    orderBusy.value = false;
  }
}
async function saveFees(asset: Asset) {
  await commit(
    (a) => {
      validateFees(feeForms[asset]);
      a.profiles[asset] = { ...feeForms[asset] };
      a.feeConfirmed[asset] = true;
    },
    `${asset === "etf" ? "ETF" : "股票"}费率已确认；历史成交费用不变`,
  );
}
async function lookup() {
  error.value = "";
  try {
    if (!isTauri()) throw new Error("浏览器预览请手动填写名称，桌面版支持查询");
    const q = await invoke<Quote>("fetch_quote", {
      market: addForm.market,
      code: addForm.code,
    });
    addForm.name = q.name;
    if (q.kind !== "unknown") addForm.asset = q.kind;
    message.value = "已取得名称；请自行确认ETF类别和回转规则";
  } catch (e) {
    notifyError(e);
  }
}
async function addSecurity() {
  const s: Security = {
    ...addForm,
    id: addForm.market + addForm.code,
    category: addForm.asset === "stock" ? "stock" : addForm.category,
    settlement:
      addForm.asset === "stock" || addForm.category === "domestic"
        ? "T+1"
        : addForm.settlement,
  };
  if (
    await commit((a) => {
      validateSecurity(s);
      if (a.securities.some((x) => x.id === s.id))
        throw new Error("该证券已在自选列表");
      a.securities.push(s);
      if (a.workspace && !a.workspace.watchlist.includes(s.id))
        a.workspace.watchlist.push(s.id);
      a.selectedId = s.id;
    })
  ) {
    selected.value = s.id;
    orderPrice.value = "";
    poller.select(s.market, s.code);
    modal.value = "";
  }
}
async function addOpening() {
  if (
    await commit((a) => {
      const time = fromShanghaiInput(opening.time);
      insertRecord(a, {
        id: crypto.randomUUID(),
        securityId: selected.value,
        kind: "opening",
        quantity: opening.quantity,
        price: opening.price,
        available: opening.available,
        time,
        date: shanghaiDate(new Date(time)),
      });
    }, "期初持仓已记住；以后从自选列表选择即可")
  )
    modal.value = "";
}
async function backup() {
  try {
    message.value = await exportAccount(account.value);
  } catch (e) {
    notifyError(e);
  }
}
function prepareRestore(raw: unknown) {
  try {
    const base = upgradeAccount(raw);
    const restored = props.embedded ? upgradeWorkspace(base) : base;
    pendingRestore.value = restored;
    modal.value = "restore";
  } catch (e) {
    notifyError(e);
  }
}
async function importBackup() {
  try {
    if (isTauri()) {
      const text = await invoke<string | null>("read_backup");
      if (text) prepareRestore(JSON.parse(text));
    } else backupFile.value?.click();
  } catch (e) {
    notifyError(e);
  }
}
async function filePicked(event: Event) {
  try {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) throw new Error("文件超过16MB");
    const v = JSON.parse(await file.text());
    if (v.format !== "t-calculator-backup" || ![2, 3, 4].includes(v.version))
      throw new Error("备份格式不支持");
    prepareRestore(v.account);
  } catch (e) {
    notifyError(e);
  } finally {
    (event.target as HTMLInputElement).value = "";
  }
}
async function restore() {
  if (!pendingRestore.value) return;
  const value = pendingRestore.value;
  if (
    await commit(
      (a) => Object.assign(a, value),
      "已恢复备份；恢复前数据保留在桌面数据库恢复快照中",
    )
  ) {
    selected.value = account.value.selectedId;
    orderPrice.value = "";
    plan.buyPrice = "";
    plan.sellPrice = "";
    Object.assign(feeForms, JSON.parse(JSON.stringify(account.value.profiles)));
    modal.value = "";
    if (security.value)
      poller.select(security.value.market, security.value.code);
  }
}
onMounted(async () => {
  try {
    const loaded = await loadAccount();
    account.value = upgradeAccount(loaded.account);
    revision = loaded.revision;
    selected.value = account.value.selectedId;
    Object.assign(feeForms, JSON.parse(JSON.stringify(account.value.profiles)));
    ready.value = true;
    if (props.embedded) {
      selected.value = props.symbol ?? account.value.selectedId;
      tab.value = props.initialTab ?? "trades";
      Object.assign(quotes, marketQuotes);
      if (props.action && props.action !== "record") modal.value = props.action;
      if (props.action === "record") {
        try {
          const d = await readDraft(tradeDraftKey());
          if (d && !validTradeDraft(d)) throw new Error("草稿格式无效");
          if (validTradeDraft(d)) restoreTradeDraft(d);
          for (const suffix of ["buy", "sell", ""]) {
            const key = `trade:${selected.value}${suffix ? ":" + suffix : ""}`;
            const legacy = await readDraft(key);
            if (validTradeDraft(legacy))
              legacyDrafts.value.push({
                key,
                label:
                  suffix === "buy"
                    ? "旧买入草稿"
                    : suffix === "sell"
                      ? "旧卖出草稿"
                      : "旧成交草稿",
                data: legacy,
              });
          }
        } catch {
          draftError.value = "草稿读取失败，未覆盖旧草稿";
        }
        draftReady.value = !draftError.value;
        await nextTick();
        orderPriceInput.value?.focus();
      }
    }
    if (security.value && !props.embedded)
      poller.select(security.value.market, security.value.code);
  } catch (e) {
    fatal.value = String(e);
  }
  clockTimer = setInterval(() => (clock.value = Date.now()), 15000);
  followTradePrice();
  planTimer = setInterval(() => {
    followPrices();
    followTradePrice();
  }, 3000);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("keydown", dialogKeys);
});
onBeforeUnmount(() => {
  poller.stop();
  clearInterval(clockTimer);
  clearInterval(planTimer);
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("keydown", dialogKeys);
});
watch(
  () => props.snapshot,
  (snapshot) => {
    if (!snapshot || !ready.value || snapshot.revision === revision) return;
    account.value = JSON.parse(JSON.stringify(snapshot.account));
    revision = snapshot.revision;
    Object.assign(
      feeForms,
      JSON.parse(JSON.stringify(snapshot.account.profiles)),
    );
  },
);
watch(marketQuotes, () => {
  if (props.embedded) Object.assign(quotes, marketQuotes);
});
watch(
  () => [
    orderPrice.value,
    tradePriceLocked.value,
    orderQty.value,
    tradeTime.value,
    tradeNote.value,
    loadedLegacy.value,
    feeSource.value,
    ...Object.values(actualFees),
  ],
  () => {
    duplicateWarning.value = false;
    duplicateDirection.value = null;
    duplicateAck.value = false;
    if (draftReady.value)
      void writeDraft(tradeDraftKey(), {
        price: orderPrice.value,
        priceMode: tradePriceLocked.value ? "manual" : "follow",
        quantity: orderQty.value,
        time: tradeTime.value,
        note: tradeNote.value,
        legacyKey: loadedLegacy.value,
        feeSource: feeSource.value,
        fees: { ...actualFees },
      }).catch(() => (draftError.value = "草稿保存失败，请不要关闭窗口"));
  },
);
watch(modal, (next, prev) => {
  if (
    props.embedded &&
    props.action &&
    props.action !== "record" &&
    prev &&
    !next
  )
    emit("close");
});
let toastTimer: ReturnType<typeof setTimeout>;
watch(message, () => {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (message.value = ""), 3000);
});
onBeforeUnmount(() => clearTimeout(toastTimer));
</script>

<template>
  <main v-if="!ready" class="startup">
    <h1>T刻</h1>
    <p>
      {{
        fatal ? "账户读取失败，原数据未覆盖：" + fatal : "正在打开本机证券账本…"
      }}
    </p>
    <button v-if="fatal" @click="reload">重新加载</button>
  </main>
  <main
    v-else
    class="terminal"
    :class="{
      'ledger-embedded': embedded,
      'record-embedded': action === 'record',
    }"
  >
    <header class="topbar">
      <div class="brand">
        <span class="brand-symbol">T</span>
        <h1>T刻<span>证券账户账本</span></h1>
      </div>
      <div class="environment">
        <i></i>{{ isTauri() ? "本机账户 · SQLite" : "浏览器预览 · 独立本地数据"
        }}<span class="simulation-tag">手工同步 · 不连接券商</span>
      </div>
      <button class="subtle" @click="tab = 'fees'">费用设置</button
      ><button class="subtle" @click="tab = 'backup'">备份账户</button>
      <button class="primary" @click="modal = 'cash'">＋ 资金流水</button>
    </header>
    <section class="account-strip" aria-label="账户账面概况">
      <div>
        <span>账面总资产</span><strong>{{ money(valuation.total) }}</strong
        ><small v-if="valuation.missing"
          >{{ valuation.missing }}只持仓尚无报价，暂不汇总</small
        ><small v-else
          >现金 + 已获取报价的持仓市值{{
            valuation.stale ? " · 含延迟报价" : ""
          }}</small
        >
      </div>
      <div>
        <span>账面资金</span><strong>{{ money(ledger.cash) }}</strong
        ><small>净本金（含期初持仓） {{ money(ledger.capital) }}</small>
      </div>
      <div>
        <span>持仓市值</span><strong>{{ money(valuation.market) }}</strong
        ><small>{{ holdings.length }}只证券 · 点击自选更新报价</small>
      </div>
      <div>
        <span>累计已实现 · FIFO</span
        ><strong :class="tone(ledger.realized)">{{
          money(ledger.realized)
        }}</strong
        ><small>卖出净额 − FIFO持仓成本</small>
      </div>
      <div>
        <span>持仓浮动盈亏</span
        ><strong :class="tone(valuation.floating)">{{
          money(valuation.floating)
        }}</strong
        ><small>未扣预估卖出费用</small>
      </div>
      <div>
        <span>利息等收入</span
        ><strong :class="tone(ledger.income)">{{ money(ledger.income) }}</strong
        ><small>含逆回购利息 {{ money(ledger.repoInterest) }}</small>
      </div>
    </section>
    <FloatingNotice :message="error" />
    <FloatingNotice :message="message" kind="info" :duration="3000" />
    <FloatingNotice
      v-if="!embedded"
      :message="
        ledger.cashWarnings
          ? '待对账：存在历史负资金余额，请补齐真实资金流水。账面余额不代表券商可用余额。'
          : ''
      "
      kind="warning"
    />
    <div class="trading-layout">
      <aside class="watchlist panel">
        <div class="section-heading">
          <h2>自选 / 持仓</h2>
          <button
            class="icon-button"
            aria-label="添加证券"
            @click="modal = 'security'"
          >
            ＋
          </button>
        </div>
        <label class="search"
          ><span class="sr-only">搜索自选</span
          ><input v-model="query" placeholder="搜索名称 / 代码"
        /></label>
        <div class="watch-head">
          <span>证券</span><span>最新价 / 持仓</span>
        </div>
        <div class="watch-items">
          <button
            v-for="s in securities"
            :key="s.id"
            class="watch-row"
            :class="{ selected: selected === s.id }"
            :disabled="saving"
            @click="select(s)"
          >
            <span
              ><b>{{ s.name }}</b
              ><small
                >{{ s.code }}
                <em>{{ s.asset === "etf" ? "ETF" : "A股" }}</em></small
              ></span
            ><span
              ><b class="mono">{{
                money(quotes[s.id]?.latest, s.asset === "etf" ? 3 : 2)
              }}</b
              ><small
                >{{ ledger.positions[s.id]?.quantity || "—" }} 股/份</small
              ></span
            >
          </button>
          <p v-if="!securities.length" class="empty">没有匹配的自选</p>
        </div>
        <div class="watch-footer">
          证券与持仓保存在本机。<br />示例自选不代表持仓或推荐。
        </div>
      </aside>
      <section v-if="security" class="market panel">
        <div class="instrument">
          <div>
            <h2>
              {{ security.name }}
              <small
                >{{ security.market.toUpperCase() }} {{ security.code }}</small
              >
            </h2>
            <p>
              {{
                security.asset === "stock"
                  ? "A股"
                  : security.category === "domestic"
                    ? "境内股票ETF"
                    : security.category === "unconfirmed"
                      ? "ETF类别未确认"
                      : security.category === "cross-border"
                        ? "跨境ETF"
                        : security.category === "gold"
                          ? "黄金ETF"
                          : "债券ETF"
              }}
              <span class="rule-tag">{{
                security.settlement === "unconfirmed"
                  ? "回转规则未确认"
                  : security.settlement
              }}</span>
            </p>
          </div>
          <div class="last-price">
            <strong>{{
              money(quote?.latest, security.asset === "etf" ? 3 : 2)
            }}</strong
            ><small v-if="quote"
              >报价 {{ quote.quoteTime.slice(8, 10) }}:{{
                quote.quoteTime.slice(10, 12)
              }}:{{ quote.quoteTime.slice(12, 14) }}
              <span v-if="quoteAge(quote, clock) > 60000" class="warning"
                >可能过期</span
              ></small
            ><small v-else>等待参考报价</small>
          </div>
        </div>
        <div class="chart-toolbar">
          <div class="segmented">
            <button
              v-for="item in [
                { id: 'intraday', label: '分时' },
                { id: 'five-day', label: '五日分时' },
                { id: 'daily', label: '日K' },
              ]"
              :key="item.id"
              :class="{ active: mode === item.id }"
              @click="mode = item.id as ChartMode"
            >
              {{ item.label }}
            </button>
          </div>
          <span class="feed-status">{{ quoteStatus }}</span>
        </div>
        <MarketChart v-if="!embedded" :security="security" :mode="mode" />
        <div class="paired-summary">
          <div>
            <span>今日配对价差收益</span
            ><strong :class="tone(todayPair.profit)"
              >{{ money(todayPair.profit) }}<small>元</small></strong
            >
          </div>
          <div>
            <span>已配对</span><b>{{ todayPair.quantity }} 股/份</b>
          </div>
          <div>
            <span>未配对买入 / 卖出</span
            ><b>{{ todayPair.unpairedBuy }} / {{ todayPair.unpairedSell }}</b>
          </div>
          <p>
            按成交顺序配对同日买卖，费用按数量分摊。此项与FIFO已实现收益口径不同，不能相加。
          </p>
        </div>
      </section>
      <aside v-if="security" class="ticket panel">
        <div v-if="!embedded" class="section-heading">
          <h2>录入历史成交</h2>
        </div>
        <form @submit.prevent>
          <fieldset class="trade-fields" :disabled="orderBusy || orderSaved">
            <details v-if="legacyDrafts.length" class="legacy-trade-drafts">
              <summary>有旧版成交草稿，可选择载入</summary>
              <p>
                载入会替换当前输入；不会预选买卖方向，请重新核对成交时间与实际费用。
              </p>
              <button
                v-for="d in legacyDrafts"
                :key="d.key"
                type="button"
                @click="loadLegacyDraft(d.key)"
              >
                载入{{ d.label }}
              </button>
            </details>
            <div class="form-grid compact trade-main-fields">
              <label
                >成交价 · 元<input
                  ref="orderPriceInput"
                  v-model="orderPrice"
                  @input="tradePriceLocked = true"
                  aria-label="成交价"
                  inputmode="decimal"
                  placeholder="输入已成交价格" /></label
              ><label
                >成交股数 / 份数<input
                  v-model="orderQty"
                  aria-label="成交股数"
                  inputmode="numeric"
              /></label>
              <label class="trade-time"
                >发生时间<input
                  v-model="tradeTime"
                  type="datetime-local"
                  step="1"
              /></label>
            </div>
            <div class="trade-price-follow">
              <span>{{
                tradePriceLocked
                  ? "手动价格 · 已停止跟随"
                  : quote
                    ? `跟随参考现价 · 每3秒更新${quoteAge(quote, clock) > 120000 ? " · 延迟/缓存" : ""}`
                    : "等待行情 · 可手动输入"
              }}</span>
              <button
                v-if="tradePriceLocked"
                type="button"
                class="subtle"
                @click="resumeTradePrice"
              >
                恢复跟随现价
              </button>
            </div>
            <div class="quote-fill">
              <button
                type="button"
                :disabled="!quote?.bid"
                @click="fill(quote?.bid)"
              >
                买一 {{ quote?.bid || "—" }}</button
              ><button
                type="button"
                :disabled="!quote?.ask"
                @click="fill(quote?.ask)"
              >
                卖一 {{ quote?.ask || "—" }}</button
              ><button
                type="button"
                :disabled="!quote"
                @click="fill(quote?.latest)"
              >
                最新
              </button>
            </div>
            <div class="quantity-shortcuts">
              <button
                v-for="q in [100, 200, 500, 1000]"
                :key="q"
                type="button"
                :class="{ chosen: orderQty === String(q) }"
                @click="orderQty = String(q)"
              >
                {{ q }}
              </button>
              <button
                type="button"
                class="close-position"
                :class="{ chosen: orderQty === position?.available }"
                :disabled="!position || new Decimal(position.available).lte(0)"
                @click="fillAvailablePosition"
              >
                清仓（全部可卖）
              </button>
            </div>
            <div class="trade-fee-fields">
              <label
                >手续费口径<select v-model="feeSource">
                  <option value="estimated">按已确认费率估算</option>
                  <option value="actual">按交割单录入实际费用</option>
                </select></label
              >
              <div v-if="feeSource === 'actual'" class="actual-fees">
                <label
                  >佣金<input
                    v-model="actualFees.commission"
                    inputmode="decimal"
                    placeholder="元" /></label
                ><label
                  >印花税<input
                    v-model="actualFees.stamp"
                    inputmode="decimal"
                    placeholder="元" /></label
                ><label
                  >过户费<input
                    v-model="actualFees.transfer"
                    inputmode="decimal"
                    placeholder="元"
                /></label>
              </div>
            </div>
            <label
              >备注（选填）<input
                v-model="tradeNote"
                maxlength="500"
                placeholder="券商流水号、成交说明等"
            /></label>
            <dl class="ticket-details">
              <div>
                <dt>当前持仓 / 估算可卖</dt>
                <dd>
                  {{ position?.quantity || 0 }} / {{ position?.available || 0 }}
                </dd>
              </div>
            </dl>
            <FloatingNotice :message="draftError" />
            <label v-if="duplicateWarning" class="duplicate-warning"
              ><input
                type="checkbox"
                v-model="duplicateAck"
              />已存在同时间、价格和数量的{{
                duplicateDirection === "buy" ? "买入" : "卖出"
              }}记录，确认这是另一笔真实成交</label
            >
            <p class="ticket-disclaimer">
              仅补录真实成交，不发送委托。参考现价可能延迟，不代表历史成交价；请按交割单核对价格、股数、时间及费用后选择买入或卖出。
            </p>
            <div class="trade-submit-grid">
              <section
                v-for="direction in ['buy', 'sell'] as const"
                :key="direction"
                class="trade-direction-preview"
                :data-direction="direction"
              >
                <span
                  >{{
                    direction === "buy" ? "买入总支出" : "卖出净收入"
                  }}（元）</span
                >
                <strong>{{
                  money(orderPreviews[direction].value?.entry.fees?.cash)
                }}</strong>
                <small
                  >含手续费
                  {{ money(orderPreviews[direction].value?.entry.fees?.total) }}
                  元</small
                >
                <div
                  v-if="direction === 'sell' && sellProfitPreview"
                  class="trade-profit-preview"
                  title="本次收益＝卖出净收入－本次卖出数量匹配的FIFO持仓成本；收益率＝本次收益÷FIFO成本"
                >
                  <span>本次收益（FIFO）</span>
                  <b :class="tone(sellProfitPreview.profit)">{{
                    money(sellProfitPreview.profit)
                  }}</b>
                  <small :class="tone(sellProfitPreview.percent)">{{
                    percent(sellProfitPreview.percent)
                  }}</small>
                </div>
                <p v-if="orderPreviews[direction].error" class="order-hint">
                  {{ orderPreviews[direction].error }}
                </p>
                <button
                  type="button"
                  class="submit-order"
                  :class="direction"
                  :disabled="
                    !orderPreviews[direction].value ||
                    saving ||
                    orderBusy ||
                    orderSaved
                  "
                  @click="placeOrder(direction)"
                >
                  {{
                    orderBusy
                      ? "正在保存…"
                      : direction === "buy"
                        ? "买入"
                        : "卖出"
                  }}
                </button>
              </section>
            </div>
          </fieldset>
        </form>
        <button
          v-if="action !== 'record'"
          class="text-button"
          :disabled="
            saving ||
            account.entries.some(
              (e) => e.securityId === selected && e.kind === 'opening',
            )
          "
          @click="modal = 'opening'"
        >
          ＋ 录入这只证券的期初持仓
        </button>
      </aside>
    </div>
    <section class="details panel">
      <nav class="details-tabs" aria-label="账户明细">
        <button
          v-for="t in [
            { id: 'holdings', label: '我的持仓' },
            { id: 'trades', label: '成交记录' },
            { id: 'cash', label: '资金流水' },
            { id: 'planner', label: '做T测算' },
            { id: 'fees', label: '费用设置' },
            { id: 'backup', label: '账户与备份' },
          ]"
          :key="t.id"
          :class="{ active: tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}</button
        ><span>所有金额均为人民币 · 费用估算以实际交割单为准</span>
      </nav>
      <div v-if="tab === 'holdings'" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>证券</th>
              <th>持仓 / 可卖</th>
              <th>FIFO每股成本</th>
              <th>做T摊薄成本</th>
              <th>最新价</th>
              <th>持仓浮动</th>
              <th>已实现 · FIFO</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in holdings" :key="s.id">
              <td>
                <b>{{ s.name }}</b
                ><small>{{ s.code }}</small>
              </td>
              <td>
                {{ ledger.positions[s.id].quantity }} /
                {{ ledger.positions[s.id].available }}
              </td>
              <td>{{ money(ledger.positions[s.id].averageCost, 4) }}</td>
              <td>{{ money(ledger.positions[s.id].dilutedCost, 4) }}</td>
              <td>
                {{ money(quotes[s.id]?.latest, s.asset === "etf" ? 3 : 2)
                }}<small
                  v-if="quotes[s.id] && quoteAge(quotes[s.id], clock) > 60000"
                  >延迟报价</small
                >
              </td>
              <td
                :class="
                  tone(
                    quotes[s.id]
                      ? new Decimal(quotes[s.id].latest)
                          .mul(ledger.positions[s.id].quantity)
                          .minus(ledger.positions[s.id].cost)
                          .toString()
                      : null,
                  )
                "
              >
                {{
                  quotes[s.id]
                    ? money(
                        new Decimal(quotes[s.id].latest)
                          .mul(ledger.positions[s.id].quantity)
                          .minus(ledger.positions[s.id].cost)
                          .toString(),
                      )
                    : "—"
                }}
              </td>
              <td :class="tone(ledger.positions[s.id].realized)">
                {{ money(ledger.positions[s.id].realized) }}
              </td>
              <td>
                <button class="text-button" @click="select(s)">交易</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!holdings.length" class="empty">
          <b>还没有录入持仓</b>
          <p>补录历史买入，或以期初持仓开始记账；资金收支可随后补齐。</p>
          <button @click="modal = 'opening'">录入期初持仓</button>
        </div>
        <p class="footnote">
          摊薄成本＝本持仓批次累计净投入 ÷
          剩余数量，可为负；日终清仓后再次开仓开启新批次。不是券商必然显示的成本。T+1按北京时间日期隔日解锁，未接入交易日历。
        </p>
      </div>
      <div v-else-if="tab === 'cash'" class="table-scroll">
        <div class="cash-summary">
          <span
            >累计转入 <b>{{ money(ledger.deposits) }}</b></span
          ><span
            >累计转出 <b>{{ money(ledger.withdrawals) }}</b></span
          ><span
            >利息等收益 <b>{{ money(ledger.income) }}</b></span
          ><button v-if="!embedded" class="primary" @click="modal = 'cash'">
            录入资金流水
          </button>
        </div>
        <table class="ledger-history-table cash-history-table">
          <colgroup>
            <col style="width: 85px" />
            <col style="width: 130px" />
            <col style="width: 140px" />
            <col style="width: 100px" />
            <col />
            <col style="width: 90px" />
          </colgroup>
          <thead>
            <tr>
              <th>发生时间</th>
              <th>类型</th>
              <th>收入 / 支出</th>
              <th>计入收益</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in cashRows" :key="e.id">
              <td>
                {{
                  new Date(e.time).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })
                }}
              </td>
              <td>{{ cashLabels[e.kind] }}</td>
              <td :class="e.kind === 'withdraw' ? 'loss' : 'gain'">
                {{ e.kind === "withdraw" ? "−" : "+" }}{{ money(e.amount) }}
              </td>
              <td>
                {{
                  ["repo-interest", "interest", "other-income"].includes(e.kind)
                    ? "是"
                    : "否（本金）"
                }}
              </td>
              <td>{{ e.note || "—" }}</td>
              <td class="record-actions">
                <button
                  class="text-button"
                  :disabled="saving"
                  @click="openHistory('cash', e.id, 'edit')"
                >
                  修改
                </button>
                <button
                  class="text-button delete-link"
                  :disabled="saving"
                  @click="openHistory('cash', e.id, 'delete')"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!cashRows.length" class="empty">
          尚无资金流水。从实际转入资金开始记录，无需初始化余额。
        </p>
        <p class="footnote">
          国债逆回购只录入已到账净利息，不填本金返还；暂不追踪逆回购本金的冻结与到期释放，因此账面余额不等于券商可取资金。
        </p>
      </div>
      <div v-else-if="tab === 'trades'" class="table-scroll">
        <div v-if="!historySecurityId" class="history-search-toolbar">
          <SecuritySearch
            :key="historySearchKey"
            :securities="historySecurities"
            local-only
            result-hint="↑ ↓ 选择 · Enter 筛选"
            @select="filterHistory"
            @clear="historyFilterId = ''"
          />
          <div v-if="historyFilterSecurity" class="history-filter-result">
            <span>
              当前显示 <b>{{ historyFilterSecurity.name }}</b>
              <small
                >{{ historyFilterSecurity.market.toUpperCase() }}
                {{ historyFilterSecurity.code }}</small
              >
            </span>
            <button
              type="button"
              class="text-button"
              @click="clearHistoryFilter"
            >
              清除筛选
            </button>
          </div>
        </div>
        <table
          class="ledger-history-table trade-history-table"
          :class="{ 'compact-history': historyCompact }"
        >
          <colgroup v-if="historyCompact">
            <col style="width: 85px" />
            <col style="width: 60px" />
            <col style="width: 70px" />
            <col style="width: 70px" />
            <col style="width: 70px" />
            <col style="width: 90px" />
            <col style="width: 100px" />
            <col />
          </colgroup>
          <colgroup v-else>
            <col style="width: 85px" />
            <col v-if="!historySecurityId" style="width: 160px" />
            <col style="width: 60px" />
            <col style="width: 90px" />
            <col style="width: 90px" />
            <col style="width: 90px" />
            <col style="width: 120px" />
            <col style="width: 120px" />
            <col />
            <col v-if="!historyReadOnly" style="width: 90px" />
          </colgroup>
          <thead>
            <tr>
              <th>时间</th>
              <th v-if="!historySecurityId">证券</th>
              <th>类型</th>
              <th>价格</th>
              <th>数量</th>
              <th>佣金</th>
              <th>
                <template v-if="historyCompact"
                  >费用合计<small>口径</small></template
                ><template v-else>费用合计 / 口径</template>
              </th>
              <th>现金流</th>
              <th>备注</th>
              <th v-if="!historyReadOnly">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in tradeRows" :key="e.id">
              <td>
                <template v-if="historyCompact">
                  <span>{{ e.date }}</span>
                  <small>{{
                    new Date(e.time).toLocaleTimeString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      hour12: false,
                    })
                  }}</small>
                </template>
                <template v-else>{{
                  new Date(e.time).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })
                }}</template>
              </td>
              <td v-if="!historySecurityId">
                {{ account.securities.find((s) => s.id === e.securityId)?.name
                }}<small>{{ e.securityId }}</small>
              </td>
              <td
                :class="
                  e.kind === 'buy' ? 'gain' : e.kind === 'sell' ? 'loss' : ''
                "
              >
                {{ tradeTypeLabels[e.id] }}
              </td>
              <td>
                {{ e.price }}
              </td>
              <td>{{ e.quantity }}</td>
              <td>{{ money(e.fees?.commission) }}</td>
              <td>
                {{ money(e.fees?.total)
                }}<small v-if="e.fees">{{
                  e.feeSource === "actual" ? "交割单实录" : "费率估算"
                }}</small>
              </td>
              <td>
                {{
                  e.fees
                    ? (e.kind === "buy" ? "−" : "+") + money(e.fees.cash)
                    : "实物转入"
                }}
              </td>
              <td>{{ e.note || "—" }}</td>
              <td v-if="!historyReadOnly" class="record-actions">
                <button
                  class="text-button"
                  :disabled="saving"
                  @click="openHistory('trade', e.id, 'edit')"
                >
                  修改
                </button>
                <button
                  class="text-button delete-link"
                  :disabled="saving"
                  @click="openHistory('trade', e.id, 'delete')"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!tradeRows.length" class="empty">
          {{
            effectiveHistorySecurityId ? "该证券暂无交易记录" : "暂无成交记录"
          }}
        </p>
        <p v-if="!historyReadOnly" class="footnote">
          修改、删除前预览全账本重算结果。估算费用使用该记录保存的历史费率，实际费用按交割单填写；时间相同时保留原记录顺序。
        </p>
      </div>
      <div v-else-if="tab === 'planner' && security" class="planner">
        <nav class="planner-mode-tabs" aria-label="测算方式" role="tablist">
          <button
            id="planner-tab-forward"
            type="button"
            role="tab"
            :aria-selected="plannerMode === 'forward'"
            aria-controls="planner-panel-forward"
            :class="{ active: plannerMode === 'forward' }"
            @click="plannerMode = 'forward'"
          >
            正算
          </button>
          <button
            id="planner-tab-reverse"
            type="button"
            role="tab"
            :aria-selected="plannerMode === 'reverse'"
            aria-controls="planner-panel-reverse"
            :class="{ active: plannerMode === 'reverse' }"
            @click="plannerMode = 'reverse'"
          >
            反推
          </button>
        </nav>
        <section
          v-if="plannerMode === 'forward'"
          id="planner-panel-forward"
          class="planner-card planner-forward"
          role="tabpanel"
          aria-labelledby="planner-tab-forward"
        >
          <header>
            <h3>正算</h3>
            <p>输入计划成交价与数量，直接计算完整两笔交易及交易后持仓。</p>
          </header>
          <div class="planner-form">
            <div class="form-grid">
              <StepField
                :model-value="plan.buyPrice"
                label="买入价"
                unit="元"
                :step="priceTick"
                :min="priceTick"
                max="1000000"
                :decimals="priceDecimals"
                @update:model-value="editPlanPrice('buyPrice', $event)"
              >
                <div class="price-follow">
                  <span>{{
                    priceLocked.buyPrice
                      ? "手动价格 · 已锁定"
                      : "跟随最新价 · 每3秒"
                  }}</span
                  ><button
                    v-if="priceLocked.buyPrice"
                    @click="resumePrice('buyPrice')"
                  >
                    买入价跟随行情
                  </button>
                </div>
              </StepField>
              <StepField
                v-model="plan.buyQty"
                label="买入数量"
                unit="股/份"
                step="100"
                min="100"
                :decimals="0"
              >
                <div class="quantity-shortcuts">
                  <button
                    v-for="n in ['100', '200', '500', '1000']"
                    :key="n"
                    :aria-label="`买入数量设为${n}`"
                    @click="plan.buyQty = n"
                  >
                    {{ n }}
                  </button>
                </div>
              </StepField>
              <StepField
                :model-value="plan.sellPrice"
                label="卖出价"
                unit="元"
                :step="priceTick"
                :min="priceTick"
                max="1000000"
                :decimals="priceDecimals"
                @update:model-value="editPlanPrice('sellPrice', $event)"
              >
                <div class="price-follow">
                  <span>{{
                    priceLocked.sellPrice
                      ? "手动价格 · 已锁定"
                      : "跟随最新价 · 每3秒"
                  }}</span
                  ><button
                    v-if="priceLocked.sellPrice"
                    @click="resumePrice('sellPrice')"
                  >
                    卖出价跟随行情
                  </button>
                </div>
              </StepField>
              <StepField
                v-model="plan.sellQty"
                label="卖出数量"
                unit="股/份"
                step="100"
                min="100"
                :decimals="0"
              >
                <div class="quantity-shortcuts">
                  <button
                    v-for="n in ['100', '200', '500', '1000']"
                    :key="n"
                    :aria-label="`卖出数量设为${n}`"
                    @click="plan.sellQty = n"
                  >
                    {{ n }}
                  </button>
                </div>
              </StepField>
            </div>
            <p class="footnote">
              未手改价格每3秒跟随行情；加减价格即锁定。仅测算，不写入账户。未配对数量按增减仓计算；不校验资金、可卖数量及涨跌停。
            </p>
          </div>
          <div v-if="forwardResult.result" class="planner-results">
            <div class="plan-kpis">
              <div>
                <span>配对 {{ forwardResult.result.matched }} 股/份净收益</span
                ><strong :class="tone(forwardResult.result.profit)">{{
                  money(forwardResult.result.profit)
                }}</strong>
              </div>
              <div>
                <span>净增减仓 / 现金流</span
                ><b
                  >{{ forwardResult.result.change }} /
                  {{ money(forwardResult.result.cashFlow) }}</b
                >
              </div>
              <div>
                <span>完整两笔手续费</span
                ><b>{{ money(forwardResult.result.fees) }}</b>
              </div>
              <div>
                <span>测算后持仓 / 成本金额</span
                ><b
                  >{{ forwardResult.holding?.quantity }} /
                  {{ money(forwardResult.holding?.netInvestment) }}</b
                >
              </div>
              <div>
                <span>摊薄成本 / 持仓市值</span
                ><b
                  >{{ forwardResult.holding?.dilutedCost ?? "—" }} /
                  {{ money(forwardResult.holding?.marketValue) }}</b
                >
              </div>
              <div>
                <span>持仓收益 / 收益率</span
                ><b :class="tone(forwardResult.holding?.profit)"
                  >{{ money(forwardResult.holding?.profit) }} /
                  {{ percent(forwardResult.holding?.profitPercent ?? null) }}</b
                >
              </div>
            </div>
            <p class="footnote">
              配对毛收益 {{ money(forwardResult.result.gross) }} − 分摊费用
              {{ money(forwardResult.result.allocatedFees) }}；完整买入支出
              {{ money(forwardResult.result.buy.cash) }}，完整卖出净收入
              {{ money(forwardResult.result.sell.cash) }}。{{
                forwardResult.holding?.error
              }}
            </p>
          </div>
          <p v-else class="empty">{{ forwardResult.error }}</p>
        </section>
        <section
          v-else
          id="planner-panel-reverse"
          class="planner-card planner-reverse"
          role="tabpanel"
          aria-labelledby="planner-tab-reverse"
        >
          <header>
            <h3>反推</h3>
            <p>给定一侧成交价和目标净利润，反推出另一侧合法报价。</p>
          </header>
          <div class="planner-form">
            <div class="form-grid">
              <label class="reverse-direction-field"
                >反推方向<select v-model="reversePlan.direction">
                  <option value="sell">固定买价 → 最低卖价</option>
                  <option value="buy">固定卖价 → 最高回补价</option>
                </select></label
              >
              <StepField
                :model-value="reversePlan.fixedPrice"
                label="反推固定价"
                unit="元"
                :step="priceTick"
                :min="priceTick"
                max="1000000"
                :decimals="priceDecimals"
                @update:model-value="editPlanPrice('reverse', $event)"
              >
                <div class="price-follow">
                  <span>{{
                    priceLocked.reverse
                      ? "手动价格 · 已锁定"
                      : "跟随最新价 · 每3秒"
                  }}</span
                  ><button
                    v-if="priceLocked.reverse"
                    @click="resumePrice('reverse')"
                  >
                    固定价跟随行情
                  </button>
                </div>
              </StepField>
              <StepField
                v-model="reversePlan.buyQty"
                label="反推买入数量"
                unit="股/份"
                step="100"
                min="100"
                :decimals="0"
              />
              <StepField
                v-model="reversePlan.sellQty"
                label="反推卖出数量"
                unit="股/份"
                step="100"
                min="100"
                :decimals="0"
              />
              <StepField
                v-model="reversePlan.target"
                label="目标配对净利润"
                unit="元"
                step="10"
                min="0"
                :decimals="2"
              />
            </div>
          </div>
          <div v-if="reverseResult.result" class="planner-results">
            <div class="reverse-answer">
              <span>{{
                reversePlan.direction === "sell" ? "最低卖价" : "最高回补价"
              }}</span
              ><strong>{{ reverseResult.solved }}</strong>
            </div>
            <div class="plan-prices">
              <span
                >保本价 <b>{{ reverseResult.breakeven }}</b></span
              ><span
                >开始盈利 <b>{{ reverseResult.profit }}</b></span
              ><span
                >目标配对净收益
                <b :class="tone(reverseResult.result.profit)">{{
                  money(reverseResult.result.profit)
                }}</b></span
              >
            </div>
            <div class="plan-kpis">
              <div>
                <span>配对数量 / 完整手续费</span
                ><b
                  >{{ reverseResult.result.matched }} /
                  {{ money(reverseResult.result.fees) }}</b
                >
              </div>
              <div>
                <span>测算后持仓 / 成本金额</span
                ><b
                  >{{ reverseResult.holding?.quantity }} /
                  {{ money(reverseResult.holding?.netInvestment) }}</b
                >
              </div>
              <div>
                <span>摊薄成本 / 持仓市值</span
                ><b
                  >{{ reverseResult.holding?.dilutedCost ?? "—" }} /
                  {{ money(reverseResult.holding?.marketValue) }}</b
                >
              </div>
              <div>
                <span>持仓收益 / 收益率</span
                ><b :class="tone(reverseResult.holding?.profit)"
                  >{{ money(reverseResult.holding?.profit) }} /
                  {{ percent(reverseResult.holding?.profitPercent ?? null) }}</b
                >
              </div>
            </div>
            <div class="price-ladder">
              <div
                v-for="p in reverseResult.levels"
                :key="p.price"
                :class="{ breakeven: p.price === reverseResult.breakeven }"
              >
                <span>{{ p.price }}</span
                ><b :class="tone(p.profit)">{{ money(p.profit) }}</b
                ><small>{{
                  p.price === reverseResult.breakeven
                    ? "保本档位"
                    : "配对净收益"
                }}</small>
              </div>
            </div>
            <p class="footnote">
              反推结果已用完整费用函数复核；持仓收益按当前参考现价计算。{{
                reverseResult.holding?.error
              }}
            </p>
          </div>
          <p v-else class="empty">{{ reverseResult.error }}</p>
        </section>
      </div>
      <div v-else-if="tab === 'fees'" class="fee-settings">
        <form
          v-for="asset in ['stock', 'etf'] as const"
          :key="asset"
          @submit.prevent="saveFees(asset)"
        >
          <h3>
            {{ asset === "stock" ? "股票交易费率" : "ETF交易费率" }}
            <span
              :class="account.feeConfirmed[asset] ? 'confirmed' : 'warning'"
              >{{ account.feeConfirmed[asset] ? "已确认" : "待确认" }}</span
            >
          </h3>
          <p>
            {{
              asset === "etf"
                ? "ETF费率与股票独立设置；最低佣金按每笔买入、卖出分别收取，请对照交割单填写。"
                : "初始万2.5、每边最低5元仅为示例，请对照交割单确认。"
            }}
          </p>
          <div class="form-grid">
            <label
              >佣金 · 万分之<input
                v-model="feeForms[asset].commissionWan"
                inputmode="decimal"
                placeholder="填写实际费率" /></label
            ><label
              >每边最低佣金 · 元<input
                v-model="feeForms[asset].minimum"
                inputmode="decimal" /></label
            ><label
              >卖出印花税 · %<input
                v-model="feeForms[asset].stampPercent"
                inputmode="decimal" /></label
            ><label
              >双向过户费 · %<input
                v-model="feeForms[asset].transferPercent"
                inputmode="decimal"
            /></label>
          </div>
          <button class="primary" :disabled="saving">
            确认并保存{{ asset === "stock" ? "股票" : "ETF" }}费率
          </button>
        </form>
        <p class="footnote">
          佣金按含规费口径，不另叠加经手费与监管费。单边佣金取比例与最低值中较大者，各项费用独立四舍五入到分。保存费率仅影响后续估算，不会重算历史成交。
        </p>
      </div>
      <div v-else-if="tab === 'backup'" class="backup-panel">
        <div>
          <h3>你的账户，只保存在本机</h3>
          <p>
            记住自选证券、持仓、费率和每笔成交，无登录、云同步或券商连接。备份包含完整持仓与成交，请妥善保管。
          </p>
          <div class="backup-actions">
            <button
              class="primary"
              :disabled="saving || revision === 0"
              @click="backup"
            >
              导出账户备份</button
            ><button :disabled="saving" @click="importBackup">
              从备份恢复…
            </button>
          </div>
          <input
            ref="backupFile"
            type="file"
            accept=".json"
            hidden
            @change="filePicked"
          />
        </div>
        <dl>
          <div>
            <dt>账户版本</dt>
            <dd>v3 · 修订 {{ revision }}</dd>
          </div>
          <div>
            <dt>成交与期初记录</dt>
            <dd>{{ account.entries.length }} 笔</dd>
          </div>
          <div>
            <dt>累计手续费</dt>
            <dd>¥ {{ money(ledger.fees) }}</dd>
          </div>
          <div>
            <dt>存储方式</dt>
            <dd>
              {{
                isTauri()
                  ? "SQLite事务 + 20个恢复快照"
                  : "浏览器本地存储（预览）"
              }}
            </dd>
          </div>
        </dl>
      </div>
    </section>
    <footer class="terminal-footer">
      <span>T刻 0.4.0 · 手工证券账本</span
      ><span
        >不保证行情、成交或实际盈利 ·
        不支持融券卖空、拆单撮合与公司行动自动处理</span
      >
    </footer>
    <div
      v-if="modal"
      class="modal-backdrop"
      @click.self="!saving && (modal = '')"
    >
      <section
        class="modal"
        :class="{ 'history-modal': modal === 'history' }"
        :role="embedded && action ? undefined : 'dialog'"
        :aria-modal="embedded && action ? undefined : true"
        :aria-label="
          modal === 'history'
            ? historyTarget?.action === 'delete'
              ? '删除历史记录'
              : '修改历史记录'
            : modal === 'cash'
              ? '录入资金流水'
              : modal === 'security'
                ? '添加证券'
                : modal === 'opening'
                  ? '录入期初持仓'
                  : '恢复账户备份'
        "
      >
        <button
          class="modal-close"
          aria-label="关闭对话框"
          :disabled="saving"
          @click="modal = ''"
        >
          ×
        </button>
        <HistoryEditor
          v-if="modal === 'history' && historyTarget"
          :account="account"
          :target="historyTarget"
          :saving="saving"
          @save="saveHistory"
          @cancel="modal = ''"
        />
        <form v-else-if="modal === 'cash'" @submit.prevent="saveCash">
          <span class="eyebrow">同步证券账户现金变化</span>
          <h2>录入资金流水</h2>
          <label
            >流水类型<select v-model="cashForm.kind">
              <option value="deposit">转入资金</option>
              <option value="withdraw">转出资金</option>
              <option value="repo-interest">国债逆回购利息</option>
              <option value="interest">账户利息</option>
              <option value="other-income">其他收入</option>
            </select></label
          >
          <label
            >发生时间<input
              v-model="cashForm.time"
              type="datetime-local"
              step="1"
          /></label>
          <label
            >金额 · 元（填正数）<input
              v-model="cashForm.amount"
              inputmode="decimal"
              placeholder="以实际到账 / 转出金额为准"
          /></label>
          <label
            >备注（选填）<input
              v-model="cashForm.note"
              maxlength="500"
              placeholder="用途、流水号等"
          /></label>
          <p>
            {{
              cashForm.kind === "deposit" || cashForm.kind === "withdraw"
                ? "资金转入/转出计入净本金，不计入投资收益。"
                : "收入计入账户收益，不摊入股票持仓成本；请填实际到账净收入，不含返还本金。"
            }}
          </p>
          <button class="primary wide" :disabled="saving">保存资金流水</button>
        </form>
        <form v-else-if="modal === 'security'" @submit.prevent="addSecurity">
          <span class="eyebrow">只需添加一次</span>
          <h2>添加股票 / ETF</h2>
          <div class="form-grid">
            <label
              >市场<select v-model="addForm.market">
                <option value="sh">上海</option>
                <option value="sz">深圳</option>
              </select></label
            ><label
              >六位证券代码<input
                v-model="addForm.code"
                maxlength="6"
                inputmode="numeric"
            /></label>
          </div>
          <button type="button" @click="lookup">查询证券名称</button
          ><label
            >证券名称<input
              v-model="addForm.name"
              maxlength="60"
              placeholder="也可离线手动填写"
          /></label>
          <div class="form-grid">
            <label
              >品种<select v-model="addForm.asset">
                <option value="stock">股票</option>
                <option value="etf">ETF</option>
              </select></label
            ><label v-if="addForm.asset === 'etf'"
              >ETF类别<select v-model="addForm.category">
                <option value="domestic">境内股票ETF</option>
                <option value="cross-border">跨境ETF</option>
                <option value="gold">黄金ETF</option>
                <option value="bond">债券ETF</option>
                <option value="unconfirmed">未确认</option>
              </select></label
            ><label
              v-if="addForm.asset === 'etf' && addForm.category !== 'domestic'"
              >该证券回转规则<select v-model="addForm.settlement">
                <option value="unconfirmed">未确认</option>
                <option value="T+0">我已确认可当日回转 T+0</option>
                <option value="T+1">T+1</option>
              </select></label
            >
          </div>
          <p class="footnote">
            类别和回转规则须按具体证券确认；有成交后不能更改。股票和境内股票ETF按T+1处理，不按名称猜测。
          </p>
          <button class="primary wide" :disabled="saving">添加到自选</button>
        </form>
        <form v-else-if="modal === 'opening'" @submit.prevent="addOpening">
          <span class="eyebrow">已有底仓 · {{ security?.name }}</span>
          <h2>记住你的期初持仓</h2>
          <p>
            期初日期须早于该证券首笔成交，且只录入一次；作为实物资产转入，不扣除账面现金。不要同时重复录入期初日前的历史买入。
          </p>
          <label
            >期初日期<input
              v-model="opening.time"
              type="datetime-local"
              step="1"
          /></label>
          <label
            >期初股数 / 份数（整数）<input
              v-model="opening.quantity"
              inputmode="numeric" /></label
          ><label
            >期初每股成本 · 元<input
              v-model="opening.price"
              inputmode="decimal"
              placeholder="输入非负购入成本，不是累计做T摊薄成本" /></label
          ><label
            >其中期初当日可卖数量<input
              v-model="opening.available"
              inputmode="numeric"
          /></label>
          <p class="footnote">
            不可卖部分按次日解锁。FIFO成本以此输入为起点，不推算之前的历史盈亏。
          </p>
          <button class="primary wide" :disabled="saving">保存期初持仓</button>
        </form>
        <div v-else>
          <span class="eyebrow">确认恢复</span>
          <h2>用备份替换当前证券账本？</h2>
          <p>
            备份包含 {{ pendingRestore?.securities.length }} 只证券、{{
              pendingRestore?.entries.length
            }}
            条记录。此操作将替换当前账户，不会合并成交。
          </p>
          <p>建议先导出当前账户备份。桌面版另保留恢复前快照。</p>
          <div class="backup-actions">
            <button @click="modal = ''">取消</button
            ><button class="primary" :disabled="saving" @click="restore">
              确认替换并恢复
            </button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

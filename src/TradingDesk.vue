<script setup lang="ts">
import {
  ref,
  computed,
  reactive,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import Decimal from "decimal.js";
import { isTauri } from "@tauri-apps/api/core";
import SecuritiesTable from "./components/SecuritiesTable.vue";
import FloatingNotice from "./components/FloatingNotice.vue";
import SummaryHelp from "./components/SummaryHelp.vue";
import SecuritySearch from "./components/SecuritySearch.vue";
import type { SecurityHit } from "./securitySearch";
import RowContextMenu from "./components/RowContextMenu.vue";
import MarketChart from "./components/MarketChart.vue";
import LedgerWorkbench from "./LedgerWorkbench.vue";
import RecoveryCenter from "./components/RecoveryCenter.vue";
import { manualAccount, upgradeAccount } from "./sim/record";
import { replay, validateAccount, validateSecurity } from "./sim/ledger";
import { loadAccount, saveAccount } from "./sim/repository";
import type { Account, Security, TableView } from "./sim/model";
import { shanghaiDate } from "./sim/model";
import {
  upgradeWorkspace,
  defaultView,
  tableView,
  setTableView,
  columnLabels,
  configurableColumnLabelsFor,
  defaultColumnWidth,
  removeWatchlist,
  viewKind,
} from "./sim/workspaceState";
import {
  dailyPerformance,
  dailyReturnPercent,
  aggregateDailyReturnPercent,
  holdingTradingDays,
  returnPercent,
  holdingPerformance,
  securityContribution,
  quoteDate,
} from "./sim/performance";
import type { ChartMode } from "./sim/chart";
import {
  marketQuotes,
  marketCharts,
  marketErrors,
  marketStatus,
  hydrateMarket,
  makeMarketPoller,
  makeFundFlowPoller,
  fundFlowStatus,
  getChart,
  chartKey,
  clearMarket,
} from "./market";
const account = ref<Account>(upgradeWorkspace(manualAccount())),
  revision = ref(0),
  ready = ref(false),
  fatal = ref(""),
  saving = ref(false),
  failure = ref(""),
  toast = ref("");
const page = ref("market"),
  selected = ref(""),
  drawer = ref(false),
  detailTab = ref("chart"),
  detailMode = ref<ChartMode>("intraday"),
  query = ref(""),
  assetFilter = ref("all"),
  checked = ref<string[]>([]),
  visible = ref<string[]>([]),
  clock = ref(Date.now());
const dialog = ref(""),
  action = ref<"record" | "cash" | "opening" | undefined>(),
  workbench = ref<InstanceType<typeof LedgerWorkbench>>(),
  groupName = ref(""),
  batchGroups = ref<string[]>([]),
  editedGroup = ref(""),
  columns = ref<TableView>(defaultView());
const add = reactive({
  market: "sh" as "sh" | "sz",
  code: "",
  name: "",
  asset: "etf" as "stock" | "etf",
  category: "domestic" as Security["category"],
  settlement: "T+1" as Security["settlement"],
});
const selectedAddId = ref("");
const detailModes: { id: ChartMode; name: string }[] = [
  { id: "intraday", name: "分时" },
  { id: "five-day", name: "五日分时" },
  { id: "daily", name: "日K" },
];
const w = computed(() => account.value.workspace!);
const snapshot = computed(() => ({
  account: account.value,
  revision: revision.value,
}));
const ledger = computed(() =>
  replay(account.value, shanghaiDate(new Date(clock.value))),
);
const securities = computed(
  () => new Map(account.value.securities.map((s) => [s.id, s])),
);
const security = computed(() => securities.value.get(selected.value));
const currentGroup = computed(() =>
  w.value.groups.find((g) => g.id === w.value.activeView),
);
const isHoldings = computed(() => w.value.activeView === "holdings");
const activeViewKind = computed(() => viewKind(w.value.activeView));
const isContribution = computed(() => activeViewKind.value === "contribution");
const marketDate = computed(
  () =>
    [
      ...Object.values(marketQuotes).map(quoteDate),
      ...account.value.entries.map((e) => e.date),
    ]
      .filter((d): d is string => !!d && d <= shanghaiDate())
      .sort()
      .at(-1) ?? shanghaiDate(),
);
const holdingIds = computed(() =>
  account.value.securities
    .filter(
      (s) =>
        new Decimal(ledger.value.positions[s.id]?.quantity ?? 0).gt(0) ||
        account.value.entries.some(
          (e) =>
            e.securityId === s.id &&
            e.kind === "sell" &&
            e.date === marketDate.value,
        ),
    )
    .map((s) => s.id),
);
const holdingDayCounts = computed(() =>
  Object.fromEntries(
    holdingIds.value.map((id) => [
      id,
      holdingTradingDays(
        account.value.entries,
        id,
        marketDate.value,
        marketCharts[chartKey(id, "daily-raw")],
      ),
    ]),
  ),
);
const contributionStats = computed(() => {
  const byId: Record<
    string,
    NonNullable<ReturnType<typeof securityContribution>>
  > = {};
  let positive = new Decimal(0),
    negative = new Decimal(0);
  for (const s of account.value.securities) {
    if (!account.value.entries.some((entry) => entry.securityId === s.id))
      continue;
    const contribution = securityContribution(
      ledger.value.positions[s.id],
      marketQuotes[s.id],
    );
    if (!contribution || contribution.total === null) continue;
    byId[s.id] = contribution;
    const total = new Decimal(contribution.total);
    if (total.gt(0)) positive = positive.plus(total);
    else if (total.lt(0)) negative = negative.plus(total.abs());
  }
  for (const contribution of Object.values(byId)) {
    const total = new Decimal(contribution.total!),
      base = total.gt(0) ? positive : negative;
    contribution.share =
      !total.isZero() && base.gt(0)
        ? total.abs().div(base).mul(100).toFixed(2)
        : null;
  }
  return {
    byId,
    profitIds: Object.entries(byId)
      .filter(([, contribution]) => new Decimal(contribution.total!).gt(0))
      .map(([id]) => id),
    lossIds: Object.entries(byId)
      .filter(([, contribution]) => new Decimal(contribution.total!).lt(0))
      .map(([id]) => id),
  };
});
const members = computed(() =>
  isHoldings.value
    ? holdingIds.value
    : w.value.activeView === "profit"
      ? contributionStats.value.profitIds
      : w.value.activeView === "loss"
        ? contributionStats.value.lossIds
        : currentGroup.value
          ? currentGroup.value.members
          : w.value.watchlist,
);
const rows = computed(() =>
  members.value.flatMap((id) => {
    const s = securities.value.get(id);
    return s &&
      (assetFilter.value === "all" || s.asset === assetFilter.value) &&
      `${s.name}${s.code}`.includes(query.value.trim())
      ? [s]
      : [];
  }),
);
const view = computed(() => tableView(w.value, w.value.activeView));
const configurableColumns = computed(() =>
  configurableColumnLabelsFor(w.value.activeView),
);
const canSaveGroups = computed(() =>
  checked.value.length === 1
    ? w.value.groups.some(
        (g) =>
          g.members.includes(checked.value[0]) !==
          batchGroups.value.includes(g.id),
      )
    : checked.value.length > 1 && batchGroups.value.length > 0,
);
const rowMenu = ref<{ id: string; x: number; y: number } | null>(null);
const menuItems = computed(() => {
  const single = checked.value.length === 1;
  const index = members.value.indexOf(checked.value[0]);
  return [
    { id: "detail", label: "查看详情", disabled: !single },
    { id: "trade", label: "交易", disabled: !single || saving.value },
    { id: "planner", label: "做T测算", disabled: !single || saving.value },
    {
      id: "addGroup",
      label: "加入分组…",
      separator: true,
      disabled: saving.value,
    },
    ...(isHoldings.value
      ? [
          {
            id: "watch",
            label: "加入全部自选",
            disabled:
              saving.value ||
              checked.value.every((id) => w.value.watchlist.includes(id)),
          },
        ]
      : []),
    ...(!isContribution.value
      ? [
          {
            id: "remove",
            label: currentGroup.value ? "移出当前分组…" : "移出全部自选…",
            disabled:
              saving.value ||
              !checked.value.some((id) => w.value.watchlist.includes(id)),
          },
        ]
      : []),
    {
      id: "up",
      label: "上移",
      separator: true,
      disabled:
        saving.value ||
        !single ||
        isHoldings.value ||
        isContribution.value ||
        index <= 0,
    },
    {
      id: "down",
      label: "下移",
      disabled:
        saving.value ||
        !single ||
        isHoldings.value ||
        isContribution.value ||
        index < 0 ||
        index >= members.value.length - 1,
    },
    {
      id: "selectAll",
      label: "全选当前列表",
      separator: true,
      disabled: rows.value.every((s) => checked.value.includes(s.id)),
    },
    { id: "clear", label: "取消选择" },
  ];
});
async function openRowMenu(target: { id: string; x: number; y: number }) {
  if (
    dialog.value ||
    drawer.value ||
    !rows.value.some((s) => s.id === target.id)
  )
    return;
  rowMenu.value = null;
  if (!checked.value.includes(target.id)) checked.value = [target.id];
  void choose(target.id);
  await nextTick();
  rowMenu.value = target;
}
function rowMenuAction(id: string) {
  if (id === "detail") detail(selected.value);
  else if (id === "trade") openRecord("record");
  else if (id === "planner" && checked.value.length === 1 && !saving.value) {
    detail(checked.value[0]);
    detailTab.value = "planner";
  } else if (id === "addGroup") {
    batchGroups.value =
      checked.value.length === 1
        ? w.value.groups
            .filter((g) => g.members.includes(checked.value[0]))
            .map((g) => g.id)
        : [];
    dialog.value = "addToGroup";
  } else if (id === "remove") dialog.value = "remove";
  else if (id === "up" || id === "down") void moveRow(id === "up" ? -1 : 1);
  else if (id === "clear") checked.value = [];
  else if (id === "selectAll") checked.value = rows.value.map((s) => s.id);
  else if (id === "watch") {
    const ids = [...checked.value];
    void commit((a) => {
      a.workspace!.watchlist = [
        ...new Set([...a.workspace!.watchlist, ...ids]),
      ];
    }, "已加入全部自选");
  }
}
const recordedIds = computed(() => [
  ...new Set(account.value.entries.map((e) => e.securityId)),
]);
const title = computed(() =>
  isHoldings.value
    ? "我的持仓"
    : w.value.activeView === "profit"
      ? "盈利贡献"
      : w.value.activeView === "loss"
        ? "亏损贡献"
        : (currentGroup.value?.name ?? "全部自选"),
);
const performance = computed(() => {
  const grouped = new Map<string, Account["entries"]>();
  for (const e of account.value.entries) {
    const list = grouped.get(e.securityId) ?? [];
    list.push(e);
    grouped.set(e.securityId, list);
  }
  return Object.fromEntries(
    account.value.securities.map((s) => {
      const q = marketQuotes[s.id];
      const date = marketDate.value;
      return [
        s.id,
        dailyPerformance(
          { ...account.value, entries: grouped.get(s.id) ?? [] },
          s.id,
          date,
          q,
          marketCharts[chartKey(s.id, "daily-raw")],
        ),
      ];
    }),
  );
});
const totals = computed(() => {
  let market = new Decimal(0),
    cycle = new Decimal(0),
    cycleBase = new Decimal(0),
    daily = new Decimal(0),
    missing = 0,
    missingDay = false;
  for (const id of holdingIds.value) {
    const h = holdingPerformance(ledger.value.positions[id], marketQuotes[id]);
    cycleBase = cycleBase.plus(ledger.value.positions[id]?.netInvestment ?? 0);
    if (h.marketValue === null) missing++;
    else market = market.plus(h.marketValue);
    if (h.cyclePnl !== null) cycle = cycle.plus(h.cyclePnl);
    const p = performance.value[id];
    if (!p || p.profit === null || p.date !== marketDate.value)
      missingDay = true;
    else daily = daily.plus(p.profit);
  }
  return {
    market: missing ? null : market.toFixed(2),
    total: missing ? null : market.plus(ledger.value.cash).toFixed(2),
    cycle: missing ? null : cycle.toFixed(2),
    cycleInvestment: cycleBase.toFixed(2),
    daily: missingDay ? null : daily.toFixed(2),
    dailyPercent: missingDay
      ? null
      : aggregateDailyReturnPercent(
          holdingIds.value.map((id) => performance.value[id]!),
        ),
    cyclePercent: returnPercent(
      missing ? null : cycle.toString(),
      cycleBase.toString(),
    ),
  };
});
const cashTradeTotals = computed(() => {
  let buys = new Decimal(0),
    sells = new Decimal(0);
  for (const entry of account.value.entries) {
    if (entry.kind === "buy") buys = buys.plus(entry.fees!.cash);
    else if (entry.kind === "sell") sells = sells.plus(entry.fees!.cash);
  }
  return { buys: buys.toFixed(2), sells: sells.toFixed(2) };
});
const dailyBreakdown = computed(() => {
  let start = new Decimal(0),
    end = new Decimal(0),
    buys = new Decimal(0),
    sells = new Decimal(0),
    fees = new Decimal(0),
    complete = true;
  for (const id of holdingIds.value) {
    const day = performance.value[id];
    if (!day || day.startValue === null || day.endValue === null)
      complete = false;
    else {
      start = start.plus(day.startValue);
      end = end.plus(day.endValue);
    }
    if (day) {
      buys = buys.plus(day.buys);
      sells = sells.plus(day.sells);
      fees = fees.plus(day.fees);
    }
  }
  return {
    start: complete ? start.toFixed(2) : null,
    end: complete ? end.toFixed(2) : null,
    buys: buys.toFixed(2),
    sells: sells.toFixed(2),
    fees: fees.toFixed(2),
  };
});
const incomeBreakdown = computed(() => {
  let repo = new Decimal(0),
    interest = new Decimal(0),
    other = new Decimal(0);
  for (const entry of account.value.cashEntries ?? []) {
    if (entry.kind === "repo-interest") repo = repo.plus(entry.amount);
    else if (entry.kind === "interest") interest = interest.plus(entry.amount);
    else if (entry.kind === "other-income") other = other.plus(entry.amount);
  }
  return {
    repo: repo.toFixed(2),
    interest: interest.toFixed(2),
    other: other.toFixed(2),
  };
});
function percent(v: string | null) {
  return v === null ? "—" : `${new Decimal(v).gt(0) ? "+" : ""}${money(v)}%`;
}
function money(v: string | null | undefined, d = 2) {
  return v == null
    ? "—"
    : new Decimal(v).toNumber().toLocaleString("zh-CN", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
}
function signedMoney(v: string | null | undefined, sign: "＋" | "−") {
  return v == null ? "—" : sign + money(v);
}
function tone(v: string | null | undefined) {
  return v && new Decimal(v).gt(0)
    ? "gain"
    : v && new Decimal(v).lt(0)
      ? "loss"
      : "flat";
}
let toastTimer: ReturnType<typeof setTimeout>;
function notify(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 3000);
}
let queue: Promise<unknown> = Promise.resolve();
function commit(
  change: (a: Account) => void,
  text = "已保存",
): Promise<boolean> {
  const job = queue
    .catch(() => {})
    .then(async () => {
      saving.value = true;
      failure.value = "";
      try {
        const next = JSON.parse(JSON.stringify(account.value)) as Account;
        change(next);
        validateAccount(next);
        const rev = await saveAccount(next, revision.value);
        account.value = next;
        revision.value = rev;
        if (text) notify(text);
        return true;
      } catch (e) {
        failure.value = e instanceof Error ? e.message : String(e);
        return false;
      } finally {
        saving.value = false;
      }
    });
  queue = job;
  return job;
}
function saved(a: Account, rev: number) {
  account.value = upgradeWorkspace(a);
  revision.value = rev;
}
async function choose(id: string) {
  if (selected.value === id) return;
  selected.value = id;
  await commit((a) => (a.selectedId = id), "");
}
function detail(id: string) {
  void choose(id);
  detailTab.value = "chart";
  drawer.value = true;
}
function showPnl(id: string) {
  void choose(id);
  detailTab.value = "pnl";
  drawer.value = true;
}
async function switchView(id: string) {
  checked.value = [];
  query.value = "";
  await commit((a) => (a.workspace!.activeView = id), "");
}
async function config(v: TableView) {
  const id = w.value.activeView;
  await commit((a) => setTableView(a.workspace!, id, v), "");
}
function editColumns() {
  if (isContribution.value) return;
  columns.value = JSON.parse(JSON.stringify(view.value));
  dialog.value = "columns";
}
function toggleColumn(c: string) {
  const list = columns.value.columns;
  columns.value.columns = list.includes(c)
    ? list.filter((x) => x !== c)
    : [...list, c];
}
function moveColumn(i: number, delta: number) {
  const list = columns.value.columns,
    j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
const draggedColumn = ref("");
let stopColumnDrag: (() => void) | undefined;
function beginColumnDrag(event: PointerEvent, column: string) {
  if (event.button !== 0) return;
  event.preventDefault();
  stopColumnDrag?.();
  const original = [...columns.value.columns];
  draggedColumn.value = column;
  const move = (e: PointerEvent) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const row = hit?.closest<HTMLElement>("[data-column-order]");
    const target = row?.dataset.columnOrder;
    if (target && target !== column) {
      const list = [...columns.value.columns],
        from = list.indexOf(column),
        to = list.indexOf(target);
      if (from >= 0 && to >= 0) {
        list.splice(from, 1);
        list.splice(to, 0, column);
        columns.value.columns = list;
      }
    }
    const panel = document.querySelector<HTMLElement>(".desk-dialog");
    if (panel) {
      const r = panel.getBoundingClientRect();
      if (e.clientY > r.bottom - 45) panel.scrollTop += 18;
      else if (e.clientY < r.top + 45) panel.scrollTop -= 18;
    }
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    draggedColumn.value = "";
    stopColumnDrag = undefined;
  };
  const cancel = () => {
    columns.value.columns = original;
    finish();
  };
  stopColumnDrag = cancel;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", cancel, { once: true });
}
onBeforeUnmount(() => stopColumnDrag?.());
watch(dialog, () => stopColumnDrag?.());
async function saveColumns() {
  await config(columns.value);
  if (!failure.value) dialog.value = "";
}
function restoreDefaultColumns() {
  columns.value = defaultView(w.value.activeView);
}
async function addGroup() {
  const name = groupName.value.trim();
  if (
    await commit((a) => {
      a.workspace!.groups.push({
        id: `g-${crypto.randomUUID()}`,
        name,
        members: [],
      });
    }, "分组已创建")
  )
    groupName.value = "";
}
async function renameGroup(id: string) {
  const name = groupName.value.trim();
  if (
    await commit((a) => {
      const g = a.workspace!.groups.find((g) => g.id === id)!;
      g.name = name;
    }, "分组已重命名")
  ) {
    editedGroup.value = "";
    groupName.value = "";
  }
}
async function moveGroup(id: string, delta: number) {
  await commit((a) => {
    const list = a.workspace!.groups,
      i = list.findIndex((g) => g.id === id),
      j = i + delta;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  }, "");
}
async function deleteGroup() {
  const id = editedGroup.value;
  if (
    await commit((a) => {
      const state = a.workspace!;
      state.groups = state.groups.filter((g) => g.id !== id);
      delete state.views[id];
      if (state.activeView === id) state.activeView = "all";
    }, "分组已删除，证券与交易记录保留")
  ) {
    dialog.value = "groups";
    editedGroup.value = "";
  }
}
async function addToGroup() {
  if (saving.value || !canSaveGroups.value) return;
  const ids = [...checked.value];
  const single = ids.length === 1;
  const groupIds = [...batchGroups.value];
  if (
    await commit(
      (a) => {
        const state = a.workspace!;
        const groups = groupIds.map((id) =>
          state.groups.find((g) => g.id === id),
        );
        if (groups.some((g) => !g))
          throw new Error("所选分组已不存在，请重新选择");
        if (groupIds.length)
          state.watchlist = [...new Set([...state.watchlist, ...ids])];
        if (single) {
          for (const g of state.groups) {
            if (!groupIds.includes(g.id))
              g.members = g.members.filter((id) => id !== ids[0]);
          }
        }
        for (const g of groups)
          g!.members = [...new Set([...g!.members, ...ids])];
      },
      single ? "分组已更新" : "已加入分组",
    )
  ) {
    checked.value = [];
    batchGroups.value = [];
    dialog.value = "";
  }
}
async function removeChecked() {
  const ids = [...checked.value];
  const groupId = currentGroup.value?.id;
  if (
    await commit((a) => {
      if (groupId) {
        const g = a.workspace!.groups.find((g) => g.id === groupId)!;
        g.members = g.members.filter((id) => !ids.includes(id));
      } else removeWatchlist(a.workspace!, ids);
    }, "已移出自选视图，持仓与历史流水保留")
  ) {
    checked.value = [];
    dialog.value = "";
  }
}
async function moveRow(delta: number) {
  const id = checked.value[0];
  if (!id || checked.value.length !== 1) return;
  await commit((a) => {
    const state = a.workspace!,
      list = currentGroup.value
        ? state.groups.find((g) => g.id === currentGroup.value!.id)!.members
        : state.watchlist;
    const i = list.indexOf(id),
      j = i + delta;
    if (i >= 0 && j >= 0 && j < list.length)
      [list[i], list[j]] = [list[j], list[i]];
    const v = tableView(state, state.activeView);
    v.sort = "";
    state.views[state.activeView] = v;
  }, "");
}
function selectSearchHit(hit: SecurityHit) {
  failure.value = "";
  const existing = securities.value.get(hit.market + hit.code);
  Object.assign(add, {
    market: hit.market,
    code: hit.code,
    name: existing?.name ?? hit.name,
    asset: existing?.asset ?? hit.asset,
    category:
      existing?.category ?? (hit.asset === "stock" ? "stock" : "unconfirmed"),
    settlement:
      existing?.settlement ?? (hit.asset === "stock" ? "T+1" : "unconfirmed"),
  });
  selectedAddId.value = hit.market + hit.code;
}
function clearSearchHit() {
  selectedAddId.value = "";
  add.code = "";
  add.name = "";
}
function openAddSecurity() {
  selectedAddId.value = "";
  Object.assign(add, {
    market: "sh",
    code: "",
    name: "",
    asset: "etf",
    category: "unconfirmed",
    settlement: "unconfirmed",
  });
  dialog.value = "add";
}
async function addSecurity() {
  if (!selectedAddId.value || selectedAddId.value !== add.market + add.code) {
    failure.value = "请先从搜索结果中选择证券";
    return;
  }
  const id = add.market + add.code;
  if (
    await commit((a) => {
      const existing = a.securities.find((s) => s.id === id);
      if (!existing) {
        const s: Security = {
          ...add,
          id,
          category: add.asset === "stock" ? "stock" : add.category,
          settlement:
            add.asset === "stock" || add.category === "domestic"
              ? "T+1"
              : add.settlement,
        };
        validateSecurity(s);
        a.securities.push(s);
      }
      if (!a.workspace!.watchlist.includes(id)) a.workspace!.watchlist.push(id);
      if (currentGroup.value) {
        const g = a.workspace!.groups.find(
          (g) => g.id === currentGroup.value!.id,
        )!;
        if (!g.members.includes(id)) g.members.push(id);
      }
      a.selectedId = id;
    }, "已添加自选")
  ) {
    selected.value = id;
    dialog.value = "";
  }
}
function openRecord(kind: "record" | "cash" | "opening") {
  if (kind !== "cash" && !security.value) {
    failure.value = "请先选择证券";
    return;
  }
  action.value = kind;
  dialog.value = "entry";
}
async function closeEntry() {
  try {
    await workbench.value?.flush();
    dialog.value = "";
    action.value = undefined;
  } catch (e) {
    failure.value =
      e instanceof Error ? e.message : "草稿尚未保存，暂不关闭，请重试";
  }
}
async function restore(a: Account) {
  if (
    await commit(
      (next) => Object.assign(next, a),
      "账户已恢复，恢复前数据保留为新恢复点",
    )
  ) {
    selected.value = a.selectedId;
    page.value = "market";
    drawer.value = false;
    checked.value = [];
  }
}
async function clearCache() {
  try {
    await clearMarket();
    notify("仅清理行情缓存，账户记录未改变");
    void poller.refresh();
    void flowPoller.refresh();
  } catch (e) {
    failure.value = String(e);
  }
}
const poller = makeMarketPoller();
const flowPoller = makeFundFlowPoller();
let clockTimer: ReturnType<typeof setInterval>,
  chartTimer: ReturnType<typeof setInterval>;
function targets() {
  if (!ready.value) return;
  const ids = [
    ...visible.value,
    ...rows.value.map((s) => s.id),
    ...holdingIds.value,
    ...(selected.value ? [selected.value] : []),
  ];
  const symbols = ids.flatMap((id) =>
    securities.value.has(id) ? [securities.value.get(id)!] : [],
  );
  poller.setTargets(symbols);
  flowPoller.setTargets(symbols);
}
async function refreshCharts() {
  if (!ready.value || document.hidden) return;
  const ids = [...new Set([...visible.value, ...holdingIds.value])];
  for (const id of ids) {
    const s = securities.value.get(id);
    if (!s) continue;
    const active = () =>
      visible.value.includes(id) || holdingIds.value.includes(id);
    void getChart(s, "daily", active).catch(() => {});
    if (holdingIds.value.includes(id))
      void getChart(s, "daily-raw", active).catch(() => {});
  }
}
watch(
  () => [
    visible.value.join(),
    rows.value.map((s) => s.id).join(),
    holdingIds.value.join(),
    selected.value,
    ready.value,
  ],
  () => {
    targets();
    void refreshCharts();
  },
);
watch(page, () => {
  checked.value = [];
  drawer.value = false;
});
watch(
  [page, () => w.value.activeView, query, assetFilter, dialog, drawer],
  () => {
    rowMenu.value = null;
    const visible = new Set(rows.value.map((s) => s.id));
    checked.value = checked.value.filter((id) => visible.has(id));
  },
);
let drawerPreviousFocus: HTMLElement | null = null;
watch(drawer, async (open) => {
  if (open) {
    drawerPreviousFocus =
      document.querySelector<HTMLElement>(
        `.securities-table tr[data-symbol="${selected.value}"] .security-name`,
      ) ?? (document.activeElement as HTMLElement);
    await nextTick();
    document.querySelector<HTMLElement>('[aria-label="关闭证券详情"]')?.focus();
  } else {
    await nextTick();
    drawerPreviousFocus?.focus({ preventScroll: true });
  }
});
function closeDrawer() {
  if (!dialog.value) drawer.value = false;
}
let previousFocus: HTMLElement | null = null;
watch(dialog, async (value) => {
  if (value) {
    previousFocus = document.activeElement as HTMLElement;
    failure.value = "";
    await nextTick();
    const priceInput =
      value === "entry" && action.value === "record"
        ? document.querySelector<HTMLElement>(
            '.entry-dialog input[aria-label="成交价"]',
          )
        : null;
    (
      priceInput ??
      (value === "add"
        ? document.querySelector<HTMLElement>(".security-search input")
        : null) ??
      document.querySelector<HTMLElement>(
        ".desk-overlay input,.desk-overlay button,.desk-overlay select",
      )
    )?.focus();
  } else {
    await nextTick();
    previousFocus?.focus({ preventScroll: true });
  }
});
function keys(e: KeyboardEvent) {
  if (!dialog.value && !drawer.value) return;
  if (e.key === "Escape" && !saving.value) {
    e.preventDefault();
    if (!dialog.value) closeDrawer();
    else if (dialog.value === "entry") void closeEntry();
    else dialog.value = "";
  }
  if (e.key !== "Tab") return;
  const panel = document.querySelector(
    dialog.value ? ".desk-overlay" : ".security-drawer",
  );
  const nodes = [
    ...(panel?.querySelectorAll<HTMLElement>(
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']",
    ) ?? []),
  ].filter((n) => n.getClientRects().length);
  if (!nodes.length) return;
  const first = nodes[0],
    last = nodes.at(-1)!;
  if (
    e.shiftKey &&
    (document.activeElement === first ||
      !panel?.contains(document.activeElement))
  ) {
    e.preventDefault();
    last.focus();
  } else if (
    !e.shiftKey &&
    (document.activeElement === last ||
      !panel?.contains(document.activeElement))
  ) {
    e.preventDefault();
    first.focus();
  }
}
function visibility() {
  if (!document.hidden) {
    void poller.refresh();
    void flowPoller.refresh();
    void refreshCharts();
  }
}
onMounted(async () => {
  try {
    const loaded = await loadAccount();
    account.value = upgradeWorkspace(upgradeAccount(loaded.account));
    revision.value = loaded.revision;
    selected.value = account.value.selectedId;
    if (
      loaded.account.schemaVersion !== 4 ||
      Object.values(loaded.account.workspace!.views).some(
        (v) => v.layoutVersion !== 8,
      )
    ) {
      revision.value = await saveAccount(account.value, revision.value);
    }
    await hydrateMarket();
    ready.value = true;
    targets();
  } catch (e) {
    fatal.value = String(e);
  }
  clockTimer = setInterval(() => (clock.value = Date.now()), 15000);
  chartTimer = setInterval(refreshCharts, 30000);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("keydown", keys);
});
onBeforeUnmount(() => {
  poller.stop();
  flowPoller.stop();
  clearInterval(clockTimer);
  clearInterval(chartTimer);
  clearTimeout(toastTimer);
  document.removeEventListener("visibilitychange", visibility);
  document.removeEventListener("keydown", keys);
});
</script>

<template>
  <main v-if="!ready" class="desk-start">
    <h1>T刻</h1>
    <p>
      {{
        fatal ? "账户未打开，原始文件未覆盖：" + fatal : "正在打开证券工作区…"
      }}
    </p>
  </main>
  <main v-else class="desk">
    <header class="desk-header">
      <div class="desk-brand">
        <b>T</b><strong>T刻<small>证券工作台</small></strong>
      </div>
      <nav aria-label="主工作区">
        <button
          v-for="p in [
            { id: 'market', name: '自选与持仓' },
            { id: 'trades', name: '历史成交' },
            { id: 'cash', name: '资金流水' },
            { id: 'fees', name: '费用设置' },
            { id: 'backup', name: '备份恢复' },
          ]"
          :key="p.id"
          :class="{ active: page === p.id }"
          :disabled="saving"
          @click="page = p.id"
        >
          {{ p.name }}
        </button>
      </nav>
      <span class="desk-local"
        >{{ isTauri() ? "本机账本" : "浏览器预览" }} · 不连接券商账户</span
      >
    </header>
    <section class="desk-summary" aria-label="账户摘要">
      <div>
        <div class="summary-label">
          <span>账面总资产</span>
          <SummaryHelp label="账面总资产">
            <dl class="summary-breakdown">
              <div>
                <dt>持仓市值</dt>
                <dd>{{ money(totals.market) }}</dd>
              </div>
              <div>
                <dt>账面资金</dt>
                <dd>{{ money(ledger.cash) }}</dd>
              </div>
              <div class="breakdown-total">
                <dt>账面总资产</dt>
                <dd>{{ money(totals.total) }}</dd>
              </div>
            </dl>
            <p class="summary-breakdown-note">
              任一持仓缺少有效报价时显示“—”；这是按行情估算的账面值，不代表清仓后实际可得金额。
            </p>
          </SummaryHelp>
        </div>
        <b>{{ money(totals.total) }}</b>
      </div>
      <div>
        <div class="summary-label">
          <span>账面资金</span>
          <SummaryHelp label="账面资金">
            <dl class="summary-breakdown">
              <div>
                <dt>转入资金／迁移余额</dt>
                <dd>＋{{ money(ledger.deposits) }}</dd>
              </div>
              <div>
                <dt>卖出净收入</dt>
                <dd>＋{{ money(cashTradeTotals.sells) }}</dd>
              </div>
              <div>
                <dt>利息等收入</dt>
                <dd>＋{{ money(ledger.income) }}</dd>
              </div>
              <div class="breakdown-sub">
                <dt>转出资金</dt>
                <dd>−{{ money(ledger.withdrawals) }}</dd>
              </div>
              <div class="breakdown-sub">
                <dt>买入总支出</dt>
                <dd>−{{ money(cashTradeTotals.buys) }}</dd>
              </div>
              <div class="breakdown-total">
                <dt>账面资金</dt>
                <dd>{{ money(ledger.cash) }}</dd>
              </div>
            </dl>
            <p class="summary-breakdown-note">
              买卖金额均已包含所录手续费；建仓记录只建立持仓成本，不重复扣减资金。此数不等于券商显示的可用或可转资金。
            </p>
          </SummaryHelp>
        </div>
        <b>{{ money(ledger.cash) }}</b>
      </div>
      <div>
        <div class="summary-label">
          <span>持仓市值</span>
          <SummaryHelp label="持仓市值">
            <dl class="summary-breakdown">
              <div>
                <dt>当前持仓证券</dt>
                <dd>{{ holdingIds.length }}只</dd>
              </div>
              <div>
                <dt>持仓市值合计</dt>
                <dd>{{ money(totals.market) }}</dd>
              </div>
              <div class="breakdown-total">
                <dt>计算方式</dt>
                <dd>持仓数量 × 最新价</dd>
              </div>
            </dl>
            <p class="summary-breakdown-note">
              这里没有扣除未来卖出手续费；任一当前持仓缺少报价时，汇总显示“—”。
            </p>
          </SummaryHelp>
        </div>
        <b>{{ money(totals.market) }}</b>
      </div>
      <div class="summary-with-return">
        <div class="summary-label">
          <span>{{
            marketDate === shanghaiDate() ? "今日收益" : marketDate + " 收益"
          }}</span>
          <SummaryHelp label="今日收益">
            <dl class="summary-breakdown">
              <div>
                <dt>当前／日末持仓市值</dt>
                <dd>{{ money(dailyBreakdown.end) }}</dd>
              </div>
              <div class="breakdown-sub">
                <dt>日初持仓市值</dt>
                <dd>{{ signedMoney(dailyBreakdown.start, "−") }}</dd>
              </div>
              <div>
                <dt>当日卖出净收入</dt>
                <dd>＋{{ money(dailyBreakdown.sells) }}</dd>
              </div>
              <div class="breakdown-sub">
                <dt>当日买入总支出</dt>
                <dd>{{ signedMoney(dailyBreakdown.buys, "−") }}</dd>
              </div>
              <div class="breakdown-detail">
                <dt>以上成交已含手续费</dt>
                <dd>{{ money(dailyBreakdown.fees) }}</dd>
              </div>
              <div class="breakdown-total">
                <dt>今日收益</dt>
                <dd :class="tone(totals.daily)">
                  {{ money(totals.daily) }} · {{ percent(totals.dailyPercent) }}
                </dd>
              </div>
            </dl>
            <p class="summary-breakdown-note">
              收益率＝今日收益÷〔日初持仓市值＋当日净买入的正数部分〕；包含当日已清仓证券。
            </p>
          </SummaryHelp>
        </div>
        <div class="summary-values">
          <b :class="tone(totals.daily)">{{ money(totals.daily) }}</b>
          <small
            class="summary-return"
            :class="tone(totals.dailyPercent)"
            aria-label="今日收益率"
            title="收益率＝汇总日收益÷〔日初总市值＋max(当日买入总支出−卖出净收入,0)〕；含当日清仓证券，缺少数据或基数≤0时显示—"
            >{{ percent(totals.dailyPercent) }}</small
          >
        </div>
      </div>
      <div class="summary-with-return">
        <div class="summary-label">
          <span>当前持仓轮次收益</span>
          <SummaryHelp label="当前持仓轮次收益">
            <dl class="summary-breakdown">
              <div>
                <dt>当前持仓市值</dt>
                <dd>{{ money(totals.market) }}</dd>
              </div>
              <div class="breakdown-sub">
                <dt>当前轮次净投入</dt>
                <dd>−{{ money(totals.cycleInvestment) }}</dd>
              </div>
              <div class="breakdown-total">
                <dt>当前持仓轮次收益</dt>
                <dd :class="tone(totals.cycle)">
                  {{ money(totals.cycle) }} · {{ percent(totals.cyclePercent) }}
                </dd>
              </div>
            </dl>
            <p class="summary-breakdown-note">
              收益率＝本轮收益÷本轮净投入。只有跨交易日日终持仓归零，才结束该轮次；净投入≤0时收益率显示“—”。
            </p>
          </SummaryHelp>
        </div>
        <div class="summary-values">
          <b :class="tone(totals.cycle)">{{ money(totals.cycle) }}</b>
          <small
            class="summary-return"
            :class="tone(totals.cyclePercent)"
            aria-label="当前持仓轮次收益率"
            title="收益率＝汇总本轮收益÷汇总本轮净投入；与上方金额范围一致，含当日清仓证券，缺少数据或净投入≤0时显示—"
            >{{ percent(totals.cyclePercent) }}</small
          >
        </div>
      </div>
      <div>
        <div class="summary-label">
          <span>利息等收入</span>
          <SummaryHelp label="利息等收入">
            <dl class="summary-breakdown">
              <div>
                <dt>国债逆回购利息</dt>
                <dd>{{ money(incomeBreakdown.repo) }}</dd>
              </div>
              <div>
                <dt>普通利息</dt>
                <dd>{{ money(incomeBreakdown.interest) }}</dd>
              </div>
              <div>
                <dt>其他收入</dt>
                <dd>{{ money(incomeBreakdown.other) }}</dd>
              </div>
              <div class="breakdown-total">
                <dt>利息等收入合计</dt>
                <dd>{{ money(ledger.income) }}</dd>
              </div>
            </dl>
            <p class="summary-breakdown-note">
              不包含转入资金、卖出收入；该金额已经计入账面资金和账面总资产，不会再次叠加。
            </p>
          </SummaryHelp>
        </div>
        <b :class="tone(ledger.income)">{{ money(ledger.income) }}</b>
      </div>
    </section>
    <FloatingNotice :message="failure" />
    <FloatingNotice
      :message="
        ledger.cashWarnings
          ? '待对账：存在历史负资金余额。请补齐真实资金流水，不影响查看与手工录入。'
          : ''
      "
      kind="warning"
    />
    <section v-if="page === 'market'" class="market-workspace">
      <div class="desk-toolbar">
        <div class="view-tabs">
          <button
            :class="{ active: w.activeView === 'all' }"
            @click="switchView('all')"
          >
            全部自选 <small>{{ w.watchlist.length }}</small></button
          ><button
            :class="{ active: isHoldings }"
            @click="switchView('holdings')"
          >
            我的持仓 <small>{{ holdingIds.length }}</small></button
          ><button
            :class="{ active: w.activeView === 'profit' }"
            title="累计收益贡献大于0；包含历史已实现收益和当前持仓浮盈亏"
            @click="switchView('profit')"
          >
            盈利 <small>{{ contributionStats.profitIds.length }}</small></button
          ><button
            :class="{ active: w.activeView === 'loss' }"
            title="累计收益贡献小于0；包含历史已实现亏损和当前持仓浮盈亏"
            @click="switchView('loss')"
          >
            亏损 <small>{{ contributionStats.lossIds.length }}</small></button
          ><button
            v-for="g in w.groups"
            :key="g.id"
            :class="{ active: w.activeView === g.id }"
            @click="switchView(g.id)"
          >
            {{ g.name }} <small>{{ g.members.length }}</small>
          </button>
        </div>
        <button class="plain" @click="dialog = 'groups'">管理分组</button>
      </div>
      <div class="desk-controls">
        <input
          v-model="query"
          aria-label="搜索自选"
          placeholder="搜索名称 / 代码"
        /><select v-model="assetFilter" aria-label="品种筛选">
          <option value="all">全部品种</option>
          <option value="stock">股票</option>
          <option value="etf">ETF</option>
        </select>
        <div class="segmented">
          <button
            :class="{ active: w.chartMode === 'intraday' }"
            @click="commit((a) => (a.workspace!.chartMode = 'intraday'), '')"
          >
            分时</button
          ><button
            :class="{ active: w.chartMode === 'daily' }"
            @click="commit((a) => (a.workspace!.chartMode = 'daily'), '')"
          >
            日K · 60日
          </button>
        </div>
        <span class="controls-spacer"></span
        ><button v-if="!isContribution" @click="editColumns">设置列</button
        ><button class="primary" @click="openRecord('record')">交易</button
        ><button class="primary" @click="openAddSecurity">＋ 添加自选</button>
      </div>
      <div class="desk-market-body">
        <div class="desk-table-region">
          <SecuritiesTable
            :rows="rows"
            :view="view"
            :mode="w.chartMode"
            :positions="ledger.positions"
            :holding-days="holdingDayCounts"
            :recorded-ids="recordedIds"
            :daily="performance"
            :contributions="contributionStats.byId"
            :variant="activeViewKind"
            :selected="selected"
            :checked="checked"
            @select="choose"
            @detail="detail"
            @check="checked = $event"
            @config="config"
            @visible="visible = $event"
            @pnl="showPnl"
            @context="openRowMenu"
          />
          <footer class="table-status">
            <span
              >{{ title }} · {{ rows.length }} 只 · 双击详情 / 右键操作
              <span :title="'⌘/Ctrl点选多只，Shift连选后右键批量操作'">
                ·
                {{
                  checked.length > 1
                    ? `已选${checked.length}只`
                    : "⌘/Ctrl多选 · Shift连选"
                }}</span
              >
              <span v-if="view.sort">· 指标排序，操作时暂停重排</span></span
            ><span>{{ marketStatus.text }}</span
            ><span :title="fundFlowStatus.text">资金流：东方财富</span>
          </footer>
        </div>
        <Transition name="security-slide">
          <div
            v-if="drawer && security"
            class="security-drawer-overlay"
            @click.self="closeDrawer"
          >
            <aside
              class="security-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="security-detail-title"
              :inert="dialog ? true : undefined"
            >
              <header>
                <div>
                  <h2 id="security-detail-title">{{ security.name }}</h2>
                  <small
                    >{{ security.id }} ·
                    {{ security.asset === "etf" ? "ETF" : "A股" }} ·
                    {{ security.settlement }}</small
                  >
                </div>
                <button
                  class="drawer-close"
                  aria-label="关闭证券详情"
                  @click="closeDrawer"
                >
                  ×
                </button>
              </header>
              <div class="drawer-price">
                <strong :class="tone(marketQuotes[selected]?.change)">{{
                  money(
                    marketQuotes[selected]?.latest,
                    security.asset === "etf" ? 3 : 2,
                  )
                }}</strong
                ><span :class="tone(marketQuotes[selected]?.change)"
                  >{{ marketQuotes[selected]?.change ?? "—" }}%</span
                >
              </div>
              <nav class="drawer-tabs">
                <button
                  v-for="t in [
                    { id: 'chart', name: '行情' },
                    { id: 'pnl', name: '收益明细' },
                    { id: 'planner', name: '做T测算' },
                    { id: 'trades', name: '交易记录' },
                  ]"
                  :key="t.id"
                  :class="{ active: detailTab === t.id }"
                  @click="detailTab = t.id"
                >
                  {{ t.name }}
                </button>
              </nav>
              <div v-if="detailTab === 'chart'" class="drawer-section">
                <div class="segmented">
                  <button
                    v-for="m in detailModes"
                    :key="m.id"
                    :class="{ active: detailMode === m.id }"
                    @click="detailMode = m.id"
                  >
                    {{ m.name }}
                  </button>
                </div>
                <div class="drawer-chart">
                  <MarketChart
                    :security="security"
                    :mode="detailMode"
                    :trades="account.entries"
                  />
                </div>
                <dl class="impact-list">
                  <div>
                    <dt>持仓 / 估算可卖</dt>
                    <dd>
                      {{ ledger.positions[selected]?.quantity ?? 0 }} /
                      {{ ledger.positions[selected]?.available ?? 0 }}
                    </dd>
                  </div>
                  <div>
                    <dt>FIFO每股成本</dt>
                    <dd>
                      {{ money(ledger.positions[selected]?.averageCost, 4) }}
                    </dd>
                  </div>
                  <div>
                    <dt>做T摊薄每股成本</dt>
                    <dd>
                      {{ money(ledger.positions[selected]?.dilutedCost, 4) }}
                    </dd>
                  </div>
                  <div>
                    <dt>累计FIFO已实现</dt>
                    <dd>{{ money(ledger.positions[selected]?.realized) }}</dd>
                  </div>
                </dl>
                <p class="data-note">
                  公开行情可能延迟，显示时间以报价为准。分红、送转等公司行动需另行核对，当前账本不自动处理。
                </p>
              </div>
              <section v-else-if="detailTab === 'pnl'" class="drawer-section">
                <h3>日收益核对 · {{ performance[selected]?.date }}</h3>
                <p v-if="performance[selected]?.reason" class="desk-warning">
                  {{ performance[selected].reason }}
                </p>
                <dl v-if="performance[selected]" class="impact-list">
                  <div>
                    <dt>日初持仓数量</dt>
                    <dd>{{ performance[selected].quantityStart }}</dd>
                  </div>
                  <div>
                    <dt>上一交易日不复权收盘</dt>
                    <dd>{{ money(performance[selected].previousClose, 4) }}</dd>
                  </div>
                  <div>
                    <dt>日初持仓市值</dt>
                    <dd>{{ money(performance[selected].startValue) }}</dd>
                  </div>
                  <div>
                    <dt>当前 / 日末持仓市值</dt>
                    <dd>{{ money(performance[selected].endValue) }}</dd>
                  </div>
                  <div>
                    <dt>当日卖出净收入</dt>
                    <dd>＋{{ money(performance[selected].sells) }}</dd>
                  </div>
                  <div>
                    <dt>当日买入总支出</dt>
                    <dd>−{{ money(performance[selected].buys) }}</dd>
                  </div>
                  <div>
                    <dt>已包含手续费</dt>
                    <dd>{{ money(performance[selected].fees) }}</dd>
                  </div>
                  <div>
                    <dt>该交易日收益</dt>
                    <dd :class="tone(performance[selected].profit)">
                      {{ money(performance[selected].profit) }}
                    </dd>
                  </div>
                  <div>
                    <dt>该交易日收益率</dt>
                    <dd :class="tone(performance[selected].profit)">
                      {{
                        dailyReturnPercent(performance[selected]) === null
                          ? "—"
                          : dailyReturnPercent(performance[selected]) + "%"
                      }}
                    </dd>
                  </div>
                </dl>
                <p class="data-note">
                  收益＝当前市值−日初市值＋卖出净收入−买入总支出。费用已包含，不再次扣除；不包含资金转账和利息。未记录的分红送转会影响准确性，不保证与券商完全一致。
                  收益率＝收益÷〔日初市值＋max(买入总支出−卖出净收入,
                  0)〕。基准缺失或分母≤0时显示“—”；这是本软件的日收益率口径，并非证券自身涨跌幅。
                </p>
              </section>
              <KeepAlive :max="2">
                <LedgerWorkbench
                  v-if="detailTab === 'planner' || detailTab === 'trades'"
                  :key="selected + detailTab"
                  embedded
                  :initial-tab="detailTab"
                  :symbol="selected"
                  :history-security-id="
                    detailTab === 'trades' ? selected : undefined
                  "
                  :history-read-only="detailTab === 'trades'"
                  :snapshot="snapshot"
                  @saved="saved"
                />
              </KeepAlive>
              <footer class="drawer-actions">
                <button @click="openRecord('opening')">录入期初持仓</button
                ><button class="primary" @click="openRecord('record')">
                  交易
                </button>
              </footer>
            </aside>
          </div>
        </Transition>
      </div>
    </section>
    <section v-else-if="page === 'backup'" class="desk-page">
      <RecoveryCenter
        :account="account"
        :saving="saving"
        @restore="restore"
        @notice="notify"
      /><button class="clear-cache" @click="clearCache">仅清理行情缓存</button>
      <FloatingNotice :message="marketStatus.cacheError" kind="warning" />
    </section>
    <section v-else class="desk-page">
      <header class="page-heading">
        <h2>
          {{
            page === "trades"
              ? "历史成交"
              : page === "cash"
                ? "资金流水"
                : "股票与ETF独立费率"
          }}
        </h2>
        <div v-if="page === 'trades'" class="record-actions">
          <button class="primary" @click="openRecord('record')">交易</button>
        </div>
        <button
          v-if="page === 'cash'"
          class="primary"
          @click="openRecord('cash')"
        >
          ＋ 资金流水
        </button>
      </header>
      <LedgerWorkbench
        :key="page"
        embedded
        :initial-tab="page"
        :symbol="selected"
        :snapshot="snapshot"
        @saved="saved"
      />
    </section>
    <footer class="desk-footer">
      <span>T刻 0.4 · 手工证券账本</span
      ><span>仅本机保存 · 费用以交割单为准 · 行情不保证成交</span
      ><span v-if="saving">正在保存…</span>
    </footer>
    <FloatingNotice :message="toast" kind="info" :duration="3000" />
    <RowContextMenu
      v-if="rowMenu"
      :key="rowMenu.id"
      :x="rowMenu.x"
      :y="rowMenu.y"
      :title="
        checked.length > 1
          ? `已选 ${checked.length} 只证券`
          : (securities.get(rowMenu.id)?.name ?? '')
      "
      :items="menuItems"
      @close="rowMenu = null"
      @action="rowMenuAction"
    />
    <div
      v-if="dialog"
      class="desk-overlay"
      @click.self="
        !saving && (dialog === 'entry' ? closeEntry() : (dialog = ''))
      "
      role="dialog"
      aria-modal="true"
      :aria-label="
        dialog === 'entry'
          ? '录入账本'
          : dialog === 'columns'
            ? '设置表格列'
            : dialog === 'groups'
              ? '管理分组'
              : dialog === 'add'
                ? '添加自选'
                : '确认操作'
      "
    >
      <section
        class="desk-dialog"
        :class="{ 'entry-dialog': dialog === 'entry' }"
      >
        <button
          class="dialog-x"
          aria-label="关闭对话框"
          :disabled="saving"
          @click="dialog === 'entry' ? closeEntry() : (dialog = '')"
        >
          ×
        </button>
        <template v-if="dialog === 'entry'"
          ><h2>
            {{
              action === "record"
                ? "录入成交"
                : action === "cash"
                  ? "录入资金流水"
                  : "录入期初持仓"
            }}
          </h2>
          <p v-if="action !== 'cash' && security" class="entry-security">
            {{ security.name }} · {{ security.id }} ·
            {{ security.asset === "etf" ? "ETF" : "股票" }}
          </p>
          <LedgerWorkbench
            ref="workbench"
            :key="selected + action"
            embedded
            :symbol="selected"
            :action="action"
            :snapshot="snapshot"
            @saved="saved"
            @close="closeEntry"
        /></template>
        <form v-else-if="dialog === 'add'" @submit.prevent="addSecurity">
          <h2>添加自选</h2>
          <p>
            已有证券只恢复到自选，不修改原交易记录。股票与ETF类别按实际确认。
          </p>
          <SecuritySearch
            :securities="account.securities"
            @select="selectSearchHit"
            @clear="clearSearchHit"
          />
          <div
            v-if="selectedAddId"
            class="selected-security"
            aria-label="已选择证券"
          >
            <span
              ><strong>{{ add.name }}</strong
              ><small>{{ add.asset === "etf" ? "ETF" : "股票" }}</small></span
            >
            <span class="search-code"
              >{{ add.market.toUpperCase() }} {{ add.code }}</span
            >
          </div>
          <p v-else class="selection-required">请从搜索结果中选择一只证券</p>
          <label v-if="selectedAddId && add.asset === 'etf'"
            >ETF类别<select v-model="add.category">
              <option value="domestic">境内股票ETF</option>
              <option value="cross-border">跨境ETF</option>
              <option value="gold">黄金ETF</option>
              <option value="bond">债券ETF</option>
              <option value="unconfirmed">未确认</option>
            </select></label
          ><label
            v-if="
              selectedAddId &&
              add.asset === 'etf' &&
              add.category !== 'domestic'
            "
            >回转规则<select v-model="add.settlement">
              <option value="T+1">T+1</option>
              <option value="T+0">已确认T+0</option>
              <option value="unconfirmed">未确认</option>
            </select></label
          ><button class="primary" :disabled="saving || !selectedAddId">
            添加到自选
          </button>
        </form>
        <template v-else-if="dialog === 'groups'"
          ><h2>管理自选分组</h2>
          <p>一只证券可以加入多个组；删除组不会删除证券和交易。</p>
          <div class="group-list">
            <div v-for="(g, i) in w.groups" :key="g.id">
              <b :title="g.name">{{ g.name }}</b
              ><small>{{ g.members.length }}只</small
              ><button
                class="group-move"
                :aria-label="'上移分组' + g.name"
                :disabled="i === 0 || saving"
                @click="moveGroup(g.id, -1)"
              >
                ↑</button
              ><button
                class="group-move"
                :aria-label="'下移分组' + g.name"
                :disabled="i === w.groups.length - 1 || saving"
                @click="moveGroup(g.id, 1)"
              >
                ↓</button
              ><button
                @click="
                  editedGroup = g.id;
                  groupName = g.name;
                "
              >
                重命名</button
              ><button
                class="delete-link"
                @click="
                  editedGroup = g.id;
                  dialog = 'deleteGroup';
                "
              >
                删除
              </button>
            </div>
          </div>
          <form
            class="group-form"
            @submit.prevent="
              editedGroup ? renameGroup(editedGroup) : addGroup()
            "
          >
            <label
              >{{ editedGroup ? "新的分组名称" : "新增分组"
              }}<input
                v-model="groupName"
                maxlength="24"
                placeholder="例如：做T关注" /></label
            ><button class="primary" :disabled="saving">
              {{ editedGroup ? "保存名称" : "创建分组" }}</button
            ><button
              v-if="editedGroup"
              type="button"
              @click="
                editedGroup = '';
                groupName = '';
              "
            >
              取消重命名
            </button>
          </form></template
        >
        <template v-else-if="dialog === 'deleteGroup'"
          ><h2>删除这个分组？</h2>
          <p>只移除分组与分组列设置，所有自选证券、持仓和交易都保留。</p>
          <footer>
            <button @click="dialog = 'groups'">取消</button
            ><button
              class="destructive"
              :disabled="saving"
              @click="deleteGroup"
            >
              确认删除分组
            </button>
          </footer></template
        >
        <form v-else-if="dialog === 'addToGroup'" @submit.prevent="addToGroup">
          <h2>加入分组 · {{ checked.length }}只证券</h2>
          <p v-if="checked.length === 1">
            勾选加入，取消勾选移出对应分组；确认后生效，不影响全部自选、持仓和历史交易。
          </p>
          <p v-else>可多选，仅添加到勾选的分组，不移除已有分组关联。</p>
          <fieldset
            v-if="w.groups.length"
            class="group-picker"
            :disabled="saving"
          >
            <legend>目标分组 · 已选 {{ batchGroups.length }} 个</legend>
            <div class="group-picker-list">
              <label
                v-for="g in w.groups"
                :key="g.id"
                :class="{ selected: batchGroups.includes(g.id) }"
              >
                <input
                  v-model="batchGroups"
                  type="checkbox"
                  :value="g.id"
                  :aria-label="g.name"
                />
                <span>{{ g.name }}</span>
                <small>{{ g.members.length }}只</small>
              </label>
            </div>
          </fieldset>
          <p v-else>还没有自定义分组，请先创建。</p>
          <footer>
            <button type="button" :disabled="saving" @click="dialog = 'groups'">
              管理分组
            </button>
            <button type="button" :disabled="saving" @click="dialog = ''">
              取消
            </button>
            <button class="primary" :disabled="!canSaveGroups || saving">
              {{ checked.length === 1 ? "保存分组" : "加入分组" }}
            </button>
          </footer>
        </form>
        <template v-else-if="dialog === 'remove'"
          ><h2>移出{{ checked.length }}只证券？</h2>
          <p>
            {{
              currentGroup
                ? "仅移出当前分组，其他分组和全部自选仍保留。"
                : "将从全部自选及自定义分组移除，但仍可在持仓与历史记录中查看。"
            }}不会删除交易或资金流水。
          </p>
          <footer>
            <button @click="dialog = ''">取消</button
            ><button
              class="destructive"
              :disabled="saving"
              @click="removeChecked"
            >
              确认移出
            </button>
          </footer></template
        >
        <template v-else-if="dialog === 'columns'"
          ><h2>设置表格列 · {{ isHoldings ? "我的持仓" : "行情分组" }}</h2>
          <p>
            我的持仓可使用持仓与收益字段；其他自选分组只提供行情字段。列宽由当前视图自动配置，走势填充剩余空间。拖动字段左侧手柄调整当前视图顺序，也可使用↑↓按钮或方向键。
          </p>
          <div class="column-options">
            <label v-for="(label, c) in configurableColumns" :key="c"
              ><input
                type="checkbox"
                :checked="columns.columns.includes(c)"
                @change="toggleColumn(c)"
              />{{ label }}</label
            >
          </div>
          <div class="column-order">
            <div
              v-for="(c, i) in columns.columns"
              :key="c"
              :data-column-order="c"
              :class="{ 'is-dragging': draggedColumn === c }"
            >
              <button
                class="column-drag-handle"
                :aria-label="'拖动排序：' + columnLabels[c]"
                @pointerdown="beginColumnDrag($event, c)"
                @keydown.up.prevent="moveColumn(i, -1)"
                @keydown.down.prevent="moveColumn(i, 1)"
              >
                ⠿
              </button>
              <b>{{ columnLabels[c] }}</b
              ><button
                :aria-label="'上移' + columnLabels[c]"
                :disabled="i === 0"
                @click="moveColumn(i, -1)"
              >
                ↑</button
              ><button
                :disabled="i === columns.columns.length - 1"
                :aria-label="'下移' + columnLabels[c]"
                @click="moveColumn(i, 1)"
              >
                ↓</button
              ><span v-if="c === 'chart'" class="auto-column-width">自动</span
              ><span
                v-else
                class="auto-column-width"
                :aria-label="columnLabels[c] + '列宽'"
                >{{ defaultColumnWidth(c, activeViewKind) }}px</span
              >
            </div>
          </div>
          <footer>
            <button @click="restoreDefaultColumns">恢复当前视图默认</button
            ><button class="primary" :disabled="saving" @click="saveColumns">
              保存列设置
            </button>
          </footer></template
        >
      </section>
    </div>
  </main>
</template>

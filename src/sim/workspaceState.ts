import type { Account, TableView, WorkspaceState } from "./model";

export const marketColumns = [
  "chart",
  "change",
  "fiveDay",
  "peRatio",
  "pbRatio",
  "volumeRatio",
  "turnover",
  "amplitude",
  "flow",
  "floatCap",
  "volume",
];
export const positionColumns = ["marketValue", "dailyPnl", "cyclePnl"];
export const contributionColumns = [
  "chart",
  "change",
  "fiveDay",
  "peRatio",
  "pbRatio",
  "activity",
  "amplitude",
  "sizeVolume",
  "totalContribution",
  "contributionBreakdown",
  "flow",
];
export const automaticViewIds = ["profit", "loss"] as const;
export type TableViewKind = "market" | "holdings" | "contribution";
export const columnLabels: Record<string, string> = {
  chart: "走势",
  change: "涨跌幅",
  fiveDay: "5日涨跌幅",
  peRatio: "市盈率",
  pbRatio: "市净率",
  openPrevious: "今开 / 昨收",
  highLow: "最高 / 最低",
  bidAsk: "买一 / 卖一",
  sessionRange: "当日区间",
  activity: "量比 / 换手率",
  sizeVolume: "流通市值 / 成交量",
  volumeRatio: "量比",
  turnover: "换手率",
  amplitude: "振幅",
  flow: "主力净流入",
  floatCap: "流通市值",
  volume: "成交量",
  quantity: "持仓数量",
  marketValue: "持仓市值",
  dilutedCost: "持仓成本单价",
  dailyPnl: "今日盈亏",
  cyclePnl: "本轮持仓盈亏",
  totalContribution: "累计收益贡献",
  realizedContribution: "历史已实现",
  holdingContribution: "当前持仓浮盈亏",
  contributionBreakdown: "历史 / 持仓贡献",
};
export function viewKind(id: string): TableViewKind {
  if (id === "holdings") return "holdings";
  if (automaticViewIds.includes(id as (typeof automaticViewIds)[number]))
    return "contribution";
  return "market";
}
export function defaultColumnWidth(
  column: string,
  kind: TableViewKind | number = "holdings",
): number {
  const resolvedKind = typeof kind === "string" ? kind : "holdings";
  if (column === "chart") return resolvedKind === "contribution" ? 120 : 165;
  if (resolvedKind === "contribution") {
    if (["change", "fiveDay"].includes(column)) return 82;
    if (["peRatio", "pbRatio"].includes(column)) return 72;
    if (column === "activity") return 80;
    if (column === "amplitude") return 66;
    if (column === "sizeVolume") return 100;
    if (column === "totalContribution") return 116;
    if (column === "contributionBreakdown") return 118;
    if (column === "flow") return 88;
  }
  if (resolvedKind !== "holdings") {
    if (["peRatio", "pbRatio"].includes(column)) return 80;
    if (["volumeRatio", "turnover", "amplitude"].includes(column)) return 74;
    if (["floatCap", "volume"].includes(column)) return 88;
    if (column === "flow") return 104;
  }
  // Fixed from the user's saved Mac layout (2026-08-31, revision 938).
  if (column === "marketValue") return 96;
  if (column === "cyclePnl") return 93;
  if (column === "flow") return 95;
  if (column === "dilutedCost") return 100;
  if (["change", "fiveDay"].includes(column)) return 90;
  if (column === "dailyPnl") return 85;
  return 80;
}
const defaultColumns = [
  "chart",
  "dailyPnl",
  "cyclePnl",
  "change",
  "fiveDay",
  "volumeRatio",
  "turnover",
  "amplitude",
  "floatCap",
  "volume",
  "marketValue",
  "flow",
];
const defaultMarketColumns = [
  "chart",
  "change",
  "fiveDay",
  "peRatio",
  "pbRatio",
  "volumeRatio",
  "turnover",
  "amplitude",
  "floatCap",
  "volume",
  "flow",
];
const deprecatedQuoteColumns = ["openPrevious", "highLow", "bidAsk"];
const valuationColumns = ["peRatio", "pbRatio"];
function withValuationColumns(columns: string[]) {
  const result = columns.filter(
    (column) =>
      !deprecatedQuoteColumns.includes(column) &&
      !valuationColumns.includes(column),
  );
  const after = result.includes("fiveDay")
    ? result.indexOf("fiveDay") + 1
    : result.includes("chart")
      ? result.indexOf("chart") + 1
      : 0;
  result.splice(after, 0, ...valuationColumns);
  return result;
}
/** Only the explicitly requested order constraints change for existing layouts. */
function currentColumnOrder(columns: string[]) {
  const out = columns.filter((c) => c !== "flow");
  if (out.includes("dailyPnl") && out.includes("cyclePnl")) {
    out.splice(out.indexOf("cyclePnl"), 1);
    out.splice(out.indexOf("dailyPnl") + 1, 0, "cyclePnl");
  }
  if (columns.includes("flow")) out.push("flow");
  return out;
}
export const configurableColumnLabels = Object.fromEntries(
  Object.entries(columnLabels).filter(
    ([key]) => key !== "dilutedCost" && key !== "quantity",
  ),
);
export function configurableColumnLabelsFor(id: string) {
  const kind = viewKind(id);
  const allowed = new Set(
    kind === "holdings"
      ? defaultColumns
      : kind === "contribution"
        ? contributionColumns
        : defaultMarketColumns,
  );
  return Object.fromEntries(
    Object.entries(configurableColumnLabels).filter(([key]) =>
      allowed.has(key),
    ),
  );
}
function previousColumnWidth(column: string) {
  if (column === "chart") return 188;
  if (
    ["flow", "floatCap", "marketValue", "dilutedCost", "cyclePnl"].includes(
      column,
    )
  )
    return 120;
  if (["fiveDay", "dailyPnl", "quantity", "volume"].includes(column))
    return 110;
  return 100;
}
/** Update old defaults, preserving custom widths and order; cost moves under price. */
function compactView(view: TableView): TableView {
  if (view.layoutVersion && view.layoutVersion >= 2) return view;
  const columns = view.columns.filter((c) => c !== "dilutedCost");
  return {
    ...view,
    columns,
    layoutVersion: 2,
    widths: Object.fromEntries(
      columns.map((c) => [
        c,
        view.widths[c] !== undefined &&
        (c === "chart" ||
          (view.layoutVersion === 1 &&
            view.widths[c] !== previousColumnWidth(c)))
          ? view.widths[c]
          : defaultColumnWidth(c),
      ]),
    ),
  };
}
export function defaultView(id = "holdings"): TableView {
  const kind = viewKind(id);
  return {
    layoutVersion: 8,
    columns:
      kind === "contribution"
        ? [...contributionColumns]
        : kind === "holdings"
          ? [...defaultColumns]
          : [...defaultMarketColumns],
    widths: {},
    sort: kind === "contribution" ? "totalContribution" : "",
    direction: id === "loss" ? "asc" : "desc",
  };
}
export function resolvedColumnWidths(
  view: TableView,
  available: number,
  kind: TableViewKind = "holdings",
) {
  const widths = Object.fromEntries(
    // Legacy widths remain readable for backup compatibility, but cannot override
    // the fixed system layout, including after restoring an older account.
    view.columns.map((c) => [c, defaultColumnWidth(c, kind)]),
  );
  if (view.columns.includes("chart")) {
    const base = kind === "holdings" ? 210 : 200;
    const fixed =
      base +
      Object.entries(widths).reduce(
        (sum, [c, width]) => sum + (c === "chart" ? 0 : width),
        0,
      );
    widths.chart = Math.max(
      defaultColumnWidth("chart", kind),
      available - fixed,
    );
  }
  return widths;
}
export function tableView(w: WorkspaceState, id: string): TableView {
  const fallback = defaultView(id);
  if (viewKind(id) === "contribution") return fallback;
  const saved = w.views[id];
  const allowed = new Set(fallback.columns);
  const columns = (saved?.columns ?? fallback.columns).filter((column) =>
    allowed.has(column),
  );
  return {
    ...fallback,
    ...saved,
    columns: columns.length ? columns : [...fallback.columns],
    widths: { ...(saved?.widths ?? {}) },
    layoutVersion: 8,
  };
}
export function setTableView(w: WorkspaceState, id: string, view: TableView) {
  if (viewKind(id) === "contribution") return;
  w.views[id] = {
    ...view,
    layoutVersion: 8,
    columns: [...view.columns],
    widths: { ...view.widths },
  };
}
export function upgradeWorkspace(a: Account): Account {
  if (a.schemaVersion === 4) {
    validateWorkspace(a);
    if (
      a.workspace!.views.all &&
      a.workspace!.views.holdings &&
      Object.values(a.workspace!.views).every((v) => v.layoutVersion === 8)
    )
      return a;
    if (
      a.workspace!.views.all &&
      a.workspace!.views.holdings &&
      Object.values(a.workspace!.views).every(
        (v) => (v.layoutVersion ?? 0) >= 6,
      )
    ) {
      const views = Object.fromEntries(
        Object.entries(a.workspace!.views).map(([id, view]) => {
          if (viewKind(id) === "holdings")
            return [
              id,
              {
                ...view,
                layoutVersion: 8 as const,
                columns: view.columns.filter(
                  (column) => !deprecatedQuoteColumns.includes(column),
                ),
              },
            ];
          return [
            id,
            {
              ...view,
              layoutVersion: 8 as const,
              columns: withValuationColumns(view.columns),
            },
          ];
        }),
      );
      return { ...a, workspace: { ...a.workspace!, views } };
    }
    const layout = compactView(
      a.workspace!.views.holdings ?? a.workspace!.views.all ?? defaultView(),
    );
    // Quantity remains under market value; preserve all other saved layout choices.
    const retainedColumns = layout.columns.filter((c) => c !== "quantity");
    const columns =
      (layout.layoutVersion ?? 0) >= 5
        ? retainedColumns
        : currentColumnOrder(retainedColumns);
    const widths = Object.fromEntries(
      Object.entries(layout.widths).filter(
        ([c]) => c !== "quantity" && c !== "chart",
      ),
    );
    // Upgrade the former default once; preserve other custom widths and later edits.
    if (widths.fiveDay === 80) widths.fiveDay = 90;
    const views: Record<string, TableView> = Object.fromEntries(
      Object.entries(a.workspace!.views).map(([id, v]) => [
        id,
        {
          ...v,
          layoutVersion: 8 as const,
          columns:
            viewKind(id) === "holdings"
              ? [...columns]
              : withValuationColumns(columns),
          widths: { ...widths },
          sort: v.sort === "quantity" ? "" : v.sort,
        },
      ]),
    );
    views.all ??= {
      ...defaultView("all"),
      columns: withValuationColumns(columns),
      widths: { ...widths },
    };
    views.holdings ??= {
      ...defaultView("holdings"),
      columns: [...columns],
      widths: { ...widths },
    };
    return {
      ...a,
      workspace: {
        ...a.workspace!,
        views,
      },
    };
  }
  if (a.schemaVersion !== 3) throw new Error("请先迁移旧账本");
  return {
    ...a,
    schemaVersion: 4,
    workspace: {
      watchlist: a.securities.map((s) => s.id),
      groups: [],
      activeView: "all",
      chartMode: "intraday",
      views: { all: defaultView("all"), holdings: defaultView("holdings") },
    },
  };
}
export function validateWorkspace(a: Account) {
  const w = a.workspace;
  if (
    !w ||
    !Array.isArray(w.watchlist) ||
    !Array.isArray(w.groups) ||
    w.groups.length > 50 ||
    !w.views ||
    !["intraday", "daily"].includes(w.chartMode)
  )
    throw new Error("自选工作区配置无效");
  const ids = new Set(a.securities.map((s) => s.id));
  const checkMembers = (members: string[], allowed: Set<string>) => {
    if (
      !Array.isArray(members) ||
      members.length > 200 ||
      new Set(members).size !== members.length ||
      members.some((id) => !allowed.has(id))
    )
      throw new Error("分组成员重复或引用不存在的证券");
  };
  checkMembers(w.watchlist, ids);
  const groupIds = new Set(["all", "holdings", ...automaticViewIds]);
  const names = new Set<string>();
  for (const g of w.groups) {
    if (
      !g ||
      typeof g.id !== "string" ||
      !/^g-[a-zA-Z0-9-]+$/.test(g.id) ||
      groupIds.has(g.id) ||
      typeof g.name !== "string" ||
      !g.name.trim() ||
      g.name.length > 24 ||
      names.has(g.name.trim())
    )
      throw new Error("分组名称或编号无效、重复");
    groupIds.add(g.id);
    names.add(g.name.trim());
    checkMembers(g.members, new Set(w.watchlist));
  }
  if (!groupIds.has(w.activeView) || Object.keys(w.views).length > 52)
    throw new Error("当前视图无效");
  for (const [id, v] of Object.entries(w.views)) {
    if (
      !groupIds.has(id) ||
      !v ||
      !Array.isArray(v.columns) ||
      new Set(v.columns).size !== v.columns.length ||
      v.columns.some((c) => !Object.hasOwn(columnLabels, c)) ||
      !["asc", "desc"].includes(v.direction) ||
      (v.sort && !["latest", ...Object.keys(columnLabels)].includes(v.sort)) ||
      !v.widths ||
      Object.entries(v.widths).some(
        ([c, n]) =>
          !Object.hasOwn(columnLabels, c) ||
          !Number.isFinite(n) ||
          n < 80 ||
          n > 400,
      )
    )
      throw new Error("表格列配置无效");
  }
}
export function removeWatchlist(w: WorkspaceState, ids: string[]) {
  const removed = new Set(ids);
  w.watchlist = w.watchlist.filter((id) => !removed.has(id));
  for (const g of w.groups)
    g.members = g.members.filter((id) => !removed.has(id));
}

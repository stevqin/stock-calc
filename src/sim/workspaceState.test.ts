import { describe, expect, it } from "vitest";
import { manualAccount } from "./record";
import {
  configurableColumnLabels,
  defaultView,
  defaultColumnWidth,
  setTableView,
  tableView,
  removeWatchlist,
  upgradeWorkspace,
  validateWorkspace,
  resolvedColumnWidths,
} from "./workspaceState";

describe("自选工作区", () => {
  it("固定列宽以最新Mac配置为准，忽略旧备份和自定义宽度，不修改输入配置", () => {
    const view = {
      ...defaultView(),
      columns: [
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
      ],
      widths: { dailyPnl: 300, cyclePnl: 300, change: 300, flow: 400 },
    };
    expect(resolvedColumnWidths(view, 2000)).toEqual({
      dailyPnl: 85,
      cyclePnl: 93,
      change: 90,
      fiveDay: 90,
      volumeRatio: 80,
      turnover: 80,
      amplitude: 80,
      floatCap: 80,
      volume: 80,
      marketValue: 96,
      flow: 95,
    });
    expect(view.widths.dailyPnl).toBe(300);
    expect(view.widths.flow).toBe(400);
    expect(
      resolvedColumnWidths({ ...view, columns: ["chart", "flow"] }, 1000),
    ).toEqual({ chart: 695, flow: 95 });
  });
  it("5日涨跌幅默认90px，旧80px只迁移一次且保留其余配置", () => {
    expect(defaultColumnWidth("fiveDay")).toBe(90);
    const a = upgradeWorkspace(manualAccount());
    for (const view of Object.values(a.workspace!.views)) {
      view.layoutVersion = 5;
      view.columns = ["flow", "fiveDay", "cyclePnl", "dailyPnl"];
      view.widths = { fiveDay: 80, dailyPnl: 87, flow: 110 };
      view.sort = "fiveDay";
    }
    const next = upgradeWorkspace(a);
    expect(next.workspace!.views.all.widths).toEqual({
      fiveDay: 90,
      dailyPnl: 87,
      flow: 110,
    });
    expect(next.workspace!.views.all.columns).toEqual([
      "flow",
      "fiveDay",
      "peRatio",
      "pbRatio",
      "cyclePnl",
      "dailyPnl",
    ]);
    expect(next.workspace!.views.all.sort).toBe("fiveDay");
    expect(next.entries).toBe(a.entries);
    expect(a.workspace!.views.all.widths.fiveDay).toBe(80);
    expect(upgradeWorkspace(next)).toBe(next);
    next.workspace!.views.all.widths.fiveDay = 80;
    expect(upgradeWorkspace(next).workspace!.views.all.widths.fiveDay).toBe(80);
    a.workspace!.views.holdings.widths.fiveDay = 125;
    expect(upgradeWorkspace(a).workspace!.views.all.widths.fiveDay).toBe(125);
  });
  it("v5采用Mac列宽，主力末列、本轮紧跟今日，迁移保留自定义数值宽度", () => {
    const a = upgradeWorkspace(manualAccount());
    for (const view of Object.values(a.workspace!.views)) {
      view.layoutVersion = 4;
      view.columns = ["chart", "dailyPnl", "flow", "change", "cyclePnl"];
      view.widths = {
        chart: 165,
        dailyPnl: 85,
        change: 137,
        cyclePnl: 100,
        flow: 100,
      };
    }
    const next = upgradeWorkspace(a);
    expect(next.workspace!.views.all.columns).toEqual([
      "chart",
      "peRatio",
      "pbRatio",
      "dailyPnl",
      "cyclePnl",
      "change",
      "flow",
    ]);
    expect(next.workspace!.views.all.widths).toEqual({
      dailyPnl: 85,
      change: 137,
      cyclePnl: 100,
      flow: 100,
    });
    expect(next.entries).toBe(a.entries);
    expect(upgradeWorkspace(next)).toBe(next);
    expect(defaultView().columns.at(-1)).toBe("flow");
    expect(
      defaultView().columns[defaultView().columns.indexOf("dailyPnl") + 1],
    ).toBe("cyclePnl");
  });
  it("走势填充剩余空间，窄窗口保持最小165，其他列宽不拉伸", () => {
    const view = {
      ...defaultView(),
      columns: ["chart", "change"],
      widths: { chart: 300, change: 90 },
    };
    expect(resolvedColumnWidths(view, 1000)).toEqual({
      chart: 700,
      change: 90,
    });
    expect(resolvedColumnWidths(view, 400)).toEqual({ chart: 165, change: 90 });
    expect(
      resolvedColumnWidths({ ...view, columns: ["change"] }, 1000),
    ).toEqual({ change: 90 });
  });
  it("盈利亏损保留完整行情骨架并追加收益贡献，普通分组采用紧凑行情列宽", () => {
    const w = upgradeWorkspace(manualAccount()).workspace!;
    expect(tableView(w, "profit")).toMatchObject({
      columns: [
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
      ],
      sort: "totalContribution",
      direction: "desc",
    });
    expect(tableView(w, "loss").direction).toBe("asc");
    expect(
      resolvedColumnWidths(tableView(w, "profit"), 1242, "contribution"),
    ).toMatchObject({
      chart: 166,
      peRatio: 72,
      pbRatio: 72,
      activity: 80,
      amplitude: 66,
      sizeVolume: 100,
      totalContribution: 116,
      contributionBreakdown: 118,
      flow: 88,
    });
    expect(
      resolvedColumnWidths(tableView(w, "all"), 1200, "market"),
    ).toMatchObject({
      volumeRatio: 74,
      turnover: 74,
      amplitude: 74,
      floatCap: 88,
      volume: 88,
      flow: 104,
    });
    w.activeView = "profit";
    expect(() =>
      validateWorkspace({ ...manualAccount(), schemaVersion: 4, workspace: w }),
    ).not.toThrow();
  });
  it("移除重复数量列并迁移旧布局，不改变其他列宽顺序或账本", () => {
    expect(defaultView().columns).not.toContain("quantity");
    expect(configurableColumnLabels).not.toHaveProperty("quantity");
    const a = upgradeWorkspace(manualAccount());
    const w = a.workspace!;
    w.groups = [{ id: "g-test", name: "测试", members: [] }];
    for (const id of ["all", "holdings", "g-test"]) {
      w.views[id] = {
        ...defaultView(),
        layoutVersion: 3,
        columns: ["dailyPnl", "quantity", "chart", "marketValue"],
        widths: { dailyPnl: 95, quantity: 110, chart: 220, marketValue: 105 },
        sort: id === "holdings" ? "quantity" : "change",
      };
    }
    const next = upgradeWorkspace(a);
    for (const v of Object.values(next.workspace!.views)) {
      expect(v.layoutVersion).toBe(8);
      if (v === next.workspace!.views.holdings) {
        expect(v.columns).toEqual(["dailyPnl", "chart", "marketValue"]);
        expect(v.widths).toEqual({ dailyPnl: 95, marketValue: 105 });
      } else {
        expect(v.columns).toEqual([
          "dailyPnl",
          "chart",
          "peRatio",
          "pbRatio",
          "marketValue",
        ]);
      }
    }
    expect(next.workspace!.views.holdings.sort).toBe("");
    expect(next.workspace!.views.all.sort).toBe("change");
    expect(next.workspace!.views["g-test"].sort).toBe("change");
    expect(next.entries).toBe(a.entries);
    expect(next.profiles).toBe(a.profiles);
    expect(next.securities).toBe(a.securities);
    expect(w.views.holdings.columns).toContain("quantity");
    expect(upgradeWorkspace(next)).toBe(next);
  });
  it("迁移以持仓布局统一所有自选分组，保留各自数据排序并且幂等", () => {
    const a = upgradeWorkspace(manualAccount());
    const w = a.workspace!;
    w.groups = [{ id: "g-test", name: "测试", members: [] }];
    w.views.all = {
      ...defaultView(),
      layoutVersion: 2,
      columns: ["chart"],
      widths: { chart: 220 },
      sort: "change",
    };
    w.views.holdings = {
      ...defaultView(),
      layoutVersion: 2,
      columns: ["dailyPnl", "chart", "marketValue"],
      widths: { dailyPnl: 80, chart: 188, marketValue: 100 },
    };
    w.views["g-test"] = {
      ...defaultView(),
      layoutVersion: 2,
      sort: "fiveDay",
      direction: "asc",
    };
    const next = upgradeWorkspace(a);
    for (const [id, v] of Object.entries(next.workspace!.views)) {
      expect(v.columns).toEqual(
        id === "holdings"
          ? w.views.holdings.columns
          : ["dailyPnl", "chart", "peRatio", "pbRatio", "marketValue"],
      );
      expect(v.widths).toEqual({ dailyPnl: 80, marketValue: 100 });
    }
    expect(next.workspace!.views.all.sort).toBe("change");
    expect(next.workspace!.views["g-test"].sort).toBe("fiveDay");
    expect(w.views.all.columns).toEqual(["chart"]);
    expect(upgradeWorkspace(next)).toBe(next);
  });
  it("持仓、行情和自定义分组使用独立字段，收益列不会泄漏到普通自选", () => {
    const w = upgradeWorkspace(manualAccount()).workspace!;
    w.groups = [{ id: "g-test", name: "测试", members: [] }];
    w.views.holdings.sort = "latest";
    setTableView(w, "all", {
      ...defaultView("all"),
      columns: ["change", "chart"],
      widths: { change: 95, chart: 210 },
      sort: "change",
    });
    expect(tableView(w, "holdings")).toMatchObject({
      columns: defaultView("holdings").columns,
      sort: "latest",
    });
    expect(tableView(w, "g-test")).toMatchObject({
      columns: defaultView("g-test").columns,
      sort: "",
    });
    setTableView(w, "g-test", {
      ...tableView(w, "g-test"),
      columns: ["chart", "fiveDay"],
      sort: "fiveDay",
    });
    expect(w.views.all.columns).toEqual(["change", "chart"]);
    expect(w.views["g-test"].columns).toEqual(["chart", "fiveDay"]);
    expect(w.views.all.sort).toBe("change");
    expect(w.views.holdings.sort).toBe("latest");
    expect(w.views.all.columns).not.toBe(w.views.holdings.columns);
    expect(tableView(w, "all").columns).not.toContain("dailyPnl");
    expect(tableView(w, "g-test").columns).not.toContain("cyclePnl");
  });
  it("旧列宽一次性迁移到紧凑布局，不修改账本，后续手动宽度保留", () => {
    const a = upgradeWorkspace(manualAccount());
    delete a.workspace!.views.holdings.layoutVersion;
    a.workspace!.views.holdings.widths = { change: 190, chart: 200 };
    const next = upgradeWorkspace(a);
    expect(next.workspace!.views.all.widths.change).toBe(90);
    expect(next.workspace!.views.all.widths.chart).toBeUndefined();
    expect(a.workspace!.views.holdings.widths.change).toBe(190);
    expect(next.entries).toEqual(a.entries);
    next.workspace!.views.all.widths.change = 150;
    expect(upgradeWorkspace(next).workspace!.views.all.widths.change).toBe(150);
  });
  it("桌面自定义列宽成为默认，合并成本列且不覆盖用户排序和非默认宽度", () => {
    expect(
      [
        "chart",
        "change",
        "fiveDay",
        "volumeRatio",
        "turnover",
        "amplitude",
        "flow",
        "floatCap",
        "volume",
        "quantity",
        "marketValue",
        "dailyPnl",
        "cyclePnl",
      ].map(defaultColumnWidth),
    ).toEqual([165, 90, 90, 80, 80, 80, 95, 80, 80, 80, 96, 85, 93]);
    const a = upgradeWorkspace(manualAccount());
    a.workspace!.views.holdings = {
      layoutVersion: 1,
      columns: ["dailyPnl", "chart", "dilutedCost", "marketValue", "change"],
      widths: { dailyPnl: 80, chart: 210, marketValue: 100, change: 100 },
      sort: "dilutedCost",
      direction: "asc",
    };
    const next = upgradeWorkspace(a).workspace!.views.holdings;
    expect(next.columns).toEqual([
      "dailyPnl",
      "chart",
      "marketValue",
      "change",
    ]);
    expect(next.widths).toEqual({
      dailyPnl: 80,
      marketValue: 100,
      change: 90,
    });
    expect(next.sort).toBe("dilutedCost");
    expect(a.workspace!.views.holdings.columns).toContain("dilutedCost");
  });
  it("迁移保留账本、证券和独立费率，并建立默认视图", () => {
    const old = manualAccount();
    const next = upgradeWorkspace(old);
    expect(old.schemaVersion).toBe(3);
    expect(next.schemaVersion).toBe(4);
    expect(next.entries).toEqual(old.entries);
    expect(next.profiles).toEqual(old.profiles);
    expect(next.workspace!.watchlist).toEqual(old.securities.map((s) => s.id));
    expect(next.workspace!.views).toEqual({
      all: defaultView("all"),
      holdings: defaultView("holdings"),
    });
    expect(next.workspace!.chartMode).toBe("intraday");
    expect(upgradeWorkspace(next)).toBe(next);
  });

  it("同一证券可加入多个分组，移出自选不会删除证券", () => {
    const a = upgradeWorkspace(manualAccount());
    const id = a.securities[0].id;
    a.workspace!.groups = [
      { id: "g-first", name: "做T关注", members: [id] },
      { id: "g-second", name: "长期关注", members: [id] },
    ];
    expect(() => validateWorkspace(a)).not.toThrow();
    removeWatchlist(a.workspace!, [id]);
    expect(a.workspace!.watchlist).not.toContain(id);
    expect(a.workspace!.groups.every((g) => g.members.length === 0)).toBe(true);
    expect(a.securities.some((s) => s.id === id)).toBe(true);
    expect(() => validateWorkspace(a)).not.toThrow();
  });

  it.each(["duplicate", "missing", "width", "column", "active"])(
    "拒绝损坏配置：%s",
    (kind) => {
      const a = upgradeWorkspace(manualAccount());
      const w = a.workspace!;
      if (kind === "duplicate")
        w.groups = [
          {
            id: "g-test",
            name: "组",
            members: [w.watchlist[0], w.watchlist[0]],
          },
        ];
      if (kind === "missing")
        w.groups = [{ id: "g-test", name: "组", members: ["sh999999"] }];
      if (kind === "width") w.views.all.widths.chart = 401;
      if (kind === "column") w.views.all.columns.push("unknown");
      if (kind === "active") w.activeView = "g-missing";
      expect(() => validateWorkspace(a)).toThrow();
    },
  );
});

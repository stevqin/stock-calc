import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import TradingDesk from "./TradingDesk.vue";
import SecuritiesTable from "./components/SecuritiesTable.vue";
import SecuritySearch from "./components/SecuritySearch.vue";
import LedgerWorkbench from "./LedgerWorkbench.vue";
import { manualAccount } from "./sim/record";
import { upgradeWorkspace } from "./sim/workspaceState";
import { loadAccount, saveAccount } from "./sim/repository";
import { readDraft, writeDraft } from "./sim/drafts";
import type { Account } from "./sim/model";
import { marketQuotes, marketCharts } from "./market";

vi.mock("./sim/repository", () => ({
  loadAccount: vi.fn(),
  saveAccount: vi.fn(),
  exportAccount: vi.fn(),
}));
vi.mock("./sim/drafts", () => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  flushDrafts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("./market", async () => ({
  marketQuotes: (await import("vue")).reactive({}),
  marketCharts: {},
  marketErrors: {},
  marketStatus: { text: "离线测试" },
  fundFlowStatus: { text: "资金流离线测试" },
  hydrateMarket: vi.fn(),
  getChart: vi.fn().mockResolvedValue(undefined),
  chartKey: (id: string, mode: string) => `${id}:${mode}`,
  clearMarket: vi.fn(),
  makeMarketPoller: () => ({ setTargets() {}, stop() {}, refresh() {} }),
  makeFundFlowPoller: () => ({ setTargets() {}, stop() {}, refresh() {} }),
}));
let wrapper: ReturnType<typeof mount>;
let stored: Account;
let revision: number;
const button = (name: string) =>
  wrapper.findAll("button").find((b) => b.text() === name)!;
async function start() {
  wrapper = mount(TradingDesk, {
    attachTo: document.body,
    global: { stubs: { SecuritiesTable: true, MarketChart: true } },
  });
  await flushPromises();
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const id of Object.keys(marketQuotes)) delete marketQuotes[id];
  for (const id of Object.keys(marketCharts)) delete marketCharts[id];
  stored = upgradeWorkspace(manualAccount());
  revision = 1;
  vi.mocked(loadAccount).mockImplementation(async () => ({
    account: JSON.parse(JSON.stringify(stored)),
    revision,
  }));
  vi.mocked(saveAccount).mockImplementation(async (account, expected) => {
    if (expected !== revision) throw new Error("修订冲突");
    stored = JSON.parse(JSON.stringify(account));
    return ++revision;
  });
  vi.mocked(readDraft).mockResolvedValue(undefined);
  vi.mocked(writeDraft).mockResolvedValue(undefined);
});
afterEach(() => wrapper?.unmount());
describe("重构工作台集成", () => {
  it("双击详情新增交易记录页，只显示该证券期初记录，切换测算后可返回", async () => {
    for (const [id, quantity] of [
      ["sh510300", "100"],
      ["sz159915", "200"],
    ]) {
      stored.entries.push({
        id: `opening-${id}`,
        securityId: id,
        kind: "opening",
        quantity,
        available: quantity,
        price: "10",
        time: "2026-08-27T01:00:00.000Z",
        date: "2026-08-27",
      });
    }
    await start();
    wrapper.findComponent(SecuritiesTable).vm.$emit("detail", "sh510300");
    await flushPromises();
    await button("交易记录").trigger("click");
    await flushPromises();
    const panel = () => wrapper.find(".security-drawer");
    expect(
      panel().findComponent(LedgerWorkbench).props("historySecurityId"),
    ).toBe("sh510300");
    expect(panel().findAll(".ledger-history-table tbody tr")).toHaveLength(1);
    expect(panel().find(".ledger-history-table tbody").text()).toContain(
      "建仓",
    );
    await button("做T测算").trigger("click");
    await flushPromises();
    expect(panel().find(".planner").exists()).toBe(true);
    await button("交易记录").trigger("click");
    await flushPromises();
    expect(panel().findAll(".ledger-history-table tbody tr")).toHaveLength(1);
    await wrapper.find('[aria-label="关闭证券详情"]').trigger("click");
    wrapper.findComponent(SecuritiesTable).vm.$emit("detail", "sh600519");
    await flushPromises();
    await button("交易记录").trigger("click");
    await flushPromises();
    expect(panel().text()).toContain("该证券暂无交易记录");
  });
  it("顶部金额下方显示加权汇总收益率，缺报价时比例回退为空值", async () => {
    const items = [
      {
        id: "sh510300",
        market: "sh" as const,
        code: "510300",
        cost: "8",
        previous: "10",
        latest: "11",
      },
      {
        id: "sz159915",
        market: "sz" as const,
        code: "159915",
        cost: "30",
        previous: "30",
        latest: "32",
      },
    ];
    for (const item of items) {
      stored.entries.push({
        id: item.id,
        securityId: item.id,
        kind: "opening",
        quantity: "100",
        available: "100",
        price: item.cost,
        time: "2026-08-27T01:00:00.000Z",
        date: "2026-08-27",
      });
      marketQuotes[item.id] = {
        market: item.market,
        code: item.code,
        name: "测试ETF",
        latest: item.latest,
        bid: item.latest,
        ask: item.latest,
        quoteTime: "20260828150000",
        fetchedAt: "2026-08-28T07:00:00Z",
        kind: "etf",
      };
      marketCharts[`${item.id}:daily-raw`] = {
        symbol: item.id,
        mode: "daily-raw",
        adjustment: "不复权",
        fetchedAt: "2026-08-28T07:00:00Z",
        sessions: [],
        bars: [
          {
            date: "2026-08-27",
            open: item.previous,
            close: item.previous,
            high: item.previous,
            low: item.previous,
            volume: "1000",
          },
        ],
      };
    }
    await start();
    const daily = () => wrapper.find('[aria-label="今日收益率"]');
    const cycle = () => wrapper.find('[aria-label="当前持仓轮次收益率"]');
    expect(daily().text()).toBe("+7.50%");
    expect(
      daily().element.parentElement?.classList.contains("summary-values"),
    ).toBe(true);
    expect(
      cycle().element.parentElement?.classList.contains("summary-values"),
    ).toBe(true);
    expect(cycle().text()).toBe("+13.16%");
    expect(daily().classes()).toContain("gain");
    expect(daily().element.previousElementSibling?.textContent).toBe("300.00");
    expect(cycle().element.previousElementSibling?.textContent).toBe("500.00");
    expect(cycle().attributes("title")).toContain("净投入≤0");
    delete marketQuotes.sz159915;
    await flushPromises();
    expect(daily().text()).toBe("—");
    expect(cycle().text()).toBe("—");
    expect(daily().classes()).toContain("flat");
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("空账户顶部收益率显示—而不是0%", async () => {
    await start();
    expect(wrapper.find('[aria-label="今日收益率"]').text()).toBe("—");
    expect(wrapper.find('[aria-label="当前持仓轮次收益率"]').text()).toBe("—");
  });
  it("顶部六项账户指标均以遮罩构成卡片展示真实明细", async () => {
    await start();
    const labels = [
      "账面总资产",
      "账面资金",
      "持仓市值",
      "今日收益",
      "当前持仓轮次收益",
      "利息等收入",
    ];
    expect(wrapper.findAll(".summary-help-trigger")).toHaveLength(
      labels.length,
    );
    for (const label of labels)
      expect(wrapper.find(`[aria-label="查看${label}说明"]`).exists()).toBe(
        true,
      );
    const cash = wrapper.find('[aria-label="查看账面资金说明"]');
    expect(cash.attributes("aria-expanded")).toBe("false");
    await cash.trigger("click");
    expect(cash.attributes("aria-expanded")).toBe("true");
    const panel = document.querySelector(".summary-help-panel")!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.textContent).toContain("账面资金构成");
    expect(panel.textContent).toContain("卖出净收入");
    expect(panel.textContent).toContain("买入总支出");
    expect(panel.textContent).toContain("账面资金0.00");
    expect(panel.textContent).toContain("不等于券商显示的可用或可转资金");
    expect(document.querySelector(".summary-help-overlay")).not.toBeNull();
    (
      document.querySelector('[aria-label="关闭指标说明"]') as HTMLElement
    ).click();
    await flushPromises();
    expect(document.querySelector(".summary-help-panel")).toBeNull();
  });
  it("添加只保留搜索，改词或重开清除旧选择，不能添加未选中的证券", async () => {
    await start();
    await button("＋ 添加自选").trigger("click");
    expect(wrapper.find(".desk-dialog form").findAll("input")).toHaveLength(1);
    expect(wrapper.find(".desk-dialog form").findAll("select")).toHaveLength(0);
    expect(button("添加到自选").attributes("disabled")).toBeDefined();
    await wrapper.find(".desk-dialog form").trigger("submit");
    expect(saveAccount).not.toHaveBeenCalled();
    const search = wrapper.findComponent(SecuritySearch);
    search.vm.$emit("select", {
      market: "sh",
      code: "600519",
      name: "贵州茅台",
      asset: "stock",
    });
    await flushPromises();
    expect(button("添加到自选").attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".desk-dialog form").findAll("select")).toHaveLength(0);
    search.vm.$emit("clear");
    await flushPromises();
    expect(wrapper.find(".selected-security").exists()).toBe(false);
    expect(button("添加到自选").attributes("disabled")).toBeDefined();
    search.vm.$emit("select", {
      market: "sh",
      code: "600519",
      name: "贵州茅台",
      asset: "stock",
    });
    await flushPromises();
    await wrapper.find('[aria-label="关闭对话框"]').trigger("click");
    await button("＋ 添加自选").trigger("click");
    expect(wrapper.find(".selected-security").exists()).toBe(false);
    expect(button("添加到自选").attributes("disabled")).toBeDefined();
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("历史负资金仅弹出可关闭轻提示，关闭后切页不重复提醒也不修改流水", async () => {
    stored.cashEntries!.push({
      id: "negative-cash",
      kind: "withdraw",
      amount: "100",
      time: "2026-08-25T01:00:00.000Z",
      date: "2026-08-25",
      note: "",
    });
    await start();
    expect(wrapper.find(".desk-warning").exists()).toBe(false);
    expect(
      document.querySelector(".floating-notice.warning")?.textContent,
    ).toContain("存在历史负资金余额");
    (
      document.querySelector(
        ".floating-notice.warning button",
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    await button("资金流水").trigger("click");
    await flushPromises();
    await button("自选与持仓").trigger("click");
    await flushPromises();
    expect(document.querySelector(".floating-notice.warning")).toBeNull();
    expect(saveAccount).not.toHaveBeenCalled();
    expect(stored.cashEntries![0].amount).toBe("100");
  });
  it("普通自选只配置行情字段，持仓视图才提供收益字段", async () => {
    await start();
    await button("设置列").trigger("click");
    expect(wrapper.find('[aria-label="走势列宽"]').exists()).toBe(false);
    expect(wrapper.find(".auto-column-width").text()).toBe("自动");
    expect(wrapper.find(".column-order input").exists()).toBe(false);
    expect(wrapper.find('[aria-label="主力净流入列宽"]').text()).toBe("104px");
    expect(wrapper.find('[aria-label="持仓市值列宽"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="本轮持仓盈亏列宽"]').exists()).toBe(
      false,
    );
    await wrapper.find('[aria-label="关闭对话框"]').trigger("click");
    await button("我的持仓 0").trigger("click");
    vi.mocked(saveAccount).mockClear();
    await button("设置列").trigger("click");
    expect(wrapper.find('[aria-label="主力净流入列宽"]').text()).toBe("95px");
    expect(wrapper.find('[aria-label="持仓市值列宽"]').text()).toBe("96px");
    expect(wrapper.find('[aria-label="本轮持仓盈亏列宽"]').text()).toBe("93px");
    expect(wrapper.find('[aria-label="拖动排序：走势"]').exists()).toBe(true);
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("盈利亏损自动组按累计贡献归类，并展示历史与当前持仓贡献字段", async () => {
    for (const [id, price] of [
      ["sh510300", "10"],
      ["sz159915", "30"],
    ]) {
      stored.entries.push({
        id: "opening-" + id,
        securityId: id,
        kind: "opening",
        quantity: "100",
        available: "100",
        price,
        time: "2026-08-27T01:00:00.000Z",
        date: "2026-08-27",
      });
    }
    for (const [id, latest] of [
      ["sh510300", "11"],
      ["sz159915", "29"],
    ]) {
      const security = stored.securities.find((item) => item.id === id)!;
      marketQuotes[id] = {
        market: security.market,
        code: security.code,
        name: security.name,
        latest,
        previousClose: latest,
        change: "0",
        floatCap: null,
        volume: "0",
        bid: null,
        ask: null,
        kind: security.asset,
        quoteTime: "20260831140000",
        fetchedAt: "2026-08-31T06:00:00Z",
      };
    }
    await start();
    expect(button("盈利 1")).toBeTruthy();
    expect(button("亏损 1")).toBeTruthy();
    await button("盈利 1").trigger("click");
    await flushPromises();
    let table = wrapper.findComponent(SecuritiesTable);
    expect(table.props("variant")).toBe("contribution");
    expect(
      (table.props("rows") as Account["securities"]).map((item) => item.id),
    ).toEqual(["sh510300"]);
    expect((table.props("view") as { columns: string[] }).columns).toEqual([
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
    ]);
    expect(
      (
        table.props("contributions") as Record<
          string,
          { total: string; realized: string; holding: string; share: string }
        >
      ).sh510300,
    ).toMatchObject({
      total: "100.00",
      realized: "0.00",
      holding: "100.00",
      share: "100.00",
    });
    expect(button("设置列")).toBeUndefined();
    await button("亏损 1").trigger("click");
    await flushPromises();
    table = wrapper.findComponent(SecuritiesTable);
    expect(
      (table.props("rows") as Account["securities"]).map((item) => item.id),
    ).toEqual(["sz159915"]);
  });
  it("搜索选中填入证券，ETF默认未确认，只有确认添加才保存", async () => {
    await start();
    await button("＋ 添加自选").trigger("click");
    const search = wrapper.findComponent(SecuritySearch);
    search.vm.$emit("select", {
      market: "sz",
      code: "159941",
      name: "纳指ETF",
      asset: "etf",
    });
    await flushPromises();
    const form = wrapper.find(".desk-dialog form");
    expect(form.find('input[inputmode="numeric"]').exists()).toBe(false);
    expect(form.find(".selected-security").text()).toContain("SZ 159941");
    expect(form.find(".selected-security").text()).toContain("纳指ETF");
    expect(
      form.findAll("select").map((s) => (s.element as HTMLSelectElement).value),
    ).toEqual(["unconfirmed", "unconfirmed"]);
    expect(saveAccount).not.toHaveBeenCalled();
    await form.trigger("submit");
    await flushPromises();
    expect(stored.securities.find((s) => s.id === "sz159941")).toMatchObject({
      name: "纳指ETF",
      category: "unconfirmed",
      settlement: "unconfirmed",
    });
  });
  it("搜索已有证券保留确认类别及原名称，不改历史记录", async () => {
    const existing = stored.securities[0];
    const before = JSON.parse(JSON.stringify(existing));
    await start();
    await button("＋ 添加自选").trigger("click");
    wrapper
      .findComponent(SecuritySearch)
      .vm.$emit("select", { ...existing, name: "远端新名称" });
    await flushPromises();
    const form = wrapper.find(".desk-dialog form");
    expect(form.find('input[maxlength="60"]').exists()).toBe(false);
    expect(form.find(".selected-security").text()).toContain(before.name);
    await form.trigger("submit");
    await flushPromises();
    expect(stored.securities.find((s) => s.id === existing.id)).toEqual(before);
    expect(stored.securities.filter((s) => s.id === existing.id)).toHaveLength(
      1,
    );
    expect(stored.entries).toEqual([]);
  });
  it("嵌入资金表单只暴露一个模态层级，保留可访问字段标签", async () => {
    await start();
    await button("资金流水").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".cash-summary button")).toHaveLength(0);
    await button("＋ 资金流水").trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    const modal = wrapper.find(".entry-dialog .modal");
    expect(modal.findAll("label")).toHaveLength(4);
    expect(modal.find('input[type="datetime-local"]').exists()).toBe(true);
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("分组上下移动按钮有明确名称，表单采用统一分组布局", async () => {
    stored.workspace!.groups.push({
      id: "g-test-group",
      name: "关注",
      members: [],
    });
    await start();
    await button("管理分组").trigger("click");
    expect(wrapper.find('[aria-label="上移分组关注"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="下移分组关注"]').exists()).toBe(true);
    expect(wrapper.find(".group-form label input").exists()).toBe(true);
  });
  it("右键全选仅包含当前筛选结果", async () => {
    await start();
    await wrapper.find('[aria-label="品种筛选"]').setValue("etf");
    const table = wrapper.findComponent(SecuritiesTable);
    table.vm.$emit("context", { id: stored.securities[0].id, x: 20, y: 200 });
    await flushPromises();
    await button("全选当前列表").trigger("click");
    expect(table.props("checked")).toEqual(
      stored.securities.filter((s) => s.asset === "etf").map((s) => s.id),
    );
  });
  it("右键未选行只操作该证券，取消移出不改自选，确认保留账本", async () => {
    stored.entries.push({
      id: "opening-menu-test",
      securityId: stored.securities[1].id,
      kind: "opening",
      quantity: "100",
      available: "100",
      price: "10",
      time: "2026-08-27T01:00:00.000Z",
      date: "2026-08-27",
    });
    const originalEntries = JSON.parse(JSON.stringify(stored.entries));
    await start();
    const table = wrapper.findComponent(SecuritiesTable);
    const id = stored.securities[1].id;
    table.vm.$emit("check", [stored.securities[0].id]);
    table.vm.$emit("context", { id, x: 800, y: 600 });
    await flushPromises();
    expect(wrapper.find('[role="menu"]').text()).toContain(
      stored.securities[1].name,
    );
    expect(wrapper.find(".batch-bar").exists()).toBe(false);
    await button("移出全部自选…").trigger("click");
    await button("取消").trigger("click");
    expect(stored.workspace!.watchlist).toContain(id);
    table.vm.$emit("context", { id, x: 800, y: 600 });
    await flushPromises();
    await button("移出全部自选…").trigger("click");
    await button("确认移出").trigger("click");
    await flushPromises();
    expect(stored.workspace!.watchlist).not.toContain(id);
    expect(stored.workspace!.watchlist).toContain(stored.securities[0].id);
    expect(stored.securities.some((s) => s.id === id)).toBe(true);
    expect(stored.entries).toEqual(originalEntries);
  });
  it("持仓页禁止手动排序，移出失败保留选择、确认框和持仓", async () => {
    const id = stored.securities[0].id;
    stored.entries.push({
      id: "opening-menu-test",
      securityId: id,
      kind: "opening",
      quantity: "100",
      available: "100",
      price: "10",
      time: "2026-08-27T01:00:00.000Z",
      date: "2026-08-27",
    });
    stored.workspace!.activeView = "holdings";
    await start();
    wrapper
      .findComponent(SecuritiesTable)
      .vm.$emit("context", { id, x: 20, y: 200 });
    await flushPromises();
    expect(button("上移").attributes("disabled")).toBeDefined();
    expect(button("下移").attributes("disabled")).toBeDefined();
    await button("移出全部自选…").trigger("click");
    vi.mocked(saveAccount).mockRejectedValueOnce(new Error("磁盘不可用"));
    await button("确认移出").trigger("click");
    await flushPromises();
    expect(wrapper.find(".desk-dialog h2").text()).toContain("1只");
    expect(stored.workspace!.watchlist).toContain(id);
    expect(stored.entries[0].quantity).toBe("100");
  });
  it("右键做T测算直接打开对应证券测算页，多选时禁用", async () => {
    await start();
    const ids = stored.securities.slice(0, 2).map((s) => s.id);
    const table = wrapper.findComponent(SecuritiesTable);
    table.vm.$emit("check", ids);
    table.vm.$emit("context", { id: ids[0], x: 20, y: 200 });
    await flushPromises();
    expect(button("做T测算").attributes("disabled")).toBeDefined();
    table.vm.$emit("check", [ids[1]]);
    table.vm.$emit("context", { id: ids[1], x: 20, y: 200 });
    await flushPromises();
    await button("做T测算").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    const planner = wrapper
      .find(".security-drawer")
      .findComponent(LedgerWorkbench);
    expect(planner.props("initialTab")).toBe("planner");
    expect(planner.props("symbol")).toBe(ids[1]);
    expect(planner.find(".planner").exists()).toBe(true);
    expect(stored.entries).toEqual([]);
  });
  it("单只保存勾选结果可增减分组、全部取消，保留其他证券和全部自选", async () => {
    const ids = stored.securities.slice(0, 2).map((s) => s.id);
    stored.workspace!.groups = [
      { id: "g-old", name: "原有", members: [...ids] },
      { id: "g-keep", name: "保留", members: [...ids] },
      { id: "g-new", name: "新增", members: [ids[1]] },
    ];
    const originalWatchlist = [...stored.workspace!.watchlist];
    const originalEntries = JSON.stringify(stored.entries);
    await start();
    const open = async () => {
      wrapper
        .findComponent(SecuritiesTable)
        .vm.$emit("context", { id: ids[0], x: 20, y: 200 });
      await flushPromises();
      await button("加入分组…").trigger("click");
    };
    await open();
    expect(button("保存分组").attributes("disabled")).toBeDefined();
    await wrapper.find('input[aria-label="原有"]').setValue(false);
    await wrapper.find('input[aria-label="新增"]').setValue(true);
    await wrapper.find(".desk-dialog form").trigger("submit");
    await flushPromises();
    expect(stored.workspace!.groups.map((g) => g.members)).toEqual([
      [ids[1]],
      ids,
      [ids[1], ids[0]],
    ]);
    await open();
    await wrapper.find('input[aria-label="保留"]').setValue(false);
    await wrapper.find('input[aria-label="新增"]').setValue(false);
    expect(button("保存分组").attributes("disabled")).toBeUndefined();
    await wrapper.find(".desk-dialog form").trigger("submit");
    await flushPromises();
    expect(stored.workspace!.groups.map((g) => g.members)).toEqual([
      [ids[1]],
      [ids[1]],
      [ids[1]],
    ]);
    expect(stored.workspace!.watchlist).toEqual(originalWatchlist);
    expect(JSON.stringify(stored.entries)).toBe(originalEntries);
  });
  it("右键已选行保留多选，加入分组支持批量且不重复", async () => {
    stored.workspace!.groups = [
      { id: "g-test", name: "关注", members: [stored.securities[0].id] },
      { id: "g-other", name: "长期", members: [] },
      { id: "g-keep", name: "原有", members: [stored.securities[0].id] },
    ];
    await start();
    const table = wrapper.findComponent(SecuritiesTable);
    const ids = stored.securities.slice(0, 2).map((s) => s.id);
    table.vm.$emit("check", ids);
    table.vm.$emit("context", { id: ids[0], x: 20, y: 200 });
    await flushPromises();
    expect(wrapper.find('[role="menu"]').text()).toContain("已选 2 只证券");
    expect(button("查看详情").attributes("disabled")).toBeDefined();
    await button("加入分组…").trigger("click");
    expect(button("加入分组").attributes("disabled")).toBeDefined();
    await wrapper.find('input[aria-label="关注"]').setValue(true);
    await wrapper.find('input[aria-label="长期"]').setValue(true);
    expect(wrapper.find(".group-picker legend").text()).toContain("已选 2 个");
    await wrapper.find(".desk-dialog form").trigger("submit");
    await flushPromises();
    expect(stored.workspace!.groups[0].members).toEqual(ids);
    expect(stored.workspace!.groups[1].members).toEqual(ids);
    expect(stored.workspace!.groups[2].members).toEqual([ids[0]]);
    expect(stored.workspace!.watchlist).toEqual(
      stored.securities.map((s) => s.id),
    );
  });
  it("单只默认勾选已有分组，多只即使有共同分组也不预选，重开不沿用草稿", async () => {
    const ids = stored.securities.slice(0, 2).map((s) => s.id);
    stored.workspace!.groups = [
      { id: "g-common", name: "共同", members: ids },
      { id: "g-first", name: "单独", members: [ids[0]] },
      { id: "g-empty", name: "未加入", members: [] },
    ];
    await start();
    const open = async (selected: string[]) => {
      const table = wrapper.findComponent(SecuritiesTable);
      table.vm.$emit("check", selected);
      table.vm.$emit("context", { id: selected[0], x: 20, y: 200 });
      await flushPromises();
      await button("加入分组…").trigger("click");
    };
    const checkedGroups = () =>
      wrapper
        .findAll('.group-picker input[type="checkbox"]')
        .filter((input) => (input.element as HTMLInputElement).checked)
        .map((input) => input.attributes("value"));
    await open([ids[0]]);
    expect(checkedGroups()).toEqual(["g-common", "g-first"]);
    await wrapper.find('input[aria-label="共同"]').setValue(false);
    await wrapper.find('input[aria-label="未加入"]').setValue(true);
    await button("取消").trigger("click");
    await open([ids[0]]);
    expect(checkedGroups()).toEqual(["g-common", "g-first"]);
    await button("取消").trigger("click");
    await open(ids);
    expect(checkedGroups()).toEqual([]);
    expect(button("加入分组").attributes("disabled")).toBeDefined();
    await button("取消").trigger("click");
    await open([ids[1]]);
    expect(checkedGroups()).toEqual(["g-common"]);
    // Switching the active security persists UI state, not group membership.
    expect(stored.workspace!.groups.map((g) => g.members)).toEqual([
      ids,
      [ids[0]],
      [],
    ]);
  });
  it("分组多选可取消，重新打开清空选择，全部取消后不提交", async () => {
    stored.workspace!.groups = [{ id: "g-test", name: "关注", members: [] }];
    await start();
    const open = async () => {
      wrapper
        .findComponent(SecuritiesTable)
        .vm.$emit("context", { id: stored.securities[0].id, x: 20, y: 200 });
      await flushPromises();
      await button("加入分组…").trigger("click");
    };
    await open();
    await wrapper.find('input[aria-label="关注"]').setValue(true);
    await button("取消").trigger("click");
    expect(saveAccount).not.toHaveBeenCalled();
    await open();
    expect(
      (wrapper.find('input[aria-label="关注"]').element as HTMLInputElement)
        .checked,
    ).toBe(false);
    await wrapper.find('input[aria-label="关注"]').setValue(true);
    await wrapper.find('input[aria-label="关注"]').setValue(false);
    await wrapper.find(".desk-dialog form").trigger("submit");
    expect(saveAccount).not.toHaveBeenCalled();
    expect(button("保存分组").attributes("disabled")).toBeDefined();
  });
  it("分组多选保存失败保留勾选且原分组不改变", async () => {
    stored.workspace!.groups = [{ id: "g-test", name: "关注", members: [] }];
    await start();
    wrapper
      .findComponent(SecuritiesTable)
      .vm.$emit("context", { id: stored.securities[0].id, x: 20, y: 200 });
    await flushPromises();
    await button("加入分组…").trigger("click");
    await wrapper.find('input[aria-label="关注"]').setValue(true);
    vi.mocked(saveAccount).mockRejectedValueOnce(new Error("磁盘不可用"));
    await wrapper.find(".desk-dialog form").trigger("submit");
    await flushPromises();
    expect(stored.workspace!.groups[0].members).toEqual([]);
    expect(
      (wrapper.find('input[aria-label="关注"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
  it("分组右键移出只影响该分组，重排保留其他分组顺序", async () => {
    const ids = stored.securities.map((s) => s.id);
    stored.workspace!.groups = [
      { id: "g-test", name: "关注", members: [...ids] },
      { id: "g-other", name: "长期", members: [...ids] },
    ];
    stored.workspace!.activeView = "g-test";
    await start();
    const table = wrapper.findComponent(SecuritiesTable);
    table.vm.$emit("context", { id: ids[1], x: 20, y: 200 });
    await flushPromises();
    await button("上移").trigger("click");
    await flushPromises();
    expect(stored.workspace!.groups[0].members[0]).toBe(ids[1]);
    expect(stored.workspace!.groups[1].members).toEqual(ids);
    table.vm.$emit("context", { id: ids[1], x: 20, y: 200 });
    await flushPromises();
    await button("移出当前分组…").trigger("click");
    await button("确认移出").trigger("click");
    await flushPromises();
    expect(stored.workspace!.groups[0].members).not.toContain(ids[1]);
    expect(stored.workspace!.groups[1].members).toEqual(ids);
    expect(stored.workspace!.watchlist).toEqual(ids);
  });
  it("右键交易打开该证券双向表单，筛选关闭菜单并清除隐藏选择", async () => {
    await start();
    const table = wrapper.findComponent(SecuritiesTable),
      id = stored.securities[1].id;
    table.vm.$emit("context", { id, x: 20, y: 200 });
    await flushPromises();
    await wrapper
      .find('[aria-label="搜索自选"]')
      .setValue(stored.securities[0].name);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(table.props("checked")).toEqual([]);
    await wrapper.find('[aria-label="搜索自选"]').setValue("");
    table.vm.$emit("context", { id, x: 20, y: 200 });
    await flushPromises();
    const sell = wrapper
      .findAll('[role="menuitem"]')
      .find((b) => b.text() === "交易")!;
    await sell.trigger("click");
    await flushPromises();
    expect(wrapper.find(".entry-security").text()).toContain(
      stored.securities[1].name,
    );
    expect(wrapper.find(".entry-dialog h2").text()).toContain("录入成交");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("成交价");
    expect(wrapper.findAll(".submit-order").map((b) => b.text())).toEqual([
      "买入",
      "卖出",
    ]);
  });
  it("详情以模态抽屉覆盖表格，Esc、遮罩及关闭按钮可收起", async () => {
    await start();
    const table = wrapper.findComponent(SecuritiesTable);
    const open = async () => {
      table.vm.$emit("detail", stored.securities[0].id);
      await flushPromises();
    };
    button("交易").element.focus();
    await open();
    expect(wrapper.find(".security-drawer").attributes("aria-modal")).toBe(
      "true",
    );
    expect(wrapper.find(".security-drawer h2").text()).toBe(
      stored.securities[0].name,
    );
    expect(wrapper.find(".desk-market-body").classes()).not.toContain(
      "with-drawer",
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "关闭证券详情",
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrapper.find(".security-drawer").exists()).toBe(false);
    expect(document.activeElement).toBe(button("交易").element);
    await open();
    await wrapper.find(".security-drawer-overlay").trigger("click");
    expect(wrapper.find(".security-drawer").exists()).toBe(false);
    await open();
    await wrapper.find('[aria-label="关闭证券详情"]').trigger("click");
    expect(wrapper.find(".security-drawer").exists()).toBe(false);
  });
  it("从详情打开成交弹窗时Esc只关闭顶层，保留原证券与抽屉", async () => {
    await start();
    wrapper
      .findComponent(SecuritiesTable)
      .vm.$emit("detail", stored.securities[0].id);
    await flushPromises();
    button("交易").element.focus();
    await button("交易").trigger("click");
    await flushPromises();
    expect(wrapper.find(".entry-dialog").exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrapper.find(".entry-dialog").exists()).toBe(false);
    expect(document.activeElement).toBe(button("交易").element);
    expect(wrapper.find(".security-drawer h2").text()).toBe(
      stored.securities[0].name,
    );
  });
  it("拖动字段只更改草稿，保存后保留顺序，支持键盘移动", async () => {
    await start();
    await button("设置列").trigger("click");
    const row = wrapper.find('[data-column-order="fiveDay"]');
    const old = document.elementFromPoint;
    document.elementFromPoint = () => row.element;
    try {
      await wrapper
        .find('[aria-label="拖动排序：走势"]')
        .trigger("pointerdown", { button: 0 });
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 10, clientY: 100 }),
      );
      window.dispatchEvent(new Event("pointerup"));
      await flushPromises();
      expect(
        wrapper
          .findAll("[data-column-order]")
          .slice(0, 5)
          .map((r) => r.attributes("data-column-order")),
      ).toEqual(["change", "fiveDay", "chart", "peRatio", "pbRatio"]);
      expect(saveAccount).not.toHaveBeenCalled();
      await wrapper
        .find('[aria-label="拖动排序：走势"]')
        .trigger("keydown", { key: "ArrowUp" });
      await button("保存列设置").trigger("click");
      await flushPromises();
      expect(stored.workspace!.views.all.columns.slice(0, 5)).toEqual([
        "change",
        "chart",
        "fiveDay",
        "peRatio",
        "pbRatio",
      ]);
    } finally {
      document.elementFromPoint = old;
    }
  });
  it("分组保存后显示轻提示，并在重新挂载后恢复", async () => {
    await start();
    await button("管理分组").trigger("click");
    await wrapper
      .find('input[placeholder="例如：做T关注"]')
      .setValue("做T关注");
    await wrapper.find(".group-list + form").trigger("submit");
    await flushPromises();
    expect(
      document.querySelector(".floating-notice.info .notice-message")
        ?.textContent,
    ).toBe("分组已创建");
    expect(stored.workspace!.groups[0].name).toBe("做T关注");
    wrapper.unmount();
    await start();
    expect(wrapper.find(".view-tabs").text()).toContain("做T关注");
  });
  it("弹窗新增资金后，同页历史列表刷新且能接着修改", async () => {
    await start();
    await button("资金流水").trigger("click");
    await flushPromises();
    await button("＋ 资金流水").trigger("click");
    await flushPromises();
    await wrapper
      .find('.entry-dialog .modal input[inputmode="decimal"]')
      .setValue("123");
    await wrapper.find(".entry-dialog .modal form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".entry-dialog").exists()).toBe(false);
    expect(wrapper.find(".desk-page").text()).toContain("123.00");
    await button("修改").trigger("click");
    await wrapper.findAll(".history-editor input")[1].setValue("124");
    await wrapper.find(".history-editor").trigger("submit");
    await flushPromises();
    expect(stored.cashEntries![0].amount).toBe("124");
    expect(wrapper.find(".desk-summary").text()).toContain("124.00");
  });
  it("费率保存失败时保留表单并显示错误", async () => {
    await start();
    await button("费用设置").trigger("click");
    await flushPromises();
    vi.mocked(saveAccount).mockRejectedValue(new Error("磁盘不可用"));
    await button("确认并保存股票费率").trigger("submit");
    await flushPromises();
    expect(
      document.querySelector(".floating-notice.error")?.textContent,
    ).toContain("磁盘不可用");
    expect(stored.feeConfirmed.stock).toBe(false);
  });
  it("保存成交后清除草稿，不被表单清空的侦听器重新写回", async () => {
    stored.feeConfirmed.etf = true;
    stored.profiles.etf.commissionWan = "1";
    vi.mocked(readDraft).mockResolvedValue({
      price: "10",
      quantity: "100",
      time: "2026-08-25T09:00:00",
      note: "测试草稿",
      side: "buy",
      feeSource: "estimated",
    });
    await start();
    await button("交易").trigger("click");
    await flushPromises();
    expect(wrapper.find(".entry-security").text()).toContain("沪深300ETF");
    await wrapper.find(".submit-order.buy").trigger("click");
    await flushPromises();
    expect(stored.entries).toHaveLength(1);
    expect(vi.mocked(writeDraft).mock.calls.at(-1)).toEqual([
      "trade:sh510300:entry",
      null,
    ]);
    expect(wrapper.find(".entry-dialog").exists()).toBe(false);
  });
});

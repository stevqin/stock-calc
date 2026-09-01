import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SecuritiesTable from "./SecuritiesTable.vue";
import {
  marketQuotes,
  marketCharts,
  chartKey,
  marketFundFlows,
  fundFlowErrors,
} from "../market";
import type { DailyPerformance } from "../sim/performance";
import type { Position, Security } from "../sim/model";
import { manualAccount } from "../sim/record";
import { replay } from "../sim/ledger";
import { defaultView } from "../sim/workspaceState";

vi.mock("../market", async () => ({
  marketQuotes: (await import("vue")).reactive({}),
  marketCharts: {},
  marketErrors: {},
  marketFundFlows: (await import("vue")).reactive({}),
  fundFlowErrors: (await import("vue")).reactive({}),
  chartKey: (id: string, mode: string) => `${id}:${mode}`,
}));
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  for (const id of Object.keys(marketQuotes)) delete marketQuotes[id];
  for (const id of Object.keys(marketCharts)) delete marketCharts[id];
  for (const id of Object.keys(marketFundFlows)) delete marketFundFlows[id];
  for (const id of Object.keys(fundFlowErrors)) delete fundFlowErrors[id];
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});
async function start(investment = "1000") {
  const a = manualAccount(),
    s = a.securities[0];
  const p = {
    ...replay(a).positions[s.id],
    securityId: s.id,
    quantity: "100",
    available: "80",
    netInvestment: investment,
    dilutedCost: "10.0000",
  };
  marketQuotes[s.id] = {
    market: "sh",
    code: s.code,
    name: s.name,
    latest: "10.100",
    previousClose: "10.000",
    open: "10.020",
    high: "10.180",
    low: "9.980",
    change: "1.00",
    peRatio: "19.97",
    pbRatio: "6.47",
    floatCap: "12.34",
    volume: "12345",
    bid: "10.090",
    ask: "10.100",
    kind: "etf",
    quoteTime: "20260831140000",
    fetchedAt: "2026-08-31T06:00:00Z",
  };
  wrapper = mount(SecuritiesTable, {
    props: {
      rows: [s],
      view: defaultView(),
      mode: "intraday",
      positions: { [s.id]: p },
      recordedIds: [],
      daily: {},
      selected: s.id,
      checked: [],
    },
    global: { stubs: { MiniChart: true } },
  });
  await flushPromises();
}
describe("双行证券指标", () => {
  it("普通行情表展示股票市盈率和市净率，ETF不伪造估值", async () => {
    await start();
    await wrapper.setProps({ view: defaultView("all"), variant: "market" });
    const props = wrapper.props() as unknown as { rows: Security[] };
    await wrapper.setProps({
      rows: [{ ...props.rows[0], asset: "stock" }],
    });
    expect(wrapper.get('[data-metric="peRatio"]').text()).toBe("19.97");
    expect(wrapper.get('[data-metric="pbRatio"]').text()).toBe("6.47");
    await wrapper.setProps({
      rows: [{ ...props.rows[0], asset: "etf" }],
    });
    marketQuotes[props.rows[0].id].peRatio = null;
    marketQuotes[props.rows[0].id].pbRatio = null;
    await flushPromises();
    expect(wrapper.get('[data-metric="peRatio"]').text()).toBe("—");
    expect(wrapper.get('[data-metric="pbRatio"]').text()).toBe("—");
  });
  it("主力净流入显示独立来源，失败保留带星旧值，跨日不混用", async () => {
    await start();
    const s = manualAccount().securities[0];
    marketFundFlows[s.id] = {
      market: s.market,
      code: s.code,
      mainNet: "12345678",
      quoteTime: "20260831140000",
      fetchedAt: "2026-08-31T06:00:00Z",
      source: "东方财富",
    };
    await flushPromises();
    expect(wrapper.text()).toContain("+1234.57万");
    fundFlowErrors[s.id] = "网络超时";
    await flushPromises();
    expect(wrapper.text()).toContain("+1234.57万 *");
    expect(wrapper.html()).toContain("东方财富");
    expect(wrapper.html()).toContain("网络超时");
    marketQuotes[s.id].quoteTime = "20260901100000";
    await flushPromises();
    expect(wrapper.text()).not.toContain("+1234.57万");
  });
  it.each([
    ["100", "100", "100"],
    ["100.0", "100", "100"],
    ["1300", "1000", "1,300（1,000）"],
    ["1000", "0", "1,000（0）"],
    ["0", "0", "0"],
  ])("持仓%s、可卖%s显示为%s", async (quantity, available, expected) => {
    await start();
    const { positions } = wrapper.props() as {
      positions: Record<string, Position>;
    };
    const id = Object.keys(positions)[0];
    await wrapper.setProps({
      positions: {
        ...positions,
        [id]: { ...positions[id], quantity, available },
      },
    });
    expect(wrapper.find(".holding-quantity").text()).toBe(expected);
  });
  it("ETF以基替代市场并仅标T+0，创业板科创板以板块替代市场", async () => {
    await start();
    const base = manualAccount().securities[0];
    const rows = [
      {
        ...base,
        id: "sz159915",
        market: "sz" as const,
        code: "159915",
        name: "创业板ETF",
        settlement: "T+0" as const,
      },
      {
        ...base,
        id: "sh510300",
        market: "sh" as const,
        code: "510300",
        name: "沪深300ETF",
        settlement: "T+1" as const,
      },
      {
        ...base,
        id: "sz300750",
        market: "sz" as const,
        code: "300750",
        asset: "stock" as const,
      },
      {
        ...base,
        id: "sz301001",
        market: "sz" as const,
        code: "301001",
        asset: "stock" as const,
      },
      { ...base, id: "sh688001", code: "688001", asset: "stock" as const },
      { ...base, id: "sh600519", code: "600519", asset: "stock" as const },
    ];
    await wrapper.setProps({ rows });
    await wrapper.setProps({ holdingDays: { sz300750: 3 } });
    expect(wrapper.find('[data-symbol="sz300750"] .holding-days').text()).toBe(
      "3日",
    );
    expect(
      wrapper
        .find('[data-symbol="sz300750"] .holding-days')
        .attributes("title"),
    ).toContain("实际日K统计 3 个交易日");
    expect(
      wrapper
        .find('[data-symbol="sz300750"] .holding-days')
        .element.parentElement?.classList.contains("security-title-line"),
    ).toBe(false);
    expect(
      wrapper
        .find('[data-symbol="sz300750"] .holding-days')
        .element.parentElement?.classList.contains("security-meta"),
    ).toBe(true);
    for (const [id, tags] of [
      ["sz159915", ["基", "T+0"]],
      ["sh510300", ["基"]],
      ["sz300750", ["创"]],
      ["sz301001", ["创"]],
      ["sh688001", ["科"]],
      ["sh600519", ["SH"]],
    ] as const) {
      expect(
        wrapper
          .findAll(`[data-symbol="${id}"] .security-meta em`)
          .map((b) => b.text()),
      ).toEqual(tags);
    }
    const identity = wrapper.find(
      '[data-symbol="sz300750"] .security-identity',
    );
    expect(identity.attributes("title")).toBe("创业板");
    const t0 = wrapper.find('[data-symbol="sz159915"] .security-t0');
    expect(t0.attributes("title")).toContain("当日回转交易");
  });
  it("名称独占主行宽度，持仓天数归入代码副行，已清仓紧跟名称且不增加行", async () => {
    await start();
    const props = wrapper.props() as unknown as {
      rows: Security[];
      positions: Record<string, Position>;
    };
    const id = props.rows[0].id;
    await wrapper.setProps({
      holdingDays: { [id]: 8 },
      positions: {
        ...props.positions,
        [id]: { ...props.positions[id], quantity: "0", available: "0" },
      },
      recordedIds: [id],
    });
    const row = wrapper.get(`[data-symbol="${id}"]`);
    expect(row.get(".security-title-line").text()).toContain("已清仓");
    expect(row.get(".security-meta").text()).toContain("8日");
    expect(row.get(".security-closed").attributes("title")).toContain(
      "持仓数量为0",
    );
    expect(row.get(".security-title-line").element.children).toHaveLength(2);
    expect(row.get(".security-meta").element.children).toHaveLength(3);
    expect(row.get(".pin-name").element.children).toHaveLength(2);
  });
  it("超长证券名称使用紧凑双行而不是提前挤占代码副行", async () => {
    await start();
    const props = wrapper.props() as unknown as { rows: Security[] };
    const long = {
      ...props.rows[0],
      name: "港股通创新药医疗ETF富国",
    };
    await wrapper.setProps({ rows: [long] });
    const name = wrapper.get(".security-name");
    expect(name.text()).toBe("港股通创新药医疗ETF富国");
    expect(name.classes()).toContain("security-name-long");
    expect(wrapper.get("tbody .pin-name").classes()).toContain("has-long-name");
    expect(wrapper.get(".security-meta").text()).toContain(long.code);
  });
  it("无持仓证券仍显示相同成本表头，未交易收益显示横线而非零", async () => {
    await start();
    const id = manualAccount().securities[0].id;
    await wrapper.setProps({
      positions: {},
      daily: { [id]: { profit: "0.00", reason: "" } },
    });
    expect(wrapper.find('[aria-label="持仓成本单价"]').exists()).toBe(true);
    expect(wrapper.find(".cost-secondary").text()).toBe("—");
    expect(wrapper.find('[data-metric="dailyPnl"] span').text()).toBe("—");
    expect(wrapper.find('[data-metric="dailyPnl"] small').text()).toBe("—");
    expect(wrapper.find('[data-metric="cyclePnl"] > span').text()).toBe("—");
    expect(wrapper.find('[data-metric="marketValue"] > span').text()).toBe("—");
    expect(wrapper.find('[data-metric="marketValue"] > small').text()).toBe(
      "0",
    );
    await wrapper.setProps({ recordedIds: [id] });
    expect(wrapper.find('[data-metric="dailyPnl"] span').text()).toBe("0.00");
  });
  it("单击只选中，双击行或名称才打开详情，支持Enter且无复选框", async () => {
    await start();
    const row = wrapper.find("tbody tr");
    await row.trigger("click");
    await wrapper.find(".security-name").trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(2);
    expect(wrapper.emitted("detail")).toBeUndefined();
    await row.trigger("dblclick");
    await wrapper.find(".security-name").trigger("dblclick");
    await wrapper.find(".security-name").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("detail")).toHaveLength(3);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    await row.trigger("contextmenu", { clientX: 800, clientY: 400 });
    expect(wrapper.emitted("context")?.[0]).toEqual([
      { id: manualAccount().securities[0].id, x: 800, y: 400 },
    ]);
    expect(wrapper.emitted("detail")).toHaveLength(3);
    await wrapper
      .find(".security-name")
      .trigger("keydown", { key: "F10", shiftKey: true });
    expect(wrapper.emitted("context")).toHaveLength(2);
  });
  it("名称110、现价100，指标采用用户紧凑列宽", async () => {
    await start();
    const cols = wrapper.findAll("col");
    expect(cols[0].attributes("style")).toContain("110px");
    expect(cols[1].attributes("style")).toContain("100px");
    expect(
      wrapper.find('col[data-column="dailyPnl"]').attributes("style"),
    ).toContain("85px");
    expect(wrapper.find(".column-resizer").exists()).toBe(false);
    expect(wrapper.find('[role="separator"]').exists()).toBe(false);
    expect(
      wrapper.find('col[data-column="marketValue"]').attributes("style"),
    ).toContain("96px");
    await wrapper.setProps({
      view: {
        ...defaultView(),
        widths: { marketValue: 200, cyclePnl: 300, flow: 400 },
      },
    });
    expect(
      wrapper.find('col[data-column="marketValue"]').attributes("style"),
    ).toContain("96px");
    expect(
      wrapper.find('col[data-column="cyclePnl"]').attributes("style"),
    ).toContain("93px");
    expect(
      wrapper.find('col[data-column="flow"]').attributes("style"),
    ).toContain("95px");
  });
  it("支持Cmd/Ctrl点选与Shift连选，右键不触发详情", async () => {
    await start();
    const rows = manualAccount().securities;
    await wrapper.setProps({ rows });
    const names = wrapper.findAll(".security-name");
    await names[0].trigger("click");
    expect(wrapper.emitted("check")?.at(-1)).toEqual([[rows[0].id]]);
    await wrapper.setProps({ checked: [rows[0].id] });
    await names[1].trigger("click", { metaKey: true });
    expect(wrapper.emitted("check")?.at(-1)).toEqual([
      [rows[0].id, rows[1].id],
    ]);
    await wrapper.setProps({ checked: [rows[0].id, rows[1].id] });
    await names[0].trigger("click", { ctrlKey: true });
    expect(wrapper.emitted("check")?.at(-1)).toEqual([[rows[1].id]]);
    await names[rows.length - 1].trigger("click", { shiftKey: true });
    expect(wrapper.emitted("check")?.at(-1)).toEqual([rows.map((s) => s.id)]);
  });
  it("涨跌幅主金额副、市值/数量及可卖、本轮金额主收益率副", async () => {
    await start();
    expect(wrapper.find('[data-metric="change"] > span').text()).toBe("+1.00%");
    expect(wrapper.find('[data-metric="change"] > small').text()).toBe(
      "+0.100",
    );
    expect(wrapper.find('[data-metric="marketValue"] > span').text()).toBe(
      "1,010.00",
    );
    expect(wrapper.find('[data-metric="marketValue"] > small').text()).toBe(
      "100（80）",
    );
    expect(wrapper.find('[data-metric="cyclePnl"] > span').text()).toBe(
      "+10.00",
    );
    expect(wrapper.find('[data-metric="cyclePnl"] > small').text()).toBe(
      "+1.00%",
    );
  });
  it("今日盈亏金额为主、收益率为副，点击保留核对入口", async () => {
    await start();
    const id = manualAccount().securities[0].id;
    const daily: DailyPerformance = {
      date: "2026-08-31",
      quantityStart: "100",
      previousClose: "10",
      startValue: "1000",
      endValue: "1010",
      buys: "100",
      sells: "0",
      fees: "0",
      profit: "11",
      reason: "",
    };
    await wrapper.setProps({ daily: { [id]: daily } });
    expect(wrapper.find('[data-metric="dailyPnl"] span').text()).toBe("+11.00");
    expect(wrapper.find('[data-metric="dailyPnl"] small').text()).toBe(
      "+1.00%",
    );
    await wrapper.find(".pnl-link").trigger("click");
    expect(wrapper.emitted("pnl")?.[0]).toEqual([id]);
    await wrapper.setProps({ daily: { [id]: { ...daily, profit: "-11" } } });
    expect(wrapper.find('[data-metric="dailyPnl"] span').text()).toBe("-11.00");
    expect(wrapper.find('[data-metric="dailyPnl"] small').text()).toBe(
      "-1.00%",
    );
    expect(wrapper.find('[data-metric="dailyPnl"]').classes()).toContain(
      "loss",
    );
  });
  it("收益贡献视图隐藏持仓成本，并显示累计、历史、当前和组内占比", async () => {
    await start();
    const id = manualAccount().securities[0].id;
    await wrapper.setProps({
      variant: "contribution",
      view: defaultView("profit"),
      contributions: {
        [id]: {
          total: "120.50",
          realized: "80.25",
          holding: "40.25",
          share: "62.35",
        },
      },
    });
    expect(wrapper.find('[aria-label="持仓成本单价"]').exists()).toBe(false);
    expect(wrapper.find(".cost-secondary").exists()).toBe(false);
    expect(wrapper.findAll("col")[1].attributes("style")).toContain("90px");
    expect(
      wrapper.find('[data-metric="totalContribution"] > span').text(),
    ).toBe("+120.50");
    expect(
      wrapper.find('[data-metric="totalContribution"] > small').text(),
    ).toBe("62.35%");
    const breakdown = wrapper.find('[data-metric="contributionBreakdown"]');
    expect(breakdown.text()).toContain("历+80.25");
    expect(breakdown.text()).toContain("持+40.25");
  });
  it("所有百分比随数字显示符号，非收益比例不加正号，零涨幅为灰", async () => {
    await start();
    const id = manualAccount().securities[0].id;
    Object.assign(marketQuotes[id], {
      change: "0",
      turnover: "3.456",
      amplitude: "2.1",
    });
    await flushPromises();
    expect(wrapper.find('[data-metric="change"] > span').text()).toBe("0.00%");
    expect(wrapper.find('[data-metric="change"]').classes()).toContain("flat");
    expect(wrapper.find('[data-metric="turnover"]').text()).toBe("3.46%");
    expect(wrapper.find('[data-metric="amplitude"]').text()).toBe("2.10%");
    marketCharts[chartKey(id, "daily")] = {
      symbol: id,
      mode: "daily",
      adjustment: "前复权",
      fetchedAt: "",
      sessions: [],
      bars: [21, 24, 25, 26, 27].map((day) => ({
        date: `2026-08-${day}`,
        open: "10",
        close: "10",
        high: "10",
        low: "10",
        volume: "0",
      })),
    };
    marketQuotes[id].change = "-1";
    await flushPromises();
    expect(wrapper.find('[data-metric="change"] > span').text()).toBe("-1.00%");
    expect(wrapper.find('[data-metric="fiveDay"]').text()).toBe("+1.00%");
  });
  it("单位移到表头，成本合并到现价下方且仍可按成本排序", async () => {
    await start();
    expect(wrapper.find("th.pin-price").text()).toContain("成本（元）");
    expect(wrapper.find("td.pin-price .cost-secondary").text()).toBe("10.0000");
    expect(wrapper.find('col[data-column="dilutedCost"]').exists()).toBe(false);
    expect(wrapper.find('[data-metric="floatCap"]').text()).toBe("12.34");
    expect(wrapper.find('[data-metric="volume"]').text()).toBe("1.23");
    expect(wrapper.find('[aria-label="成交量"]').text()).toContain("万手");
    expect(wrapper.find('[aria-label="持仓市值"]').text()).toContain(
      "持仓（可卖）",
    );
    await wrapper.find('[aria-label="持仓成本单价"]').trigger("click");
    expect(wrapper.emitted("config")?.[0]?.[0]).toMatchObject({
      sort: "dilutedCost",
    });
  });
  it.each(["0", "-100"])("净投入%s时不显示误导收益率", async (value) => {
    await start(value);
    expect(wrapper.find('[data-metric="cyclePnl"] > small').text()).toBe("—");
    expect(
      wrapper.find('[data-metric="cyclePnl"]').attributes("title"),
    ).toContain("净投入≤0");
  });
});

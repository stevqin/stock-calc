import { mount, flushPromises } from "@vue/test-utils";
import {
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import PnlAnalysis from "./PnlAnalysis.vue";
import { manualAccount } from "./sim/record";
import { loadAnalysisHistory } from "./analysisHistory";
import { marketQuotes } from "./market";
import type { ChartData } from "./sim/chart";

vi.mock("./analysisHistory", () => ({
  loadAnalysisHistory: vi.fn().mockRejectedValue(new Error("离线测试")),
}));
// jsdom does not implement native dialog methods; browser checks cover modality.
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
let wrapper: ReturnType<typeof mount>;
let fixture: ReturnType<typeof manualAccount>;
beforeEach(() => {
  vi.mocked(loadAnalysisHistory)
    .mockReset()
    .mockRejectedValue(new Error("离线测试"));
  for (const id of Object.keys(marketQuotes)) delete marketQuotes[id];
});
afterEach(() => wrapper?.unmount());
function stockAccount() {
  const account = manualAccount();
  account.entries = [
    {
      id: "buy",
      securityId: "sh510300",
      kind: "buy",
      quantity: "100",
      price: "10",
      date: "2026-01-12",
      time: "2026-01-12T01:00:00Z",
      fees: {
        amount: "1000",
        commission: "1",
        stamp: "0",
        transfer: "0",
        total: "1",
        cash: "1001",
      },
    },
  ];
  return account;
}
function stockBars(symbol: string): ChartData {
  return {
    symbol,
    mode: "daily-raw",
    adjustment: "不复权",
    fetchedAt: "2026-01-15T08:00:00Z",
    sessions: [],
    bars: [
      ["2026-01-09", "10"],
      ["2026-01-12", "10"],
      ["2026-01-13", "11"],
      ["2026-01-14", "12"],
      ["2026-01-15", "13"],
    ].map(([date, close]) => ({
      date,
      close,
      open: close,
      high: close,
      low: close,
      volume: "1",
    })),
  };
}
async function start() {
  const account = manualAccount();
  fixture = account;
  account.cashEntries = [
    {
      id: "income",
      kind: "interest",
      amount: "12.30",
      date: "2025-11-03",
      time: "2025-11-03T01:00:00Z",
      note: "利息",
    },
  ];
  wrapper = mount(PnlAnalysis, { props: { account, today: "2026-01-15" } });
  await flushPromises();
}
const button = (name: string) =>
  wrapper.findAll("button").find((b) => b.text() === name)!;
describe("盈亏分析日历", () => {
  it("概览及日、月、年日历同时展示对应盈亏率", async () => {
    const account = stockAccount();
    account.cashEntries = [
      {
        id: "capital",
        kind: "deposit",
        amount: "1001",
        date: "2026-01-12",
        time: "2026-01-12T00:00:00Z",
        note: "",
      },
    ];
    vi.mocked(loadAnalysisHistory).mockImplementation(async (s) =>
      stockBars(s.id),
    );
    wrapper = mount(PnlAnalysis, { props: { account, today: "2026-01-15" } });
    await flushPromises();
    expect(wrapper.text()).toContain("区间卖出盈亏");
    expect(wrapper.get(".pnl-contribution").text()).toContain("区间收益率");
    expect(wrapper.get(".range-return").text()).toBe("+29.87%");
    expect(wrapper.findAll(".pnl-month-return")[0].text()).toBe("+29.87%");
    expect(wrapper.get('[data-date="2026-01-13"] .pnl-day-return').text()).toBe(
      "+10.00%",
    );
    await wrapper.get('[data-date="2026-01-13"]').trigger("click");
    expect(wrapper.get(".pnl-day-detail").text()).toContain("当日卖出盈亏");
    expect(wrapper.get(".day-return").text()).toBe("+10.00%");
    await wrapper.get(".pnl-day-close").trigger("click");
    await button("年").trigger("click");
    expect(
      wrapper.get('[data-period="2026-01"] .pnl-period-return').text(),
    ).toBe("+29.87%");
    await button("全部").trigger("click");
    expect(wrapper.get('[data-period="2026"] .pnl-period-return').text()).toBe(
      "+29.87%",
    );
  });
  it("贡献列表可等宽放大，并按盈亏和收益率切换排序", async () => {
    const account = stockAccount();
    account.entries.push({
      ...account.entries[0],
      id: "buy-second",
      securityId: "sz159915",
      price: "20",
      fees: {
        amount: "2000",
        commission: "1",
        stamp: "0",
        transfer: "0",
        total: "1",
        cash: "2001",
      },
    });
    vi.mocked(loadAnalysisHistory).mockImplementation(async (security) => {
      if (security.id === "sh510300") return stockBars(security.id);
      const chart = stockBars(security.id);
      chart.bars = chart.bars.map((bar, index) => ({
        ...bar,
        open: String(20 - index),
        high: String(20 - index),
        low: String(20 - index),
        close: String(20 - index),
      }));
      return chart;
    });
    wrapper = mount(PnlAnalysis, {
      props: { account, today: "2026-01-15" },
    });
    await flushPromises();

    const compactRows = () =>
      wrapper.findAll(".pnl-contribution > .pnl-contribution-scroll tbody tr");
    expect(compactRows()[0].text()).toContain("沪深300ETF");
    expect(compactRows()[0].text()).toContain("+29.87%");

    await wrapper.get('[data-contribution-sort="profit"]').trigger("click");
    expect(compactRows()[0].text()).toContain("创业板ETF");
    await wrapper.get('[data-contribution-sort="returnRate"]').trigger("click");
    expect(compactRows()[0].text()).toContain("沪深300ETF");

    await button("放大查看").trigger("click");
    await flushPromises();
    expect(
      wrapper.get("dialog.pnl-contribution-dialog").attributes(),
    ).toHaveProperty("open");
    expect(wrapper.get(".pnl-contribution-dialog tbody").text()).toContain(
      "创业板ETF",
    );
    await wrapper.get(".pnl-contribution-dialog-close").trigger("click");
    expect(wrapper.find("dialog.pnl-contribution-dialog").exists()).toBe(false);
  });
  it.each([
    ["2025-11", "2025-11-03"],
    ["2025-06", "2025-06-02"],
  ])(
    "%s 月初在周末时从周一开始，月历只展示五个工作日列",
    async (month, first) => {
      await start();
      const monthInput = wrapper.get('[data-testid="analysis-month"] input');
      await monthInput.setValue(month);
      await monthInput.trigger("blur");
      const calendar = wrapper.findAll(".pnl-month")[0];
      expect(
        calendar.findAll(".pnl-weekdays span").map((day) => day.text()),
      ).toEqual(["一", "二", "三", "四", "五"]);
      expect(calendar.findAll(".pnl-day-blank")).toHaveLength(0);
      expect(calendar.find(".pnl-day").attributes("data-date")).toBe(first);
      for (const day of wrapper.findAll(".pnl-day")) {
        const weekday = new Date(
          `${day.attributes("data-date")}T00:00:00Z`,
        ).getUTCDay();
        expect([0, 6]).not.toContain(weekday);
      }
    },
  );
  it("历史行情返回前保留缺失状态，返回后日历和曲线随当日报价更新", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(loadAnalysisHistory).mockImplementation(async (s) => {
      await gate;
      return stockBars(s.id);
    });
    wrapper = mount(PnlAnalysis, {
      props: { account: stockAccount(), today: "2026-01-15" },
    });
    await flushPromises();
    expect(wrapper.find(".pnl-loading").exists()).toBe(true);
    expect(wrapper.get(".pnl-total strong").text()).toBe("—");
    release();
    await flushPromises();
    expect(wrapper.find(".pnl-loading").exists()).toBe(false);
    expect(wrapper.get(".pnl-total strong").text()).toBe("+299.00");
    expect(wrapper.find(".pnl-trend path").exists()).toBe(true);
    marketQuotes.sh510300 = {
      market: "sh",
      code: "510300",
      name: "ETF",
      latest: "14",
      bid: "14",
      ask: "14",
      quoteTime: "20260115150000",
      fetchedAt: "2026-01-15T07:00:00Z",
      kind: "etf",
    };
    await flushPromises();
    expect(wrapper.get(".pnl-total strong").text()).toBe("+399.00");
    expect(wrapper.get('[data-date="2026-01-15"]').text()).toContain("+200.00");
  });
  it("行情失败列出缺失日期，重试成功后恢复收益", async () => {
    wrapper = mount(PnlAnalysis, {
      props: { account: stockAccount(), today: "2026-01-15" },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("离线测试");
    expect(wrapper.get(".pnl-missing-ranges").text()).toContain(
      "2026-01-12 — 2026-01-15",
    );
    vi.mocked(loadAnalysisHistory).mockImplementation(async (s) =>
      stockBars(s.id),
    );
    await button("重新获取").trigger("click");
    await flushPromises();
    expect(wrapper.get(".pnl-total strong").text()).toBe("+299.00");
    expect(wrapper.find(".pnl-missing-ranges").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("离线测试");
  });
  it("默认月视图展示最近十二个月，所选月份在首位并跨年倒序", async () => {
    await start();
    expect(wrapper.findAll(".pnl-month h3").map((x) => x.text())).toEqual([
      "2026年1月",
      "2025年12月",
      "2025年11月",
      "2025年10月",
      "2025年9月",
      "2025年8月",
      "2025年7月",
      "2025年6月",
      "2025年5月",
      "2025年4月",
      "2025年3月",
      "2025年2月",
    ]);
    const monthInput = wrapper.get('[data-testid="analysis-month"] input');
    await monthInput.setValue("2025-12");
    await monthInput.trigger("blur");
    expect(wrapper.findAll(".pnl-month h3").map((x) => x.text())).toEqual([
      "2025年12月",
      "2025年11月",
      "2025年10月",
      "2025年9月",
      "2025年8月",
      "2025年7月",
      "2025年6月",
      "2025年5月",
      "2025年4月",
      "2025年3月",
      "2025年2月",
      "2025年1月",
    ]);
  });
  it("全部每格一年，年视图固定十二个月并默认当前年", async () => {
    await start();
    await button("全部").trigger("click");
    expect(
      wrapper
        .findAll(".pnl-period-cell")
        .map((x) => x.attributes("data-period")),
    ).toEqual(["2025", "2026"]);
    await button("年").trigger("click");
    expect(wrapper.findAll(".pnl-period-cell")).toHaveLength(12);
    expect(wrapper.get(".pnl-year-select").element).toHaveProperty(
      "value",
      "2026",
    );
    expect(wrapper.findAll(".pnl-period-cell")[1].text()).toContain("尚未发生");
  });
  it("日期可以打开当天收入详情，筛选不修改账户", async () => {
    await start();
    const original = JSON.stringify(fixture);
    await wrapper.get('[data-date="2025-11-03"]').trigger("click");
    expect(wrapper.get(".pnl-day-detail").text()).toContain("2025-11-03");
    expect(wrapper.get(".pnl-day-detail").text()).toContain("12.30");
    await flushPromises();
    expect(wrapper.get("dialog[open] #pnl-day-title").text()).toContain(
      "收益明细",
    );
    await wrapper.get("dialog").trigger("cancel");
    expect(wrapper.find("dialog").exists()).toBe(false);
    await wrapper.get('[data-date="2025-11-03"]').trigger("click");
    await wrapper.get(".pnl-day-close").trigger("click");
    expect(wrapper.find("dialog").exists()).toBe(false);
    await button("最近半年").trigger("click");
    expect(JSON.stringify(fixture)).toBe(original);
  });
  it("闰年二月包含29日，保持十二个独立月历", async () => {
    await start();
    const monthInput = wrapper.get('[data-testid="analysis-month"] input');
    await monthInput.setValue("2024-02");
    await monthInput.trigger("blur");
    expect(wrapper.findAll(".pnl-month")).toHaveLength(12);
    expect(wrapper.find('[data-date="2024-02-29"]').exists()).toBe(true);
    expect(wrapper.find('[data-date="2024-02-30"]').exists()).toBe(false);
  });
  it("默认十二个月跨年时会补取上一年的历史行情", async () => {
    const account = stockAccount();
    account.entries[0].date = "2025-01-02";
    account.entries[0].time = "2025-01-02T01:00:00Z";
    wrapper = mount(PnlAnalysis, { props: { account, today: "2026-09-07" } });
    await flushPromises();
    expect(
      [
        ...new Set(
          vi.mocked(loadAnalysisHistory).mock.calls.map(([, year]) => year),
        ),
      ].sort(),
    ).toEqual([2025, 2026]);
  });
  it("缺失日期可以绕过旧缓存补取，后续日期更新仍按缓存策略加载", async () => {
    wrapper = mount(PnlAnalysis, {
      props: { account: stockAccount(), today: "2026-01-15" },
    });
    await flushPromises();
    const repair = wrapper.get(".pnl-missing-ranges button");
    vi.mocked(loadAnalysisHistory).mockClear();
    await repair.trigger("click");
    await flushPromises();
    expect(vi.mocked(loadAnalysisHistory).mock.calls.length).toBeGreaterThan(0);
    expect(
      vi
        .mocked(loadAnalysisHistory)
        .mock.calls.every((args) => args[2]?.force === true),
    ).toBe(true);
    vi.mocked(loadAnalysisHistory).mockClear();
    await wrapper.setProps({ today: "2026-01-16" });
    await flushPromises();
    expect(vi.mocked(loadAnalysisHistory).mock.calls.length).toBeGreaterThan(0);
    expect(
      vi
        .mocked(loadAnalysisHistory)
        .mock.calls.every((args) => !args[2]?.force),
    ).toBe(true);
  });
});

import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MarketChart from "./MarketChart.vue";
import { getChart } from "../market";
import { manualAccount } from "../sim/record";
import type { ChartData } from "../sim/chart";
const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  clear: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("echarts/core", () => ({ use: vi.fn(), init: () => chart }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../market", () => ({
  getChart: vi.fn(),
  liveDaily: (d: unknown) => d,
  marketQuotes: {},
}));
let wrapper: ReturnType<typeof mount>;
const security = manualAccount().securities[0];
const trade = {
  id: "b",
  securityId: security.id,
  kind: "buy" as const,
  quantity: "100",
  price: "20",
  date: "2026-08-31",
  time: "2026-08-31T01:30:00Z",
};
const data: ChartData = {
  symbol: security.id,
  mode: "daily",
  adjustment: "前复权",
  fetchedAt: "2026-08-31T07:00:00Z",
  bars: [
    {
      date: "2026-08-31",
      open: "10",
      close: "11",
      high: "12",
      low: "9",
      volume: "100",
    },
  ],
  sessions: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(getChart).mockImplementation(async (s, mode) => ({
    ...data,
    symbol: s.id,
    mode,
    sessions: [
      {
        date: "20260831",
        previousClose: "10",
        points: [{ time: "0930", price: "11", volume: "100", amount: null }],
      },
    ],
  }));
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});
it.each(["daily", "intraday", "five-day"] as const)(
  "%s图表用接线桩显示BS点，修改和删除即时重画且交易并入统一悬浮卡",
  async (mode) => {
    wrapper = mount(MarketChart, {
      props: { security, mode, trades: [trade] },
    });
    await flushPromises();
    const option = () => chart.setOption.mock.calls.at(-1)![0];
    const series = () =>
      chart.setOption.mock.calls
        .at(-1)![0]
        .series.filter((s: { type: string }) => s.type === "custom");
    const buy = () =>
      series().find((s: { name: string }) => s.name === "B 买入");
    const sell = () =>
      series().find((s: { name: string }) => s.name === "S 卖出");
    expect(buy().data).toHaveLength(1);
    const pole = buy().renderItem(null, {
      value: (index: number) => buy().data[0].value[index],
      coord: ([x, y]: number[]) => [x * 10, y * 10],
    });
    expect(pole.children.map((child: { type: string }) => child.type)).toEqual([
      "line",
      "circle",
      "circle",
      "text",
    ]);
    expect(
      Math.abs(
        pole.children[0].shape.y2 - pole.children[0].shape.y1,
      ),
    ).toBe(32);
    expect(pole.children.at(-1).style.text).toBe("B");
    const tooltip = option().tooltip.formatter([
      {
        seriesType: mode === "daily" ? "candlestick" : "line",
        dataIndex: 0,
        axisValue: mode === "daily" ? "2026-08-31" : "08-31 09:30",
      },
    ]);
    expect(tooltip).toContain("交易记录");
    expect(tooltip).toContain("B 买入");
    expect(tooltip).toContain("20元 × 100");
    expect(buy().tooltip.show).toBe(false);
    expect(wrapper.text()).toContain("BS成交 1笔");
    await wrapper.setProps({ trades: [{ ...trade, kind: "sell" }] });
    expect(buy().data).toHaveLength(0);
    expect(sell().data).toHaveLength(1);
    await wrapper.setProps({ trades: [] });
    expect(
      series().every((s: { data: unknown[] }) => s.data.length === 0),
    ).toBe(true);
    expect(getChart).toHaveBeenCalledTimes(1);
  },
);
it("分时与五日分时使用价格/涨跌幅双轴，展示行情摘要且禁止缩放", async () => {
  wrapper = mount(MarketChart, {
    props: { security, mode: "intraday", trades: [] },
  });
  await flushPromises();
  let option = chart.setOption.mock.calls.at(-1)![0];
  expect(option.dataZoom).toEqual([]);
  expect(option.xAxis[1].data).toHaveLength(242);
  expect(option.xAxis[1].data.at(-1)).toBe("08-31 15:00");
  expect(option.xAxis[1].axisLabel.hideOverlap).toBe(false);
  expect(option.xAxis[1].axisLabel.formatter("08-31 09:30")).toBe("09:30");
  expect(option.xAxis[1].axisLabel.formatter("08-31 11:30")).toBe(
    "11:30\n",
  );
  expect(option.xAxis[1].axisLabel.formatter("08-31 13:00")).toBe(
    "\n13:00",
  );
  expect(option.xAxis[1].axisLabel.formatter("08-31 15:00")).toBe("15:00");
  expect(option.yAxis).toHaveLength(3);
  expect(option.yAxis[0].axisLabel.formatter(10.123456)).toBe("10.123");
  expect(
    option.yAxis[0].axisPointer.label.formatter({ value: 10.123456 }),
  ).toBe("10.123");
  expect(option.yAxis[1].position).toBe("right");
  expect(option.yAxis[1].axisLabel.formatter(11)).toBe("+10.00%");
  expect(option.yAxis[2].axisLabel.formatter(1234.567)).toBe("1,235");
  expect(option.yAxis[2].axisLabel.formatter(12345.67)).toBe("1.2万");
  expect(wrapper.get(".chart-snapshot").text()).toContain("开盘");
  expect(wrapper.get(".chart-snapshot").text()).toContain("最高");
  expect(wrapper.get(".chart-snapshot").text()).toContain("最低");
  expect(wrapper.get(".chart-snapshot").text()).toContain("收盘 / 最新");
  await wrapper.setProps({ mode: "five-day" });
  await flushPromises();
  option = chart.setOption.mock.calls.at(-1)![0];
  expect(option.dataZoom).toEqual([]);
  expect(option.yAxis).toHaveLength(3);
});
it("日K悬浮卡汇总OHLC、涨跌、振幅、成交量及同日交易，仍允许缩放", async () => {
  const trades = [
    trade,
    { ...trade, id: "s", kind: "sell" as const, quantity: "200" },
  ];
  wrapper = mount(MarketChart, { props: { security, mode: "daily", trades } });
  await flushPromises();
  const option = chart.setOption.mock.calls.at(-1)![0];
  const tooltip = option.tooltip.formatter([
    { seriesType: "candlestick", dataIndex: 0, axisValue: "2026-08-31" },
  ]);
  for (const text of [
    "开盘",
    "最高",
    "收盘",
    "最低",
    "涨跌幅",
    "振幅",
    "成交量",
    "B 买入",
    "S 卖出",
  ])
    expect(tooltip).toContain(text);
  expect(option.dataZoom).toHaveLength(2);
  expect(option.yAxis).toHaveLength(2);
  expect(wrapper.find(".chart-snapshot").exists()).toBe(false);
});
it("切换证券清除原证券标记", async () => {
  wrapper = mount(MarketChart, {
    props: { security, mode: "daily", trades: [trade] },
  });
  await flushPromises();
  await wrapper.setProps({ security: manualAccount().securities[1] });
  await flushPromises();
  expect(chart.clear).toHaveBeenCalled();
  expect(wrapper.text()).toContain("BS成交 0笔");
});
it("日K同日买卖只显示T，删除一边后恢复单方向，切分时保留BS", async () => {
  const trades = [
    trade,
    { ...trade, id: "s", kind: "sell" as const, quantity: "200" },
  ];
  wrapper = mount(MarketChart, { props: { security, mode: "daily", trades } });
  await flushPromises();
  const series = () =>
    chart.setOption.mock.calls
      .at(-1)![0]
      .series.filter((s: { type: string }) => s.type === "custom");
  expect(series().map((s: { data: unknown[] }) => s.data.length)).toEqual([
    0, 0, 1,
  ]);
  const pole = series()[2].renderItem(null, {
    value: (index: number) => series()[2].data[0].value[index],
    coord: ([x, y]: number[]) => [x * 10, y * 10],
  });
  expect(pole.children.at(-1).style.text).toBe("T");
  const tooltip = chart.setOption.mock.calls
    .at(-1)![0]
    .tooltip.formatter([
      { seriesType: "candlestick", dataIndex: 0, axisValue: "2026-08-31" },
    ]);
  expect(tooltip).toContain("B 买入");
  expect(tooltip).toContain("S 卖出");
  await wrapper.setProps({ trades: [trade] });
  expect(series().map((s: { data: unknown[] }) => s.data.length)).toEqual([
    1, 0, 0,
  ]);
  await wrapper.setProps({ mode: "intraday", trades });
  await flushPromises();
  expect(series().map((s: { data: unknown[] }) => s.data.length)).toEqual([
    1, 1,
  ]);
});

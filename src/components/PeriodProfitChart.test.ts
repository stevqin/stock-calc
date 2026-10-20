import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import PeriodProfitChart from "./PeriodProfitChart.vue";
const days = [
  { date: "2026-10-12", profit: "100.25" },
  { date: "2026-10-13", profit: "-30.10" },
  { date: "2026-10-14", profit: "0.00" },
];
const props = {
  days,
  rangeStart: "2026-10-12",
  rangeEnd: "2026-10-14",
  hasRecords: true,
};
function fixture(
  input: {
    days: { date: string; profit: string | null }[];
    rangeStart: string;
    rangeEnd: string;
    hasRecords: boolean;
  } = props,
) {
  const w = mount(PeriodProfitChart, { props: input });
  const stage = w.get("[data-profit-plot]");
  vi.spyOn(stage.element, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 0,
    width: 400,
    height: 190,
    right: 500,
    bottom: 190,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  return { w, stage };
}
describe("区间盈亏走势", () => {
  it("links the nearest date to the pointer and keeps amounts hidden when idle", async () => {
    const { w, stage } = fixture();
    expect(w.get("h3").text()).toBe("区间盈亏走势");
    expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
    await stage.trigger("keydown", { key: "End" });
    expect(w.get("[data-period-profit]").text()).toContain("+70.15");
    await stage.trigger("pointermove", { clientX: 100 });
    expect(w.get("[data-profit-date]").text()).toBe("2026-10-12");
    expect(w.get("[data-period-profit]").text()).toContain("+100.25");
    expect(w.get("[data-daily-profit]").text()).toContain("+100.25");
    expect(w.find("[data-profit-crosshair]").exists()).toBe(true);
    await stage.trigger("pointermove", { clientX: 300 });
    expect(w.get("[data-profit-date]").text()).toBe("2026-10-13");
    expect(w.get("[data-period-profit]").text()).toContain("+70.15");
    expect(w.get("[data-daily-profit]").text()).toContain("-30.10");
    await w.get(".pnl-profit-figure").trigger("pointerleave");
    await new Promise((resolve) => setTimeout(resolve, 230));
    expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
    expect(w.find("[data-profit-crosshair]").exists()).toBe(false);
    w.unmount();
  });
  it("does not bridge missing data or snap unknown dates to the last known profit", async () => {
    const { w, stage } = fixture({
      ...props,
      days: [days[0], { date: days[1].date, profit: null }, days[2]],
    });
    await stage.trigger("keydown", { key: "End" });
    expect(w.get("[data-period-profit]").text()).toContain("数据不足");
    await stage.trigger("pointermove", { clientX: 300 });
    expect(w.get("[data-profit-date]").text()).toBe("2026-10-13");
    expect(w.get("[data-period-profit]").text()).toContain("数据不足");
    expect(w.get("[data-daily-profit]").text()).toContain("数据不足");
    expect(w.find("[data-profit-dot]").exists()).toBe(false);
    await stage.trigger("pointermove", { clientX: 500 });
    expect(w.get("[data-period-profit]").text()).toContain("数据不足");
    expect(w.get("[data-daily-profit]").text()).toContain("0.00");
    expect(w.find("path")?.attributes("d")).not.toContain("L");
    w.unmount();
  });
  it("supports keyboard dates and clears selection when the interval changes", async () => {
    const { w, stage } = fixture();
    await stage.trigger("keydown", { key: "Home" });
    expect(w.get("[data-profit-date]").text()).toBe(days[0].date);
    await stage.trigger("keydown", { key: "ArrowRight" });
    expect(w.get("[data-profit-date]").text()).toBe(days[1].date);
    await stage.trigger("keydown", { key: "End" });
    expect(w.get("[data-profit-date]").text()).toBe(days[2].date);
    await w.setProps({ rangeStart: days[1].date, days: days.slice(1) });
    expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
    expect(w.find("[data-profit-crosshair]").exists()).toBe(false);
    await stage.trigger("keydown", { key: "End" });
    expect(w.get("[data-period-profit]").text()).toContain("-30.10");
    w.unmount();
  });
  it("labels actual plotted endpoints when the account starts after the selected range", () => {
    const { w } = fixture({
      ...props,
      rangeStart: "2026-09-01",
      rangeEnd: "2026-10-20",
    });
    expect(w.get(".pnl-profit-dates").text()).toContain("2026-10-12");
    expect(w.get(".pnl-profit-dates").text()).toContain("2026-10-14");
    expect(w.get(".pnl-profit-dates").text()).not.toContain("2026-09-01");
    w.unmount();
  });
  it("keeps a single zero-profit day interactive and empty accounts empty", async () => {
    const { w, stage } = fixture({ ...props, days: [days[2]] });
    await stage.trigger("pointermove", { clientX: 300 });
    expect(w.get("[data-period-profit]").text()).toContain("0.00");
    expect(w.find("[data-profit-dot]").exists()).toBe(true);
    await w.setProps({ hasRecords: false });
    expect(w.find("[data-profit-plot]").exists()).toBe(false);
    expect(w.text()).toContain("暂无");
    w.unmount();
  });
});

it("links book assets on a separate smooth curve and preserves gaps", async () => {
  const { w, stage } = fixture();
  await w.get('[data-series-toggle="assets"]').trigger("click");
  await w.setProps({
    days: [
      { ...days[0], assets: "10000.00" },
      { ...days[1], assets: null },
      { ...days[2], assets: "11000.00" },
    ],
  });
  expect(w.get("[data-asset-curve]").attributes("d")!.match(/M/g)).toHaveLength(
    2,
  );
  expect(w.get("[data-profit-curve]").attributes("d")).toContain("C");
  await stage.trigger("pointermove", { clientX: 100 });
  expect(w.get("[data-book-assets]").text()).toContain("10000.00");
  await stage.trigger("pointermove", { clientX: 300 });
  expect(w.get("[data-book-assets]").text()).toContain("数据不足");
  expect(w.find("[data-asset-dot]").exists()).toBe(false);
  await stage.trigger("pointermove", { clientX: 500 });
  expect(w.get("[data-book-assets]").text()).toContain("11000.00");
  w.unmount();
});
it("displays real B/S/T and transfer markers, with selectable event details", async () => {
  const { w } = fixture();
  await w.get('[data-series-toggle="assets"]').trigger("click");
  const entry = (id: string, kind: "buy" | "sell") => ({
    id,
    kind,
    securityId: "one",
    date: days[0].date,
    time: "2026-10-12T01:00:00.000Z",
    price: "10",
    quantity: "100",
  });
  await w.setProps({
    days: days.map((day) => ({ ...day, assets: "10000.00" })),
    entries: [entry("b", "buy"), entry("s", "sell")],
    cashEntries: [
      {
        id: "in",
        kind: "deposit",
        amount: "200",
        date: days[0].date,
        time: "2026-10-12T00:00:00.000Z",
        note: "新增资金",
      },
    ],
    securityNames: { one: "示例股份" },
  });
  expect(w.get("[data-trade-marker]").text()).toBe("T");
  expect(w.get("[data-transfer-marker]").text()).toBe("入");
  expect(w.get("[data-transfer-marker]").attributes("aria-label")).toContain(
    "转入",
  );
  await w.get("[data-trade-marker]").trigger("click");
  expect(w.get("[data-day-events]").text()).toContain("示例股份");
  expect(w.get("[data-day-events]").text()).toContain("新增资金");
  expect(w.get("[data-day-events]").text()).toContain("200");
  expect(w.get("[data-day-events]").text()).toContain("买入");
  expect(w.get("[data-day-events]").text()).toContain("卖出");
  w.unmount();
});
it("keeps every dense date individually hoverable without a multi-date panel", async () => {
  const { w } = fixture();
  const denseDays = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    profit: "0.00",
    assets: "10000.00",
  }));
  const entries = denseDays.map((day, i) => ({
    id: String(i),
    kind: "buy" as const,
    securityId: "one",
    date: day.date,
    time: `${day.date}T01:00:00.000Z`,
    price: "10",
    quantity: "100",
  }));
  await w.setProps({ days: denseDays, entries });
  const markers = w.findAll("[data-trade-marker]");
  expect(markers.length).toBeLessThan(30);
  expect(w.find("[data-event-dates]").exists()).toBe(false);
  for (let i = 0; i < denseDays.length; i++) {
    await w.get("[data-profit-plot]").trigger("pointermove", {
      clientX: 100 + (400 * i) / (denseDays.length - 1),
      clientY: 80,
    });
    expect(w.get("[data-profit-date]").text()).toBe(denseDays[i].date);
    expect(w.get("[data-trend-tooltip]").text()).not.toContain("合并");
  }
  await markers[0].trigger("click");
  expect(w.get("[data-profit-date]").text()).toBe(denseDays[0].date);
  expect(w.find("[data-event-dates]").exists()).toBe(false);
  await w.get("[data-profit-plot]").trigger("keydown", { key: "Escape" });
  expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
  w.unmount();
});

it("keeps hovered event details inside the floating tooltip and allows pinning", async () => {
  const { w, stage } = fixture();
  await w.setProps({
    entries: [
      {
        id: "b",
        kind: "buy",
        securityId: "one",
        date: days[0].date,
        time: "2026-10-12T01:00:00.000Z",
        price: "10",
        quantity: "100",
      },
    ],
  });
  await stage.trigger("pointermove", { clientX: 100 });
  expect(w.get("[data-trend-tooltip]").find("[data-day-events]").exists()).toBe(
    true,
  );
  expect(w.get("[data-trend-tooltip]").classes()).not.toContain("is-pinned");
  await w.get("[data-trade-marker]").trigger("click");
  expect(w.get("[data-trend-tooltip]").classes()).toContain("is-pinned");
  expect(w.find("[data-day-events]").exists()).toBe(true);
  w.unmount();
});
it("clips the same smooth profit curve above and below its exact zero axis", async () => {
  const { w } = fixture({
    ...props,
    days: [
      { date: days[0].date, profit: "100" },
      { date: days[1].date, profit: "-200" },
      { date: days[2].date, profit: "200" },
    ],
  });
  const positive = w.get("[data-profit-positive]"),
    negative = w.get("[data-profit-negative]");
  expect(positive.attributes("d")).toBe(negative.attributes("d"));
  expect(positive.attributes("clip-path")).not.toBe(
    negative.attributes("clip-path"),
  );
  const zero = Number(w.get(".pnl-profit-zero").attributes("y1"));
  expect(Number(w.get("[data-positive-clip]").attributes("height"))).toBe(zero);
  expect(Number(w.get("[data-negative-clip]").attributes("y"))).toBe(zero);
  w.unmount();
});

it.each([
  [["buy", "buy"], "B"],
  [["sell", "sell"], "S"],
  [["buy", "sell", "buy", "sell"], "T"],
] as const)("shows one account-day symbol for %j", async (kinds, expected) => {
  const { w } = fixture();
  await w.setProps({
    entries: kinds.map((kind, i) => ({
      id: String(i),
      kind,
      securityId: String(i % 3),
      date: days[0].date,
      time: `${days[0].date}T01:00:00.000Z`,
      price: "10",
      quantity: "100",
    })),
  });
  expect(w.get("[data-trade-marker]").text()).toBe(expected);
  w.unmount();
});
it("does not turn buys and sells on different clustered days into a daily T", async () => {
  const { w } = fixture();
  await w.setProps({
    days: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      profit: "0",
    })),
    entries: ["buy", "sell"].map((kind, i) => ({
      id: String(i),
      kind: kind as "buy" | "sell",
      securityId: "one",
      date: `2026-09-0${i + 1}`,
      time: `2026-09-0${i + 1}T01:00:00.000Z`,
      price: "10",
      quantity: "100",
    })),
  });
  expect(w.get("[data-trade-marker]").text()).toBe("B");
  await w.get("[data-trade-marker]").trigger("click");
  expect(w.find("[data-event-dates]").exists()).toBe(false);
  expect(w.get("[data-trend-tooltip]").text()).not.toContain("2026-09-02");
  w.unmount();
});
it("shows date and amounts only in a dismissible hover tooltip", async () => {
  const { w, stage } = fixture();
  expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
  expect(w.find(".pnl-profit-readout").exists()).toBe(false);
  await stage.trigger("pointermove", { clientX: 100 });
  const tooltip = w.get("[data-trend-tooltip]");
  expect(tooltip.get("[data-profit-date]").text()).toBe(days[0].date);
  expect(tooltip.get("[data-period-profit]").text()).toContain("100.25");
  await w.get(".pnl-profit-figure").trigger("pointerleave");
  await new Promise((resolve) => setTimeout(resolve, 230));
  expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
  w.unmount();
});
it("keeps adjacent single-letter markers separate when they have enough space", async () => {
  const { w } = fixture();
  await w.setProps({
    days: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      profit: "0",
    })),
    entries: ["buy", "sell"].map((kind, i) => ({
      id: String(i),
      kind: kind as "buy" | "sell",
      securityId: "one",
      date: `2026-09-0${1 + i * 3}`,
      time: `2026-09-0${1 + i * 3}T01:00:00.000Z`,
      price: "10",
      quantity: "100",
    })),
  });
  expect(
    w.findAll("[data-trade-marker]").map((marker) => marker.text()),
  ).toEqual(["B", "S"]);
  w.unmount();
});

it("keeps hover details open while entering the tooltip, and closes after leaving both", async () => {
  vi.useFakeTimers();
  try {
    const { w, stage } = fixture();
    await stage.trigger("pointermove", { clientX: 300 });
    await w.get(".pnl-profit-figure").trigger("pointerleave");
    expect(w.find("[data-trend-tooltip]").exists()).toBe(true);
    await w.get("[data-trend-tooltip]").trigger("pointerenter");
    await vi.advanceTimersByTimeAsync(250);
    expect(w.find("[data-trend-tooltip]").exists()).toBe(true);
    await w.get("[data-trend-tooltip]").trigger("pointerleave");
    await vi.advanceTimersByTimeAsync(250);
    expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
    w.unmount();
  } finally {
    vi.useRealTimers();
  }
});

it("switches between lifetime cumulative profit and changes after the first selected day's close", async () => {
  const { w, stage } = fixture();
  await w.get('[data-series-toggle="assets"]').trigger("click");
  await w.setProps({
    days: [
      {
        ...days[0],
        profit: "100.25",
        cumulativeProfit: "500.25",
        assets: "10500.25",
      },
      {
        ...days[1],
        profit: "-30.10",
        cumulativeProfit: "470.15",
        assets: "11470.15",
      },
      {
        ...days[2],
        profit: "20.00",
        cumulativeProfit: "490.15",
        assets: "11490.15",
      },
    ],
  });
  await stage.trigger("keydown", { key: "Home" });
  expect(w.get("[data-period-profit]").text()).toContain("500.25");
  expect(w.get("[data-trend-tooltip]").text()).toContain("累计盈亏");
  await w.get('[data-profit-mode="interval"]').trigger("click");
  await stage.trigger("keydown", { key: "Home" });
  expect(w.get("[data-period-profit]").text()).toContain("0.00");
  await stage.trigger("keydown", { key: "End" });
  expect(w.get("[data-period-profit]").text()).toContain("-10.10");
  expect(w.get("[data-book-assets]").text()).toContain("11490.15");
  expect(w.get("[data-trend-tooltip]").text()).toContain("10500.25");
  expect(w.get("[data-trend-tooltip]").text()).toContain("首日日终");
  await w.get('[data-profit-mode="cumulative"]').trigger("click");
  await stage.trigger("keydown", { key: "End" });
  expect(w.get("[data-period-profit]").text()).toContain("490.15");
  w.unmount();
});
it("does not invent an interval baseline when the first closing value is unknown", async () => {
  const { w, stage } = fixture();
  await w.setProps({
    days: [
      { ...days[0], profit: null, cumulativeProfit: null },
      { ...days[1], profit: "-30.10", cumulativeProfit: null },
      { ...days[2], profit: "20.00", cumulativeProfit: null },
    ],
  });
  await stage.trigger("keydown", { key: "End" });
  expect(w.get("[data-period-profit]").text()).toContain("数据不足");
  await w.get('[data-profit-mode="interval"]').trigger("click");
  await stage.trigger("keydown", { key: "End" });
  expect(w.get("[data-period-profit]").text()).toContain("数据不足");
  w.unmount();
});

it("keeps the last point selected while hovering its outer edge in the axis gutter", async () => {
  const { w, stage } = fixture();
  await stage.trigger("pointermove", { clientX: 499 });
  await w.get(".pnl-profit-figure").trigger("pointermove", { clientX: 501 });
  expect(w.get("[data-profit-date]").text()).toBe(days[2].date);
  expect(w.find("[data-trend-tooltip]").exists()).toBe(true);
  w.unmount();
});
it("retains the hovered date while crossing the chart into its detail panel", async () => {
  vi.useFakeTimers();
  try {
    const { w, stage } = fixture();
    await stage.trigger("pointermove", { clientX: 100, pointerType: "mouse" });
    await stage.trigger("pointermove", { clientX: 450, pointerType: "mouse" });
    await w.get(".pnl-profit-figure").trigger("pointerleave");
    await w.get("[data-trend-tooltip]").trigger("pointerenter");
    await vi.advanceTimersByTimeAsync(300);
    expect(w.get("[data-profit-date]").text()).toBe(days[0].date);
    w.unmount();
  } finally {
    vi.useRealTimers();
  }
});

it("retains the active date and refreshed values across live quote updates", async () => {
  const { w, stage } = fixture();
  await stage.trigger("pointermove", { clientX: 300, clientY: 80 });
  await w.setProps({
    days: days.map((day, i) => ({
      ...day,
      profit: i === 1 ? "-20.10" : day.profit,
    })),
  });
  expect(w.get("[data-profit-date]").text()).toBe(days[1].date);
  expect(w.get("[data-daily-profit]").text()).toContain("-20.10");
  expect(w.find("[data-profit-crosshair]").exists()).toBe(true);
  w.unmount();
});
it("positions the tooltip from mouse coordinates even within the same date", async () => {
  const { w, stage } = fixture();
  await stage.trigger("pointermove", { clientX: 250, clientY: 100 });
  const first = w.get("[data-trend-tooltip]").attributes("style");
  await stage.trigger("pointermove", { clientX: 260, clientY: 160 });
  expect(w.get("[data-trend-tooltip]").attributes("style")).not.toBe(first);
  w.unmount();
});

it.each([
  { kinds: ["withdraw"] as const, label: "出" },
  { kinds: ["deposit", "withdraw"] as const, label: "入/出" },
])("labels asset cash flows explicitly as $label", async ({ kinds, label }) => {
  const { w } = fixture();
  await w.get('[data-series-toggle="assets"]').trigger("click");
  await w.setProps({
    days: days.map((day) => ({ ...day, assets: "10000" })),
    cashEntries: kinds.map((kind, i) => ({
      id: String(i),
      kind,
      amount: "100",
      date: days[0].date,
      time: `${days[0].date}T01:00:00Z`,
      note: "",
    })),
  });
  expect(w.get("[data-transfer-marker]").text()).toBe(label);
  w.unmount();
});

it("toggles profit and assets independently from the legend, starting with profit only", async () => {
  const { w, stage } = fixture();
  await w.setProps({ days: days.map((day) => ({ ...day, assets: "10000" })) });
  expect(w.find("[data-profit-curve]").exists()).toBe(true);
  expect(w.find("[data-asset-curve]").exists()).toBe(false);
  await w.get('[data-series-toggle="assets"]').trigger("click");
  expect(w.find("[data-asset-curve]").exists()).toBe(true);
  await w.get('[data-series-toggle="profit"]').trigger("click");
  expect(w.find("[data-profit-curve]").exists()).toBe(false);
  expect(w.find(".pnl-profit-zero").exists()).toBe(false);
  await stage.trigger("keydown", { key: "End" });
  expect(w.find("[data-period-profit]").exists()).toBe(false);
  expect(w.get("[data-book-assets]").text()).toContain("10000.00");
  await w.get('[data-series-toggle="assets"]').trigger("click");
  await stage.trigger("pointermove", { clientX: 300, clientY: 80 });
  expect(w.find("[data-trend-tooltip]").exists()).toBe(false);
  expect(w.text()).toContain("点击图例");
  w.unmount();
});

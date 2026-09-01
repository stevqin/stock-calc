import { describe, expect, it } from "vitest";
import { draftRecord, insertRecord, manualAccount } from "./record";
import { replay } from "./ledger";
import {
  dailyPerformance,
  dailyReturnPercent,
  aggregateDailyReturnPercent,
  returnPercent,
  fiveDayChange,
  holdingPerformance,
  holdingTradingDays,
  securityContribution,
} from "./performance";
import type { ChartData } from "./chart";
import type { Quote } from "../quotes";

const date = "2026-08-28";
const quote: Quote = {
  market: "sh",
  code: "510300",
  name: "沪深300ETF",
  latest: "10.8",
  bid: "10.799",
  ask: "10.801",
  quoteTime: "20260828150000",
  fetchedAt: "2026-08-28T07:00:00Z",
  kind: "etf",
};
function bars(adjustment = "不复权"): ChartData {
  return {
    symbol: "sh510300",
    mode: adjustment === "不复权" ? "daily-raw" : "daily",
    adjustment,
    fetchedAt: quote.fetchedAt,
    sessions: [],
    bars: [
      "2026-08-21",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      date,
    ].map((d) => ({
      date: d,
      open: "10",
      close: d === date ? "10.8" : "10",
      high: "11",
      low: "9",
      volume: "1000",
    })),
  };
}
function account() {
  const a = manualAccount();
  a.feeConfirmed.etf = true;
  a.profiles.etf = {
    commissionWan: "1",
    minimum: "0",
    stampPercent: "0",
    transferPercent: "0",
  };
  insertRecord(a, {
    id: "opening",
    securityId: "sh510300",
    kind: "opening",
    quantity: "100",
    available: "100",
    price: "10",
    time: "2026-08-27T01:00:00.000Z",
    date: "2026-08-27",
  });
  return a;
}
describe("持仓与日收益", () => {
  it("累计收益贡献由历史已实现与剩余持仓浮盈亏组成，清仓后仍保留", () => {
    const a = account();
    let position = replay(a).positions.sh510300;
    expect(securityContribution(position, quote)).toMatchObject({
      realized: "0.00",
      holding: "80.00",
      total: "80.00",
    });
    insertRecord(
      a,
      draftRecord(
        a,
        "sh510300",
        "sell",
        "11",
        "100",
        "2026-08-28T01:30:00.000Z",
      ).entry,
    );
    position = replay(a).positions.sh510300;
    const cleared = securityContribution(position);
    expect(cleared).toMatchObject({
      realized: position.realized,
      holding: "0.00",
      total: position.realized,
    });
    expect(cleared!.total).not.toBeNull();
  });
  it("按实际日K计算当前轮次持仓交易日，同日清仓再买不重开轮次", () => {
    const a = account();
    expect(holdingTradingDays(a.entries, "sh510300", date, bars())).toBe(2);
    a.entries.push(
      {
        ...a.entries[0],
        id: "sell",
        kind: "sell",
        time: "2026-08-28T01:30:00.000Z",
        date,
        fees: undefined,
      },
      {
        ...a.entries[0],
        id: "buy",
        kind: "buy",
        time: "2026-08-28T02:00:00.000Z",
        date,
        fees: undefined,
      },
    );
    expect(holdingTradingDays(a.entries, "sh510300", date, bars())).toBe(2);
  });
  it("跨日清仓后重新买入开启新轮次，日K不足时不显示错误天数", () => {
    const a = account();
    a.entries.push(
      {
        ...a.entries[0],
        id: "sell",
        kind: "sell",
        time: "2026-08-28T01:30:00.000Z",
        date,
        fees: undefined,
      },
      {
        ...a.entries[0],
        id: "buy",
        kind: "buy",
        time: "2026-09-01T01:30:00.000Z",
        date: "2026-09-01",
        fees: undefined,
      },
    );
    const data = bars();
    data.bars.push({ ...data.bars.at(-1)!, date: "2026-09-01" });
    expect(holdingTradingDays(a.entries, "sh510300", "2026-09-01", data)).toBe(
      1,
    );
    data.bars = data.bars.slice(-1);
    expect(
      holdingTradingDays(account().entries, "sh510300", date, data),
    ).toBeNull();
    expect(holdingTradingDays(account().entries, "sh510300", date)).toBeNull();
  });
  it("汇总日收益率按总基数计算，不相加或平均各证券百分比", () => {
    const day = dailyPerformance(account(), "sh510300", date, quote, bars());
    expect(
      aggregateDailyReturnPercent([
        { ...day, startValue: "1000", profit: "100" },
        { ...day, startValue: "3000", profit: "150" },
      ]),
    ).toBe("6.25");
  });
  it("跨证券卖出回款抵扣买入投入后，再计算当日正向净投入", () => {
    const day = dailyPerformance(account(), "sh510300", date, quote, bars());
    expect(
      aggregateDailyReturnPercent([
        { ...day, startValue: "1000", buys: "0", sells: "1100", profit: "100" },
        { ...day, startValue: "0", buys: "1000", sells: "0", profit: "-10" },
      ]),
    ).toBe("9.00");
  });
  it("汇总中任一证券缺数据或日期不同均不显示比例，空账户不伪造零收益率", () => {
    const day = dailyPerformance(account(), "sh510300", date, quote, bars());
    expect(aggregateDailyReturnPercent([])).toBeNull();
    for (const invalid of [
      { ...day, profit: null },
      { ...day, startValue: null },
      { ...day, reason: "无报价" },
      { ...day, date: "2026-08-27" },
    ]) {
      expect(aggregateDailyReturnPercent([day, invalid])).toBeNull();
    }
  });
  it.each([
    ["500", "3800", "13.16"],
    ["-20", "1000", "-2.00"],
    ["0", "1000", "0.00"],
    ["10", "0", null],
    ["10", "-100", null],
    [null, "1000", null],
    ["10", null, null],
  ])("收益%s/净投入%s的收益率为%s", (profit, base, expected) => {
    expect(returnPercent(profit, base)).toBe(expected);
  });
  it.each([
    ["1000", "0", "0", "10", "1.00"],
    ["1000", "500", "200", "13", "1.00"],
    ["1000", "200", "500", "10", "1.00"],
    ["0", "1000", "0", "-10", "-1.00"],
    ["1000", "0", "1100", "100", "10.00"],
    ["0", "1000", "1100", "100", null],
    ["0", "0", "0", "0", null],
    ["1000", "0", "0", "0", "0.00"],
  ])(
    "日收益率基数（日初%s、买入%s、卖出%s、盈亏%s）",
    (startValue, buys, sells, profit, expected) => {
      const day = dailyPerformance(account(), "sh510300", date, quote, bars());
      expect(
        dailyReturnPercent({ ...day, startValue, buys, sells, profit }),
      ).toBe(expected);
    },
  );
  it("缺少日初基准、盈亏或存在无效原因时不输出收益率", () => {
    const day = dailyPerformance(account(), "sh510300", date, quote, bars());
    expect(dailyReturnPercent()).toBeNull();
    expect(dailyReturnPercent({ ...day, startValue: null })).toBeNull();
    expect(dailyReturnPercent({ ...day, profit: null })).toBeNull();
    expect(dailyReturnPercent({ ...day, reason: "缺少日初基准" })).toBeNull();
  });
  it("不等量先卖后买按实际现金收支核算，费用只扣一次", () => {
    const a = account();
    insertRecord(
      a,
      draftRecord(a, "sh510300", "sell", "11", "40", "2026-08-28T01:30:00.000Z")
        .entry,
    );
    insertRecord(
      a,
      draftRecord(
        a,
        "sh510300",
        "buy",
        "10.5",
        "20",
        "2026-08-28T02:00:00.000Z",
      ).entry,
    );
    const result = dailyPerformance(a, "sh510300", date, quote, bars());
    expect(result).toMatchObject({
      quantityStart: "100",
      startValue: "1000.00",
      endValue: "864.00",
      buys: "210.02",
      sells: "439.96",
      fees: "0.06",
      profit: "93.94",
      reason: "",
    });
    expect(dailyReturnPercent(result)).toBe("9.39");
    expect(
      holdingPerformance(replay(a).positions.sh510300, quote),
    ).toMatchObject({ marketValue: "864.00", cyclePnl: "93.94" });
  });
  it("前复权行情不能代替日收益的不复权基准", () => {
    for (const chart of [undefined, bars("前复权")]) {
      expect(
        dailyPerformance(account(), "sh510300", date, quote, chart),
      ).toMatchObject({ profit: null, reason: "待获取上一交易日不复权收盘价" });
    }
  });
  it("过期报价不计算为当天收益", () => {
    expect(
      dailyPerformance(
        account(),
        "sh510300",
        date,
        { ...quote, quoteTime: "20260827150000" },
        bars(),
      ).profit,
    ).toBeNull();
  });
  it("清仓后无现价也能核算当天收益", () => {
    const a = account();
    insertRecord(
      a,
      draftRecord(
        a,
        "sh510300",
        "sell",
        "11",
        "100",
        "2026-08-28T01:30:00.000Z",
      ).entry,
    );
    expect(
      dailyPerformance(a, "sh510300", date, undefined, bars()).profit,
    ).toBe("99.89");
  });
  it("当天期初快照不能伪造日初基准", () => {
    expect(
      dailyPerformance(
        account(),
        "sh510300",
        "2026-08-27",
        { ...quote, quoteTime: "20260827150000" },
        bars(),
      ).reason,
    ).toContain("期初快照");
  });
  it("5日涨跌幅使用前复权的五个完整价格间隔", () => {
    expect(fiveDayChange(quote, bars("前复权"))).toBe("8.00");
    expect(fiveDayChange(quote, bars())).toBeNull();
    const insufficient = bars("前复权");
    insufficient.bars = insufficient.bars.slice(1);
    expect(fiveDayChange(quote, insufficient)).toBeNull();
  });
});

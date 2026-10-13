import { describe, expect, it } from "vitest";
import type { Entry } from "./model";
import {
  analyzeDayTPerformance,
  analyzeTradeStages,
  analyzeUnmatchedDayBuys,
} from "./tradeStages";

function entry(
  id: string,
  kind: Entry["kind"],
  quantity: string,
  price: string,
  date: string,
  order: number,
): Entry {
  const amount = String(Number(quantity) * Number(price));
  return {
    id,
    securityId: "sh600000",
    kind,
    quantity,
    price,
    date,
    time: `${date}T0${order}:00:00.000Z`,
    ...(kind === "opening"
      ? {}
      : {
          fees: {
            amount,
            commission: "0",
            transfer: "0",
            stamp: "0",
            total: "0",
            cash: amount,
          },
        }),
  };
}

describe("持仓阶段与做T收益", () => {
  it("同日归零后买回仍是做T，只有日终归零才是真清仓", () => {
    const entries = [
      entry("open", "opening", "100", "10", "2026-08-25", 1),
      entry("t-sell", "sell", "100", "12", "2026-08-26", 1),
      entry("t-buy", "buy", "100", "11", "2026-08-26", 2),
      entry("close", "sell", "100", "13", "2026-08-27", 1),
    ];
    const result = analyzeTradeStages(entries, "sh600000", "13");
    expect(result.classifications).toMatchObject({
      open: { label: "建仓", trueClose: false },
      "t-sell": { label: "做T卖出", trueClose: false, tQuantity: "100" },
      "t-buy": { label: "做T买入", trueClose: false, tQuantity: "100" },
      close: { label: "真清仓", trueClose: true },
    });
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toMatchObject({
      start: "2026-08-25",
      end: "2026-08-27",
      status: "closed",
      profit: "400.00",
      returnRate: "19.05",
      tProfit: "100.00",
      tReturnRate: "9.09",
      tQuantity: "100",
      tDays: 1,
    });
  });

  it("汇总已结束与按最新价估值的进行中阶段，不直接平均收益率", () => {
    const entries = [
      entry("a", "buy", "100", "10", "2026-08-25", 1),
      entry("b", "sell", "100", "12", "2026-08-26", 1),
      entry("c", "buy", "200", "10", "2026-08-28", 1),
    ];
    const result = analyzeTradeStages(entries, "sh600000", "11");
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0]).toMatchObject({
      status: "closed",
      profit: "200.00",
      returnRate: "20.00",
    });
    expect(result.stages[1]).toMatchObject({
      status: "open",
      profit: "200.00",
      returnRate: "10.00",
    });
    expect(result.summary).toMatchObject({
      profit: "400.00",
      returnRate: "13.33",
      tProfit: "0.00",
      tReturnRate: null,
      tQuantity: "0",
      tDays: 0,
      closedStages: 1,
      totalStages: 2,
    });
  });

  it("部分配对明确标记，做T收益按成交现金单价计算", () => {
    const entries = [
      entry("open", "opening", "300", "10", "2026-08-25", 1),
      entry("buy", "buy", "200", "9", "2026-08-26", 1),
      entry("sell", "sell", "100", "10", "2026-08-26", 2),
    ];
    const result = analyzeTradeStages(entries, "sh600000", "10");
    expect(result.classifications.buy).toMatchObject({
      label: "买入·部分做T",
      tQuantity: "100",
    });
    expect(result.classifications.sell).toMatchObject({
      label: "做T卖出",
      tQuantity: "100",
    });
    expect(result.summary.tProfit).toBe("100.00");
    expect(result.summary.tReturnRate).toBe("11.11");
  });

  it("单独统计指定交易日的做T净收益、收益率和配对数量", () => {
    const buy = entry("buy", "buy", "200", "9", "2026-08-26", 1);
    buy.fees!.cash = "1810";
    const entries = [
      entry("open", "opening", "300", "10", "2026-08-25", 1),
      buy,
      entry("sell", "sell", "100", "10", "2026-08-26", 2),
      entry("old-buy", "buy", "100", "8", "2026-08-24", 1),
      entry("old-sell", "sell", "100", "9", "2026-08-24", 2),
    ];

    expect(analyzeDayTPerformance(entries, "sh600000", "2026-08-26")).toEqual({
      profit: "95.00",
      returnRate: "10.50",
      quantity: "100",
    });
    expect(analyzeDayTPerformance(entries, "sh600000", "2026-08-27")).toEqual({
      profit: "0.00",
      returnRate: null,
      quantity: "0",
    });
  });

  it("单独计算当日未配对买入的浮动收益并按数量分摊买入费用", () => {
    const buy = entry("buy", "buy", "200", "9", "2026-08-26", 1);
    buy.fees!.cash = "1810";
    const entries = [
      entry("open", "opening", "300", "10", "2026-08-25", 1),
      buy,
      entry("sell", "sell", "100", "10", "2026-08-26", 2),
    ];

    expect(
      analyzeUnmatchedDayBuys(entries, "sh600000", "2026-08-26", "10"),
    ).toEqual({
      quantity: "100",
      cost: "905.00",
      marketValue: "1000.00",
      profit: "95.00",
      returnRate: "10.50",
    });
  });

  it("当日买入全部完成做T时金额为零，缺少行情时未配对部分不伪造收益", () => {
    const matched = [
      entry("buy", "buy", "100", "9", "2026-08-26", 1),
      entry("sell", "sell", "100", "10", "2026-08-26", 2),
    ];
    expect(
      analyzeUnmatchedDayBuys(matched, "sh600000", "2026-08-26", "10"),
    ).toEqual({
      quantity: "0",
      cost: "0.00",
      marketValue: "0.00",
      profit: "0.00",
      returnRate: null,
    });
    expect(
      analyzeUnmatchedDayBuys(
        [entry("buy", "buy", "100", "9", "2026-08-26", 1)],
        "sh600000",
        "2026-08-26",
        null,
      ),
    ).toEqual({
      quantity: "100",
      cost: "900.00",
      marketValue: null,
      profit: null,
      returnRate: null,
    });
  });
});

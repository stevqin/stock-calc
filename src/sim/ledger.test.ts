import { describe, it, expect } from "vitest";
import {
  newAccount,
  replay,
  draftOrder,
  dayPair,
  validateAccount,
} from "./ledger";
import { estimatePlan, solvePlan, type PlanInput } from "./planner";
import { defaults } from "../core/calculator";
import {
  chartSeries,
  INTRADAY_TIMES,
  intradayAxisLabel,
  type ChartData,
} from "./chart";
import type { Account } from "./model";
const time = "2026-08-28T02:00:00.000Z";
function setup(t0 = false) {
  const a = newAccount();
  a.initialized = true;
  a.initialCash = "100000";
  a.profiles.etf = {
    commissionWan: "1",
    minimum: "0",
    stampPercent: "0",
    transferPercent: "0",
  };
  a.feeConfirmed = { stock: true, etf: true };
  if (t0) {
    a.securities[0].category = "cross-border";
    a.securities[0].settlement = "T+0";
  }
  return a;
}
function opening(a: Account, qty = "1000", available = qty) {
  a.entries.push({
    id: "opening",
    securityId: "sh510300",
    kind: "opening",
    quantity: qty,
    price: "10",
    available,
    time,
    date: "2026-08-28",
  });
}
function trade(
  a: Account,
  side: "buy" | "sell",
  price: string,
  qty: string,
  t = time,
) {
  a.entries.push(draftOrder(a, "sh510300", side, price, qty, t).entry);
}
describe("模拟交易账本", () => {
  it("ETF免5但不虚构费率，迁移股票设置", () => {
    const a = newAccount({
      profiles: { stock: { ...defaults.stock, commissionWan: "1.8" } },
    });
    expect(a.profiles.stock.commissionWan).toBe("1.8");
    expect(a.profiles.etf.minimum).toBe("0");
    expect(a.profiles.etf.commissionWan).toBe("");
    expect(a.initialized).toBe(false);
    expect(() => validateAccount(a)).not.toThrow();
  });
  it("期初成本是实物投入，不扣现金", () => {
    const a = setup();
    opening(a);
    const l = replay(a, "2026-08-28");
    expect(l.cash).toBe("100000.00");
    expect(l.capital).toBe("110000.00");
    expect(l.positions.sh510300.available).toBe("1000");
  });
  it("允许买300卖100，FIFO与配对收益各自正确", () => {
    const a = setup();
    opening(a);
    trade(a, "buy", "9", "300");
    trade(a, "sell", "9.1", "100");
    const l = replay(a, "2026-08-28");
    expect(l.positions.sh510300.quantity).toBe("1200");
    expect(l.positions.sh510300.available).toBe("900");
    expect(l.realized).toBe("-90.09");
    expect(l.cash).toBe("98209.64");
    const pair = dayPair(a.entries, "sh510300", "2026-08-28");
    expect(pair.quantity).toBe("100");
    expect(pair.profit).toBe("9.82");
    expect(pair.unpairedBuy).toBe("200");
    expect(pair.cashFlow).toBe("-1790.36");
  });
  it("先卖后买可配对但不允许凭空卖空", () => {
    const a = setup();
    expect(() => trade(a, "sell", "10", "100")).toThrow("可卖数量不足");
    opening(a);
    trade(a, "sell", "10", "300");
    trade(a, "buy", "9", "100");
    const p = dayPair(a.entries, "sh510300", "2026-08-28");
    expect(p.unpairedSell).toBe("200");
    expect(p.profit).toBe("99.81");
  });
  it("T+1新买份额当日锁定，次日解锁", () => {
    const a = setup();
    trade(a, "buy", "10", "100");
    expect(() => trade(a, "sell", "10", "100")).toThrow("可卖数量不足");
    expect(replay(a, "2026-08-29").positions.sh510300.available).toBe("100");
  });
  it("确认T+0品种可当日往返", () => {
    const a = setup(true);
    trade(a, "buy", "10", "100");
    trade(a, "sell", "10.1", "100");
    expect(replay(a).realized).toBe("9.80");
  });
  it("资金不足、未初始化、未确认费率都拒绝成交", () => {
    const a = setup();
    a.initialCash = "1";
    expect(() => trade(a, "buy", "10", "100")).toThrow("资金不足");
    a.initialized = false;
    expect(() => trade(a, "buy", "10", "100")).toThrow("初始化");
    a.initialized = true;
    a.feeConfirmed.etf = false;
    expect(() => trade(a, "buy", "10", "100")).toThrow("实际佣金");
  });
  it("不同费率分别保存，历史费用不受后续修改影响", () => {
    const a = setup();
    trade(a, "buy", "10", "100");
    a.profiles.etf.commissionWan = "3";
    trade(a, "buy", "10", "100");
    expect(a.entries[0].fees?.commission).toBe("0.10");
    expect(a.entries[1].fees?.commission).toBe("0.30");
    expect(() => validateAccount(a)).not.toThrow();
  });
  it("期初持仓只允许一次，且同毫秒后续成交不误拒绝", () => {
    const a = setup();
    opening(a);
    trade(a, "buy", "10", "100");
    expect(() => replay(a)).not.toThrow();
    a.entries.push({ ...a.entries[0], id: "second-opening" });
    expect(() => replay(a)).toThrow("录入一次");
  });
  it("拒绝篡改金额、重复成交与不合法备份", () => {
    const a = setup();
    trade(a, "buy", "10", "100");
    a.entries[0].fees!.cash = "1";
    expect(() => validateAccount(a)).toThrow("校验失败");
    const b = setup();
    opening(b);
    b.entries.push({ ...b.entries[0] });
    expect(() => validateAccount(b)).toThrow("重复");
    expect(() => validateAccount({})).toThrow("备份格式");
  });
  it("同日卖光买回延续摊薄批次，隔日新开仓重置", () => {
    const a = setup(true);
    opening(a, "100");
    trade(a, "sell", "12", "100");
    trade(a, "buy", "10", "100");
    expect(replay(a).positions.sh510300.dilutedCost).toBe("8.0022");
    trade(a, "sell", "10", "100");
    trade(a, "buy", "9", "100", "2026-08-29T02:00:00.000Z");
    expect(replay(a).positions.sh510300.dilutedCost).toBe("9.0009");
  });
  it("摊薄成本可以负数", () => {
    const a = setup();
    opening(a, "200");
    trade(a, "sell", "30", "100");
    expect(
      new Number(replay(a).positions.sh510300.dilutedCost).valueOf(),
    ).toBeLessThan(0);
  });
  it("未确认回转规则禁止交易，证券类型不能冒充免税ETF", () => {
    const a = setup();
    a.securities[0].category = "unconfirmed";
    a.securities[0].settlement = "unconfirmed";
    expect(() => trade(a, "buy", "10", "100")).toThrow("回转");
    a.securities[0].asset = "stock";
    expect(() => validateAccount(a)).toThrow("品种不一致");
  });
  it.each(["", "0", "-1", "101", "1.5"])("拒绝非法数量%s", (q) => {
    const a = setup();
    expect(() => trade(a, "buy", "10", q)).toThrow();
  });
});
describe("不等量预演和保本搜索", () => {
  const p: PlanInput = {
    asset: "stock",
    buyPrice: "10",
    sellPrice: "10.11",
    buyQty: "100",
    sellQty: "100",
    fees: defaults.stock,
  };
  it("保留经修正的基础费用验收样例", () => {
    expect(estimatePlan(p).profit).toBe("0.47");
    expect(estimatePlan({ ...p, sellPrice: "10.10" }).profit).toBe("-0.53");
    expect(solvePlan(p, "sell", "0")).toBe("10.11");
  });
  it("不等量仅把配对部分当收益", () => {
    const r = estimatePlan({ ...p, buyQty: "300" });
    expect(r.matched).toBe("100");
    expect(r.change).toBe("200");
    expect(new Decimal(r.cashFlow).lt(0)).toBe(true);
    expect(new Decimal(r.profit).gt(0)).toBe(true);
  });
  it("目标价与前一档完整复核", () => {
    const v = solvePlan({ ...p, buyQty: "300" }, "sell", "20")!;
    expect(
      new Decimal(
        estimatePlan({ ...p, buyQty: "300", sellPrice: v }).exactProfit,
      ).gte(20),
    ).toBe(true);
    expect(
      new Decimal(
        estimatePlan({
          ...p,
          buyQty: "300",
          sellPrice: new Decimal(v).minus(".01").toString(),
        }).exactProfit,
      ).lt(20),
    ).toBe(true);
  });
  it("反向搜索最高回补价和无解", () => {
    const v = solvePlan(p, "buy", "10")!;
    expect(
      new Decimal(estimatePlan({ ...p, buyPrice: v }).exactProfit).gte(10),
    ).toBe(true);
    expect(
      new Decimal(
        estimatePlan({ ...p, buyPrice: new Decimal(v).plus(".01").toString() })
          .exactProfit,
      ).lt(10),
    ).toBe(true);
    expect(solvePlan({ ...p, sellPrice: "0.01" }, "buy", "100")).toBeNull();
  });
  it("ETF零佣金保本与严格盈利分开", () => {
    const e = {
      ...p,
      asset: "etf" as const,
      fees: {
        commissionWan: "0",
        minimum: "0",
        stampPercent: "0",
        transferPercent: "0",
      },
    };
    expect(solvePlan(e, "sell", "0")).toBe("10.000");
    expect(solvePlan(e, "sell", ".01")).toBe("10.001");
  });
});
import Decimal from "decimal.js";
it("五日图按天重置均价与分钟量，隔日不连线", () => {
  const d: ChartData = {
    symbol: "sh510300",
    mode: "five-day",
    adjustment: "不复权",
    fetchedAt: time,
    bars: [],
    sessions: [
      {
        date: "20260827",
        previousClose: "10",
        points: [
          { time: "0930", price: "10", volume: "2", amount: "2000" },
          { time: "0931", price: "11", volume: "3", amount: "3100" },
        ],
      },
      {
        date: "20260828",
        previousClose: "11",
        points: [{ time: "0930", price: "12", volume: "1", amount: "1200" }],
      },
    ],
  };
  const r = chartSeries(d);
  expect(r.labels).toHaveLength(INTRADAY_TIMES.length * 2 + 1);
  expect(r.labels[0]).toBe("08-27 09:30");
  expect(r.labels[120]).toBe("08-27 11:30");
  expect(r.labels[121]).toBe("08-27 13:00");
  expect(r.labels[241]).toBe("08-27 15:00");
  expect(r.labels[242]).toBe("");
  expect(r.labels.at(-1)).toBe("08-28 15:00");
  expect(r.volume.slice(0, 3)).toEqual([2, 1, null]);
  expect(r.volume[243]).toBe(1);
  expect(r.average[0]).toBe(10);
  expect(r.average[243]).toBe(12);
  expect(r.price.slice(0, 3)).toEqual([10, 11, null]);
  expect(r.price[243]).toBe(12);
  expect(r.baseline[241]).toBe(10);
  expect(r.baseline.at(-1)).toBe(11);
});

it("分时横轴固定展示完整交易时段边界，五日图按日展示首尾", () => {
  expect(intradayAxisLabel("08-31 09:30", "intraday")).toBe("09:30");
  expect(intradayAxisLabel("08-31 11:30", "intraday")).toBe("11:30\n");
  expect(intradayAxisLabel("08-31 13:00", "intraday")).toBe("\n13:00");
  expect(intradayAxisLabel("08-31 15:00", "intraday")).toBe("15:00");
  expect(intradayAxisLabel("08-31 10:30", "intraday")).toBe("");
  expect(intradayAxisLabel("08-31 09:30", "five-day")).toBe(
    "08-31\n09:30",
  );
  expect(intradayAxisLabel("08-31 15:00", "five-day")).toBe("15:00");
});

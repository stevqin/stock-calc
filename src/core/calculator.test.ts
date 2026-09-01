import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  calculateFee,
  calculateRoundTrip,
  defaults,
  holdingCost,
  solvePrice,
  type Asset,
  type Direction,
} from "./calculator";

const base = {
  asset: "stock" as const,
  quantity: "100",
  buyPrice: "10",
  sellPrice: "10.11",
  fees: defaults.stock,
};
describe("双边手续费与净利润", () => {
  it.each([
    ["10", "0.50"],
    ["99.99", "0.50"],
    ["100", "0.50"],
    ["102", "0.51"],
  ])(
    "ETF万0.5、每笔最低0.50元，价格%s的买卖佣金均为%s",
    (price, commission) => {
      for (const side of ["buy", "sell"] as const) {
        const fee = calculateFee({
          asset: "etf",
          price,
          quantity: "100",
          side,
          fees: {
            commissionWan: "0.5",
            minimum: "0.50",
            stampPercent: "0",
            transferPercent: "0",
          },
        });
        expect(fee.commission).toBe(commission);
      }
    },
  );
  it("复现小额股票示例", () => {
    const r = calculateRoundTrip(base);
    expect(r.net).toBe("0.47");
    expect(r.buy.cash).toBe("1005.01");
    expect(r.sell.cash).toBe("1005.48");
    expect(r.totalFees).toBe("10.53");
    expect(calculateRoundTrip({ ...base, sellPrice: "10.10" }).net).toBe(
      "-0.53",
    );
  });
  it.each([
    ["199.99", "5.00"],
    ["200", "5.00"],
    ["200.20", "5.01"],
    ["300", "7.50"],
  ])("佣金临界价格 %s", (price, commission) => {
    expect(calculateFee({ ...base, price, side: "buy" }).commission).toBe(
      commission,
    );
  });
  it("ETF独立费率与三位价格", () => {
    const r = calculateRoundTrip({
      ...base,
      asset: "etf",
      fees: defaults.etf,
      buyPrice: "4.644",
      sellPrice: "4.745",
    });
    expect(r.net).toBe("0.10");
    expect(r.sell.stamp).toBe("0.00");
    expect(r.buy.transfer).toBe("0.00");
  });
  it("零最低佣金并按分独立舍入", () => {
    const r = calculateFee({
      ...base,
      price: "0.25",
      side: "buy",
      fees: { ...defaults.stock, minimum: "0", commissionWan: "2" },
    });
    expect(r.commission).toBe("0.01");
  });
  it.each(["", "-1", "NaN", "Infinity", "0", "10.001"])(
    "拒绝非法价格 %s",
    (buyPrice) =>
      expect(() => calculateRoundTrip({ ...base, buyPrice })).toThrow(),
  );
  it.each(["", "0", "-100", "101", "100.5", "1e3"])(
    "拒绝非法数量 %s",
    (quantity) =>
      expect(() => calculateRoundTrip({ ...base, quantity })).toThrow(),
  );
  it("拒绝超范围费率", () =>
    expect(() =>
      calculateRoundTrip({
        ...base,
        fees: { ...defaults.stock, commissionWan: "31" },
      }),
    ).toThrow());
});
describe("离散档位反推", () => {
  it("股票保本档位与开始盈利", () => {
    expect(
      solvePrice({
        ...base,
        anchor: "10",
        direction: "buy-first",
        target: "0",
      }),
    ).toBe("10.11");
    const zero = { ...defaults.etf, commissionWan: "0", minimum: "0" };
    expect(
      solvePrice({
        ...base,
        fees: zero,
        anchor: "10",
        direction: "buy-first",
        target: "0",
      }),
    ).toBe("10.00");
    expect(
      solvePrice({
        ...base,
        fees: zero,
        anchor: "10",
        direction: "buy-first",
        target: "0.01",
      }),
    ).toBe("10.01");
  });
  for (const asset of ["stock", "etf"] as Asset[])
    for (const direction of ["buy-first", "sell-first"] as Direction[]) {
      it(`${asset} ${direction} 目标价及相邻档位满足最优边界`, () => {
        for (const quantity of ["100", "1000", "10000"])
          for (const target of ["0", "0.01", "50"]) {
            const args = {
              asset,
              fees: defaults[asset],
              quantity,
              direction,
              anchor: "20",
              target,
            };
            const solved = solvePrice(args)!;
            const run = (p: string) =>
              calculateRoundTrip({
                ...args,
                buyPrice: direction === "buy-first" ? "20" : p,
                sellPrice: direction === "buy-first" ? p : "20",
              });
            expect(new Decimal(run(solved).net).gte(target)).toBe(true);
            const adjacent = new Decimal(solved)
              .plus(
                new Decimal(asset === "stock" ? ".01" : ".001").mul(
                  direction === "buy-first" ? -1 : 1,
                ),
              )
              .toString();
            expect(new Decimal(run(adjacent).net).lt(target)).toBe(true);
          }
      });
    }
  it("回补金额不足以覆盖佣金时无解", () =>
    expect(
      solvePrice({
        ...base,
        direction: "sell-first",
        anchor: "0.01",
        target: "0",
      }),
    ).toBeNull());
  it("目标超出支持价格范围时无解", () =>
    expect(
      solvePrice({
        ...base,
        direction: "buy-first",
        anchor: "10",
        target: "1000000000000",
      }),
    ).toBeNull());
  it("不接受负目标或多余小数", () => {
    for (const target of ["-1", "0.001", ""])
      expect(() =>
        solvePrice({ ...base, direction: "buy-first", anchor: "10", target }),
      ).toThrow();
  });
});
describe("持仓成本", () => {
  it("盈利降低成本，亏损增加成本", () => {
    expect(holdingCost("1000", "10", "100", "50").after).toBe("9.9500");
    expect(holdingCost("1000", "10", "100", "-50").after).toBe("10.0500");
  });
  it("允许负成本，不允许超持仓或零持仓", () => {
    expect(holdingCost("100", "0.1", "100", "100").after).toBe("-0.9000");
    expect(() => holdingCost("0", "10", "100", "50")).toThrow();
    expect(() => holdingCost("100", "10", "200", "50")).toThrow();
  });
});

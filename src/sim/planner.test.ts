import { describe, expect, it } from "vitest";
import { estimatePlan, projectHolding } from "./planner";
const fees = {
  commissionWan: "0",
  minimum: "0",
  stampPercent: "0",
  transferPercent: "0",
};
describe("做T后的持仓快照", () => {
  it("等量做T以完整现金流降低本轮净投入，并按现价计算持仓收益", () => {
    const result = estimatePlan({
      asset: "etf",
      buyPrice: "9",
      sellPrice: "10",
      buyQty: "100",
      sellQty: "100",
      fees,
    });
    expect(projectHolding(result, "1000", "9500", "10")).toEqual({
      quantity: "1000",
      netInvestment: "9400.00",
      dilutedCost: "9.4000",
      marketValue: "10000.00",
      profit: "600.00",
      profitPercent: "6.38",
      error: "",
    });
  });
  it("不等量交易改变持仓数量，清仓及负持仓不伪造收益率", () => {
    const add = estimatePlan({
      asset: "stock",
      buyPrice: "10",
      sellPrice: "11",
      buyQty: "200",
      sellQty: "100",
      fees,
    });
    expect(projectHolding(add, "100", "900", "12")).toMatchObject({
      quantity: "200",
      dilutedCost: "9.0000",
      profit: "600.00",
    });
    const clear = estimatePlan({
      asset: "stock",
      buyPrice: "10",
      sellPrice: "11",
      buyQty: "100",
      sellQty: "200",
      fees,
    });
    expect(projectHolding(clear, "100", "900", "12")).toMatchObject({
      quantity: "0",
      profit: null,
      dilutedCost: null,
    });
    expect(projectHolding(clear, "0", "0", "12").error).toContain("持仓为负");
  });
  it("缺少参考价仍计算数量和摊薄成本", () => {
    const result = estimatePlan({
      asset: "etf",
      buyPrice: "9",
      sellPrice: "10",
      buyQty: "100",
      sellQty: "100",
      fees,
    });
    expect(projectHolding(result, "1000", "9500")).toMatchObject({
      dilutedCost: "9.4000",
      profit: null,
    });
  });
});

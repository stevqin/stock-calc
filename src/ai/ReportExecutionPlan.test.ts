import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import ReportExecutionPlan from "./ReportExecutionPlan.vue";
const waiting = {
  status: "wait",
  reason: "余额不足",
  invalidation: "未确认不执行",
  watchPrices: ["31.51"],
  steps: [],
};
function plan() {
  return {
    decision: "保留底仓，先卖后买",
    preferredScenario: "tRoundTrip",
    context: {
      targetSession: "今日剩余时段",
      reserveQuantity: "400",
      maxTQuantity: "200",
      cash: { balance: "433.15" },
      policy: { reservePercent: 50, tPercent: 25 },
      rules: { note: "整百股" },
      priceLevels: [],
    },
    scenarios: {
      tRoundTrip: {
        ...waiting,
        status: "conditional",
        steps: [
          {
            side: "sell",
            priceLow: "32.8",
            priceHigh: "32.8",
            quantity: "200",
            trigger: "反弹转弱",
            dependency: "none",
            remainingQuantity: "600",
            cashAfterMin: "6984.80",
            cashAfterMax: "6984.80",
            dilutedCostMin: "33.1326",
            dilutedCostMax: "33.1326",
          },
          {
            side: "buy",
            priceLow: "31.51",
            priceHigh: "31.51",
            quantity: "200",
            trigger: "回落企稳",
            dependency: "sellFilled",
          },
        ],
        effects: {
          netProfitMin: "244.59",
          netProfitMax: "244.59",
          totalFeeMin: "13.41",
          totalFeeMax: "13.41",
          remainingQuantity: "800",
          remainingAvailable: "600",
          dilutedCostMin: "32.7333",
          dilutedCostMax: "32.7333",
          cashAfterMin: "677.74",
          cashAfterMax: "677.74",
        },
      },
      riskReduction: waiting,
      entry: {
        ...waiting,
        entryFunding: {
          quantity: "100",
          requiredMin: "3156.03",
          requiredMax: "3156.03",
          gapMin: "2722.88",
          gapMax: "2722.88",
        },
      },
    },
  };
}
describe("量化条件预案", () => {
  it("展示价位股数、未买回结果和先成交再买回依赖", async () => {
    const w = mount(ReportExecutionPlan, { props: { plan: plan() } });
    expect(w.findAll("tbody tr")).toHaveLength(2);
    expect(w.text()).toContain("244.59");
    expect(w.text()).toContain("做 T 未完成");
    expect(w.text()).toContain("33.1326");
    expect(w.text()).toContain("先确认卖出成交");
    await w.findAll('[role="tab"]')[2].trigger("click");
    expect(w.findAll("tbody tr")).toHaveLength(0);
    expect(w.text()).toContain("2722.88");
    expect(w.findAll("details[open]")).toHaveLength(0);
  });
  it("未提供账户仍可展示等待，不能显示虚构余额", () => {
    const p = plan();
    p.preferredScenario = "wait";
    (p.context as any).cash = null;
    p.scenarios.tRoundTrip = { ...waiting } as any;
    const w = mount(ReportExecutionPlan, { props: { plan: p } });
    expect(w.text()).toContain("未提供");
    expect(w.findAll("tbody tr")).toHaveLength(0);
  });
});

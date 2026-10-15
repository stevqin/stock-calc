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

it("首屏固定买卖动作不随备选分支切换，显示价格编号和信号", async () => {
  const p: any = plan();
  p.context.position = { quantity: "800" };
  p.context.priceLevels = [
    { id: "L1", name: "昨收", price: "32.80" },
    { id: "L2", name: "近期低点", price: "31.51" },
  ];
  p.scenarios.tRoundTrip.steps[0].lowId = "L1";
  p.scenarios.tRoundTrip.steps[0].highId = "L1";
  p.scenarios.tRoundTrip.steps[1].lowId = "L2";
  p.scenarios.tRoundTrip.steps[1].highId = "L2";
  p.signalConditions = {
    stabilization: "L2上方连续两根5分钟K线不再创新低，再看收盘是否抬高。",
    weakening: "反弹触及L1后连续两根5分钟K线未创新高，且收盘回落。",
  };
  const w = mount(ReportExecutionPlan, { props: { plan: p } });
  expect(w.get("[data-primary-sell]").text()).toContain("200");
  expect(w.get("[data-primary-buy]").text()).toContain("31.51");
  expect(w.get("[data-primary-hold]").text()).toContain("400");
  expect(w.get(".ai-signal-conditions").text()).toContain("连续两根5分钟K线");
  expect(w.get(".ai-level-map").text()).toContain("L1");
  expect(w.get(".ai-level-map").text()).toContain("32.80");
  await w.findAll('[role="tab"]')[2].trigger("click");
  expect(w.get("[data-primary-sell]").text()).toContain("200");
  expect(w.get("[data-primary-buy]").text()).toContain("31.51");
});
it("等待分支首屏不把备选做T方案显示为首选交易", () => {
  const p: any = plan();
  p.preferredScenario = "wait";
  p.context.position = { quantity: "800" };
  const w = mount(ReportExecutionPlan, { props: { plan: p } });
  expect(w.get("[data-primary-sell]").text()).toContain("暂不卖出");
  expect(w.get("[data-primary-buy]").text()).toContain("暂不买入");
  expect(w.get("[data-primary-hold]").text()).toContain("800");
});

it("操作清单直接显示价格股数、执行与取消条件，其他内容默认折叠", () => {
  const p: any = plan();
  p.context.position = { quantity: "800" };
  p.scenarios.tRoundTrip.steps[0].lowId = "L1";
  p.scenarios.tRoundTrip.steps[0].highId = "L1";
  p.scenarios.tRoundTrip.steps[1].lowId = "L2";
  p.scenarios.tRoundTrip.steps[1].highId = "L2";
  p.scenarios.tRoundTrip.invalidation = "跌破31元取消买回";
  const w = mount(ReportExecutionPlan, { props: { plan: p } });
  const sheet = w.get('[aria-label="一眼看操作"]');
  expect(sheet.text()).toContain("反弹转弱");
  expect(sheet.text()).toContain("回落企稳");
  expect(sheet.text()).toContain("跌破31元取消买回");
  expect(sheet.text()).toContain("先确认卖出成交");
  expect(sheet.get("[data-primary-sell]").text()).toContain("L1");
  expect(sheet.get("[data-primary-buy]").text()).toContain("L2");
  expect(w.get("[data-plan-details]").element.tagName).toBe("DETAILS");
  expect(w.get("[data-plan-details]").attributes("open")).toBeUndefined();
  expect(
    w.findAll('[role="tab"]')[0].element.closest("details"),
  ).not.toBeNull();
  expect(w.get("[data-primary-hold]").text()).toContain("600");
});

it("等待时首屏给出首要原因，其余等待说明折叠", () => {
  const p: any = plan();
  p.preferredScenario = "wait";
  p.context.position = { quantity: "800" };
  p.decision = "报价已过期，请刷新行情后重新分析";
  p.context.tUnavailableReasons = [
    "报价已过期，请刷新行情后重新分析",
    "没有符合费用要求的组合",
  ];
  const w = mount(ReportExecutionPlan, { props: { plan: p } });
  const sheet = w.get('[aria-label="一眼看操作"]');
  expect(sheet.text()).toContain("报价已过期，请刷新行情后重新分析");
  expect(sheet.text()).not.toContain("没有符合费用要求的组合");
  expect(sheet.findAll("[data-order-row]")).toHaveLength(0);
  expect(w.get(".ai-wait-reasons").element.closest("details")).not.toBeNull();
});

it("首屏等待原因来自最终决定，不能用可执行备选方案理由代替", () => {
  const p: any = plan();
  p.preferredScenario = "wait";
  p.decision = "独立判断存在分歧，等待下一根K线确认后再评估";
  p.scenarios.tRoundTrip.reason = "价差足以覆盖费用，可以评估先卖后买";
  p.context.tUnavailableReasons = ["没有满足费用的做T组合"];
  const w = mount(ReportExecutionPlan, { props: { plan: p } });
  expect(w.get('[aria-label="一眼看操作"]').text()).toContain(p.decision);
  expect(w.get('[aria-label="一眼看操作"]').text()).not.toContain(
    p.scenarios.tRoundTrip.reason,
  );
});

it("首选动作直接显示企稳和转弱的具体确认标准", () => {
  const p: any = plan();
  p.signalConditions = {
    stabilization: "连续两根5分钟K线不再创新低",
    weakening: "连续两根5分钟K线未创新高且收盘回落",
  };
  const w = mount(ReportExecutionPlan, { props: { plan: p } });
  expect(w.get("[data-primary-sell]").text()).toContain(
    p.signalConditions.weakening,
  );
  expect(w.get("[data-primary-buy]").text()).toContain(
    p.signalConditions.stabilization,
  );
});

it("违规分支显示明确原因且不把原始订单放进可执行清单", async () => {
  const p: any = plan();
  p.scenarios.entry = {
    ...waiting,
    status: "notApplicable",
    unavailableReason: "加仓方案给了2笔买入，本程序目前只接受1笔；未修改股数",
    validationError: "executionPlan.scenarios.entry.steps",
  };
  p.warnings = [
    { scenario: "entry", message: p.scenarios.entry.unavailableReason },
  ];
  const w = mount(ReportExecutionPlan, { props: { plan: p } });
  expect(w.get("[data-branch-warnings]").text()).toContain("2笔");
  await w.findAll('[role="tab"]')[2].trigger("click");
  expect(w.get('[role="tabpanel"]').text()).toContain("方案不可用");
  expect(w.get('[role="tabpanel"]').text()).toContain("未修改股数");
});

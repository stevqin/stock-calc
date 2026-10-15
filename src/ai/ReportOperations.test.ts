import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import ReportOperations from "./ReportOperations.vue";
const claims = [
  "today",
  "week",
  "conservative",
  "shortTerm",
  "mediumLongTerm",
].map((operationType) => ({
  operationType,
  text: "等待确认",
  reason: "今日新增受T+1约束",
  status: "wait",
  action: "wait",
  horizon: "冻结时间窗口",
  trigger: "量价确认",
  invalidation: "报价过期",
  quantityBasis: "仅可卖底仓",
  cashBasis: "资金待核实",
  feeImpact: "费用资料不足",
  conflictsWith: [],
}));
describe("五类操作建议", () => {
  it("五类切换，只展示所选结论，依据默认折叠", async () => {
    const w = mount(ReportOperations, { props: { claims } });
    expect(w.findAll(".ai-v2-operation")).toHaveLength(1);
    expect(w.text()).toContain("本周操作");
    expect(w.text()).toContain("中长期");
    await w.findAll('[role="tab"]')[4].trigger("click");
    expect(w.find('[role="tabpanel"]').attributes("aria-label")).toBe("中长期");
    expect(w.text()).toContain("1～3个月");
    expect(w.text()).toContain("资金待核实");
    expect(w.text()).toContain("报价过期");
    expect(w.findAll("details[open]")).toHaveLength(0);
  });
});
it("操作建议默认显示明确条件和L价格对照", () => {
  const w = mount(ReportOperations, {
    props: {
      claims,
      priceLevels: [{ id: "L1", name: "昨收", price: "32.80" }],
      signalConditions: {
        stabilization: "L1上方连续两根5分钟K线不创新低。",
        weakening: "触及L1后连续两根5分钟K线未创新高。",
      },
    } as any,
  });
  expect(w.get(".ai-signal-conditions").text()).toContain("不创新低");
  expect(w.get(".ai-level-map").text()).toContain("32.80");
  expect(w.find(".ai-signal-conditions").element.closest("details")).toBeNull();
});

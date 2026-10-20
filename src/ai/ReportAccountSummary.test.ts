import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import ReportAccountSummary from "./ReportAccountSummary.vue";
describe("account summary for analysis", () => {
  it("shows quantities, cost and ledger once, with transactions folded", () => {
    const w = mount(ReportAccountSummary, {
      props: {
        position: {
          quantity: "800",
          available: "600",
          dilutedCost: "33.0390",
          averageCost: "34.5000",
          trades: [
            {
              id: "one",
              kind: "sell",
              quantity: "200",
              price: "32.80",
              time: "2026-10-19T02:00:00Z",
              fees: { total: "5.26" },
              note: "保留底仓",
            },
          ],
        },
        cash: {
          asOf: "2026-10-19T02:00:00Z",
          source: "localLedger",
          balance: "433.15",
          initialized: true,
          hasWarnings: false,
        },
        unit: "股",
      },
    });
    expect(w.findAll(".ai-account-value")).toHaveLength(4);
    expect(w.text()).toContain("800");
    expect(w.text()).toContain("600");
    expect(w.text()).toContain("433.15");
    expect(w.text()).toContain("可用于买入的现金");
    expect(w.text()).toContain("本轮回本参考价");
    expect(w.find("details").attributes("open")).toBeUndefined();
    expect(w.text()).toContain("卖出 200 股");
    expect(w.text()).toContain("32.80");
  });
  it("does not turn absent account data into zero holdings or zero cash", () => {
    const w = mount(ReportAccountSummary, { props: { unit: "股" } });
    expect(w.text()).toContain("未提供");
    expect(w.text()).not.toContain("0.00");
  });
});

it("labels recovered capital without displaying a negative buy or break-even target", () => {
  const w = mount(ReportAccountSummary, {
    props: {
      position: { quantity: "100", available: "100", dilutedCost: "-1.0000" },
      unit: "股",
    },
  });
  expect(w.text()).toContain("本金已收回");
  expect(w.find(".ai-account-grid").text()).not.toContain("-1.0000");
  w.unmount();
});

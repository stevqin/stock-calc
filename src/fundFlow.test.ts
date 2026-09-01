import { describe, expect, it } from "vitest";
import {
  flowAmount,
  flowHint,
  formatFlow,
  validFundFlow,
  type FundFlow,
} from "./fundFlow";
const flow: FundFlow = {
  market: "sh",
  code: "510300",
  mainNet: "-12345678.90",
  quoteTime: "20260831150000",
  fetchedAt: "2026-08-31T07:00:00Z",
  source: "东方财富",
};
describe("资金流独立口径", () => {
  it("金额有正负和零，缺失不是零", () => {
    expect(formatFlow(flow.mainNet)).toBe("-1234.57万");
    expect(formatFlow("123456789")).toBe("+1.23亿");
    expect(flowAmount({ ...flow, mainNet: "0.00" })).toBe("0.00");
    expect(flowAmount()).toBeNull();
  });
  it("校验字段，旧交易日不得混入最新报价", () => {
    expect(validFundFlow(flow)).toBe(true);
    expect(flowAmount({ ...flow, mainNet: "-" })).toBeNull();
    expect(flowAmount(flow, "20260901100000")).toBeNull();
    expect(flowAmount(flow, "20260831151000")).toBe(flow.mainNet);
  });
  it("旧数据明确显示数据时间、来源和失败原因", () => {
    const hint = flowHint(flow, "网络超时");
    expect(hint).toContain("2026-08-31 15:00:00");
    expect(hint).toContain("保留旧数据");
    expect(hint).toContain("非ETF申赎");
    expect(hint).toContain("网络超时");
  });
});

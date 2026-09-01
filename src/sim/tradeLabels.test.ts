import { describe, expect, it } from "vitest";
import { tradeLabels } from "./tradeLabels";
import type { Entry } from "./model";

function entry(
  id: string,
  kind: Entry["kind"],
  quantity: string,
  day = "25",
  securityId = "sh510300",
): Entry {
  return {
    id,
    kind,
    quantity,
    securityId,
    price: "10",
    time: `2026-08-${day}T01:00:00.000Z`,
    date: `2026-08-${day}`,
  };
}
describe("交易记录显示标签", () => {
  it("期初快照显示建仓，只有卖完剩余数量才显示清仓", () => {
    expect(
      tradeLabels([
        entry("a", "opening", "200"),
        entry("b", "sell", "100", "26"),
        entry("c", "sell", "100", "27"),
      ]),
    ).toEqual({ a: "建仓", b: "卖出", c: "清仓" });
  });
  it("最近一笔卖出仍有持仓时不能标清仓，首次买入仍为买入", () => {
    expect(
      tradeLabels([entry("a", "buy", "300"), entry("b", "sell", "100", "26")]),
    ).toEqual({ a: "买入", b: "卖出" });
  });
  it("同日清仓再买回仍标记那笔清仓，且不修改底层记录或轮次", () => {
    const rows = [
      entry("a", "buy", "100"),
      entry("b", "sell", "100"),
      entry("c", "buy", "200"),
      entry("d", "sell", "200", "26"),
    ];
    const snapshot = structuredClone(rows);
    expect(tradeLabels(rows)).toEqual({
      a: "买入",
      b: "清仓",
      c: "买入",
      d: "清仓",
    });
    expect(rows).toEqual(snapshot);
  });
  it("跨证券独立计算，数量按数值比较", () => {
    expect(
      tradeLabels([
        entry("a", "opening", "100.0"),
        entry("b", "buy", "200", "25", "sz159915"),
        entry("c", "sell", "100", "26"),
      ]),
    ).toEqual({ a: "建仓", b: "买入", c: "清仓" });
  });
  it("按时间核算不依赖列表倒序，并在修改或删除后重新判定", () => {
    const a = entry("a", "buy", "200"),
      b = entry("b", "sell", "100", "26"),
      c = entry("c", "sell", "100", "27");
    expect(tradeLabels([c, b, a]).c).toBe("清仓");
    expect(tradeLabels([a, c]).c).toBe("卖出");
    expect(tradeLabels([{ ...a, quantity: "300" }, b, c]).c).toBe("卖出");
    expect(tradeLabels([])).toEqual({});
  });
});

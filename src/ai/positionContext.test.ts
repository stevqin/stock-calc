import { describe, it, expect } from "vitest";
import { newAccount, replay } from "../sim/ledger";
import { defaults } from "../core/calculator";
import { recordFees } from "../sim/recordMath";
import { positionContext } from "./positionContext";
describe("AI持仓资料边界", () => {
  const asOf = "2026-10-13T06:00:00.000Z";
  function account() {
    const a = newAccount();
    a.initialized = true;
    a.initialCash = "100000";
    a.entries = [
      {
        id: "old",
        securityId: "sh510300",
        kind: "opening",
        quantity: "100",
        price: "10",
        available: "100",
        time: "2026-10-09T01:00:00.000Z",
        date: "2026-10-09",
      },
      {
        id: "close",
        securityId: "sh510300",
        kind: "sell",
        quantity: "100",
        price: "11",
        time: "2026-10-09T02:00:00.000Z",
        date: "2026-10-09",
      },
      {
        id: "open",
        securityId: "sh510300",
        kind: "buy",
        quantity: "100",
        price: "12",
        available: "100",
        time: "2026-10-12T01:00:00.000Z",
        date: "2026-10-12",
      },
    ];
    a.profiles.etf = { ...defaults.etf };
    a.entries[1].profile = { ...defaults.etf };
    a.entries[1].fees = recordFees("sell", "11", "100", defaults.etf);
    a.entries[2].profile = { ...defaults.etf };
    a.entries[2].fees = recordFees("buy", "12", "100", defaults.etf);
    return a;
  }
  it("只发送当前证券本轮记录，不包含现金和历史已闭合轮次", () => {
    const a = account();
    const p = positionContext(
      a,
      "sh510300",
      replay(a, "2026-10-13").positions.sh510300,
      asOf,
    )!;
    expect(p.trades.map((e) => e.id)).toEqual(["open"]);
    expect(p.quantity).toBe("100");
    expect(p.available).toBe("100");
    expect(JSON.stringify(p)).not.toContain("initialCash");
    expect(positionContext(a, "sz000001", undefined, asOf)).toBeNull();
  });
  it("同日清仓再买仍属于本轮，保留全部交易及可卖数量", () => {
    const a = account();
    a.entries[2].time = "2026-10-09T03:00:00.000Z";
    a.entries[2].date = "2026-10-09";
    const p = positionContext(
      a,
      "sh510300",
      replay(a, "2026-10-13").positions.sh510300,
      asOf,
    )!;
    expect(p.trades.map((e) => e.id)).toEqual(["old", "close", "open"]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { newAccount } from "../sim/ledger";
import { recordFees } from "../sim/recordMath";
import { defaults } from "../core/calculator";
import { accountContext } from "./accountContext";
describe("AI账户冻结", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it("按时间点比较带时区成交，并排除未来资金流水", () => {
    const a = newAccount();
    a.schemaVersion = 3;
    a.initialized = true;
    a.initialCash = "1000";
    a.feeConfirmed.etf = true;
    a.entries = [
      {
        id: "o",
        securityId: "sh510300",
        kind: "opening",
        quantity: "100",
        available: "100",
        price: "5",
        time: "2026-10-14T09:00:00+08:00",
        date: "2026-10-14",
      },
    ];
    a.cashEntries = [
      {
        id: "in",
        kind: "deposit",
        amount: "100",
        note: "",
        time: "2026-10-14T10:00:00+08:00",
        date: "2026-10-14",
      },
      {
        id: "futureCash",
        kind: "deposit",
        amount: "200",
        note: "",
        time: "2026-10-14T16:00:00+08:00",
        date: "2026-10-14",
      },
    ];
    const c = accountContext(a, "sh510300", "2026-10-14T06:00:00Z");
    expect(c.position?.trades).toHaveLength(1);
    expect(c.cash.balance).toBe("1100.00");
  });
  it("负余额标记资金异常，但不混入其他证券交易明细", () => {
    const a = newAccount();
    a.schemaVersion = 3;
    a.initialized = true;
    a.initialCash = "0";
    a.cashEntries = [
      {
        id: "out",
        kind: "withdraw",
        amount: "100",
        note: "",
        time: "2026-10-14T01:00:00Z",
        date: "2026-10-14",
      },
    ];
    const c = accountContext(a, "sh510300", "2026-10-14T06:00:00Z");
    expect(c.cash.balance).toBe("-100.00");
    expect(c.cash.hasWarnings).toBe(true);
    expect(JSON.stringify(c)).not.toContain("cashEntries");
  });
  it("持仓、本轮成交和资金忽略截止之后的事件，并保留T+1约束", () => {
    const a = newAccount();
    a.initialized = true;
    a.initialCash = "10000";
    a.profiles.etf = { ...defaults.etf };
    a.feeConfirmed.etf = true;
    a.entries = [
      {
        id: "b1",
        securityId: "sh510300",
        kind: "buy",
        quantity: "100",
        price: "10",
        time: "2026-10-14T01:00:00.000Z",
        date: "2026-10-14",
        profile: defaults.etf,
        fees: recordFees("buy", "10", "100", defaults.etf),
      },
      {
        id: "future",
        securityId: "sh510300",
        kind: "buy",
        quantity: "100",
        price: "10",
        time: "2026-10-14T08:00:00.000Z",
        date: "2026-10-14",
        profile: defaults.etf,
        fees: recordFees("buy", "10", "100", defaults.etf),
      },
    ];
    const c = accountContext(a, "sh510300", "2026-10-14T06:00:00.000Z");
    expect(c.position?.quantity).toBe("100");
    expect(c.position?.available).toBe("0");
    expect(c.position?.trades.map((t) => t.id)).toEqual(["b1"]);
    expect(c.cash.balance).toBe("8995.00");
    expect(c.cash.asOf).toBe(c.position?.asOf);
    expect(JSON.stringify(c.cash)).not.toContain("entries");
  });
  it("未持仓也提供本机余额，未初始化和负余额保留质量信息", () => {
    const a = newAccount();
    const c = accountContext(a, "sh510300", "2026-10-14T06:00:00Z");
    expect(c.position).toBeNull();
    expect(c.cash.source).toBe("localLedger");
    expect(c.cash.initialized).toBe(false);
  });
});

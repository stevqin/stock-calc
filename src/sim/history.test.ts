import { describe, expect, it } from "vitest";
import { editTrade, editCash, deleteHistory, type TradeEdit } from "./history";
import {
  manualAccount,
  draftRecord,
  draftCash,
  insertRecord,
  upgradeAccount,
} from "./record";
import { replay, newAccount } from "./ledger";
import type { Entry } from "./model";
const t1 = "2026-08-25T01:00:00.000Z",
  t2 = "2026-08-26T02:00:00.000Z";
function setup() {
  const a = manualAccount();
  a.profiles.etf = {
    commissionWan: "1",
    minimum: "0",
    stampPercent: "0",
    transferPercent: "0",
  };
  a.feeConfirmed.etf = true;
  a.cashEntries!.push(draftCash("deposit", "2000", t1));
  insertRecord(a, draftRecord(a, "sh510300", "buy", "10", "200", t1).entry);
  insertRecord(a, draftRecord(a, "sh510300", "sell", "11", "100", t2).entry);
  return a;
}
function form(e: Entry, patch: Partial<TradeEdit> = {}): TradeEdit {
  return {
    kind: e.kind,
    price: e.price,
    quantity: e.quantity,
    available: e.available,
    time: e.time,
    note: e.note ?? "",
    feeSource: e.feeSource ?? "estimated",
    actualFees: {
      commission: e.fees?.commission ?? "0",
      stamp: e.fees?.stamp ?? "0",
      transfer: e.fees?.transfer ?? "0",
    },
    ...patch,
  };
}
describe("历史记录修改删除", () => {
  it("修改早期买价重算后续FIFO，沿用历史费率且源账本不变", () => {
    const a = setup();
    const original = JSON.stringify(a);
    a.profiles.etf.minimum = "5";
    const next = editTrade(
      a,
      a.entries[0].id,
      form(a.entries[0], { price: "9" }),
    );
    expect(next.entries[0].id).toBe(a.entries[0].id);
    expect(next.entries[0].fees?.commission).toBe("0.18");
    expect(next.entries[1]).toEqual(a.entries[1]);
    expect(replay(next).realized).toBe("199.80");
    expect(replay(next).positions.sh510300.cost).toBe("900.09");
    a.profiles.etf.minimum = "0";
    expect(JSON.stringify(a)).toBe(original);
  });
  it("改实际费用后重算成本，未确认当前费率也可保存", () => {
    const a = setup();
    a.feeConfirmed.etf = false;
    const next = editTrade(
      a,
      a.entries[0].id,
      form(a.entries[0], {
        feeSource: "actual",
        actualFees: { commission: "2", stamp: "0", transfer: "0" },
      }),
    );
    expect(next.entries[0].fees?.cash).toBe("2002.00");
    expect(replay(next).realized).toBe("98.89");
  });
  it("仅修改备注不改变费用和同时间FIFO顺序", () => {
    const a = setup();
    a.entries[1].time = t1;
    a.entries[1].date = a.entries[0].date;
    const next = editTrade(
      a,
      a.entries[0].id,
      form(a.entries[0], { note: "核对完成" }),
    );
    expect(next.entries.map((e) => e.id)).toEqual(a.entries.map((e) => e.id));
    expect(next.entries[0].fees).toEqual(a.entries[0].fees);
    expect(replay(next)).toEqual(replay(a));
  });
  it.each(["delete", "quantity", "time", "direction"])(
    "%s导致后续卖出缺仓则拒绝，源账本不变",
    (action) => {
      const a = setup(),
        original = JSON.stringify(a),
        e = a.entries[0];
      expect(() =>
        action === "delete"
          ? deleteHistory(a, "trade", e.id)
          : editTrade(
              a,
              e.id,
              form(
                e,
                action === "quantity"
                  ? { quantity: "99" }
                  : action === "time"
                    ? { time: "2026-08-27T01:00:00.000Z" }
                    : { kind: "sell" },
              ),
            ),
      ).toThrow("历史持仓不足");
      expect(JSON.stringify(a)).toBe(original);
    },
  );
  it("删除末笔卖出恢复持仓、成本及收益", () => {
    const a = setup();
    const next = deleteHistory(a, "trade", a.entries[1].id);
    expect(replay(next).positions.sh510300.quantity).toBe("200");
    expect(replay(next).realized).toBe("0.00");
    expect(replay(next).cash).toBe("-0.20");
    expect(a.entries).toHaveLength(2);
  });
  it("修改无依赖成交的时间后正确排序", () => {
    const a = setup();
    insertRecord(a, draftRecord(a, "sh510300", "buy", "9", "100", t2).entry);
    const e = a.entries[2];
    const next = editTrade(
      a,
      e.id,
      form(e, { time: "2026-08-24T01:00:00.000Z" }),
    );
    expect(next.entries[0].id).toBe(e.id);
    expect(next.entries[0].date).toBe("2026-08-24");
    expect(replay(next).realized).toBe("199.80");
  });
  it("修改及删除期初持仓，依赖卖出受到保护", () => {
    const a = setup();
    a.entries[0] = {
      id: "opening",
      securityId: "sh510300",
      kind: "opening",
      quantity: "200",
      price: "10",
      available: "200",
      time: t1,
      date: "2026-08-25",
    };
    const next = editTrade(
      a,
      "opening",
      form(a.entries[0], { price: "9", quantity: "300", available: "250" }),
    );
    expect(replay(next).capital).toBe("4700.00");
    expect(replay(next).realized).toBe("199.89");
    expect(() => deleteHistory(a, "trade", "opening")).toThrow("历史持仓不足");
    const onlyOpening = deleteHistory(a, "trade", a.entries[1].id);
    expect(deleteHistory(onlyOpening, "trade", "opening").entries).toHaveLength(
      0,
    );
    expect(() =>
      editTrade(a, "opening", form(a.entries[0], { available: "201" })),
    ).toThrow();
  });
  it("修改资金类型区分本金与利息，删除利息不影响股票成本", () => {
    const a = setup(),
      cash = a.cashEntries![0];
    const next = editCash(a, cash.id, {
      ...cash,
      kind: "repo-interest",
      amount: "3.52",
    });
    expect(replay(next).capital).toBe("0.00");
    expect(replay(next).income).toBe("3.52");
    const removed = deleteHistory(next, "cash", cash.id);
    expect(replay(removed).income).toBe("0.00");
    expect(replay(removed).positions).toEqual(replay(a).positions);
    expect(replay(removed).cashWarnings).toBeGreaterThan(0);
  });
  it("旧版迁移余额允许修改及删除，不重新生成", () => {
    const old = newAccount();
    old.initialized = true;
    old.initialCash = "100000";
    const a = upgradeAccount(old),
      cash = a.cashEntries![0];
    const next = editCash(a, cash.id, { ...cash, amount: "1200" });
    expect(replay(next).cash).toBe("1200.00");
    expect(
      replay(upgradeAccount(deleteHistory(next, "cash", cash.id))).cash,
    ).toBe("0.00");
  });
  it("非法输入与不存在的记录拒绝提交", () => {
    const a = setup(),
      cash = a.cashEntries![0],
      e = a.entries[0];
    for (const amount of ["", "-1", "0", "0.001"])
      expect(() => editCash(a, cash.id, { ...cash, amount })).toThrow();
    expect(() =>
      editCash(a, cash.id, { ...cash, time: "2099-01-01T00:00:00.000Z" }),
    ).toThrow();
    expect(() => editTrade(a, e.id, form(e, { quantity: "0" }))).toThrow();
    expect(() => editTrade(a, e.id, form(e, { kind: "opening" }))).toThrow();
    expect(() =>
      editCash(a, cash.id, { ...cash, kind: "legacy-balance" }),
    ).toThrow();
    expect(() => deleteHistory(a, "cash", "missing")).toThrow("不存在");
    expect(() => editTrade(a, "missing", form(e))).toThrow("不存在");
    expect(() => editCash(a, "missing", cash)).toThrow("不存在");
  });
});

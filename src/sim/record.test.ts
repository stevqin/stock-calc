import { describe, it, expect } from "vitest";
import {
  manualAccount,
  upgradeAccount,
  draftRecord,
  draftCash,
  insertRecord,
  recordFees,
} from "./record";
import { newAccount, replay, validateAccount, dayPair } from "./ledger";
import { fromShanghaiInput, type Account } from "./model";
const t1 = "2026-08-25T01:00:00.000Z",
  t2 = "2026-08-26T02:00:00.000Z",
  t3 = "2026-08-27T02:00:00.000Z";
function setup() {
  const a = manualAccount();
  a.feeConfirmed.etf = true;
  a.profiles.etf = {
    commissionWan: "1",
    minimum: "0",
    stampPercent: "0",
    transferPercent: "0",
  };
  return a;
}
function cash(
  a: Account,
  kind: Parameters<typeof draftCash>[0],
  v: string,
  t = t1,
) {
  a.cashEntries!.push(draftCash(kind, v, t));
}
function trade(a: Account, side: "buy" | "sell", p: string, q: string, t = t2) {
  insertRecord(a, draftRecord(a, "sh510300", side, p, q, t).entry);
}
describe("手工账本", () => {
  it("已有成交仍可补录更早的期初持仓", () => {
    const a = setup();
    trade(a, "buy", "10", "100", t2);
    insertRecord(a, {
      id: "opening",
      securityId: "sh510300",
      kind: "opening",
      quantity: "200",
      price: "9",
      available: "200",
      time: t1,
      date: "2026-08-25",
    });
    expect(replay(a).positions.sh510300.quantity).toBe("300");
    expect(() => validateAccount(a)).not.toThrow();
  });
  it("不初始化资金，无默认虚构本金", () => {
    const a = manualAccount();
    expect(a.schemaVersion).toBe(3);
    expect(a.cashEntries).toEqual([]);
    expect(replay(a).cash).toBe("0.00");
    expect(() => validateAccount(a)).not.toThrow();
  });
  it("转入转出仅改变本金，利息增加收益和余额", () => {
    const a = setup();
    cash(a, "deposit", "10000");
    cash(a, "withdraw", "2000", t2);
    cash(a, "repo-interest", "3.52", t3);
    cash(a, "interest", "0.48", t3);
    const l = replay(a);
    expect(l.cash).toBe("8004.00");
    expect(l.capital).toBe("8000.00");
    expect(l.income).toBe("4.00");
    expect(l.repoInterest).toBe("3.52");
    expect(l.realized).toBe("0.00");
  });
  it("允许先录买入，随后补资金并消除对账提醒", () => {
    const a = setup();
    trade(a, "buy", "10", "100");
    expect(replay(a).cash).toBe("-1000.10");
    expect(replay(a).cashWarnings).toBeGreaterThan(0);
    cash(a, "deposit", "2000", t1);
    expect(replay(a).cash).toBe("999.90");
    expect(replay(a).cashWarnings).toBe(0);
  });
  it("转出超过当前余额仍可记录并提示", () => {
    const a = setup();
    cash(a, "withdraw", "100");
    expect(replay(a).cash).toBe("-100.00");
    expect(replay(a).capital).toBe("-100.00");
    expect(replay(a).income).toBe("0.00");
  });
  it("后补更早买入重算后续FIFO成本", () => {
    const a = setup();
    trade(a, "buy", "10", "100", t2);
    trade(a, "sell", "11", "100", t3);
    expect(replay(a).realized).toBe("99.79");
    trade(a, "buy", "9", "100", t1);
    expect(a.entries.map((e) => e.time)).toEqual([t1, t2, t3]);
    expect(replay(a).realized).toBe("199.80");
    expect(replay(a).positions.sh510300.cost).toBe("1000.1");
  });
  it("利息不摊入持仓成本、不伪造成交配对收益", () => {
    const a = setup();
    trade(a, "buy", "10", "100");
    const before = replay(a).positions.sh510300;
    cash(a, "repo-interest", "5", t3);
    const after = replay(a);
    expect(after.positions.sh510300).toEqual(before);
    expect(dayPair(a.entries, "sh510300", "2026-08-27").profit).toBe("0.00");
    expect(after.income).toBe("5.00");
  });
  it("成交缺少历史底仓仍拒绝，避免伪造FIFO成本", () => {
    const a = setup();
    expect(() => trade(a, "sell", "10", "100")).toThrow("历史持仓不足");
  });
  it("可以按交割单录入费用，即使费率未确认", () => {
    const a = manualAccount();
    const e = draftRecord(
      a,
      "sh510300",
      "buy",
      "4.600123",
      "101",
      t1,
      "历史成交",
      { commission: "0.01", stamp: "0", transfer: "0" },
    ).entry;
    insertRecord(a, e);
    expect(e.feeSource).toBe("actual");
    expect(e.fees?.amount).toBe("464.61");
    expect(e.fees?.cash).toBe("464.62");
    expect(() => validateAccount(a)).not.toThrow();
  });
  it("改设置不修改历史实际费用", () => {
    const a = setup();
    insertRecord(
      a,
      draftRecord(a, "sh510300", "buy", "10", "100", t1, "", {
        commission: "2",
        stamp: "0",
        transfer: "0.03",
      }).entry,
    );
    a.profiles.etf.minimum = "5";
    expect(replay(a).fees).toBe("2.03");
    a.entries[0].fees!.cash = "1";
    expect(() => validateAccount(a)).toThrow("历史成交费用校验失败");
  });
  it("旧版余额迁移为可见资金记录，数值不变且不重复迁移", () => {
    const old = newAccount();
    old.initialized = true;
    old.initialCash = "12345.67";
    const a = upgradeAccount(old);
    expect(a.initialCash).toBe("0.00");
    expect(a.cashEntries?.[0].kind).toBe("legacy-balance");
    expect(replay(a).cash).toBe("12345.67");
    expect(upgradeAccount(a).cashEntries).toHaveLength(1);
    expect(old.schemaVersion).toBe(2);
  });
  it("未初始化的旧账户迁移不产生余额", () => {
    const a = upgradeAccount(newAccount());
    expect(a.cashEntries).toHaveLength(0);
    expect(replay(a).cash).toBe("0.00");
  });
  it.each(["0", "-10", "abc", "1.001"])("拒绝非法资金金额%s", (v) => {
    expect(() => draftCash("deposit", v, t1)).toThrow();
  });
  it("拒绝无效日期和未来日期", () => {
    expect(() => fromShanghaiInput("2026-02-30T09:00")).toThrow();
    expect(() => fromShanghaiInput("2099-01-01T09:00")).toThrow();
    expect(fromShanghaiInput("2026-08-25T09:00")).toBe(t1);
  });
  it("不能通过备份传入错误资金类型/重复编号/负金额", () => {
    const a = setup();
    cash(a, "deposit", "100");
    a.cashEntries!.push({ ...a.cashEntries![0] });
    expect(() => validateAccount(a)).toThrow("重复");
    a.cashEntries!.pop();
    a.cashEntries![0].amount = "-10";
    expect(() => validateAccount(a)).toThrow();
  });
  it("估算小额费用和实际费用严格按分校验", () => {
    const a = setup();
    expect(recordFees("buy", "1", "1", a.profiles.etf).commission).toBe("0.00");
    expect(() =>
      recordFees("buy", "1", "1", a.profiles.etf, {
        commission: "0.001",
        stamp: "0",
        transfer: "0",
      }),
    ).toThrow("两位小数");
  });
});

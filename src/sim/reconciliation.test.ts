import { expect, it } from "vitest";
import { cashTimeline } from "./reconciliation";
import { draftCash, draftRecord, insertRecord, manualAccount } from "./record";

it("按真实重放顺序合并资金与成交，并标记负余额起止", () => {
  const account = manualAccount();
  const security = account.securities[0];
  account.cashEntries!.push(
    draftCash("deposit", "1000", "2026-08-25T01:00:00.000Z", "转入"),
    draftCash("deposit", "20", "2026-08-25T03:00:00.000Z", "补足"),
  );
  insertRecord(
    account,
    draftRecord(
      account,
      security.id,
      "buy",
      "10",
      "102",
      "2026-08-25T02:00:00.000Z",
      "买入",
      { commission: "0", stamp: "0", transfer: "0" },
    ).entry,
  );
  const rows = cashTimeline(account);
  expect(rows.map((row) => [row.scope, row.delta, row.balance])).toEqual([
    ["cash", "1000.00", "1000.00"],
    ["trade", "-1020.00", "-20.00"],
    ["cash", "20.00", "0.00"],
  ]);
  expect(rows[1]).toMatchObject({ negative: true, startsNegative: true });
  expect(rows[2]).toMatchObject({ negative: false, recovers: true });
});

it("同一时刻先应用资金流水再处理成交，与账本重放保持一致", () => {
  const account = manualAccount();
  const time = "2026-08-25T01:00:00.000Z";
  account.cashEntries!.push(draftCash("deposit", "1000", time));
  insertRecord(
    account,
    draftRecord(
      account,
      account.securities[0].id,
      "buy",
      "10",
      "100",
      time,
      "",
      { commission: "0", stamp: "0", transfer: "0" },
    ).entry,
  );
  const rows = cashTimeline(account);
  expect(rows.map((row) => row.scope)).toEqual(["cash", "trade"]);
  expect(rows.at(-1)?.balance).toBe("0.00");
  expect(rows.some((row) => row.negative)).toBe(false);
});

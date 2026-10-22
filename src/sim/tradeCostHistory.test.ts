import { expect, it } from "vitest";
import { replay } from "./ledger";
import { draftRecord, insertRecord, manualAccount } from "./record";

function setup() {
  const account = manualAccount();
  const add = (
    kind: "buy" | "sell",
    price: string,
    quantity: string,
    time: string,
    commission = "0",
  ) => {
    const e = draftRecord(
      account,
      "sh510300",
      kind,
      price,
      quantity,
      time,
      "",
      { commission, stamp: "0", transfer: "0" },
    ).entry;
    insertRecord(account, e);
    return e.id;
  };
  return { account, add };
}
it("records each fill's diluted cost including historical fees, without rewriting earlier costs", () => {
  const { account, add } = setup();
  const a = add("buy", "10", "100", "2026-08-25T01:00:00.000Z", "1");
  const b = add("sell", "12", "50", "2026-08-25T02:00:00.000Z", "1");
  const c = add("buy", "9", "50", "2026-08-25T03:00:00.000Z", "1");
  const result = replay(account, "2026-08-25");
  expect(result.costAfterEntry).toEqual({
    [a]: "10.0100",
    [b]: "8.0400",
    [c]: "8.5300",
  });
  expect(result.costAfterEntry[c]).toBe(result.positions.sh510300.dilutedCost);
});
it("shows no unit cost at zero shares, carries same-day T proceeds, and resets after an overnight close", () => {
  const { account, add } = setup();
  const a = add("buy", "10", "100", "2026-08-25T01:00:00.000Z");
  const b = add("sell", "12", "100", "2026-08-25T02:00:00.000Z");
  const c = add("buy", "11", "100", "2026-08-25T03:00:00.000Z");
  const d = add("sell", "13", "100", "2026-08-26T01:00:00.000Z");
  const e = add("buy", "20", "100", "2026-08-27T01:00:00.000Z");
  expect(replay(account, "2026-08-27").costAfterEntry).toEqual({
    [a]: "10.0000",
    [b]: null,
    [c]: "9.0000",
    [d]: null,
    [e]: "20.0000",
  });
});
it("preserves negative diluted costs and separates securities and opening positions", () => {
  const { account, add } = setup();
  account.entries.push({
    id: "opening",
    securityId: "sh510300",
    kind: "opening",
    price: "10",
    quantity: "100",
    available: "100",
    time: "2026-08-25T00:00:00.000Z",
    date: "2026-08-25",
  });
  const sell = add("sell", "20", "90", "2026-08-25T01:00:00.000Z");
  const other = draftRecord(
    account,
    "sz159915",
    "buy",
    "20",
    "100",
    "2026-08-25T02:00:00.000Z",
    "",
    { commission: "1", stamp: "0", transfer: "0" },
  ).entry;
  insertRecord(account, other);
  expect(replay(account, "2026-08-25").costAfterEntry).toEqual({
    opening: "10.0000",
    [sell]: "-80.0000",
    [other.id]: "20.0100",
  });
});

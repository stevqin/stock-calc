import Decimal from "decimal.js";
import type { Account, CashEntry, Entry } from "./model";

export type CashTimelineRow = {
  scope: "trade" | "cash";
  id: string;
  time: string;
  date: string;
  record: Entry | CashEntry;
  delta: string;
  balance: string;
  negative: boolean;
  startsNegative: boolean;
  recovers: boolean;
};

type TimelineEvent = {
  scope: "trade" | "cash";
  record: Entry | CashEntry;
  priority: number;
  order: number;
};

/** Mirrors replay(): cash records at the same instant are applied before trades. */
export function cashTimeline(account: Account): CashTimelineRow[] {
  const events: TimelineEvent[] = [
    ...(account.cashEntries ?? []).map((record, order) => ({
      scope: "cash" as const,
      record,
      priority: 0,
      order,
    })),
    ...account.entries.map((record, order) => ({
      scope: "trade" as const,
      record,
      priority: 1,
      order,
    })),
  ].sort(
    (a, b) =>
      a.record.time.localeCompare(b.record.time) ||
      a.priority - b.priority ||
      a.order - b.order,
  );
  let balance = new Decimal(account.initialCash);
  return events.map((event) => {
    const before = balance;
    const delta =
      event.scope === "cash"
        ? new Decimal((event.record as CashEntry).amount).mul(
            (event.record as CashEntry).kind === "withdraw" ? -1 : 1,
          )
        : (event.record as Entry).kind === "buy"
          ? new Decimal((event.record as Entry).fees?.cash ?? 0).negated()
          : (event.record as Entry).kind === "sell"
            ? new Decimal((event.record as Entry).fees?.cash ?? 0)
            : new Decimal(0);
    balance = balance.plus(delta);
    return {
      scope: event.scope,
      id: event.record.id,
      time: event.record.time,
      date: event.record.date,
      record: event.record,
      delta: delta.toFixed(2),
      balance: balance.toFixed(2),
      negative: balance.lt(0),
      startsNegative: before.gte(0) && balance.lt(0),
      recovers: before.lt(0) && balance.gte(0),
    };
  });
}

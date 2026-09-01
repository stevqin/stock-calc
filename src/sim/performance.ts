import Decimal from "decimal.js";
import type { Account, Entry, Position } from "./model";
import type { Quote } from "../quotes";
import type { ChartData } from "./chart";
const D = (v: Decimal.Value) => new Decimal(v);
export function returnPercent(
  profit: string | null,
  base: string | null,
): string | null {
  return profit !== null && base !== null && D(base).gt(0)
    ? D(profit).div(base).mul(100).toFixed(2)
    : null;
}
export function quoteDate(q?: Quote) {
  const s = q?.quoteTime;
  return s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}
export interface DailyPerformance {
  date: string;
  quantityStart: string;
  previousClose: string | null;
  startValue: string | null;
  endValue: string | null;
  buys: string;
  sells: string;
  fees: string;
  profit: string | null;
  reason: string;
}
/** Daily return uses opening value plus positive net cash invested today. */
export function dailyReturnPercent(day?: DailyPerformance): string | null {
  return day ? aggregateDailyReturnPercent([day]) : null;
}
/** Account return nets cash flows across securities before applying the positive-investment floor. */
export function aggregateDailyReturnPercent(
  days: DailyPerformance[],
): string | null {
  if (
    !days.length ||
    days.some(
      (day) =>
        day.reason ||
        day.profit == null ||
        day.startValue == null ||
        day.date !== days[0].date,
    )
  )
    return null;
  let profit = D(0),
    start = D(0),
    net = D(0);
  for (const day of days) {
    profit = profit.plus(day.profit!);
    start = start.plus(day.startValue!);
    net = net.plus(day.buys).minus(day.sells);
  }
  return returnPercent(
    profit.toString(),
    start.plus(Decimal.max(0, net)).toString(),
  );
}
/** Derive a day boundary from trades, not replay(today), which rejects later records. */
export function dailyPerformance(
  a: Account,
  id: string,
  date: string,
  q?: Quote,
  rawDaily?: ChartData,
): DailyPerformance {
  let start = D(0),
    end = D(0),
    buys = D(0),
    sells = D(0),
    fees = D(0),
    openingToday = false;
  for (const e of a.entries.filter(
    (e) => e.securityId === id && e.date <= date,
  )) {
    const amount = D(e.quantity).mul(e.kind === "sell" ? -1 : 1);
    if (e.date < date) start = start.plus(amount);
    if (e.date === date) {
      if (e.kind === "opening") openingToday = true;
      else {
        fees = fees.plus(e.fees!.total);
        if (e.kind === "buy") buys = buys.plus(e.fees!.cash);
        else sells = sells.plus(e.fees!.cash);
      }
    }
    end = end.plus(amount);
  }
  const previous =
    rawDaily?.adjustment === "不复权"
      ? (rawDaily.bars.filter((b) => b.date < date).at(-1)?.close ?? null)
      : null;
  const endValue = end.isZero()
    ? D(0)
    : q && quoteDate(q) === date
      ? end.mul(q.latest)
      : null;
  const startValue = start.isZero()
    ? D(0)
    : previous
      ? start.mul(previous)
      : null;
  const reason = openingToday
    ? "当天录入期初快照，缺少日初基准"
    : endValue === null
      ? "当前交易日有效报价缺失"
      : startValue === null
        ? "待获取上一交易日不复权收盘价"
        : "";
  return {
    date,
    quantityStart: start.toString(),
    previousClose: previous,
    startValue: startValue?.toFixed(2) ?? null,
    endValue: endValue?.toFixed(2) ?? null,
    buys: buys.toFixed(2),
    sells: sells.toFixed(2),
    fees: fees.toFixed(2),
    profit: reason
      ? null
      : endValue!.minus(startValue!).plus(sells).minus(buys).toFixed(2),
    reason,
  };
}
export function holdingPerformance(p?: Position, q?: Quote) {
  const value =
    !p || D(p.quantity).isZero()
      ? D(0)
      : q
        ? D(p.quantity).mul(q.latest)
        : null;
  return {
    marketValue: value?.toFixed(2) ?? null,
    cyclePnl:
      p && value !== null ? value.minus(p.netInvestment).toFixed(2) : null,
    cyclePnlPercent:
      p && value !== null && D(p.netInvestment).gt(0)
        ? value.minus(p.netInvestment).div(p.netInvestment).mul(100).toFixed(2)
        : null,
  };
}

export interface SecurityContribution {
  /** All FIFO profit already locked in by sells, including prior closed cycles. */
  realized: string;
  /** Unrealized profit of the remaining FIFO inventory. */
  holding: string | null;
  /** Security lifetime contribution: realized profit + current holding profit. */
  total: string | null;
  /** Absolute share within the positive or negative contribution group. */
  share: string | null;
}

/** Lifetime contribution never adds cycle P&L to realized P&L, avoiding double counting T sells. */
export function securityContribution(
  p?: Position,
  q?: Quote,
): SecurityContribution | null {
  if (!p) return null;
  const realized = D(p.realized);
  if (D(p.quantity).isZero())
    return {
      realized: realized.toFixed(2),
      holding: "0.00",
      total: realized.toFixed(2),
      share: null,
    };
  if (!q)
    return {
      realized: realized.toFixed(2),
      holding: null,
      total: null,
      share: null,
    };
  const holding = D(p.quantity).mul(q.latest).minus(p.cost);
  return {
    realized: realized.toFixed(2),
    holding: holding.toFixed(2),
    total: realized.plus(holding).toFixed(2),
    share: null,
  };
}
/** Current cycle starts only when a new trading day opens from zero inventory. */
export function holdingTradingDays(
  entries: Entry[],
  securityId: string,
  asOf: string,
  rawDaily?: ChartData,
): number | null {
  const days = new Map<string, Entry[]>();
  for (const e of entries
    .filter((e) => e.securityId === securityId && e.date <= asOf)
    .sort((a, b) => a.time.localeCompare(b.time))) {
    const list = days.get(e.date) ?? [];
    list.push(e);
    days.set(e.date, list);
  }
  let quantity = D(0),
    start = "";
  for (const [date, trades] of days) {
    if (
      quantity.isZero() &&
      trades.some((e) => e.kind === "buy" || e.kind === "opening")
    )
      start = date;
    for (const e of trades)
      quantity = quantity.plus(D(e.quantity).mul(e.kind === "sell" ? -1 : 1));
  }
  if (!start || !rawDaily || rawDaily.adjustment !== "不复权") return null;
  const dates = new Set(
    rawDaily.bars
      .map((b) => b.date)
      .filter((date) => date >= start && date <= asOf),
  );
  // A recorded fill proves that the boundary date was a trading day, even if
  // today's unfinished bar has not reached the daily endpoint yet.
  for (const date of days.keys())
    if (date >= start && date <= asOf) dates.add(date);
  const firstBar = rawDaily.bars[0]?.date;
  return firstBar && firstBar <= start ? dates.size || null : null;
}
export function fiveDayChange(q?: Quote, daily?: ChartData): string | null {
  if (!q || !daily || daily.adjustment !== "前复权") return null;
  const date = quoteDate(q)!;
  // Five full price intervals ending at the current quote, including today's partial session.
  const prior = daily.bars.filter((b) => b.date < date);
  const base = prior.at(-5)?.close;
  return base && D(base).gt(0)
    ? D(q.latest).div(base).minus(1).mul(100).toFixed(2)
    : null;
}

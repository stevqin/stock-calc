import Decimal from "decimal.js";
import type { Account, Entry } from "./model";
import { nextDate, shanghaiDate } from "./model";
import type { ChartData } from "./chart";
import type { Quote } from "../quotes";
import { quoteDate } from "./performance";

const D = (v: Decimal.Value) => new Decimal(v);
const cents = (v: Decimal.Value) => D(v).toFixed(2);
export interface AnalysisContribution {
  securityId: string;
  profit: string | null;
  realized: string;
  fees: string;
  returnRate: string | null;
  /** Unrounded daily or compounded growth factor. */
  returnFactor: string | null;
  rateReason: string;
}
export interface AnalysisDay {
  returnBase: string | null;
  returnRate: string | null;
  /** Unrounded daily growth factor, for compounding. */
  returnFactor: string | null;
  rateReason: string;
  date: string;
  profit: string | null;
  realized: string;
  fees: string;
  income: string;
  status: "complete" | "missing" | "empty";
  reasons: string[];
  contributions: AnalysisContribution[];
}
export interface ClosedCycle {
  securityId: string;
  start: string;
  end: string;
  profit: string;
}
export interface Analysis {
  start: string;
  end: string;
  days: AnalysisDay[];
  cycles: ClosedCycle[];
}
export interface AnalysisOptions {
  /** A broad-market daily series identifies observed exchange sessions. */
  calendar?: ChartData;
  /** Explicit successfully fetched intervals; only these can prove weekday holidays. */
  calendarCoverage?: { start: string; end: string }[];
  /** Without a clock, today's zero inventory is conservatively still an open cycle. */
  now?: Date;
}
export interface AnalysisSummary {
  returnRate: string | null;
  rateReason: string;
  profit: string | null;
  realized: string;
  unrealizedChange: string | null;
  fees: string;
  income: string;
  /** Percentage, from 0 to 100. Flat cycles belong in the denominator. */
  winRate: string | null;
  wins: number;
  losses: number;
  flat: number;
  closed: number;
  averageWin: string | null;
  averageLoss: string | null;
  missingDays: number;
  contributions: AnalysisContribution[];
}
interface State {
  quantity: Decimal;
  lots: { quantity: Decimal; cost: Decimal; availableDate: string }[];
  head: number;
  realized: Decimal;
  cycleStart: string;
  cycleProfit: Decimal;
}
const previousDate = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const weekend = (date: string) =>
  [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const validPrice = (value: string | undefined): value is string => {
  try {
    return value !== undefined && D(value).isFinite() && D(value).gt(0);
  } catch {
    return false;
  }
};

/** Replays each fill once, retaining FIFO inventory and marking each daily boundary.
 * Missing sessions are never bridged with an arbitrarily old security close. A known
 * exchange calendar can prove intervening holidays; otherwise weekdays require data.
 * Income is a separate account contribution, while deposits/withdrawals are capital.
 */
export function analyzeAccount(
  account: Account,
  barsById: Record<string, ChartData>,
  quotes: Record<string, Quote>,
  today: string,
  options: AnalysisOptions = {},
): Analysis {
  const trades = [...account.entries]
    .filter((e) => e.date <= today)
    .sort((a, b) => a.time.localeCompare(b.time));
  const cash = [...(account.cashEntries ?? [])]
    .filter((e) => e.date <= today)
    .sort((a, b) => a.time.localeCompare(b.time));
  const start =
    [trades[0]?.date, cash[0]?.date]
      .filter((v): v is string => !!v)
      .sort()[0] ?? today;
  const result: Analysis = { start, end: today, days: [], cycles: [] };
  if (!trades.length && !cash.length) return result;
  const closeMaps = new Map<string, Map<string, string>>();
  const provenSessions = new Set(trades.map((e) => e.date));
  for (const [id, data] of Object.entries(barsById)) {
    if (data.adjustment !== "不复权") continue;
    const closes = new Map<string, string>();
    for (const bar of data.bars) {
      if (validPrice(bar.close)) {
        closes.set(bar.date, bar.close);
        provenSessions.add(bar.date);
      }
    }
    for (const event of data.suspensions ?? []) {
      const reference = closes.get(event.referenceDate);
      if (
        event.referenceDate < event.date &&
        reference &&
        !closes.has(event.date) &&
        /^https:\/\//.test(event.source) &&
        !trades.some((e) => e.securityId === id && e.date === event.date)
      ) {
        closes.set(event.date, reference);
      }
    }
    closeMaps.set(id, closes);
  }
  for (const quote of Object.values(quotes)) {
    if (quoteDate(quote) === today && validPrice(quote.latest))
      provenSessions.add(today);
  }
  const calendarDates = (options.calendar?.bars ?? [])
    .map((b) => b.date)
    .sort();
  const calendarSet = new Set(calendarDates);

  const isRest = (date: string) => {
    if (provenSessions.has(date) || calendarSet.has(date)) return false;
    if (weekend(date)) return true;
    return (
      !!options.calendar &&
      (options.calendarCoverage ?? []).some(
        (range) => date >= range.start && date <= range.end,
      )
    );
  };
  let previousSession = previousDate(start);
  while (isRest(previousSession))
    previousSession = previousDate(previousSession);
  const states = new Map<string, State>();
  const active = new Set<string>();
  let previousAccountRealized = D(0);
  let tradeIndex = 0,
    cashIndex = 0;
  for (let date = start; date <= today; date = nextDate(date)) {
    const entries = new Map<string, Entry[]>();
    while (tradeIndex < trades.length && trades[tradeIndex].date === date) {
      const entry = trades[tradeIndex++];
      const group = entries.get(entry.securityId) ?? [];
      group.push(entry);
      entries.set(entry.securityId, group);
      active.add(entry.securityId);
    }
    let income = D(0);
    let hasCash = false;
    while (cashIndex < cash.length && cash[cashIndex].date === date) {
      const event = cash[cashIndex++];
      hasCash = true;
      if (["interest", "repo-interest", "other-income"].includes(event.kind))
        income = income.plus(event.amount);
    }
    const contributions: AnalysisContribution[] = [];
    const reasons: string[] = [];
    const rest = isRest(date);
    let startValue = D(0),
      netBuy = D(0);
    for (const id of active) {
      let state = states.get(id);
      if (!state) {
        state = {
          quantity: D(0),
          lots: [],
          head: 0,
          realized: D(0),
          cycleStart: "",
          cycleProfit: D(0),
        };
        states.set(id, state);
      }
      const own = entries.get(id) ?? [];
      const quantityStart = state.quantity;
      const realizedStart = D(cents(state.realized));
      let flow = D(0),
        fees = D(0),
        opening = false;
      for (const e of own) {
        const quantity = D(e.quantity);
        if (!state.cycleStart) state.cycleStart = date;
        if (e.kind === "opening") {
          opening = true;
          const cost = quantity.mul(e.price);
          state.quantity = state.quantity.plus(quantity);
          state.cycleProfit = state.cycleProfit.minus(cost);
          const available = D(e.available ?? e.quantity);
          if (available.gt(0))
            state.lots.push({
              quantity: available,
              cost: available.mul(e.price),
              availableDate: date,
            });
          const locked = quantity.minus(available);
          if (locked.gt(0))
            state.lots.push({
              quantity: locked,
              cost: locked.mul(e.price),
              availableDate: nextDate(date),
            });
        } else {
          if (!e.fees) throw new Error("成交记录缺少历史费用");
          fees = fees.plus(e.fees.total);
          const amount = D(e.fees.cash);
          if (e.kind === "buy") {
            const security = account.securities.find((s) => s.id === id);
            state.lots.push({
              quantity,
              cost: amount,
              availableDate:
                security?.settlement === "T+0" ? date : nextDate(date),
            });
            state.quantity = state.quantity.plus(quantity);
            flow = flow.minus(amount);
            state.cycleProfit = state.cycleProfit.minus(amount);
          } else {
            let remaining = quantity,
              removed = D(0);
            for (
              let i = state.head;
              i < state.lots.length && remaining.gt(0);
              i++
            ) {
              const lot = state.lots[i];
              if (
                lot.quantity.isZero() ||
                (account.schemaVersion < 3 && lot.availableDate > date)
              )
                continue;
              const taken = Decimal.min(remaining, lot.quantity);
              const cost = lot.cost.mul(taken).div(lot.quantity);
              lot.quantity = lot.quantity.minus(taken);
              lot.cost = lot.cost.minus(cost);
              remaining = remaining.minus(taken);
              removed = removed.plus(cost);
            }
            if (remaining.gt(0))
              throw new Error("历史持仓不足，无法分析卖出记录");
            while (
              state.head < state.lots.length &&
              state.lots[state.head].quantity.isZero()
            )
              state.head++;
            state.quantity = state.quantity.minus(quantity);
            state.realized = state.realized.plus(amount.minus(removed));
            flow = flow.plus(amount);
            state.cycleProfit = state.cycleProfit.plus(amount);
          }
        }
      }
      const closes = closeMaps.get(id);
      const quote = quotes[id];
      const endPrice =
        date === today &&
        quoteDate(quote) === today &&
        validPrice(quote?.latest)
          ? quote.latest
          : closes?.get(date);
      const previousPrice = closes?.get(previousSession);
      let profit: string | null;
      if (opening) {
        profit = null;
        reasons.push(`${id}：当天录入期初快照，缺少日初市值基准`);
      } else if (rest && !own.length) profit = "0.00";
      else if (quantityStart.gt(0) && !previousPrice) {
        profit = null;
        reasons.push(`${id}：缺少上一交易日 ${previousSession} 不复权收盘价`);
      } else if (state.quantity.gt(0) && !endPrice) {
        profit = null;
        reasons.push(`${id}：缺少 ${date} 有效不复权收盘价或当日报价`);
      } else {
        const before = quantityStart.isZero()
          ? D(0)
          : D(cents(quantityStart.mul(previousPrice!)));
        const after = state.quantity.isZero()
          ? D(0)
          : D(cents(state.quantity.mul(endPrice!)));
        profit = cents(after.minus(before).plus(flow));
      }
      const contributionBase =
        profit === null || (quantityStart.gt(0) && !previousPrice)
          ? null
          : (quantityStart.isZero()
              ? D(0)
              : D(cents(quantityStart.mul(previousPrice!)))
            ).plus(Decimal.max(0, flow.neg()));
      const contributionReason =
        profit === null
          ? "缺少估值基准，无法计算收益率"
          : contributionBase?.gt(0)
            ? ""
            : D(profit).isZero()
              ? ""
              : "无有效证券资金基数";
      const contributionFactor =
        profit === null
          ? null
          : contributionBase?.gt(0)
            ? D(1).plus(D(profit).div(contributionBase)).toString()
            : D(profit).isZero()
              ? "1"
              : null;
      netBuy = netBuy.minus(flow);
      if (quantityStart.gt(0) && previousPrice)
        startValue = startValue.plus(cents(quantityStart.mul(previousPrice)));
      contributions.push({
        securityId: id,
        profit,
        realized: cents(D(cents(state.realized)).minus(realizedStart)),
        fees: cents(fees),
        returnRate:
          contributionFactor === null
            ? null
            : D(contributionFactor).minus(1).mul(100).toFixed(2),
        returnFactor: contributionFactor,
        rateReason: contributionReason,
      });
      if (state.quantity.isZero()) {
        const clock = options.now;
        const finalToday =
          clock &&
          shanghaiDate(clock) === today &&
          clock.getTime() >= Date.parse(`${today}T15:00:00+08:00`);
        if (state.cycleStart && (date < today || finalToday))
          result.cycles.push({
            securityId: id,
            start: state.cycleStart,
            end: date,
            profit: cents(state.cycleProfit),
          });
        state.cycleStart = "";
        state.cycleProfit = D(0);
        active.delete(id);
      }
    }
    // Match ledger: sum unrounded security FIFO results, then round the account.
    // Individually rounded contribution rows may differ by a cent from that total.
    const accountRealized = D(
      cents(
        [...states.values()].reduce((n, state) => n.plus(state.realized), D(0)),
      ),
    );
    const dayRealized = accountRealized.minus(previousAccountRealized);
    previousAccountRealized = accountRealized;
    const missing = contributions.some((c) => c.profit === null);
    // Net trade cash across the entire portfolio before applying the positive floor.
    const base = startValue.plus(Decimal.max(0, netBuy));
    const securitiesProfit = contributions.reduce(
      (n, c) => n.plus(c.profit ?? 0),
      D(0),
    );
    const neutral =
      !missing &&
      securitiesProfit.isZero() &&
      !entries.size &&
      (rest || !contributions.length);
    const rateReason = missing
      ? "缺少估值基准，无法计算盈亏率"
      : base.gt(0)
        ? ""
        : "无有效证券资金基数";
    const returnFactor = missing
      ? null
      : base.gt(0)
        ? D(1).plus(securitiesProfit.div(base)).toString()
        : neutral
          ? "1"
          : null;
    result.days.push({
      returnBase: missing ? null : cents(base),
      returnRate:
        !missing && base.gt(0)
          ? securitiesProfit.div(base).mul(100).toFixed(2)
          : null,
      returnFactor,
      rateReason,
      date,
      profit: missing
        ? null
        : cents(contributions.reduce((n, c) => n.plus(c.profit!), income)),
      realized: cents(dayRealized),
      fees: cents(contributions.reduce((n, c) => n.plus(c.fees), D(0))),
      income: cents(income),
      status: missing
        ? "missing"
        : contributions.length || hasCash
          ? "complete"
          : "empty",
      reasons,
      contributions,
    });
    if (!rest) previousSession = date;
  }
  return result;
}

export function summarizeAnalysis(
  analysis: Analysis,
  start: string,
  end: string,
): AnalysisSummary {
  let profit = D(0),
    realized = D(0),
    fees = D(0),
    income = D(0),
    missingDays = 0;
  let factor = D(1),
    hasRate = false,
    rateMissing = false;
  const contributions = new Map<string, AnalysisContribution>();
  for (const day of analysis.days) {
    if (day.date < start || day.date > end) continue;
    if (day.returnFactor === null) rateMissing = true;
    else factor = factor.mul(day.returnFactor);
    if (day.returnRate !== null) hasRate = true;
    if (day.profit === null) missingDays++;
    else profit = profit.plus(day.profit);
    realized = realized.plus(day.realized);
    fees = fees.plus(day.fees);
    income = income.plus(day.income);
    for (const c of day.contributions) {
      const p = contributions.get(c.securityId) ?? {
        securityId: c.securityId,
        profit: "0.00",
        realized: "0.00",
        fees: "0.00",
        returnRate: "0.00",
        returnFactor: "1",
        rateReason: "",
      };
      p.profit =
        p.profit === null || c.profit === null
          ? null
          : cents(D(p.profit).plus(c.profit));
      p.realized = cents(D(p.realized).plus(c.realized));
      p.fees = cents(D(p.fees).plus(c.fees));
      p.returnFactor =
        p.returnFactor === null || c.returnFactor === null
          ? null
          : D(p.returnFactor).mul(c.returnFactor).toString();
      p.returnRate =
        p.returnFactor === null
          ? null
          : D(p.returnFactor).minus(1).mul(100).toFixed(2);
      if (c.returnFactor === null)
        p.rateReason = c.rateReason || "区间存在收益率数据缺口";
      contributions.set(c.securityId, p);
    }
  }
  const cycles = analysis.cycles.filter((c) => c.end >= start && c.end <= end);
  const wins = cycles.filter((c) => D(c.profit).gt(0));
  const losses = cycles.filter((c) => D(c.profit).lt(0));
  const average = (samples: ClosedCycle[]) =>
    samples.length
      ? cents(
          samples.reduce((n, c) => n.plus(c.profit), D(0)).div(samples.length),
        )
      : null;
  return {
    returnRate:
      !rateMissing && hasRate ? factor.minus(1).mul(100).toFixed(2) : null,
    rateReason: rateMissing
      ? "区间存在缺失估值或无有效基数的交易日"
      : hasRate
        ? ""
        : "无有效证券资金基数",
    profit: missingDays ? null : cents(profit),
    realized: cents(realized),
    unrealizedChange: missingDays
      ? null
      : cents(profit.minus(income).minus(realized)),
    fees: cents(fees),
    income: cents(income),
    winRate: cycles.length
      ? D(wins.length).div(cycles.length).mul(100).toFixed(2)
      : null,
    wins: wins.length,
    losses: losses.length,
    flat: cycles.length - wins.length - losses.length,
    closed: cycles.length,
    averageWin: average(wins),
    averageLoss: average(losses),
    missingDays,
    contributions: [...contributions.values()],
  };
}

export function shiftMonth(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + delta, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day || 1, last));
  return target.toISOString().slice(0, date.length === 7 ? 7 : 10);
}
export function monthSequence(month: string): string[] {
  return Array.from({ length: 12 }, (_, index) => shiftMonth(month, -index));
}

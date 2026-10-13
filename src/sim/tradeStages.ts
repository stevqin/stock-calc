import Decimal from "decimal.js";
import type { Entry } from "./model";

const D = (value: Decimal.Value) => new Decimal(value);
const money = (value: Decimal.Value) => D(value).toFixed(2);

export interface TradeClassification {
  label: string;
  trueClose: boolean;
  tQuantity: string;
  detail: string;
}

export interface TradeStage {
  index: number;
  start: string;
  end: string;
  status: "open" | "closed";
  entryIds: string[];
  profit: string | null;
  returnRate: string | null;
  returnBase: string | null;
  tProfit: string;
  tReturnRate: string | null;
  tQuantity: string;
  tDays: number;
}

export interface TradeStageAnalysis {
  classifications: Record<string, TradeClassification>;
  stages: TradeStage[];
  stageByEntryId: Record<string, number>;
  summary: {
    profit: string | null;
    returnRate: string | null;
    tProfit: string;
    tReturnRate: string | null;
    tQuantity: string;
    tDays: number;
    closedStages: number;
    totalStages: number;
  };
}

interface PairPart {
  entryId: string;
  quantity: Decimal;
}

interface DayPairing {
  quantity: Decimal;
  profit: Decimal;
  cost: Decimal;
  parts: PairPart[];
  unmatchedBuyQuantity: Decimal;
  unmatchedBuyCost: Decimal;
}

export interface UnmatchedDayBuyPerformance {
  quantity: string;
  cost: string;
  marketValue: string | null;
  profit: string | null;
  returnRate: string | null;
}

export interface DayTPerformance {
  profit: string;
  returnRate: string | null;
  quantity: string;
}

function cash(entry: Entry): Decimal {
  return entry.fees?.cash != null
    ? D(entry.fees.cash)
    : D(entry.price).mul(entry.quantity);
}

function pairDay(entries: Entry[]): DayPairing {
  const buys = entries
    .filter((entry) => entry.kind === "buy")
    .map((entry) => ({
      entry,
      remaining: D(entry.quantity),
      per: cash(entry).div(entry.quantity),
    }));
  const sells = entries
    .filter((entry) => entry.kind === "sell")
    .map((entry) => ({
      entry,
      remaining: D(entry.quantity),
      per: cash(entry).div(entry.quantity),
    }));
  const matched = new Map<string, Decimal>();
  let quantity = D(0);
  let profit = D(0);
  let cost = D(0);
  let buyIndex = 0;
  let sellIndex = 0;
  while (buyIndex < buys.length && sellIndex < sells.length) {
    const buy = buys[buyIndex];
    const sell = sells[sellIndex];
    const paired = Decimal.min(buy.remaining, sell.remaining);
    quantity = quantity.plus(paired);
    profit = profit.plus(sell.per.minus(buy.per).mul(paired));
    cost = cost.plus(buy.per.mul(paired));
    matched.set(buy.entry.id, (matched.get(buy.entry.id) ?? D(0)).plus(paired));
    matched.set(
      sell.entry.id,
      (matched.get(sell.entry.id) ?? D(0)).plus(paired),
    );
    buy.remaining = buy.remaining.minus(paired);
    sell.remaining = sell.remaining.minus(paired);
    if (buy.remaining.isZero()) buyIndex += 1;
    if (sell.remaining.isZero()) sellIndex += 1;
  }
  return {
    quantity,
    profit,
    cost,
    parts: [...matched].map(([entryId, partQuantity]) => ({
      entryId,
      quantity: partQuantity,
    })),
    unmatchedBuyQuantity: buys.reduce(
      (sum, buy) => sum.plus(buy.remaining),
      D(0),
    ),
    unmatchedBuyCost: buys.reduce(
      (sum, buy) => sum.plus(buy.per.mul(buy.remaining)),
      D(0),
    ),
  };
}

export function analyzeDayTPerformance(
  entries: Entry[],
  securityId: string,
  date: string,
): DayTPerformance {
  const pairing = pairDay(
    entries.filter(
      (entry) => entry.securityId === securityId && entry.date === date,
    ),
  );
  return {
    profit: money(pairing.profit),
    returnRate:
      pairing.quantity.gt(0) && pairing.cost.gt(0)
        ? pairing.profit.div(pairing.cost).mul(100).toFixed(2)
        : null,
    quantity: pairing.quantity.toString(),
  };
}

export function analyzeUnmatchedDayBuys(
  entries: Entry[],
  securityId: string,
  date: string,
  latestPrice?: string | null,
): UnmatchedDayBuyPerformance {
  const pairing = pairDay(
    entries.filter(
      (entry) => entry.securityId === securityId && entry.date === date,
    ),
  );
  const latest =
    latestPrice != null && latestPrice !== "" ? D(latestPrice) : null;
  const marketValue =
    latest == null ? null : latest.mul(pairing.unmatchedBuyQuantity);
  const profit =
    marketValue == null ? null : marketValue.minus(pairing.unmatchedBuyCost);
  return {
    quantity: pairing.unmatchedBuyQuantity.toString(),
    cost: money(pairing.unmatchedBuyCost),
    marketValue: marketValue == null ? null : money(marketValue),
    profit: profit == null ? null : money(profit),
    returnRate:
      profit != null && pairing.unmatchedBuyCost.gt(0)
        ? profit.div(pairing.unmatchedBuyCost).mul(100).toFixed(2)
        : null,
  };
}

export function analyzeTradeStages(
  entries: Entry[],
  securityId: string,
  latestPrice?: string | null,
): TradeStageAnalysis {
  const ordered = entries
    .filter((entry) => entry.securityId === securityId)
    .map((entry, order) => ({ entry, order }))
    .sort(
      (a, b) => a.entry.time.localeCompare(b.entry.time) || a.order - b.order,
    )
    .map(({ entry }) => entry);

  const byDate = new Map<string, Entry[]>();
  for (const entry of ordered) {
    const day = byDate.get(entry.date) ?? [];
    day.push(entry);
    byDate.set(entry.date, day);
  }

  const pairings = new Map<string, DayPairing>();
  const tQuantityByEntry = new Map<string, Decimal>();
  for (const [date, dayEntries] of byDate) {
    const pairing = pairDay(dayEntries);
    pairings.set(date, pairing);
    for (const part of pairing.parts)
      tQuantityByEntry.set(part.entryId, part.quantity);
  }

  const classifications: Record<string, TradeClassification> = {};
  const stageByEntryId: Record<string, number> = {};
  const mutableStages: Array<{
    index: number;
    start: string;
    end: string;
    status: "open" | "closed";
    entries: Entry[];
    quantity: Decimal;
  }> = [];
  let quantity = D(0);
  let current: (typeof mutableStages)[number] | null = null;

  for (const [date, dayEntries] of byDate) {
    const quantityAfter = new Map<string, Decimal>();
    for (const entry of dayEntries) {
      if (!current) {
        current = {
          index: mutableStages.length + 1,
          start: date,
          end: date,
          status: "open",
          entries: [],
          quantity: D(0),
        };
        mutableStages.push(current);
      }
      current.entries.push(entry);
      current.end = date;
      stageByEntryId[entry.id] = current.index;
      quantity =
        entry.kind === "sell"
          ? quantity.minus(entry.quantity)
          : quantity.plus(entry.quantity);
      quantityAfter.set(entry.id, quantity);
    }

    let trueCloseId: string | undefined;
    if (quantity.isZero()) {
      trueCloseId = [...dayEntries]
        .reverse()
        .find(
          (entry) =>
            entry.kind === "sell" && quantityAfter.get(entry.id)?.isZero(),
        )?.id;
    }

    for (const entry of dayEntries) {
      const paired = tQuantityByEntry.get(entry.id) ?? D(0);
      const total = D(entry.quantity);
      const partial = paired.gt(0) && paired.lt(total);
      const trueClose = entry.id === trueCloseId;
      let label =
        entry.kind === "opening"
          ? "建仓"
          : entry.kind === "buy"
            ? "买入"
            : "卖出";
      if (entry.kind === "buy" && paired.gt(0))
        label = partial ? "买入·部分做T" : "做T买入";
      if (entry.kind === "sell" && paired.gt(0))
        label = partial ? "卖出·部分做T" : "做T卖出";
      if (trueClose) label = "真清仓";
      const details = [
        trueClose ? "该交易日结束时持仓为零" : "未形成日终清仓",
        paired.gt(0) ? `当日做T配对 ${paired.toString()} 股` : "无当日做T配对",
      ];
      classifications[entry.id] = {
        label,
        trueClose,
        tQuantity: paired.toString(),
        detail: details.join("；"),
      };
    }

    if (quantity.isZero() && current) {
      current.status = "closed";
      current.quantity = D(0);
      current = null;
    } else if (current) {
      current.quantity = quantity;
    }
  }

  const latest =
    latestPrice != null && latestPrice !== "" ? D(latestPrice) : null;
  const stages: TradeStage[] = mutableStages.map((stage) => {
    let buyCost = D(0);
    let sellProceeds = D(0);
    for (const entry of stage.entries) {
      if (entry.kind === "sell") sellProceeds = sellProceeds.plus(cash(entry));
      else buyCost = buyCost.plus(cash(entry));
    }
    const marketValue =
      stage.status === "closed"
        ? D(0)
        : latest
          ? latest.mul(stage.quantity)
          : null;
    const profit =
      marketValue == null
        ? null
        : marketValue.plus(sellProceeds).minus(buyCost);
    const returnBase =
      stage.status === "closed" ? buyCost : buyCost.minus(sellProceeds);
    const stageDates = new Set(stage.entries.map((entry) => entry.date));
    let tProfit = D(0);
    let tCost = D(0);
    let tQuantity = D(0);
    let tDays = 0;
    for (const date of stageDates) {
      const pairing = pairings.get(date);
      if (pairing?.quantity.gt(0)) {
        tProfit = tProfit.plus(pairing.profit);
        tCost = tCost.plus(pairing.cost);
        tQuantity = tQuantity.plus(pairing.quantity);
        tDays += 1;
      }
    }
    return {
      index: stage.index,
      start: stage.start,
      end: stage.end,
      status: stage.status,
      entryIds: stage.entries.map((entry) => entry.id),
      profit: profit == null ? null : money(profit),
      returnRate:
        profit != null && returnBase.gt(0)
          ? profit.div(returnBase).mul(100).toFixed(2)
          : null,
      returnBase: returnBase.gt(0) ? money(returnBase) : null,
      tProfit: money(tProfit),
      tReturnRate:
        tQuantity.gt(0) && tCost.gt(0)
          ? tProfit.div(tCost).mul(100).toFixed(2)
          : null,
      tQuantity: tQuantity.toString(),
      tDays,
    };
  });

  const profitKnown = stages.every((stage) => stage.profit != null);
  const totalProfit = profitKnown
    ? stages.reduce((sum, stage) => sum.plus(stage.profit!), D(0))
    : null;
  const totalBase = stages.reduce(
    (sum, stage) => sum.plus(stage.returnBase ?? 0),
    D(0),
  );
  const totalTProfit = stages.reduce(
    (sum, stage) => sum.plus(stage.tProfit),
    D(0),
  );
  const totalTCost = [...pairings.values()].reduce(
    (sum, pairing) => sum.plus(pairing.cost),
    D(0),
  );
  const totalTQuantity = stages.reduce(
    (sum, stage) => sum.plus(stage.tQuantity),
    D(0),
  );
  return {
    classifications,
    stages,
    stageByEntryId,
    summary: {
      profit: totalProfit == null ? null : money(totalProfit),
      returnRate:
        totalProfit != null && totalBase.gt(0)
          ? totalProfit.div(totalBase).mul(100).toFixed(2)
          : null,
      tProfit: money(totalTProfit),
      tReturnRate:
        totalTQuantity.gt(0) && totalTCost.gt(0)
          ? totalTProfit.div(totalTCost).mul(100).toFixed(2)
          : null,
      tQuantity: totalTQuantity.toString(),
      tDays: stages.reduce((sum, stage) => sum + stage.tDays, 0),
      closedStages: stages.filter((stage) => stage.status === "closed").length,
      totalStages: stages.length,
    },
  };
}

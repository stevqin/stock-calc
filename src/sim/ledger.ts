import Decimal from "decimal.js";
import {
  calculateFee,
  defaults,
  numberInput,
  priceInput,
  quantityInput,
  validateFees,
  type FeeProfile,
} from "../core/calculator";
import { validSymbol } from "../quotes";
import { recordFees, recordQuantity } from "./recordMath";
import { validateWorkspace } from "./workspaceState";
import {
  nextDate,
  shanghaiDate,
  type Account,
  type Entry,
  type Position,
  type Ledger,
  type DayPair,
  type Security,
} from "./model";

const D = (n: Decimal.Value) => new Decimal(n);
const cents = (n: Decimal.Value) => D(n).toFixed(2);
export function newAccount(legacy?: {
  profiles?: Record<string, FeeProfile>;
}): Account {
  let stock = { ...defaults.stock };
  try {
    if (legacy?.profiles?.stock) {
      validateFees(legacy.profiles.stock);
      stock = { ...legacy.profiles.stock };
    }
  } catch {
    /* retain explicit example */
  }
  return {
    schemaVersion: 2,
    initialized: false,
    initialCash: "0.00",
    entries: [],
    selectedId: "sh510300",
    securities: [
      {
        id: "sh510300",
        market: "sh",
        code: "510300",
        name: "沪深300ETF",
        asset: "etf",
        category: "domestic",
        settlement: "T+1",
      },
      {
        id: "sz159915",
        market: "sz",
        code: "159915",
        name: "创业板ETF",
        asset: "etf",
        category: "domestic",
        settlement: "T+1",
      },
      {
        id: "sh600519",
        market: "sh",
        code: "600519",
        name: "贵州茅台",
        asset: "stock",
        category: "stock",
        settlement: "T+1",
      },
    ],
    profiles: {
      stock,
      etf: {
        commissionWan: "",
        minimum: "0",
        stampPercent: "0",
        transferPercent: "0",
      },
    },
    feeConfirmed: { stock: false, etf: false },
  };
}
export function validateSecurity(s: Security): void {
  if (
    !s ||
    !validSymbol(s.market, s.code) ||
    s.id !== s.market + s.code ||
    typeof s.name !== "string" ||
    !s.name.trim() ||
    s.name.length > 60
  )
    throw new Error("证券信息无效或不在支持范围内");
  if (!["stock", "etf"].includes(s.asset)) throw new Error("请选择股票或ETF");
  const codeAsset = /^(51|52|56|58|159)/.test(s.code) ? "etf" : "stock";
  if (s.asset !== codeAsset) throw new Error("证券代码与股票/ETF品种不一致");
  if (
    ![
      "stock",
      "domestic",
      "cross-border",
      "gold",
      "bond",
      "unconfirmed",
    ].includes(s.category)
  )
    throw new Error("证券类别无效");
  if (!["T+0", "T+1", "unconfirmed"].includes(s.settlement))
    throw new Error("请选择回转交易规则");
  if (
    (s.asset === "stock" &&
      (s.category !== "stock" || s.settlement !== "T+1")) ||
    (s.asset === "etf" && s.category === "stock")
  )
    throw new Error("股票和ETF分类不一致");
  if (s.category === "domestic" && s.settlement !== "T+1")
    throw new Error("境内股票ETF应按T+1处理");
}
function emptyPosition(id: string): Position {
  return {
    securityId: id,
    quantity: "0",
    available: "0",
    cost: "0",
    averageCost: null,
    realized: "0",
    netInvestment: "0",
    dilutedCost: null,
    lots: [],
  };
}
function validateEntry(entry: Entry, s: Security, manual = false): void {
  if (!["opening", "buy", "sell"].includes(entry.kind))
    throw new Error("成交类型无效");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
    !Number.isFinite(Date.parse(entry.time)) ||
    new Date(entry.time).toISOString() !== entry.time ||
    shanghaiDate(new Date(entry.time)) !== entry.date ||
    (manual && Date.parse(entry.time) > Date.now())
  )
    throw new Error("成交日期无效");
  if (manual) recordQuantity(entry.quantity);
  else quantityInput(entry.quantity);
  if (
    entry.note !== undefined &&
    (typeof entry.note !== "string" || entry.note.length > 500)
  )
    throw new Error("备注最多500字");
  if (entry.kind === "opening") {
    numberInput(entry.price, "期初每股成本", "0", "1000000");
    const available = numberInput(
      entry.available ?? "",
      "期初可卖数量",
      "0",
      entry.quantity,
    );
    if (!available.isInteger()) throw new Error("可卖数量须为整数");
  } else {
    if (!manual && s.settlement === "unconfirmed")
      throw new Error("成交证券的回转规则尚未确认");
    if (!manual) priceInput(entry.price, s.asset);
    if (!entry.profile || !entry.fees) throw new Error("成交记录缺少历史费用");
    if (
      entry.feeSource !== undefined &&
      !["actual", "estimated"].includes(entry.feeSource)
    )
      throw new Error("手续费来源无效");
    const expected = manual
      ? recordFees(
          entry.kind,
          entry.price,
          entry.quantity,
          entry.profile,
          entry.feeSource === "actual" ? entry.fees : undefined,
        )
      : calculateFee({
          asset: s.asset,
          side: entry.kind,
          price: entry.price,
          quantity: entry.quantity,
          fees: entry.profile,
        });
    for (const key of Object.keys(expected) as (keyof typeof expected)[])
      if (entry.fees[key] !== expected[key])
        throw new Error("历史成交费用校验失败");
  }
}
/** v2 enforces simulated availability. v3 records actual fills, warning on incomplete cash history without inventing inventory. */
export function replay(account: Account, today = shanghaiDate()): Ledger {
  const cashInitial = numberInput(account.initialCash, "初始现金");
  let cash = cashInitial,
    capital = cashInitial,
    totalFees = D(0);
  const manual = account.schemaVersion >= 3;
  let deposits = D(0),
    withdrawals = D(0),
    income = D(0),
    repoInterest = D(0),
    cashWarnings = 0,
    cashIndex = 0;
  const cashEvents = [...(account.cashEntries ?? [])].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const cashIds = new Set<string>();
  const tradeIds = new Set(account.entries.map((e) => e.id));
  for (const e of cashEvents) {
    if (!e.id || cashIds.has(e.id) || tradeIds.has(e.id))
      throw new Error("资金流水编号重复");
    cashIds.add(e.id);
    if (
      ![
        "deposit",
        "withdraw",
        "repo-interest",
        "interest",
        "other-income",
        "legacy-balance",
      ].includes(e.kind)
    )
      throw new Error("资金流水类型无效");
    const amount = numberInput(
      e.amount,
      "资金流水金额",
      "0.01",
      "1000000000000",
    );
    if (amount.decimalPlaces() > 2) throw new Error("资金金额最多两位小数");
    if (
      typeof e.time !== "string" ||
      !Number.isFinite(Date.parse(e.time)) ||
      new Date(e.time).toISOString() !== e.time ||
      shanghaiDate(new Date(e.time)) !== e.date ||
      e.date > today ||
      Date.parse(e.time) > Date.now()
    )
      throw new Error("资金流水日期无效");
    if (typeof e.note !== "string" || e.note.length > 500)
      throw new Error("备注最多500字");
  }
  const applyCash = (until: string) => {
    while (
      cashIndex < cashEvents.length &&
      cashEvents[cashIndex].time <= until
    ) {
      const e = cashEvents[cashIndex++],
        v = D(e.amount);
      if (e.kind === "withdraw") {
        cash = cash.minus(v);
        withdrawals = withdrawals.plus(v);
        capital = capital.minus(v);
      } else {
        cash = cash.plus(v);
        if (e.kind === "deposit" || e.kind === "legacy-balance") {
          deposits = deposits.plus(v);
          capital = capital.plus(v);
        } else {
          income = income.plus(v);
          if (e.kind === "repo-interest") repoInterest = repoInterest.plus(v);
        }
      }
      if (cash.lt(0)) cashWarnings++;
    }
  };
  const positions: Record<string, Position> = {};
  const securities = new Map(
    account.securities.map((s) => {
      validateSecurity(s);
      return [s.id, s] as const;
    }),
  );
  if (securities.size !== account.securities.length)
    throw new Error("证券代码重复");
  const ids = new Set<string>();
  const lastDates: Record<string, string> = {};
  let lastTime = "";
  for (const e of account.entries) {
    if (!e.id || ids.has(e.id)) throw new Error("成交编号缺失或重复");
    ids.add(e.id);
    const s = securities.get(e.securityId);
    if (!s) throw new Error("成交引用的证券不存在");
    validateEntry(e, s, manual);
    applyCash(e.time);
    if (e.time < lastTime) throw new Error("成交记录必须按时间排序");
    lastTime = e.time;
    if (e.date > today) throw new Error("成交日期不能晚于当前日期");
    const p = positions[s.id] ?? (positions[s.id] = emptyPosition(s.id));
    if (D(p.quantity).isZero() && lastDates[s.id] && lastDates[s.id] !== e.date)
      p.netInvestment = "0";
    if (e.kind === "opening") {
      if (lastDates[s.id])
        throw new Error("期初持仓只能在该证券首笔成交前录入一次");
      const cost = D(e.quantity).mul(e.price);
      capital = capital.plus(cost);
      p.netInvestment = D(p.netInvestment).plus(cost).toString();
      const free = D(e.available!);
      const locked = D(e.quantity).minus(free);
      if (free.gt(0))
        p.lots.push({
          quantity: free.toString(),
          cost: free.mul(e.price).toString(),
          availableDate: e.date,
        });
      if (locked.gt(0))
        p.lots.push({
          quantity: locked.toString(),
          cost: locked.mul(e.price).toString(),
          availableDate: nextDate(e.date),
        });
    } else if (e.kind === "buy") {
      if (!manual && s.settlement === "unconfirmed")
        throw new Error("请先确认该ETF的回转交易规则");
      const cost = D(e.fees!.cash);
      if (!manual && cash.lt(cost)) throw new Error("可用资金不足");
      cash = cash.minus(cost);
      totalFees = totalFees.plus(e.fees!.total);
      p.netInvestment = D(p.netInvestment).plus(cost).toString();
      p.lots.push({
        quantity: e.quantity,
        cost: cost.toString(),
        availableDate: s.settlement === "T+0" ? e.date : nextDate(e.date),
      });
    } else {
      let remaining = D(e.quantity),
        removed = D(0);
      const available = p.lots
        .filter((l) => manual || l.availableDate <= e.date)
        .reduce((v, l) => v.plus(l.quantity), D(0));
      if (available.lt(remaining))
        throw new Error(
          manual
            ? "历史持仓不足，请先补录更早的买入或期初持仓"
            : "可卖数量不足（含T+1锁定数量），不能模拟卖空",
        );
      for (const lot of p.lots) {
        if (remaining.isZero()) break;
        if (!manual && lot.availableDate > e.date) continue;
        const taken = Decimal.min(remaining, lot.quantity);
        const cost = D(lot.cost).mul(taken).div(lot.quantity);
        lot.cost = D(lot.cost).minus(cost).toString();
        lot.quantity = D(lot.quantity).minus(taken).toString();
        remaining = remaining.minus(taken);
        removed = removed.plus(cost);
      }
      p.lots = p.lots.filter((l) => D(l.quantity).gt(0));
      cash = cash.plus(e.fees!.cash);
      totalFees = totalFees.plus(e.fees!.total);
      p.realized = D(p.realized)
        .plus(D(e.fees!.cash).minus(removed))
        .toString();
      p.netInvestment = D(p.netInvestment).minus(e.fees!.cash).toString();
    }
    lastDates[s.id] = e.date;
    if (cash.lt(0)) cashWarnings++;
    p.quantity = p.lots.reduce((n, l) => n.plus(l.quantity), D(0)).toString();
  }
  applyCash("9999");
  for (const p of Object.values(positions)) {
    p.cost = p.lots.reduce((v, l) => v.plus(l.cost), D(0)).toString();
    p.available = p.lots
      .filter((l) => l.availableDate <= today)
      .reduce((v, l) => v.plus(l.quantity), D(0))
      .toString();
    p.averageCost = D(p.quantity).gt(0)
      ? D(p.cost).div(p.quantity).toFixed(4)
      : null;
    p.dilutedCost = D(p.quantity).gt(0)
      ? D(p.netInvestment).div(p.quantity).toFixed(4)
      : null;
  }
  return {
    cash: cents(cash),
    capital: cents(capital),
    fees: cents(totalFees),
    realized: cents(
      Object.values(positions).reduce((v, p) => v.plus(p.realized), D(0)),
    ),
    positions,
    deposits: cents(deposits),
    withdrawals: cents(withdrawals),
    income: cents(income),
    repoInterest: cents(repoInterest),
    cashWarnings,
  };
}
export function draftOrder(
  account: Account,
  securityId: string,
  side: "buy" | "sell",
  price: string,
  quantity: string,
  time = new Date().toISOString(),
): { entry: Entry; ledger: Ledger } {
  if (!account.initialized) throw new Error("请先初始化模拟账户");
  const s = account.securities.find((x) => x.id === securityId);
  if (!s) throw new Error("请先选择证券");
  if (!account.feeConfirmed[s.asset])
    throw new Error(`请先确认${s.asset === "etf" ? "ETF" : "股票"}实际佣金率`);
  const fees = calculateFee({
    asset: s.asset,
    side,
    price,
    quantity,
    fees: account.profiles[s.asset],
  });
  if (s.settlement === "unconfirmed")
    throw new Error("请先确认该ETF的回转交易规则");
  const entry: Entry = {
    id: crypto.randomUUID(),
    securityId,
    kind: side,
    price,
    quantity,
    time,
    date: shanghaiDate(new Date(time)),
    fees,
    profile: { ...account.profiles[s.asset] },
  };
  return {
    entry,
    ledger: replay(
      { ...account, entries: [...account.entries, entry] },
      entry.date,
    ),
  };
}
export function dayPair(
  entries: Entry[],
  securityId: string,
  date: string,
): DayPair {
  const buys = entries
    .filter(
      (e) => e.securityId === securityId && e.date === date && e.kind === "buy",
    )
    .map((e) => ({ q: D(e.quantity), per: D(e.fees!.cash).div(e.quantity) }));
  const sells = entries
    .filter(
      (e) =>
        e.securityId === securityId && e.date === date && e.kind === "sell",
    )
    .map((e) => ({ q: D(e.quantity), per: D(e.fees!.cash).div(e.quantity) }));
  let quantity = D(0),
    profit = D(0),
    i = 0,
    j = 0;
  while (i < buys.length && j < sells.length) {
    const b = buys[i],
      s = sells[j],
      q = Decimal.min(b.q, s.q);
    quantity = quantity.plus(q);
    profit = profit.plus(s.per.minus(b.per).mul(q));
    b.q = b.q.minus(q);
    s.q = s.q.minus(q);
    if (b.q.isZero()) i++;
    if (s.q.isZero()) j++;
  }
  return {
    quantity: quantity.toString(),
    profit: cents(profit),
    unpairedBuy: buys.reduce((v, b) => v.plus(b.q), D(0)).toString(),
    unpairedSell: sells.reduce((v, b) => v.plus(b.q), D(0)).toString(),
    cashFlow: cents(
      entries
        .filter(
          (e) =>
            e.securityId === securityId &&
            e.date === date &&
            e.kind !== "opening",
        )
        .reduce(
          (v, e) =>
            e.kind === "buy" ? v.minus(e.fees!.cash) : v.plus(e.fees!.cash),
          D(0),
        ),
    ),
  };
}
export function validateAccount(raw: unknown): Account {
  const a = raw as Account;
  if (
    !a ||
    ![2, 3, 4].includes(a.schemaVersion) ||
    typeof a.initialized !== "boolean" ||
    !Array.isArray(a.securities) ||
    !Array.isArray(a.entries) ||
    a.securities.length > 200 ||
    a.entries.length > 20000
  )
    throw new Error("备份格式无效或记录超出限制");
  if (
    a.schemaVersion >= 3 &&
    (!Array.isArray(a.cashEntries) ||
      a.cashEntries.length > 20000 ||
      a.initialCash !== "0.00")
  )
    throw new Error("新版账本资金结构无效");
  if (a.schemaVersion === 2 && a.cashEntries?.length)
    throw new Error("资金流水需要新版账本");
  if (!a.profiles || !a.feeConfirmed || typeof a.selectedId !== "string")
    throw new Error("备份缺少账户设置");
  if (!a.securities.length || !a.securities.some((s) => s.id === a.selectedId))
    throw new Error("备份缺少当前证券");
  for (const asset of ["stock", "etf"] as const) {
    if (typeof a.feeConfirmed[asset] !== "boolean" || !a.profiles[asset])
      throw new Error("费率设置无效");
    for (const field of [
      "commissionWan",
      "minimum",
      "stampPercent",
      "transferPercent",
    ] as const)
      if (
        typeof a.profiles[asset][field] !== "string" ||
        a.profiles[asset][field].length > 40
      )
        throw new Error("费率字段无效");
    validateFees({
      ...a.profiles[asset],
      commissionWan: a.profiles[asset].commissionWan || "0",
    });
    if (a.feeConfirmed[asset]) validateFees(a.profiles[asset]);
  }
  if (!a.initialized && (a.entries.length || D(a.initialCash).gt(0)))
    throw new Error("未初始化账户不能包含成交");
  replay(a);
  if (a.schemaVersion === 4) validateWorkspace(a);
  return a;
}

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import Decimal from "decimal.js";

import { validateAccount } from "../src/sim/ledger";
import { recordFees } from "../src/sim/recordMath";
import type { Account, CashEntry, Entry, Security } from "../src/sim/model";

const DB =
  "/Users/stev/Library/Application Support/com.stev.tcalculator/simulation.sqlite3";
const account2 = process.argv.includes("--account2");
const LEDGER = account2
  ? "/private/tmp/stock-calc-tencent-ledger-account-2.json"
  : "/private/tmp/stock-calc-tencent-ledger.json";
const REPO = "/private/tmp/repo-flows.tsv";
const FUNDS = "/private/tmp/fund-flows.tsv";
const apply = process.argv.includes("--apply");
const importPrefix = account2 ? "tencent-account2" : "tencent";

type SourceTrade = {
  security_id: string;
  security_name: string;
  direction: "buy" | "sell";
  trade_date: string;
  trade_time: string;
  price: string;
  quantity: string;
  gross_amount: string;
  commission: string;
  stamp: string;
  other: string;
  net_cash: string;
};

type SourceCash = {
  kind: CashEntry["kind"];
  amount: string;
  date: string;
  time: string;
  note: string;
};

type SourceLedger = {
  trades: SourceTrade[];
  cash_flows: SourceCash[];
  exceptions: Array<string | {
    security_id: string;
    security_name: string;
    issue: string;
  }>;
};

function sqlite(query: string): string {
  return execFileSync("sqlite3", [DB, query], { encoding: "utf8" });
}

function localIso(date: string, time: string): string {
  return new Date(`${date}T${time}+08:00`).toISOString();
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function tradeKey(e: Pick<Entry, "securityId" | "date" | "kind" | "price" | "quantity">) {
  return [e.securityId, e.date, e.kind, e.price, e.quantity].join("|");
}

function cashKey(e: Pick<CashEntry, "kind" | "amount" | "time">) {
  return [e.kind, new Decimal(e.amount).toFixed(2), e.time].join("|");
}

function manualTradeKey(
  e: Pick<Entry, "securityId" | "date" | "kind" | "price" | "quantity">,
) {
  return [
    e.securityId,
    e.date,
    e.kind,
    e.quantity,
    new Decimal(e.price).toString(),
  ].join("|");
}

function manualCashKey(e: Pick<CashEntry, "kind" | "amount" | "date">) {
  return [e.kind, e.date, new Decimal(e.amount).toFixed(2)].join("|");
}

function parseTsv(path: string): Record<string, string>[] {
  const [header, ...rows] = readFileSync(path, "utf8").trim().split("\n");
  const fields = header.split("\t");
  return rows.map((row) =>
    Object.fromEntries(fields.map((field, i) => [field, row.split("\t")[i] ?? ""])),
  );
}

function classify(id: string, name: string): Pick<Security, "asset" | "category" | "settlement"> {
  const code = id.slice(2);
  const asset = /^(51|52|56|58|159)/.test(code) ? "etf" : "stock";
  if (asset === "stock") return { asset, category: "stock", settlement: "T+1" };
  if (/恒生|港股|日经|沙特/.test(name))
    return { asset, category: "cross-border", settlement: "T+0" };
  if (/黄金|金ETF/.test(name)) return { asset, category: "gold", settlement: "T+0" };
  if (/豆粕/.test(name)) return { asset, category: "unconfirmed", settlement: "T+0" };
  return { asset, category: "domestic", settlement: "T+1" };
}

function makeSecurity(t: SourceTrade): Security {
  const market = t.security_id.slice(0, 2) as "sh" | "sz";
  return {
    id: t.security_id,
    market,
    code: t.security_id.slice(2),
    name: t.security_name,
    ...classify(t.security_id, t.security_name),
  };
}

const source = JSON.parse(readFileSync(LEDGER, "utf8")) as SourceLedger;
const revision = Number(sqlite("select revision from account where id=1;").trim());
const account = JSON.parse(sqlite("select payload from account where id=1;")) as Account;
let replacedEstimatedTrades = 0;
let replacedManualCash = 0;
if (account2) {
  const sourceTradeKeys = new Set(
    source.trades.map((t) =>
      manualTradeKey({
        securityId: t.security_id,
        date: t.trade_date,
        kind: t.direction,
        quantity: t.quantity,
        price: t.price,
      }),
    ),
  );
  account.entries = account.entries.filter((e) => {
    const replace = e.kind !== "opening" && e.feeSource === "estimated" && sourceTradeKeys.has(manualTradeKey(e));
    if (replace) replacedEstimatedTrades++;
    return !replace;
  });

  const manualCashCounts = new Map<string, number>();
  for (const e of source.cash_flows) {
    if (e.kind !== "deposit" && e.kind !== "withdraw") continue;
    const key = manualCashKey(e as CashEntry);
    manualCashCounts.set(key, (manualCashCounts.get(key) ?? 0) + 1);
  }
  account.cashEntries = (account.cashEntries ?? []).filter((e) => {
    const key = manualCashKey(e);
    const remaining = manualCashCounts.get(key) ?? 0;
    const replace = remaining > 0 && !e.note.trim() && !e.id.startsWith("tencent-");
    if (replace) {
      manualCashCounts.set(key, remaining - 1);
      replacedManualCash++;
    }
    return !replace;
  });
}
for (const e of account.cashEntries ?? []) {
  if (
    e.id.startsWith("tencent-cash-") &&
    e.kind === "other-income" &&
    /季度账户结息/.test(e.note)
  )
    e.kind = "interest";
}
const before = {
  securities: account.securities.length,
  entries: account.entries.length,
  cashEntries: account.cashEntries?.length ?? 0,
};

const exceptionIds = new Set(
  source.exceptions.flatMap((x) => (typeof x === "string" ? [] : [x.security_id])),
);
const existingTradeIds = new Set(account.entries.map((e) => e.id));
const existingTradeCounts = new Map<string, number>();
for (const e of account.entries) {
  if (e.kind === "opening") continue;
  const key = tradeKey(e);
  existingTradeCounts.set(key, (existingTradeCounts.get(key) ?? 0) + 1);
}

const securities = new Map(account.securities.map((s) => [s.id, s]));
const addedTrades: Entry[] = [];
let matchedTrades = 0;
let skippedExceptionTrades = 0;
for (const t of source.trades) {
  if (exceptionIds.has(t.security_id)) {
    skippedExceptionTrades++;
    continue;
  }
  const displayedPrice = t.price;
  const grossAmount = new Decimal(t.gross_amount).toFixed(2);
  let recordPrice = displayedPrice;
  if (
    new Decimal(recordPrice).mul(t.quantity).toDecimalPlaces(2).toFixed(2) !==
    grossAmount
  ) {
    recordPrice = new Decimal(grossAmount).div(t.quantity).toDecimalPlaces(6).toFixed(6);
  }
  const key = tradeKey({
    securityId: t.security_id,
    date: t.trade_date,
    kind: t.direction,
    price: recordPrice,
    quantity: t.quantity,
  });
  const time = localIso(t.trade_date, t.trade_time);
  const tradeId = stableId(`${importPrefix}-trade`, `${key}|${time}|${t.commission}|${t.stamp}|${t.other}`);
  if (account2 && existingTradeIds.has(tradeId)) {
    matchedTrades++;
    continue;
  }
  const matches = existingTradeCounts.get(key) ?? 0;
  if (!account2 && matches > 0) {
    existingTradeCounts.set(key, matches - 1);
    matchedTrades++;
    continue;
  }
  if (!securities.has(t.security_id)) securities.set(t.security_id, makeSecurity(t));
  const security = securities.get(t.security_id)!;
  const profile = { ...account.profiles[security.asset] };
  const fees = recordFees(t.direction, recordPrice, t.quantity, profile, {
    commission: t.commission,
    stamp: t.stamp,
    transfer: t.other,
  });
  const expectedCash = new Decimal(t.net_cash).abs().toFixed(2);
  if (fees.amount !== grossAmount || fees.cash !== expectedCash)
    throw new Error(`交割金额不勾稽: ${t.security_id} ${t.trade_date} ${t.trade_time}`);
  addedTrades.push({
    id: tradeId,
    securityId: t.security_id,
    kind: t.direction,
    quantity: t.quantity,
    price: recordPrice,
    time,
    date: t.trade_date,
    fees,
    profile,
    feeSource: "actual",
    note:
      recordPrice === displayedPrice
        ? `腾讯微证券交割明细补录${account2 ? "（切换账户2）" : ""}`
        : `腾讯微证券交割明细补录${account2 ? "（切换账户2）" : ""}；页面均价${displayedPrice}元，按成交金额折算精确均价${recordPrice}元`,
  });
}

const cashSources: SourceCash[] = [...source.cash_flows];
for (const row of account2 ? [] : parseTsv(REPO)) {
  cashSources.push({
    kind: "repo-interest",
    amount: new Decimal(row.interest).toFixed(2),
    date: row.date,
    time: "15:00:00",
    note: `沪市1天期收益；当次交易金额${new Decimal(row.principal).toFixed(2)}元`,
  });
}

let failedFundRows = 0;
for (const row of account2 ? [] : parseTsv(FUNDS)) {
  if (row.status !== "success") {
    failedFundRows++;
    continue;
  }
  cashSources.push({
    kind: row.direction === "in" ? "deposit" : "withdraw",
    amount: new Decimal(row.amount).toFixed(2),
    date: row.date,
    time: row.time,
    note: ["腾讯微证券银证转账", row.note].filter(Boolean).join("；"),
  });
}

const existingCashCounts = new Map<string, number>();
for (const e of account.cashEntries ?? []) {
  const key = cashKey(e);
  existingCashCounts.set(key, (existingCashCounts.get(key) ?? 0) + 1);
}
const addedCash: CashEntry[] = [];
let matchedCash = 0;
const existingCashIds = new Set((account.cashEntries ?? []).map((e) => e.id));
for (const e of cashSources) {
  const time = localIso(e.date, e.time);
  const normalized = { ...e, amount: new Decimal(e.amount).toFixed(2), time };
  const key = cashKey(normalized);
  const cashId = stableId(`${importPrefix}-cash`, `${key}|${e.note}`);
  if (account2 && existingCashIds.has(cashId)) {
    matchedCash++;
    continue;
  }
  const matches = existingCashCounts.get(key) ?? 0;
  if (!account2 && matches > 0) {
    existingCashCounts.set(key, matches - 1);
    matchedCash++;
    continue;
  }
  addedCash.push({
    id: cashId,
    kind: e.kind,
    amount: normalized.amount,
    time,
    date: e.date,
    note: e.note,
  });
}

const next: Account = {
  ...account,
  securities: [...securities.values()],
  entries: [...account.entries, ...addedTrades].sort((a, b) => a.time.localeCompare(b.time)),
  cashEntries: [...(account.cashEntries ?? []), ...addedCash].sort((a, b) =>
    a.time.localeCompare(b.time),
  ),
};
validateAccount(next);

const summary = {
  mode: apply ? "apply" : "dry-run",
  revision,
  before,
  source: {
    trades: source.trades.length,
    cash: cashSources.length,
    repoRows: account2 ? 0 : parseTsv(REPO).length,
    successfulFundRows: account2 ? 0 : parseTsv(FUNDS).length - failedFundRows,
    failedFundRows,
  },
  result: {
    securities: next.securities.length,
    entries: next.entries.length,
    cashEntries: next.cashEntries?.length ?? 0,
    addedSecurities: next.securities.length - before.securities,
    addedTrades: addedTrades.length,
    matchedTrades,
    skippedExceptionTrades,
    addedCash: addedCash.length,
    matchedCash,
    replacedEstimatedTrades,
    replacedManualCash,
  },
  exceptions: source.exceptions,
};

if (apply) {
  const payload = JSON.stringify(next).replaceAll("'", "''");
  const sql = [
    "BEGIN IMMEDIATE;",
    `UPDATE account SET revision=revision+1,payload='${payload}' WHERE id=1 AND revision=${revision};`,
    "SELECT changes();",
    "COMMIT;",
  ].join("\n");
  const changed = sqlite(sql).trim();
  if (changed !== "1") throw new Error(`数据库并发更新失败，changes=${changed}`);
}

console.log(JSON.stringify(summary, null, 2));

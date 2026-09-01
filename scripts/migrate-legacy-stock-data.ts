import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recordFees } from "../src/sim/recordMath";
import { replay, validateAccount } from "../src/sim/ledger";
import type { Account, CashEntry, Entry, Security } from "../src/sim/model";

type LegacyTrade = {
  id: number;
  stock_code: string;
  stock_name: string;
  market: "SH" | "SZ";
  direction: "BUY" | "SELL";
  quantity: number;
  price: number;
  trade_date: string;
  trade_time: string | null;
  fee_commission: number;
  fee_transfer: number;
  fee_stamp_duty: number;
};

type LegacyCash = {
  id: number;
  flow_date: string;
  type: "DEPOSIT" | "WITHDRAW";
  amount: number;
  note: string;
};

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const completeDb =
  process.env.LEGACY_COMPLETE_DB ??
  "/Users/stev/Desktop/ztech/code/z-stock-pre/z-stock.db";
const cashDb =
  process.env.LEGACY_CASH_DB ??
  "/Users/stev/Desktop/ztech/z-stock-pre/data/z-stock.sqlite";
const targetDb =
  process.env.TCALCULATOR_DB ??
  "/Users/stev/Library/Application Support/com.stev.tcalculator/simulation.sqlite3";

function sqliteJson<T>(db: string, sql: string, immutable = false): T[] {
  const source = immutable ? `file:${db}?mode=ro&immutable=1` : db;
  const output = execFileSync("sqlite3", ["-readonly", "-json", source, sql], {
    encoding: "utf8",
  });
  return output.trim() ? (JSON.parse(output) as T[]) : [];
}

function sqlText(value: string): string {
  return `CAST(X'${Buffer.from(value).toString("hex")}' AS TEXT)`;
}

function shanghaiIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

const sourceTrades = sqliteJson<LegacyTrade>(
  completeDb,
  `SELECT id,stock_code,stock_name,market,direction,quantity,price,trade_date,
          trade_time,fee_commission,fee_transfer,fee_stamp_duty
     FROM trades
    ORDER BY trade_date,COALESCE(trade_time,''),id`,
);
const sourceCash = sqliteJson<LegacyCash>(
  cashDb,
  `SELECT id,flow_date,type,amount,note
     FROM cash_flows
    WHERE type IN ('DEPOSIT','WITHDRAW')
    ORDER BY flow_date,id`,
  true,
);
const targetRows = sqliteJson<{ revision: number; payload: string }>(
  targetDb,
  "SELECT revision,payload FROM account WHERE id=1",
);
if (targetRows.length !== 1) throw new Error("当前 T刻账户不存在或不唯一");

const before = validateAccount(JSON.parse(targetRows[0].payload));
const merged = structuredClone(before) as Account;
const securityById = new Map(merged.securities.map((security) => [security.id, security]));
const addedSecurities: Security[] = [];

for (const row of sourceTrades) {
  const market = row.market.toLowerCase() as "sh" | "sz";
  const code = row.stock_code.replace(/^(SH|SZ)\./i, "");
  const id = market + code;
  if (!securityById.has(id)) {
    const security: Security = {
      id,
      market,
      code,
      name: row.stock_name,
      asset: "stock",
      category: "stock",
      settlement: "T+1",
    };
    merged.securities.push(security);
    securityById.set(id, security);
    addedSecurities.push(security);
  }
}

const tradeIds = new Set(merged.entries.map((entry) => entry.id));
const addedTrades: Entry[] = [];
for (const row of sourceTrades) {
  const id = `legacy-zstock-trade-${row.id}`;
  if (tradeIds.has(id)) continue;
  const market = row.market.toLowerCase();
  const code = row.stock_code.replace(/^(SH|SZ)\./i, "");
  const kind = row.direction.toLowerCase() as "buy" | "sell";
  const profile = { ...merged.profiles.stock };
  const price = String(row.price);
  const quantity = String(row.quantity);
  const fees = recordFees(kind, price, quantity, profile, {
    commission: Number(row.fee_commission).toFixed(2),
    transfer: Number(row.fee_transfer).toFixed(2),
    stamp: Number(row.fee_stamp_duty).toFixed(2),
  });
  const entry: Entry = {
    id,
    securityId: market + code,
    kind,
    quantity,
    price,
    time: shanghaiIso(row.trade_date, row.trade_time || "12:00"),
    date: row.trade_date,
    fees,
    profile,
    feeSource: "actual",
    note: `从旧版 z-stock-pre 迁移（原成交 #${row.id}）`,
  };
  merged.entries.push(entry);
  tradeIds.add(id);
  addedTrades.push(entry);
}
merged.entries.sort((left, right) => left.time.localeCompare(right.time));

const cashIds = new Set((merged.cashEntries ?? []).map((entry) => entry.id));
const addedCash: CashEntry[] = [];
for (const row of sourceCash) {
  const id = `legacy-zstock-cash-${row.id}`;
  if (cashIds.has(id)) continue;
  const cash: CashEntry = {
    id,
    kind: row.type === "DEPOSIT" ? "deposit" : "withdraw",
    amount: Math.abs(row.amount).toFixed(2),
    time: shanghaiIso(row.flow_date, "15:00"),
    date: row.flow_date,
    note: row.note || `从旧版 z-stock-pre 迁移（原资金流水 #${row.id}）`,
  };
  (merged.cashEntries ??= []).push(cash);
  cashIds.add(id);
  addedCash.push(cash);
}
merged.cashEntries!.sort((left, right) => left.time.localeCompare(right.time));

if (merged.workspace) {
  for (const security of addedSecurities) {
    if (!merged.workspace.watchlist.includes(security.id))
      merged.workspace.watchlist.push(security.id);
  }
}

validateAccount(merged);
const ledger = replay(merged);
const report = {
  mode: apply ? "applied" : "dry-run",
  source: {
    completeDb,
    completeTrades: sourceTrades.length,
    cashDb,
    cashEntries: sourceCash.length,
  },
  before: {
    revision: targetRows[0].revision,
    securities: before.securities.length,
    trades: before.entries.length,
    cashEntries: before.cashEntries?.length ?? 0,
  },
  added: {
    securities: addedSecurities.map(({ id, name }) => ({ id, name })),
    trades: addedTrades.length,
    cashEntries: addedCash.map(({ kind, amount, date }) => ({ kind, amount, date })),
  },
  after: {
    revision: targetRows[0].revision + (apply ? 1 : 0),
    securities: merged.securities.length,
    trades: merged.entries.length,
    cashEntries: merged.cashEntries?.length ?? 0,
    cash: ledger.cash,
    deposits: ledger.deposits,
    withdrawals: ledger.withdrawals,
    fees: ledger.fees,
  },
};

if (apply) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(dirname(targetDb), "migration-backups", stamp);
  mkdirSync(backupDir, { recursive: true });
  const databaseBackup = join(backupDir, "simulation-before.sqlite3");
  execFileSync("sqlite3", [targetDb, `.backup '${databaseBackup.replaceAll("'", "''")}'`]);
  writeFileSync(join(backupDir, "account-before.json"), JSON.stringify(before, null, 2));

  const payload = JSON.stringify(merged);
  const revision = targetRows[0].revision;
  const sql = `BEGIN IMMEDIATE;
    INSERT OR REPLACE INTO recovery(revision,payload) VALUES(${revision},${sqlText(targetRows[0].payload)});
    UPDATE account SET revision=${revision + 1},payload=${sqlText(payload)}
      WHERE id=1 AND revision=${revision};
    SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('revision conflict') END;
    DELETE FROM recovery WHERE revision NOT IN
      (SELECT revision FROM recovery ORDER BY revision DESC LIMIT 20);
    COMMIT;`;
  execFileSync("sqlite3", [targetDb, sql]);

  const saved = sqliteJson<{ revision: number; payload: string }>(
    targetDb,
    "SELECT revision,payload FROM account WHERE id=1",
  );
  if (saved[0]?.revision !== revision + 1)
    throw new Error("迁移后版本号校验失败");
  validateAccount(JSON.parse(saved[0].payload));
  Object.assign(report, { backupDir });
  writeFileSync(join(backupDir, "account-after.json"), JSON.stringify(merged, null, 2));
  writeFileSync(join(backupDir, "migration-report.json"), JSON.stringify(report, null, 2));
}

console.log(JSON.stringify(report, null, 2));

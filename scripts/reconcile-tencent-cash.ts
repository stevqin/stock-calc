import { execFileSync } from "node:child_process";

import Decimal from "decimal.js";

import { replay, validateAccount } from "../src/sim/ledger";
import type { Account } from "../src/sim/model";

const DB =
  "/Users/stev/Library/Application Support/com.stev.tcalculator/simulation.sqlite3";
const apply = process.argv.includes("--apply");
const targetCash = new Decimal("54.98");
const legacyId = "legacy-zstock-cash-1";
const duplicateId = "0d7ad551-cfa7-454c-b89b-002104508ebb";
const openingDate = "2024-09-27";
const openingTime = "2024-09-27T01:00:00.000Z"; // 09:00 Asia/Shanghai, before the first trade

function sqlite(query: string): string {
  return execFileSync("sqlite3", [DB, query], { encoding: "utf8" });
}

const revision = Number(sqlite("select revision from account where id=1;").trim());
const account = validateAccount(
  JSON.parse(sqlite("select payload from account where id=1;")),
);
const before = replay(account);
const legacy = account.cashEntries?.find((entry) => entry.id === legacyId);
const duplicate = account.cashEntries?.find((entry) => entry.id === duplicateId);

if (!legacy) throw new Error(`找不到旧版期初资金记录 ${legacyId}`);

let next: Account;
if (!duplicate) {
  if (!new Decimal(before.cash).eq(targetCash)) {
    throw new Error(`重复期初资金已不存在，但当前现金 ${before.cash} 不是目标 ${targetCash}`);
  }
  next = {
    ...account,
    cashEntries: account.cashEntries?.map((entry) =>
      entry.id === legacyId
        ? {
            ...entry,
            date: openingDate,
            time: openingTime,
            note:
              "旧版期初资金；金额按腾讯微证券两账户完整流水及第一账户可用资金0元对账校正，时间置于首笔历史成交前",
          }
        : entry,
    ),
  };
} else {
  if (
    legacy.kind !== "deposit" ||
    legacy.amount !== "80000.00" ||
    duplicate.kind !== "deposit" ||
    duplicate.amount !== "7598.08" ||
    duplicate.note.trim()
  ) {
    throw new Error("旧版期初资金记录与已核对的快照不一致，停止修改");
  }

  const reduction = new Decimal(before.cash).minus(targetCash);
  const correctedLegacy = new Decimal(legacy.amount)
    .plus(duplicate.amount)
    .minus(reduction)
    .toFixed(2);

  next = {
    ...account,
    cashEntries: account.cashEntries?.flatMap((entry) => {
      if (entry.id === duplicateId) return [];
      if (entry.id !== legacyId) return [entry];
      return [
        {
          ...entry,
          amount: correctedLegacy,
          date: openingDate,
          time: openingTime,
          note:
            "旧版期初资金；金额按腾讯微证券两账户完整流水及第一账户可用资金0元对账校正，时间置于首笔历史成交前",
        },
      ];
    }),
  };
  validateAccount(next);
}

const after = replay(next);
if (!new Decimal(after.cash).eq(targetCash)) {
  throw new Error(`校正后现金 ${after.cash} 不是目标 ${targetCash}`);
}

const changed = JSON.stringify(next) !== JSON.stringify(account);
if (apply && changed) {
  const payload = JSON.stringify(next).replaceAll("'", "''");
  const sql = [
    "BEGIN IMMEDIATE;",
    `UPDATE account SET revision=revision+1,payload='${payload}' WHERE id=1 AND revision=${revision};`,
    "SELECT changes();",
    "COMMIT;",
  ].join("\n");
  const updated = sqlite(sql).trim();
  if (updated !== "1") throw new Error(`数据库并发更新失败，changes=${updated}`);
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      revision,
      alreadyReconciled: !duplicate,
      changed,
      before: {
        cash: before.cash,
        capital: before.capital,
        cashEntries: account.cashEntries?.length ?? 0,
      },
      after: {
        cash: after.cash,
        capital: after.capital,
        cashEntries: next.cashEntries?.length ?? 0,
        legacyOpeningCash: next.cashEntries?.find((entry) => entry.id === legacyId)?.amount,
        legacyOpeningTime: next.cashEntries?.find((entry) => entry.id === legacyId)?.time,
        cashWarnings: after.cashWarnings,
      },
    },
    null,
    2,
  ),
);

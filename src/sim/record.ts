import Decimal from "decimal.js";
import { numberInput, type FeeResult } from "../core/calculator";
import { recordFees } from "./recordMath";
import { newAccount, replay, validateAccount } from "./ledger";
import {
  shanghaiDate,
  type Account,
  type Entry,
  type CashEntry,
} from "./model";
export const cashLabels: Record<CashEntry["kind"], string> = {
  deposit: "转入资金",
  withdraw: "转出资金",
  "repo-interest": "国债逆回购利息",
  interest: "账户利息",
  "other-income": "其他收入",
  "legacy-balance": "旧版期初余额",
};
export { recordQuantity, recordFees } from "./recordMath";
export function manualAccount(
  legacy?: Parameters<typeof newAccount>[0],
): Account {
  return {
    ...newAccount(legacy),
    schemaVersion: 3,
    initialized: true,
    cashEntries: [],
  };
}
/** Preserve v2 funds and records, never manufacture a new 100k account. */
export function upgradeAccount(raw: unknown): Account {
  const a = validateAccount(raw);
  if (a.schemaVersion >= 3) return a;
  const time = a.entries[0]?.time ?? new Date().toISOString();
  return {
    ...a,
    schemaVersion: 3,
    initialized: true,
    initialCash: "0.00",
    cashEntries: new Decimal(a.initialCash).gt(0)
      ? [
          {
            id: "legacy-opening-cash",
            kind: "legacy-balance",
            amount: a.initialCash,
            time,
            date: shanghaiDate(new Date(time)),
            note: "从旧版初始化余额迁移，请与证券账户核对",
          },
        ]
      : [],
  };
}
export function insertRecord(a: Account, e: Entry) {
  a.entries.push(e);
  a.entries.sort((a, b) => a.time.localeCompare(b.time));
}
export function draftRecord(
  account: Account,
  securityId: string,
  side: "buy" | "sell",
  price: string,
  quantity: string,
  time: string,
  note = "",
  actual?: Pick<FeeResult, "commission" | "stamp" | "transfer">,
) {
  const s = account.securities.find((s) => s.id === securityId);
  if (!s) throw new Error("请选择证券");
  if (!actual && !account.feeConfirmed[s.asset])
    throw new Error("请确认费率，或切换为按交割单填写实际手续费");
  if (Date.parse(time) > Date.now()) throw new Error("记录时间不能晚于现在");
  const profile = { ...account.profiles[s.asset] };
  const fees = recordFees(side, price, quantity, profile, actual);
  const entry: Entry = {
    id: crypto.randomUUID(),
    securityId,
    kind: side,
    price,
    quantity,
    time,
    date: shanghaiDate(new Date(time)),
    fees,
    profile,
    feeSource: actual ? "actual" : "estimated",
    note,
  };
  const next = { ...account, entries: [...account.entries] };
  insertRecord(next, entry);
  return { entry, ledger: replay(next) };
}
export function draftCash(
  kind: Exclude<CashEntry["kind"], "legacy-balance">,
  amount: string,
  time: string,
  note = "",
): CashEntry {
  const n = numberInput(amount, "金额", "0.01", "1000000000000");
  if (n.decimalPlaces() > 2) throw new Error("金额最多两位小数");
  return {
    id: crypto.randomUUID(),
    kind,
    amount: n.toFixed(2),
    time,
    date: shanghaiDate(new Date(time)),
    note,
  };
}

import type { FeeResult } from "../core/calculator";
import type { Account, CashEntry, Entry } from "./model";
import { shanghaiDate } from "./model";
import { validateAccount } from "./ledger";
import { recordFees } from "./recordMath";

export type HistoryTarget = {
  scope: "trade" | "cash";
  id: string;
  action: "edit" | "delete";
};
export interface TradeEdit {
  kind: Entry["kind"];
  price: string;
  quantity: string;
  available?: string;
  time: string;
  note: string;
  feeSource: "estimated" | "actual";
  actualFees: Pick<FeeResult, "commission" | "stamp" | "transfer">;
}
export type CashEdit = Pick<CashEntry, "kind" | "amount" | "time" | "note">;

/** Work on a detached candidate: invalid dependent records never alter the source. */
function changeHistory(a: Account, change: (next: Account) => void): Account {
  if (a.schemaVersion < 3) throw new Error("请先迁移为手工账本");
  const next = JSON.parse(JSON.stringify(a)) as Account;
  change(next);
  // Stable sort preserves original order for records with identical timestamps.
  next.entries.sort((x, y) => x.time.localeCompare(y.time));
  next.cashEntries!.sort((x, y) => x.time.localeCompare(y.time));
  validateAccount(next);
  return next;
}

export function editTrade(a: Account, id: string, edit: TradeEdit): Account {
  return changeHistory(a, (next) => {
    const e = next.entries.find((e) => e.id === id);
    if (!e) throw new Error("记录已不存在，请重新加载");
    if ((e.kind === "opening") !== (edit.kind === "opening"))
      throw new Error("期初持仓不能与买卖成交互相转换");
    Object.assign(e, {
      kind: edit.kind,
      price: edit.price,
      quantity: edit.quantity,
      time: edit.time,
      date: shanghaiDate(new Date(edit.time)),
      note: edit.note,
    });
    if (e.kind === "opening") {
      e.available = edit.available;
    } else {
      if (!e.profile) throw new Error("记录缺少原始费率，请核对备份");
      e.feeSource = edit.feeSource;
      e.fees = recordFees(
        e.kind,
        e.price,
        e.quantity,
        e.profile,
        edit.feeSource === "actual" ? edit.actualFees : undefined,
      );
    }
  });
}

export function editCash(a: Account, id: string, edit: CashEdit): Account {
  return changeHistory(a, (next) => {
    const e = next.cashEntries!.find((e) => e.id === id);
    if (!e) throw new Error("记录已不存在，请重新加载");
    if (edit.kind === "legacy-balance" && e.kind !== "legacy-balance")
      throw new Error("不能将普通流水转换为旧版迁移余额");
    Object.assign(e, {
      kind: edit.kind,
      amount: edit.amount,
      time: edit.time,
      note: edit.note,
      date: shanghaiDate(new Date(edit.time)),
    });
  });
}

export function deleteHistory(
  a: Account,
  scope: HistoryTarget["scope"],
  id: string,
): Account {
  return changeHistory(a, (next) => {
    const rows = scope === "trade" ? next.entries : next.cashEntries!;
    const i = rows.findIndex((e) => e.id === id);
    if (i < 0) throw new Error("记录已不存在，请重新加载");
    rows.splice(i, 1);
  });
}

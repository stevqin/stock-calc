import type { Account } from "../sim/model";
import { shanghaiDate } from "../sim/model";
import { replay } from "../sim/ledger";
import { positionContext } from "./positionContext";
export interface CashContext {
  asOf: string;
  source: "localLedger";
  balance: string;
  initialized: boolean;
  hasWarnings: boolean;
}
export function accountContext(
  account: Account,
  securityId: string,
  asOf: string,
) {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error("账户截止时间无效");
  asOf = new Date(cutoff).toISOString();
  const frozen = {
    ...account,
    entries: account.entries
      .filter((e) => Date.parse(e.time) <= cutoff)
      .map((e) => ({ ...e, time: new Date(e.time).toISOString() })),
    cashEntries: account.cashEntries
      ?.filter((e) => Date.parse(e.time) <= cutoff)
      .map((e) => ({ ...e, time: new Date(e.time).toISOString() })),
  };
  const ledger = replay(frozen, shanghaiDate(new Date(asOf)));
  return {
    position: positionContext(
      frozen,
      securityId,
      ledger.positions[securityId],
      asOf,
    ),
    cash: {
      asOf,
      source: "localLedger" as const,
      balance: ledger.cash,
      initialized: account.initialized,
      hasWarnings: ledger.cashWarnings > 0,
    },
  };
}

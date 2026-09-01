import Decimal from "decimal.js";
import type { Entry } from "./model";

/** Display-only labels; an intraday liquidation does not reset the accounting cycle. */
export function tradeLabels(entries: Entry[]): Record<string, string> {
  const quantities = new Map<string, Decimal>();
  const labels: Record<string, string> = {};
  // Stable ordering matches ledger replay when timestamps are identical.
  for (const e of [...entries].sort((a, b) => a.time.localeCompare(b.time))) {
    const before = quantities.get(e.securityId) ?? new Decimal(0);
    const after = before.plus(
      new Decimal(e.quantity).mul(e.kind === "sell" ? -1 : 1),
    );
    quantities.set(e.securityId, after);
    labels[e.id] =
      e.kind === "opening"
        ? "建仓"
        : e.kind === "buy"
          ? "买入"
          : before.gt(0) && after.isZero()
            ? "清仓"
            : "卖出";
  }
  return labels;
}

import type { Account, Position } from "../sim/model";
import { analyzeTradeStages } from "../sim/tradeStages";
export function positionContext(
  account: Account,
  securityId: string,
  position: Position | undefined,
  asOf: string,
) {
  const security = account.securities.find((s) => s.id === securityId);
  if (!security || !position || Number(position.quantity) <= 0) return null;
  const entries = account.entries.filter(
    (e) => e.securityId === securityId && e.time <= asOf,
  );
  const stage = analyzeTradeStages(entries, securityId).stages.find(
    (s) => s.status === "open",
  );
  if (!stage) return null;
  const ids = new Set(stage.entryIds);
  return {
    securityId,
    asOf,
    quantity: position.quantity,
    available: position.available,
    cost: position.cost,
    averageCost: position.averageCost,
    netInvestment: position.netInvestment,
    dilutedCost: position.dilutedCost,
    settlement: security.settlement,
    roundStart: stage.start,
    feeConfirmed: account.feeConfirmed[security.asset],
    feeProfile: { ...account.profiles[security.asset] },
    trades: entries
      .filter((e) => ids.has(e.id))
      .map((e) => ({
        id: e.id,
        securityId: e.securityId,
        kind: e.kind,
        quantity: e.quantity,
        price: e.price,
        time: e.time,
        date: e.date,
        note: e.note ?? "",
        fees: e.fees ? { ...e.fees } : null,
        feeSource: e.feeSource ?? "unknown",
      })),
  };
}
export type PositionContext = NonNullable<ReturnType<typeof positionContext>>;

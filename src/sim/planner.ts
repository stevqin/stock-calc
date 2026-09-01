import Decimal from "decimal.js";
import {
  calculateFee,
  priceInput,
  quantityInput,
  type Asset,
  type FeeProfile,
} from "../core/calculator";
export interface PlanInput {
  asset: Asset;
  buyPrice: string;
  sellPrice: string;
  buyQty: string;
  sellQty: string;
  fees: FeeProfile;
}
export function estimatePlan(p: PlanInput) {
  const buy = calculateFee({
    asset: p.asset,
    side: "buy",
    price: p.buyPrice,
    quantity: p.buyQty,
    fees: p.fees,
  });
  const sell = calculateFee({
    asset: p.asset,
    side: "sell",
    price: p.sellPrice,
    quantity: p.sellQty,
    fees: p.fees,
  });
  const matched = Decimal.min(p.buyQty, p.sellQty);
  const net = new Decimal(sell.cash)
    .div(p.sellQty)
    .minus(new Decimal(buy.cash).div(p.buyQty))
    .mul(matched);
  return {
    buy,
    sell,
    matched: matched.toString(),
    profit: net.toFixed(2),
    exactProfit: net.toString(),
    gross: new Decimal(p.sellPrice).minus(p.buyPrice).mul(matched).toFixed(2),
    allocatedFees: new Decimal(buy.total)
      .div(p.buyQty)
      .plus(new Decimal(sell.total).div(p.sellQty))
      .mul(matched)
      .toFixed(2),
    cashFlow: new Decimal(sell.cash).minus(buy.cash).toFixed(2),
    change: new Decimal(p.buyQty).minus(p.sellQty).toString(),
    fees: new Decimal(buy.total).plus(sell.total).toFixed(2),
  };
}
export interface HoldingProjection {
  quantity: string;
  netInvestment: string;
  dilutedCost: string | null;
  marketValue: string | null;
  profit: string | null;
  profitPercent: string | null;
  error: string;
}
/** Project the whole current holding after both full orders, including unmatched shares. */
export function projectHolding(
  result: ReturnType<typeof estimatePlan>,
  currentQuantity: string,
  currentNetInvestment: string,
  referencePrice?: string,
): HoldingProjection {
  const quantity = new Decimal(currentQuantity).plus(result.change);
  if (!quantity.isFinite() || quantity.lt(0))
    return {
      quantity: quantity.toString(),
      netInvestment: "0",
      dilutedCost: null,
      marketValue: null,
      profit: null,
      profitPercent: null,
      error: "测算后持仓为负，无法计算持仓指标",
    };
  const netInvestment = new Decimal(currentNetInvestment)
    .plus(result.buy.cash)
    .minus(result.sell.cash);
  if (quantity.isZero())
    return {
      quantity: "0",
      netInvestment: netInvestment.toFixed(2),
      dilutedCost: null,
      marketValue: "0.00",
      profit: null,
      profitPercent: null,
      error: "测算后清仓，本轮持仓指标结束",
    };
  const dilutedCost = netInvestment.div(quantity);
  const price = referencePrice ? new Decimal(referencePrice) : null;
  const validPrice = price?.isFinite() && price.gt(0) ? price : null;
  const marketValue = validPrice ? validPrice.mul(quantity) : null;
  const profit = marketValue ? marketValue.minus(netInvestment) : null;
  return {
    quantity: quantity.toString(),
    netInvestment: netInvestment.toFixed(2),
    dilutedCost: dilutedCost.toFixed(4),
    marketValue: marketValue?.toFixed(2) ?? null,
    profit: profit?.toFixed(2) ?? null,
    profitPercent:
      profit && netInvestment.gt(0)
        ? profit.div(netInvestment).mul(100).toFixed(2)
        : null,
    error: validPrice ? "" : "缺少参考现价，暂不计算持仓收益",
  };
}
/** Full-order commissions prorated onto matched quantity; cash flow is never called profit. */
export function solvePlan(
  p: PlanInput,
  side: "buy" | "sell",
  target: string,
): string | null {
  const goal = new Decimal(target);
  if (!goal.isFinite() || goal.lt(0) || goal.gt("100000000"))
    throw new Error("目标利润须为0至1亿元");
  quantityInput(p.buyQty);
  quantityInput(p.sellQty);
  priceInput(side === "sell" ? p.buyPrice : p.sellPrice, p.asset);
  const step = new Decimal(p.asset === "stock" ? ".01" : ".001");
  const passes = (tick: number) =>
    new Decimal(
      estimatePlan({
        ...p,
        [side === "sell" ? "sellPrice" : "buyPrice"]: step.mul(tick).toString(),
      }).exactProfit,
    ).gte(goal);
  let lo = 1,
    hi = Number(new Decimal(1000000).div(step));
  if ((side === "sell" && !passes(hi)) || (side === "buy" && !passes(lo)))
    return null;
  while (lo < hi) {
    const mid =
      side === "sell" ? Math.floor((lo + hi) / 2) : Math.ceil((lo + hi) / 2);
    if (side === "sell") {
      if (passes(mid)) hi = mid;
      else lo = mid + 1;
    } else {
      if (passes(mid)) lo = mid;
      else hi = mid - 1;
    }
  }
  return passes(lo) ? step.mul(lo).toFixed(p.asset === "stock" ? 2 : 3) : null;
}

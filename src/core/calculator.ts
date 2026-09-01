import Decimal from "decimal.js";

Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
export type Asset = "stock" | "etf";
export type Direction = "buy-first" | "sell-first";
export interface FeeProfile {
  commissionWan: string;
  minimum: string;
  stampPercent: string;
  transferPercent: string;
}
export const defaults: Record<Asset, FeeProfile> = {
  stock: {
    commissionWan: "2.5",
    minimum: "5",
    stampPercent: "0.05",
    transferPercent: "0.001",
  },
  etf: {
    commissionWan: "2.5",
    minimum: "5",
    stampPercent: "0",
    transferPercent: "0",
  },
};
export interface TradeInput {
  asset: Asset;
  price: string;
  quantity: string;
  side: "buy" | "sell";
  fees: FeeProfile;
}
export interface RoundTripInput {
  asset: Asset;
  buyPrice: string;
  sellPrice: string;
  quantity: string;
  fees: FeeProfile;
}
export interface FeeResult {
  amount: string;
  commission: string;
  transfer: string;
  stamp: string;
  total: string;
  cash: string;
}
export interface RoundTripResult {
  buy: FeeResult;
  sell: FeeResult;
  gross: string;
  totalFees: string;
  net: string;
  spread: string;
  unitCost: string;
}
export const priceDecimals = (asset: Asset) => (asset === "stock" ? 2 : 3);
export const tickSize = (asset: Asset) =>
  asset === "stock" ? "0.01" : "0.001";
export const money = (value: Decimal.Value) => new Decimal(value).toFixed(2);

export function numberInput(
  value: string,
  label: string,
  min = "0",
  max = "1000000000000",
): Decimal {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^-?\d+(\.\d+)?$/.test(value)
  )
    throw new Error(`请填写有效的${label}`);
  const d = new Decimal(value);
  if (!d.isFinite() || d.lt(min) || d.gt(max))
    throw new Error(`${label}须在 ${min} 至 ${max} 之间`);
  return d;
}
export function validateFees(fees: FeeProfile): void {
  numberInput(fees.commissionWan, "佣金率（万分之）", "0", "30");
  numberInput(fees.minimum, "最低佣金", "0", "10000");
  numberInput(fees.stampPercent, "印花税率（%）", "0", "1");
  numberInput(fees.transferPercent, "过户费率（%）", "0", "1");
}
export function quantityInput(quantity: string): Decimal {
  const q = numberInput(quantity, "交易数量", "100", "100000000");
  if (!q.isInteger() || !q.mod(100).isZero())
    throw new Error("交易数量须为100的整数倍；首版不测算零股交易");
  return q;
}
export function priceInput(price: string, asset: Asset): Decimal {
  const p = numberInput(price, "价格", tickSize(asset), "1000000");
  if (!p.mod(tickSize(asset)).isZero())
    throw new Error(`价格须为 ${tickSize(asset)} 元的整数倍`);
  return p;
}
export function calculateFee(input: TradeInput): FeeResult {
  validateFees(input.fees);
  const amount = priceInput(input.price, input.asset)
    .mul(quantityInput(input.quantity))
    .toDecimalPlaces(2);
  const commission = Decimal.max(
    amount.mul(input.fees.commissionWan).div(10000),
    input.fees.minimum,
  ).toDecimalPlaces(2);
  const transfer = amount
    .mul(input.fees.transferPercent)
    .div(100)
    .toDecimalPlaces(2);
  const stamp =
    input.side === "sell"
      ? amount.mul(input.fees.stampPercent).div(100).toDecimalPlaces(2)
      : new Decimal(0);
  const total = commission.plus(transfer).plus(stamp);
  return {
    amount: money(amount),
    commission: money(commission),
    transfer: money(transfer),
    stamp: money(stamp),
    total: money(total),
    cash: money(
      input.side === "buy" ? amount.plus(total) : amount.minus(total),
    ),
  };
}
export function calculateRoundTrip(input: RoundTripInput): RoundTripResult {
  const buy = calculateFee({ ...input, price: input.buyPrice, side: "buy" });
  const sell = calculateFee({ ...input, price: input.sellPrice, side: "sell" });
  return {
    buy,
    sell,
    gross: money(new Decimal(sell.amount).minus(buy.amount)),
    totalFees: money(new Decimal(buy.total).plus(sell.total)),
    net: money(new Decimal(sell.cash).minus(buy.cash)),
    spread: new Decimal(input.sellPrice)
      .minus(input.buyPrice)
      .toFixed(priceDecimals(input.asset)),
    unitCost: new Decimal(buy.cash).div(input.quantity).toFixed(4),
  };
}

/** Discrete binary search: bounded rates and 100-unit lots keep cash monotone even after fee rounding. */
export function solvePrice(
  input: Omit<RoundTripInput, "buyPrice" | "sellPrice"> & {
    direction: Direction;
    anchor: string;
    target: string;
  },
): string | null {
  const target = numberInput(input.target, "目标净利润");
  if (target.decimalPlaces() > 2) throw new Error("目标净利润最多保留两位小数");
  priceInput(input.anchor, input.asset);
  quantityInput(input.quantity);
  validateFees(input.fees);
  const tick = new Decimal(tickSize(input.asset));
  const at = (n: number) => tick.mul(n).toFixed(priceDecimals(input.asset));
  const satisfies = (n: number) =>
    new Decimal(
      calculateRoundTrip({
        ...input,
        buyPrice: input.direction === "buy-first" ? input.anchor : at(n),
        sellPrice: input.direction === "buy-first" ? at(n) : input.anchor,
      }).net,
    ).gte(target);
  let low = 1;
  let high = new Decimal(1000000).div(tick).toNumber();
  if (input.direction === "buy-first") {
    if (!satisfies(high)) return null;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (satisfies(mid)) high = mid;
      else low = mid + 1;
    }
  } else {
    if (!satisfies(low)) return null;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (satisfies(mid)) low = mid;
      else high = mid - 1;
    }
  }
  return at(low);
}

export function holdingCost(
  quantity: string,
  cost: string,
  tradeQuantity: string,
  profit: string,
) {
  const q = numberInput(quantity, "原持仓数量", "1", "100000000");
  if (!q.isInteger()) throw new Error("原持仓数量须为整数");
  if (q.lt(quantityInput(tradeQuantity)))
    throw new Error("做T数量超过原持仓，不能按持仓不变计算摊薄成本");
  const oldCost = numberInput(cost, "原每股成本", "-1000000", "1000000");
  const change = new Decimal(profit).div(q);
  return {
    before: oldCost.toFixed(4),
    after: oldCost.minus(change).toFixed(4),
    reduction: change.toFixed(4),
  };
}

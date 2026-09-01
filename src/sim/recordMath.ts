import Decimal from "decimal.js";
import {
  numberInput,
  validateFees,
  type FeeProfile,
  type FeeResult,
} from "../core/calculator";
export function recordQuantity(q: string) {
  const n = numberInput(q, "成交数量", "1", "100000000");
  if (!n.isInteger()) throw new Error("成交数量须为整数");
  return n;
}
export function recordFees(
  side: "buy" | "sell",
  price: string,
  quantity: string,
  profile: FeeProfile,
  actual?: Pick<FeeResult, "commission" | "stamp" | "transfer">,
): FeeResult {
  const p = numberInput(price, "成交价格", "0.000001", "1000000");
  if (p.decimalPlaces() > 6) throw new Error("历史成交均价最多6位小数");
  const amount = p.mul(recordQuantity(quantity)).toDecimalPlaces(2);
  let commission: Decimal, stamp: Decimal, transfer: Decimal;
  if (actual) {
    const read = (v: string) => {
      const d = numberInput(v, "实际费用", "0", "100000000");
      if (d.decimalPlaces() > 2) throw new Error("实际费用最多两位小数");
      return d;
    };
    commission = read(actual.commission);
    stamp = read(actual.stamp);
    transfer = read(actual.transfer);
  } else {
    validateFees(profile);
    commission = Decimal.max(
      amount.mul(profile.commissionWan).div(10000),
      profile.minimum,
    ).toDecimalPlaces(2);
    transfer = amount.mul(profile.transferPercent).div(100).toDecimalPlaces(2);
    stamp =
      side === "sell"
        ? amount.mul(profile.stampPercent).div(100).toDecimalPlaces(2)
        : new Decimal(0);
  }
  const total = commission.plus(stamp).plus(transfer);
  return {
    amount: amount.toFixed(2),
    commission: commission.toFixed(2),
    stamp: stamp.toFixed(2),
    transfer: transfer.toFixed(2),
    total: total.toFixed(2),
    cash: (side === "buy" ? amount.plus(total) : amount.minus(total)).toFixed(
      2,
    ),
  };
}

import Decimal from "decimal.js";

const CAPITAL_LEVELS = [5000, 10000, 20000, 30000, 50000, 80000, 100000];

/** Gross trade amounts, rounded down to whole lots; never changes entered quantity. */
export function quantityShortcuts(price: string): string[] {
  const quantities = new Set(["100"]);
  try {
    const value = new Decimal(price);
    if (!value.isFinite() || value.lte(0)) return [...quantities];
    for (const capital of CAPITAL_LEVELS) {
      const quantity = new Decimal(capital)
        .div(value)
        .div(100)
        .floor()
        .mul(100);
      if (quantity.gte(100) && quantity.lte(1000000000)) {
        quantities.add(quantity.toFixed(0));
      }
    }
  } catch {
    // Incomplete input keeps the minimum shortcut available.
  }
  return [...quantities];
}

import { expect, it } from "vitest";
import { quantityShortcuts } from "./quantityShortcuts";

it.each(["", "abc", "0", "-3.4", "NaN", "Infinity"])(
  "无有效价格 %s 时仅保留100股",
  (price) => {
    expect(quantityShortcuts(price)).toEqual(["100"]);
  },
);
it("价格精确落在资金档位时不丢失一手，高价档位去重", () => {
  expect(quantityShortcuts("3.125")).toEqual([
    "100",
    "1600",
    "3200",
    "6400",
    "9600",
    "16000",
    "25600",
    "32000",
  ]);
  expect(quantityShortcuts("200")).toEqual(["100", "200", "400", "500"]);
});
it("ETF低价仍产生整数整手，快捷数量不超过输入上限", () => {
  const quantities = quantityShortcuts("0.001").map(Number);
  expect(quantities.at(-1)).toBe(100000000);
  expect(
    quantities.every(
      (q) => Number.isSafeInteger(q) && q % 100 === 0 && q <= 1000000000,
    ),
  ).toBe(true);
  expect(quantityShortcuts("1e-30")).toEqual(["100"]);
});

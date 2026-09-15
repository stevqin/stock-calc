import { expect, it } from "vitest";
import {
  movingAverage,
  macd,
  yearReturn,
  chipEstimate,
  visibleExtrema,
} from "./indicators";
const bars = Array.from({ length: 80 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
  open: "10",
  close: "10",
  high: "10",
  low: "10",
  volume: "1000",
}));
it("均线有完整周期才显示，恒价MACD为零", () => {
  expect(movingAverage(bars, 5).slice(0, 5)).toEqual([
    null,
    null,
    null,
    null,
    10,
  ]);
  expect(
    macd(bars).every((v) => v.dif === 0 && v.dea === 0 && v.histogram === 0),
  ).toBe(true);
});
it("52周收益按52周前最近交易日计算，缺少历史不伪造", () => {
  expect(yearReturn(bars, "12", "2026-01-01")).toBeCloseTo(20);
  expect(yearReturn(bars, "12", "2026-08-01")).toBeNull();
});
it("筹码估算归一、恒价成本正确，无股本或历史不足不显示", () => {
  const chip = chipEstimate(bars, "1000000")!;
  expect(chip.average).toBeCloseTo(10);
  expect(chip.portions.reduce((a, b) => a + b)).toBeCloseTo(1);
  expect(chip.profit).toBe(100);
  expect(chipEstimate(bars, "")).toBeNull();
  expect(chipEstimate(bars.slice(0, 5), "1000000")).toBeNull();
});

it("可视极值仅取缩放窗口内K线，集中度恒价为零", () => {
  const sample = bars.slice(0, 5).map((b, i) => ({
    ...b,
    high: String([30, 12, 15, 11, 40][i]),
    low: String([1, 7, 8, 6, 2][i]),
  }));
  expect(visibleExtrema(sample, 25, 75)).toEqual({
    high: 15,
    low: 6,
    highIndex: 2,
    lowIndex: 3,
  });
  expect(visibleExtrema([], 0, 100)).toBeNull();
  expect(chipEstimate(bars, "1000000")!.concentration90).toBe(0);
  expect(chipEstimate(bars, "1000000")!.concentration70).toBe(0);
});

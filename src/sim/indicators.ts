import type { ChartData } from "./chart";
type Bar = ChartData["bars"][number];
export function movingAverage(bars: Bar[], period: number): (number | null)[] {
  return bars.map((_, i) => {
    if (i + 1 < period) return null;
    const values = bars
      .slice(i - period + 1, i + 1)
      .map((b) => Number(b.close));
    return values.every((v) => Number.isFinite(v) && v > 0)
      ? values.reduce((a, b) => a + b, 0) / period
      : null;
  });
}
export function macd(bars: Bar[]) {
  let fast = 0,
    slow = 0,
    signal = 0;
  return bars.map((b, i) => {
    const close = Number(b.close);
    fast = i ? fast + ((close - fast) * 2) / 13 : close;
    slow = i ? slow + ((close - slow) * 2) / 27 : close;
    const dif = fast - slow;
    signal = i ? signal + ((dif - signal) * 2) / 10 : dif;
    return { date: b.date, dif, dea: signal, histogram: 2 * (dif - signal) };
  });
}
export function yearReturn(
  bars: Bar[],
  latest: string,
  asOf: string,
): number | null {
  const end = Date.parse(asOf.slice(0, 10));
  if (!Number.isFinite(end) || !(Number(latest) > 0)) return null;
  const target = end - 364 * 86400000;
  const base = bars
    .filter((b) => Date.parse(b.date) <= target && Number(b.close) > 0)
    .at(-1);
  if (!base || target - Date.parse(base.date) > 14 * 86400000) return null;
  return (Number(latest) / Number(base.close) - 1) * 100;
}
/** Approximation: constant current float, daily OHLC triangular allocation, turnover decay. */
export function chipEstimate(input: Bar[], floatShares: string) {
  const shares = Number(floatShares),
    bars = input.slice(-250);
  if (
    !(shares > 0) ||
    !Number.isFinite(shares) ||
    bars.length < 60 ||
    bars.some(
      (b) =>
        ![b.open, b.close, b.high, b.low, b.volume].every((v) =>
          Number.isFinite(Number(v)),
        ) ||
        Number(b.low) <= 0 ||
        Number(b.high) < Number(b.low) ||
        Number(b.volume) < 0,
    )
  )
    return null;
  const low = Math.min(...bars.map((b) => Number(b.low))),
    high = Math.max(...bars.map((b) => Number(b.high)));
  const count = 80,
    step = (high - low) / (count - 1) || low * 0.0001;
  const prices = Array.from({ length: count }, (_, i) => low + i * step),
    weights = Array(count).fill(0) as number[];
  bars.forEach((bar, day) => {
    const lo = Number(bar.low),
      hi = Number(bar.high),
      center = (Number(bar.open) + Number(bar.close) + hi + lo) / 4;
    const rate =
      day === 0 ? 1 : Math.min(1, (Number(bar.volume) * 100) / shares);
    const allocation = prices.map((p) =>
      p < lo || p > hi
        ? 0
        : hi === lo
          ? 1
          : p <= center
            ? (p - lo) / (center - lo || step)
            : (hi - p) / (hi - center || step),
    );
    let total = allocation.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      allocation[
        Math.max(0, Math.min(count - 1, Math.round((center - low) / step)))
      ] = 1;
      total = 1;
    }
    for (let i = 0; i < count; i++)
      weights[i] = weights[i] * (1 - rate) + (allocation[i] / total) * rate;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  const portions = weights.map((v) => v / sum),
    last = Number(bars.at(-1)!.close);
  const quantile = (q: number) => {
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += portions[i];
      if (sum >= q) return prices[i];
    }
    return prices[count - 1];
  };
  return {
    date: bars.at(-1)!.date,
    start: bars[0].date,
    count: bars.length,
    prices,
    portions,
    average: prices.reduce((s, p, i) => s + p * portions[i], 0),
    profit:
      portions.reduce((s, v, i) => s + (prices[i] <= last ? v : 0), 0) * 100,
    concentration90:
      ((quantile(0.95) - quantile(0.05)) / (quantile(0.95) + quantile(0.05))) *
      100,
    concentration70:
      ((quantile(0.85) - quantile(0.15)) / (quantile(0.85) + quantile(0.15))) *
      100,
    lower70: quantile(0.15),
    upper70: quantile(0.85),
    lower: quantile(0.05),
    upper: quantile(0.95),
  };
}

/** The same rounded category indices used by ECharts percentage data zoom. */
export function visibleExtrema(bars: Bar[], start: number, end: number) {
  if (!bars.length) return null;
  const first = Math.max(0, Math.round(((bars.length - 1) * start) / 100));
  const last = Math.min(
    bars.length - 1,
    Math.round(((bars.length - 1) * end) / 100),
  );
  let high = -Infinity,
    low = Infinity,
    highIndex = first,
    lowIndex = first;
  for (let i = first; i <= last; i++) {
    if (Number(bars[i].high) > high) {
      high = Number(bars[i].high);
      highIndex = i;
    }
    if (Number(bars[i].low) < low) {
      low = Number(bars[i].low);
      lowIndex = i;
    }
  }
  return Number.isFinite(high) && Number.isFinite(low)
    ? { high, low, highIndex, lowIndex }
    : null;
}

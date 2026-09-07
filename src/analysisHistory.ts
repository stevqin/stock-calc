import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ChartData } from "./sim/chart";
import { shanghaiDate, type Security } from "./sim/model";
import { validSymbol } from "./quotes";

interface AnnualCache {
  version: 1;
  year: number;
  start: string;
  end: string;
  data: ChartData;
}
const cache = new Map<string, AnnualCache>();
const pending = new Map<string, Promise<ChartData>>();
let epoch = 0;
const cachePrefix = "tcalculator:analysis-history:v1:";
/** Discard only analysis prices; completed pre-clear requests cannot restore them. */
export function clearAnalysisHistory(): void {
  epoch++;
  cache.clear();
  pending.clear();
  // Enumerate first because deleting keys changes localStorage's index order.
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(cachePrefix)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}
let active = 0;
const queue: (() => void)[] = [];
async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((resolve) => queue.push(resolve));
  else active++;
  try {
    return await work();
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
const bounds = (year: number) => ({
  start: `${year - 1}-12-01`,
  end: `${year}-12-31`,
});
function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
function validate(data: ChartData, symbol: string, year: number): ChartData {
  const { start, end } = bounds(year);
  if (
    !data ||
    data.symbol !== symbol ||
    data.mode !== "daily-raw" ||
    data.adjustment !== "不复权" ||
    !Number.isFinite(Date.parse(data.fetchedAt)) ||
    !Array.isArray(data.bars) ||
    data.bars.length > 400 ||
    !Array.isArray(data.sessions) ||
    data.sessions.length
  )
    throw new Error("历史行情证券或复权类型不匹配");
  const seen = new Set<string>();
  for (const b of data.bars) {
    if (
      !b ||
      !validDate(b.date) ||
      b.date < start ||
      b.date > end ||
      seen.has(b.date) ||
      ![b.open, b.close, b.high, b.low, b.volume].every(
        (n) =>
          typeof n === "string" &&
          n.trim() !== "" &&
          Number.isFinite(Number(n)) &&
          Number(n) >= 0,
      ) ||
      Number(b.low) > Number(b.high) ||
      Number(b.open) < Number(b.low) ||
      Number(b.open) > Number(b.high) ||
      Number(b.close) < Number(b.low) ||
      Number(b.close) > Number(b.high)
    )
      throw new Error("历史行情日期或价格无效");
    seen.add(b.date);
  }
  return {
    ...data,
    bars: [...data.bars].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
function read(
  key: string,
  symbol: string,
  year: number,
): AnnualCache | undefined {
  try {
    const item =
      cache.get(key) ??
      (JSON.parse(localStorage.getItem(key) ?? "null") as AnnualCache | null);
    const { start, end } = bounds(year);
    if (
      !item ||
      item.version !== 1 ||
      item.year !== year ||
      item.start !== start ||
      item.end !== end
    )
      return;
    item.data = validate(item.data, symbol, year);
    const today = shanghaiDate();
    // An old year fetched while it was still open also needs one final refresh.
    if (
      year === Number(today.slice(0, 4))
        ? shanghaiDate(new Date(item.data.fetchedAt)) !== today
        : shanghaiDate(new Date(item.data.fetchedAt)) <= end
    )
      return;
    cache.set(key, item);
    return item;
  } catch {
    return;
  }
}
/** Annual raw prices, including December of the prior year for the opening reference. */
export function loadAnalysisHistory(
  security: Security,
  year: number,
): Promise<ChartData> {
  const currentYear = Number(shanghaiDate().slice(0, 4));
  if (
    (!validSymbol(security.market, security.code) &&
      !(security.market === "sh" && security.code === "000001")) ||
    security.id !== security.market + security.code ||
    !Number.isInteger(year) ||
    year < 1990 ||
    year > currentYear
  )
    return Promise.reject(new Error("历史行情证券或年份无效"));
  const key = `${cachePrefix}${security.id}:${year}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const stored = read(key, security.id, year);
  if (stored) return Promise.resolve(stored.data);
  const requestEpoch = epoch;
  const request = limited(async () => {
    if (!isTauri()) throw new Error("历史行情需在桌面版联网获取");
    const data = validate(
      await invoke<ChartData>("fetch_analysis_history", {
        market: security.market,
        code: security.code,
        year,
      }),
      security.id,
      year,
    );
    if (requestEpoch !== epoch) return data;
    const item: AnnualCache = { version: 1, year, ...bounds(year), data };
    cache.set(key, item);
    try {
      localStorage.setItem(key, JSON.stringify(item));
    } catch {
      /* Disposable cache must not prevent using fetched prices. */
    }
    return data;
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

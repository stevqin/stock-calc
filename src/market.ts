import { reactive, shallowReactive } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Quote } from "./quotes";
import { validSymbol } from "./quotes";
import type { ChartData, ChartMode } from "./sim/chart";
import type { Security } from "./sim/model";
import { shanghaiDate } from "./sim/model";
import { validFundFlow, type FundFlow } from "./fundFlow";
export interface BatchResult {
  quotes: Quote[];
  errors: Record<string, string>;
  fundFlows?: FundFlow[];
}
export const marketQuotes = reactive<Record<string, Quote>>({});
export const marketCharts = shallowReactive<Record<string, ChartData>>({});
export const marketErrors = reactive<Record<string, string>>({});
export const marketFundFlows = reactive<Record<string, FundFlow>>({});
export const fundFlowErrors = reactive<Record<string, string>>({});
export const fundFlowStatus = reactive({ text: "资金流待获取" });
export const marketStatus = reactive({ text: "等待行情", cacheError: "" });
export const chartKey = (id: string, mode: ChartMode) => `${id}:${mode}`;
let hydrated = false;
export async function hydrateMarket() {
  if (hydrated || !isTauri()) return;
  hydrated = true;
  try {
    const records = await invoke<Record<string, string>>("load_market_cache");
    for (const [key, json] of Object.entries(records)) {
      try {
        const value = JSON.parse(json);
        if (key === "quotes") {
          for (const [id, q] of Object.entries(value) as [string, Quote][])
            if (
              validSymbol(q.market, q.code) &&
              id === q.market + q.code &&
              Number(q.latest) > 0 &&
              /^\d{14}$/.test(q.quoteTime)
            )
              marketQuotes[id] = q;
        } else if (key === "fund-flows") {
          for (const [id, flow] of Object.entries(value) as [
            string,
            FundFlow,
          ][])
            if (
              validFundFlow(flow) &&
              validSymbol(flow.market, flow.code) &&
              id === flow.market + flow.code
            ) {
              marketFundFlows[id] = flow;
              fundFlowErrors[id] = "本地缓存，等待联网更新";
            }
        } else if (validChart(value, key)) marketCharts[key] = value;
      } catch {
        /* bad cache is disposable, never touches account */
      }
    }
  } catch {
    marketStatus.cacheError = "行情缓存读取失败，账本不受影响";
  }
}
async function persist(key: string, value: unknown) {
  if (!isTauri()) return;
  try {
    await invoke("write_market_cache", { key, payload: JSON.stringify(value) });
  } catch {
    marketStatus.cacheError = "行情缓存保存失败，当前行情仍可使用";
  }
}
function validChart(v: ChartData, key: string): boolean {
  if (
    !v ||
    key !== chartKey(v.symbol, v.mode) ||
    !validSymbol(v.symbol.slice(0, 2), v.symbol.slice(2)) ||
    !["daily", "daily-raw", "intraday", "five-day"].includes(v.mode) ||
    !Array.isArray(v.bars) ||
    !Array.isArray(v.sessions) ||
    !Number.isFinite(Date.parse(v.fetchedAt))
  )
    return false;
  return (
    v.bars.length <= 1000 &&
    v.sessions.length <= 5 &&
    v.bars.every((b) =>
      [b.open, b.close, b.high, b.low, b.volume].every(
        (n) =>
          typeof n === "string" && Number.isFinite(Number(n)) && Number(n) >= 0,
      ),
    ) &&
    v.sessions.every(
      (s) =>
        Array.isArray(s.points) &&
        s.points.length <= 500 &&
        s.points.every((p) => Number(p.price) > 0 && Number(p.volume) >= 0),
    )
  );
}
export class BatchPoller {
  private targets: Security[] = [];
  private busy = false;
  private disposed = false;
  private generation = 0;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private fetcher: (s: Security[]) => Promise<BatchResult>,
    private receive: (r: BatchResult) => void,
    private state: (s: string) => void,
    private visible = () => !document.hidden,
    private intervalMs = 3000,
  ) {}
  setTargets(s: Security[]) {
    const next = [...new Map(s.map((x) => [x.id, x])).values()];
    if (next.map((x) => x.id).join() === this.targets.map((x) => x.id).join())
      return;
    this.targets = next;
    this.generation++;
    this.failures = 0;
    clearTimeout(this.timer);
    void this.refresh();
  }
  stop() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
  }
  async refresh() {
    if (this.disposed || this.busy) return;
    clearTimeout(this.timer);
    if (!this.visible()) {
      this.timer = setTimeout(() => void this.refresh(), this.intervalMs);
      return;
    }
    if (!this.targets.length) return;
    this.busy = true;
    const g = this.generation;
    let bad = false;
    try {
      for (let i = 0; i < this.targets.length; i += 50) {
        if (g !== this.generation || !this.visible()) break;
        const symbols = this.targets.slice(i, i + 50);
        const result = await this.fetcher(symbols);
        if (g !== this.generation || !this.visible()) break;
        const allowed = new Set(symbols.map((s) => s.id));
        if (result.quotes.some((q) => !allowed.has(q.market + q.code)))
          throw new Error("批量报价证券不匹配");
        if (
          result.fundFlows?.some(
            (f) => !allowed.has(f.market + f.code) || !validFundFlow(f),
          )
        )
          throw new Error("资金流证券不匹配或字段异常");
        this.receive(result);
        if (Object.keys(result.errors).length) bad = true;
      }
      if (g === this.generation) {
        this.failures = bad ? Math.min(this.failures + 1, 4) : 0;
        this.state(
          bad
            ? "部分证券暂缺 · 已保留最近报价"
            : `公开行情 · ${this.intervalMs / 1000}秒批量刷新`,
        );
      }
    } catch (e) {
      bad = true;
      this.failures++;
      this.state(`行情未连接 · ${e instanceof Error ? e.message : e}`);
    } finally {
      this.busy = false;
      if (!this.disposed)
        this.timer = setTimeout(
          () => void this.refresh(),
          g !== this.generation
            ? 0
            : Math.min(
                Math.max(60000, this.intervalMs * 4),
                this.intervalMs * 2 ** Math.min(this.failures, 5),
              ),
        );
    }
  }
}
let savedQuotesAt = 0;
export function makeMarketPoller() {
  return new BatchPoller(
    async (symbols) => {
      if (!isTauri()) throw new Error("浏览器仅供离线预览，请打开Mac版");
      return invoke<BatchResult>("fetch_quotes", {
        symbols: symbols.map(({ market, code }) => ({ market, code })),
      });
    },
    (result) => {
      for (const q of result.quotes) {
        const id = q.market + q.code;
        marketQuotes[id] = q;
        delete marketErrors[id];
      }
      Object.assign(marketErrors, result.errors);
      if (Date.now() - savedQuotesAt > 30000) {
        savedQuotesAt = Date.now();
        void persist("quotes", marketQuotes);
      }
    },
    (text) => (marketStatus.text = text),
  );
}
export function makeFundFlowPoller() {
  return new BatchPoller(
    async (symbols) => {
      if (!isTauri()) throw new Error("资金流仅在Mac版联网获取");
      try {
        const result = await invoke<{
          flows: FundFlow[];
          errors: Record<string, string>;
        }>("fetch_fund_flows", {
          symbols: symbols.map(({ market, code }) => ({ market, code })),
        });
        return { quotes: [], fundFlows: result.flows, errors: result.errors };
      } catch (e) {
        return {
          quotes: [],
          fundFlows: [],
          errors: Object.fromEntries(symbols.map((s) => [s.id, String(e)])),
        };
      }
    },
    (result) => {
      for (const flow of result.fundFlows ?? []) {
        const id = flow.market + flow.code;
        marketFundFlows[id] = flow;
        delete fundFlowErrors[id];
      }
      Object.assign(fundFlowErrors, result.errors);
      if (result.fundFlows?.length) void persist("fund-flows", marketFundFlows);
    },
    (text) => {
      fundFlowStatus.text = `东方财富资金流 · ${text}`;
    },
    () => !document.hidden,
    30000,
  );
}
class RequestQueue {
  active = 0;
  tasks: (() => void)[] = [];
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.tasks.push(() => {
        this.active++;
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.pump();
          });
      });
      this.pump();
    });
  }
  pump() {
    while (this.active < 4 && this.tasks.length) this.tasks.shift()!();
  }
}
const queue = new RequestQueue();
const inFlight = new Map<string, Promise<ChartData>>();
const failedUntil = new Map<string, number>();
export async function getChart(
  s: Security,
  mode: ChartMode,
  active: () => boolean = () => true,
): Promise<ChartData> {
  const key = chartKey(s.id, mode),
    cached = marketCharts[key];
  const daily = mode === "daily" || mode === "daily-raw";
  if (
    cached &&
    (daily
      ? shanghaiDate(new Date(cached.fetchedAt)) === shanghaiDate()
      : Date.now() - Date.parse(cached.fetchedAt) < 30000)
  )
    return cached;
  if (inFlight.has(key)) return inFlight.get(key)!;
  if ((failedUntil.get(key) ?? 0) > Date.now()) {
    if (cached) return cached;
    throw new Error(marketErrors[key] || "行情重试等待中");
  }
  const job = queue
    .run(async () => {
      if (document.hidden || !active())
        throw new Error("图表不可见，等待重新显示");
      if (!isTauri()) throw new Error("桌面版提供实时走势");
      const data = await invoke<ChartData>("fetch_chart", {
        market: s.market,
        code: s.code,
        mode,
      });
      if (!validChart(data, key)) throw new Error("图表格式无效或证券不匹配");
      if (mode === "daily-raw" && data.adjustment !== "不复权")
        throw new Error("无法确认不复权基准");
      marketCharts[key] = data;
      delete marketErrors[key];
      void persist(key, data);
      return data;
    })
    .catch((e) => {
      failedUntil.set(key, Date.now() + 60000);
      marketErrors[key] = e instanceof Error ? e.message : String(e);
      if (cached) return cached;
      throw e;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
export function liveDaily(data: ChartData, q?: Quote): ChartData {
  if (data.mode !== "daily" || !q) return data;
  const date = `${q.quoteTime.slice(0, 4)}-${q.quoteTime.slice(4, 6)}-${q.quoteTime.slice(6, 8)}`;
  const bars = data.bars.map((b) => ({ ...b }));
  const last = bars.at(-1);
  if (!last || last.date > date || !q.open || !q.high || !q.low) return data;
  const live = {
    date,
    open: q.open,
    close: q.latest,
    high: q.high,
    low: q.low,
    volume: q.volume ?? "0",
  };
  if (last.date === date) bars[bars.length - 1] = live;
  else bars.push(live);
  return { ...data, bars };
}
export async function clearMarket() {
  if (isTauri()) await invoke("clear_market_cache");
  for (const k of Object.keys(marketCharts)) delete marketCharts[k];
  for (const k of Object.keys(marketQuotes)) delete marketQuotes[k];
  for (const k of Object.keys(marketFundFlows)) delete marketFundFlows[k];
  for (const k of Object.keys(fundFlowErrors)) delete fundFlowErrors[k];
  failedUntil.clear();
}

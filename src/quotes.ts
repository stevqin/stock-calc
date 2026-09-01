export type Market = "sh" | "sz";
export interface Quote {
  market: Market;
  code: string;
  name: string;
  latest: string;
  bid: string | null;
  ask: string | null;
  quoteTime: string;
  fetchedAt: string;
  kind: "stock" | "etf" | "unknown";
  previousClose?: string | null;
  open?: string | null;
  high?: string | null;
  low?: string | null;
  change?: string | null;
  volumeRatio?: string | null;
  turnover?: string | null;
  amplitude?: string | null;
  peRatio?: string | null;
  pbRatio?: string | null;
  floatCap?: string | null; // 亿元, source's circulating market value, not ETF NAV
  volume?: string | null; // 手
  source?: string;
}

export function validSymbol(market: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return market === "sh"
    ? /^(600|601|603|605|51|52|56|58)/.test(code)
    : market === "sz" && /^(000|001|002|003|300|301|159)/.test(code);
}

export function quoteAge(quote: Quote, now = Date.now()): number {
  const t = quote.quoteTime;
  const parsed = Date.parse(
    `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+08:00`,
  );
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : Infinity;
}

/** One global in-flight request per controller; generations discard stale symbol responses. */
export class QuotePoller {
  private symbol: { market: Market; code: string } | null = null;
  private generation = 0;
  private busy = false;
  private visible = true;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private fetcher: (market: Market, code: string) => Promise<Quote>,
    private receive: (quote: Quote) => void,
    private status: (status: string) => void,
  ) {}
  select(market: Market, code: string) {
    this.stop();
    if (!validSymbol(market, code)) {
      this.status("请输入范围内的六位证券代码");
      return;
    }
    this.symbol = { market, code };
    this.failures = 0;
    void this.refresh();
  }
  stop() {
    this.generation++;
    this.symbol = null;
    clearTimeout(this.timer);
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) {
      this.generation++;
      clearTimeout(this.timer);
    } else void this.refresh();
  }
  async refresh() {
    if (this.busy || !this.visible || !this.symbol) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    const symbol = this.symbol;
    this.busy = true;
    this.status("正在获取报价…");
    try {
      const quote = await this.fetcher(symbol.market, symbol.code);
      if (generation !== this.generation) return;
      if (quote.code !== symbol.code || quote.market !== symbol.market)
        throw new Error("报价代码不匹配");
      this.failures = 0;
      this.receive(quote);
      this.status("已连接 · 每3秒刷新");
    } catch (error) {
      if (generation !== this.generation) return;
      this.failures++;
      this.status(
        `行情不可用 · ${error instanceof Error ? error.message : String(error)}；可手动测算`,
      );
    } finally {
      this.busy = false;
      if (this.visible && this.symbol) {
        if (generation !== this.generation) void this.refresh();
        else
          this.timer = setTimeout(
            () => void this.refresh(),
            Math.min(60000, 3000 * 2 ** this.failures),
          );
      }
    }
  }
}

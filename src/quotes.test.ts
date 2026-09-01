import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotePoller, quoteAge, validSymbol, type Quote } from "./quotes";
const sample: Quote = {
  market: "sh",
  code: "600519",
  name: "贵州茅台",
  latest: "1286.98",
  bid: "1286.90",
  ask: "1286.99",
  quoteTime: "20260831100631",
  fetchedAt: "2026-08-31T02:06:32Z",
  kind: "stock",
};
afterEach(() => vi.useRealTimers());
describe("行情状态", () => {
  it("代码白名单排除科创板北交所可转债与URL注入", () => {
    for (const [market, code] of [
      ["sh", "600519"],
      ["sz", "000001"],
      ["sz", "300750"],
      ["sh", "510300"],
      ["sz", "159915"],
    ])
      expect(validSymbol(market, code)).toBe(true);
    for (const [market, code] of [
      ["sh", "688001"],
      ["bj", "830001"],
      ["sh", "113001"],
      ["sh", "600519&x"],
      ["unknown", "600519"],
    ])
      expect(validSymbol(market, code)).toBe(false);
  });
  it("按上海时区判断过期报价", () => {
    expect(quoteAge(sample, Date.parse("2026-08-31T02:06:32Z"))).toBe(1000);
    expect(
      quoteAge(sample, Date.parse("2026-08-31T02:08:00Z")),
    ).toBeGreaterThan(60000);
    expect(quoteAge({ ...sample, quoteTime: "bad" })).toBe(Infinity);
  });
  it("快速换代码丢弃旧响应，且不并发请求", async () => {
    let finish!: (q: Quote) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Quote>((r) => {
            finish = r;
          }),
      )
      .mockResolvedValue({ ...sample, code: "600000" });
    const receive = vi.fn();
    const poller = new QuotePoller(fetch, receive, vi.fn());
    poller.select("sh", "600519");
    poller.select("sh", "600000");
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(sample);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[0][0].code).toBe("600000");
    poller.stop();
  });
  it("每3秒轮询；隐藏暂停，恢复继续", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(sample);
    const poller = new QuotePoller(fetch, vi.fn(), vi.fn());
    poller.select("sh", "600519");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(2);
    poller.setVisible(false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(2);
    poller.setVisible(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    poller.stop();
  });
  it("断网或超时退避重试，保留手动计算能力", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new Error("请求超时"));
    const status = vi.fn();
    const poller = new QuotePoller(fetch, vi.fn(), status);
    poller.select("sh", "600519");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith(
      expect.stringContaining("可手动测算"),
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledTimes(3);
    poller.stop();
  });
  it("拒绝代码错配且停止后不推送结果", async () => {
    const receive = vi.fn();
    const status = vi.fn();
    const poller = new QuotePoller(
      vi.fn().mockResolvedValue({ ...sample, code: "600000" }),
      receive,
      status,
    );
    poller.select("sh", "600519");
    await Promise.resolve();
    expect(receive).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("不匹配"));
    poller.stop();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchPoller, type BatchResult } from "./market";
import { manualAccount } from "./sim/record";
const symbols = manualAccount().securities;
const empty: BatchResult = { quotes: [], errors: {} };
let poller: BatchPoller;
afterEach(() => {
  poller?.stop();
  vi.useRealTimers();
});
describe("批量行情调度", () => {
  it("资金流使用独立30秒间隔，失败后60秒重试", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(new Error("资金流断网"))
      .mockResolvedValue(empty);
    poller = new BatchPoller(fetcher, vi.fn(), vi.fn(), () => true, 30000);
    poller.setTargets([symbols[0]]);
    await vi.advanceTimersByTimeAsync(29999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("拒绝资金流响应中的非请求证券", async () => {
    vi.useFakeTimers();
    const receive = vi.fn();
    poller = new BatchPoller(
      vi.fn().mockResolvedValue({
        ...empty,
        fundFlows: [
          {
            market: "sz",
            code: "002465",
            mainNet: "100",
            quoteTime: "20260831150000",
            fetchedAt: "2026-08-31T07:00:00Z",
            source: "东方财富",
          },
        ],
      }),
      receive,
      vi.fn(),
      () => true,
      30000,
    );
    poller.setTargets([symbols[0]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(receive).not.toHaveBeenCalled();
  });
  it("快速切换证券丢弃旧响应，且不重叠请求", async () => {
    vi.useFakeTimers();
    let finish!: (r: BatchResult) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<BatchResult>((resolve) => (finish = resolve)),
      )
      .mockResolvedValue(empty);
    const receive = vi.fn();
    poller = new BatchPoller(fetcher, receive, vi.fn(), () => true);
    poller.setTargets([symbols[0]]);
    poller.setTargets([symbols[1]]);
    await poller.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(empty);
    await vi.advanceTimersByTimeAsync(1);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0][0].id).toBe(symbols[1].id);
  });
  it("隐藏时不请求，恢复后允许刷新", async () => {
    vi.useFakeTimers();
    let visible = false;
    const fetcher = vi.fn().mockResolvedValue(empty);
    poller = new BatchPoller(fetcher, vi.fn(), vi.fn(), () => visible);
    poller.setTargets([symbols[0]]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).not.toHaveBeenCalled();
    visible = true;
    await poller.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("失败后退避重试，不清空已有行情", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("断网"))
      .mockResolvedValue(empty);
    const receive = vi.fn();
    poller = new BatchPoller(fetcher, receive, vi.fn(), () => true);
    poller.setTargets([symbols[0]]);
    await vi.advanceTimersByTimeAsync(5999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(receive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("去重并限制每批最多50只", async () => {
    vi.useFakeTimers();
    const list = Array.from({ length: 51 }, (_, i) => ({
      ...symbols[0],
      id: `sh${600000 + i}`,
      code: String(600000 + i),
    }));
    const fetcher = vi.fn().mockResolvedValue(empty);
    poller = new BatchPoller(fetcher, vi.fn(), vi.fn(), () => true);
    poller.setTargets([...list, list[0]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher.mock.calls.map((c) => c[0].length)).toEqual([50, 1]);
  });
});

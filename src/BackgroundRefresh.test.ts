import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { makeMarketPoller, getChart, type BatchPoller } from "./market";
import { manualAccount } from "./sim/record";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async () => ({ quotes: [], errors: {} })),
}));
let poller: BatchPoller;
afterEach(() => {
  poller?.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("keeps requesting quotes every 3 seconds while the main webview is hidden", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  poller = makeMarketPoller(true);
  poller.setTargets([manualAccount().securities[0]]);
  await vi.advanceTimersByTimeAsync(9000);
  const requests = vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "fetch_quotes");
  expect(requests).toHaveLength(4);
  for (const [, args] of requests)
    expect(args).toMatchObject({ background: true });
});
it("native wakeups refresh overdue quotes when the webview timer did not run", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  poller = makeMarketPoller(true);
  poller.setTargets([manualAccount().securities[0]]);
  await vi.advanceTimersByTimeAsync(1);
  // Moving the clock without executing timers simulates an occluded webview timer.
  vi.setSystemTime(Date.now() + 4000);
  await poller.refreshIfDue();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "fetch_quotes"),
  ).toHaveLength(2);
});

it("passes the background flag through the native raw daily chart request", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const security = manualAccount().securities[0];
  vi.mocked(invoke).mockResolvedValueOnce({
    symbol: security.id,
    mode: "daily-raw",
    bars: [],
    sessions: [],
    adjustment: "不复权",
    fetchedAt: new Date().toISOString(),
  });
  await getChart(security, "daily-raw", () => true, true);
  expect(invoke).toHaveBeenCalledWith("fetch_chart", {
    market: security.market,
    code: security.code,
    mode: "daily-raw",
    background: true,
  });
});

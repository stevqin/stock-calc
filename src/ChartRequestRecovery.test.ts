import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T02:00:00Z"));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const security = (i: number) => ({
  id: `sh60000${i}`,
  market: "sh" as const,
  code: `60000${i}`,
});
const data = (id: string, price = "10") => ({
  symbol: id,
  mode: "intraday" as const,
  bars: [],
  sessions: [
    {
      date: "20261021",
      previousClose: "10",
      points: [{ time: "1000", price, volume: "100", amount: null }],
    },
  ],
  adjustment: "不复权",
  fetchedAt: new Date().toISOString(),
});
it("releases all four occupied chart slots when native requests never settle", async () => {
  const { getChart, marketErrors } = await import("./market");
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === "fetch_chart"
      ? new Promise(() => {})
      : Promise.resolve(undefined),
  );
  const requests = Array.from({ length: 5 }, (_, i) =>
    getChart(security(i), "intraday").catch((e) => String(e)),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(
    vi.mocked(invoke).mock.calls.filter(([c]) => c === "fetch_chart"),
  ).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(15000);
  expect(
    vi.mocked(invoke).mock.calls.filter(([c]) => c === "fetch_chart"),
  ).toHaveLength(5);
  expect(marketErrors["sh600000:intraday"]).toContain("15秒");
  await vi.advanceTimersByTimeAsync(15000);
  await Promise.all(requests);
});
it("retries after a timed-out request and ignores its late response", async () => {
  const { getChart, marketCharts } = await import("./market");
  let late!: (v: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) =>
    command === "fetch_chart"
      ? new Promise((r) => (late = r))
      : Promise.resolve(undefined),
  );
  const old = getChart(security(0), "intraday").catch(() => null);
  await vi.advanceTimersByTimeAsync(15000);
  await old;
  vi.mocked(invoke).mockImplementation((command) =>
    Promise.resolve(
      command === "fetch_chart" ? data("sh600000", "12") : undefined,
    ),
  );
  await getChart(security(0), "intraday", () => true, false, true);
  late(data("sh600000", "9"));
  await vi.advanceTimersByTimeAsync(1);
  expect(marketCharts["sh600000:intraday"].sessions[0].points[0].price).toBe(
    "12",
  );
});
it("expires a lost IPC wait from a native wake even when JavaScript timers did not run", async () => {
  const { getChart, recoverChartRequests } = await import("./market");
  vi.mocked(invoke).mockImplementation((command) =>
    command === "fetch_chart"
      ? new Promise(() => {})
      : Promise.resolve(undefined),
  );
  let settled = false;
  const pending = getChart(security(0), "intraday").catch(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  vi.setSystemTime(Date.now() + 16000);
  expect(settled).toBe(false);
  recoverChartRequests();
  await vi.advanceTimersByTimeAsync(0);
  await pending;
  expect(settled).toBe(true);
});

it("keeps the last curve after a lost request and replaces it on a later successful refresh", async () => {
  const { getChart, marketCharts, marketErrors } = await import("./market");
  marketCharts["sh600000:intraday"] = data("sh600000", "10");
  vi.setSystemTime(Date.now() + 31000);
  vi.mocked(invoke).mockImplementation((command) =>
    command === "fetch_chart"
      ? new Promise(() => {})
      : Promise.resolve(undefined),
  );
  const pending = getChart(security(0), "intraday");
  await vi.advanceTimersByTimeAsync(15000);
  expect((await pending).sessions[0].points[0].price).toBe("10");
  expect(marketErrors["sh600000:intraday"]).toContain("15秒");
  vi.setSystemTime(Date.now() + 60000);
  vi.mocked(invoke).mockImplementation((command) =>
    Promise.resolve(
      command === "fetch_chart" ? data("sh600000", "12") : undefined,
    ),
  );
  expect(
    (await getChart(security(0), "intraday")).sessions[0].points[0].price,
  ).toBe("12");
  expect(marketErrors["sh600000:intraday"]).toBeUndefined();
});

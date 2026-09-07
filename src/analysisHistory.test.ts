import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ChartData } from "./sim/chart";
import { manualAccount } from "./sim/record";
const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/core", () => bridge);
const security = manualAccount().securities[0];
const chart = (year = 2025): ChartData => ({
  symbol: security.id,
  mode: "daily-raw",
  adjustment: "不复权",
  fetchedAt: new Date().toISOString(),
  sessions: [],
  bars: [`${year}-01-03`, `${year - 1}-12-31`].map((date) => ({
    date,
    open: "10",
    close: "11",
    high: "12",
    low: "9",
    volume: "100",
  })),
});
beforeEach(() => {
  vi.resetModules();
  bridge.invoke.mockReset();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T08:00:00Z"));
});
afterEach(() => vi.useRealTimers());
it("loads chronological raw annual bars, deduplicates and persists separately", async () => {
  bridge.invoke.mockResolvedValue(chart());
  const { loadAnalysisHistory } = await import("./analysisHistory");
  const [a, b] = await Promise.all([
    loadAnalysisHistory(security, 2025),
    loadAnalysisHistory(security, 2025),
  ]);
  expect(a).toEqual(b);
  expect(a.bars.map((b) => b.date)).toEqual(["2024-12-31", "2025-01-03"]);
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
  expect(bridge.invoke).toHaveBeenCalledWith("fetch_analysis_history", {
    market: security.market,
    code: security.code,
    year: 2025,
  });
  vi.resetModules();
  const reloaded = await import("./analysisHistory");
  expect(await reloaded.loadAnalysisHistory(security, 2025)).toEqual(a);
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
});
it("refreshes current-year cache on the next Shanghai date", async () => {
  bridge.invoke.mockImplementation(async () => chart(2026));
  const { loadAnalysisHistory } = await import("./analysisHistory");
  await loadAnalysisHistory(security, 2026);
  await loadAnalysisHistory(security, 2026);
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-09-07T17:00:00Z"));
  await loadAnalysisHistory(security, 2026);
  expect(bridge.invoke).toHaveBeenCalledTimes(2);
});
it("rejects adjusted, wrong-symbol, invalid dates and negative prices, and permits retry", async () => {
  const { loadAnalysisHistory } = await import("./analysisHistory");
  for (const bad of [
    { ...chart(), adjustment: "前复权" },
    { ...chart(), symbol: "sh000000" },
    { ...chart(), bars: [{ ...chart().bars[0], date: "2025-02-30" }] },
    { ...chart(), bars: [{ ...chart().bars[0], close: "-1" }] },
  ]) {
    bridge.invoke.mockResolvedValueOnce(bad);
    await expect(loadAnalysisHistory(security, 2025)).rejects.toThrow();
  }
  bridge.invoke.mockRejectedValueOnce(new Error("offline"));
  await expect(loadAnalysisHistory(security, 2025)).rejects.toThrow("offline");
  bridge.invoke.mockResolvedValueOnce(chart());
  expect((await loadAnalysisHistory(security, 2025)).bars).toHaveLength(2);
});
it("discards corrupted cache metadata", async () => {
  bridge.invoke.mockResolvedValue(chart());
  let module = await import("./analysisHistory");
  await module.loadAnalysisHistory(security, 2025);
  const key = localStorage.key(0)!;
  const cached = JSON.parse(localStorage.getItem(key)!);
  cached.year = 2024;
  localStorage.setItem(key, JSON.stringify(cached));
  vi.resetModules();
  module = await import("./analysisHistory");
  await module.loadAnalysisHistory(security, 2025);
  expect(bridge.invoke).toHaveBeenCalledTimes(2);
});
it("limits native requests to three and drains the queue after errors", async () => {
  let active = 0,
    peak = 0;
  const finish: (() => void)[] = [];
  bridge.invoke.mockImplementation(
    (_cmd, args) =>
      new Promise((resolve) => {
        active++;
        peak = Math.max(peak, active);
        finish.push(() => {
          active--;
          resolve(chart(args.year));
        });
      }),
  );
  const { loadAnalysisHistory } = await import("./analysisHistory");
  const requests = [2020, 2021, 2022, 2023, 2024].map((year) =>
    loadAnalysisHistory(security, year),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(peak).toBe(3);
  while (finish.length) {
    finish.shift()!();
    await vi.advanceTimersByTimeAsync(0);
  }
  await Promise.all(requests);
  expect(peak).toBe(3);
});

it("allows the Shanghai benchmark without broadening trading symbols", async () => {
  bridge.invoke.mockResolvedValue({ ...chart(), symbol: "sh000001" });
  const { loadAnalysisHistory } = await import("./analysisHistory");
  expect(
    (
      await loadAnalysisHistory(
        { ...security, id: "sh000001", market: "sh", code: "000001" },
        2025,
      )
    ).symbol,
  ).toBe("sh000001");
});

it("refreshes a historical year's cache if it was fetched before that year closed", async () => {
  const old = chart();
  old.fetchedAt = "2025-12-30T08:00:00Z";
  bridge.invoke.mockResolvedValueOnce(old).mockResolvedValueOnce(chart());
  const { loadAnalysisHistory } = await import("./analysisHistory");
  await loadAnalysisHistory(security, 2025);
  await loadAnalysisHistory(security, 2025);
  expect(bridge.invoke).toHaveBeenCalledTimes(2);
});
it("retains fetched data when persistent storage is full", async () => {
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  bridge.invoke.mockResolvedValue(chart());
  try {
    const { loadAnalysisHistory } = await import("./analysisHistory");
    expect((await loadAnalysisHistory(security, 2025)).bars).toHaveLength(2);
    expect((await loadAnalysisHistory(security, 2025)).bars).toHaveLength(2);
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  } finally {
    storage.mockRestore();
  }
});

it("clears only annual history caches and leaves account storage intact", async () => {
  bridge.invoke.mockResolvedValue(chart());
  localStorage.setItem("account", "ledger");
  localStorage.setItem("other-cache", "other");
  const { loadAnalysisHistory, clearAnalysisHistory } =
    await import("./analysisHistory");
  await loadAnalysisHistory(security, 2025);
  clearAnalysisHistory();
  expect(localStorage.length).toBe(2);
  expect(localStorage.getItem("account")).toBe("ledger");
  expect(localStorage.getItem("other-cache")).toBe("other");
  await loadAnalysisHistory(security, 2025);
  expect(bridge.invoke).toHaveBeenCalledTimes(2);
});
it("does not repopulate cleared caches or delete a newer same-key request when old work finishes", async () => {
  const finish: ((data: ChartData) => void)[] = [];
  bridge.invoke.mockImplementation(
    () => new Promise((resolve) => finish.push(resolve)),
  );
  const { loadAnalysisHistory, clearAnalysisHistory } =
    await import("./analysisHistory");
  const old = loadAnalysisHistory(security, 2025);
  clearAnalysisHistory();
  const current = loadAnalysisHistory(security, 2025);
  expect(bridge.invoke).toHaveBeenCalledTimes(2);
  finish[0](chart());
  await old;
  expect(localStorage.length).toBe(0);
  expect(loadAnalysisHistory(security, 2025)).toBe(current);
  expect(bridge.invoke).toHaveBeenCalledTimes(2);
  finish[1](chart());
  await current;
  expect(localStorage.length).toBe(1);
});

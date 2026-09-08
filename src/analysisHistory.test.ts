import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ChartData } from "./sim/chart";
import { manualAccount } from "./sim/record";
const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/core", () => bridge);
const security = manualAccount().securities[0];
const network = vi.fn();
const database = new Map<string, ChartData>();
const key = (year = 2025) => `${security.id}:${year}`;
const legacyKey = `tcalculator:analysis-history:v1:${key()}`;
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
  localStorage.clear();
  database.clear();
  network.mockReset();
  bridge.invoke.mockReset();
  bridge.isTauri.mockReturnValue(true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T08:00:00Z"));
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "load_analysis_cache")
      return database.get(`${args.symbol}:${args.year}`) ?? null;
    if (command === "write_analysis_cache") {
      database.set(
        `${args.data.symbol}:${args.year}`,
        structuredClone(args.data),
      );
      return;
    }
    if (command === "clear_analysis_cache") {
      database.clear();
      return;
    }
    if (command === "fetch_analysis_history") return network(args);
    throw new Error(`unexpected command ${command}`);
  });
});
afterEach(() => vi.useRealTimers());
it("persists to SQLite and reloads offline without localStorage or network", async () => {
  network.mockResolvedValue(chart());
  let mod = await import("./analysisHistory");
  const a = mod.loadAnalysisHistory(security, 2025);
  expect(mod.loadAnalysisHistory(security, 2025)).toBe(a);
  expect((await a).bars[0].date).toBe("2024-12-31");
  expect(database.has(key())).toBe(true);
  expect(localStorage.length).toBe(0);
  vi.resetModules();
  mod = await import("./analysisHistory");
  network.mockRejectedValue(new Error("offline"));
  expect((await mod.loadAnalysisHistory(security, 2025)).bars).toHaveLength(2);
  expect(network).toHaveBeenCalledTimes(1);
});
it("migrates valid legacy history only after a durable SQLite write", async () => {
  localStorage.setItem(
    legacyKey,
    JSON.stringify({
      version: 1,
      year: 2025,
      start: "2024-12-01",
      end: "2025-12-31",
      data: chart(),
    }),
  );
  const mod = await import("./analysisHistory");
  await mod.loadAnalysisHistory(security, 2025);
  expect(database.has(key())).toBe(true);
  expect(localStorage.getItem(legacyKey)).toBeNull();
  expect(network).not.toHaveBeenCalled();
});
it("preserves legacy data if SQLite migration fails", async () => {
  localStorage.setItem(
    legacyKey,
    JSON.stringify({
      version: 1,
      year: 2025,
      start: "2024-12-01",
      end: "2025-12-31",
      data: chart(),
    }),
  );
  const real = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation((cmd, args) =>
    cmd === "write_analysis_cache"
      ? Promise.reject(new Error("disk full"))
      : real(cmd, args),
  );
  const mod = await import("./analysisHistory");
  await expect(mod.loadAnalysisHistory(security, 2025)).rejects.toThrow(
    "disk full",
  );
  expect(localStorage.getItem(legacyKey)).not.toBeNull();
  expect(database.size).toBe(0);
});
it("uses SQLite in preference to older localStorage", async () => {
  database.set(key(), chart());
  localStorage.setItem(legacyKey, "broken");
  const mod = await import("./analysisHistory");
  expect((await mod.loadAnalysisHistory(security, 2025)).bars).toHaveLength(2);
  expect(network).not.toHaveBeenCalled();
});
it("refreshes current-year history across date and close-publication boundaries", async () => {
  vi.setSystemTime(new Date("2026-09-07T02:00:00Z"));
  network.mockImplementation(async () => chart(2026));
  const mod = await import("./analysisHistory");
  await mod.loadAnalysisHistory(security, 2026);
  await mod.loadAnalysisHistory(security, 2026);
  expect(network).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-09-07T08:00:00Z"));
  await mod.loadAnalysisHistory(security, 2026);
  expect(network).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date("2026-09-07T17:00:00Z"));
  await mod.loadAnalysisHistory(security, 2026);
  expect(network).toHaveBeenCalledTimes(3);
});
it("rejects empty, adjusted, wrong-symbol and invalid-price history without saving", async () => {
  const mod = await import("./analysisHistory");
  for (const data of [
    { ...chart(), bars: [] },
    { ...chart(), adjustment: "前复权" },
    { ...chart(), symbol: "sh000000" },
    { ...chart(), bars: [{ ...chart().bars[0], close: "-1" }] },
  ]) {
    network.mockResolvedValueOnce(data);
    await expect(mod.loadAnalysisHistory(security, 2025)).rejects.toThrow();
    expect(database.size).toBe(0);
  }
});
it("manual repair bypasses cached partial history and returns the stored merged result", async () => {
  database.set(key(), { ...chart(), bars: [chart().bars[0]] });
  network.mockResolvedValue(chart());
  const mod = await import("./analysisHistory");
  expect((await mod.loadAnalysisHistory(security, 2025)).bars).toHaveLength(1);
  expect(
    (await mod.loadAnalysisHistory(security, 2025, { force: true })).bars,
  ).toHaveLength(2);
  expect(network).toHaveBeenCalledTimes(1);
});
it("limits network concurrency to three", async () => {
  let active = 0,
    peak = 0;
  const done: (() => void)[] = [];
  network.mockImplementation(
    (args) =>
      new Promise((resolve) => {
        active++;
        peak = Math.max(active, peak);
        done.push(() => {
          active--;
          resolve(chart(args.year));
        });
      }),
  );
  const mod = await import("./analysisHistory");
  const requests = [2020, 2021, 2022, 2023, 2024].map((y) =>
    mod.loadAnalysisHistory(security, y),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(peak).toBe(3);
  while (done.length) {
    done.shift()!();
    await vi.advanceTimersByTimeAsync(0);
  }
  await Promise.all(requests);
  expect(peak).toBe(3);
});
it("clears only history and prevents an old fetch repopulating SQLite", async () => {
  localStorage.setItem("account", "safe");
  let finish!: (data: ChartData) => void;
  network.mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const mod = await import("./analysisHistory");
  const request = mod.loadAnalysisHistory(security, 2025);
  await vi.advanceTimersByTimeAsync(0);
  await mod.clearAnalysisHistory();
  finish(chart());
  await request;
  expect(database.size).toBe(0);
  expect(localStorage.getItem("account")).toBe("safe");
});
it("reuses stale persisted historical bars if current-year refresh is offline", async () => {
  const data = chart(2026);
  data.fetchedAt = "2026-09-06T08:00:00Z";
  database.set(key(2026), data);
  network.mockRejectedValue(new Error("offline"));
  const mod = await import("./analysisHistory");
  expect((await mod.loadAnalysisHistory(security, 2026)).bars).toHaveLength(2);
});

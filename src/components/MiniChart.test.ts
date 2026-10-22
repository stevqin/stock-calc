import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MiniChart from "./MiniChart.vue";
import { getChart, marketCharts, marketErrors } from "../market";
import { manualAccount } from "../sim/record";
const native = vi.hoisted(() => ({
  tick: undefined as
    ((e: { payload: { mainVisible: boolean } }) => void) | undefined,
  wake: undefined as (() => void) | undefined,
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, fn) => {
    if (name === "status-bar-tick") native.tick = fn;
    if (name === "main-window-activated") native.wake = fn;
    return native.unlisten;
  }),
}));
vi.mock("../market", () => ({
  getChart: vi.fn().mockResolvedValue(undefined),
  recoverChartRequests: vi.fn(),
  chartKey: (id: string, mode: string) => `${id}:${mode}`,
  liveDaily: (d: unknown) => d,
  marketCharts: {},
  marketQuotes: {},
  marketErrors: {},
}));
let w: ReturnType<typeof mount>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  native.tick = undefined;
  native.wake = undefined;
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 280,
    top: 100,
    bottom: 156,
    width: 180,
    height: 56,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  w?.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("recovers visible table sparklines through repeated native ticks despite stale visibility state", async () => {
  w = mount(MiniChart, {
    props: { security: manualAccount().securities[0], mode: "intraday" },
  });
  await flushPromises();
  for (let i = 0; i < 240; i++) {
    native.tick?.({ payload: { mainVisible: true } });
    await flushPromises();
    vi.setSystemTime(Date.now() + 30000);
  }
  expect(getChart).toHaveBeenCalledTimes(240);
  native.tick?.({ payload: { mainVisible: false } });
  await flushPromises();
  expect(getChart).toHaveBeenCalledTimes(240);
});
it("does not request sparklines outside the visible viewport on native ticks", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 280,
    top: 2000,
    bottom: 2056,
    width: 180,
    height: 56,
    x: 100,
    y: 2000,
    toJSON: () => ({}),
  });
  w = mount(MiniChart, {
    props: { security: manualAccount().securities[0], mode: "intraday" },
  });
  await flushPromises();
  native.tick?.({ payload: { mainVisible: true } });
  await flushPromises();
  expect(getChart).not.toHaveBeenCalled();
});

it("cached chart tooltip explains the real refresh failure and data source", async () => {
  const security = manualAccount().securities[0];
  const key = `${security.id}:intraday`;
  marketCharts[key] = {
    symbol: security.id,
    mode: "intraday",
    bars: [],
    sessions: [
      {
        date: "20261022",
        previousClose: "10",
        points: [{ time: "1330", price: "10.1", volume: "100", amount: null }],
      },
    ],
    adjustment: "不复权",
    source: "腾讯五日分时",
    fetchedAt: new Date(Date.now() - 180000).toISOString(),
  };
  marketErrors[key] = "腾讯分时接口返回 HTTP 501，稍后自动重试";
  w = mount(MiniChart, { props: { security, mode: "intraday" } });
  expect(w.get(".cache-tag").text()).toBe("缓存");
  expect(w.attributes("title")).toContain("HTTP 501");
  expect(w.attributes("title")).toContain("腾讯五日分时");
  expect(w.attributes("title")).toContain("13:30");
  delete marketCharts[key];
  delete marketErrors[key];
});

it("ages a frozen cached curve on a native heartbeat even when JS timers were suspended", async () => {
  const security = manualAccount().securities[0];
  const key = `${security.id}:intraday`;
  marketCharts[key] = {
    symbol: security.id,
    mode: "intraday",
    bars: [],
    sessions: [
      {
        date: "20261022",
        previousClose: "10",
        points: [{ time: "1330", price: "10.1", volume: "100", amount: null }],
      },
    ],
    adjustment: "不复权",
    fetchedAt: new Date().toISOString(),
  };
  w = mount(MiniChart, { props: { security, mode: "intraday" } });
  await flushPromises();
  expect(w.find(".cache-tag").exists()).toBe(false);
  vi.setSystemTime(Date.now() + 180000);
  native.tick?.({ payload: { mainVisible: true } });
  await flushPromises();
  expect(w.find(".cache-tag").exists()).toBe(true);
  delete marketCharts[key];
});

import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MiniChart from "./MiniChart.vue";
import { getChart } from "../market";
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

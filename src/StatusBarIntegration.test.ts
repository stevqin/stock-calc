import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import TradingDesk from "./TradingDesk.vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { manualAccount } from "./sim/record";
import { upgradeWorkspace } from "./sim/workspaceState";
const mocks = vi.hoisted(() => ({
  wake: vi.fn(),
  refresh: vi.fn(),
  refreshFlow: vi.fn(),
  stop: vi.fn(),
  unlisten: vi.fn(),
  tick: undefined as (() => void) | undefined,
  activated: undefined as (() => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event, callback) => {
    if (_event === "status-bar-tick") mocks.tick = callback;
    if (_event === "main-window-activated") mocks.activated = callback;
    return mocks.unlisten;
  }),
}));
vi.mock("./sim/repository", () => ({
  loadAccount: async () => ({
    account: upgradeWorkspace(manualAccount()),
    revision: 1,
  }),
  saveAccount: vi.fn().mockResolvedValue(2),
  exportAccount: vi.fn(),
}));
vi.mock("./market", () => ({
  marketQuotes: {},
  marketCharts: {},
  marketErrors: {},
  marketStatus: { text: "" },
  fundFlowStatus: { text: "" },
  hydrateMarket: vi.fn(),
  clearMarket: vi.fn(),
  getChart: vi.fn().mockResolvedValue(undefined),
  chartKey: (id: string, mode: string) => `${id}:${mode}`,
  makeMarketPoller: () => ({
    setTargets() {},
    refresh: mocks.refresh,
    refreshIfDue: mocks.wake,
    stop: mocks.stop,
  }),
  makeFundFlowPoller: () => ({
    setTargets() {},
    refresh: mocks.refreshFlow,
    stop() {},
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("publishes a summary, wakes background quotes, and removes native listeners on unmount", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const wrapper = mount(TradingDesk, {
    global: { stubs: { SecuritiesTable: true, MarketChart: true } },
  });
  await flushPromises();
  expect(listen).toHaveBeenCalledWith("status-bar-tick", expect.any(Function));
  expect(invoke).toHaveBeenCalledWith("update_status_bar", {
    snapshot: expect.objectContaining({
      frames: ["合计—｜¥0"],
      holdings: [],
    }),
  });
  mocks.tick?.();
  expect(mocks.wake).toHaveBeenCalledOnce();
  mocks.activated?.();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.refreshFlow).toHaveBeenCalledOnce();
  wrapper.unmount();
  expect(mocks.unlisten).toHaveBeenCalledTimes(3);
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("does not start macOS menu bar integration on Windows", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const wrapper = mount(TradingDesk, {
    global: { stubs: { SecuritiesTable: true, MarketChart: true } },
  });
  await flushPromises();
  expect(listen).not.toHaveBeenCalledWith(
    "status-bar-tick",
    expect.any(Function),
  );
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "update_status_bar"),
  ).toBe(false);
  wrapper.unmount();
});

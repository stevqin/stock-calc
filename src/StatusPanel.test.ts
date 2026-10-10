import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import StatusPanel from "./StatusPanel.vue";
import { sample } from "../qa/status-panel/fixture";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command) =>
    command === "get_status_active_index"
      ? 3
      : command === "get_status_portfolio"
        ? sample
        : command === "get_status_paused"
          ? false
          : undefined,
  ),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emitTo: vi.fn(),
}));
describe("持仓下拉面板", () => {
  it("shows full names and independently colors opposing change and profit", async () => {
    const wrapper = mount(StatusPanel);
    await flushPromises();
    expect(wrapper.find(".panel-close").exists()).toBe(false);
    expect(wrapper.get(".panel-header").text()).toContain(
      "我的持仓（2026-09-08）5",
    );
    expect(wrapper.get(".edit-alias").text()).toBe("编辑");
    expect(wrapper.get(".status-chart-card").text()).toContain("卫星ETF富国");
    const row = wrapper.findAll("tbody tr")[3];
    expect(row.classes()).toContain("is-active");
    expect(row.text()).toContain("卫星ETF富国");
    expect(row.get(".current-price").text()).toBe("1.235");
    expect(row.get(".price-change").text()).toBe("+1.20%");
    expect(
      wrapper.findAll("tbody tr")[4].get(".current-price").text(),
    ).toBe("—");
    expect(row.findAll("td")[1].classes()).toContain("up");
    expect(row.findAll("td")[2].get(".profit-amount").classes()).toContain(
      "down",
    );
    expect(row.findAll("td")[3].get(".profit-amount").classes()).toContain(
      "up",
    );
    expect(row.findAll("td")[3].get(".profit-amount").text()).toBe("+¥180.50");
    expect(
      wrapper
        .findAll("tbody tr")[4]
        .findAll("td")[3]
        .get(".profit-amount")
        .text(),
    ).toBe("—");
    expect(row.get(".daily-return").text()).toBe("+0.85%");
    expect(row.get(".holding-return").text()).toBe("-3.25%");
    expect(row.get(".holding-return").classes()).toContain("down");
    expect(wrapper.get(".panel-total").text()).toContain("+¥1,280");
    expect(wrapper.findAll("tbody tr")[4].text()).toContain("*");
    await wrapper.get(".edit-alias").trigger("click");
    await wrapper.findAll(".alias-input")[0].setValue("贵茅");
    expect(emitTo).toHaveBeenCalledWith("main", "status-alias", {
      id: "sh600519",
      name: "贵茅",
    });
    const input = wrapper.findAll(".alias-input")[0];
    (input.element as HTMLInputElement).value = "我的茅台";
    await input.trigger("input");
    const receive = vi
      .mocked(listen)
      .mock.calls.find(([event]) => event === "status-portfolio")![1];
    receive({
      payload: { ...sample, updatedAt: sample.updatedAt + 3000 },
    } as never);
    await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe("我的茅台");
    const rotate = vi
      .mocked(listen)
      .mock.calls.find(([event]) => event === "status-active-index")![1];
    rotate({ payload: 0 } as never);
    await flushPromises();
    expect(wrapper.get(".status-chart-card").text()).toContain("贵州茅台");
    expect(wrapper.findAll("tbody tr")[0].classes()).toContain("is-active");
    expect(row.classes()).not.toContain("is-active");
    rotate({ payload: sample.holdings.length } as never);
    await flushPromises();
    expect(wrapper.get(".status-chart-card").text()).toContain("贵州茅台");
    expect(wrapper.get(".panel-total").classes()).not.toContain("is-active");
    expect(wrapper.findAll("tbody tr.is-active")).toHaveLength(0);
    await wrapper.get(".open-main").trigger("click");
    expect(invoke).toHaveBeenCalledWith("open_status_main");
    expect(wrapper.get("footer").text()).toContain("打开主界面");
    expect(wrapper.get("footer").text()).toContain("暂停滚动");
    vi.mocked(invoke).mockResolvedValueOnce(true);
    await wrapper.get(".pause-rotation").trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("set_status_paused", { paused: true });
    expect(wrapper.get(".pause-rotation").text()).toBe("继续滚动");
    vi.mocked(invoke).mockResolvedValueOnce(false);
    await wrapper.get(".pause-rotation").trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("set_status_paused", { paused: false });
    await wrapper.get(".quit-app").trigger("click");
    expect(invoke).toHaveBeenCalledWith("exit_status_app");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(invoke).toHaveBeenCalledWith("hide_status_panel");
    wrapper.unmount();
  });
});

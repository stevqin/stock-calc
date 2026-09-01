import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import App from "./App.vue";
import { STORAGE_KEY } from "./state";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));
import { invoke } from "@tauri-apps/api/core";

let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("计算器界面", () => {
  it("输入即计算，调整一档与目标填价", async () => {
    wrapper = mount(App);
    expect(wrapper.find(".net-value").text()).toContain("+0.47");
    await wrapper.get("#sell-price").setValue("10.10");
    expect(wrapper.find(".net-value").text()).toContain("-0.53");
    await wrapper.get('button[aria-label="卖出价增加一档"]').trigger("click");
    expect(wrapper.find(".net-value").text()).toContain("+0.47");
    await wrapper.get("#target").setValue("50");
    await wrapper.get(".target-answer button").trigger("click");
    expect(
      Number(wrapper.get<HTMLInputElement>("#sell-price").element.value),
    ).toBeGreaterThan(10.6);
  });
  it("非法输入隐藏旧结果并显示指引", async () => {
    wrapper = mount(App);
    await wrapper.get("#quantity").setValue("101");
    expect(wrapper.find(".net-value").exists()).toBe(false);
    expect(wrapper.text()).toContain("交易数量须为100的整数倍");
  });
  it("行情刷新不会覆盖输入；必须显式填入", async () => {
    vi.mocked(invoke).mockResolvedValue({
      market: "sh",
      code: "600519",
      name: "贵州茅台",
      latest: "1286.98",
      bid: "1286.90",
      ask: "1286.99",
      quoteTime: "20260831100631",
      fetchedAt: "",
      kind: "stock",
    });
    wrapper = mount(App);
    await wrapper.get('input[aria-label="证券代码"]').setValue("600519");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("贵州茅台");
    expect(wrapper.get<HTMLInputElement>("#buy-price").element.value).toBe(
      "10.00",
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.get<HTMLInputElement>("#buy-price").element.value).toBe(
      "10.00",
    );
    await wrapper.get(".quote-actions button").trigger("click");
    expect(wrapper.get<HTMLInputElement>("#buy-price").element.value).toBe(
      "1286.98",
    );
  });
  it("股票ETF费率独立，持仓成本按净利润变化", async () => {
    wrapper = mount(App);
    await wrapper.get('input[aria-label="原持仓数量"]').setValue("1000");
    await wrapper.get('input[aria-label="原每股成本"]').setValue("10");
    expect(wrapper.find(".holding-result").text()).toContain("9.9995");
    await wrapper.get(".asset-tabs button:last-child").trigger("click");
    expect(wrapper.text()).toContain("ETF类别未确认");
    await wrapper.get('input[aria-label="ETF每边最低佣金"]').setValue("0");
    await wrapper.get(".asset-tabs button:first-child").trigger("click");
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="股票每边最低佣金"]')
        .element.value,
    ).toBe("5");
  });
  it("反向测算使用固定卖价，恢复上次输入", async () => {
    wrapper = mount(App);
    await wrapper.get(".direction-tabs button:last-child").trigger("click");
    expect(wrapper.text()).toContain("保本最高回补价");
    await wrapper.get("#quantity").setValue("500");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).quantity).toBe("500");
    wrapper.unmount();
    wrapper = mount(App);
    expect(wrapper.get<HTMLInputElement>("#quantity").element.value).toBe(
      "500",
    );
    expect(wrapper.text()).toContain("保本最高回补价");
  });
});

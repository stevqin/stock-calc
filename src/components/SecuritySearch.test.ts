import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SecuritySearch from "./SecuritySearch.vue";
import { remoteSecuritySearch, type SecurityHit } from "../securitySearch";

vi.mock("../securitySearch", async (original) => ({
  ...(await original<typeof import("../securitySearch")>()),
  remoteSecuritySearch: vi.fn(),
}));
const stock: SecurityHit = {
  market: "sh",
  code: "600519",
  name: "贵州茅台",
  asset: "stock",
};
const etf: SecurityHit = {
  market: "sz",
  code: "159915",
  name: "创业板ETF",
  asset: "etf",
};
let wrapper: ReturnType<typeof mount>;
function start(securities: SecurityHit[] = [stock, etf]) {
  wrapper = mount(SecuritySearch, { props: { securities } });
  return wrapper.find("input");
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(remoteSecuritySearch).mockReset().mockResolvedValue([]);
});
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});
describe("添加证券搜索交互", () => {
  it("选择证券后改词或清空会通知外层撤销旧选择", async () => {
    const input = start();
    await input.setValue("gzmt");
    await wrapper.find('[role="option"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([stock]);
    await input.setValue("cyb");
    expect(wrapper.emitted("clear")).toHaveLength(1);
    await wrapper.find('[role="option"]').trigger("click");
    await input.setValue("");
    expect(wrapper.emitted("clear")).toHaveLength(2);
  });
  it("防抖请求，直接展示本地拼音结果，鼠标选中仅发出选择事件", async () => {
    const input = start();
    await input.setValue("gz");
    await input.setValue("gzmt");
    expect(wrapper.find('[role="option"]').text()).toContain("贵州茅台");
    await vi.advanceTimersByTimeAsync(299);
    expect(remoteSecuritySearch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(remoteSecuritySearch).toHaveBeenCalledExactlyOnceWith("gzmt");
    await wrapper.find('[role="option"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([stock]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });
  it("丢弃快速切换关键词的旧请求和旧错误", async () => {
    let finishOld!: (hits: SecurityHit[]) => void;
    vi.mocked(remoteSecuritySearch)
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishOld = resolve)),
      )
      .mockResolvedValueOnce([etf]);
    const input = start([]);
    await input.setValue("gzmt");
    await vi.advanceTimersByTimeAsync(300);
    await input.setValue("cyb");
    await vi.advanceTimersByTimeAsync(300);
    finishOld([stock]);
    await flushPromises();
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("创业板ETF");
    expect(wrapper.text()).not.toContain("贵州茅台股票");
  });
  it("中文组字期间不查询且回车不误选择", async () => {
    const input = start();
    await input.trigger("compositionstart");
    await input.setValue("贵州茅");
    await vi.advanceTimersByTimeAsync(500);
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    expect(remoteSecuritySearch).not.toHaveBeenCalled();
    expect(wrapper.emitted("select")).toBeUndefined();
    await input.trigger("compositionend");
    await vi.advanceTimersByTimeAsync(300);
    expect(remoteSecuritySearch).toHaveBeenCalledWith("贵州茅");
  });
  it("方向键选中、回车填入，Esc先关闭候选", async () => {
    const input = start();
    await input.setValue("gzmt");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.find('[aria-selected="true"]').text()).toContain("贵州茅台");
    await input.trigger("keydown", { key: "Escape" });
    expect(input.attributes("aria-expanded")).toBe("false");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toBeUndefined();
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")?.[0]).toEqual([stock]);
  });
  it("断网仍显示本地匹配并提示重试", async () => {
    vi.mocked(remoteSecuritySearch).mockRejectedValue(new Error("连接失败"));
    const input = start();
    await input.setValue("gzmt");
    await vi.advanceTimersByTimeAsync(300);
    expect(
      document.querySelector(".floating-notice.error")?.textContent,
    ).toContain("连接失败；请重试搜索");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    await input.setValue("zzzxxyyqqq");
    await vi.advanceTimersByTimeAsync(300);
    expect(wrapper.text()).toContain("未找到匹配证券");
    expect(wrapper.emitted("select")).toBeUndefined();
  });
  it("清空和卸载后不再发请求，已发请求返回不能重开列表", async () => {
    let finish!: (hits: SecurityHit[]) => void;
    vi.mocked(remoteSecuritySearch).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const input = start([]);
    await input.setValue("gzmt");
    await vi.advanceTimersByTimeAsync(300);
    await input.setValue("");
    finish([stock]);
    await flushPromises();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await input.setValue("cyb");
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(300);
    expect(remoteSecuritySearch).toHaveBeenCalledTimes(1);
  });
  it("本地模式只搜索传入证券，不请求全市场", async () => {
    wrapper = mount(SecuritySearch, {
      props: {
        securities: [stock],
        localOnly: true,
        resultHint: "Enter 筛选",
      },
    });
    const input = wrapper.find("input");
    await input.setValue("gzmt");
    await vi.advanceTimersByTimeAsync(500);
    expect(remoteSecuritySearch).not.toHaveBeenCalled();
    expect(wrapper.find('[role="option"]').text()).toContain("贵州茅台");
    expect(wrapper.text()).toContain("Enter 筛选");
    expect(wrapper.text()).toContain("仅搜索已有历史交易的证券");
  });
});

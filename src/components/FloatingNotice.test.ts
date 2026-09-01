import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import FloatingNotice from "./FloatingNotice.vue";
import { noticeStack } from "./noticeStack";
const wrappers: ReturnType<typeof mount>[] = [];
function start(props: {
  message: string;
  kind?: "info" | "warning" | "error";
  duration?: number;
}) {
  const wrapper = mount(FloatingNotice, { props });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
  expect(noticeStack).toHaveLength(0);
});
describe("悬浮轻提示", () => {
  it("跨组件共用一个body悬浮栈，关闭首项后余项保留且无重复", async () => {
    start({ message: "待对账", kind: "warning" });
    start({ message: "保存失败" });
    await nextTick();
    expect(document.querySelectorAll(".floating-notices")).toHaveLength(1);
    expect(document.querySelectorAll(".floating-notice")).toHaveLength(2);
    (
      document.querySelector(".floating-notice button") as HTMLButtonElement
    ).click();
    await nextTick();
    expect(document.querySelectorAll(".floating-notices")).toHaveLength(1);
    expect(document.querySelectorAll(".floating-notice")).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "保存失败",
    );
  });
  it("手动关闭只隐藏消息，不修改校验状态；相同提醒不重新弹出", async () => {
    const w = start({ message: "待对账", kind: "warning" });
    await nextTick();
    (
      document.querySelector(".floating-notice button") as HTMLButtonElement
    ).click();
    await nextTick();
    expect(w.props("message")).toBe("待对账");
    await w.setProps({ message: "待对账" });
    expect(document.querySelector(".floating-notices")).toBeNull();
    await w.setProps({ message: "" });
    await w.setProps({ message: "新的待对账提醒" });
    expect(document.querySelector(".floating-notice")?.textContent).toContain(
      "新的待对账提醒",
    );
  });
  it("错误持续显示，成功提示可手动关闭也可定时退出", async () => {
    vi.useFakeTimers();
    start({ message: "持久错误" });
    start({ message: "已保存", kind: "info", duration: 3000 });
    await nextTick();
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelectorAll(".floating-notice")).toHaveLength(1);
    expect(document.querySelector(".floating-notice")?.textContent).toContain(
      "持久错误",
    );
  });
  it("消息不在原组件布局内；清空或卸载删除对应提示", async () => {
    const w = start({ message: "草稿无法保存" });
    await nextTick();
    expect(w.find(".floating-notices").exists()).toBe(false);
    await w.setProps({ message: "" });
    expect(document.querySelector(".floating-notices")).toBeNull();
    await w.setProps({ message: "另一条错误" });
    w.unmount();
    await nextTick();
    expect(document.querySelector(".floating-notices")).toBeNull();
  });
});

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import OverlayScrollbar from "./OverlayScrollbar.vue";
let wrapper: ReturnType<typeof mount>, area: HTMLDivElement;
const bar = () => document.querySelector<HTMLElement>(".overlay-scroll-thumb");
async function scroll(top: number) {
  area.scrollTop = top;
  area.dispatchEvent(new Event("scroll"));
  await vi.advanceTimersByTimeAsync(20);
  await nextTick();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("CSS", { supports: () => true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  area = document.createElement("div");
  area.style.overflowY = "auto";
  document.body.append(area);
  Object.defineProperties(area, {
    clientWidth: { value: 300 },
    clientHeight: { value: 200 },
    scrollHeight: { value: 1000, writable: true },
  });
  area.getBoundingClientRect = () => ({
    left: 20,
    top: 10,
    right: 320,
    bottom: 210,
    width: 300,
    height: 200,
    x: 20,
    y: 10,
    toJSON() {},
  });
  wrapper = mount(OverlayScrollbar);
});
afterEach(() => {
  wrapper.unmount();
  area.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("默认隐藏、滚动显示、停止900ms隐藏，DOM不包裹或挤占内容", async () => {
  expect(
    document.documentElement.classList.contains("overlay-scrollbars-enabled"),
  ).toBe(true);
  expect(bar()).toBeNull();
  await scroll(100);
  expect(bar()?.classList.contains("is-visible")).toBe(true);
  expect(bar()?.getAttribute("aria-valuemax")).toBe("800");
  expect(bar()?.getAttribute("aria-valuenow")).toBe("100");
  expect(area.parentElement).toBe(document.body);
  expect(area.style.width).toBe("");
  await vi.advanceTimersByTimeAsync(901);
  expect(bar()?.classList.contains("is-visible")).toBe(false);
});
it("仅横向滚动不显示纵向条，无纵向溢出也不显示", async () => {
  area.scrollLeft = 100;
  await scroll(0);
  expect(bar()).toBeNull();
  Object.defineProperty(area, "scrollHeight", { value: 200 });
  await scroll(1);
  expect(bar()).toBeNull();
});
it("新滚动重新延长可见时间，拖动映射到scrollTop", async () => {
  await scroll(100);
  await vi.advanceTimersByTimeAsync(600);
  await scroll(200);
  await vi.advanceTimersByTimeAsync(600);
  expect(bar()?.classList.contains("is-visible")).toBe(true);
  const thumb = bar()!;
  thumb.setPointerCapture = vi.fn();
  const pointer = (type: string, y: number) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientY: y, button: 0, pointerId: 1 });
    thumb.dispatchEvent(e);
  };
  pointer("pointerdown", 50);
  pointer("pointermove", 80);
  expect(area.scrollTop).toBeGreaterThan(200);
  pointer("pointerup", 80);
});
it("键盘滚动、窗口变化隐藏、卸载清理样式与自动ID", async () => {
  await scroll(100);
  bar()!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(area.scrollTop).toBeGreaterThanOrEqual(800);
  window.dispatchEvent(new Event("resize"));
  await nextTick();
  expect(bar()?.classList.contains("is-visible")).toBe(false);
  expect(area.id).toMatch(/^overlay-scroll-area-/);
  wrapper.unmount();
  expect(area.id).toBe("");
  expect(
    document.documentElement.classList.contains("overlay-scrollbars-enabled"),
  ).toBe(false);
});
it("被裁剪或已移除的滚动容器不显示悬浮条", async () => {
  area.getBoundingClientRect = () => ({
    left: 2000,
    top: 10,
    right: 2300,
    bottom: 210,
    width: 300,
    height: 200,
    x: 2000,
    y: 10,
    toJSON() {},
  });
  await scroll(100);
  expect(bar()?.classList.contains("is-visible")).not.toBe(true);
  area.remove();
  await scroll(200);
  expect(bar()?.classList.contains("is-visible")).not.toBe(true);
});
it("不支持分轴原生样式的浏览器保留原生滚动条", async () => {
  wrapper.unmount();
  vi.stubGlobal("CSS", { supports: () => false });
  wrapper = mount(OverlayScrollbar);
  await scroll(100);
  expect(
    document.documentElement.classList.contains("overlay-scrollbars-enabled"),
  ).toBe(false);
  expect(bar()).toBeNull();
});
it("既有元素ID不被替换，滚动回顶部可正确归零", async () => {
  area.id = "existing-panel";
  await scroll(400);
  await scroll(0);
  expect(bar()?.getAttribute("aria-controls")).toBe("existing-panel");
  expect(bar()?.getAttribute("aria-valuenow")).toBe("0");
  wrapper.unmount();
  expect(area.id).toBe("existing-panel");
});

import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import RowContextMenu from "./RowContextMenu.vue";
let wrapper: ReturnType<typeof mount>;
afterEach(() => wrapper?.unmount());
async function start() {
  wrapper = mount(RowContextMenu, {
    attachTo: document.body,
    props: {
      x: 99999,
      y: 99999,
      title: "测试证券",
      items: [
        { id: "a", label: "查看详情" },
        { id: "b", label: "移出", disabled: true },
        { id: "c", label: "取消选择" },
      ],
    },
  });
  await flushPromises();
}
describe("证券右键菜单", () => {
  it("限制窗口边界，方向键跳过禁用项，Esc关闭", async () => {
    await start();
    expect(
      parseFloat((wrapper.element as HTMLElement).style.left),
    ).toBeLessThan(innerWidth);
    expect(parseFloat((wrapper.element as HTMLElement).style.top)).toBeLessThan(
      innerHeight,
    );
    expect(document.activeElement?.textContent).toBe("查看详情");
    await wrapper.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("取消选择");
    await wrapper.trigger("keydown", { key: "Home" });
    expect(document.activeElement?.textContent).toBe("查看详情");
    await wrapper.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
  it("菜单选项执行后关闭，点击外部或滚动列表关闭", async () => {
    await start();
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("action")).toEqual([["a"]]);
    expect(wrapper.emitted("close")).toHaveLength(1);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new Event("scroll"));
    expect(wrapper.emitted("close")).toHaveLength(3);
    await wrapper.trigger("scroll");
    expect(wrapper.emitted("close")).toHaveLength(3);
  });
});

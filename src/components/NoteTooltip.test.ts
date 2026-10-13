import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import NoteTooltip from "./NoteTooltip.vue";

describe("备注悬浮提示", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("鼠标移入省略内容后在页面顶层显示完整备注，移出后关闭", async () => {
    const wrapper = mount(NoteTooltip, {
      attachTo: document.body,
      props: { text: "这是一条需要完整展示的长备注" },
      slots: { default: "这是一条需要完整展示的长备注" },
    });

    await wrapper.find(".note-tooltip-anchor").trigger("mouseenter");
    expect(
      document.body.querySelector(".note-tooltip-popover")?.textContent,
    ).toBe("这是一条需要完整展示的长备注");

    await wrapper.find(".note-tooltip-anchor").trigger("mouseleave");
    expect(document.body.querySelector(".note-tooltip-popover")).toBeNull();
  });

  it("空备注不创建悬浮层", async () => {
    const wrapper = mount(NoteTooltip, {
      attachTo: document.body,
      props: { text: "" },
      slots: { default: "—" },
    });
    await wrapper.find(".note-tooltip-anchor").trigger("mouseenter");
    expect(document.body.querySelector(".note-tooltip-popover")).toBeNull();
  });
});

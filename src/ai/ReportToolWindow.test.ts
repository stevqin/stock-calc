import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import ReportToolWindow from "./ReportToolWindow.vue";
describe("floating report tools", () => {
  it("takes no report space when closed and opens only on request", async () => {
    const w = mount(ReportToolWindow, {
      attachTo: document.body,
      props: { open: false, title: "分析设置" },
      slots: { default: "设置内容" },
    });
    expect(w.get(".ai-tool-overlay").isVisible()).toBe(false);
    await w.setProps({ open: true });
    expect(w.get('[role="dialog"]').isVisible()).toBe(true);
    await w.get('button[aria-label="关闭分析设置"]').trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });
  it("Escape closes the tool without closing the report", async () => {
    const w = mount(ReportToolWindow, {
      attachTo: document.body,
      props: { open: true, title: "历史报告" },
    });
    await w.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });
});

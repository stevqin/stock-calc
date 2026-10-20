import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import MarkdownReport from "./MarkdownReport.vue";
describe("Markdown report", () => {
  it("renders headings, prices and shares without requiring fields or JSON", () => {
    const w = mount(MarkdownReport, {
      props: {
        text: "# 操作\n\n**继续持有底仓**\n\n|动作|具体价格（元）|数量|执行条件|取消条件|\n|---|---|---|---|---|\n|卖出|**12.30元**（L2：压力参考价）|**200股**|触及12.30元后冲高回落|放量突破12.30元|",
      },
    });
    expect(w.find("h1").text()).toBe("操作");
    expect(w.find("table").text()).toContain("12.30元（L2：压力参考价）");
    expect(w.findAll("table strong").map((e) => e.text())).toEqual([
      "12.30元",
      "200股",
    ]);
    expect(w.find("table").text()).toContain("触及12.30元后冲高回落");
    expect(w.text()).toContain("200");
    expect(w.find("strong").text()).toContain("继续持有");
  });
  it("keeps free text, broken Markdown and truncated text visible", () => {
    const text = "任意结论，无固定标题；{not JSON\n**还没写完";
    const w = mount(MarkdownReport, { props: { text, incomplete: true } });
    expect(w.text()).toContain("{not JSON");
    expect(w.text()).toContain("还没写完");
    expect(w.text()).toContain("不完整");
  });
  it("does not execute HTML, javascript links or load remote images", () => {
    const w = mount(MarkdownReport, {
      props: {
        text: "<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[坏链接](javascript:alert(1))\n![图](https://track.invalid/x)\n[来源](https://example.com/)",
      },
    });
    expect(w.find("script").exists()).toBe(false);
    expect(w.find("img").exists()).toBe(false);
    expect(w.findAll("a")).toHaveLength(1);
    expect(w.find("a").attributes("rel")).toContain("noopener");
  });
});

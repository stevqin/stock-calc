import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import ReportHistoryList from "./ReportHistoryList.vue";
import type { TaskDetail } from "./types";
const record = (id: string, date: string, status = "completed") =>
  ({
    id,
    parentId: null,
    createdAt: date,
    status,
    requestSnapshot: {
      securities: [{ name: "示例股份", code: "600519" }],
      participantIds: ["m"],
      group: null,
    },
    reports: [{ modelSnapshot: { displayName: "示例模型" } }],
    summaryVersions: [{}],
    securitySnapshots: [],
    errors: [],
  }) as unknown as TaskDetail;
describe("report history list", () => {
  it("groups records, marks current report and opens the chosen record without model actions", async () => {
    const records = [
      record("one", "2026-10-19T07:00:00Z"),
      record("two", "2026-10-18T07:00:00Z"),
    ];
    const w = mount(ReportHistoryList, {
      props: { items: records, currentId: "one", busy: false, hasMore: false },
    });
    expect(w.findAll(".ai-library-day")).toHaveLength(2);
    expect(w.get('[data-history-open="one"]').attributes("aria-current")).toBe(
      "true",
    );
    await w.get('[data-history-open="two"]').trigger("click");
    expect(w.emitted("select")?.[0]).toEqual([records[1]]);
    await w.get('[data-history-delete="two"]').trigger("click");
    expect(w.emitted("remove")?.[0]).toEqual([records[1]]);
    expect(w.emitted("select")).toHaveLength(1);
  });
  it("keeps running reports and batch child reports protected from deletion", () => {
    const running = record("running", "2026-10-19T07:00:00Z", "analyzing");
    const child = {
      ...record("child", "2026-10-18T07:00:00Z"),
      parentId: "batch",
    };
    const w = mount(ReportHistoryList, {
      props: {
        items: [running, child],
        currentId: "child",
        busy: false,
        hasMore: true,
      },
    });
    expect(
      w.get('[data-history-delete="running"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      w.get('[data-history-delete="child"]').attributes("disabled"),
    ).toBeDefined();
    expect(w.text()).toContain("整批");
  });
  it("shows interrupted reports in the needs-attention filter", async () => {
    const w = mount(ReportHistoryList, {
      props: {
        items: [record("interrupted", "2026-10-19T07:00:00Z", "interrupted")],
        busy: false,
        hasMore: false,
      },
    });
    expect(w.text()).toContain("上次运行已中断");
    await w.findAll(".ai-library-filter button")[2].trigger("click");
    expect(w.find('[data-history-open="interrupted"]').exists()).toBe(true);
    w.unmount();
  });
});

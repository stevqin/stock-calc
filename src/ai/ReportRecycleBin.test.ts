import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ReportRecycleBin from "./ReportRecycleBin.vue";
import { listHistory, restoreTask, purgeTask } from "./client";
vi.mock("./client", () => ({
  listHistory: vi.fn(),
  restoreTask: vi.fn(),
  purgeTask: vi.fn(),
  aiErrorMessage: (e: any) => e.message,
}));
const task = {
  id: "old",
  parentId: null,
  deletedAt: "2026-10-14T06:00:00Z",
  createdAt: "2026-10-13T06:00:00Z",
  requestSnapshot: { securities: [{ name: "示例股份" }], group: null },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listHistory).mockResolvedValue({
    items: [task as any],
    nextCursor: null,
  });
  vi.mocked(restoreTask).mockResolvedValue();
  vi.mocked(purgeTask).mockResolvedValue();
});
describe("报告回收站", () => {
  it("恢复保留记录，不调用模型", async () => {
    const w = mount(ReportRecycleBin, {
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    await w.get("[data-restore]").trigger("click");
    await flushPromises();
    expect(restoreTask).toHaveBeenCalledWith("old");
    expect(w.emitted("changed")).toBeTruthy();
  });
  it("永久删除必须单独确认，取消不会删除", async () => {
    const w = mount(ReportRecycleBin, {
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    await w.get("[data-purge]").trigger("click");
    expect(purgeTask).not.toHaveBeenCalled();
    expect(w.text()).toContain("不可恢复");
    await w.get("[data-cancel-purge]").trigger("click");
    expect(purgeTask).not.toHaveBeenCalled();
    await w.get("[data-purge]").trigger("click");
    await w.get("[data-confirm-purge]").trigger("click");
    await flushPromises();
    expect(purgeTask).toHaveBeenCalledWith("old");
  });
});

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

it("separates deletion time from report time, supports search and keeps restore primary", async () => {
  const w = mount(ReportRecycleBin, { global: { stubs: { teleport: true } } });
  await flushPromises();
  expect(w.find(".ai-library-card").text()).toContain("删除于");
  expect(w.find(".ai-library-card").text()).toContain("生成于");
  expect(w.get("[data-restore]").classes()).toContain("ai-library-restore");
  expect(w.find("h3").exists()).toBe(false);
  await w.get('input[aria-label="搜索回收站"]').setValue("不存在的股票");
  expect(w.text()).toContain("没有匹配的报告");
  expect(w.find("[data-restore]").exists()).toBe(false);
  expect(restoreTask).not.toHaveBeenCalled();
  w.unmount();
});

it("keeps failed restores visible and does not emit a successful change", async () => {
  vi.mocked(restoreTask).mockRejectedValueOnce({
    message: "恢复失败，请稍后再试",
  });
  const w = mount(ReportRecycleBin, { global: { stubs: { teleport: true } } });
  await flushPromises();
  await w.get("[data-restore]").trigger("click");
  await flushPromises();
  expect(w.get('[role="alert"]').text()).toContain("恢复失败");
  expect(w.find("[data-restore]").exists()).toBe(true);
  expect(w.emitted("changed")).toBeUndefined();
  w.unmount();
});
it("loads older deleted records and warns that permanent deletion affects the whole batch", async () => {
  const batch = {
    ...task,
    id: "batch",
    requestSnapshot: {
      group: { name: "示例组合" },
      securities: [{ name: "甲" }, { name: "乙" }],
    },
  };
  vi.mocked(listHistory)
    .mockResolvedValueOnce({ items: [task as any], nextCursor: "older" })
    .mockResolvedValueOnce({ items: [batch as any], nextCursor: null });
  const w = mount(ReportRecycleBin, { global: { stubs: { teleport: true } } });
  await flushPromises();
  await w.get(".ai-library-more").trigger("click");
  await flushPromises();
  expect(listHistory).toHaveBeenLastCalledWith({
    trashed: true,
    limit: 30,
    cursor: "older",
  });
  expect(w.findAll(".ai-library-card")).toHaveLength(2);
  await w.findAll("[data-purge]")[1].trigger("click");
  expect(w.get('[role="alertdialog"]').text()).toContain("整批报告及其子报告");
  await w.get("[data-cancel-purge]").trigger("click");
  expect(purgeTask).not.toHaveBeenCalled();
  w.unmount();
});

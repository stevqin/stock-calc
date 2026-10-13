import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { modelClient, listHistory, loadTask } from "./client";
import StockAnalysisDrawer from "./StockAnalysisDrawer.vue";
import type { TaskDetail } from "./types";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));
vi.mock("./client", () => ({
  modelClient: { listModels: vi.fn(), getDefaults: vi.fn() },
  listHistory: vi.fn(),
  loadTask: vi.fn(),
  aiErrorMessage: (e: any) => e.message ?? "失败",
}));
const security = {
  id: "sh600519",
  market: "sh",
  code: "600519",
  name: "贵州茅台",
  asset: "stock" as const,
};
const model = {
  id: "m1",
  displayName: "模型一",
  provider: "custom",
  baseUrl: "https://fixture.invalid/v1",
  model: "fixture-version",
  enabled: true,
};
const report = {
  id: "r1",
  snapshotId: "s1",
  modelSnapshot: model,
  windows: [
    {
      horizon: "today",
      direction: "uncertain",
      confidence: "low",
      logic: "复盘",
    },
    {
      horizon: "future",
      direction: "sideways",
      confidence: "low",
      logic: "震荡依据",
    },
  ],
  claims: [{ id: "c1", text: "模型一的原始依据", evidenceIds: ["e1"] }],
  rawOutput: '{"overview":"独立观点"}',
  validation: { valid: true },
  usage: null,
};
const task: TaskDetail = {
  id: "t1",
  parentId: null,
  createdAt: "2026-10-13T10:00:00Z",
  status: "completed",
  requestSnapshot: {
    requestId: "q1",
    securities: [security],
    group: null,
    participantIds: ["m1"],
    summaryModelId: "m1",
  },
  securitySnapshots: [
    {
      id: "s1",
      security,
      cutoffAt: "2026-10-13T10:00:00Z",
      frozenAt: "2026-10-13T10:00:00Z",
      referencePrice: "100",
      windows: { todayMode: "review", futureDates: ["2026-10-14"] },
      series: {},
      indicators: {},
      evidence: [
        {
          id: "e1",
          securityId: security.id,
          kind: "quote",
          source: "行情来源",
          url: null,
          publishedAt: null,
          timePrecision: "unknown",
          eventAt: null,
          collectedAt: "2026-10-13T10:00:00Z",
          content: "冻结行情依据",
          contentHash: "fixture",
          availability: "available",
        },
      ],
      sourceStates: { news: "sourceLinksOnly" },
      ruleVersions: {},
    },
  ],
  progress: {},
  callAttempts: [{ phase: "sending" }],
  reports: [report],
  summaryVersions: [
    {
      id: "v1",
      snapshotId: "s1",
      version: 1,
      inputReportIds: ["r1"],
      summaryModelSnapshot: model,
      windows: { overview: "综合结论" },
      keyClaims: [
        { text: "关键判断", supports: [{ reportId: "r1", claimId: "c1" }] },
      ],
      disagreements: [],
      validation: { valid: true },
    },
  ],
  groupSummaryVersions: [],
  errors: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(modelClient.listModels).mockResolvedValue([
    model,
    { ...model, id: "m2", displayName: "模型二" },
  ]);
  vi.mocked(modelClient.getDefaults).mockResolvedValue({
    participantIds: ["m1", "m2"],
    summaryModelId: "m1",
  });
  vi.mocked(listHistory).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(loadTask).mockResolvedValue(task);
  vi.mocked(invoke).mockResolvedValue(task);
});
describe("single stock AI drawer", () => {
  it("shows call estimate, starts chosen models without altering defaults", async () => {
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(w.text()).toContain("预计调用 3 次");
    expect(invoke).not.toHaveBeenCalled();
    await w
      .get('textarea[aria-label="补充分析资料"]')
      .setValue("用户补充公告正文");
    await w
      .findAll("button")
      .find((b) => b.text() === "开始分析")!
      .trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith(
      "ai_start_stock_analysis",
      expect.objectContaining({
        manualMaterial: "用户补充公告正文",
        request: expect.objectContaining({
          securities: [security],
          participantIds: ["m1", "m2"],
          summaryModelId: "m1",
        }),
      }),
    );
    w.unmount();
    expect(invoke).not.toHaveBeenCalledWith(
      "ai_cancel_stock_analysis",
      expect.anything(),
    );
  });
  it("opens history without model calls and expands original per-model evidence", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      items: [task],
      nextCursor: null,
    });
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(invoke).not.toHaveBeenCalled();
    expect(w.text()).toContain("综合结论");
    expect(w.text()).toContain("1/1 个模型提供依据 · 单模型依据");
    expect(w.text()).toContain("模型一的原始依据");
    expect(w.text()).toContain("冻结行情依据");
    expect(w.text()).toContain("今日已收盘");
    await w.get(".ai-close").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("uses a separate summary-only call on the frozen historical task", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      items: [task],
      nextCursor: null,
    });
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().startsWith("重新汇总"))!
      .trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("ai_resummarize_stock", {
      taskId: "t1",
      summaryModelId: "m1",
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "ai_start_stock_analysis",
      expect.anything(),
    );
    w.unmount();
  });
});

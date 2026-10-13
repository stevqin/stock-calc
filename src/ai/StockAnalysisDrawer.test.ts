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
  it("shows all three strategy conclusions without opening model evidence", async () => {
    const strategyTask = structuredClone(task);
    strategyTask.summaryVersions[0].keyClaims = [
      "conservative",
      "intraday",
      "swing",
    ].map((strategy) => ({
      strategy,
      text: strategy + "操作与适用条件",
      supports: [{ reportId: "r1", claimId: "c1" }],
    }));
    vi.mocked(listHistory).mockResolvedValue({
      items: [strategyTask],
      nextCursor: null,
    });
    vi.mocked(loadTask).mockResolvedValue(strategyTask);
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(w.findAll(".ai-operation-claim > h4").map((h) => h.text())).toEqual([
      "稳健持仓",
      "做 T",
      "中短线",
    ]);
    for (const c of w.findAll(".ai-operation-claim")) {
      expect(c.get("p").text()).toContain("操作与适用条件");
      expect(c.get("details").attributes("open")).toBeUndefined();
    }
    expect(invoke).not.toHaveBeenCalled();
    w.unmount();
  });
  it("keeps real execution stages expanded while analyzing", async () => {
    const running: TaskDetail = {
      ...task,
      status: "analyzing",
      reports: [],
      summaryVersions: [],
    };
    vi.mocked(listHistory).mockResolvedValue({
      items: [running],
      nextCursor: null,
    });
    vi.mocked(loadTask).mockResolvedValue(running);
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(
      w.get(".ai-execution-trace > details").attributes("open"),
    ).toBeDefined();
    expect(w.get(".ai-execution-trace").text()).toContain("正在执行");
    w.unmount();
  });
  it("puts conclusions before diagnostics and folds completed reports", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      items: [task],
      nextCursor: null,
    });
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    const cards = w.findAll(".ai-drawer-scroll > section");
    expect(
      cards.findIndex((c) => c.classes().includes("ai-summary-card")),
    ).toBeLessThan(
      cards.findIndex((c) => c.classes().includes("ai-execution-trace")),
    );
    expect(
      w.get(".ai-execution-trace > details").attributes("open"),
    ).toBeUndefined();
    expect(
      w.get(".ai-model-report > details").attributes("open"),
    ).toBeUndefined();
    expect(w.get(".ai-claim > p").text()).toBe("关键判断");
    expect(w.get(".ai-claim > details > summary").text()).toContain("模型依据");
    expect((w.get(".ai-setup-body").element as HTMLElement).style.display).toBe(
      "none",
    );
    w.unmount();
  });
  it("dismisses a hover tooltip before Escape can close the drawer", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      items: [task],
      nextCursor: null,
    });
    const w = mount(StockAnalysisDrawer, {
      props: { security },
      attachTo: document.body,
    });
    await flushPromises();
    (w.get(".ai-close").element as HTMLElement).focus();
    await w.get('button[aria-label="置信等级说明"]').trigger("mouseenter");
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await w.get(".ai-close").trigger("keydown", { key: "Escape" });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(w.emitted("close")).toBeUndefined();
    w.unmount();
  });
  it("keeps the explanation visible while moving from trigger to tooltip", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      items: [task],
      nextCursor: null,
    });
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    vi.useFakeTimers();
    const help = w.get('button[aria-label="置信等级说明"]');
    await help.trigger("mouseenter");
    await help.trigger("mouseleave");
    document
      .querySelector('[role="tooltip"]')!
      .dispatchEvent(new MouseEvent("mouseenter"));
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    document
      .querySelector('[role="tooltip"]')!
      .dispatchEvent(new MouseEvent("mouseleave"));
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    w.unmount();
    vi.useRealTimers();
  });
  it("explains confidence with a keyboard accessible tooltip", async () => {
    vi.mocked(listHistory).mockResolvedValue({
      items: [task],
      nextCursor: null,
    });
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    const help = w.get('button[aria-label="置信等级说明"]');
    await help.trigger("focus");
    expect(document.querySelector('[role="tooltip"]')!.textContent).toContain(
      "不是经统计校准的概率",
    );
    await help.trigger("mouseleave");
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await help.trigger("keydown", { key: "Escape" });
    expect(w.emitted("close")).toBeUndefined();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    w.unmount();
  });
  it("collapses setup immediately on start and can expand again", async () => {
    let resolve!: (value: TaskDetail) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<any>((r) => {
          resolve = r;
        }),
    );
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text() === "开始分析")!
      .trigger("click");
    expect(w.get(".ai-setup-body").isVisible()).toBe(false);
    expect(w.get(".ai-setup-compact").text()).toContain("预计 3 次");
    await w.get('button[aria-label="展开模型与资料"]').trigger("click");
    expect(
      w.get('button[aria-label="收起模型与资料"]').attributes("aria-expanded"),
    ).toBe("true");
    expect(
      (w.get(".ai-setup-body").element as HTMLElement).style.display,
    ).not.toBe("none");
    resolve(task);
    await flushPromises();
    w.unmount();
  });
  it("shows persisted tool stages, elapsed time and public analysis summaries", async () => {
    const traced = {
      ...task,
      progress: {
        events: [
          {
            stage: "daily",
            state: "running",
            label: "工具 · 获取日线",
            detail: "腾讯公开行情",
            at: "2026-10-13T10:00:00Z",
          },
          {
            stage: "daily",
            state: "done",
            label: "工具 · 获取日线",
            detail: "已获取数据",
            at: "2026-10-13T10:00:02Z",
          },
          {
            stage: "model",
            state: "done",
            label: "模型一 · 独立分析",
            detail: "公开结论摘要",
            at: "2026-10-13T10:00:04Z",
          },
        ],
      },
    };
    vi.mocked(listHistory).mockResolvedValue({
      items: [traced],
      nextCursor: null,
    });
    vi.mocked(loadTask).mockResolvedValue(traced);
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(w.get(".ai-execution-trace").text()).toContain("工具 · 获取日线");
    expect(w.get(".ai-execution-trace").text()).toContain("2 秒");
    expect(w.get(".ai-execution-trace").text()).toContain("公开结论摘要");
    expect(invoke).not.toHaveBeenCalled();
    w.unmount();
  });
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

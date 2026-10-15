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
  restoreTask: vi.fn().mockResolvedValue(undefined),
  purgeTask: vi.fn().mockResolvedValue(undefined),
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
  it("distinguishes received headers from a complete generated response", async () => {
    const pending = structuredClone(task);
    pending.status = "analyzing";
    pending.callAttempts = [
      {
        callId: "one",
        attempt: 1,
        phase: "responseHeaders",
        role: "repair",
        modelId: "m1",
        at: "2026-10-14T06:00:00Z",
      },
    ];
    vi.mocked(listHistory).mockResolvedValue({
      items: [pending],
      nextCursor: null,
    });
    vi.mocked(loadTask).mockResolvedValue(pending);
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(w.text()).toContain("服务端已开始回应，还在等待完整报告");
    expect(w.text()).not.toContain("完整响应已接收");
    w.unmount();
  });
  it("restoring the only deleted report reopens it in the same drawer", async () => {
    vi.mocked(listHistory).mockImplementation(async (q) =>
      q.trashed
        ? {
            items: [{ ...task, deletedAt: "2026-10-14T06:00:00Z" }],
            nextCursor: null,
          }
        : { items: [], nextCursor: null },
    );
    const w = mount(StockAnalysisDrawer, {
      props: { security },
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text() === "回收站")!
      .trigger("click");
    await flushPromises();
    vi.mocked(listHistory).mockResolvedValue({
      items: [task],
      nextCursor: null,
    });
    await w.get("[data-restore]").trigger("click");
    await flushPromises();
    expect(w.find(".ai-summary-card").exists()).toBe(true);
    w.unmount();
  });
  it("shows five V2 operations and the frozen cash instead of current account props", async () => {
    const ops = [
      "today",
      "week",
      "conservative",
      "shortTerm",
      "mediumLongTerm",
    ].map((operationType) => ({
      operationType,
      text: "等待确认",
      reason: "持仓依据",
      status: "wait",
      action: "wait",
      horizon: "冻结窗口",
      trigger: "满足条件",
      invalidation: "停止条件",
      quantityBasis: "仅可卖底仓",
      cashBasis: "冻结余额限制",
      feeImpact: "费用不足",
      conflictsWith: [],
      supports: [{ reportId: "r1", claimId: "c1" }],
    }));
    const v2 = structuredClone(task);
    (v2.securitySnapshots[0].ruleVersions as any).format = 2;
    v2.securitySnapshots[0].evidence.push({
      ...v2.securitySnapshots[0].evidence[0],
      id: "cash",
      kind: "cash",
      content: JSON.stringify({
        balance: "1234.56",
        initialized: true,
        hasWarnings: false,
      }),
    });
    v2.summaryVersions[0].keyClaims = ops;
    vi.mocked(listHistory).mockResolvedValue({ items: [v2], nextCursor: null });
    vi.mocked(loadTask).mockResolvedValue(v2);
    const w = mount(StockAnalysisDrawer, {
      props: {
        security,
        cashContext: {
          balance: "99999",
          asOf: "2026-10-14T06:00:00Z",
          initialized: true,
          hasWarnings: false,
          source: "localLedger",
        },
      },
    });
    await flushPromises();
    expect(w.findAll(".ai-v2-operation")).toHaveLength(1);
    expect(w.findAll('[role="tab"]')).toHaveLength(5);
    expect(w.find(".ai-report-context").attributes("open")).toBeUndefined();
    expect(w.get(".ai-frozen-account").text()).toContain("1,234.56");
    expect(w.get(".ai-frozen-account").text()).not.toContain("99,999");
    w.unmount();
  });
  it("confirms soft deletion without automatically cancelling or calling a model", async () => {
    vi.mocked(listHistory)
      .mockResolvedValueOnce({ items: [task], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    const w = mount(StockAnalysisDrawer, {
      props: { security },
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    const del = w.findAll("button").find((b) => b.text() === "删除报告")!;
    await del.trigger("click");
    expect(invoke).not.toHaveBeenCalled();
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
    await w.get("[data-confirm-purge]").trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("ai_delete_task", { taskId: "t1" });
    expect(invoke).toHaveBeenCalledTimes(1);
    w.unmount();
  });
  it("does not count an invalid saved output as a successful independent report", async () => {
    const broken: TaskDetail = {
      ...task,
      status: "partial",
      reports: [
        {
          ...report,
          validation: { valid: false, error: "持仓报告缺少三种操作方向" },
        },
      ],
      summaryVersions: [],
      errors: [
        {
          code: "invalidAnalysis",
          message: "持仓报告缺少三种操作方向",
          retryable: false,
        },
      ],
    };
    vi.mocked(listHistory).mockResolvedValue({
      items: [broken],
      nextCursor: null,
    });
    vi.mocked(loadTask).mockResolvedValue(broken);
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(w.get(".ai-report-state").text()).toContain("分析失败");
    expect(w.get(".ai-report-state").text()).toContain("0/1 份有效独立报告");
    expect(w.text()).toContain("已收到 1 份输出，1 份未通过校验");
    expect(w.find(".ai-summary-card").exists()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    w.unmount();
  });
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
  it("shows first and repair outputs separately without calling models", async () => {
    const audited = structuredClone(task);
    (audited.reports[0] as any).outputs = [
      {
        role: "independent",
        rawOutput: "FIRST_OUTPUT",
        validation: { valid: false, error: "claims[0].id：缺少必填字段" },
      },
      {
        role: "repair",
        rawOutput: "REPAIR_OUTPUT",
        validation: { valid: true },
      },
    ];
    vi.mocked(listHistory).mockResolvedValue({
      items: [audited],
      nextCursor: null,
    });
    vi.mocked(loadTask).mockResolvedValue(audited);
    const w = mount(StockAnalysisDrawer, { props: { security } });
    await flushPromises();
    expect(w.text()).toContain("首次输出");
    expect(w.text()).toContain("格式修复输出");
    expect(w.text()).toContain("FIRST_OUTPUT");
    expect(w.text()).toContain("REPAIR_OUTPUT");
    expect(w.text()).toContain("claims[0].id");
    expect(invoke).not.toHaveBeenCalled();
    w.unmount();
  });
});

it("三个报告入口切换可见内容并直接展开综合与独立报告", async () => {
  vi.mocked(listHistory).mockResolvedValue({ items: [task], nextCursor: null });
  const w = mount(StockAnalysisDrawer, {
    attachTo: document.body,
    props: { security },
  });
  await flushPromises();
  const nav = w.get('[aria-label="报告视图"]');
  expect(nav.text()).toContain("操作清单");
  await nav.findAll("button")[1].trigger("click");
  expect(w.get("[data-summary-details]").attributes("open")).toBeDefined();
  expect(w.get(".ai-summary-card").isVisible()).toBe(true);
  expect(w.get(".ai-model-report").isVisible()).toBe(false);
  await nav.findAll("button")[2].trigger("click");
  expect(w.get(".ai-model-report").isVisible()).toBe(true);
  expect(w.get(".ai-model-report > details").attributes("open")).toBeDefined();
  expect(w.get(".ai-summary-card").isVisible()).toBe(false);
  w.unmount();
});

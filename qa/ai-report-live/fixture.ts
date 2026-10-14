import type { TaskDetail } from "../../src/ai/types";
export const security = {
  id: "sh600519",
  market: "sh",
  code: "600519",
  name: "示例股份（虚构）",
  asset: "stock" as const,
};
const model = {
  id: "demo",
  displayName: "QA示例模型",
  provider: "custom",
  baseUrl: "https://fixture.invalid",
  model: "fixture",
  enabled: true,
};
const evidence = (id: string, kind: string, data: unknown) => ({
  id,
  kind,
  securityId: security.id,
  source: "QA虚构资料",
  url: null,
  publishedAt: null,
  eventAt: null,
  collectedAt: "2026-10-14T06:10:00Z",
  timePrecision: "exact",
  content: JSON.stringify(data),
  contentHash: "fixture",
  availability: "userProvided",
});
const cash = {
  asOf: "2026-10-14T06:10:00Z",
  source: "localLedger" as const,
  balance: "433.15",
  initialized: true,
  hasWarnings: false,
};
const p = {
  quantity: "800",
  available: "800",
  averageCost: "33.0390",
  dilutedCost: "33.0390",
  settlement: "T+1",
  roundStart: "2026-10-09T01:00:00Z",
  trades: [
    {
      id: "b1",
      kind: "opening",
      quantity: "800",
      price: "33.04",
      time: "2026-10-09T01:00:00Z",
      fees: { total: "5.10" },
      note: "期初底仓示例",
    },
  ],
};
const claims = [
  "today",
  "week",
  "conservative",
  "shortTerm",
  "mediumLongTerm",
].map((operationType, i) => ({
  id: `c${i}`,
  operationType,
  text: [
    "维持底仓，今天先不追加买入",
    "本周先观察确认，分开管理新增仓位与底仓",
    "以减少无依据交易为先，保留不操作选项",
    "短线先等确认，做T作为条件分支",
    "暂不形成中长期操作结论",
  ][i],
  reason:
    i === 4
      ? "缺少已核验财报及公告正文，近60日日线不能替代基本面。"
      : "800股底仓中保留400股，单轮200股上限；先卖后买且费用已核验。",
  status: i === 4 ? "insufficient" : "wait",
  action: "wait",
  horizon:
    i === 4
      ? "1～3个月，资料不足"
      : i === 1
        ? "2026-10-14剩余时段至2026-10-16"
        : "快照截止后剩余时段",
  trigger: "等待量价与承接确认；资料不足时先补充核验资料。",
  invalidation: "报价过期、判断失效或新增成交改变账户状态时停止沿用本报告。",
  quantityBasis: "800股底仓可卖，保留400股；T+1买回不增加当日可卖。",
  cashBasis: "本机余额433.15元，直接加仓资金不足；做T买回须等待卖出回款确认。",
  feeImpact: "完整双向费用测算前，不认为价差足以获利。",
  conflictsWith: [],
  evidenceIds: ["q", "p", "cash"],
}));
const executionPlan = {
  decision:
    "保留400股底仓：反弹至32.80元转弱时先卖200股，回落至31.51元企稳后买回200股；未触发则等待。",
  preferredScenario: "tRoundTrip",
  context: {
    targetSession: "今日剩余时段",
    reserveQuantity: "400",
    maxTQuantity: "200",
    cash: { balance: "433.15" },
    policy: { reservePercent: 50, tPercent: 25 },
    rules: { note: "整百股预案" },
    priceLevels: [
      { id: "L1", name: "昨收", price: "32.80" },
      { id: "L2", name: "近期低点", price: "31.51" },
    ],
  },
  scenarios: {
    riskReduction: {
      status: "wait",
      reason: "现款不够直接加仓，先观察行情确认。",
      invalidation: "报价过期或新增交易后重新评估。",
      watchPrices: ["31.51"],
      steps: [],
    },
    entry: {
      status: "wait",
      reason: "现款不够直接加仓，先观察行情确认。",
      invalidation: "报价过期或新增交易后重新评估。",
      watchPrices: ["31.51"],
      steps: [],
      entryFunding: {
        quantity: "100",
        requiredMin: "3156.03",
        requiredMax: "3156.03",
        gapMin: "2722.88",
        gapMax: "2722.88",
      },
    },
    tRoundTrip: {
      status: "conditional",
      reason: "以冻结价位测算有覆盖双向费用的价差，买回必须等待卖出成交。",
      invalidation: "报价过期或新增交易后重新评估。",
      watchPrices: ["31.51"],
      steps: [
        {
          side: "sell",
          priceLow: "32.80",
          priceHigh: "32.80",
          quantity: "200",
          trigger: "反弹至昨收，分时转弱后评估。",
          dependency: "none",
          remainingQuantity: "600",
          cashAfterMin: "6984.80",
          cashAfterMax: "6984.80",
          dilutedCostMin: "33.1326",
          dilutedCostMax: "33.1326",
        },
        {
          side: "buy",
          priceLow: "31.51",
          priceHigh: "31.51",
          quantity: "200",
          trigger: "回落企稳，卖出回款已确认可用。",
          dependency: "sellFilled",
        },
      ],
      effects: {
        netProfitMin: "244.59",
        netProfitMax: "244.59",
        totalFeeMin: "13.41",
        totalFeeMax: "13.41",
        remainingQuantity: "800",
        remainingAvailable: "600",
        dilutedCostMin: "32.7333",
        dilutedCostMax: "32.7333",
        cashAfterMin: "677.74",
        cashAfterMax: "677.74",
      },
    },
  },
};
let task: TaskDetail = {
  id: "qa-report",
  parentId: null,
  createdAt: "2026-10-14T06:10:00Z",
  deletedAt: null,
  status: "completed",
  requestSnapshot: {
    requestId: "qa",
    securities: [security],
    group: null,
    participantIds: [model.id],
    summaryModelId: model.id,
  },
  securitySnapshots: [
    {
      id: "s",
      security,
      cutoffAt: cash.asOf,
      frozenAt: cash.asOf,
      referencePrice: "31.40",
      windows: {
        todayMode: "remainingToClose",
        weekMode: "remaining",
        weekRemainingDates: ["2026-10-14", "2026-10-15", "2026-10-16"],
      },
      series: {},
      indicators: {},
      evidence: [
        evidence("q", "quote", { latest: "8.56" }),
        evidence("p", "position", p),
        evidence("cash", "cash", cash),
      ],
      sourceStates: { quoteIsCurrent: true, news: "sourceLinksOnly" },
      ruleVersions: { format: 2 },
    },
  ],
  progress: {},
  callAttempts: [{ phase: "sending" }, { phase: "sending" }],
  reports: [
    {
      id: "r",
      snapshotId: "s",
      modelSnapshot: model,
      windows: [],
      claims,
      rawOutput: JSON.stringify({
        overview: "QA虚构分析，用于验证正式组件，不是模型输出。",
      }),
      validation: { valid: true, reportVersion: 2 },
      usage: null,
    },
  ],
  summaryVersions: [
    {
      id: "v",
      snapshotId: "s",
      version: 1,
      inputReportIds: ["r"],
      summaryModelSnapshot: model,
      windows: {
        executionPlan,
        overview:
          "先管理底仓，暂不主动加仓。当前盘中机会尚需量价确认；中长期资料不足，保留等待。",
      },
      keyClaims: claims.map((c) => ({
        ...c,
        supports: [{ reportId: "r", claimId: c.id }],
      })),
      disagreements: [],
      validation: { valid: true, reportVersion: 2 },
    },
  ],
  errors: [],
  groupSummaryVersions: [],
};
export const isTauri = () => true;
export async function invoke(command: string, args: any = {}): Promise<any> {
  switch (command) {
    case "ai_list_models":
      return [model];
    case "ai_get_defaults":
      return { participantIds: [model.id], summaryModelId: model.id };
    case "ai_get_task":
      return structuredClone(task);
    case "ai_list_history":
      return {
        items:
          !!task.deletedAt === !!args.query?.trashed
            ? [structuredClone(task)]
            : [],
        nextCursor: null,
      };
    case "ai_delete_task":
      task.deletedAt = new Date().toISOString();
      return;
    case "ai_restore_task":
      task.deletedAt = null;
      return;
    case "ai_purge_task":
      task = { ...task, id: "purged" };
      return;
    default:
      throw { message: "QA模式不调用模型或真实账户" };
  }
}

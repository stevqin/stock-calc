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
  signalConditions: {
    stabilization:
      "L2上方连续两根5分钟K线不再创新低，后根收盘高于前根，卖出回款确认后再评估买回。",
    weakening:
      "反弹触及L1后连续两根5分钟K线未创新高，后根收盘回落；条件未出现则先持有。",
  },
  decision:
    "保留400股底仓：反弹至32.80元转弱时先卖200股，回落至31.51元企稳后买回200股；未触发则等待。",
  preferredScenario: "tRoundTrip",
  context: {
    targetSession: "今日剩余时段",
    position: { quantity: "800" },
    signalConditionsRequired: true,
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
          lowId: "L1",
          highId: "L1",
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
          lowId: "L2",
          highId: "L2",
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
if (new URLSearchParams(window.location.search).has("markdown")) {
  const text =
    "# 示例股份 · 操作结论\n\n**现在：继续持有400股底仓，等待条件满足。**\n\n## 一眼看操作\n\n| 动作 | 价格 | 股数 | 执行条件 | 取消条件 |\n|---|---|---|---|---|\n| 先卖 | **32.80元**（L1：压力参考价） | **200股** | 反弹触及32.80元后，连续两根5分钟K线未创新高且回落 | 突破32.80元并放量\n| 买回 | **31.51元**（L2：支撑参考价） | **200股** | 先卖出200股成交、回款确认；回落至31.51元附近，连续两根5分钟K线不创新低且收盘抬高 | 跌破31.51元或资金不足\n\n## 简要依据\n\n- 800股中保留400股底仓，本轮优先评估先卖后买。\n- 可用于买入的现金（账户记录值）433.15元，直接加仓资金不足。\n- 仅为虚构界面样例，不是实际建议。\n\n## 资料不足\n\n未核验实时条件，不声称已经触发。";
  task.reports[0] = {
    ...task.reports[0],
    rawOutput: text,
    claims: [],
    executionPlan: null,
    validation: { format: "markdown", valid: true, complete: false },
  };
  task.summaryVersions[0] = {
    ...task.summaryVersions[0],
    windows: { markdown: text, rawOutput: text },
    keyClaims: [],
    validation: { format: "markdown", valid: true, complete: true },
  };
}
// URL-gated, offline lifecycle demo for progress animation QA. Never sends a model request.
const progressDemo = new URLSearchParams(window.location.search).has(
  "progressDemo",
);
const failDemo =
  new URLSearchParams(window.location.search).get("outcome") === "failed";
if (new URLSearchParams(window.location.search).has("longReport")) {
  const extra = Array.from(
    { length: 30 },
    (_, i) =>
      `\n\n## 离线阅读样例 ${i + 1}\n这段虚构说明用于检查长报告滚动。保留底仓，等待价格和成交条件同时满足。具体价格与数量以上方操作表为准。`,
  ).join("");
  task.reports.forEach((r) => {
    r.rawOutput += extra;
  });
  task.summaryVersions.forEach((v) => {
    v.windows = {
      ...(v.windows as any),
      markdown: (v.windows as any).markdown + extra,
      rawOutput: (v.windows as any).rawOutput + extra,
    };
  });
}
const completedDemo = structuredClone(task);
let demoStarted = 0;
function advanceDemo() {
  if (!demoStarted) return;
  const age = Date.now() - demoStarted;
  const state =
    age < 1500
      ? "collecting"
      : age < 3500
        ? "analyzing"
        : age < 5500
          ? "summarizing"
          : failDemo
            ? "failed"
            : "completed";
  const stages = [
    {
      stage: "quote",
      label: "获取行情与账户资料",
      detail: "已整理行情、持仓与本机账本余额。",
    },
    {
      stage: "model:demo",
      label: "QA示例模型 · 独立分析",
      detail: "正在生成 Markdown 独立报告，不进行格式修复。",
    },
    {
      stage: "summary:demo",
      label: "QA示例模型 · 综合结论",
      detail: "正在对比原始观点，整理关键操作。",
    },
  ];
  const step =
    state === "collecting"
      ? 0
      : state === "analyzing"
        ? 1
        : state === "summarizing"
          ? 2
          : 3;
  task.status = state;
  task.progress = {
    events: stages.slice(0, Math.min(step + 1, 3)).map((e, index) => ({
      ...e,
      state: index < step ? "done" : "running",
      at: new Date(demoStarted + index * 1500).toISOString(),
    })),
  };
  task.callAttempts =
    step > 0
      ? [
          {
            callId: "demo-call",
            attempt: 1,
            phase: "sending",
            role: "independent",
            modelId: model.id,
            at: new Date(demoStarted + 1500).toISOString(),
          },
        ]
      : [];
  task.reports = step >= 2 ? structuredClone(completedDemo.reports) : [];
  task.summaryVersions =
    state === "completed" ? structuredClone(completedDemo.summaryVersions) : [];
  task.errors =
    state === "failed"
      ? [
          {
            code: "fixtureFailure",
            message: "示例：综合结论生成失败，独立报告已保留；没有自动重试。",
            retryable: false,
          },
        ]
      : [];
  if (step === 3) {
    task.progress = {
      events: stages.map((e) => ({
        ...e,
        state: failDemo && e.stage.startsWith("summary") ? "failed" : "done",
        at: new Date().toISOString(),
      })),
    };
    demoStarted = 0;
  }
}
export const isTauri = () => true;
export async function invoke(command: string, args: any = {}): Promise<any> {
  if (libraryEnabled) {
    libraryCalls.push({ command, args });
    if (command === "ai_list_history") {
      const list = libraryRecords.filter(
        (t) =>
          !!t.deletedAt === !!args.query?.trashed &&
          (!args.query?.securityId ||
            t.requestSnapshot.securities.some(
              (s) => s.id === args.query.securityId,
            )),
      );
      const offset = args.query?.cursor
        ? Math.max(0, list.findIndex((t) => t.id === args.query.cursor) + 1)
        : 0;
      return structuredClone({
        items: list.slice(offset, offset + 3),
        nextCursor: offset + 3 < list.length ? list[offset + 2].id : null,
      });
    }
    if (command === "ai_get_task")
      return structuredClone(
        libraryRecords.find((t) => t.id === args.taskId) ?? task,
      );
    if (
      ["ai_delete_task", "ai_restore_task", "ai_purge_task"].includes(command)
    ) {
      const record = libraryRecords.find((t) => t.id === args.taskId);
      if (!record) throw { message: "示例记录不存在" };
      if (command === "ai_purge_task")
        libraryRecords.splice(libraryRecords.indexOf(record), 1);
      else
        record.deletedAt =
          command === "ai_restore_task" ? null : new Date().toISOString();
      return;
    }
  }
  switch (command) {
    case "ai_start_stock_analysis":
    case "ai_resummarize_stock":
      if (!progressDemo) throw { message: "QA模式不调用真实模型" };
      await new Promise((resolve) => setTimeout(resolve, 300));
      task = structuredClone(completedDemo);
      task.id = "offline-progress";
      task.createdAt = new Date().toISOString();
      task.status = "collecting";
      task.reports = [];
      task.summaryVersions = [];
      task.progress = {};
      demoStarted = Date.now();
      return structuredClone(task);
    case "ai_list_models":
      return richPreview ? previewModels : [model];
    case "ai_get_defaults":
      return {
        participantIds: richPreview
          ? previewModels.map((m) => m.id)
          : [model.id],
        summaryModelId: model.id,
      };
    case "ai_get_task":
      if (progressDemo) advanceDemo();
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

// Rich fictional inputs for inspecting the real settings content, without local account access.
export const previewCash = { ...cash, balance: "9876.54" };
export const previewPosition: import("../../src/ai/positionContext").PositionContext =
  {
    securityId: security.id,
    asOf: cash.asOf,
    quantity: "1200",
    available: "1000",
    cost: "39646.80",
    averageCost: "33.0390",
    netInvestment: "38256.00",
    dilutedCost: "31.8800",
    settlement: "T+1",
    roundStart: p.roundStart,
    feeConfirmed: true,
    feeProfile: {
      commissionWan: "2.5",
      minimum: "5",
      stampPercent: "0.05",
      transferPercent: "0.001",
    },
    trades: Array.from({ length: 8 }, (_, i) => ({
      id: `preview-${i}`,
      securityId: security.id,
      kind: i % 2 === 0 ? "buy" : "sell",
      quantity: "200",
      price: i % 2 === 0 ? "31.51" : "32.80",
      time: `2026-10-${String(10 + i).padStart(2, "0")}T02:00:00Z`,
      date: `2026-10-${String(10 + i).padStart(2, "0")}`,
      note:
        i % 2 === 0
          ? "条件满足后买回，保留底仓"
          : "反弹转弱时减少交易仓位，示例备注用于检查长文字换行",
      fees: {
        amount: "6302.00",
        commission: "5.00",
        transfer: "0.06",
        stamp: "0",
        total: "5.06",
        cash: "6307.06",
      },
      feeSource: "actual",
    })),
  };
const richPreview = new URLSearchParams(window.location.search).has("full");
const previewModels = [
  model,
  ...[
    "MIMO-flash",
    "MIMO-pro",
    "DeepSeek-flash",
    "长名称模型 · 独立分析与行情复核",
  ].map((name, i) => ({
    ...model,
    id: `fixture-${i}`,
    displayName: name,
    model: `fixture-model-version-${i}-long-provider-name-for-layout`,
  })),
];
if (richPreview) {
  const snapshot = task.securitySnapshots[0];
  snapshot.evidence.push(
    evidence("daily-rich", "daily", {
      count: 60,
      latest: {
        date: "2026-10-14",
        open: "32.10",
        high: "32.80",
        low: "31.51",
        close: "32.40",
        volume: "123456",
      },
    }),
    evidence("intraday-rich", "intraday", {
      points: 240,
      latest: { time: "14:10", price: "32.40", volume: "12500" },
    }),
    {
      ...evidence("announcement-rich", "announcements", [
        {
          title: "示例公司经营数据公告",
          date: "2026-10-14",
          url: "https://example.invalid/announcement",
        },
      ]),
      availability: "titleOnly",
    },
    {
      ...evidence("manual-rich", "manual", {}),
      content:
        "2026-10-14 手动补充：保留底仓，重点观察支撑位附近的承接情况。此为离线界面样例。",
    },
  );
  const position = snapshot.evidence.find((e) => e.kind === "position");
  if (position)
    position.content = JSON.stringify({
      ...p,
      trades: [...p.trades, ...previewPosition.trades.slice(0, 4)],
    });
}

if (new URLSearchParams(window.location.search).has("contextDemo")) {
  const snapshot = task.securitySnapshots[0];
  const position = snapshot.evidence.find((e) => e.kind === "position");
  if (position) {
    const raw = JSON.parse(position.content);
    position.content = JSON.stringify({
      ...raw,
      cost: "26431.20",
      netInvestment: "25200.00",
      dilutedCost: "31.5000",
    });
  }
  snapshot.evidence.push({
    ...evidence("account-readable", "accountSummary", {
      facts: [
        "截至2026-10-14 14:10:00（北京时间），当前持有800股；按记录可卖800股。",
        "可用于买入的现金（账户记录值）为433.15元；全账户共享，未与券商核对，须预留费用。",
        "剩余持仓浮动盈亏-511.20元，不是本轮合计盈亏。",
        "本轮合计盈亏720.00元；剩余持仓浮亏，但本轮整体盈利；未扣未来卖出费用。",
        "本轮账面回本价31.5000元/股，不是技术支撑位。",
      ],
      reviewBoundary:
        "复盘须指出具体成交和依据；未提供当时计划或行情时，不能断言交易必然失误。",
    }),
    availability: "derived",
  });
  snapshot.evidence.push({
    ...evidence("news-readable", "news", {
      title: "示例股份经营动态（虚构新闻）",
      summary:
        "搜索摘要（非全文）：此处为离线新闻样例，用于核对发布时间、来源和资料范围；不得作为真实交易依据。",
      publishedAt: "2026-10-14T04:00:00Z",
      source: "QA虚构媒体",
      url: "https://finance.eastmoney.com/a/123.html",
      relevance: "证券名称出现在摘要中，仍需结合原文判断直接或间接影响。",
    }),
    source: "QA虚构媒体（搜索摘要，非全文）",
    availability: "excerpt",
    url: "https://finance.eastmoney.com/a/123.html",
    publishedAt: "2026-10-14T04:00:00Z",
  });
  snapshot.sourceStates = {
    ...(snapshot.sourceStates as any),
    news: "excerpt",
    newsCount: 1,
  };
}
if (new URLSearchParams(window.location.search).has("fullNewsDemo")) {
  const snapshot = task.securitySnapshots[0];
  const item = snapshot.evidence.find((e) => e.id === "news-readable");
  if (item) {
    const row = JSON.parse(item.content);
    item.content = JSON.stringify({
      ...row,
      fullText:
        "示例股份披露经营动态。此处为虚构网页正文，仅用于离线界面检查。\n\n收入增长仍受到行业需求与成本影响，后续结果存在不确定性。正文中的限定条件应与数据一起送入分析，不能只根据标题判断。\n\n以上为测试原文，不是实际新闻，也不是交易依据。",
      contentStatus: "fullText",
    });
    item.availability = "fullText";
    item.source = "QA虚构媒体（网页正文）";
  }
  snapshot.evidence.push({
    ...evidence("news-unavailable", "news", {
      title: "未取得正文的虚构线索",
      source: "QA虚构媒体",
      publishedAt: "2026-10-14T03:00:00Z",
      url: "https://finance.eastmoney.com/a/456.html",
      fullText: null,
      summary: "本摘要不得作为新闻全文送入AI",
      contentStatus: "访问受限，未取得全文",
    }),
    availability: "titleOnly",
  });
  snapshot.sourceStates = {
    ...(snapshot.sourceStates as any),
    news: "fullText",
    newsCount: 2,
    newsFullTextCount: 1,
  };
}
const libraryEnabled = new URLSearchParams(window.location.search).has(
  "library",
);
const libraryCalls: { command: string; args: any }[] = [];
(window as any).__libraryCalls = libraryCalls;
const libraryRecords: TaskDetail[] = libraryEnabled
  ? Array.from({ length: 9 }, (_, i) => {
      const copy = structuredClone(task);
      copy.id = i === 0 ? task.id : `library-${i}`;
      copy.createdAt = `2026-10-${String(19 - Math.floor(i / 2)).padStart(2, "0")}T0${i % 8}:12:30Z`;
      copy.deletedAt =
        i >= 5
          ? `2026-10-${String(19 - Math.floor((i - 5) / 2)).padStart(2, "0")}T06:30:00Z`
          : null;
      if (i === 2) {
        copy.status = "failed";
        copy.reports = [];
        copy.summaryVersions = [];
      }
      if (i === 3 || i === 6) {
        copy.requestSnapshot.group = {
          id: "group-demo",
          name: "观察组合 · 长名称示例",
        } as any;
        copy.requestSnapshot.securities.push({
          ...security,
          id: "sz000001",
          code: "000001",
          name: "另一示例股份",
        });
      }
      if (i === 7)
        copy.requestSnapshot.securities = [
          {
            ...security,
            id: "sz000002",
            code: "000002",
            name: "另一只股票（虚构）",
          },
        ];
      return copy;
    })
  : [];

// Offline long-running trace for pinned overview and stage-follow QA.
if (new URLSearchParams(window.location.search).has("followDemo")) {
  task.status = "analyzing";
  task.progress = {
    events: Array.from({ length: 18 }, (_, i) => ({
      stage: `offline-stage-${i}`,
      label: `离线阶段 ${i + 1}`,
      state: i === 17 ? "running" : "done",
      detail: "虚构执行记录，用于检查当前阶段的滚动跟随。".repeat(3),
      at: new Date(Date.now() - (18 - i) * 1000).toISOString(),
    })),
  };
  (window as any).__advanceFollowDemo = () => {
    const events = (task.progress as any).events;
    events.at(-1).state = "done";
    events.push({
      stage: `offline-stage-${events.length}`,
      label: `离线阶段 ${events.length + 1}`,
      state: "running",
      detail: "新的虚构阶段，仅用于离线检查。".repeat(5),
      at: new Date().toISOString(),
    });
  };
}

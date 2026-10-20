<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { modelClient, listHistory, loadTask, aiErrorMessage } from "./client";
import type {
  ModelConfig,
  SecurityRef,
  TaskDetail,
  IndependentReport,
  SummaryVersion,
} from "./types";
import ReportTooltip from "./ReportTooltip.vue";
import ReportToolWindow from "./ReportToolWindow.vue";
import ReportAccountSummary from "./ReportAccountSummary.vue";
import ReportActionIcon from "./ReportActionIcon.vue";
import MarkdownReport from "./MarkdownReport.vue";
import ReportOperations from "./ReportOperations.vue";
import ReportExecutionPlan from "./ReportExecutionPlan.vue";
const executionPolicy = ref({
  preference: "tFirst",
  reservePercent: 50,
  tPercent: 25,
});
import ReportRecycleBin from "./ReportRecycleBin.vue";
import ReportHistoryList from "./ReportHistoryList.vue";
import { reportTitle, reportRunning } from "./reportLibrary";
import ReportConfirm from "./ReportConfirm.vue";
import type { CashContext } from "./accountContext";
import type { PositionContext } from "./positionContext";
const props = defineProps<{
  security: SecurityRef;
  positionContext?: PositionContext | null;
  cashContext?: CashContext | null;
}>();
async function processViewKeys(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  processView.value =
    event.key === "Home"
      ? "execution"
      : event.key === "End"
        ? "materials"
        : processView.value === "execution"
          ? "materials"
          : "execution";
  await nextTick();
  root.value
    ?.querySelector<HTMLButtonElement>(
      `[data-process-view="${processView.value}"]`,
    )
    ?.focus();
}
const includePosition = ref(true);
const processView = ref<"execution" | "materials">("execution");
const progressStarting = ref(false);
const progressTaskId = ref<string | null>(null);
const launchError = ref("");
const toolPanel = ref<"setup" | "history" | "details" | "recycle" | null>(null);
function openTool(panel: "setup" | "history" | "details" | "recycle") {
  if (panel === "details" && toolPanel.value !== "details")
    processView.value = "execution";
  toolPanel.value = panel;
  if (panel === "setup") setupCollapsed.value = false;
  recycleOpen.value = panel === "recycle";
}
function closeTool() {
  toolPanel.value = null;
  recycleOpen.value = false;
}

const recycleOpen = ref(false),
  deletePending = ref(false),
  historyCursor = ref<string | null>(null);
const deleteTarget = ref<TaskDetail | null>(null);
const libraryMessage = ref("");
const independentChoice = ref("");
const reportView = ref("operations");
let reportAnimations: Animation[] = [];
async function selectReportView(view: string) {
  if (reportView.value === view) return;
  reportView.value = view;
  await nextTick();
  const body = root.value?.querySelector<HTMLElement>(".ai-drawer-scroll");
  if (body) body.scrollTop = 0;
  reportAnimations.forEach((animation) => animation.cancel());
  reportAnimations = [];
  if (!body || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
    return;
  for (const section of body.querySelectorAll<HTMLElement>(
    ":scope > section",
  )) {
    if (
      section.getClientRects().length &&
      typeof section.animate === "function"
    ) {
      reportAnimations.push(
        section.animate([{ opacity: 0.65 }, { opacity: 1 }], {
          duration: 180,
          easing: "ease-out",
        }),
      );
    }
  }
}
function evidenceContent(kind: string) {
  try {
    return JSON.parse(
      snapshot.value?.evidence.find((e) => e.kind === kind)?.content ?? "null",
    );
  } catch {
    return null;
  }
}
const frozenPosition = computed(() => evidenceContent("position"));
const frozenCash = computed(() => evidenceContent("cash"));
const frozenAccountSummary = computed(() => evidenceContent("accountSummary"));
function newsContent(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
const isV2 = computed(
  () => (snapshot.value?.ruleVersions as any)?.format === 2,
);
const executionPlan = computed(
  () =>
    (currentSummary.value?.windows as any)?.executionPlan ??
    independentView.value?.executionPlan,
);
const independentView = computed(
  () =>
    validReports.value.find((r) => r.id === independentChoice.value) ??
    validReports.value[0],
);
function isMarkdown(report: { validation: unknown } | undefined) {
  return (report?.validation as any)?.format === "markdown";
}
const markdownMode = computed(
  () =>
    isMarkdown(currentSummary.value) || detail.value?.reports.some(isMarkdown),
);
const markdownReportCount = computed(
  () => detail.value?.reports.filter((r) => r.rawOutput.trim()).length ?? 0,
);
const hasRawReports = computed(() =>
  detail.value?.reports.some((r) => r.rawOutput.trim().length > 0),
);

function money(v: unknown) {
  return typeof v === "string" && Number.isFinite(Number(v))
    ? Number(v).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    : "未知";
}
function requestDelete(task: TaskDetail) {
  if (active.value || loading.value || task.parentId || reportRunning(task))
    return;
  deleteTarget.value = task;
  deletePending.value = true;
}
async function moreHistory() {
  if (active.value || loading.value) return;
  loading.value = true;
  try {
    await refreshHistory(true);
  } catch (e) {
    error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function moveToTrash() {
  const target = deleteTarget.value;
  if (
    !target ||
    active.value ||
    loading.value ||
    target.parentId ||
    reportRunning(target)
  )
    return;
  loading.value = true;
  error.value = "";
  try {
    await invoke("ai_delete_task", { taskId: target.id });
    if (disposed) return;
    const removedCurrent =
      detail.value?.id === target.id || detail.value?.parentId === target.id;
    if (removedCurrent) {
      stop();
      detail.value = null;
    }
    deletePending.value = false;
    deleteTarget.value = null;
    await refreshHistory();
    libraryMessage.value = `已将「${reportTitle(target)}」移入回收站，可恢复。`;
    if (removedCurrent && history.value[0]) watchTask(history.value[0]);
    openTool(history.value.length ? "history" : "recycle");
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function recycleChanged() {
  await refreshHistory();
  if (!detail.value && history.value[0]) watchTask(history.value[0]);
}

const strategyLabels: Record<string, string> = {
  conservative: "稳健持仓",
  intraday: "做 T",
  swing: "中短线",
};
const emit = defineEmits<{ close: []; settings: [] }>();
const desktop = isTauri();
const models = ref<ModelConfig[]>([]),
  selected = ref<string[]>([]),
  summary = ref("");
const manual = ref(""),
  error = ref(""),
  loading = ref(false),
  history = ref<TaskDetail[]>([]),
  detail = ref<TaskDetail | null>(null);
const root = ref<HTMLElement>();
let disposed = false,
  generation = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
const previousFocus = document.activeElement as HTMLElement | null;
const setupCollapsed = ref(false),
  clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | undefined;
const traceRows = computed(() => {
  const events = arr((detail.value?.progress as any)?.events);
  const rows = new Map<string, any>();
  for (const event of events) {
    if (typeof event.stage !== "string" || typeof event.at !== "string")
      continue;
    const previous = rows.get(event.stage);
    rows.set(event.stage, { ...event, startAt: previous?.startAt ?? event.at });
  }
  return [...rows.values()];
});
const callRows = computed(() => {
  const rows = new Map<string, any>();
  for (const value of detail.value?.callAttempts ?? []) {
    const event = value as any;
    if (!event.callId || !event.at) continue;
    const key = event.callId + ":" + event.attempt;
    rows.set(key, { ...event });
  }
  return [...rows.values()];
});
function elapsed(row: any) {
  if (row.state === "running" && !active.value) return "未记录结束时间";
  const end = row.state === "running" ? clock.value : Date.parse(row.at);
  const start = Date.parse(row.startAt);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return "";
  return `${Math.max(0, Math.floor((end - start) / 1000))} 秒`;
}
function eventState(row: any) {
  return row.state === "running"
    ? active.value
      ? "进行中"
      : "未完成"
    : ((
        {
          done: "已完成",
          warning: "需注意",
          failed: "失败",
          cancelled: "已取消",
        } as Record<string, string>
      )[row.state] ?? row.state);
}
function modelName(id: string) {
  return (
    models.value.find((m) => m.id === id)?.displayName ??
    detail.value?.reports.find((r) => r.modelSnapshot.id === id)?.modelSnapshot
      .displayName ??
    "模型"
  );
}
const roleLabels: Record<string, string> = {
  independent: "独立分析",
  repair: "格式修复",
  summary: "对比汇总",
};
const active = computed(
  () =>
    !!detail.value &&
    ["pending", "collecting", "analyzing", "summarizing"].includes(
      detail.value.status,
    ),
);
const processStep = computed(
  () =>
    (
      ({
        pending: 0,
        collecting: 0,
        analyzing: 1,
        summarizing: 2,
        completed: 3,
        partial: 3,
      }) as Record<string, number>
    )[detail.value?.status ?? ""] ?? -1,
);
const processTitle = computed(() => {
  const labels: Record<string, string> = {
    pending: "等待开始",
    collecting: "正在采集资料",
    analyzing: "正在独立分析",
    summarizing: "正在生成综合结论",
  };
  return detail.value
    ? (labels[detail.value.status] ?? displayStatus(detail.value))
    : "正在启动分析";
});
const currentStage = computed(() =>
  traceRows.value.filter((r) => r.state === "running").at(-1),
);
const followStage = ref(true);
function processScrolled(event: Event) {
  const element = event.target as HTMLElement;
  if (
    !followStage.value &&
    element.scrollHeight - element.scrollTop - element.clientHeight < 24
  )
    followStage.value = true;
}
async function scrollToStage() {
  await nextTick();
  if (
    !followStage.value ||
    toolPanel.value !== "details" ||
    processView.value !== "execution" ||
    !active.value
  )
    return;
  const content = root.value?.querySelector<HTMLElement>(
    ".ai-tool-window--process .ai-tool-content",
  );
  const row =
    content?.querySelector<HTMLElement>('[aria-current="step"]') ??
    content?.querySelector<HTMLElement>(".ai-trace-list li:last-child");
  const trace = content?.querySelector<HTMLDetailsElement>(
    ".ai-execution-trace > details",
  );
  if (!content || !row || !trace?.open) return;
  const bounds = content.getBoundingClientRect(),
    item = row.getBoundingClientRect();
  const delta =
    item.height > content.clientHeight || item.top < bounds.top
      ? item.top - bounds.top - 12
      : item.bottom > bounds.bottom
        ? item.bottom - bounds.bottom + 12
        : 0;
  if (delta && typeof content.scrollTo === "function")
    content.scrollTo({
      top: content.scrollTop + delta,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
}
function resumeStageFollow() {
  followStage.value = true;
  void scrollToStage();
}
watch(
  () => [
    toolPanel.value,
    processView.value,
    detail.value?.id,
    JSON.stringify(traceRows.value),
  ],
  (value, previous) => {
    if (
      value[0] !== previous?.[0] ||
      value[1] !== previous?.[1] ||
      value[2] !== previous?.[2]
    )
      followStage.value = true;
    if (value[1] === "materials" && value[1] !== previous?.[1]) {
      const content = root.value?.querySelector<HTMLElement>(
        ".ai-tool-window--process .ai-tool-content",
      );
      if (content) content.scrollTop = 0;
    }
    void scrollToStage();
  },
  { flush: "post" },
);
watch(
  () => [detail.value?.id, detail.value?.status] as const,
  ([taskId, taskStatus]) => {
    if (
      !taskId ||
      taskId !== progressTaskId.value ||
      !taskStatus ||
      ["pending", "collecting", "analyzing", "summarizing"].includes(taskStatus)
    )
      return;
    progressTaskId.value = null;
    if (
      (taskStatus === "completed" ||
        taskStatus === "partial" ||
        taskStatus === "cancelled") &&
      toolPanel.value === "details"
    )
      closeTool();
    if (taskStatus === "completed" || taskStatus === "partial")
      reportView.value = currentSummary.value ? "summary" : "independent";
  },
);
const enabled = computed(() => models.value.filter((m) => m.enabled));
const estimate = computed(() => selected.value.length + 1);
const setupCallLabel = computed(() =>
  !selected.value.length
    ? "请选择独立分析模型"
    : selected.value.length > 20
      ? "独立模型最多选择 20 个"
      : !summary.value
        ? "请选择汇总模型"
        : `预计调用 ${estimate.value} 次`,
);
const snapshot = computed(() => detail.value?.securitySnapshots[0]);
const sourceEvidence = computed(
  () =>
    snapshot.value?.evidence.filter(
      (e) =>
        !["position", "cash", "execution", "accountSummary"].includes(e.kind),
    ) ?? [],
);
const accountEvidence = computed(
  () =>
    snapshot.value?.evidence.filter((e) =>
      ["position", "cash", "execution", "accountSummary"].includes(e.kind),
    ) ?? [],
);
const quantityUnit = computed(() =>
  props.security.asset === "etf" ? "份" : "股",
);
function evidenceLabel(kind: string) {
  return (
    (
      {
        quote: "行情报价",
        daily: "日线行情",
        intraday: "分时行情",
        fundFlow: "主力资金流",
        news: "新闻资料",
        announcements: "公告资料",
        manual: "手动补充资料",
        position: "本股持仓原始记录",
        cash: "买入现金原始记录",
        execution: "价位与数量测算输入",
        accountSummary: "账户与盈亏说明",
      } as Record<string, string>
    )[kind] ?? "其他资料"
  );
}
const heldSnapshot = computed(() =>
  snapshot.value?.evidence.find((e) => e.kind === "position"),
);
const missingSources = computed(() =>
  Object.entries(
    (snapshot.value?.sourceStates ?? {}) as Record<string, unknown>,
  )
    .filter(([, v]) => typeof v === "string" && v.startsWith("unavailable"))
    .map(([k]) => sourceLabels[k] ?? k),
);
const todayLabel = computed(() =>
  (snapshot.value?.windows as any)?.todayMode === "review"
    ? "今日复盘"
    : (snapshot.value?.windows as any)?.todayMode === "nonTradingDay"
      ? "今日休市"
      : "今日至收盘",
);
const summaries = computed(() => detail.value?.summaryVersions ?? []);
const summaryId = ref("");
const currentSummary = computed(
  () =>
    summaries.value.find((s) => s.id === summaryId.value) ??
    summaries.value.at(-1),
);
const validReports = computed(
  () =>
    detail.value?.reports.filter(
      (r) => (r.validation as any)?.valid === true,
    ) ?? [],
);
watch([markdownMode, currentSummary], () => {
  if (markdownMode.value && reportView.value === "operations")
    reportView.value = currentSummary.value ? "summary" : "independent";
});
function displayStatus(task: TaskDetail) {
  return task.status === "partial" &&
    !task.reports.some((r) => (r.validation as any)?.valid === true) &&
    !task.summaryVersions.some(isMarkdown)
    ? status.failed
    : status[task.status];
}
const invalidReportCount = computed(
  () => (detail.value?.reports.length ?? 0) - validReports.value.length,
);
const attemptedCalls = computed(
  () =>
    detail.value?.callAttempts.filter((a: any) => a.phase === "sending")
      .length ?? 0,
);
const direction: Record<string, string> = {
  bullish: "偏上涨",
  bearish: "偏下跌",
  sideways: "偏震荡",
  uncertain: "无法判断",
};
const confidence: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};
const status: Record<string, string> = {
  pending: "等待执行",
  collecting: "采集公开数据",
  analyzing: "模型独立分析",
  summarizing: "对比汇总",
  completed: "已完成",
  partial: "部分完成",
  failed: "分析失败",
  cancelled: "已取消",
  interrupted: "上次运行已中断",
};
const newsUrl = computed(
  () =>
    `https://so.eastmoney.com/web/s?keyword=${encodeURIComponent(props.security.code)}`,
);
const announcementUrl = computed(() =>
  props.security.asset === "etf"
    ? "https://www.sse.com.cn/disclosure/fund/announcement/"
    : "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search",
);
const sourceLabels: Record<string, string> = {
  quote: "报价",
  news: "新闻原文",
  newsCount: "新闻检索条数",
  newsFullTextCount: "已读取正文条数",
  announcements: "公告",
  announcementCount: "公告条数",
  daily: "日线（不复权）",
  intraday: "当日分时",
  fundFlow: "主力资金流",
  quoteTime: "报价时间",
  quoteDateMatchesToday: "报价日期为今日",
  quoteIsCurrent: "报价满足今日分析时效",
};
const availabilityLabels: Record<string, string> = {
  available: "已获取",
  titleOnly: "仅标题与链接",
  excerpt: "旧报告搜索摘要，非全文",
  fullText: "已读取网页正文",
  derived: "按账户记录计算，未核对券商",
  userProvided: "手动补充，未经核验",
  sourceLinksOnly: "仅来源链接",
  unavailable: "未获取",
};
function sourceState(v: unknown) {
  return typeof v === "boolean"
    ? v
      ? "是"
      : "否"
    : (availabilityLabels[String(v)] ??
        String(v).replace(/^unavailable: /, "未获取："));
}
async function openSource(url: string) {
  try {
    await invoke("ai_open_public_source", { url });
  } catch (e) {
    error.value = aiErrorMessage(e);
  }
}
function arr(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}
function overview(report: IndependentReport) {
  try {
    return (
      JSON.parse(
        report.rawOutput.replace(/^```json\s*/, " ").replace(/```\s*$/, " "),
      ).overview ?? ""
    );
  } catch {
    return "";
  }
}
function supportRows(claim: any) {
  return arr(claim.supports)
    .map((support: any) => {
      const report = detail.value?.reports.find(
        (r) => r.id === support.reportId,
      );
      const original = arr(report?.claims).find(
        (c) => c.id === support.claimId,
      );
      return { report, original };
    })
    .filter((row) => row.report && row.original);
}
function agreement(claim: any) {
  const count = new Set(
    supportRows(claim).map((r) => r.report!.modelSnapshot.id),
  ).size;
  return `${count}/${validReports.value.length} 个模型提供依据${count === 1 ? " · 单模型依据" : ""}`;
}
function date(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
async function refreshHistory(more = false) {
  if (!desktop) return;
  const page = await listHistory({
    securityId: props.security.id,
    limit: 30,
    ...(more && historyCursor.value ? { cursor: historyCursor.value } : {}),
  });
  if (!disposed) {
    history.value = more ? [...history.value, ...page.items] : page.items;
    historyCursor.value = page.nextCursor;
    if (detail.value && !history.value.some((t) => t.id === detail.value?.id))
      history.value.push(detail.value);
  }
}
function stop() {
  generation++;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
async function poll(taskId: string, token: number) {
  try {
    const task = await loadTask(taskId);
    if (disposed || token !== generation) return;
    detail.value = task;
    if (
      ["pending", "collecting", "analyzing", "summarizing"].includes(
        task.status,
      )
    )
      timer = setTimeout(() => void poll(taskId, token), 1000);
    else await refreshHistory();
  } catch (e) {
    if (!disposed && token === generation) {
      error.value = aiErrorMessage(e);
      timer = setTimeout(() => void poll(taskId, token), 3000);
    }
  }
}
function watchTask(task: TaskDetail, followProgress = false) {
  reportView.value =
    task.summaryVersions.some(isMarkdown) || task.reports.some(isMarkdown)
      ? task.summaryVersions.length
        ? "summary"
        : "independent"
      : "operations";
  setupCollapsed.value = true;
  progressStarting.value = false;
  launchError.value = "";
  progressTaskId.value = followProgress ? task.id : null;
  if (followProgress) {
    if (toolPanel.value === "details") openTool("details");
  } else closeTool();
  stop();
  detail.value = task;
  summaryId.value = "";
  independentChoice.value = "";
  void poll(task.id, generation);
}
async function start() {
  if (
    loading.value ||
    active.value ||
    !desktop ||
    !selected.value.length ||
    selected.value.length > 20 ||
    !summary.value
  )
    return;
  loading.value = true;
  setupCollapsed.value = true;
  error.value = "";
  launchError.value = "";
  progressTaskId.value = null;
  progressStarting.value = true;
  openTool("details");
  try {
    const security = {
      id: props.security.id,
      market: props.security.market,
      code: props.security.code,
      name: props.security.name,
      asset: props.security.asset,
    };
    const task = await invoke<TaskDetail>("ai_start_stock_analysis", {
      request: {
        requestId: crypto.randomUUID(),
        securities: [security],
        group: null,
        participantIds: [...selected.value],
        summaryModelId: summary.value,
        executionPolicy: { ...executionPolicy.value },
      },
      manualMaterial: manual.value,
      cashContext: includePosition.value ? (props.cashContext ?? null) : null,
      positionContext: includePosition.value
        ? (props.positionContext ?? null)
        : null,
    });
    if (!disposed) watchTask(task, true);
  } catch (e) {
    if (!disposed) {
      error.value = aiErrorMessage(e);
      launchError.value = error.value;
      progressStarting.value = false;
    }
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function resummarize() {
  if (!detail.value || active.value || loading.value || !summary.value) return;
  loading.value = true;
  setupCollapsed.value = true;
  error.value = "";
  launchError.value = "";
  progressTaskId.value = null;
  progressStarting.value = true;
  openTool("details");
  try {
    const task = await invoke<TaskDetail>("ai_resummarize_stock", {
      taskId: detail.value.id,
      summaryModelId: summary.value,
    });
    if (!disposed) watchTask(task, true);
  } catch (e) {
    if (!disposed) {
      error.value = aiErrorMessage(e);
      launchError.value = error.value;
      progressStarting.value = false;
    }
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function cancel() {
  if (!detail.value) return;
  try {
    await invoke("ai_cancel_stock_analysis", { taskId: detail.value.id });
  } catch (e) {
    error.value = aiErrorMessage(e);
  }
}
function keys(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    if (toolPanel.value) closeTool();
    else emit("close");
  }
  if (e.key === "Tab") {
    const elements = [
      ...(root.value?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary",
      ) ?? []),
    ].filter((el) => el.getClientRects().length > 0);
    const first = elements[0],
      last = elements.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}
onMounted(async () => {
  clockTimer = setInterval(() => {
    clock.value = Date.now();
  }, 1000);
  await nextTick();
  root.value?.querySelector<HTMLButtonElement>(".ai-close")?.focus();
  if (!desktop) return;
  loading.value = true;
  try {
    const [m, d] = await Promise.all([
      modelClient.listModels(),
      modelClient.getDefaults(),
    ]);
    if (disposed) return;
    models.value = m;
    selected.value = d.participantIds.filter((id) =>
      m.some((m) => m.id === id && m.enabled),
    );
    summary.value = d.summaryModelId ?? "";
    await refreshHistory();
    if (!disposed && history.value[0]) watchTask(history.value[0]);
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) loading.value = false;
  }
});
onBeforeUnmount(() => {
  reportAnimations.forEach((animation) => animation.cancel());
  disposed = true;
  if (clockTimer) clearInterval(clockTimer);
  stop();
  previousFocus?.focus({ preventScroll: true });
});
</script>
<template>
  <div
    class="security-drawer-overlay ai-drawer-overlay"
    @click.self="emit('close')"
  >
    <aside
      ref="root"
      class="security-drawer ai-stock-drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="security.name + ' AI 分析'"
      @keydown="keys"
    >
      <header class="ai-drawer-heading">
        <div>
          <small>{{ security.market.toUpperCase() }} {{ security.code }}</small>
          <h2>{{ security.name }} · AI 分析</h2>
        </div>
        <button
          class="ai-close"
          aria-label="关闭报告"
          title="关闭报告"
          @click="emit('close')"
        >
          <ReportActionIcon name="close" />
        </button>
      </header>
      <div
        class="ai-report-surface"
        :class="{ 'ai-report-surface--has-report': !!detail }"
      >
        <div
          v-if="detail"
          class="ai-report-switcher"
          :inert="toolPanel ? true : undefined"
        >
          <nav
            class="ai-report-tabs"
            aria-label="报告视图"
            :style="{
              '--report-tab-count': markdownMode ? 2 : 3,
              '--report-tab-index':
                reportView === 'independent'
                  ? markdownMode
                    ? 1
                    : 2
                  : reportView === 'summary'
                    ? markdownMode
                      ? 0
                      : 1
                    : 0,
            }"
          >
            <span class="ai-report-tab-highlight" aria-hidden="true" />
            <button
              v-if="!markdownMode"
              :aria-pressed="reportView === 'operations'"
              @click="selectReportView('operations')"
            >
              操作清单
            </button>
            <button
              :aria-pressed="reportView === 'summary'"
              @click="selectReportView('summary')"
            >
              综合结论
            </button>
            <button
              :aria-pressed="reportView === 'independent'"
              @click="selectReportView('independent')"
            >
              独立分析
            </button>
          </nav>
        </div>
        <div class="ai-drawer-scroll" :inert="toolPanel ? true : undefined">
          <p v-if="!desktop" class="ai-message">
            浏览器预览仅展示入口；请在桌面应用中运行分析。
          </p>
          <p v-if="error" role="alert" class="ai-message ai-error">
            {{ error }}
          </p>
          <ReportConfirm
            v-if="deletePending && deleteTarget"
            title="将报告移入回收站？"
            :message="`${reportTitle(deleteTarget)} · ${date(deleteTarget.createdAt)}。本报告、全部独立输出与汇总版本将移入回收站，可恢复；不影响账户成交和模型配置。${deleteTarget.requestSnapshot.group ? '此操作影响整批 ' + deleteTarget.requestSnapshot.securities.length + ' 只证券。' : ''}`"
            confirm-label="移入回收站"
            :error="error"
            :busy="loading"
            @confirm="moveToTrash"
            @cancel="deletePending = false"
          />

          <button
            v-if="active || loading || detail?.errors.length"
            class="ai-run-indicator"
            :disabled="!detail"
            @click="openTool('details')"
          >
            <i v-if="active || loading" class="ai-tool-dot" />
            {{
              active
                ? "正在分析 · 查看进度"
                : loading
                  ? "正在载入…"
                  : "有执行问题 · 查看详情"
            }}
          </button>
          <p v-if="!detail && !loading" class="ai-empty-report">
            暂无分析报告，点击右下角“分析”选择模型并开始。
          </p>

          <p
            v-if="
              reportView === 'summary' &&
              !currentSummary &&
              (markdownMode || !independentView)
            "
            class="ai-muted"
          >
            尚未生成综合结论，已收到的正文可在“独立分析”中查看。
          </p>
          <p
            v-if="reportView === 'independent' && !detail?.reports.length"
            class="ai-muted"
          >
            尚未收到独立报告，请查看下方执行记录。
          </p>
          <section
            v-if="
              !markdownMode &&
              isV2 &&
              !executionPlan &&
              (currentSummary || independentView)
            "
            v-show="reportView === 'operations'"
            class="ai-current-action"
          >
            <small>当前首选与主要约束</small>
            <p class="ai-prose">
              {{
                currentSummary
                  ? (currentSummary.windows as any).overview
                  : overview(independentView!)
              }}
            </p>
          </section>
          <ReportExecutionPlan
            v-if="executionPlan"
            v-show="reportView === 'operations'"
            :key="currentSummary?.id ?? independentView?.id"
            :plan="executionPlan"
          />
          <section
            v-if="!currentSummary && independentView && isV2 && !markdownMode"
            v-show="reportView === 'summary'"
            class="ai-settings-card"
          >
            <details
              data-independent-details
              :open="reportView === 'summary' || !executionPlan"
            >
              <summary>五类建议与独立分析</summary>
              <h3>独立模型建议</h3>
              <label v-if="validReports.length > 1"
                >查看模型<select v-model="independentChoice">
                  <option v-for="r in validReports" :key="r.id" :value="r.id">
                    {{ r.modelSnapshot.displayName }}
                  </option>
                </select></label
              >
              <p class="ai-data-gap">
                尚无有效汇总；下方只来自
                {{ independentView.modelSnapshot.displayName }}。
              </p>
              <details>
                <summary>展开模型总体判断</summary>
                <p>{{ overview(independentView) }}</p>
              </details>
              <ReportOperations
                :claims="independentView.claims"
                :price-levels="(executionPlan as any)?.context?.priceLevels"
                :signal-conditions="(executionPlan as any)?.signalConditions"
                ><template #evidence="{ claim }"
                  ><details>
                    <summary>引用资料</summary>
                    <pre
                      v-for="e in snapshot?.evidence.filter((e) =>
                        arr(claim.evidenceIds).includes(e.id),
                      )"
                      :key="e.id"
                      >{{ e.source }}
{{ e.content }}</pre>
                  </details></template
                ></ReportOperations
              >
            </details>
          </section>
          <section
            v-if="currentSummary"
            v-show="
              reportView === 'summary' ||
              (!executionPlan && reportView === 'operations')
            "
            class="ai-settings-card ai-summary-card"
          >
            <details
              data-summary-details
              :open="reportView === 'summary' || !executionPlan"
            >
              <summary>
                {{
                  isMarkdown(currentSummary)
                    ? "Markdown 综合报告"
                    : "五类建议与综合分析"
                }}
              </summary>
              <div class="ai-summary-heading">
                <h3>综合结论</h3>
                <select
                  v-if="summaries.length > 1"
                  v-model="summaryId"
                  aria-label="汇总版本"
                >
                  <option v-for="s in summaries" :key="s.id" :value="s.id">
                    汇总 v{{ s.version }}
                  </option>
                </select>
              </div>
              <small
                >{{ currentSummary.summaryModelSnapshot.displayName }} · 汇总
                v{{ currentSummary.version }}</small
              >
              <p v-if="validReports.length === 1" class="ai-data-gap">
                仅有一个有效独立模型，本次汇总不代表多模型共识。
              </p>
              <p v-if="active" class="ai-data-gap">
                正在生成新的汇总，下方仍是已保存版本。
              </p>
              <MarkdownReport
                v-if="isMarkdown(currentSummary)"
                :text="
                  String(
                    (currentSummary.windows as any).markdown ??
                      (currentSummary.windows as any).rawOutput ??
                      '',
                  )
                "
                :incomplete="
                  (currentSummary.validation as any).complete === false
                "
              />
              <template v-else>
                <p v-if="!isV2" class="ai-prose">
                  {{ (currentSummary.windows as any).overview }}
                </p>
                <p
                  v-if="
                    arr(currentSummary.keyClaims).some(
                      (c) => c.unavailableReason,
                    )
                  "
                  class="ai-branch-unavailable"
                >
                  部分汇总结论引用了不可用的操作方案，已明确标记；其他有效结论保留。
                </p>
                <ReportOperations
                  v-if="isV2"
                  :claims="currentSummary.keyClaims"
                  :price-levels="(executionPlan as any)?.context?.priceLevels"
                  :signal-conditions="(executionPlan as any)?.signalConditions"
                  ><template #evidence="{ claim }"
                    ><small>{{ agreement(claim) }}</small>
                    <article
                      v-for="row in supportRows(claim)"
                      :key="row.report!.id"
                      class="ai-model-support"
                    >
                      <strong>{{
                        row.report!.modelSnapshot.displayName
                      }}</strong>
                      <p>{{ row.original.text }}</p>
                      <p>资金依据：{{ row.original.cashBasis }}</p>
                      <p>数量约束：{{ row.original.quantityBasis }}</p>
                      <p>费用：{{ row.original.feeImpact }}</p>
                      <details>
                        <summary>查看引用资料</summary>
                        <div
                          v-for="e in snapshot?.evidence.filter((e) =>
                            arr(row.original.evidenceIds).includes(e.id),
                          )"
                          :key="e.id"
                        >
                          <strong>{{ e.source }}</strong>
                          <pre>{{ e.content }}</pre>
                        </div>
                      </details>
                    </article></template
                  ></ReportOperations
                >
                <div class="ai-key-claims">
                  <article
                    v-for="(claim, i) in arr(currentSummary.keyClaims).filter(
                      (c) => !c.operationType,
                    )"
                    :key="i"
                    :class="[
                      'ai-claim',
                      { 'ai-operation-claim': strategyLabels[claim.strategy] },
                    ]"
                  >
                    <h4>
                      {{
                        strategyLabels[claim.strategy] ?? "关键判断 " + (i + 1)
                      }}
                    </h4>
                    <p class="ai-prose">{{ claim.text }}</p>
                    <details>
                      <summary>
                        展开模型依据 <small>{{ agreement(claim) }}</small
                        ><ReportTooltip
                          label="模型依据数量"
                          text="计数只表示多少个独立模型被引用为该结论提供依据。没有被引用不代表赞同；只有一个有效模型时不构成多模型共识。"
                        />
                      </summary>
                      <article
                        v-for="row in supportRows(claim)"
                        :key="row.report!.id"
                        class="ai-model-support"
                      >
                        <strong>{{
                          row.report!.modelSnapshot.displayName
                        }}</strong
                        ><small> · {{ row.report!.modelSnapshot.model }}</small>
                        <p class="ai-prose">{{ row.original.text }}</p>
                        <template v-if="strategyLabels[row.original.strategy]"
                          ><dl class="ai-condition-list">
                            <dt>触发条件</dt>
                            <dd>{{ row.original.trigger }}</dd>
                            <dt>失效条件</dt>
                            <dd>{{ row.original.invalidation }}</dd>
                            <dt>数量依据</dt>
                            <dd>{{ row.original.quantityBasis }}</dd>
                            <dt>费用影响</dt>
                            <dd>{{ row.original.feeImpact }}</dd>
                          </dl></template
                        >
                        <details>
                          <summary>
                            查看引用资料 ·
                            {{ arr(row.original.evidenceIds).length }} 项
                          </summary>
                          <div
                            v-for="e in snapshot?.evidence.filter((e) =>
                              arr(row.original.evidenceIds).includes(e.id),
                            )"
                            :key="e.id"
                          >
                            <strong>{{ e.source }}</strong
                            ><small>
                              ·
                              {{
                                availabilityLabels[e.availability] ??
                                e.availability
                              }}</small
                            >
                            <pre>{{ e.content }}</pre>
                          </div>
                        </details>
                      </article>
                    </details>
                  </article>
                </div>
                <div
                  v-if="arr(currentSummary.disagreements).length"
                  class="ai-disagreements"
                >
                  <h4>主要分歧</h4>
                  <p
                    v-for="(d, i) in arr(currentSummary.disagreements)"
                    :key="i"
                  >
                    {{ d }}
                  </p>
                </div>
              </template>
            </details>
          </section>
          <section
            v-if="validReports.length && !markdownMode"
            v-show="reportView === 'summary'"
            class="ai-settings-card ai-trend-comparison"
          >
            <details>
              <summary>趋势判断与置信等级对比</summary>
              <h3>
                趋势对比<ReportTooltip
                  label="置信等级"
                  text="置信等级是各模型对自身判断的描述，不是经统计校准的概率，也不等于模型之间的一致程度。"
                />
              </h3>
              <div class="ai-trend-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>独立模型</th>
                      <th>{{ todayLabel }}</th>
                      <th>未来 1～5 交易日</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in validReports" :key="r.id">
                      <th>{{ r.modelSnapshot.displayName }}</th>
                      <td v-for="h in ['today', 'future']" :key="h">
                        <span
                          v-for="w in arr(r.windows).filter(
                            (w) => w.horizon === h,
                          )"
                          :key="w.horizon"
                          :class="'ai-direction-' + w.direction"
                          >{{ direction[w.direction]
                          }}<small
                            >置信：{{ confidence[w.confidence] }}</small
                          ></span
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="ai-muted">判断依据与失效条件可展开下方独立报告查看。</p>
            </details>
          </section>
          <section
            v-for="report in detail?.reports"
            :key="report.id"
            v-show="reportView === 'independent'"
            class="ai-settings-card ai-model-report"
          >
            <details :open="reportView === 'independent'">
              <summary>
                <strong
                  >{{ report.modelSnapshot.displayName }} · 独立报告</strong
                ><small
                  >{{ report.modelSnapshot.model }} ·
                  {{
                    isMarkdown(report)
                      ? "Markdown 正文已保存"
                      : isMarkdown(currentSummary) &&
                          currentSummary?.inputReportIds.includes(report.id)
                        ? "历史原文已用于本次汇总"
                        : (report.validation as any).valid
                          ? (report.executionPlan as any)?.warnings?.length
                            ? "有效结论已保留，部分方案不可用"
                            : "引用校验通过"
                          : "校验失败，未进入汇总"
                  }}</small
                ><ReportTooltip
                  v-if="!isMarkdown(report)"
                  label="引用校验"
                  text="校验检查输出结构、引用标识、时间窗口和持仓建议必填条件；不表示观点正确、预测会兑现或交易能够获利。"
                />
              </summary>
              <MarkdownReport
                v-if="isMarkdown(report)"
                :text="report.rawOutput"
                :incomplete="(report.validation as any).complete === false"
              />
              <template v-else>
                <aside
                  v-if="(report.executionPlan as any)?.warnings?.length"
                  class="ai-branch-warnings"
                >
                  <strong
                    >以下方案不可用；模型原文仅供核对，不能据此执行</strong
                  >
                  <p
                    v-for="(w, i) in (report.executionPlan as any).warnings"
                    :key="i"
                  >
                    {{ w.message }}
                  </p>
                </aside>
                <p
                  v-for="(note, i) in arr(
                    (report.validation as any)?.formatWarnings,
                  )"
                  :key="'format-' + i"
                  class="ai-muted"
                >
                  {{ note }}
                </p>
                <p class="ai-prose">{{ overview(report) }}</p>
                <ReportOperations
                  v-if="(report.validation as any).reportVersion === 2"
                  :claims="report.claims"
                  :price-levels="
                    (report.executionPlan as any)?.context?.priceLevels
                  "
                  :signal-conditions="
                    (report.executionPlan as any)?.signalConditions
                  "
                />
                <article
                  v-for="w in arr(report.windows)"
                  :key="w.horizon"
                  class="ai-report-window"
                >
                  <h4>
                    {{
                      w.horizon === "today" ? todayLabel : "未来 1～5 个交易日"
                    }}
                    · {{ direction[w.direction] }}
                    <small>置信：{{ confidence[w.confidence] }}</small>
                  </h4>
                  <p>{{ w.logic }}</p>
                </article>
                <article
                  v-for="c in arr(report.claims).filter(
                    (c) => strategyLabels[c.strategy],
                  )"
                  :key="c.id"
                  class="ai-report-window"
                >
                  <h4>{{ strategyLabels[c.strategy] }}</h4>
                  <p>{{ c.text }}</p>
                  <dl class="ai-condition-list">
                    <dt>触发条件</dt>
                    <dd>{{ c.trigger }}</dd>
                    <dt>失效条件</dt>
                    <dd>{{ c.invalidation }}</dd>
                    <dt>数量依据</dt>
                    <dd>{{ c.quantityBasis }}</dd>
                    <dt>费用影响</dt>
                    <dd>{{ c.feeImpact }}</dd>
                  </dl>
                </article>
                <template v-if="report.outputs?.length">
                  <details
                    v-for="(output, index) in report.outputs"
                    :key="index"
                    class="ai-raw-output"
                  >
                    <summary>
                      {{
                        output.role === "independent"
                          ? "首次输出"
                          : "格式修复输出"
                      }}
                      ·
                      {{
                        output.validation.valid
                          ? output.validation.warnings?.length
                            ? "有效结论保留，部分方案不可用"
                            : "校验通过"
                          : "未通过校验"
                      }}
                    </summary>
                    <p v-if="output.validation.error">
                      {{ output.validation.error }}
                    </p>
                    <p
                      v-for="(note, i) in output.validation.formatWarnings ??
                      []"
                      :key="i"
                      class="ai-muted"
                    >
                      {{ note }}
                    </p>
                    <pre>{{ output.rawOutput }}</pre>
                  </details>
                </template>
                <details v-else class="ai-raw-output">
                  <summary>模型原始输出 · JSON</summary>
                  <pre>{{ report.rawOutput }}</pre>
                </details>
              </template>
            </details>
          </section>
        </div>
      </div>
      <nav
        v-if="desktop"
        v-show="!toolPanel"
        class="ai-floating-tools"
        aria-label="报告工具"
      >
        <button
          data-tool="setup"
          :aria-label="
            active ? '分析设置' : detail ? '重新分析与设置' : '开始分析'
          "
          class="ai-analysis-launcher"
          :title="
            active
              ? '查看分析设置'
              : detail
                ? '选择模型，更新行情并生成新报告'
                : '选择模型并开始分析'
          "
          :aria-expanded="toolPanel === 'setup'"
          @click="openTool('setup')"
        >
          <ReportActionIcon
            :name="active ? 'analysis' : detail ? 'refresh' : 'start'"
          />
          <span class="ai-analysis-launcher-label"
            ><strong>{{
              active ? "分析设置" : detail ? "重新分析" : "开始分析"
            }}</strong
            ><small>{{
              active
                ? "本次分析进行中"
                : detail
                  ? "更新行情与报告"
                  : "选择模型与资料"
            }}</small></span
          >
        </button>
        <button
          v-if="history.length || historyCursor"
          data-tool="history"
          aria-label="历史报告"
          title="历史报告"
          :aria-expanded="toolPanel === 'history'"
          @click="openTool('history')"
        >
          <ReportActionIcon name="history" /><span>历史</span>
        </button>
        <button
          v-if="detail"
          data-tool="details"
          aria-label="资料与分析过程"
          title="资料与分析过程"
          :aria-expanded="toolPanel === 'details'"
          @click="openTool('details')"
        >
          <ReportActionIcon name="details" /><span>依据</span
          ><i v-if="active" class="ai-tool-dot" />
        </button>
        <button
          data-tool="recycle"
          aria-label="回收站"
          title="回收站"
          :aria-expanded="toolPanel === 'recycle'"
          @click="openTool('recycle')"
        >
          <ReportActionIcon name="trash" /><span>回收站</span>
        </button>
      </nav>
      <ReportToolWindow
        :open="toolPanel === 'setup'"
        title="分析设置"
        variant="setup"
        @close="closeTool"
      >
        <section class="ai-analysis-setup">
          <div v-show="!setupCollapsed" class="ai-setup-body">
            <p class="ai-panel-intro">
              为 {{ security.name }} 生成新报告，先确认模型和要使用的资料。
            </p>
            <section class="ai-setup-section">
              <div class="ai-section-heading">
                <h4 class="ai-section-title">分析模型</h4>
                <button
                  class="ai-text-action"
                  @click="emit('settings')"
                  :disabled="active || loading"
                >
                  管理模型
                </button>
              </div>
              <p class="ai-field-hint">
                独立模型分别分析，再由汇总模型整理综合结论。
              </p>
              <p v-if="desktop && !enabled.length" class="ai-inline-notice">
                还没有可用模型，请先添加并启用模型。
              </p>
              <div class="ai-model-choices">
                <label v-for="m in enabled" :key="m.id" class="ai-model-choice"
                  ><input
                    type="checkbox"
                    v-model="selected"
                    :value="m.id"
                    :disabled="active || loading"
                  /><span
                    ><strong>{{ m.displayName }}</strong
                    ><small :title="m.model">{{ m.model }}</small></span
                  ></label
                >
              </div>
              <label class="ai-form-field"
                >汇总模型<select
                  v-model="summary"
                  aria-label="本次汇总模型"
                  :disabled="active || loading"
                >
                  <option value="">请选择</option>
                  <option v-for="m in enabled" :key="m.id" :value="m.id">
                    {{ m.displayName }} · {{ m.model }}
                  </option>
                </select></label
              >
              <p class="ai-field-hint">可与独立分析使用同一模型。</p>
            </section>
            <section class="ai-setup-section">
              <h4 class="ai-section-title">账户资料</h4>
              <template v-if="positionContext || cashContext">
                <label class="ai-account-toggle"
                  ><input
                    type="checkbox"
                    v-model="includePosition"
                    :disabled="active || loading"
                  />{{
                    positionContext
                      ? "结合本股持仓、本轮交易和买入现金"
                      : "结合可用于买入的现金"
                  }}</label
                >
                <template v-if="includePosition"
                  ><ReportAccountSummary
                    :position="positionContext"
                    :cash="cashContext"
                    :unit="quantityUnit"
                  />
                  <p class="ai-field-hint">
                    发送本股记录与全账户现金余额，并随报告保存。现金按已录入账户记录计算，未与券商核对，买入还需预留费用。
                  </p></template
                >
                <p v-else class="ai-field-hint">
                  本次不发送持仓、交易和现金余额，仅使用行情、取得的新闻原文及你补充的资料。
                </p>
              </template>
              <p v-else class="ai-field-hint">
                未提供本股持仓或现金记录，AI不会假设你空仓或资金充足。
              </p>
            </section>
            <section
              v-if="positionContext && includePosition"
              class="ai-setup-section"
            >
              <h4 class="ai-section-title">操作偏好</h4>
              <label class="ai-form-field"
                >优先考虑<select
                  v-model="executionPolicy.preference"
                  :disabled="active || loading"
                >
                  <option value="tFirst">保留底仓，优先做 T</option>
                  <option value="riskFirst">优先减仓控风险</option>
                  <option value="averageDown">有条件评估加仓</option>
                </select></label
              >
              <div class="ai-policy-fields">
                <label class="ai-form-field"
                  >保留底仓（%）<input
                    v-model.number="executionPolicy.reservePercent"
                    type="number"
                    min="0"
                    max="100"
                    :disabled="active || loading" /></label
                ><label class="ai-form-field"
                  >单轮做 T 上限（%）<input
                    v-model.number="executionPolicy.tPercent"
                    type="number"
                    min="1"
                    max="100"
                    :disabled="active || loading"
                /></label>
              </div>
              <p class="ai-field-hint">
                比例按本股持仓计算，实际数量受可卖股数、整手与资金限制；偏好不代表一定操作。
              </p>
            </section>
            <details class="ai-setup-supplement ai-setup-disclosure">
              <summary>
                补充资料 <span>选填 · 新闻、公告或你的判断</span>
              </summary>
              <p class="ai-field-hint">
                自动采集行情、分时、日线、资金流和公告列表，并检索少量相关新闻读取原文。无法取得正文会明确标记，不用摘要替代；你也可以补充原文或交易计划。
              </p>
              <label class="ai-form-field"
                >资料正文<textarea
                  v-model="manual"
                  aria-label="补充分析资料"
                  maxlength="10000"
                  :disabled="active || loading"
                  rows="4"
                  placeholder="粘贴资料，注明日期和来源。请勿填写 API 密钥。"
                />
              </label>
              <div class="ai-supplement-meta">
                <div>
                  <a
                    :href="newsUrl"
                    @click.prevent="openSource(newsUrl)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >查看新闻</a
                  ><a
                    :href="announcementUrl"
                    @click.prevent="openSource(announcementUrl)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >查看公告</a
                  >
                </div>
                <small>{{ manual.length }} / 10000</small>
              </div>
            </details>
            <details class="ai-setup-disclosure">
              <summary>费用与资料说明</summary>
              <p class="ai-field-hint">
                每次最多选择 20 个独立模型，另调用 1 次汇总模型。每次最多生成
                8192 token，费用按服务商规则计算；不会因格式问题自动修复或重试。
              </p>
              <p class="ai-field-hint">
                临时选择不修改默认配置。报告会优先列出买卖价位、股数和执行条件，再给出分析依据。
              </p>
            </details>
            <details
              v-if="hasRawReports"
              class="ai-setup-disclosure ai-secondary-action"
            >
              <summary>仅重新生成综合结论</summary>
              <p class="ai-field-hint">
                沿用这份报告保存的资料与独立分析，只调用当前所选的汇总模型。不会获取新行情或新闻，也不会使用上面的账户选择、操作偏好或补充资料。
              </p>
              <button
                :disabled="active || loading || !summary"
                @click="resummarize"
              >
                重新汇总 · 预计 1 次调用
              </button>
            </details>
          </div>
        </section>
        <template #footer
          ><div class="ai-setup-footer">
            <div>
              <strong>预计调用 {{ estimate }} 次</strong
              ><small
                >{{ selected.length }} 次独立分析 + 1 次汇总 ·
                按所选模型计费</small
              >
            </div>
            <button
              class="primary"
              :disabled="
                !desktop ||
                loading ||
                active ||
                !selected.length ||
                selected.length > 20 ||
                !summary
              "
              @click="start"
            >
              {{ active ? "分析进行中" : detail ? "重新分析" : "开始分析" }}
            </button>
          </div></template
        >
      </ReportToolWindow>
      <ReportToolWindow
        :open="toolPanel === 'history'"
        title="历史报告"
        variant="library"
        return-focus-to='[data-tool="history"]'
        @close="closeTool"
      >
        <p v-if="libraryMessage" class="ai-library-message" role="status">
          {{ libraryMessage }}
        </p>
        <p v-if="error" role="alert" class="ai-library-error">{{ error }}</p>
        <ReportHistoryList
          :items="history"
          :current-id="detail?.id"
          :busy="active || loading"
          :has-more="!!historyCursor"
          @select="watchTask"
          @remove="requestDelete"
          @more="moreHistory"
        />
      </ReportToolWindow>
      <ReportToolWindow
        :open="toolPanel === 'recycle'"
        title="回收站"
        variant="library"
        return-focus-to='[data-tool="recycle"]'
        @close="closeTool"
      >
        <ReportRecycleBin
          v-if="desktop && recycleOpen"
          @changed="recycleChanged"
        />
      </ReportToolWindow>
      <ReportToolWindow
        :open="toolPanel === 'details'"
        title="资料与分析过程"
        variant="process"
        @content-scroll="processScrolled"
        @browse="followStage = false"
        return-focus-to='[data-tool="details"]'
        @close="closeTool"
      >
        <template #subheader
          ><nav
            v-if="detail && !progressStarting && !launchError"
            class="ai-process-tabs"
            role="tablist"
            aria-label="过程与资料"
            @keydown="processViewKeys"
          >
            <button
              role="tab"
              data-process-view="execution"
              :tabindex="processView === 'execution' ? 0 : -1"
              :aria-selected="processView === 'execution'"
              aria-controls="ai-execution-panel"
              @click="processView = 'execution'"
            >
              执行记录</button
            ><button
              role="tab"
              data-process-view="materials"
              :tabindex="processView === 'materials' ? 0 : -1"
              :aria-selected="processView === 'materials'"
              aria-controls="ai-materials-panel"
              @click="processView = 'materials'"
            >
              本次资料
            </button>
          </nav>
          <div
            v-if="detail && !progressStarting && !launchError"
            v-show="processView === 'execution'"
            class="ai-report-state ai-process-dashboard"
          >
            <div class="ai-process-overview" :data-state="detail.status">
              <span class="ai-process-orb" :class="{ 'is-running': active }"
                ><ReportActionIcon :name="active ? 'analysis' : 'details'"
              /></span>
              <div>
                <small>本次分析</small>
                <h4>{{ processTitle }}</h4>
                <p v-if="active">
                  {{ currentStage?.label ?? "正在准备下一阶段" }}
                </p>
              </div>
              <span
                class="ai-process-status"
                :class="{ 'has-error': detail.status === 'failed' }"
                >{{ active ? "进行中" : displayStatus(detail) }}</span
              >
            </div>
            <ol
              v-if="processStep >= 0"
              class="ai-process-steps"
              aria-label="分析阶段"
            >
              <li
                v-for="(label, index) in [
                  '采集资料',
                  '独立分析',
                  '综合结论',
                  '完成',
                ]"
                :key="label"
                :class="{
                  'is-current': index === processStep && active,
                  'is-done':
                    index < processStep || (!active && index === processStep),
                }"
              >
                <span>{{
                  index < processStep || (!active && index === processStep)
                    ? "✓"
                    : index + 1
                }}</span
                >{{ label }}
              </li>
            </ol>
            <div class="ai-process-metrics">
              <div>
                <small>资料快照</small
                ><strong>{{ snapshot?.evidence.length ?? 0 }} 项</strong>
              </div>
              <div>
                <small>独立报告</small
                ><strong
                  >{{
                    markdownMode ? markdownReportCount : validReports.length
                  }}/{{ detail.requestSnapshot.participantIds.length }}
                  {{ markdownMode ? "份独立正文" : "份有效独立报告" }}</strong
                >
              </div>
              <div>
                <small>模型调用</small><strong>{{ attemptedCalls }} 次</strong>
              </div>
            </div>
          </div>
          <div
            v-if="active && processView === 'execution'"
            class="ai-stage-follow"
          >
            <small>{{
              followStage ? "正在跟随当前阶段" : "已暂停跟随，可自由翻看"
            }}</small>
            <button
              v-if="!followStage"
              data-follow-stage
              @click="resumeStageFollow"
            >
              跟随当前阶段 ↓
            </button>
          </div>
        </template>

        <div
          v-if="progressStarting || launchError"
          class="ai-process-launch"
          :class="{ 'has-error': launchError }"
          role="status"
        >
          <span
            class="ai-process-orb"
            :class="{ 'is-running': progressStarting }"
            ><ReportActionIcon :name="launchError ? 'details' : 'analysis'"
          /></span>
          <h4>{{ launchError ? "未能启动分析" : "正在启动分析" }}</h4>
          <p>
            {{
              launchError || "正在创建任务，随后将显示资料采集和模型生成进度。"
            }}
          </p>
          <button v-if="launchError" @click="openTool('setup')">
            返回分析设置
          </button>
        </div>
        <template v-else-if="detail">
          <div
            id="ai-execution-panel"
            class="ai-execution-view"
            role="tabpanel"
            aria-label="执行记录"
            v-show="processView === 'execution'"
          >
            <p v-if="invalidReportCount && !markdownMode" class="ai-error">
              已收到 {{ detail.reports.length }} 份输出，{{
                invalidReportCount
              }}
              份未通过校验，未用于汇总。
            </p>
            <p v-for="(e, i) in detail.errors" :key="i" class="ai-error">
              {{ e.message }}
            </p>
            <section
              v-if="detail"
              class="ai-settings-card ai-execution-trace ai-process-section"
              aria-label="分析执行过程"
            >
              <details :open="active" @toggle="scrollToStage">
                <summary>
                  分析过程
                  <small
                    >{{ active ? "正在执行" : displayStatus(detail) }} ·
                    {{ attemptedCalls }} 次模型调用</small
                  >
                </summary>

                <p v-if="!traceRows.length">
                  {{
                    active
                      ? "正在启动任务，等待阶段记录…"
                      : "该历史报告未保存阶段记录，可查看调用明细和报告依据。"
                  }}
                </p>
                <ol v-if="traceRows.length" class="ai-trace-list">
                  <li
                    v-for="row in traceRows"
                    :key="row.stage"
                    :class="['trace-' + row.state]"
                    :aria-current="
                      active && row.stage === currentStage?.stage
                        ? 'step'
                        : undefined
                    "
                    :data-stage="row.stage"
                  >
                    <div>
                      <strong>{{ row.label }}</strong
                      ><span>{{ eventState(row) }} · {{ elapsed(row) }}</span>
                    </div>
                    <p>{{ row.detail }}</p>
                  </li>
                </ol>
                <small v-if="(detail.progress as any)?.eventsTruncated"
                  >仅显示最近1000条阶段记录，模型调用记录仍保留。</small
                >
              </details>
            </section>
            <section
              v-if="callRows.length"
              class="ai-settings-card ai-process-section ai-process-calls ai-request-details"
            >
              <details v-if="callRows.length">
                <summary>请求明细 · {{ attemptedCalls }} 次调用</summary>
                <p v-for="(call, i) in callRows" :key="i">
                  {{ call.modelName ?? modelName(call.modelId) }} ·
                  {{ roleLabels[call.role] ?? call.role }} · 第
                  {{ call.attempt }} 次尝试 ·
                  {{
                    call.phase === "sending"
                      ? active
                        ? "已发送，等待响应"
                        : "未记录响应"
                      : call.phase === "responseHeaders"
                        ? "服务端已开始回应，还在等待完整报告"
                        : call.phase === "responseComplete"
                          ? "完整响应已接收"
                          : "阶段：" + call.phase
                  }}
                  · {{ date(call.at) }}
                </p>
              </details>
            </section>
          </div>
          <div
            id="ai-materials-panel"
            class="ai-materials-view"
            role="tabpanel"
            aria-label="本次资料"
            v-show="processView === 'materials'"
          >
            <template v-if="snapshot">
              <p class="ai-panel-intro">
                本报告保存时的资料，不会随新行情或新交易更新。
              </p>
              <dl class="ai-snapshot-meta">
                <div>
                  <dt>数据截止</dt>
                  <dd>{{ date(snapshot.cutoffAt) }}</dd>
                </div>
                <div>
                  <dt>参考价格</dt>
                  <dd>
                    {{
                      snapshot.referencePrice
                        ? snapshot.referencePrice + " 元"
                        : "未取得"
                    }}
                  </dd>
                </div>
                <div>
                  <dt>分析窗口</dt>
                  <dd>
                    {{ todayLabel }} ·
                    {{
                      arr((snapshot.windows as any).futureDates).join("、") ||
                      "未来交易日待确认"
                    }}
                  </dd>
                </div>
              </dl>
              <p class="ai-field-hint">
                {{
                  (snapshot.windows as any).todayMode === "review"
                    ? "报告当日已收盘：仅复盘已发生走势，不作为当前盘中建议。"
                    : (snapshot.windows as any).todayMode === "nonTradingDay"
                      ? "报告当日休市：当日部分为复盘与下一交易日准备。"
                      : "本报告当日部分使用数据截止时点至收盘的分析窗口。"
                }}
              </p>
              <section
                class="ai-material-section ai-report-context ai-frozen-account"
              >
                <h4>账户与本轮交易</h4>
                <ReportAccountSummary
                  :position="frozenPosition"
                  :cash="frozenCash"
                  :unit="quantityUnit"
                />
                <details
                  v-if="frozenAccountSummary?.facts"
                  class="ai-account-explanation"
                >
                  <summary>AI收到的账户与盈亏说明</summary>
                  <p
                    v-for="(fact, index) in frozenAccountSummary.facts"
                    :key="index"
                  >
                    {{ fact }}
                  </p>
                  <p>{{ frozenAccountSummary.reviewBoundary }}</p>
                </details>
                <p v-if="!heldSnapshot" class="ai-field-hint">
                  这份报告未包含本股持仓资料。
                </p>
                <p class="ai-field-hint">
                  这里的现金是报告保存时按账户记录计算的买入预算，未与券商可用资金核对，且未预留将来买入费用。
                </p>
              </section>
              <section class="ai-material-section ai-source-details">
                <div class="ai-section-heading">
                  <h4>行情与补充资料</h4>
                  <small>{{ sourceEvidence.length }} 项</small>
                </div>
                <p v-if="missingSources.length" class="ai-inline-notice">
                  未取得：{{
                    missingSources.join("、")
                  }}。请结合缺失情况判断报告。
                </p>
                <p class="ai-field-hint">
                  新闻仅在取得网页正文时用于分析，未取得全文会标明原因。公告仍只有标题和链接；原文可能含后续更新，不代表交易时点的历史版本。
                </p>
                <details
                  v-for="e in sourceEvidence"
                  :key="e.id"
                  class="ai-source-item"
                >
                  <summary>
                    <span
                      ><strong>{{ evidenceLabel(e.kind) }}</strong
                      ><small>{{ e.source }}</small></span
                    ><span class="ai-source-state">{{
                      availabilityLabels[e.availability] ?? e.availability
                    }}</span>
                  </summary>
                  <a
                    v-if="e.url?.startsWith('https://')"
                    :href="e.url"
                    @click.prevent="openSource(e.url)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >打开来源</a
                  >
                  <template v-if="e.kind === 'news'">
                    <h5 class="ai-news-title">
                      {{ newsContent(e.content).title }}
                    </h5>
                    <p class="ai-field-hint">
                      {{
                        newsContent(e.content).publishedAt
                          ? date(String(newsContent(e.content).publishedAt))
                          : "发布时间未知"
                      }}
                      · {{ newsContent(e.content).source }}
                    </p>
                    <div
                      v-if="
                        e.availability === 'fullText' &&
                        newsContent(e.content).fullText
                      "
                      class="ai-news-full-text"
                    >
                      {{ newsContent(e.content).fullText }}
                    </div>
                    <p
                      v-else-if="e.availability === 'excerpt'"
                      class="ai-news-summary"
                    >
                      旧报告搜索摘要（非全文）：{{
                        newsContent(e.content).summary
                      }}
                    </p>
                    <p v-else class="ai-inline-notice">
                      未取得新闻全文：{{
                        newsContent(e.content).contentStatus ||
                        "来源仅提供检索线索"
                      }}。本条不作为事件判断依据。
                    </p>
                    <p
                      v-if="e.availability === 'fullText'"
                      class="ai-field-hint"
                    >
                      已读取网页文字正文；图片、附件和交互图表未解析。
                    </p>
                    <p class="ai-field-hint">
                      {{ newsContent(e.content).relevance }}
                    </p>
                  </template>
                  <pre v-else>{{ e.content }}</pre>
                </details>
              </section>
              <details class="ai-setup-disclosure ai-process-raw">
                <summary>原始记录与测算输入 <span>高级</span></summary>
                <dl class="ai-source-state-list">
                  <template
                    v-for="(state, name) in snapshot.sourceStates as any"
                    :key="name"
                    ><dt>{{ sourceLabels[String(name)] ?? name }}</dt>
                    <dd>{{ sourceState(state) }}</dd></template
                  >
                </dl>
                <details v-for="e in accountEvidence" :key="e.id">
                  <summary>{{ evidenceLabel(e.kind) }}</summary>
                  <pre>{{ e.content }}</pre>
                </details>
              </details>
            </template>
            <p v-else class="ai-field-hint">
              资料仍在采集中，保存后会显示在这里。
            </p>
          </div>
        </template>
        <template v-if="active" #footer
          ><div class="ai-process-footer">
            <small>可关闭窗口，分析会继续。</small
            ><button class="ai-process-cancel" @click="cancel">
              取消本次分析
            </button>
          </div></template
        >
      </ReportToolWindow>
    </aside>
  </div>
</template>
<style scoped>
.ai-stock-drawer {
  position: relative;
  width: min(800px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  padding: 0;
  background: #f3f6fa;
}
.ai-drawer-heading {
  padding: 22px 26px;
  background: #fff;
  border-bottom: 1px solid #dce3ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.ai-drawer-heading h2 {
  font-size: 20px;
  margin: 6px 0 0;
}
.ai-drawer-heading small {
  color: #758293;
}
.ai-drawer-scroll {
  padding: 22px;
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ai-stock-drawer p {
  font-size: 13px;
  line-height: 1.7;
}
.ai-stock-drawer small {
  font-size: 12px;
  color: #758293;
}
.ai-setup-body > label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 14px 0;
}
.ai-stock-drawer select,
.ai-stock-drawer textarea {
  width: 100%;
  padding: 9px;
  min-height: 36px;
}
.ai-source-links {
  display: flex;
  gap: 16px;
  align-items: center;
}
.ai-source-links a {
  color: #3268cf;
}
.ai-analysis-history small {
  display: block;
  margin-top: 8px;
}
.ai-analysis-status {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
}
.ai-analysis-status p {
  width: 100%;
}
.ai-summary-card {
  border-top: 3px solid #3268cf;
}
.ai-summary-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ai-summary-heading select {
  width: auto;
}
.ai-prose {
  white-space: pre-wrap;
}
.ai-claim {
  border-top: 1px solid #e1e7ef;
  padding: 13px 0;
}
.ai-claim summary {
  line-height: 1.6;
  cursor: pointer;
}
.ai-claim summary small {
  display: block;
  margin-top: 4px;
}
.ai-claim article {
  margin: 12px 0 0;
  padding: 12px;
  background: #f6f8fb;
  border-radius: 6px;
}
.ai-report-window {
  border-top: 1px solid #e1e7ef;
  margin-top: 16px;
  padding-top: 12px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.6;
  max-height: 300px;
  overflow: auto;
}
dl {
  display: grid;
  grid-template-columns: 140px 1fr;
  font-size: 12px;
  gap: 8px;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
details > summary {
  cursor: pointer;
}
h4 {
  font-size: 14px;
  margin: 10px 0;
}
.ai-setup-header,
.ai-trace-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.ai-setup-header h3,
.ai-trace-header h3 {
  margin: 0;
}
.ai-setup-header button {
  font-size: 12px;
  min-height: 28px;
  padding: 4px 10px;
}
.ai-setup-compact {
  color: #586b82;
  margin: 12px 0;
}
.ai-setup-compact small {
  margin-left: 8px;
}
.ai-trace-list {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
}
.ai-trace-list li {
  border-left: 2px solid #dce4ef;
  padding: 0 0 14px 16px;
  margin-left: 4px;
  position: relative;
}
.ai-trace-list li::before {
  content: "";
  position: absolute;
  left: -5px;
  top: 3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8595aa;
}
.ai-trace-list .trace-done::before {
  background: #339277;
}
.ai-trace-list .trace-running::before {
  background: #3268cf;
  box-shadow: 0 0 0 4px #e3ecfb;
}
.ai-trace-list .trace-failed::before,
.ai-trace-list .trace-warning::before {
  background: #c28436;
}
.ai-trace-list li > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.ai-trace-list li > div > span {
  font-size: 12px;
  color: #758293;
  white-space: nowrap;
}
.ai-trace-list p {
  margin: 6px 0 0;
  color: #66788d;
  font-size: 12px;
}
.ai-execution-trace > details {
  border-top: 1px solid #e1e7ef;
  padding-top: 12px;
  margin-top: 8px;
}

.ai-report-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-report-state {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.ai-report-toolbar label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.ai-report-toolbar select {
  width: auto;
  max-width: 300px;
  font-size: 12px;
}
.ai-report-toolbar .ai-error {
  flex-basis: 100%;
  margin: 0;
}
.ai-report-context {
  padding: 0 4px;
}
.ai-report-context p {
  margin: 0 0 6px;
}
.ai-stock-drawer .ai-data-gap {
  font-size: 12px;
  color: #825f26;
  background: #fbf7ee;
  padding: 8px 10px;
  border-left: 2px solid #d5b46e;
}
.ai-stock-drawer .ai-muted {
  color: #62748a;
  font-size: 12px;
}
.ai-summary-card h3,
.ai-trend-comparison h3 {
  margin: 0 0 8px;
  font-size: 17px;
}
.ai-summary-heading h3 {
  margin-bottom: 0;
}
.ai-key-claims {
  margin-top: 16px;
}
.ai-claim > h4 {
  margin: 0 0 8px;
  color: #243850;
}
.ai-claim > p {
  margin: 0 0 10px;
  color: #26384e;
}
.ai-claim > details > summary {
  font-size: 12px;
  color: #3268cf;
}
.ai-claim > details > summary small {
  display: inline;
  margin-left: 8px;
}
.ai-model-support {
  padding: 14px;
  background: #f6f8fb;
  border-radius: 6px;
  margin-top: 12px;
}
.ai-condition-list {
  grid-template-columns: 72px 1fr;
  line-height: 1.8;
}
.ai-condition-list dt {
  color: #65758a;
}
.ai-operation-claim {
  border-left: 3px solid #86a4cf;
  padding-left: 14px;
  margin-top: 8px;
}
.ai-disagreements {
  padding: 12px 14px;
  background: #fbf7ee;
  border-radius: 6px;
  margin-top: 12px;
}
.ai-disagreements h4 {
  margin: 0 0 6px;
}
.ai-disagreements p {
  margin: 6px 0;
}
.ai-model-report > details > summary,
.ai-source-details > details > summary,
.ai-execution-trace > details > summary {
  font-size: 14px;
  line-height: 1.7;
}
.ai-model-report > details > summary > small,
.ai-source-details > details > summary > small {
  display: block;
  margin-left: 17px;
}
.ai-trend-scroll {
  overflow-x: auto;
}
.ai-trend-comparison table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}
.ai-trend-comparison th,
.ai-trend-comparison td {
  padding: 10px 8px;
  border-bottom: 1px solid #e3e9f1;
  font-weight: normal;
}
.ai-trend-comparison thead th {
  font-size: 12px;
  color: #65758a;
}
.ai-trend-comparison td small {
  display: block;
  margin-top: 3px;
}
.ai-direction-bullish {
  color: #b34345;
}
.ai-direction-bearish {
  color: #23836c;
}
.ai-direction-sideways,
.ai-direction-uncertain {
  color: #53667e;
}
.ai-source-details dl {
  margin-top: 14px;
}
.ai-evidence,
.ai-raw-output {
  margin-top: 14px;
}
@media (max-width: 600px) {
  .ai-drawer-scroll {
    padding: 14px;
    gap: 12px;
  }
  .ai-report-toolbar label {
    width: 100%;
  }
  .ai-report-toolbar select {
    flex: 1;
    min-width: 0;
  }
  .ai-report-context p {
    line-height: 1.8;
  }
}

.ai-floating-tools {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 30;
  display: flex;
  gap: 2px;
  padding: 5px;
  background: #fff;
  border: 1px solid #d4dfea;
  border-radius: 12px;
  box-shadow: 0 4px 20px #20344e24;
}
.ai-floating-tools button {
  display: flex;
  position: relative;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 44px;
  height: 44px;
  padding: 4px 7px;
  border: 0;
  background: transparent;
  color: #52677e;
  border-radius: 8px;
  cursor: pointer;
}
.ai-floating-tools button:hover,
.ai-floating-tools button:focus-visible {
  background: #edf3fc;
  color: #3268cf;
}
.ai-floating-tools button:focus-visible {
  outline: 2px solid #3268cf;
  outline-offset: 1px;
}
.ai-floating-tools button:first-child {
  color: #3268cf;
  background: #edf3fc;
}
.ai-floating-tools span {
  font-size: 10px;
  line-height: 1.2;
}
.ai-tool-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3268cf;
  flex-shrink: 0;
}
.ai-floating-tools .ai-tool-dot {
  position: absolute;
  right: 7px;
  top: 5px;
}
.ai-run-indicator {
  display: flex;
  align-items: center;
  gap: 7px;
  align-self: flex-start;
  border: 0;
  background: #e9f0fb;
  color: #3268cf;
  padding: 5px 9px;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
}
.ai-empty-report {
  margin: auto;
  text-align: center;
  color: #758293;
  padding: 40px 12px;
}
.ai-drawer-heading {
  padding: 12px 16px;
  gap: 12px;
}
.ai-drawer-heading > div {
  min-width: 0;
}
.ai-drawer-heading h2 {
  font-size: 16px;
  line-height: 1.4;
  margin: 3px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-drawer-heading .ai-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: 0;
  flex-shrink: 0;
}
.ai-drawer-scroll {
  padding: 12px 16px 84px;
  gap: 10px;
}
.ai-analysis-setup {
  border: 0;
  padding: 0;
  background: transparent;
}
.ai-tool-overlay .ai-settings-card {
  margin-bottom: 10px;
}
@media (max-width: 600px) {
  .ai-drawer-scroll {
    padding: 10px 10px 82px;
  }
  .ai-floating-tools {
    right: 10px;
    bottom: 10px;
  }
}

.ai-report-state.ai-process-dashboard {
  display: block;
  margin: 0;
  padding: 10px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.ai-stage-follow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 14px 8px;
  min-height: 24px;
  color: #62748a;
}
.ai-stage-follow button {
  border: 0;
  background: transparent;
  color: #3268cf;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}
.ai-process-overview {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 0 12px;
}
.ai-process-overview > div {
  flex: 1;
  min-width: 0;
}
.ai-process-overview h4 {
  margin: 2px 0;
  font-size: 16px;
  line-height: 1.4;
  color: #243b58;
}
.ai-process-overview p {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: #62748a;
  overflow-wrap: anywhere;
}
.ai-process-orb {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #edf3fc;
  color: #3268cf;
}
.ai-process-status {
  padding: 3px 7px;
  border-radius: 5px;
  background: #edf3fc;
  color: #3268cf;
  font-size: 11px;
  white-space: nowrap;
}
.ai-process-status.has-error {
  background: #fff0ed;
  color: #b45342;
}
.ai-process-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  list-style: none;
  margin: 4px 0 14px;
  padding: 0;
}
.ai-process-steps li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  position: relative;
  font-size: 11px;
  color: #8593a4;
}
.ai-process-steps li + li:before {
  content: "";
  position: absolute;
  width: calc(100% - 28px);
  height: 1px;
  background: #e1e7ef;
  right: calc(50% + 14px);
  top: 11px;
}
.ai-process-steps li > span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f0f3f7;
  font-size: 10px;
}
.ai-process-steps .is-done {
  color: #337f6b;
}
.ai-process-steps .is-done > span {
  background: #eaf5ef;
}
.ai-process-steps .is-current {
  color: #3268cf;
  font-weight: 600;
}
.ai-process-steps .is-current > span {
  background: #3268cf;
  color: #fff;
  box-shadow: 0 0 0 3px #edf3fc;
}
.ai-process-metrics {
  display: grid;
  grid-template-columns: 1fr 1.6fr 1fr;
  border: 1px solid #e3e9f1;
  border-radius: 8px;
  padding: 9px 0;
  background: #f8fafc;
}
.ai-process-metrics > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 0 5px;
  min-width: 0;
  text-align: center;
}
.ai-process-metrics > div + div {
  border-left: 1px solid #e3e9f1;
}
.ai-process-metrics strong {
  font-size: 12px;
  line-height: 1.4;
  font-weight: 600;
  color: #243b58;
}
.ai-process-metrics small {
  font-size: 10px;
}
.ai-tool-overlay .ai-process-section {
  padding: 11px 12px;
  margin: 10px 0;
  border: 1px solid #e3e9f1;
  border-radius: 8px;
  background: #fff;
}
.ai-process-section > details {
  border: 0;
  margin: 0;
  padding: 0;
}
.ai-process-section > summary,
.ai-process-section > details > summary {
  font-size: 12px;
  line-height: 1.6;
  color: #354d68;
  font-weight: 600;
}
.ai-process-section > summary > small,
.ai-process-section > details > summary > small {
  font-size: 10px;
  line-height: 1.5;
  display: block;
  margin: 3px 0 0 14px;
  font-weight: 400;
}
.ai-process-section .ai-trace-list {
  margin: 14px 0 0;
}
.ai-process-section .ai-trace-list li {
  padding: 0 0 14px 12px;
  margin-left: 3px;
}
.ai-process-section .ai-trace-list li:last-child {
  padding-bottom: 0;
}
.ai-process-section .ai-trace-list li > div {
  align-items: flex-start;
  font-size: 12px;
  gap: 8px;
}
.ai-process-section .ai-trace-list strong {
  font-weight: 500;
  line-height: 1.5;
}
.ai-process-section .ai-trace-list li > div > span {
  font-size: 10px;
  line-height: 1.6;
}
.ai-process-section .ai-trace-list p {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #6b7d91;
}
.ai-process-section .trace-running > div > strong {
  color: #3268cf;
}
.ai-process-section .trace-failed > div > strong {
  color: #b45342;
}
.ai-process-section .ai-account-metrics {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.ai-process-launch {
  padding: 28px 14px;
  text-align: center;
}
.ai-process-launch h4 {
  margin: 12px 0 6px;
  font-size: 16px;
}
.ai-process-launch p {
  margin: 0;
  color: #62748a;
  font-size: 12px;
  line-height: 1.7;
}
.ai-process-launch.has-error h4 {
  color: #b45342;
}
.ai-process-cancel {
  display: block;
  margin: 14px auto 0;
  border: 1px solid #d9e2ed;
  background: #fff;
  color: #62748a;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
}
.is-running > svg {
  animation: ai-process-turn 4s linear infinite;
}
@keyframes ai-process-turn {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-running > svg {
    animation: none;
  }
}

.ai-panel-intro {
  margin: 0 0 14px;
  color: #758293;
  font-size: 12px;
  line-height: 1.6;
}
.ai-setup-section {
  padding: 0 0 16px;
  margin: 0 0 16px;
  border-bottom: 1px solid #e5ebf2;
}
.ai-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.ai-section-title,
.ai-material-section h4 {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 9px;
  color: #243b58;
}
.ai-section-heading .ai-section-title,
.ai-section-heading h4 {
  margin: 0;
}
.ai-text-action {
  padding: 2px 0;
  border: 0;
  background: none;
  color: #3268cf;
  font-size: 11px;
  cursor: pointer;
}
.ai-stock-drawer .ai-field-hint {
  font-size: 11px;
  line-height: 1.65;
  color: #758293;
  margin: 6px 0;
}
.ai-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0 0;
  color: #52677e;
  font-size: 12px;
  line-height: 1.5;
}
.ai-model-choices {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 0;
  margin: 10px 0 14px;
  max-height: 200px;
  overflow: auto;
  border: 1px solid #e3e9f1;
  border-radius: 8px;
}
.ai-model-choice {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  cursor: pointer;
  background: #fff;
}
.ai-model-choice + label {
  border-top: 1px solid #edf1f6;
}
.ai-model-choice:has(input:checked) {
  background: #f5f8fe;
}
.ai-model-choice > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
}
.ai-model-choice strong {
  font-size: 12px;
  font-weight: 500;
  color: #354d68;
}
.ai-model-choice small {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ai-account-toggle {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #354d68;
  margin: 6px 0 12px;
}
.ai-account-toggle input {
  margin-top: 3px;
  flex-shrink: 0;
}
.ai-policy-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.ai-policy-fields input {
  min-width: 0;
  width: 100%;
  padding: 8px;
  border: 1px solid #cfd9e6;
  border-radius: 6px;
}
.ai-inline-notice {
  padding: 8px 10px;
  margin: 8px 0;
  background: #fff8eb;
  color: #996723;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
}
.ai-setup-disclosure {
  padding: 12px 0;
  border-bottom: 1px solid #e5ebf2;
}
.ai-setup-disclosure:last-child {
  border: 0;
  padding-bottom: 0;
}
.ai-setup-disclosure > summary {
  font-size: 12px;
  color: #52677e;
  line-height: 1.7;
  cursor: pointer;
}
.ai-setup-disclosure > summary > span {
  display: block;
  margin-left: 14px;
  font-size: 10px;
  color: #8593a4;
}
.ai-supplement-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}
.ai-supplement-meta > div {
  display: flex;
  gap: 12px;
  font-size: 11px;
}
.ai-supplement-meta small {
  font-size: 10px;
}
.ai-supplement-meta a,
.ai-source-item a {
  color: #3268cf;
}
.ai-setup-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-setup-footer > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ai-setup-footer strong {
  font-size: 12px;
  font-weight: 600;
  color: #354d68;
}
.ai-setup-footer small {
  font-size: 10px;
  line-height: 1.5;
}
.ai-setup-footer > .primary {
  flex-shrink: 0;
  min-width: 96px;
  min-height: 36px;
  padding: 8px 14px;
}
.ai-process-tabs {
  display: flex;
  gap: 18px;
  padding: 0 14px;
}
.ai-process-tabs button {
  padding: 10px 1px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #758293;
  border-radius: 0;
  font-size: 12px;
  cursor: pointer;
}
.ai-process-tabs button[aria-selected="true"] {
  border-bottom-color: #3268cf;
  color: #3268cf;
  font-weight: 600;
}
.ai-process-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.ai-process-footer small {
  font-size: 10px;
}
.ai-process-footer .ai-process-cancel {
  margin: 0;
  flex-shrink: 0;
}
.ai-material-section {
  padding: 14px 0;
  border-bottom: 1px solid #e5ebf2;
}
.ai-material-section h4 {
  margin-bottom: 10px;
}
.ai-snapshot-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 11px;
  margin: 0;
  padding: 0 0 14px;
  border-bottom: 1px solid #e5ebf2;
}
.ai-snapshot-meta > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 12px;
}
.ai-snapshot-meta dt {
  color: #8593a4;
}
.ai-snapshot-meta dd {
  color: #52677e;
  line-height: 1.6;
}
.ai-source-item {
  border-bottom: 1px solid #edf1f6;
  padding: 10px 0;
}
.ai-source-item:last-child {
  border: 0;
}
.ai-source-item > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.ai-source-item > summary > span:first-child {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ai-source-item strong {
  font-size: 12px;
  font-weight: 500;
  color: #354d68;
}
.ai-source-item small {
  font-size: 10px;
  overflow-wrap: anywhere;
}
.ai-source-state {
  font-size: 10px;
  line-height: 1.5;
  color: #758293;
  text-align: right;
  max-width: 110px;
  flex-shrink: 0;
}
.ai-source-item > summary:before {
  content: "›";
  color: #8593a4;
}
.ai-source-item[open] > summary:before {
  content: "⌄";
}
.ai-source-item > summary > span:first-child {
  flex: 1;
}
.ai-source-item > a {
  font-size: 11px;
  display: inline-block;
  margin-top: 8px;
}
.ai-source-state-list {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  font-size: 11px;
  gap: 8px;
  margin: 10px 0;
}
.ai-request-details > details > p {
  font-size: 11px;
  padding: 8px 0;
  border-bottom: 1px solid #edf1f6;
  margin: 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.ai-process-metrics > div:nth-child(2) strong {
  font-size: 11px;
}
@media (max-width: 420px) {
  .ai-setup-footer small {
    font-size: 9px;
  }
  .ai-setup-footer {
    gap: 8px;
  }
  .ai-setup-footer > .primary {
    min-width: 88px;
    padding: 8px 10px;
  }
  .ai-policy-fields {
    gap: 10px;
  }
}

.ai-material-section.ai-frozen-account {
  border: 0;
  border-bottom: 1px solid #e5ebf2;
  border-radius: 0;
  margin: 0;
  padding: 14px 0;
}
.ai-model-choice {
  flex-shrink: 0;
}
.ai-model-choice > input {
  flex-shrink: 0;
}
.ai-model-choice > span {
  flex: 1;
}
</style>

<style scoped>
.ai-report-surface {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.ai-report-surface > .ai-drawer-scroll {
  flex: 1;
}
.ai-report-surface--has-report > .ai-drawer-scroll {
  padding-top: 62px;
}
.ai-report-switcher {
  position: absolute;
  top: 9px;
  left: 16px;
  width: max-content;
  max-width: calc(100% - 32px);
  z-index: 2;
  background: transparent;
  pointer-events: none;
}
.ai-stock-drawer .ai-report-switcher .ai-report-tabs {
  position: relative;
  display: inline-grid;
  grid-template-columns: repeat(var(--report-tab-count), minmax(0, 1fr));
  gap: 3px;
  padding: 5px;
  border: 1px solid rgba(255, 255, 255, 0.88);
  border-radius: 24px;
  background: rgba(246, 249, 254, 0.72);
  -webkit-backdrop-filter: blur(22px) saturate(155%);
  backdrop-filter: blur(22px) saturate(155%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.95),
    inset 0 -1px 1px rgba(124, 150, 181, 0.14),
    0 5px 18px rgba(35, 59, 89, 0.14),
    0 0 0 1px rgba(132, 156, 187, 0.16);
  max-width: 100%;
  pointer-events: auto;
}
.ai-stock-drawer .ai-report-switcher .ai-report-tabs button {
  border: 1px solid transparent;
  border-radius: 18px;
  min-height: 32px;
  height: auto;
  padding: 6px 14px;
  font-size: 12px;
  color: #52677e;
  background: transparent;
}
.ai-stock-drawer
  .ai-report-switcher
  .ai-report-tabs
  button[aria-pressed="true"] {
  background: transparent;
  color: #3268cf;
  border-color: transparent;
  box-shadow: none;
}
.ai-stock-drawer .ai-report-switcher button:focus-visible {
  outline: 2px solid #3268cf;
  outline-offset: 1px;
}
.ai-floating-tools .ai-analysis-launcher {
  flex-direction: row;
  gap: 8px;
  padding: 5px 11px;
  min-width: 125px;
  background: #edf3fc;
  border: 1px solid #c7d8f1;
}
.ai-analysis-launcher > svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.ai-floating-tools .ai-analysis-launcher-label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
}
.ai-floating-tools .ai-analysis-launcher-label strong {
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  color: #3268cf;
}
.ai-floating-tools .ai-analysis-launcher-label small {
  display: block;
  font-size: 10px;
  line-height: 1.2;
  color: #6c83a0;
  margin: 0;
  white-space: nowrap;
}
@supports not (
  (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))
) {
  .ai-stock-drawer .ai-report-switcher .ai-report-tabs {
    background: #edf3fa;
  }
}
@media (prefers-reduced-transparency: reduce) {
  .ai-stock-drawer .ai-report-switcher .ai-report-tabs {
    background: #edf3fa;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
@media (max-width: 600px) {
  .ai-report-switcher {
    top: 8px;
    left: 10px;
    max-width: calc(100% - 20px);
  }
  .ai-stock-drawer .ai-report-switcher .ai-report-tabs button {
    padding: 6px 12px;
  }
  .ai-report-surface--has-report > .ai-drawer-scroll {
    padding-top: 61px;
  }
  .ai-floating-tools .ai-analysis-launcher {
    min-width: 120px;
    padding: 5px 9px;
  }
}
</style>

<style scoped>
.ai-report-tab-highlight {
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 5px;
  width: calc(
    (100% - 10px - (var(--report-tab-count) - 1) * 3px) /
      var(--report-tab-count)
  );
  transform: translateX(calc(var(--report-tab-index) * (100% + 3px)));
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
  border: 1px solid rgba(192, 210, 233, 0.65);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.85);
  box-shadow:
    0 1px 4px rgba(39, 73, 114, 0.12),
    inset 0 1px 0 #fff;
  pointer-events: none;
}
.ai-stock-drawer .ai-report-switcher .ai-report-tabs button {
  position: relative;
  z-index: 1;
  transition: color 160ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .ai-report-tab-highlight,
  .ai-stock-drawer .ai-report-switcher .ai-report-tabs button {
    transition: none;
  }
}
</style>

<style scoped>
.ai-account-explanation {
  margin-top: 10px;
  font-size: 11px;
  color: #65758a;
}
.ai-account-explanation > summary {
  cursor: pointer;
  font-size: 11px;
}
.ai-stock-drawer .ai-account-explanation > p {
  font-size: 11px;
  margin: 8px 0;
}
.ai-news-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  margin: 9px 0 5px;
  color: #354d68;
}
.ai-stock-drawer .ai-news-summary {
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0;
}
</style>

<style scoped>
.ai-news-full-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.75;
  color: #354d68;
  margin: 10px 0;
}
</style>

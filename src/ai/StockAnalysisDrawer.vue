<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from "vue";
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
import ReportOperations from "./ReportOperations.vue";
import ReportExecutionPlan from "./ReportExecutionPlan.vue";
const executionPolicy = ref({
  preference: "tFirst",
  reservePercent: 50,
  tPercent: 25,
});
import ReportRecycleBin from "./ReportRecycleBin.vue";
import ReportConfirm from "./ReportConfirm.vue";
import type { CashContext } from "./accountContext";
import type { PositionContext } from "./positionContext";
const props = defineProps<{
  security: SecurityRef;
  positionContext?: PositionContext | null;
  cashContext?: CashContext | null;
}>();
const includePosition = ref(true);
const recycleOpen = ref(false),
  deletePending = ref(false),
  historyCursor = ref<string | null>(null);
const independentChoice = ref("");
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
function money(v: unknown) {
  return typeof v === "string" && Number.isFinite(Number(v))
    ? Number(v).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    : "未知";
}
async function moveToTrash() {
  if (!detail.value || active.value || loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const taskId = detail.value.id;
    await invoke("ai_delete_task", { taskId });
    if (disposed) return;
    stop();
    detail.value = null;
    deletePending.value = false;
    await refreshHistory();
    if (history.value[0]) watchTask(history.value[0]);
    recycleOpen.value = true;
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
const enabled = computed(() => models.value.filter((m) => m.enabled));
const estimate = computed(() => selected.value.length + 1);
const snapshot = computed(() => detail.value?.securitySnapshots[0]);
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
function displayStatus(task: TaskDetail) {
  return task.status === "partial" &&
    !task.reports.some((r) => (r.validation as any)?.valid === true)
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
  news: "新闻",
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
function watchTask(task: TaskDetail) {
  setupCollapsed.value = true;
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
    if (!disposed) watchTask(task);
  } catch (e) {
    if (!disposed) {
      error.value = aiErrorMessage(e);
      setupCollapsed.value = false;
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
  try {
    const task = await invoke<TaskDetail>("ai_resummarize_stock", {
      taskId: detail.value.id,
      summaryModelId: summary.value,
    });
    if (!disposed) watchTask(task);
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
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
    emit("close");
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
          v-if="desktop"
          :aria-expanded="recycleOpen"
          @click="recycleOpen = !recycleOpen"
        >
          回收站
        </button>
        <button class="ai-close" @click="emit('close')">关闭</button>
      </header>
      <div class="ai-drawer-scroll">
        <p v-if="!desktop" class="ai-message">
          浏览器预览仅展示入口；请在桌面应用中运行分析。
        </p>
        <p v-if="error" role="alert" class="ai-message ai-error">{{ error }}</p>
        <ReportRecycleBin
          v-if="desktop && recycleOpen"
          @changed="recycleChanged"
        />
        <ReportConfirm
          v-if="deletePending && detail"
          title="将报告移入回收站？"
          :message="`${security.name} · ${date(detail.createdAt)}。本报告、全部独立输出与汇总版本将移入回收站，可恢复；不影响账户成交和模型配置。${detail.requestSnapshot.group ? '此操作影响整批 ' + detail.requestSnapshot.securities.length + ' 只证券。' : ''}`"
          confirm-label="移入回收站"
          :error="error"
          :busy="loading"
          @confirm="moveToTrash"
          @cancel="deletePending = false"
        />
        <section v-if="detail" class="ai-report-toolbar">
          <button
            @click="
              setupCollapsed = false;
              root
                ?.querySelector('.ai-analysis-setup')
                ?.scrollIntoView({ block: 'start' });
            "
          >
            模型与资料
          </button>
          <button
            :disabled="active || loading || !!detail.parentId"
            @click="deletePending = true"
          >
            删除报告
          </button>
          <div class="ai-report-state">
            <strong>{{ displayStatus(detail) }}</strong
            ><small
              >{{ validReports.length }}/{{
                detail.requestSnapshot.participantIds.length
              }}
              份有效独立报告</small
            ><ReportTooltip
              label="报告完成状态"
              text="完成状态表示分析流程是否结束；报告中的趋势与操作建议仍是模型判断。部分完成时请查看下方执行错误。"
            />
          </div>
          <label v-if="history.length"
            >历史报告<select
              aria-label="历史报告"
              :value="detail.id"
              :disabled="active || loading"
              @change="
                watchTask(
                  history.find(
                    (t) => t.id === ($event.target as HTMLSelectElement).value,
                  )!,
                )
              "
            >
              <option v-for="t in history" :key="t.id" :value="t.id">
                {{ date(t.createdAt) }} · {{ displayStatus(t) }}
              </option>
            </select></label
          >
          <button
            v-if="historyCursor"
            :disabled="active || loading"
            @click="refreshHistory(true)"
          >
            加载更多历史报告
          </button>
          <p v-if="invalidReportCount" class="ai-error">
            已收到 {{ detail.reports.length }} 份输出，{{ invalidReportCount }}
            份未通过校验，未用于汇总。
          </p>
          <p v-for="(e, i) in detail.errors" :key="i" class="ai-error">
            {{ e.message }}
          </p>
        </section>

        <section
          v-if="isV2 && !executionPlan && (currentSummary || independentView)"
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
          :key="currentSummary?.id ?? independentView?.id"
          :plan="executionPlan"
        />
        <details v-if="snapshot" class="ai-report-context" :open="active">
          <summary>
            账户与资料依据 · 持仓 {{ frozenPosition?.quantity ?? "未提供" }} ·
            摊薄成本 {{ frozenPosition?.dilutedCost ?? "—" }} · 余额
            {{ frozenCash ? money(frozenCash.balance) : "未知" }}
          </summary>
          <p v-if="!isV2" class="ai-data-gap">
            旧版报告，未包含本机账本资金依据；重新分析后生成五类操作建议。旧版中短线不等于1～3个月中长期。
          </p>
          <section
            v-if="frozenPosition || frozenCash"
            class="ai-frozen-account"
          >
            <h3>本次建议使用的账户依据</h3>
            <div class="ai-account-metrics">
              <div>
                <small>持仓 / 可卖</small
                ><strong
                  >{{ frozenPosition?.quantity ?? "0" }} /
                  {{ frozenPosition?.available ?? "0" }}</strong
                ><span>{{ frozenPosition?.settlement ?? "未持仓" }}</span>
              </div>
              <div>
                <small>FIFO均价</small
                ><strong>{{ frozenPosition?.averageCost ?? "—" }}</strong>
              </div>
              <div>
                <small>摊薄成本</small
                ><strong>{{ frozenPosition?.dilutedCost ?? "—" }}</strong>
              </div>
              <div>
                <small
                  >本机账本余额<ReportTooltip
                    label="本机账本余额"
                    text="由冻结时点的期初资金、成交收支和资金流水计算，未经券商实时可用资金核验；历史报告不会随新交易更新。" /></small
                ><strong>{{
                  frozenCash ? money(frozenCash.balance) : "未提供"
                }}</strong>
              </div>
            </div>
            <p
              v-if="
                frozenCash &&
                (!frozenCash.initialized ||
                  frozenCash.hasWarnings ||
                  Number(frozenCash.balance) < 0)
              "
              class="ai-data-gap"
            >
              资金能力待核实：账本未初始化、负余额或存在资金异常，不形成买入/加仓与做
              T 买回方案。
            </p>
            <details v-if="frozenPosition">
              <summary>
                本股持仓与本轮交易 · {{ frozenPosition.trades?.length ?? 0 }} 笔
              </summary>
              <p>
                本轮起于
                {{ date(frozenPosition.roundStart) }}；与余额同一截止时间。
              </p>
              <div class="ai-trend-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>价格</th>
                      <th>费用</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="t in frozenPosition.trades" :key="t.id">
                      <td>{{ date(t.time) }}</td>
                      <td>
                        {{
                          { buy: "买入", sell: "卖出", opening: "期初持仓" }[
                            t.kind as string
                          ] ?? t.kind
                        }}
                      </td>
                      <td>{{ t.quantity }}</td>
                      <td>{{ t.price }}</td>
                      <td>{{ t.fees?.total ?? "未知" }}</td>
                      <td>{{ t.note }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <p>
            <strong>{{ todayLabel }}</strong> · 报告参考价
            {{ snapshot.referencePrice ?? "不可用" }} · 数据截止
            {{ date(snapshot.cutoffAt)
            }}<ReportTooltip
              label="报告数据时间"
              text="报告基于采集后冻结保存的资料。打开历史或重新汇总不会把报价与持仓更新到当前时间。行情数据本身也可能延迟。"
            />
          </p>
          <p class="ai-data-gap">
            新闻正文未自动获取；公告仅标题和链接。<span
              v-if="missingSources.length"
              >另缺少：{{ missingSources.join("、") }}。</span
            >
          </p>
          <p v-if="positionContext && !heldSnapshot" class="ai-data-gap">
            这份历史报告未包含持仓资料。重新分析后可生成五类操作建议。
          </p>
        </details>
        <section
          v-if="!currentSummary && independentView && isV2"
          class="ai-settings-card"
        >
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
          <ReportOperations :claims="independentView.claims"
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
        </section>
        <section v-if="currentSummary" class="ai-settings-card ai-summary-card">
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
            >{{ currentSummary.summaryModelSnapshot.displayName }} · 汇总 v{{
              currentSummary.version
            }}</small
          >
          <p v-if="validReports.length === 1" class="ai-data-gap">
            仅有一个有效独立模型，本次汇总不代表多模型共识。
          </p>
          <p v-if="active" class="ai-data-gap">
            正在生成新的汇总，下方仍是已保存版本。
          </p>
          <p v-if="!isV2" class="ai-prose">
            {{ (currentSummary.windows as any).overview }}
          </p>
          <ReportOperations v-if="isV2" :claims="currentSummary.keyClaims"
            ><template #evidence="{ claim }"
              ><small>{{ agreement(claim) }}</small>
              <article
                v-for="row in supportRows(claim)"
                :key="row.report!.id"
                class="ai-model-support"
              >
                <strong>{{ row.report!.modelSnapshot.displayName }}</strong>
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
                {{ strategyLabels[claim.strategy] ?? "关键判断 " + (i + 1) }}
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
                  <strong>{{ row.report!.modelSnapshot.displayName }}</strong
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
                          availabilityLabels[e.availability] ?? e.availability
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
            <p v-for="(d, i) in arr(currentSummary.disagreements)" :key="i">
              {{ d }}
            </p>
          </div>
        </section>
        <section
          v-if="validReports.length"
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
          class="ai-settings-card ai-model-report"
        >
          <details>
            <summary>
              <strong>{{ report.modelSnapshot.displayName }} · 独立报告</strong
              ><small
                >{{ report.modelSnapshot.model }} ·
                {{
                  (report.validation as any).valid
                    ? "引用校验通过"
                    : "校验失败，未进入汇总"
                }}</small
              ><ReportTooltip
                label="引用校验"
                text="校验检查输出结构、引用标识、时间窗口和持仓建议必填条件；不表示观点正确、预测会兑现或交易能够获利。"
              />
            </summary>
            <p class="ai-prose">{{ overview(report) }}</p>
            <ReportOperations
              v-if="(report.validation as any).reportVersion === 2"
              :claims="report.claims"
            />
            <article
              v-for="w in arr(report.windows)"
              :key="w.horizon"
              class="ai-report-window"
            >
              <h4>
                {{ w.horizon === "today" ? todayLabel : "未来 1～5 个交易日" }}
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
                    output.role === "independent" ? "首次输出" : "格式修复输出"
                  }}
                  · {{ output.validation.valid ? "校验通过" : "未通过校验" }}
                </summary>
                <p v-if="output.validation.error">
                  {{ output.validation.error }}
                </p>
                <pre>{{ output.rawOutput }}</pre>
              </details>
            </template>
            <details v-else class="ai-raw-output">
              <summary>模型原始输出 · JSON</summary>
              <pre>{{ report.rawOutput }}</pre>
            </details>
          </details>
        </section>
        <section v-if="snapshot" class="ai-settings-card ai-source-details">
          <details>
            <summary>
              资料与时间窗口
              <small
                >{{ snapshot.evidence.length }} 项资料 ·
                {{ heldSnapshot ? "含持仓与本轮交易" : "未包含持仓" }}</small
              >
            </summary>
            <p>
              数据截止 {{ date(snapshot.cutoffAt) }} · 参考价格
              {{ snapshot.referencePrice ?? "不可用" }}
            </p>
            <p>
              {{
                (snapshot.windows as any).todayMode === "review"
                  ? "今日已收盘：复盘已发生走势"
                  : (snapshot.windows as any).todayMode === "nonTradingDay"
                    ? "今日休市：不预测今日收盘"
                    : "预测从数据截止到今日收盘"
              }}；未来窗口：{{
                arr((snapshot.windows as any).futureDates).join("、")
              }}
            </p>
            <dl>
              <template
                v-for="(state, name) in snapshot.sourceStates as any"
                :key="name"
                ><dt>{{ sourceLabels[String(name)] ?? name }}</dt>
                <dd>{{ sourceState(state) }}</dd></template
              >
            </dl>
            <p>
              手动资料与账本记录未经独立核验。公告正文未读取，标题不等同于正文依据。
            </p>
            <details
              v-for="e in snapshot.evidence"
              :key="e.id"
              class="ai-evidence"
            >
              <summary>
                {{
                  e.kind === "position" ? "当时的持仓与本轮交易记录" : e.source
                }}
                · {{ availabilityLabels[e.availability] ?? e.availability }}
              </summary>
              <a
                v-if="e.url?.startsWith('https://')"
                :href="e.url"
                @click.prevent="openSource(e.url)"
                target="_blank"
                rel="noopener noreferrer"
                >查看来源</a
              >
              <pre>{{ e.content }}</pre>
            </details>
          </details>
        </section>
        <section
          v-if="detail"
          class="ai-settings-card ai-execution-trace"
          aria-label="分析执行过程"
        >
          <details :open="active">
            <summary>
              分析过程
              <small
                >{{ active ? "正在执行" : displayStatus(detail) }} ·
                {{ attemptedCalls }} 次模型调用</small
              >
            </summary>
            <p class="ai-muted">数据采集、模型请求与校验的真实执行记录。</p>
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
            <details v-if="callRows.length">
              <summary>模型调用明细 · {{ attemptedCalls }} 次尝试</summary>
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
                      ? "接口已响应，等待生成/接收完整报告"
                      : call.phase === "responseComplete"
                        ? "完整响应已接收"
                        : "阶段：" + call.phase
                }}
                · {{ date(call.at) }}
              </p>
            </details>
          </details>
        </section>
        <section class="ai-settings-card ai-analysis-setup">
          <div class="ai-setup-header">
            <h3>分析设置</h3>
            <button
              :aria-label="setupCollapsed ? '展开模型与资料' : '收起模型与资料'"
              :aria-expanded="!setupCollapsed"
              @click="setupCollapsed = !setupCollapsed"
            >
              {{ setupCollapsed ? "展开" : "收起" }}
            </button>
          </div>
          <p v-if="setupCollapsed" class="ai-setup-compact">
            {{ selected.length }} 个独立模型 · 汇总：{{ modelName(summary) }} ·
            预计 {{ estimate }} 次调用 <small>重试可能增加次数</small>
          </p>
          <div v-show="!setupCollapsed" class="ai-setup-body">
            <div class="ai-execution-policy">
              <label
                >被套处理偏好<select
                  v-model="executionPolicy.preference"
                  :disabled="active"
                >
                  <option value="tFirst">保留底仓，优先做 T</option>
                  <option value="riskFirst">优先减仓控风险</option>
                  <option value="averageDown">有条件评估加仓</option>
                </select></label
              ><label
                >保留底仓 %<input
                  v-model.number="executionPolicy.reservePercent"
                  type="number"
                  min="0"
                  max="100"
                  :disabled="active" /></label
              ><label
                >单轮做 T 上限 %<input
                  v-model.number="executionPolicy.tPercent"
                  type="number"
                  min="1"
                  max="100"
                  :disabled="active"
              /></label>
            </div>
            <p>
              自动获取行情、分时、日线、主力资金流和公告列表。新闻与公告正文需手动补充；未取得的资料会在报告中明确标示。
            </p>
            <p v-if="desktop && !enabled.length">
              请先在设置中配置并启用模型。
            </p>
            <div
              v-if="cashContext && !positionContext"
              class="ai-position-context"
            >
              <label
                ><input
                  type="checkbox"
                  v-model="includePosition"
                  :disabled="active || loading"
                />结合本机账本余额</label
              >
              <p>
                本机账本余额
                {{ money(cashContext.balance) }}
                元。未持仓时不假设底仓，将发送余额与质量摘要给所选模型。
              </p>
            </div>
            <div v-if="cashContext && positionContext" class="ai-data-gap">
              将同步发送本机账本余额
              {{ money(cashContext.balance) }}
              元及资金质量摘要。取消包含账户资料时不会发送余额。
            </div>
            <div v-if="positionContext" class="ai-position-context">
              <label
                ><input
                  type="checkbox"
                  v-model="includePosition"
                  :disabled="active || loading"
                />结合持仓、本轮交易与本机账本余额</label
              >
              <p>
                持仓 {{ positionContext.quantity }}
                {{ security.asset === "etf" ? "份" : "股" }} · 可卖
                {{ positionContext.available }}
                {{ security.asset === "etf" ? "份" : "股" }} · FIFO均价
                {{ positionContext.averageCost ?? "未知"
                }}<ReportTooltip
                  label="FIFO均价"
                  text="按先进先出顺序计算剩余持仓成本，含账本已记录费用。卖出收益不会直接摊入该均价。"
                />
                · 摊薄成本 {{ positionContext.dilutedCost ?? "未知"
                }}<ReportTooltip
                  label="摊薄成本"
                  text="本轮净投入除以当前持仓数量，会受到本轮卖出回款的影响；并不等于下一笔交易扣费后的保本价。"
                />
                ·
                {{ positionContext.settlement }}
              </p>
              <p>
                本轮起于 {{ date(positionContext.roundStart) }}，共
                {{ positionContext.trades.length }}
                笔记录。将向所选独立模型与汇总模型发送本股持仓、交易、费用及备注，并随报告本地保存。
              </p>
              <details>
                <summary>查看将发送的持仓资料</summary>
                <pre>{{ JSON.stringify(positionContext, null, 2) }}</pre>
              </details>
            </div>
            <p>
              同时生成今日、本周、稳健、短期/做 T
              和1～3个月中长期五类操作建议，分别展示动作、条件和数量/资金依据。
            </p>
            <div class="ai-default-list">
              <label v-for="m in enabled" :key="m.id" class="ai-check"
                ><input
                  type="checkbox"
                  v-model="selected"
                  :value="m.id"
                  :disabled="active || loading"
                />{{ m.displayName }} <small>{{ m.model }}</small></label
              >
            </div>
            <label
              >本次汇总模型<select
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
            <label
              >手动补充新闻、公告或分析资料<textarea
                v-model="manual"
                aria-label="补充分析资料"
                maxlength="10000"
                :disabled="active || loading"
                rows="3"
                placeholder="粘贴资料文字，建议包含日期和来源链接。不要粘贴密钥。"
              />
            </label>
            <p class="ai-source-links">
              <a
                :href="newsUrl"
                @click.prevent="openSource(newsUrl)"
                target="_blank"
                rel="noopener noreferrer"
                >新闻来源</a
              ><a
                :href="announcementUrl"
                @click.prevent="openSource(announcementUrl)"
                target="_blank"
                rel="noopener noreferrer"
                >公告来源</a
              ><button @click="emit('settings')" :disabled="active">
                模型设置
              </button>
            </p>
            <p>
              单次最多选择 20 个模型；预计调用 {{ estimate }} 次（{{
                selected.length
              }}
              次独立分析 + 1 次汇总）。失败重试与格式修复可能增加到
              {{ selected.length * 3 + 2 }} 次；每次最多生成 8192
              token，可能计费。临时选择不会修改默认配置。
            </p>
          </div>
          <div class="ai-form-actions">
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
              {{
                active ? "分析进行中" : detail ? "重新分析" : "开始分析"
              }}</button
            ><ReportTooltip
              label="重新分析"
              text="重新采集行情和当前勾选的持仓资料，再调用独立模型和汇总模型生成新报告。会产生新的API调用费用。"
            /><button v-if="active" @click="cancel">取消分析</button
            ><button
              v-if="validReports.length"
              :disabled="active || loading || !summary"
              @click="resummarize"
            >
              重新汇总 · 预计 1 次</button
            ><ReportTooltip
              v-if="validReports.length"
              label="重新汇总"
              text="使用这份历史报告已保存的资料和独立模型报告，只重新调用汇总模型。不会读取最新行情或最新持仓；如需更新资料，请重新分析。"
            />
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>
<style scoped>
.ai-stock-drawer {
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
</style>

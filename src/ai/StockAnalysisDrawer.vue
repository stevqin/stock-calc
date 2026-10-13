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
import type { PositionContext } from "./positionContext";
const props = defineProps<{
  security: SecurityRef;
  positionContext?: PositionContext | null;
}>();
const includePosition = ref(true);
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
async function refreshHistory() {
  if (!desktop) return;
  const page = await listHistory({ securityId: props.security.id, limit: 30 });
  if (!disposed) history.value = page.items;
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
  if (
    ["pending", "collecting", "analyzing", "summarizing"].includes(task.status)
  )
    setupCollapsed.value = true;
  stop();
  detail.value = task;
  summaryId.value = "";
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
      },
      manualMaterial: manual.value,
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
    ];
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
        <button class="ai-close" @click="emit('close')">关闭</button>
      </header>
      <div class="ai-drawer-scroll">
        <p v-if="!desktop" class="ai-message">
          浏览器预览仅展示入口；请在桌面应用中运行分析。
        </p>
        <p v-if="error" role="alert" class="ai-message ai-error">{{ error }}</p>
        <section class="ai-settings-card ai-analysis-setup">
          <div class="ai-setup-header">
            <h3>分析模型与资料</h3>
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
            <p>
              自动获取行情、分时、日线、主力资金流和公告列表。新闻与公告正文需手动补充；未取得的资料会在报告中明确标示。
            </p>
            <p v-if="desktop && !enabled.length">
              请先在设置中配置并启用模型。
            </p>
            <div v-if="positionContext" class="ai-position-context">
              <label
                ><input
                  type="checkbox"
                  v-model="includePosition"
                  :disabled="active || loading"
                />结合持仓与本轮交易记录</label
              >
              <p>
                持仓 {{ positionContext.quantity }} 股 · 可卖
                {{ positionContext.available }} 股 · FIFO均价
                {{ positionContext.averageCost ?? "未知" }} · 摊薄成本
                {{ positionContext.dilutedCost ?? "未知" }} ·
                {{ positionContext.settlement }}
              </p>
              <p>
                本轮起于 {{ date(positionContext.roundStart) }}，共
                {{
                  positionContext.trades.length
                }}
                笔记录。将向所选独立模型与汇总模型发送本股持仓、交易、费用及备注，并随报告本地保存。
              </p>
              <details>
                <summary>查看将发送的持仓资料</summary>
                <pre>{{ JSON.stringify(positionContext, null, 2) }}</pre>
              </details>
            </div>
            <p>
              结合持仓资料时，同时分析稳健持仓、做
              T、中短线三种操作方向，分别给出条件与依据。
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
            ><button v-if="active" @click="cancel">取消分析</button
            ><button
              v-if="validReports.length"
              :disabled="active || loading || !summary"
              @click="resummarize"
            >
              重新汇总 · 预计 1 次
            </button>
          </div>
        </section>
        <section
          v-if="history.length"
          class="ai-settings-card ai-analysis-history"
        >
          <h3>历史报告</h3>
          <select
            aria-label="历史报告"
            :value="detail?.id"
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
              {{ date(t.createdAt) }} · {{ status[t.status] }}
            </option></select
          ><small
            >打开历史不会调用模型；关闭抽屉后任务继续运行，报告长期保存在本机。</small
          >
        </section>
        <section
          v-if="detail"
          class="ai-settings-card ai-execution-trace"
          aria-label="分析执行过程"
        >
          <div class="ai-trace-header">
            <h3>分析过程</h3>
            <small>执行记录 · 数据工具、模型调用与校验</small>
          </div>
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
                  : "已收到服务商响应"
              }}
              · {{ date(call.at) }}
            </p>
          </details>
        </section>
        <section v-if="detail" class="ai-analysis-status">
          <strong>{{ status[detail.status] }}</strong
          ><span
            >已发起 {{ attemptedCalls }} 次模型调用 ·
            {{ detail.reports.length }}/{{
              detail.requestSnapshot.participantIds.length
            }}
            份独立报告</span
          >
          <p v-for="(e, i) in detail.errors" :key="i" class="ai-error">
            {{ e.message }}
          </p>
        </section>
        <section v-if="snapshot" class="ai-settings-card">
          <h3>冻结数据与预测窗口</h3>
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
          <details>
            <summary>数据来源与完整性</summary>
            <dl>
              <template
                v-for="(state, name) in snapshot.sourceStates as any"
                :key="name"
                ><dt>{{ sourceLabels[String(name)] ?? name }}</dt>
                <dd>{{ sourceState(state) }}</dd></template
              >
            </dl>
            <p>
              新闻正文未自动采集；公告目前只读取列表与链接。手动资料未经独立核验，置信等级是模型判断，尚未经统计校准。
            </p>
            <details v-for="e in snapshot.evidence" :key="e.id">
              <summary>
                {{ e.source }} · {{ e.kind }} ·
                {{ availabilityLabels[e.availability] ?? e.availability }}
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
          <p v-if="validReports.length === 1">
            仅有一个有效独立模型；本次汇总不代表多模型共识。
          </p>
          <p class="ai-prose">{{ (currentSummary.windows as any).overview }}</p>
          <details
            v-for="(claim, i) in arr(currentSummary.keyClaims)"
            :key="i"
            class="ai-claim"
          >
            <summary>
              {{
                strategyLabels[claim.strategy]
                  ? strategyLabels[claim.strategy] + " · "
                  : ""
              }}{{ claim.text }}<small>{{ agreement(claim) }}</small>
            </summary>
            <article v-for="row in supportRows(claim)" :key="row.report!.id">
              <strong>{{ row.report!.modelSnapshot.displayName }}</strong>
              <p>{{ row.original.text }}</p>
              <details>
                <summary>引用资料</summary>
                <pre
                  v-for="e in snapshot?.evidence.filter((e) =>
                    arr(row.original.evidenceIds).includes(e.id),
                  )"
                  :key="e.id"
                  >{{ e.source }} · {{
                    availabilityLabels[e.availability] ?? e.availability
                  }}
{{ e.content }}</pre>
              </details>
            </article>
          </details>
          <div v-if="arr(currentSummary.disagreements).length">
            <h4>模型分歧</h4>
            <p v-for="(d, i) in arr(currentSummary.disagreements)" :key="i">
              {{ d }}
            </p>
          </div>
        </section>
        <section
          v-for="report in detail?.reports"
          :key="report.id"
          class="ai-settings-card"
        >
          <h3>{{ report.modelSnapshot.displayName }} · 独立分析</h3>
          <small
            >{{ report.modelSnapshot.model }} ·
            {{
              (report.validation as any).valid
                ? "结构与引用校验通过"
                : "输出校验失败，不进入汇总"
            }}</small
          >
          <p class="ai-prose">{{ overview(report) }}</p>
          <article
            v-for="w in arr(report.windows)"
            :key="w.horizon"
            class="ai-report-window"
          >
            <h4>
              {{ w.horizon === "today" ? "今日窗口" : "未来 1～5 个交易日" }} ·
              {{ direction[w.direction] }}
              <small>置信等级：{{ confidence[w.confidence] }}</small>
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
            <p>触发条件：{{ c.trigger }}</p>
            <p>失效条件：{{ c.invalidation }}</p>
            <p>数量依据：{{ c.quantityBasis }}；费用影响：{{ c.feeImpact }}</p>
          </article>
          <details>
            <summary>模型原始输出</summary>
            <pre>{{ report.rawOutput }}</pre>
          </details>
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
</style>

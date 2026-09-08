<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, emitTo, type UnlistenFn } from "@tauri-apps/api/event";
import { signed, statusTone, type StatusSnapshot } from "./statusBar";
const snapshot = ref<StatusSnapshot>();
const error = ref("");
const editing = ref(false);
const activeIndex = ref<number | null>(null);
const paused = ref<boolean | null>(null);
const changingPause = ref(false);
const drafts = reactive<Record<string, string>>({});
function toggleEditing() {
  if (!editing.value) {
    for (const id of Object.keys(drafts)) delete drafts[id];
    for (const row of snapshot.value?.holdings ?? [])
      drafts[row.id] = row.shortName;
  }
  editing.value = !editing.value;
}
let stop: UnlistenFn | undefined;
let stopActive: UnlistenFn | undefined;
let disposed = false;
async function close() {
  await invoke("hide_status_panel");
}
async function openMain() {
  try {
    await invoke("open_status_main");
  } catch {
    error.value = "主界面暂时无法打开，请重试";
  }
}
async function togglePause() {
  if (paused.value === null || changingPause.value) return;
  changingPause.value = true;
  try {
    paused.value = await invoke<boolean>("set_status_paused", {
      paused: !paused.value,
    });
  } catch {
    error.value = "滚动状态更新失败，请重试";
  } finally {
    changingPause.value = false;
  }
}
async function quit() {
  try {
    await invoke("exit_status_app");
  } catch {
    error.value = "退出失败，请重试";
  }
}
async function alias(id: string, event: Event) {
  try {
    await emitTo("main", "status-alias", {
      id,
      name: (event.target as HTMLInputElement).value,
    });
  } catch {
    error.value = "简称更新失败，请重试";
  }
}
function keys(event: KeyboardEvent) {
  if (event.key === "Escape") void close();
}
onMounted(async () => {
  document.addEventListener("keydown", keys);
  try {
    let receivedActive = false;
    stopActive = await listen<number>("status-active-index", ({ payload }) => {
      receivedActive = true;
      activeIndex.value = payload;
    });
    if (disposed) {
      stopActive();
      return;
    }
    const initialIndex = await invoke<number>("get_status_active_index");
    if (!receivedActive) activeIndex.value = initialIndex;
    let received = false;
    stop = await listen<StatusSnapshot>("status-portfolio", ({ payload }) => {
      received = true;
      snapshot.value = payload;
    });
    if (disposed) {
      stop();
      return;
    }
    const initial = await invoke<StatusSnapshot | null>("get_status_portfolio");
    if (!received && initial) snapshot.value = initial;
    paused.value = await invoke<boolean>("get_status_paused");
  } catch {
    error.value = "持仓数据暂时不可用，请打开主窗口检查";
  }
});
onBeforeUnmount(() => {
  disposed = true;
  stop?.();
  stopActive?.();
  document.removeEventListener("keydown", keys);
});
</script>

<template>
  <main class="status-panel">
    <header class="panel-header">
      <h1>
        我的持仓<span class="header-date"
          >（{{ snapshot?.date ?? "等待数据" }}）</span
        ><span class="header-count">{{ snapshot?.holdings.length ?? 0 }}</span>
      </h1>
      <button class="edit-alias" @click="toggleEditing">
        {{ editing ? "完成" : "编辑" }}
      </button>
    </header>
    <p v-if="error" role="alert" class="panel-error">{{ error }}</p>
    <div class="holdings-scroll">
      <table aria-label="菜单栏持仓列表">
        <colgroup>
          <col style="width: 30%" />
          <col style="width: 18%" />
          <col style="width: 26%" />
          <col style="width: 26%" />
        </colgroup>
        <thead>
          <tr>
            <th>股票名称</th>
            <th>现价</th>
            <th class="group-start">当日收益</th>
            <th class="group-start" title="与主界面的本轮持仓盈亏一致">
              持仓盈亏
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in snapshot?.holdings"
            :key="row.id"
            :class="{ 'is-active': activeIndex === index }"
            :aria-current="activeIndex === index ? 'true' : undefined"
          >
            <td>
              <strong :title="`${row.name} · ${row.id.toUpperCase()}`"
                >{{ row.name }}<span v-if="row.stale"> *</span></strong
              >
              <small class="stock-code">{{ row.id.toUpperCase() }}</small>
              <label v-if="editing" class="alias-label"
                >简称<input
                  :aria-label="`${row.name}的菜单栏简称`"
                  :value="drafts[row.id] ?? row.shortName"
                  @input="
                    drafts[row.id] = ($event.target as HTMLInputElement).value
                  "
                  maxlength="12"
                  placeholder="留空恢复自动"
                  @change="alias(row.id, $event)"
              /></label>
            </td>
            <td :class="statusTone(row.change)">
              <span
                class="profit-amount"
                aria-label="当前股价"
                :title="row.price ?? '—'"
                >{{ row.price ?? "—" }}</span
              >
              <small
                class="return-rate"
                :class="statusTone(row.change)"
                aria-label="涨跌幅"
                >{{ signed(row.change) }}</small
              >
            </td>
            <td class="group-start">
              <span
                class="profit-amount"
                :class="statusTone(row.profit)"
                :title="signed(row.profit, true)"
                >{{ signed(row.profit, true) }}</span
              >
              <small
                class="return-rate"
                :class="statusTone(row.dailyPercent)"
                :title="signed(row.dailyPercent)"
                aria-label="当日收益率"
                >{{ signed(row.dailyPercent) }}</small
              >
            </td>
            <td class="group-start">
              <span
                class="profit-amount"
                :class="statusTone(row.holdingProfit)"
                :title="signed(row.holdingProfit, true)"
                >{{ signed(row.holdingProfit, true) }}</span
              >
              <small
                class="return-rate"
                :class="statusTone(row.holdingPercent)"
                :title="signed(row.holdingPercent)"
                aria-label="持仓收益率"
                >{{ signed(row.holdingPercent) }}</small
              >
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="snapshot && !snapshot.holdings.length" class="panel-empty">
        暂无持仓
      </p>
      <p v-if="!snapshot && !error" class="panel-empty">正在获取持仓…</p>
    </div>
    <section v-if="snapshot" class="panel-total" aria-label="当日汇总">
      <div>
        <strong>今日合计</strong
        ><small
          >含当日已清仓收益<span v-if="snapshot.total.stale"> *</span></small
        >
      </div>
      <b :class="statusTone(snapshot.total.percent)">{{
        signed(snapshot.total.percent)
      }}</b>
      <b :class="statusTone(snapshot.total.profit)">{{
        signed(snapshot.total.profit, true)
      }}</b>
    </section>
    <footer>
      <button class="open-main" @click="openMain">打开主界面</button>
      <button
        class="pause-rotation"
        :disabled="paused === null || changingPause"
        @click="togglePause"
      >
        {{ paused ? "继续滚动" : "暂停滚动" }}
      </button>
      <button class="quit-app" @click="quit">退出</button>
    </footer>
  </main>
</template>

<style>
body.status-panel-window {
  margin: 0;
  height: 100dvh;
  overflow: hidden;
  background: transparent;
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  --header-title: #282828;
  --header-secondary: #686868;
  --table-label: #5c5c5c;
  --text-primary: #202631;
  --text-secondary: #566170;
  --text-tertiary: #626e7c;
  --muted: var(--text-secondary);
  --gain: #b52e3d;
  --loss: #176a4a;
  --gain-secondary: #9b4550;
  --loss-secondary: #3d6b57;
  --action: #245fb5;
  --line: rgba(90, 100, 115, 0.085);
  --wash: rgba(255, 255, 255, 0.08);
  --hover: rgba(255, 255, 255, 0.55);
}
.status-panel-window #app {
  height: 100%;
  overflow: hidden;
}
.status-panel {
  box-sizing: border-box;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.48);
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.1),
    rgba(245, 247, 252, 0.02) 48%,
    rgba(255, 255, 255, 0.08)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    inset 0 -1px 0 rgba(255, 255, 255, 0.25);
}
.status-panel * {
  box-sizing: border-box;
}
.status-panel button {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  padding: 6px 10px;
  border-radius: 999px;
}
.status-panel button:hover {
  background: var(--hover);
  border-color: rgba(255, 255, 255, 0.4);
}
.status-panel button:focus-visible,
.status-panel input:focus-visible {
  outline: 2px solid var(--action);
  outline-offset: -2px;
}
.status-panel button:disabled {
  opacity: 0.45;
  cursor: default;
}
.panel-header,
.panel-total,
.status-panel footer {
  flex-shrink: 0;
}
.panel-header {
  height: 44px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.panel-header h1 {
  color: var(--header-title);
  font-size: 15px;
  margin: 0;
  font-weight: 600;
  letter-spacing: -0.3px;
  display: flex;
  align-items: baseline;
  white-space: nowrap;
}
.panel-header h1 span {
  color: var(--header-secondary);
  font-size: 11px;
  margin-left: 5px;
}
.panel-header h1 .header-date {
  font-size: 10px;
  font-weight: 400;
  margin-left: 0;
}

.status-panel .edit-alias {
  font-size: 10px;
  margin-left: auto;
  color: var(--muted);
}

.holdings-scroll {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  flex: 1 1 0;
  padding: 0 4px;
}
.status-panel table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-variant-numeric: tabular-nums;
}
.status-panel th {
  position: sticky;
  top: 0;
  background: rgba(128, 128, 128, 0.045);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  color: var(--table-label);
  font-size: 10px;
  font-weight: 500;
  padding: 7px 4px;
  text-align: right;
  z-index: 1;
}
.status-panel th:first-child,
.status-panel td:first-child {
  text-align: left;
}
.status-panel td {
  height: 36px;
  padding: 0 4px;
  line-height: 16px;
  border-bottom: 1px solid rgba(90, 100, 115, 0.04);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
}
.status-panel tbody tr.is-active {
  background: rgba(0, 122, 255, 0.12);
  box-shadow: inset 2px 0 0 rgba(0, 122, 255, 0.6);
}
.status-panel td strong {
  display: block;
  font-size: 11px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-panel small {
  display: block;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 4px;
}
.status-panel td .profit-amount {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-panel td .return-rate,
.status-panel td .stock-code {
  font-size: 9px;
  line-height: 12px;
  margin-top: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-panel .up {
  color: var(--gain);
}
.status-panel .down {
  color: var(--loss);
}
.status-panel .flat {
  color: var(--muted);
}
.status-panel .return-rate.up,
.panel-total b:first-of-type.up {
  color: var(--gain-secondary);
}
.status-panel .return-rate.down,
.panel-total b:first-of-type.down {
  color: var(--loss-secondary);
}
.status-panel td strong,
.panel-total strong {
  color: var(--text-primary);
}
.status-panel .stock-code {
  color: var(--text-tertiary);
}
.panel-header h1 .header-date {
  color: var(--header-secondary);
}
.status-panel .edit-alias {
  color: var(--header-secondary);
}
.status-panel .quit-app {
  color: var(--text-secondary);
}
.alias-label input {
  color: var(--text-primary);
}
.panel-total {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 8px;
  margin: 10px 8px 0;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 12px;
  padding: 11px 10px;
  align-items: center;
  border-top: 1px solid var(--line);
  background: var(--wash);
  font-variant-numeric: tabular-nums;
}
.panel-total > div {
  grid-row: 1 / 3;
}
.panel-total b:first-of-type {
  grid-column: 2;
  grid-row: 2;
  font-size: 10px;
  font-weight: 500;
}
.panel-total b:last-of-type {
  grid-column: 2;
  grid-row: 1;
}
.panel-total b {
  text-align: right;
  font-size: 13px;
  font-weight: 600;
}
.status-panel footer {
  display: flex;
  justify-content: space-between;
  padding: 9px 8px;
  font-size: 11px;
}
.status-panel .open-main {
  color: var(--action);
  background: var(--wash);
}
.panel-empty,
.panel-error {
  padding: 24px 16px;
  margin: 0;
  color: var(--muted);
  text-align: center;
}
.panel-error {
  color: var(--gain);
}
.alias-label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 10px;
  line-height: 24px;
  padding-bottom: 4px;
}
.alias-label input {
  width: 50px;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid var(--line);
  border-radius: 5px;
  font: inherit;
  color: var(--text-primary);
  background: var(--wash);
}
@media (prefers-color-scheme: dark) {
  body.status-panel-window {
    --header-title: #f0f0f0;
    --header-secondary: #b5b5b5;
    --table-label: #c2c2c2;
    --text-primary: #fafbfe;
    --text-secondary: #d2d9e3;
    --text-tertiary: #a9b4c3;
    --gain: #ff8790;
    --loss: #75d5ad;
    --gain-secondary: #f3a2a9;
    --loss-secondary: #9aceb8;
    --action: #91bfff;
    --line: rgba(255, 255, 255, 0.09);
    --wash: rgba(255, 255, 255, 0.07);
    --hover: rgba(255, 255, 255, 0.12);
  }
  .status-panel {
    background: linear-gradient(
      145deg,
      rgba(58, 61, 70, 0.12),
      rgba(28, 30, 38, 0.05)
    );
    border-color: rgba(255, 255, 255, 0.22);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }
  .status-panel th {
    background: rgba(255, 255, 255, 0.035);
  }
}
@media (prefers-reduced-transparency: reduce) {
  .status-panel {
    background: #eef0f5;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
@media (prefers-color-scheme: dark) and (prefers-reduced-transparency: reduce) {
  .status-panel {
    background: #292c34;
  }
}
</style>

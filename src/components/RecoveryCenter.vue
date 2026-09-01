<script setup lang="ts">
import FloatingNotice from "./FloatingNotice.vue";
import { ref, onMounted } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Account } from "../sim/model";
import { upgradeAccount } from "../sim/record";
import { upgradeWorkspace } from "../sim/workspaceState";
import { replay } from "../sim/ledger";
import { exportAccount } from "../sim/repository";
const props = defineProps<{ account: Account; saving: boolean }>();
const emit = defineEmits<{ restore: [a: Account]; notice: [text: string] }>();
const rows = ref<
    {
      revision: number;
      time: string;
      trades: number;
      cash: number;
      securities: number;
    }[]
  >([]),
  error = ref(""),
  candidate = ref<Account>(),
  fileInput = ref<HTMLInputElement>();
async function load() {
  try {
    rows.value = isTauri()
      ? await invoke("list_recovery")
      : JSON.parse(
          localStorage.getItem("t-calculator.recovery.v1") || "[]",
        ).map((r: { revision: number; time: string; payload: string }) => {
          const a = JSON.parse(r.payload);
          return {
            ...r,
            trades: a.entries.length,
            cash: a.cashEntries?.length ?? 0,
            securities: a.securities.length,
          };
        });
  } catch (e) {
    error.value = String(e);
  }
}
function prepare(raw: unknown) {
  candidate.value = upgradeWorkspace(upgradeAccount(raw));
  error.value = "";
}
async function preview(revision: number) {
  try {
    const payload = isTauri()
      ? await invoke<string>("read_recovery", { revision })
      : JSON.parse(
          localStorage.getItem("t-calculator.recovery.v1") || "[]",
        ).find((r: { revision: number }) => r.revision === revision)?.payload;
    if (!payload) throw new Error("恢复点已失效");
    prepare(JSON.parse(payload));
  } catch (e) {
    error.value = String(e);
  }
}
async function importFile() {
  try {
    if (isTauri()) {
      const raw = await invoke<string | null>("read_backup");
      if (raw) prepare(JSON.parse(raw));
    } else fileInput.value?.click();
  } catch (e) {
    error.value = String(e);
  }
}
async function picked(e: Event) {
  try {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) throw new Error("文件超过16MB");
    const v = JSON.parse(await file.text());
    if (v.format !== "t-calculator-backup" || ![2, 3, 4].includes(v.version))
      throw new Error("备份格式不支持");
    prepare(v.account);
  } catch (e) {
    error.value = String(e);
  } finally {
    (e.target as HTMLInputElement).value = "";
  }
}
async function backup() {
  try {
    emit("notice", await exportAccount(props.account));
  } catch (e) {
    error.value = String(e);
  }
}
function restore() {
  if (candidate.value && !props.saving) emit("restore", candidate.value);
}
onMounted(load);
</script>
<template>
  <section class="recovery-center">
    <header>
      <div>
        <h2>备份与恢复</h2>
        <p>恢复会替换整个账户。请先核对记录数及账面资金，再确认。</p>
      </div>
      <button @click="load">刷新恢复点</button
      ><button @click="importFile">从文件恢复</button
      ><button class="primary" @click="backup">导出当前备份</button>
    </header>
    <p class="data-note">
      桌面版每次写入前保留最近20个恢复点，每日首次写入前另存独立JSON备份至应用数据目录的
      auto-backups
      文件夹。独立文件不自动清理，请定期复制到其他位置。行情缓存与草稿不在账户备份内。
    </p>
    <input ref="fileInput" type="file" accept=".json" hidden @change="picked" />
    <FloatingNotice :message="error" />
    <table>
      <thead>
        <tr>
          <th>恢复点</th>
          <th>保存时间</th>
          <th>成交 / 资金流水</th>
          <th>证券数</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.revision">
          <td>#{{ r.revision }}</td>
          <td>
            {{
              new Date(r.time).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })
            }}
          </td>
          <td>{{ r.trades }} / {{ r.cash }}</td>
          <td>{{ r.securities }}</td>
          <td><button @click="preview(r.revision)">预览恢复影响</button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!rows.length" class="table-empty">
      尚无恢复点。首次保存账户后，后续写入会保留旧修订。
    </p>
    <div
      v-if="candidate"
      class="desk-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="确认恢复账户"
    >
      <div class="desk-dialog">
        <h2>用这个恢复点替换当前账户？</h2>
        <dl class="impact-list">
          <div>
            <dt>成交记录</dt>
            <dd>
              {{ account.entries.length }} → {{ candidate.entries.length }}
            </dd>
          </div>
          <div>
            <dt>资金流水</dt>
            <dd>
              {{ account.cashEntries?.length }} →
              {{ candidate.cashEntries?.length }}
            </dd>
          </div>
          <div>
            <dt>账面资金</dt>
            <dd>{{ replay(account).cash }} → {{ replay(candidate).cash }}</dd>
          </div>
          <div>
            <dt>自选证券</dt>
            <dd>
              {{ account.workspace?.watchlist.length }} →
              {{ candidate.workspace?.watchlist.length }}
            </dd>
          </div>
        </dl>
        <p>
          当前账户会先成为新的恢复点；恢复内容包括分组与列配置，不合并交易。恢复前建议额外导出文件备份。
        </p>
        <footer>
          <button :disabled="saving" @click="candidate = undefined">取消</button
          ><button class="destructive" :disabled="saving" @click="restore">
            确认替换整个账户
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

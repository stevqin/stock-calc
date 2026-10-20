<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onBeforeUnmount } from "vue";
import { listHistory, restoreTask, purgeTask, aiErrorMessage } from "./client";
import type { TaskDetail } from "./types";
import ReportConfirm from "./ReportConfirm.vue";
import {
  reportTitle,
  reportCodes,
  reportCounts,
  reportGroups,
  reportDate,
  matchesReport,
} from "./reportLibrary";
import "./reportLibrary.css";
const search = ref<HTMLInputElement>();
const query = ref(""),
  message = ref("");
const groups = computed(() =>
  reportGroups(
    items.value.filter((t) => matchesReport(t, query.value)),
    true,
  ),
);
const emit = defineEmits<{ changed: [] }>();
const items = ref<TaskDetail[]>([]),
  cursor = ref<string | null>(null),
  busy = ref(false),
  error = ref(""),
  pending = ref<TaskDetail | null>(null);
let disposed = false;
async function load(more = false) {
  if (busy.value) return;
  message.value = "";
  busy.value = true;
  error.value = "";
  try {
    const page = await listHistory({
      trashed: true,
      limit: 30,
      ...(more && cursor.value ? { cursor: cursor.value } : {}),
    });
    if (!disposed) {
      items.value = more ? [...items.value, ...page.items] : page.items;
      cursor.value = page.nextCursor;
    }
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function restore(task: TaskDetail) {
  if (busy.value) return;
  const trigger = document.activeElement as HTMLElement | null;
  message.value = "";
  busy.value = true;
  error.value = "";
  try {
    await restoreTask(task.id);
    if (!disposed) {
      items.value = items.value.filter((t) => t.id !== task.id);
      message.value = `已恢复「${reportTitle(task)}」，可在对应股票的历史报告查看。`;
      emit("changed");
      await nextTick();
      if (
        trigger &&
        !trigger.isConnected &&
        document.activeElement === document.body
      )
        search.value?.focus();
    }
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function purge() {
  if (!pending.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const id = pending.value.id;
    await purgeTask(id);
    if (!disposed) {
      items.value = items.value.filter((t) => t.id !== id);
      pending.value = null;
      message.value = "已永久删除这份报告，无法恢复。";
      emit("changed");
    }
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) busy.value = false;
  }
}
onMounted(() => void load());
onBeforeUnmount(() => {
  disposed = true;
});
</script>
<template>
  <section class="ai-report-library ai-recycle-bin" aria-label="报告回收站">
    <p class="ai-library-intro">
      这里包含所有股票与整批报告。恢复不会重新分析，记录也不会自动清空。
    </p>
    <div class="ai-library-controls">
      <input
        ref="search"
        v-model="query"
        class="ai-library-search"
        type="search"
        aria-label="搜索回收站"
        placeholder="搜索已加载的名称、代码或日期"
      /><button class="ai-library-refresh" :disabled="busy" @click="load()">
        刷新
      </button>
    </div>
    <p v-if="message" class="ai-library-message" role="status">{{ message }}</p>
    <p v-if="error" role="alert" class="ai-library-error">{{ error }}</p>
    <p v-if="busy" class="ai-library-loaded" role="status">正在处理，请稍候…</p>
    <template v-for="group in groups" :key="group.day">
      <h4 class="ai-library-day">{{ group.day }} 删除</h4>
      <article
        v-for="task in group.items"
        :key="task.id"
        class="ai-library-card"
      >
        <div class="ai-library-card-info">
          <div class="ai-library-mainline">
            <div>
              <strong class="ai-library-title">{{ reportTitle(task) }}</strong
              ><span v-if="reportCodes(task)" class="ai-library-time">{{
                reportCodes(task)
              }}</span>
            </div>
            <span class="ai-library-status">{{
              task.requestSnapshot.group ? "整批报告" : "单股报告"
            }}</span>
          </div>
          <p class="ai-library-models">
            删除于 {{ reportDate(task.deletedAt) }}
          </p>
          <p class="ai-library-counts">
            生成于 {{ reportDate(task.createdAt) }} · {{ reportCounts(task) }}
          </p>
        </div>
        <div class="ai-library-card-footer">
          <small class="ai-library-scope">{{
            task.requestSnapshot.group
              ? "恢复或永久删除会影响整批"
              : "保留原资料、独立分析与汇总"
          }}</small>
          <div class="ai-library-actions">
            <button
              data-restore
              class="ai-library-restore"
              :disabled="busy"
              @click="restore(task)"
            >
              恢复</button
            ><button
              data-purge
              class="ai-library-purge"
              :disabled="busy"
              @click="pending = task"
            >
              永久删除
            </button>
          </div>
        </div>
      </article>
    </template>
    <div v-if="!groups.length && !busy" class="ai-library-empty">
      <strong>{{ query ? "没有匹配的报告" : "回收站为空" }}</strong>
      <p>
        {{
          query
            ? "试试其他关键词；搜索仅针对已加载记录。"
            : "移入回收站的报告会显示在这里。"
        }}
      </p>
    </div>
    <button
      v-if="cursor"
      class="ai-library-more"
      :disabled="busy"
      @click="load(true)"
    >
      加载更多已删除报告
    </button>
    <p v-if="items.length" class="ai-library-loaded">
      已加载 {{ items.length }} 份已删除报告。
    </p>
    <ReportConfirm
      v-if="pending"
      :title="'永久删除 ' + reportTitle(pending) + '？'"
      :message="
        (pending.requestSnapshot.group
          ? '将永久删除这整批报告及其子报告。'
          : '将永久删除这份报告。') +
        '原资料、独立分析和汇总版本均不可恢复；不影响账户成交与模型配置。'
      "
      confirm-label="永久删除"
      :error="error"
      :busy="busy"
      @confirm="purge"
      @cancel="pending = null"
    />
  </section>
</template>
<style scoped>
.ai-recycle-bin {
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
}
</style>

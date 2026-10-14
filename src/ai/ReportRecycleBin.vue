<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { listHistory, restoreTask, purgeTask, aiErrorMessage } from "./client";
import type { TaskDetail } from "./types";
import ReportConfirm from "./ReportConfirm.vue";
const emit = defineEmits<{ changed: [] }>();
const items = ref<TaskDetail[]>([]),
  cursor = ref<string | null>(null),
  busy = ref(false),
  error = ref(""),
  pending = ref<TaskDetail | null>(null);
let disposed = false;
async function load(more = false) {
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
  busy.value = true;
  error.value = "";
  try {
    await restoreTask(task.id);
    if (!disposed) {
      items.value = items.value.filter((t) => t.id !== task.id);
      emit("changed");
    }
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function purge() {
  if (!pending.value) return;
  busy.value = true;
  error.value = "";
  try {
    const id = pending.value.id;
    await purgeTask(id);
    if (!disposed) {
      items.value = items.value.filter((t) => t.id !== id);
      pending.value = null;
      emit("changed");
    }
  } catch (e) {
    if (!disposed) error.value = aiErrorMessage(e);
  } finally {
    if (!disposed) busy.value = false;
  }
}
function title(t: TaskDetail) {
  return t.requestSnapshot.group
    ? `${t.requestSnapshot.group.name} · 整批${t.requestSnapshot.securities.length}只`
    : (t.requestSnapshot.securities[0]?.name ?? "报告");
}
function date(v: string) {
  return new Date(v).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
onMounted(() => void load());
onBeforeUnmount(() => {
  disposed = true;
});
</script>
<template>
  <section class="ai-recycle-bin" aria-label="报告回收站">
    <div class="ai-v2-section-heading">
      <h3>报告回收站</h3>
      <button :disabled="busy" @click="load()">刷新</button>
    </div>
    <p class="ai-muted">
      恢复保留原快照、独立报告和汇总版本，不调用模型。回收站不会自动清空。
    </p>
    <p v-if="error" role="alert" class="ai-error">{{ error }}</p>
    <p v-if="!items.length && !busy">回收站为空</p>
    <article v-for="task in items" :key="task.id" class="ai-trash-row">
      <div>
        <strong>{{ title(task) }}</strong
        ><small
          >报告 {{ date(task.createdAt) }} · 删除
          {{ task.deletedAt ? date(task.deletedAt) : "时间未知" }}</small
        >
      </div>
      <div>
        <button data-restore :disabled="busy" @click="restore(task)">
          恢复</button
        ><button data-purge :disabled="busy" @click="pending = task">
          永久删除
        </button>
      </div>
    </article>
    <button v-if="cursor" :disabled="busy" @click="load(true)">加载更多</button
    ><ReportConfirm
      v-if="pending"
      :title="'永久删除 ' + title(pending) + '？'"
      :message="'将删除本报告、所有汇总版本及未被其他报告引用的资料。此操作不可恢复；不影响账户成交与模型配置。'"
      confirm-label="永久删除"
      :error="error"
      :busy="busy"
      @confirm="purge"
      @cancel="pending = null"
    />
  </section>
</template>

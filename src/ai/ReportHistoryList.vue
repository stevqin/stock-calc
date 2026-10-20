<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskDetail } from "./types";
import {
  reportTitle,
  reportModels,
  reportCounts,
  reportStatus,
  reportRunning,
  reportGroups,
  reportTime,
  matchesReport,
} from "./reportLibrary";
import "./reportLibrary.css";
const props = defineProps<{
  items: TaskDetail[];
  currentId?: string;
  busy: boolean;
  hasMore: boolean;
}>();
const emit = defineEmits<{
  select: [task: TaskDetail];
  remove: [task: TaskDetail];
  more: [];
}>();
const query = ref(""),
  filter = ref("all");
const groups = computed(() =>
  reportGroups(
    props.items.filter(
      (t) =>
        matchesReport(t, query.value) &&
        (filter.value === "all" ||
          (filter.value === "issues"
            ? ["failed", "partial", "cancelled", "interrupted"].includes(
                t.status,
              )
            : t.status === "completed")),
    ),
  ),
);
</script>
<template>
  <section class="ai-report-library ai-history-list" aria-label="历史报告列表">
    <div class="ai-history-controls">
      <input
        v-model="query"
        class="ai-library-search"
        type="search"
        aria-label="搜索历史报告"
        placeholder="搜索已加载的报告"
      />
      <div class="ai-library-filter" aria-label="历史状态筛选">
        <button
          v-for="option in [
            { id: 'all', label: '全部' },
            { id: 'completed', label: '已完成' },
            { id: 'issues', label: '需查看' },
          ]"
          :key="option.id"
          :aria-pressed="filter === option.id"
          @click="filter = option.id"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <p v-if="busy" class="ai-library-loaded" role="status">正在处理，请稍候…</p>
    <template v-for="group in groups" :key="group.day">
      <h4 class="ai-library-day">{{ group.day }}</h4>
      <article
        v-for="task in group.items"
        :key="task.id"
        class="ai-library-card ai-history-entry"
        :class="{ 'is-current': task.id === currentId }"
      >
        <button
          class="ai-library-open"
          :data-history-open="task.id"
          :aria-current="task.id === currentId ? 'true' : undefined"
          :aria-label="
            '查看 ' +
            reportTitle(task) +
            ' ' +
            group.day +
            ' ' +
            reportTime(task.createdAt)
          "
          :disabled="busy"
          @click="emit('select', task)"
        >
          <div class="ai-history-heading">
            <time>{{ reportTime(task.createdAt) }}</time
            ><span>{{ reportTitle(task) }}</span>
          </div>
          <p
            class="ai-library-models"
            :title="reportModels(task) + ' · ' + reportCounts(task)"
          >
            {{ reportModels(task)
            }}<span class="ai-history-counts ai-library-counts"> · {{ reportCounts(task) }}</span>
          </p>
          <small
            v-if="task.parentId || task.requestSnapshot.group"
            class="ai-library-scope"
            >{{
              task.parentId
                ? "属于整批报告，请从所属整批管理删除"
                : "删除会影响整批报告"
            }}</small
          >
        </button>
        <div class="ai-history-entry-side">
          <span class="ai-library-status" :data-status="task.status">{{
            reportStatus(task)
          }}</span>
          <div class="ai-history-entry-actions">
            <span v-if="task.id === currentId" class="ai-library-current"
              >正在查看</span
            ><button
              class="ai-library-delete"
              :data-history-delete="task.id"
              :disabled="busy || reportRunning(task) || !!task.parentId"
              :title="
                task.parentId
                  ? '请从所属整批报告管理删除'
                  : reportRunning(task)
                    ? '分析结束后可删除'
                    : '移入回收站，可恢复'
              "
              @click="emit('remove', task)"
            >
              删除报告
            </button>
          </div>
        </div>
      </article>
    </template>
    <div v-if="!groups.length && !busy" class="ai-library-empty">
      <strong>{{
        query || filter !== "all" ? "没有匹配的报告" : "暂无历史报告"
      }}</strong>
      <p>
        {{
          query || filter !== "all"
            ? "试试其他关键词或状态；筛选仅针对已加载记录。"
            : "生成的报告会保存在这里。"
        }}
      </p>
    </div>
    <button
      v-if="hasMore"
      class="ai-library-more"
      :disabled="busy"
      @click="emit('more')"
    >
      加载更早的报告
    </button>
    <p v-if="items.length" class="ai-library-loaded">
      已加载 {{ items.length }} 份{{
        hasMore ? "，可继续加载更早的记录" : ""
      }}；查看不会重新分析。
    </p>
  </section>
</template>
<style scoped>
.ai-history-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ai-history-controls .ai-library-search {
  flex: 1;
  width: 0;
  min-width: 90px;
  height: 30px;
  min-height: 30px;
  padding: 5px 8px;
  background: #fff;
  border-radius: 5px;
  font-size: 11px;
}
.ai-history-controls .ai-library-filter {
  flex-shrink: 0;
  gap: 10px;
  margin: 0;
}
.ai-history-controls .ai-library-filter button {
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  padding: 5px 0;
  font-size: 11px;
  min-height: 30px;
  height: auto;
}
.ai-history-controls .ai-library-filter button[aria-pressed="true"] {
  border-bottom-color: #3268cf;
  color: #3268cf;
  background: transparent;
}
.ai-history-list .ai-library-day {
  margin: 16px 0 3px;
  font-size: 11px;
}
.ai-history-list .ai-history-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid #edf1f5;
  border-radius: 0;
  box-shadow: none;
  margin: 0;
  background: transparent;
  overflow: visible;
}
.ai-history-list .ai-history-entry.is-current {
  background: #f5f8fc;
  box-shadow: none;
}
.ai-history-entry .ai-library-open {
  flex: 1;
  width: 0;
  min-width: 0;
  padding: 11px 7px;
  background: transparent;
}
.ai-history-entry .ai-library-open:hover {
  background: #f5f8fc;
}
.ai-history-heading {
  display: flex;
  align-items: baseline;
  gap: 9px;
  line-height: 1.5;
}
.ai-history-heading time {
  flex-shrink: 0;
  font-size: 12px;
  color: #354d68;
  font-variant-numeric: tabular-nums;
}
.ai-history-heading > span {
  font-size: 11px;
  color: #758293;
  overflow-wrap: anywhere;
}
.ai-history-entry .ai-library-models {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.6;
  -webkit-line-clamp: 2;
}
.ai-history-counts {
  color: #8593a4;
  font-size: 10px;
}
.ai-history-entry .ai-library-scope {
  display: block;
  margin-top: 3px;
  font-size: 10px;
}
.ai-history-entry-side {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  padding: 9px 6px 9px 0;
  flex-shrink: 0;
}
.ai-history-entry-side .ai-library-status {
  background: transparent;
  padding: 0;
  font-size: 10px;
  color: #758293;
}
.ai-history-entry-side .ai-library-status[data-status="failed"],
.ai-history-entry-side .ai-library-status[data-status="partial"] {
  color: #a37136;
}
.ai-history-entry-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.ai-history-entry-actions .ai-library-delete {
  font-size: 10px;
  height: auto;
  min-height: 24px;
  padding: 2px 0;
}
.ai-history-entry-actions .ai-library-current {
  font-size: 10px;
}
.ai-history-list .ai-library-more {
  border: 0;
  background: transparent;
  color: #65758a;
  padding: 6px;
  margin-top: 6px;
}
@media (max-width: 420px) {
  .ai-history-controls {
    flex-wrap: wrap;
    gap: 7px;
  }
  .ai-history-controls .ai-library-search {
    width: 100%;
    flex-basis: 100%;
  }
  .ai-history-entry-actions {
    gap: 6px;
  }
  .ai-history-heading {
    gap: 6px;
    flex-wrap: wrap;
  }
}
</style>

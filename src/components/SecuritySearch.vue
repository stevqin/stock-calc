<script setup lang="ts">
import FloatingNotice from "./FloatingNotice.vue";
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import {
  localSecuritySearch,
  LocalSearchOnlyError,
  mergeSearchHits,
  normalizeSearch,
  remoteSecuritySearch,
  searchId,
  validSearch,
  type SecurityHit,
} from "../securitySearch";

const props = withDefaults(
  defineProps<{
    securities: SecurityHit[];
    localOnly?: boolean;
    resultHint?: string;
  }>(),
  {
    localOnly: false,
    resultHint: "↑ ↓ 选择 · Enter 填入 · 核对后添加",
  },
);
const emit = defineEmits<{ select: [SecurityHit]; clear: [] }>();
const id = useId();
const query = ref("");
const composing = ref(false);
const expanded = ref(false);
const pending = ref(false);
const message = ref("");
const searchError = ref("");
const active = ref(-1);
const remote = ref<SecurityHit[]>([]);
const root = ref<HTMLElement>();
const local = computed(() =>
  localSecuritySearch(props.securities, query.value),
);
const hits = computed(() => mergeSearchHits(local.value, remote.value));
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let chosenQuery = "";

function cancel() {
  ++generation;
  clearTimeout(timer);
  pending.value = false;
}
watch([query, composing], () => {
  if (chosenQuery && query.value !== chosenQuery) {
    chosenQuery = "";
    emit("clear");
  }
  cancel();
  remote.value = [];
  active.value = -1;
  message.value = "";
  searchError.value = "";
  const q = normalizeSearch(query.value);
  expanded.value = !!q;
  if (!q || composing.value) return;
  if (!validSearch(q)) {
    message.value = "请输入名称、拼音或代码（最多64位）";
    return;
  }
  if (props.localOnly) {
    message.value = "仅搜索已有历史交易的证券";
    return;
  }
  const version = generation;
  pending.value = true;
  timer = setTimeout(async () => {
    try {
      const result = await remoteSecuritySearch(q);
      if (version !== generation) return;
      remote.value = result;
      message.value = "腾讯证券搜索 · 仅列出支持的沪深股票与ETF";
    } catch (error) {
      if (version !== generation) return;
      if (error instanceof LocalSearchOnlyError) message.value = error.message;
      else {
        searchError.value = `${error instanceof Error ? error.message : String(error)}；请重试搜索`;
        message.value = hits.value.length
          ? "暂仅显示已保存证券的匹配结果"
          : "全市场搜索暂不可用，请稍后重试";
      }
    } finally {
      if (version === generation) pending.value = false;
    }
  }, 300);
});
onBeforeUnmount(cancel);

function choose(hit: SecurityHit) {
  cancel();
  chosenQuery = query.value;
  expanded.value = false;
  active.value = -1;
  emit("select", hit);
}
async function keys(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) {
    if (event.key === "Enter") event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key === "Enter") {
    // Enter in the search field only picks a candidate, never submits the form.
    event.preventDefault();
    event.stopPropagation();
    if (expanded.value && hits.value.length)
      choose(hits.value[Math.max(0, active.value)]);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    expanded.value = true;
    if (!hits.value.length) return;
    active.value =
      active.value < 0
        ? event.key === "ArrowDown"
          ? 0
          : hits.value.length - 1
        : (active.value +
            (event.key === "ArrowDown" ? 1 : -1) +
            hits.value.length) %
          hits.value.length;
    await nextTick();
    root.value
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  } else if (event.key === "Escape" && expanded.value) {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    expanded.value = false;
  }
}
</script>

<template>
  <FloatingNotice :message="searchError" />
  <div ref="root" class="security-search">
    <label :for="id">搜索证券</label>
    <input
      :id="id"
      v-model="query"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      placeholder="名称 / 全拼 / 拼音简称 / 代码"
      maxlength="64"
      :aria-expanded="expanded"
      :aria-controls="`${id}-results`"
      aria-autocomplete="list"
      :aria-activedescendant="
        expanded && active >= 0 && hits[active]
          ? `${id}-${searchId(hits[active])}`
          : undefined
      "
      :aria-describedby="`${id}-help`"
      @compositionstart="composing = true"
      @compositionend="composing = false"
      @keydown="keys"
      @focus="expanded = !!query.trim()"
    />
    <small :id="`${id}-help`">如：贵州茅台 / guizhoumaotai / gzmt / 6005</small>
    <div v-if="expanded" class="search-candidates">
      <ul
        :id="`${id}-results`"
        role="listbox"
        aria-label="证券搜索结果"
        :aria-busy="pending"
      >
        <li
          v-for="(hit, index) in hits"
          :id="`${id}-${searchId(hit)}`"
          :key="searchId(hit)"
          role="option"
          :aria-selected="index === active"
          @mousedown.prevent
          @click="choose(hit)"
          @mouseenter="active = index"
        >
          <span class="search-name"
            >{{ hit.name
            }}<small>{{ hit.asset === "etf" ? "ETF" : "股票" }}</small></span
          >
          <span class="search-code"
            >{{ hit.market.toUpperCase() }} {{ hit.code }}</span
          >
        </li>
      </ul>
      <div class="search-status" role="status">
        <span v-if="pending">正在搜索…</span>
        <span v-else-if="!hits.length && !composing"
          >未找到匹配证券，请更换名称、拼音或代码重试。</span
        >
        <small v-if="message">{{ message }}</small>
        <small v-if="hits.length">{{ resultHint }}</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.security-search > small {
  display: block;
  margin-top: 6px;
  color: var(--ui-muted);
  font-size: 11px;
}
.search-candidates {
  margin-top: 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  overflow: hidden;
}
.search-candidates ul {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 184px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.search-candidates li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 7px 10px;
  cursor: pointer;
  border-bottom: 1px solid #eef2f7;
}
.search-candidates li[aria-selected="true"] {
  background: #eaf1ff;
  box-shadow: inset 3px 0 var(--ui-action);
}
.search-name {
  min-width: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.search-name small {
  margin-left: 8px;
  font-size: 10px;
  color: var(--ui-muted);
}
.search-code {
  flex-shrink: 0;
  font: 11px var(--ui-number-font);
  color: var(--ui-muted);
}
.search-status {
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  background: #f8fafd;
  font-size: 12px;
  color: var(--ui-muted);
}
.search-status small {
  font-size: 11px;
}
</style>

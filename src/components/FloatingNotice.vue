<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { nextNoticeId, noticeStack, removeNotice } from "./noticeStack";
const props = withDefaults(
  defineProps<{
    message?: string;
    kind?: "info" | "warning" | "error";
    duration?: number;
  }>(),
  { message: "", kind: "error", duration: 0 },
);
const id = nextNoticeId();
let timer: ReturnType<typeof setTimeout> | undefined;
const isHost = computed(() => noticeStack[0]?.id === id);
function close() {
  clearTimeout(timer);
  removeNotice(id);
}
watch(
  () => [props.message, props.kind, props.duration],
  () => {
    close();
    if (!props.message) return;
    noticeStack.push({ id, message: props.message, kind: props.kind, close });
    if (props.duration > 0) timer = setTimeout(close, props.duration);
  },
  { immediate: true, flush: "sync" },
);
onBeforeUnmount(close);
</script>
<template>
  <Teleport v-if="isHost" to="body">
    <div class="floating-notices" aria-label="消息提示">
      <div
        v-for="notice in noticeStack"
        :key="notice.id"
        class="floating-notice"
        :class="notice.kind"
        :role="notice.kind === 'error' ? 'alert' : 'status'"
      >
        <span class="notice-mark" aria-hidden="true">{{
          notice.kind === "error" ? "!" : notice.kind === "warning" ? "!" : "✓"
        }}</span>
        <span class="notice-message">{{ notice.message }}</span>
        <button
          type="button"
          :aria-label="notice.kind === 'error' ? '关闭错误提示' : '关闭提示'"
          @click="notice.close"
        >
          ×
        </button>
      </div>
    </div>
  </Teleport>
</template>

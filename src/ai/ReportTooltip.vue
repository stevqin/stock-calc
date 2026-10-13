<script setup lang="ts">
import { ref, useId, nextTick, onBeforeUnmount } from "vue";
defineProps<{ label: string; text: string }>();
const id = "ai-tip-" + useId();
const visible = ref(false),
  trigger = ref<HTMLButtonElement>(),
  bubble = ref<HTMLElement>();
const left = ref(12),
  top = ref(12);
let hovered = false,
  focused = false;
let closing: ReturnType<typeof setTimeout> | undefined;
function cancelClosing() {
  if (closing) clearTimeout(closing);
  closing = undefined;
}
function hide() {
  cancelClosing();
  visible.value = false;
}
function enter() {
  hovered = true;
  cancelClosing();
  void show();
}
function leave() {
  hovered = false;
  scheduleHide();
}
function focus() {
  focused = true;
  cancelClosing();
  void show();
}
function blur() {
  focused = false;
  scheduleHide();
}
function scheduleHide() {
  cancelClosing();
  if (!focused)
    closing = setTimeout(() => {
      if (!hovered && !focused) hide();
    }, 180);
}

async function show() {
  cancelClosing();
  visible.value = true;
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  left.value = Math.max(12, Math.min(rect.left - 120, window.innerWidth - 292));
  top.value = rect.bottom + 8;
  await nextTick();
  const height = bubble.value?.getBoundingClientRect().height ?? 0;
  if (top.value + height > window.innerHeight - 12)
    top.value = Math.max(12, rect.top - height - 8);
}
function key(event: KeyboardEvent) {
  if (event.key === "Escape" && visible.value) {
    event.preventDefault();
    event.stopPropagation();
    hide();
  }
}
document.addEventListener("keydown", key, true);
window.addEventListener("scroll", hide, true);
window.addEventListener("resize", hide);
onBeforeUnmount(() => {
  cancelClosing();
  document.removeEventListener("keydown", key, true);
  window.removeEventListener("scroll", hide, true);
  window.removeEventListener("resize", hide);
});
</script>
<template>
  <span class="ai-help">
    <button
      ref="trigger"
      type="button"
      class="ai-help-trigger"
      :aria-label="label + '说明'"
      :aria-describedby="visible ? id : undefined"
      @mouseenter="enter"
      @mouseleave="leave"
      @focus="focus"
      @blur="blur"
      @click.stop="show"
      @keydown="key"
    >
      ?
    </button>
    <Teleport to="body"
      ><span
        v-if="visible"
        :id="id"
        ref="bubble"
        role="tooltip"
        class="ai-help-bubble"
        @mouseenter="enter"
        @mouseleave="leave"
        :style="{ left: left + 'px', top: top + 'px' }"
        >{{ text }}</span
      ></Teleport
    >
  </span>
</template>
<style scoped>
.ai-help {
  display: inline-flex;
  vertical-align: middle;
  margin-left: 5px;
}
.ai-help-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  border: 1px solid #b5c3d4;
  border-radius: 50%;
  background: transparent;
  color: #62748a;
  font: 11px/1 sans-serif;
  cursor: help;
}
.ai-help-trigger:focus-visible {
  outline: 2px solid #3268cf;
  outline-offset: 3px;
}
.ai-help-bubble {
  position: fixed;
  z-index: 10000;
  width: 280px;
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 6px;
  background: #213349;
  color: #fff;
  font-size: 12px;
  line-height: 1.65;
  box-shadow: 0 5px 18px #132c4726;
  pointer-events: auto;
  white-space: normal;
}
</style>

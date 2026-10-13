<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CSSProperties } from "vue";

const props = defineProps<{ text: string }>();
const anchor = ref<HTMLElement>();
const popover = ref<HTMLElement>();
const visible = ref(false);
const position = ref<CSSProperties>({
  left: "12px",
  top: "12px",
  visibility: "hidden",
});

async function place() {
  if (!anchor.value || !popover.value) return;
  const source = anchor.value.getBoundingClientRect();
  const tip = popover.value.getBoundingClientRect();
  const gap = 7;
  const margin = 10;
  const left = Math.min(
    window.innerWidth - tip.width - margin,
    Math.max(margin, source.left + source.width / 2 - tip.width / 2),
  );
  const below = source.bottom + gap;
  const top =
    below + tip.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, source.top - tip.height - gap);
  position.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    visibility: "visible",
  };
}

async function show() {
  if (!props.text.trim()) return;
  visible.value = true;
  position.value.visibility = "hidden";
  await nextTick();
  await place();
}

function hide() {
  visible.value = false;
}

function closeOnViewportChange() {
  hide();
}

watch(
  () => props.text,
  (text) => {
    if (!text.trim()) hide();
  },
);

onMounted(() => {
  window.addEventListener("resize", closeOnViewportChange);
  window.addEventListener("scroll", closeOnViewportChange, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", closeOnViewportChange);
  window.removeEventListener("scroll", closeOnViewportChange, true);
});
</script>

<template>
  <span
    ref="anchor"
    class="note-tooltip-anchor"
    @mouseenter="show"
    @mouseleave="hide"
    ><slot
  /></span>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="popover"
      class="note-tooltip-popover"
      :style="position"
    >
      {{ text }}
    </div>
  </Teleport>
</template>

<style scoped>
.note-tooltip-anchor {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-tooltip-popover {
  position: fixed;
  z-index: 1400;
  width: max-content;
  max-width: min(320px, calc(100vw - 20px));
  padding: 7px 9px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  background: rgba(32, 40, 52, 0.94);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.22);
  color: #f7f9fc;
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  pointer-events: none;
  white-space: normal;
}
</style>

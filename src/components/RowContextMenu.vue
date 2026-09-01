<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
export interface RowMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  separator?: boolean;
}
const props = defineProps<{
  x: number;
  y: number;
  title: string;
  items: RowMenuItem[];
}>();
const emit = defineEmits<{ action: [id: string]; close: [] }>();
const menu = ref<HTMLElement>();
const left = ref(props.x),
  top = ref(props.y);
const previousFocus = document.activeElement as HTMLElement | null;
function close(restore = false) {
  if (restore) previousFocus?.focus({ preventScroll: true });
  emit("close");
}
function select(id: string) {
  close(true);
  emit("action", id);
}
function outside(e: Event) {
  if (!menu.value?.contains(e.target as Node)) close();
}
function resize() {
  close();
}
function keys(e: KeyboardEvent) {
  if (e.key === "Escape" || e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    close(true);
    return;
  }
  const buttons = [
    ...(menu.value?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ) ?? []),
  ];
  if (
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) ||
    !buttons.length
  )
    return;
  e.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? buttons.length - 1
        : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[next]?.focus();
}
onMounted(async () => {
  await nextTick();
  if (!menu.value) return;
  const rect = menu.value.getBoundingClientRect();
  left.value = Math.max(
    8,
    Math.min(props.x, window.innerWidth - rect.width - 8),
  );
  top.value = Math.max(
    8,
    Math.min(props.y, window.innerHeight - rect.height - 8),
  );
  menu.value.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("contextmenu", outside, true);
  document.addEventListener("scroll", outside, true);
  window.addEventListener("resize", resize);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("contextmenu", outside, true);
  document.removeEventListener("scroll", outside, true);
  window.removeEventListener("resize", resize);
});
</script>
<template>
  <div
    ref="menu"
    role="menu"
    :aria-label="title + '操作'"
    class="row-context-menu"
    :style="{ left: left + 'px', top: top + 'px' }"
    @keydown="keys"
    @contextmenu.prevent
  >
    <div class="row-menu-title">{{ title }}</div>
    <button
      v-for="item in items"
      :key="item.id"
      role="menuitem"
      :disabled="item.disabled"
      :class="{ 'menu-separator': item.separator }"
      @click="select(item.id)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

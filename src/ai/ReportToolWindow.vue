<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
const props = defineProps<{
  open: boolean;
  title: string;
  variant?: "process" | "setup" | "library";
  returnFocusTo?: string;
}>();
const emit = defineEmits<{
  close: [];
  contentScroll: [event: Event];
  browse: [];
}>();
const panel = ref<HTMLElement>();
let previous: HTMLElement | null = null;
function restoreFocus() {
  const visible = (element: HTMLElement | null | undefined) =>
    !!element?.isConnected &&
    element.getClientRects().length > 0 &&
    !element.closest('[inert], [aria-hidden="true"]');
  const fallback = props.returnFocusTo
    ? (panel.value
        ?.closest(".ai-stock-drawer")
        ?.querySelector<HTMLElement>(props.returnFocusTo) ??
      panel.value
        ?.closest(".ai-stock-drawer")
        ?.querySelector<HTMLElement>('[data-tool="setup"]'))
    : null;
  const target = visible(previous)
    ? previous
    : visible(fallback)
      ? fallback
      : null;
  target?.focus({ preventScroll: true });
}
watch(
  () => props.open,
  async (open) => {
    if (open) {
      previous = document.activeElement as HTMLElement | null;
      await nextTick();
      if (props.open)
        panel.value
          ?.querySelector<HTMLButtonElement>("[data-tool-close]")
          ?.focus();
    } else {
      await nextTick();
      restoreFocus();
    }
  },
  { flush: "post", immediate: true },
);
onBeforeUnmount(() => {
  if (
    props.open &&
    previous?.isConnected &&
    !previous.closest(".ai-stock-drawer")
  )
    previous.focus({ preventScroll: true });
});
function keys(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    emit("close");
    return;
  }
  if (e.key !== "Tab") return;
  e.stopPropagation();
  const items = Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary",
    ) ?? [],
  ).filter((e) => e.getClientRects().length > 0);
  const first = items[0],
    last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last?.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first?.focus();
  }
}
</script>
<template>
  <Transition name="ai-tool-pop">
    <div
      v-show="open"
      :aria-hidden="!open"
      class="ai-tool-overlay"
      @click.self.stop="emit('close')"
    >
      <section
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="ai-tool-window"
        :class="{
          'ai-tool-window--process': variant === 'process',
          'ai-tool-window--setup': variant === 'setup',
          'ai-tool-window--library': variant === 'library',
        }"
        @keydown="keys"
      >
        <header>
          <h3>{{ title }}</h3>
          <button
            data-tool-close
            :aria-label="'关闭' + title"
            title="关闭"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <div v-if="$slots.subheader" class="ai-tool-subheader">
          <slot name="subheader" />
        </div>
        <div
          class="ai-tool-content"
          @scroll="emit('contentScroll', $event)"
          @wheel="if ($event.deltaY < 0) emit('browse');"
          @touchmove.passive="emit('browse')"
          @pointerdown="
            if ($event.target === $event.currentTarget) emit('browse');
          "
          @keydown="
            if (['ArrowUp', 'PageUp', 'Home'].includes($event.key))
              emit('browse');
          "
        >
          <slot />
        </div>
        <footer v-if="$slots.footer" class="ai-tool-footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Transition>
</template>
<style scoped>
.ai-tool-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: #172b461a;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 70px 16px 18px;
}
.ai-tool-window {
  display: flex;
  flex-direction: column;
  width: min(470px, 100%);
  max-height: 100%;
  min-height: 0;
  background: #fff;
  border: 1px solid #d4dfea;
  border-radius: 12px;
  box-shadow: 0 12px 48px #20344e33;
  overflow: hidden;
}
.ai-tool-window > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid #e3e9f1;
  flex-shrink: 0;
}
.ai-tool-window h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #243b58;
}
.ai-tool-window header button {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 22px;
  color: #62748a;
  cursor: pointer;
}
.ai-tool-window header button:hover {
  background: #eef3f9;
}
.ai-tool-content {
  padding: 14px;
  overflow: auto;
  min-height: 0;
  overscroll-behavior: contain;
}
.ai-tool-window :focus-visible {
  outline: 2px solid #3268cf;
  outline-offset: 2px;
}
@media (max-width: 600px) {
  .ai-tool-overlay {
    padding: 60px 8px 8px;
  }
  .ai-tool-content {
    padding: 12px;
  }
}

.ai-tool-window--process,
.ai-tool-window--library {
  width: min(520px, 100%);
  max-height: min(720px, 100%);
}
.ai-tool-pop-enter-active,
.ai-tool-pop-leave-active {
  transition: opacity 200ms ease;
}
.ai-tool-pop-enter-active .ai-tool-window,
.ai-tool-pop-leave-active .ai-tool-window {
  transition:
    transform 200ms cubic-bezier(0.2, 0.75, 0.25, 1),
    opacity 200ms ease;
  transform-origin: bottom right;
}
.ai-tool-pop-enter-from,
.ai-tool-pop-leave-to {
  opacity: 0;
}
.ai-tool-pop-enter-from .ai-tool-window,
.ai-tool-pop-leave-to .ai-tool-window {
  opacity: 0;
  transform: translateY(14px) scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .ai-tool-pop-enter-active,
  .ai-tool-pop-leave-active,
  .ai-tool-pop-enter-active .ai-tool-window,
  .ai-tool-pop-leave-active .ai-tool-window {
    transition: none;
  }
}

.ai-tool-window--setup {
  width: min(520px, 100%);
  max-height: min(780px, 100%);
}
.ai-tool-subheader {
  flex-shrink: 0;
  max-height: 45%;
  overflow: auto;
  border-bottom: 1px solid #e3e9f1;
  background: #fbfcfe;
}
.ai-tool-footer {
  flex-shrink: 0;
  padding: 12px 14px;
  border-top: 1px solid #e3e9f1;
  background: #fbfcfe;
}
</style>

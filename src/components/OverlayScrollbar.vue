<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const thumb = ref<HTMLElement>();
const visible = ref(false);
const metrics = ref<{
  left: number;
  top: number;
  height: number;
  travel: number;
  max: number;
  value: number;
  id: string;
}>();
let target: HTMLElement | undefined;
let enabled = false,
  frame = 0,
  dragging = false;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | undefined,
  mutationObserver: MutationObserver | undefined;
let startY = 0,
  startScroll = 0,
  dragRatio = 0;
const positions = new WeakMap<HTMLElement, number>();
const assignedIds = new Map<HTMLElement, string>();
let serial = 0;

function hide() {
  visible.value = false;
  clearTimeout(hideTimer);
}
function pauseHide() {
  clearTimeout(hideTimer);
}
function idle() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!dragging && document.activeElement !== thumb.value) hide();
  }, 900);
}
function measure() {
  frame = 0;
  const el = target;
  if (
    !el?.isConnected ||
    el.clientHeight <= 0 ||
    el.scrollHeight <= el.clientHeight + 1
  ) {
    hide();
    return;
  }
  const r = el.getBoundingClientRect();
  const right = r.left + el.clientLeft + el.clientWidth;
  let top = Math.max(0, r.top + el.clientTop),
    bottom = Math.min(innerHeight, r.top + el.clientTop + el.clientHeight);
  // Clip the overlay to ancestor viewports; never draw it across a modal/header.
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const p = parent.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      top = Math.max(top, p.top + parent.clientTop);
      bottom = Math.min(bottom, p.top + parent.clientTop + parent.clientHeight);
    }
    if (
      /auto|scroll|hidden|clip/.test(style.overflowX) &&
      (right > p.left + parent.clientLeft + parent.clientWidth + 1 ||
        right < p.left + 12)
    ) {
      hide();
      return;
    }
  }
  const track = bottom - top - 4;
  if (track < 24 || right < 12 || right > innerWidth + 1) {
    hide();
    return;
  }
  const height = Math.min(
    track,
    Math.max(28, (track * el.clientHeight) / el.scrollHeight),
  );
  const max = el.scrollHeight - el.clientHeight,
    value = Math.max(0, Math.min(max, el.scrollTop));
  if (!el.id) {
    const id = `overlay-scroll-area-${++serial}`;
    el.id = id;
    assignedIds.set(el, id);
  }
  metrics.value = {
    left: right - 13,
    top: top + 2 + ((track - height) * value) / max,
    height,
    travel: track - height,
    max,
    value,
    id: el.id,
  };
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(measure);
}
function activate(el: HTMLElement) {
  if (target !== el) {
    target = el;
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver?.observe(el);
    mutationObserver?.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  visible.value = true;
  schedule();
  idle();
}
function scroll(event: Event) {
  const el =
    event.target === document ? document.scrollingElement : event.target;
  if (!(el instanceof HTMLElement)) return;
  const previous = positions.get(el) ?? 0;
  positions.set(el, el.scrollTop);
  if (previous === el.scrollTop) {
    if (target) schedule();
    return;
  }
  if (
    !/auto|scroll|overlay/.test(getComputedStyle(el).overflowY) ||
    el.scrollHeight <= el.clientHeight + 1
  )
    return;
  activate(el);
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || !target || !metrics.value) return;
  event.preventDefault();
  dragging = true;
  clearTimeout(hideTimer);
  startY = event.clientY;
  startScroll = target.scrollTop;
  dragRatio = metrics.value.max / Math.max(1, metrics.value.travel);
  thumb.value?.setPointerCapture(event.pointerId);
}
function pointerMove(event: PointerEvent) {
  if (dragging && target) {
    target.scrollTop = startScroll + (event.clientY - startY) * dragRatio;
    schedule();
  }
}
function pointerEnd() {
  dragging = false;
  idle();
}
function keydown(event: KeyboardEvent) {
  if (!target || !metrics.value) return;
  const steps: Record<string, number> = {
    ArrowDown: 40,
    ArrowUp: -40,
    PageDown: target.clientHeight * 0.9,
    PageUp: -target.clientHeight * 0.9,
    Home: -metrics.value.max,
    End: metrics.value.max,
  };
  if (event.key in steps) {
    event.preventDefault();
    target.scrollTop += steps[event.key];
    schedule();
    idle();
  }
}
function dismiss(event: Event) {
  if (event.target !== thumb.value && !dragging) hide();
}
onMounted(() => {
  // Mac WebKit / Chromium support per-axis native scrollbar styling. Other
  // engines retain their native bars rather than losing horizontal navigation.
  if (!globalThis.CSS?.supports?.("selector(::-webkit-scrollbar)")) return;
  enabled = true;
  document.documentElement.classList.add("overlay-scrollbars-enabled");
  resizeObserver = new ResizeObserver(schedule);
  mutationObserver = new MutationObserver(schedule);
  document.addEventListener("scroll", scroll, true);
  document.addEventListener("pointerdown", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("resize", hide);
});
onBeforeUnmount(() => {
  hide();
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  document.removeEventListener("scroll", scroll, true);
  document.removeEventListener("pointerdown", dismiss, true);
  document.removeEventListener("keydown", dismiss, true);
  document.removeEventListener("visibilitychange", hide);
  window.removeEventListener("resize", hide);
  if (enabled)
    document.documentElement.classList.remove("overlay-scrollbars-enabled");
  for (const [el, id] of assignedIds)
    if (el.id === id) el.removeAttribute("id");
});
</script>
<template>
  <Teleport to="body">
    <div
      v-if="metrics"
      ref="thumb"
      class="overlay-scroll-thumb"
      :class="{ 'is-visible': visible }"
      role="scrollbar"
      aria-label="纵向滚动"
      aria-orientation="vertical"
      :aria-controls="metrics.id"
      :aria-valuemin="0"
      :aria-valuemax="metrics.max"
      :aria-valuenow="Math.round(metrics.value)"
      :aria-hidden="!visible"
      :tabindex="visible ? 0 : -1"
      :style="{
        left: metrics.left + 'px',
        top: metrics.top + 'px',
        height: metrics.height + 'px',
      }"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerEnd"
      @pointercancel="pointerEnd"
      @lostpointercapture="pointerEnd"
      @pointerenter="pauseHide"
      @pointerleave="idle"
      @keydown="keydown"
      @blur="idle"
    />
  </Teleport>
</template>
<style>
/* Zero-width vertical natives: horizontal scrollbar dimensions are untouched. */
.overlay-scrollbars-enabled::-webkit-scrollbar,
.overlay-scrollbars-enabled *::-webkit-scrollbar {
  width: 0;
}
.overlay-scroll-thumb {
  position: fixed;
  z-index: 1200;
  width: 12px;
  min-height: 24px;
  box-sizing: border-box;
  border: 0;
  padding: 0;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  cursor: default;
  transition: opacity 160ms ease;
}
.overlay-scroll-thumb::before {
  content: "";
  position: absolute;
  inset: 0 3px;
  border-radius: 5px;
  background: rgba(113, 130, 155, 0.68);
}
.overlay-scroll-thumb.is-visible {
  opacity: 1;
  pointer-events: auto;
}
.overlay-scroll-thumb:hover::before,
.overlay-scroll-thumb:focus-visible::before {
  background: #64748b;
}
.overlay-scroll-thumb:focus-visible {
  outline: 2px solid #3268cf;
  outline-offset: 1px;
  border-radius: 5px;
}
@media (prefers-reduced-motion: reduce) {
  .overlay-scroll-thumb {
    transition: none;
  }
}
</style>

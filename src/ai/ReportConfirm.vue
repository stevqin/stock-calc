<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
defineProps<{
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const panel = ref<HTMLElement>();
const previous = document.activeElement as HTMLElement | null;
onMounted(async () => {
  await nextTick();
  panel.value?.querySelector<HTMLButtonElement>("[data-cancel-purge]")?.focus();
});
onBeforeUnmount(() => previous?.focus());
function keys(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    emit("cancel");
  }
  if (e.key === "Tab") {
    const elements = Array.from(
      panel.value?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const first = elements[0],
      last = elements.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}
</script>
<template>
  <Teleport to="body"
    ><div class="ai-confirm-overlay" @keydown="keys">
      <section
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        :aria-label="title"
        class="ai-report-confirm"
      >
        <h3>{{ title }}</h3>
        <p>{{ message }}</p>
        <p v-if="error" role="alert" class="ai-error">{{ error }}</p>
        <div class="ai-confirm-actions">
          <button data-cancel-purge :disabled="busy" @click="emit('cancel')">
            取消</button
          ><button
            data-confirm-purge
            class="primary"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </section>
    </div></Teleport
  >
</template>

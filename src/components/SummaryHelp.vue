<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";

const props = defineProps<{ label: string }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const closeButton = ref<HTMLButtonElement>();
const panelId = `summary-help-${useId()}`;
const titleId = `${panelId}-title`;

async function show() {
  open.value = true;
  await nextTick();
  closeButton.value?.focus();
}
async function close() {
  open.value = false;
  await nextTick();
  trigger.value?.focus();
}
function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) void close();
}
onMounted(() => document.addEventListener("keydown", closeOnEscape));
onBeforeUnmount(() => document.removeEventListener("keydown", closeOnEscape));
</script>

<template>
  <span class="summary-help">
    <button
      ref="trigger"
      type="button"
      class="summary-help-trigger"
      :aria-label="`查看${props.label}说明`"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click.stop="show"
    >
      ?
    </button>
    <Teleport to="body">
      <div v-if="open" class="summary-help-overlay" @click.self="close">
        <section
          :id="panelId"
          class="summary-help-panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <header>
            <h2 :id="titleId">{{ props.label }}构成</h2>
            <button
              ref="closeButton"
              type="button"
              aria-label="关闭指标说明"
              @click="close"
            >
              ×
            </button>
          </header>
          <div class="summary-help-body"><slot /></div>
        </section>
      </div>
    </Teleport>
  </span>
</template>

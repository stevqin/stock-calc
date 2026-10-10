<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ label: string }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const closeButton = ref<HTMLButtonElement>();

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
      :class="{ open }"
      :title="`查看${props.label}说明`"
      @click.stop="show"
    >
      ?
    </button>
    <Teleport to="body">
      <div v-if="open" class="summary-help-overlay" @click.self="close">
        <section class="summary-help-panel">
          <header>
            <h2>{{ props.label }}构成</h2>
            <button
              ref="closeButton"
              type="button"
              class="summary-help-close"
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

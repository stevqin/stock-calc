<script setup lang="ts">
import Decimal from "decimal.js";
import { useId } from "vue";
const inputId = useId();
const props = defineProps<{
  modelValue: string;
  label: string;
  step: string;
  min: string;
  decimals: number;
  unit: string;
  max?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
function change(direction: number) {
  try {
    const current = new Decimal(props.modelValue || props.min);
    if (!current.isFinite()) return;
    const next = current.plus(new Decimal(props.step).mul(direction));
    emit(
      "update:modelValue",
      Decimal.min(
        props.max ?? "1000000000",
        Decimal.max(props.min, next),
      ).toFixed(props.decimals),
    );
  } catch {
    /* Keep invalid text available for correction. */
  }
}
</script>
<template>
  <div class="step-field">
    <label class="step-label" :for="inputId"
      >{{ label }} <small>{{ unit }}</small
      ><slot name="label-suffix"
    /></label>
    <div class="step-control">
      <button type="button" class="step-decrease" @click="change(-1)">−</button>
      <input
        :id="inputId"
        :value="modelValue"
        inputmode="decimal"
        autocomplete="off"
        @input="
          emit('update:modelValue', ($event.target as HTMLInputElement).value)
        "
        @keydown.up.prevent="change(1)"
        @keydown.down.prevent="change(-1)"
      />
      <button type="button" class="step-increase" @click="change(1)">＋</button>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import Decimal from "decimal.js";
const props = defineProps<{
  modelValue: string;
  label: string;
  tick: string;
  decimals: number;
  id: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
function step(delta: number) {
  try {
    const price = new Decimal(props.modelValue || props.tick).plus(
      new Decimal(props.tick).mul(delta),
    );
    if (price.gte(props.tick) && price.lte(1000000))
      emit("update:modelValue", price.toFixed(props.decimals));
  } catch {
    /* Leave malformed input visible for correction. */
  }
}
</script>

<template>
  <label class="field-label" :for="id">{{ label }} <span>元</span></label>
  <div class="price-field">
    <button type="button" :aria-label="`${label}减少一档`" @click="step(-1)">
      −
    </button>
    <input
      :id="id"
      :value="modelValue"
      inputmode="decimal"
      autocomplete="off"
      :aria-label="label"
      @input="
        emit('update:modelValue', ($event.target as HTMLInputElement).value)
      "
      @keydown.up.prevent="step(1)"
      @keydown.down.prevent="step(-1)"
    />
    <button type="button" :aria-label="`${label}增加一档`" @click="step(1)">
      ＋
    </button>
  </div>
</template>

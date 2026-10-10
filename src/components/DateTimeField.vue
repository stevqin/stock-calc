<script setup lang="ts">
import { computed } from "vue";
import { zhCN } from "date-fns/locale";
import { VueDatePicker } from "@vuepic/vue-datepicker";
import "@vuepic/vue-datepicker/dist/main.css";

type FieldMode = "date" | "datetime" | "month";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    mode?: FieldMode;
    testId?: string;
    placeholder?: string;
    min?: string;
    max?: string;
    disabled?: boolean;
    invalid?: boolean;
    compact?: boolean;
  }>(),
  {
    mode: "date",
    testId: undefined,
    placeholder: "请选择",
    min: undefined,
    max: undefined,
    disabled: false,
    invalid: false,
    compact: false,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const modelType = computed(() =>
  props.mode === "datetime"
    ? "yyyy-MM-dd'T'HH:mm:ss"
    : props.mode === "month"
      ? "yyyy-MM"
      : "yyyy-MM-dd",
);
const inputFormat = computed(() =>
  props.mode === "datetime"
    ? "yyyy-MM-dd HH:mm:ss"
    : props.mode === "month"
      ? "yyyy年MM月"
      : "yyyy-MM-dd",
);
const textInputFormat = computed(() =>
  props.mode === "datetime"
    ? ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm"]
    : props.mode === "month"
      ? ["yyyy-MM", "yyyy年MM月"]
      : "yyyy-MM-dd",
);
const timeConfig = computed(() => ({
  enableTimePicker: props.mode === "datetime",
  enableSeconds: props.mode === "datetime",
  is24: true,
}));

function update(value: unknown) {
  emit("update:modelValue", typeof value === "string" ? value : "");
}
</script>

<template>
  <VueDatePicker
    :model-value="modelValue || null"
    :model-type="modelType"
    :month-picker="mode === 'month'"
    :time-config="timeConfig"
    :formats="{ input: inputFormat, preview: inputFormat }"
    :locale="zhCN"
    :week-start="1"
    :min-date="min || undefined"
    :max-date="max || undefined"
    :disabled="disabled"
    :placeholder="placeholder"
    :data-testid="testId"
    :auto-apply="mode !== 'datetime'"
    :text-input="{
      format: textInputFormat,
      enterSubmit: true,
      tabSubmit: true,
      applyOnBlur: true,
      selectOnFocus: true,
    }"
    :input-attrs="{
      clearable: true,
      alwaysClearable: false,
      hideInputIcon: compact,
      autocomplete: 'off',
    }"
    :action-row="{
      showPreview: mode === 'datetime',
      showCancel: true,
      showSelect: true,
      showNow: mode === 'datetime',
      selectBtnLabel: '确定',
      cancelBtnLabel: '取消',
      nowBtnLabel: '现在',
    }"
    :config="{
      closeOnScroll: false,
      closeOnAutoApply: true,
      tabOutClosesMenu: true,
    }"
    :teleport="true"
    :class="[
      'date-time-field',
      `date-time-field--${mode}`,
      { 'date-time-field--compact': compact, invalid },
    ]"
    @update:model-value="update"
  />
</template>

<style>
.date-time-field {
  --dp-font-family: var(--ui-font);
  --dp-font-size: 12px;
  --dp-border-radius: var(--ui-radius);
  --dp-cell-border-radius: 6px;
  --dp-input-padding: 8px 34px 8px 10px;
  --dp-input-icon-padding: 30px;
  --dp-border-color: var(--ui-border);
  --dp-menu-border-color: #d7e0ec;
  --dp-primary-color: var(--ui-action);
  --dp-primary-text-color: #fff;
  --dp-background-color: rgba(255, 255, 255, 0.96);
  --dp-menu-background-color: rgba(249, 251, 254, 0.98);
  --dp-hover-color: #edf3fb;
  --dp-hover-text-color: var(--ui-text);
  --dp-text-color: var(--ui-text);
  --dp-secondary-color: var(--ui-muted);
  --dp-icon-color: var(--ui-muted);
  --dp-disabled-color: var(--ui-disabled);
  width: 100%;
  min-width: 0;
}
.date-time-field .dp__input {
  box-sizing: border-box;
  height: var(--ui-field-height);
  margin: 0;
  color: var(--ui-text);
  font-family: var(--ui-number-font);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  border-color: var(--ui-border);
  background: var(--ui-surface);
}
.date-time-field .dp__input:hover {
  border-color: var(--ui-hover-border);
}
.date-time-field .dp__input_focus {
  border-color: var(--ui-focus-border);
  box-shadow: var(--ui-focus-ring);
}
.date-time-field--compact .dp__input {
  height: var(--ui-compact-height);
  padding-top: 3px;
  padding-bottom: 3px;
  font-size: 11px;
}
.dp__menu {
  color: var(--ui-text);
  font-family: var(--ui-font);
  border-color: #d7e0ec;
  box-shadow: 0 18px 48px rgba(25, 43, 72, 0.18);
  backdrop-filter: blur(18px) saturate(1.15);
}
.dp__action_button {
  font-family: var(--ui-font);
}
</style>

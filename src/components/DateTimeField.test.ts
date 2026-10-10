import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { VueDatePicker } from "@vuepic/vue-datepicker";
import DateTimeField from "./DateTimeField.vue";

describe("DateTimeField", () => {
  it("把可访问名称、占位文字和错误状态交给实际输入框", () => {
    const wrapper = mount(DateTimeField, {
      props: {
        modelValue: "",
        mode: "date",
        ariaLabel: "开始日期",
        placeholder: "开始日期",
        invalid: true,
        compact: true,
      },
    });

    const input = wrapper.get("input");
    expect(input.attributes("aria-label")).toBe("开始日期");
    expect(input.attributes("placeholder")).toBe("开始日期");
    expect(input.attributes("aria-invalid")).toBe("true");
    const picker = wrapper.findComponent(VueDatePicker);
    expect(picker.props("inputAttrs")).toMatchObject({
      clearable: true,
      alwaysClearable: false,
      hideInputIcon: true,
    });
  });

  it("日期时间模式保留秒并把清空转换为空字符串", async () => {
    const wrapper = mount(DateTimeField, {
      props: {
        modelValue: "2026-10-10T09:08:07",
        mode: "datetime",
      },
    });
    const picker = wrapper.findComponent(VueDatePicker);

    expect(picker.props("modelType")).toBe("yyyy-MM-dd'T'HH:mm:ss");
    expect(picker.props("timeConfig")).toMatchObject({
      enableTimePicker: true,
      enableSeconds: true,
      is24: true,
    });
    expect(picker.props("textInput")).toMatchObject({
      format: [
        "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-dd'T'HH:mm:ss",
        "yyyy-MM-dd HH:mm",
      ],
    });
    picker.vm.$emit("update:model-value", null);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });
});

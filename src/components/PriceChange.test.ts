import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import PriceChange from "./PriceChange.vue";

it("以昨收计算涨跌幅，价格及昨收变化时同步更新", async () => {
  const wrapper = mount(PriceChange, {
    props: { price: "10.5", previousClose: "10" },
  });
  expect(wrapper.text()).toBe("较昨收 +5.00%");
  expect(wrapper.classes()).toContain("gain");
  await wrapper.setProps({ price: "9.5" });
  expect(wrapper.text()).toBe("较昨收 -5.00%");
  expect(wrapper.classes()).toContain("loss");
  await wrapper.setProps({ previousClose: "9.5" });
  expect(wrapper.text()).toBe("较昨收 0.00%");
  expect(wrapper.classes()).toContain("flat");
  wrapper.unmount();
});

it.each([
  ["10", undefined],
  ["10", "0"],
  ["10", "-1"],
  ["10", "bad"],
  ["", "10"],
  ["bad", "10"],
  ["0", "10"],
  ["-1", "10"],
  ["Infinity", "10"],
])("价格 %s、昨收 %s 无效时不显示虚假涨跌幅", (price, previousClose) => {
  const wrapper = mount(PriceChange, { props: { price, previousClose } });
  expect(wrapper.text()).toBe("较昨收 —");
  expect(wrapper.classes()).toContain("flat");
  wrapper.unmount();
});

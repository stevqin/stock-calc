import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import QuoteDetails from "./QuoteDetails.vue";
import { formatQuoteField } from "../quoteDetails";
import type { Quote } from "../quotes";
it("完整字段保留未知及空值，盘口与指标随同一份报价更新", async () => {
  const raw = Array(89).fill("");
  Object.assign(raw, {
    3: "3.40",
    4: "3.51",
    9: "3.40",
    10: "30813",
    19: "3.41",
    20: "822",
    32: "-3.13",
    57: "46520.1384",
    64: "0",
    88: "future-data",
  });
  const quote = { latest: "3.40", kind: "stock", rawFields: raw } as Quote;
  const wrapper = mount(QuoteDetails, { props: { quote } });
  expect(wrapper.get(".quote-raw").text()).toContain("89 项");
  expect(wrapper.get(".quote-raw").text()).toContain("future-data");
  expect(wrapper.findAll(".quote-raw dl > div")).toHaveLength(89);
  expect(wrapper.get(".quote-book").text()).toContain("30,813");
  expect(wrapper.text()).toContain("4.65亿元");
  expect(wrapper.text()).toContain("0%");
  expect(wrapper.find(".quote-down").exists()).toBe(true);
  expect(wrapper.get(".quote-extra").text()).not.toContain("参考净值 IOPV");
  await wrapper.setProps({
    quote: {
      ...quote,
      kind: "etf",
      rawFields: raw.map((v, i) => (i === 78 ? "1.2345" : v)),
    },
  });
  expect(wrapper.get(".quote-extra").text()).toContain("参考净值 IOPV");
  expect(wrapper.text()).toContain("1.2345元");
  wrapper.unmount();
});
it("旧缓存可显示基础指标，无报价不显示NaN或伪零", () => {
  const wrapper = mount(QuoteDetails, {
    props: {
      quote: { latest: "10", previousClose: "9", kind: "stock" } as Quote,
    },
  });
  expect(wrapper.text()).toContain("10.00");
  expect(wrapper.text()).toContain("获取新报价后补齐");
  expect(formatQuoteField("")).toBe("—");
  expect(formatQuoteField("invalid")).toBe("—");
  expect(formatQuoteField("2102676320", "股")).toBe("21.0268亿股");
  wrapper.unmount();
});

it("报价区字段不重复，盘口不重复现价、委比与内外盘", () => {
  const wrapper = mount(QuoteDetails);
  const indices = wrapper
    .findAll("[data-field]")
    .map((node) => node.attributes("data-field"));
  expect(indices.length).toBe(new Set(indices).size);
  expect(indices).not.toContain("3");
  expect(indices).not.toContain("31");
  expect(indices).not.toContain("32");
  expect(wrapper.findAll(".quote-reference-grid > dl")).toHaveLength(3);
  expect(wrapper.find(".book-last").exists()).toBe(false);
  expect(wrapper.find(".book-summary").exists()).toBe(false);
  expect(wrapper.findAll(".quote-hero")).toHaveLength(1);
  wrapper.unmount();
});

it("五日分时铺满宽度且不显示盘口或筹码", async () => {
  const wrapper = mount(QuoteDetails, { props: { mode: "five-day" } });
  expect(wrapper.find(".quote-book").exists()).toBe(false);
  expect(wrapper.find(".daily-studies").exists()).toBe(false);
  expect(wrapper.find(".quote-market-wide").exists()).toBe(true);
  await wrapper.setProps({ mode: "intraday" });
  expect(wrapper.find(".quote-book").exists()).toBe(true);
  wrapper.unmount();
});

it("分时标签栏横跨整行，盘口与图表从标签栏下方同一高度开始", () => {
  const wrapper = mount(QuoteDetails, {
    props: { mode: "intraday" },
    slots: {
      "chart-tabs": '<div class="tabs-probe">tabs</div>',
      chart: '<div class="chart-probe">chart</div>',
    },
  });
  const market = wrapper.get(".quote-market-view");
  expect(market.element.children[0]).toBe(
    wrapper.get(".quote-chart-tabs").element,
  );
  const content = wrapper.get(".quote-market-content");
  expect(market.element.children[1]).toBe(content.element);
  expect(content.element.children[0]).toBe(
    wrapper.get(".quote-chart-main").element,
  );
  expect(content.element.children[1]).toBe(wrapper.get(".quote-book").element);
  wrapper.unmount();
});

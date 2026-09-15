import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import OrderBook from "./OrderBook.vue";
import type { Quote } from "../quotes";
it("五档按卖五至买五纵排，价格颜色按昨收比较，委差随价量更新", async () => {
  const rawFields = Array(88).fill("");
  rawFields[4] = "10";
  for (let i = 9; i <= 27; i += 2) {
    rawFields[i] = "9.9";
    rawFields[i + 1] = i < 19 ? "200" : "100";
  }
  const quote = { latest: "9.9", rawFields } as Quote;
  const w = mount(OrderBook, { props: { quote } });
  expect(
    w.findAll(".book-row > span:first-child").map((e) => e.text()),
  ).toEqual([
    "卖五",
    "卖四",
    "卖三",
    "卖二",
    "卖一",
    "买一",
    "买二",
    "买三",
    "买四",
    "买五",
  ]);
  expect(w.findAll(".book-row b.down")).toHaveLength(10);
  expect(w.get(".book-summary").text()).toContain("500");
  const next = [...rawFields];
  next[10] = "";
  await w.setProps({ quote: { ...quote, rawFields: next } });
  expect(w.get(".book-summary").text()).toContain("五档委差—");
  expect(
    w
      .findAll(".book-row i")
      .every((e) => !e.attributes("style")?.includes("NaN")),
  ).toBe(true);
  w.unmount();
});

it("手额切换使用各档价格乘手数乘100，更新报价后重算并保留单位", async () => {
  const rawFields = Array(88).fill("");
  Object.assign(rawFields, { 9: "3.40", 10: "300", 19: "3.41", 20: "0" });
  const w = mount(OrderBook, {
    props: { quote: { rawFields } as Quote, compact: true },
  });
  const buy = () => w.findAll(".book-row")[5].get(".book-volume").text();
  expect(buy()).toBe("300");
  await w.get("button[title]").trigger("click");
  expect(buy()).toBe("10.2万元");
  expect(w.findAll(".book-row")[4].get(".book-volume").text()).toBe("0元");
  expect(w.findAll(".book-row")[0].get(".book-volume").text()).toBe("—");
  await w.setProps({
    quote: {
      rawFields: rawFields.map((v, i) => (i === 9 ? "3.50" : v)),
    } as Quote,
  });
  expect(buy()).toBe("10.5万元");
  await w.get(".book-unit button").trigger("click");
  expect(buy()).toBe("300");
  w.unmount();
});

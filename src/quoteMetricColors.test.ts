import { expect, it } from "vitest";
import { quoteFieldTone } from "./quoteDetails";
import type { Quote } from "./quotes";
function quote(fields: Record<number, string>) {
  const rawFields = Array(89).fill("");
  Object.assign(rawFields, { 4: "10", ...fields });
  return { kind: "stock", rawFields } as Quote;
}
it.each([
  [49, "1.8", "quote-up"],
  [49, "0.7", "quote-down"],
  [49, "1", ""],
  [74, "20", "quote-up"],
  [74, "-20", "quote-down"],
  [74, "0", ""],
  [7, "100", "quote-up"],
  [8, "200", "quote-down"],
  [67, "12", "quote-up"],
  [68, "8", "quote-down"],
  [67, "10", ""],
  [67, "9", "quote-down"],
  [68, "11", "quote-up"],
  [38, "5", ""],
  [45, "100", ""],
  [39, "20", ""],
] as const)("指标 %s 数值 %s 按自身基准着色", (index, value, color) => {
  expect(quoteFieldTone(quote({ [index]: value }), { index, label: "" })).toBe(
    color,
  );
});
it.each(["", "NaN", "Infinity", "bad"])(
  "无效数据 %s 不显示方向颜色",
  (value) => {
    for (const index of [49, 74, 7, 8, 67, 68, 32])
      expect(
        quoteFieldTone(quote({ [index]: value }), { index, label: "" }),
      ).toBe("");
  },
);
it("零值内外盘及无效价格基准保持中性，旧缓存量比也使用相同规则", () => {
  for (const index of [7, 8, 49, 67, 68])
    expect(quoteFieldTone(quote({ [index]: "0" }), { index, label: "" })).toBe(
      "",
    );
  for (const previous of ["", "0", "NaN", "Infinity"])
    expect(
      quoteFieldTone(quote({ 4: previous, 67: "12" }), {
        index: 67,
        label: "",
      }),
    ).toBe("");
  expect(
    quoteFieldTone({ volumeRatio: "0.6" } as Quote, {
      index: 49,
      label: "量比",
      fallback: "volumeRatio",
    }),
  ).toBe("quote-down");
});

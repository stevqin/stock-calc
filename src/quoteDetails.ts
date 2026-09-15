import Decimal from "decimal.js";
import type { Quote } from "./quotes";

export interface QuoteField {
  index: number;
  label: string;
  unit?: string;
  fallback?: keyof Quote;
}
// Tencent's official adaptHS mapping; undocumented slots remain explicitly unnamed.
// https://st.gtimg.com/quotes/hs-fund/bundle.13362df9.js
export const quoteGroups: { title: string; fields: QuoteField[] }[] = [
  {
    title: "价格与波动",
    fields: [
      { index: 3, label: "最新价", unit: "元", fallback: "latest" },
      { index: 31, label: "涨跌额", unit: "元" },
      { index: 32, label: "涨跌幅", unit: "%", fallback: "change" },
      { index: 5, label: "今开", unit: "元", fallback: "open" },
      { index: 4, label: "昨收", unit: "元", fallback: "previousClose" },
      { index: 51, label: "均价", unit: "元" },
      { index: 33, label: "最高", unit: "元", fallback: "high" },
      { index: 34, label: "最低", unit: "元", fallback: "low" },
      { index: 43, label: "振幅", unit: "%", fallback: "amplitude" },
      { index: 47, label: "涨停价", unit: "元", fallback: "limitUp" },
      { index: 48, label: "跌停价", unit: "元", fallback: "limitDown" },
    ],
  },
  {
    title: "成交与活跃度",
    fields: [
      { index: 36, label: "成交量", unit: "手", fallback: "volume" },
      { index: 57, label: "成交额", unit: "万元" },
      { index: 38, label: "换手率", unit: "%", fallback: "turnover" },
      { index: 49, label: "量比", fallback: "volumeRatio" },
      { index: 7, label: "外盘", unit: "手" },
      { index: 8, label: "内盘", unit: "手" },
      { index: 74, label: "委比", unit: "%" },
    ],
  },
  {
    title: "估值与股本",
    fields: [
      { index: 39, label: "市盈率", fallback: "peRatio" },
      { index: 52, label: "市盈率（动态）" },
      { index: 53, label: "市盈率（静态）" },
      { index: 46, label: "市净率", fallback: "pbRatio" },
      { index: 64, label: "股息率", unit: "%" },
      { index: 56, label: "Beta 系数" },
      { index: 45, label: "总市值", unit: "亿元" },
      { index: 44, label: "流通市值", unit: "亿元", fallback: "floatCap" },
      { index: 73, label: "总股本", unit: "股" },
      { index: 72, label: "流通股本", unit: "股" },
      { index: 76, label: "流通股本（调整）", unit: "股" },
    ],
  },
  {
    title: "阶段表现",
    fields: [
      { index: 62, label: "年初至今", unit: "%" },
      { index: 63, label: "近 5 日涨跌", unit: "%" },
      { index: 70, label: "近 20 日涨跌", unit: "%" },
      { index: 67, label: "52 周最高", unit: "元" },
      { index: 68, label: "52 周最低", unit: "元" },
    ],
  },
  {
    title: "基金净值",
    fields: [
      { index: 78, label: "参考净值 IOPV", unit: "元" },
      { index: 81, label: "单位净值", unit: "元" },
      { index: 77, label: "溢价率", unit: "%" },
    ],
  },
];
export const fieldLabels = new Map<number, string>([
  ...quoteGroups.flatMap((group) =>
    group.fields.map((field) => [field.index, field.label] as [number, string]),
  ),
  [0, "市场标识"],
  [1, "证券名称"],
  [2, "证券代码"],
  [6, "成交量（原始）"],
  [30, "行情时间"],
  [35, "成交摘要"],
  [37, "成交额（万元，取整）"],
  [40, "交易状态"],
  [61, "证券类型"],
  [82, "币种"],
  [84, "证券属性"],
]);
for (let level = 0; level < 5; level++) {
  for (const [base, side] of [
    [9, "买"],
    [19, "卖"],
  ] as const) {
    fieldLabels.set(base + level * 2, `${side}${level + 1}价格（元）`);
    fieldLabels.set(base + level * 2 + 1, `${side}${level + 1}数量（手）`);
  }
}
export function fieldValue(
  quote: Quote | undefined,
  field: QuoteField,
): string {
  const raw = quote?.rawFields?.[field.index];
  if (raw !== undefined) return raw;
  const fallback = field.fallback && quote?.[field.fallback];
  return typeof fallback === "string" ? fallback : "";
}
export function formatQuoteField(
  raw: string,
  unit = "",
  precision = 4,
): string {
  if (!raw.trim()) return "—";
  try {
    const value = new Decimal(raw);
    if (!value.isFinite()) return "—";
    let amount = value;
    if (unit === "万元" && value.abs().gte(10000)) {
      amount = value.div(10000);
      unit = "亿元";
    } else if (unit === "股" && value.abs().gte(100000000)) {
      amount = value.div(100000000);
      unit = "亿股";
    } else if ((unit === "股" || unit === "手") && value.abs().gte(10000)) {
      amount = value.div(10000);
      unit = `万${unit}`;
    }
    return `${Number(amount.toFixed(4)).toLocaleString("zh-CN", { minimumFractionDigits: unit === "元" ? Math.min(4, Math.max(2, value.decimalPlaces())) : 0, maximumFractionDigits: unit === "元" ? 4 : precision })}${unit}`;
  } catch {
    return "—";
  }
}

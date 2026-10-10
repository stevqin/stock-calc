import Decimal from "decimal.js";

export interface HoldingFrame {
  name: string;
  change: string | null;
  profit: string | null;
  stale: boolean;
}
export interface TotalFrame {
  percent: string | null;
  profit: string | null;
  stale: boolean;
}
export type StatusTone = "up" | "down" | "flat";
export interface StatusFrame {
  label: string;
  change: string;
  profit: string;
  changeTone: StatusTone;
  profitTone: StatusTone;
  stale: boolean;
}
export function signed(value: string | null, money = false): string {
  if (value === null) return "—";
  const amount = new Decimal(value).toDecimalPlaces(2);
  if (!amount.isFinite()) return "—";
  const sign = amount.isZero() ? "" : amount.isPositive() ? "+" : "-";
  const text = money
    ? amount
        .abs()
        .toFixed(2)
        .replace(/\.00$/, "")
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : amount.abs().toFixed(2);
  return `${sign}${money ? "¥" : ""}${text}${money ? "" : "%"}`;
}
// Keep menu titles short; the panel retains full precision.
export function compactMoney(value: string | null): string {
  if (value === null) return "—";
  const amount = new Decimal(value);
  const magnitude = amount.abs();
  if (!amount.isFinite() || magnitude.lt(10000)) return signed(value, true);
  const unit = magnitude.gte(100000000) ? "亿" : "万";
  const divisor = unit === "亿" ? 100000000 : 10000;
  return `${amount.isNegative() ? "-" : "+"}¥${magnitude
    .div(divisor)
    .toFixed(2)
    .replace(/\.?0+$/, "")}${unit}`;
}
export function statusBarFrames(
  holdings: HoldingFrame[],
  total: TotalFrame,
): StatusFrame[] {
  return [
    ...holdings.map((row) => ({
      label: `${row.name} `,
      change: signed(row.change),
      profit: compactMoney(row.profit),
      changeTone: statusTone(row.change),
      profitTone: statusTone(row.profit),
      stale: row.stale,
    })),
    {
      label: "合计",
      change: signed(total.percent),
      profit: compactMoney(total.profit),
      changeTone: statusTone(total.percent),
      profitTone: statusTone(total.profit),
      stale: total.stale,
    },
  ];
}

export interface StatusSnapshot {
  frames: StatusFrame[];
  holdings: (HoldingFrame & {
    id: string;
    market: "sh" | "sz";
    code: string;
    shortName: string;
    holdingProfit: string | null;
    price: string | null;
    dailyPercent: string | null;
    holdingPercent: string | null;
  })[];
  total: TotalFrame;
  date: string;
  updatedAt: number;
}
export function statusTone(value: string | null): StatusTone {
  if (value === null) return "flat";
  const amount = new Decimal(value).toDecimalPlaces(2);
  return !amount.isFinite() || amount.isZero()
    ? "flat"
    : amount.gt(0)
      ? "up"
      : "down";
}
const knownNames: Record<string, string> = {
  贵州茅台: "茅台",
  宁德时代: "宁德",
  中国平安: "平安",
  招商银行: "招行",
  工商银行: "工行",
  建设银行: "建行",
  农业银行: "农行",
  中国银行: "中行",
};
export function shortNames(
  rows: { id: string; name: string }[],
  overrides: Record<string, string> = {},
): Record<string, string> {
  const names = rows.map((row) => {
    const override = overrides[row.id]
      ?.trim()
      .replace(/[\r\n\t]/g, "")
      .slice(0, 12);
    if (override) return override;
    const name = row.name.trim();
    if (knownNames[name]) return knownNames[name];
    // ETF providers occur after ETF; keep the theme and distinguishing index number.
    const theme = name
      .split(/ETF/i)[0]
      .replace(/(?:科技|药业|石油|股份|集团|基金)$/, "");
    if (/\d/.test(theme)) return theme;
    return Array.from(theme || name)
      .slice(0, 2)
      .join("");
  });
  const duplicates = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  );
  const resolved = names.map((name, index) =>
    duplicates.has(name) ? rows[index].name : name,
  );
  return Object.fromEntries(
    rows.map((row, index) => [
      row.id,
      resolved.filter((name) => name === resolved[index]).length > 1
        ? `${resolved[index]}·${row.id}`
        : resolved[index],
    ]),
  );
}

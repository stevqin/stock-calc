import Decimal from "decimal.js";
export interface FundFlow {
  market: string;
  code: string;
  mainNet: string;
  quoteTime: string;
  fetchedAt: string;
  source: "东方财富";
}
export function validFundFlow(v: FundFlow): boolean {
  return (
    !!v &&
    ["sh", "sz"].includes(v.market) &&
    /^\d{6}$/.test(v.code) &&
    typeof v.mainNet === "string" &&
    /^-?\d+(\.\d{1,2})?$/.test(v.mainNet) &&
    new Decimal(v.mainNet).abs().lte("1000000000000000") &&
    /^\d{14}$/.test(v.quoteTime) &&
    Number.isFinite(
      Date.parse(
        `${v.quoteTime.slice(0, 4)}-${v.quoteTime.slice(4, 6)}-${v.quoteTime.slice(6, 8)}T${v.quoteTime.slice(8, 10)}:${v.quoteTime.slice(10, 12)}:${v.quoteTime.slice(12, 14)}+08:00`,
      ),
    ) &&
    Number.isFinite(Date.parse(v.fetchedAt)) &&
    v.source === "东方财富"
  );
}
export function flowAmount(flow?: FundFlow, quoteTime?: string): string | null {
  if (!flow || !validFundFlow(flow)) return null;
  // Never mix a previous session's capital flow with a newer price session.
  if (quoteTime && flow.quoteTime.slice(0, 8) !== quoteTime.slice(0, 8))
    return null;
  return flow.mainNet;
}
export function formatFlow(value: string): string {
  const n = new Decimal(value),
    abs = n.abs();
  const unit = abs.gte(100000000) ? "亿" : abs.gte(10000) ? "万" : "";
  return `${n.gt(0) ? "+" : ""}${n.div(unit === "亿" ? 100000000 : unit === "万" ? 10000 : 1).toFixed(2)}${unit}`;
}
export function flowHint(
  flow?: FundFlow,
  error?: string,
  quoteTime?: string,
): string {
  const source =
    "东方财富 · 主力净流入＝超大单净流入＋大单净流入；非ETF申赎资金流";
  if (!flow) return `${source}。${error || "等待资金流数据"}`;
  const t = flow.quoteTime;
  return `${source}。${flowAmount(flow, quoteTime) === null ? "与报价日期不一致，暂不显示。" : ""}数据时间 ${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12)}；获取时间 ${new Date(flow.fetchedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}。${error ? `更新失败，保留旧数据：${error}` : "可能延迟，以数据时间为准"}`;
}

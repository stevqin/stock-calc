// Only translates known internal labels in displayed prose; does not change raw reports or numbers.
export function readableReportText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/policy\s*(?:为|=|:)\s*tFirst/g, "处理偏好为保留底仓、优先做T")
    .replace(/policy\s*(?:为|=|:)\s*riskFirst/g, "处理偏好为优先减仓控风险")
    .replace(/policy\s*(?:为|=|:)\s*averageDown/g, "处理偏好为有条件评估加仓")
    .replace(/tPercent\s*(?:为|=|:)\s*(\d+)\s*%?/g, "单轮做T比例上限为$1%")
    .replace(
      /verifiedTCandidates\s*(?:为空|=\s*\[\])/g,
      "本次没有通过费用、资金和股数检查的做T价格组合",
    )
    .replace(/quoteIsCurrent\s*(?:为|=|:)\s*false/g, "报价未通过更新时间检查")
    .replace(/quoteIsCurrent\s*(?:为|=|:)\s*true/g, "报价已通过更新时间检查")
    .replace(/tFirst/g, "保留底仓、优先做T");
}

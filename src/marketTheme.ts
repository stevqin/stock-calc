export const MARKET_COLORS = {
  gain: "#c6414b",
  loss: "#48a579",
  flat: "#8f9190",
} as const;
export function marketColor(change: number) {
  return change > 0
    ? MARKET_COLORS.gain
    : change < 0
      ? MARKET_COLORS.loss
      : MARKET_COLORS.flat;
}

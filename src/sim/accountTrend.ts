import type { Entry, CashEntry } from "./model";
export interface TrendEvents {
  trades: { securityId: string; label: "B" | "S" | "T"; entries: Entry[] }[];
  transfers: CashEntry[];
}
/** Same-security daily buy/sell labels, never a profitability or successful-T claim. */
export function accountTrendEvents(entries: Entry[], cash: CashEntry[]) {
  const result = new Map<string, TrendEvents>();
  const at = (date: string) => {
    let events = result.get(date);
    if (!events) {
      events = { trades: [], transfers: [] };
      result.set(date, events);
    }
    return events;
  };
  for (const entry of [...entries].sort((a, b) =>
    a.time.localeCompare(b.time),
  )) {
    if (entry.kind === "opening") continue;
    const events = at(entry.date);
    let group = events.trades.find(
      (group) => group.securityId === entry.securityId,
    );
    if (!group) {
      group = {
        securityId: entry.securityId,
        label: entry.kind === "buy" ? "B" : "S",
        entries: [],
      };
      events.trades.push(group);
    }
    group.entries.push(entry);
    if (
      group.entries.some((e) => e.kind === "buy") &&
      group.entries.some((e) => e.kind === "sell")
    )
      group.label = "T";
  }
  for (const entry of [...cash].sort((a, b) => a.time.localeCompare(b.time))) {
    if (entry.kind === "deposit" || entry.kind === "withdraw")
      at(entry.date).transfers.push(entry);
  }
  return result;
}
type Point = { x: number; y: number | null };
/** Monotone cubic interpolation of presentation coordinates, never synthetic account values. */
export function smoothPath(points: Point[]): string {
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ x: point.x, y: point.y });
  }
  if (current.length) segments.push(current);
  const n = (value: number) => String(Math.round(value * 10000) / 10000);
  return segments
    .map((segment) => {
      let path = `M${n(segment[0].x)},${n(segment[0].y)}`;
      if (segment.length === 1) return path;
      const slopes = segment
        .slice(1)
        .map((point, i) => (point.y - segment[i].y) / (point.x - segment[i].x));
      const tangents = segment.map((_, i) =>
        i === 0
          ? slopes[0]
          : i === segment.length - 1
            ? slopes.at(-1)!
            : slopes[i - 1] * slopes[i] <= 0
              ? 0
              : 2 / (1 / slopes[i - 1] + 1 / slopes[i]),
      );
      for (let i = 0; i < slopes.length; i++) {
        if (slopes[i] === 0) {
          tangents[i] = 0;
          tangents[i + 1] = 0;
          continue;
        }
        const a = tangents[i] / slopes[i],
          b = tangents[i + 1] / slopes[i],
          norm = Math.hypot(a, b);
        if (norm > 3) {
          tangents[i] = ((3 * a) / norm) * slopes[i];
          tangents[i + 1] = ((3 * b) / norm) * slopes[i];
        }
      }
      for (let i = 0; i < segment.length - 1; i++) {
        const a = segment[i],
          b = segment[i + 1],
          dx = (b.x - a.x) / 3;
        const low = Math.min(a.y, b.y),
          high = Math.max(a.y, b.y);
        const clamp = (value: number) => Math.min(high, Math.max(low, value));
        path += ` C${n(a.x + dx)},${n(clamp(a.y + tangents[i] * dx))} ${n(b.x - dx)},${n(clamp(b.y - tangents[i + 1] * dx))} ${n(b.x)},${n(b.y)}`;
      }
      return path;
    })
    .join(" ");
}

/** Compact bounds must remain distinguishable at the displayed range's precision. */
export function axisRangeLabels(min: number, max: number) {
  const largest = Math.max(Math.abs(min), Math.abs(max));
  const divisor =
    largest >= 100000000 ? 100000000 : largest >= 10000 ? 10000 : 1;
  const unit = divisor === 100000000 ? "亿" : divisor === 10000 ? "万" : "";
  const span = Math.abs(max - min) / divisor;
  let precision =
    divisor === 1
      ? 2
      : Math.min(8, Math.max(1, Math.ceil(-Math.log10(span * 0.1))));
  let low = (min / divisor).toFixed(precision),
    high = (max / divisor).toFixed(precision);
  while (low === high && min !== max && precision < 8) {
    precision++;
    low = (min / divisor).toFixed(precision);
    high = (max / divisor).toFixed(precision);
  }
  if (low === high && min !== max)
    return { min: min.toFixed(2), max: max.toFixed(2) };
  return { min: `${low}${unit}`, max: `${high}${unit}` };
}
/** Cluster at actual first-event anchors, with every underlying date retained. */
export function groupNearbyEvents<T extends { x: number }>(
  points: T[],
  width: number,
  minimumGap = 68,
) {
  const groups: T[][] = [];
  for (const point of points) {
    const last = groups.at(-1);
    if (last && ((point.x - last[0].x) / 1000) * width < minimumGap)
      last.push(point);
    else groups.push([point]);
  }
  return groups;
}

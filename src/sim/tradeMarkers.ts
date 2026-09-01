import type { Entry } from "./model";
import { INTRADAY_TIMES, intradayTimeIndex, type ChartData } from "./chart";
export interface TradeMarker {
  side: "buy" | "sell" | "t";
  index: number;
  anchor: number;
  trades: Entry[];
  approximate: boolean;
}
/** Anchor to the displayed chart, not the unadjusted execution price. */
export function tradeMarkers(data: ChartData, entries: Entry[]): TradeMarker[] {
  const daily = data.mode === "daily" || data.mode === "daily-raw";
  const groups = new Map<string, TradeMarker>();
  const bars = new Map(
    data.bars.map((bar, index) => [bar.date, { bar, index }]),
  );
  let offset = 0;
  const sessions = new Map(
    data.sessions.map((session, i) => {
      if (i) offset++;
      const result = { session, offset };
      offset += INTRADAY_TIMES.length;
      return [session.date, result] as const;
    }),
  );
  for (const e of entries) {
    if (e.securityId !== data.symbol || (e.kind !== "buy" && e.kind !== "sell"))
      continue;
    let index: number,
      anchor: number,
      approximate = false;
    if (daily) {
      const match = bars.get(e.date);
      if (!match) continue;
      index = match.index;
      anchor = Number(e.kind === "buy" ? match.bar.low : match.bar.high);
    } else {
      const match = sessions.get(e.date.replaceAll("-", ""));
      if (!match) continue;
      const t = new Date(Date.parse(e.time) + 8 * 3600000);
      const minute = t.getUTCHours() * 60 + t.getUTCMinutes();
      if (
        !Number.isFinite(minute) ||
        !((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900))
      )
        continue;
      let best = -1,
        distance = Infinity;
      for (let i = 0; i < match.session.points.length; i++) {
        const time = match.session.points[i].time;
        const diff = Math.abs(
          Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4)) - minute,
        );
        if (diff < distance) {
          best = i;
          distance = diff;
        }
      }
      // Do not snap missing morning trades to afternoon, or old/future fills to a chart edge.
      if (best < 0 || distance > 2) continue;
      const point = match.session.points[best];
      const pointMinute =
        Number(point.time.slice(0, 2)) * 60 + Number(point.time.slice(2, 4));
      if (minute <= 690 !== pointMinute <= 690) continue;
      const timeIndex = intradayTimeIndex(point.time);
      if (timeIndex < 0) continue;
      index = match.offset + timeIndex;
      anchor = Number(point.price);
      approximate = distance > 0;
    }
    if (!Number.isFinite(anchor) || anchor <= 0) continue;
    const key = daily ? String(index) : `${index}:${e.kind}`;
    let marker = groups.get(key);
    if (!marker) {
      marker = { side: e.kind, index, anchor, trades: [], approximate };
      groups.set(key, marker);
    }
    if (daily && marker.side !== e.kind) {
      marker.side = "t";
      marker.anchor = Number(data.bars[index].high);
    }
    marker.trades.push(e);
    marker.approximate ||= approximate;
  }
  return [...groups.values()].sort(
    (a, b) => a.index - b.index || a.side.localeCompare(b.side),
  );
}
export function markerTooltip(marker: TradeMarker): string {
  const label =
    marker.side === "t"
      ? "T 同日买卖"
      : marker.side === "buy"
        ? "B 买入"
        : "S 卖出";
  const lines = [...marker.trades]
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .map(
      (e) =>
        `${e.kind === "buy" ? "B 买入" : "S 卖出"} · ${new Date(e.time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}\n成交价 ${e.price} 元 · 数量 ${e.quantity} 股/份`,
    );
  return `${label} · ${marker.trades.length}笔\n${lines.join("\n")}\n标记沿行情定位，以上为原始成交价${marker.approximate ? "；已就近匹配分时点" : ""}`;
}

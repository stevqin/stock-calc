export type ChartMode = "daily" | "daily-raw" | "intraday" | "five-day";
export interface ChartData {
  symbol: string;
  mode: ChartMode;
  adjustment: string;
  fetchedAt: string;
  bars: {
    date: string;
    open: string;
    close: string;
    high: string;
    low: string;
    volume: string;
  }[];
  sessions: {
    date: string;
    previousClose: string | null;
    points: {
      time: string;
      price: string;
      volume: string;
      amount: string | null;
    }[];
  }[];
}

function tradingTimes(
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
) {
  const result: string[] = [];
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  for (let minute = start; minute <= end; minute++) {
    result.push(
      `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`,
    );
  }
  return result;
}

/** A 股和场内 ETF 的完整连续竞价分钟轴，不包含午间休市。 */
export const INTRADAY_TIMES = [
  ...tradingTimes(9, 30, 11, 30),
  ...tradingTimes(13, 0, 15, 0),
] as const;

const intradayTimeIndexes = new Map(
  INTRADAY_TIMES.map((time, index) => [time, index]),
);

export function intradayTimeIndex(time: string): number {
  return intradayTimeIndexes.get(time) ?? -1;
}

/**
 * 分时横轴只显示交易时段的关键边界。午休前后两个相邻刻度错行展示，
 * 避免 ECharts 自动抽样时把 11:30、13:00 或尚未发生的 15:00 隐藏。
 */
export function intradayAxisLabel(label: string, mode: ChartMode): string {
  const [date = "", time = ""] = label.split(" ");
  if (!time) return "";
  if (mode === "five-day") {
    if (time === "09:30") return `${date}\n09:30`;
    if (time === "15:00") return "15:00";
    return "";
  }
  if (time === "09:30" || time === "15:00") return time;
  if (time === "11:30") return "11:30\n";
  if (time === "13:00") return "\n13:00";
  return "";
}

export function chartSeries(data: ChartData) {
  const labels: string[] = [],
    price: (number | null)[] = [],
    average: (number | null)[] = [],
    volume: (number | null)[] = [],
    baseline: (number | null)[] = [];
  for (const [index, s] of data.sessions.entries()) {
    if (index) {
      labels.push("");
      price.push(null);
      average.push(null);
      volume.push(null);
      baseline.push(null);
    }
    let previous = 0;
    const points = new Map(
      s.points
        .filter((point) => intradayTimeIndex(point.time) >= 0)
        .map((point) => [point.time, point]),
    );
    for (const time of INTRADAY_TIMES) {
      const p = points.get(time);
      const v = p ? Number(p.volume) : 0;
      labels.push(
        `${s.date.slice(4, 6)}-${s.date.slice(6)} ${time.slice(0, 2)}:${time.slice(2)}`,
      );
      price.push(p ? Number(p.price) : null);
      average.push(
        p?.amount !== null && p?.amount !== undefined && v > 0
          ? Number(p.amount) / (v * 100)
          : null,
      );
      volume.push(p ? Math.max(0, v - previous) : null);
      baseline.push(s.previousClose ? Number(s.previousClose) : null);
      if (p) previous = v;
    }
  }
  return { labels, price, average, volume, baseline };
}

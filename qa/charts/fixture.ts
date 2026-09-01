import type { ChartData, ChartMode } from "../../src/sim/chart";
export const isTauri = () => true;
export const marketQuotes = {};
export const liveDaily = (d: ChartData) => d;
export async function getChart(
  s: { id: string },
  mode: ChartMode,
): Promise<ChartData> {
  const dates = ["20260825", "20260826", "20260827", "20260828", "20260831"];
  return {
    symbol: s.id,
    mode,
    adjustment: "合成验收数据（非实时行情）",
    fetchedAt: "2026-08-31T07:00:00Z",
    bars: Array.from({ length: 50 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 31) - (49 - i) * 86400000);
      const v = 10 + Math.sin(i / 4);
      return {
        date: d.toISOString().slice(0, 10),
        open: v.toFixed(3),
        close: (v + 0.1).toFixed(3),
        high: (v + 0.2).toFixed(3),
        low: (v - 0.2).toFixed(3),
        volume: String(1000 + i * 30),
      };
    }),
    sessions: (mode === "intraday" ? dates.slice(-1) : dates).map(
      (date, day) => ({
        date,
        previousClose: "10",
        // 分时只返回截至 11:09 的行情，用来验收图表仍保留到 15:00 的完整时间轴。
        points: Array.from(
          { length: mode === "intraday" ? 100 : 242 },
          (_, i) => {
            const minute = i <= 120 ? 570 + i : 780 + i - 121;
            return {
              time:
                String(Math.floor(minute / 60)).padStart(2, "0") +
                String(minute % 60).padStart(2, "0"),
              price: (10 + Math.sin(i / 20) * 0.1 + day * 0.03).toFixed(3),
              volume: String((i + 1) * 100),
              amount: null,
            };
          },
        ),
      }),
    ),
  };
}

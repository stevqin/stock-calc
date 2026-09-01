import { describe, it, expect } from "vitest";
import { tradeMarkers, markerTooltip } from "./tradeMarkers";
import type { ChartData } from "./chart";
import type { Entry } from "./model";
const entry = (changes: Partial<Entry> = {}): Entry => ({
  id: "b",
  securityId: "sh510300",
  kind: "buy",
  price: "20",
  quantity: "100",
  date: "2026-08-31",
  time: "2026-08-31T01:30:30Z",
  ...changes,
});
const chart = (mode: ChartData["mode"]): ChartData => ({
  symbol: "sh510300",
  mode,
  adjustment: "前复权",
  fetchedAt: "2026-08-31T06:00:00Z",
  bars: [
    {
      date: "2026-08-31",
      open: "10",
      close: "11",
      low: "9",
      high: "12",
      volume: "100",
    },
  ],
  sessions: [
    {
      date: "20260828",
      previousClose: "10",
      points: [{ time: "0930", price: "10", volume: "100", amount: null }],
    },
    {
      date: "20260831",
      previousClose: "10",
      points: [
        { time: "0930", price: "11", volume: "100", amount: null },
        { time: "0931", price: "12", volume: "200", amount: null },
        { time: "1300", price: "13", volume: "300", amount: null },
      ],
    },
  ],
});
describe("真实成交BS标记", () => {
  it("日K按交易日及复权后的K线定位，悬停保留原成交价", () => {
    const m = tradeMarkers(chart("daily"), [
      entry(),
      entry({ kind: "sell", id: "s" }),
    ]);
    expect(m.map((x) => [x.side, x.index, x.anchor])).toEqual([["t", 0, 12]]);
    expect(markerTooltip(m[0])).toContain("成交价 20 元");
    expect(markerTooltip(m[0])).toContain("数量 100");
    expect(markerTooltip(m[0])).toContain("T 同日买卖 · 2笔");
    expect(markerTooltip(m[0])).toContain("B 买入");
    expect(markerTooltip(m[0])).toContain("S 卖出");
  });
  it.each(["daily", "daily-raw"] as const)(
    "%s不等量及先卖后买也合并为T，多笔不遗漏",
    (mode) => {
      const trades = [
        entry({ kind: "sell", id: "s", quantity: "300" }),
        entry(),
        entry({ id: "b2", quantity: "200" }),
      ];
      const markers = tradeMarkers(chart(mode), trades);
      expect(markers).toHaveLength(1);
      expect(markers[0].side).toBe("t");
      expect(markers[0].trades).toHaveLength(3);
      expect(tradeMarkers(chart(mode), trades.slice(1))[0].side).toBe("buy");
      expect(tradeMarkers(chart(mode), trades.slice(0, 1))[0].side).toBe(
        "sell",
      );
    },
  );
  it("不同交易日的买卖不合并为T", () => {
    const data = chart("daily");
    data.bars.push({ ...data.bars[0], date: "2026-09-01" });
    expect(
      tradeMarkers(data, [
        entry(),
        entry({ kind: "sell", date: "2026-09-01" }),
      ]).map((m) => m.side),
    ).toEqual(["buy", "sell"]);
  });
  it("仅标记当前证券、可见交易日的买卖，不伪造建仓快照成交", () => {
    expect(
      tradeMarkers(chart("daily"), [
        entry({ kind: "opening" }),
        entry({ securityId: "sz002465" }),
        entry({ date: "2026-08-27" }),
      ]),
    ).toEqual([]);
  });
  it("五日分时按上海时间并包含跨日空格偏移", () => {
    const m = tradeMarkers(chart("five-day"), [
      entry(),
      entry({ date: "2026-08-28", time: "2026-08-28T01:30:00Z", id: "old" }),
    ]);
    expect(m.map((x) => [x.index, x.anchor])).toEqual([
      [0, 10],
      [243, 11],
    ]);
  });
  it("同一分钟同方向合并，不丢笔数；相反方向分开", () => {
    const m = tradeMarkers(chart("intraday"), [
      entry(),
      entry({ id: "b2" }),
      entry({ id: "s", kind: "sell" }),
    ]);
    expect(m.map((x) => x.trades.length)).toEqual([2, 1]);
    expect(markerTooltip(m[0])).toContain("2笔");
  });
  it("缺少一分钟时就近匹配并提示，不把午休或范围外成交贴到边缘", () => {
    expect(
      tradeMarkers(chart("intraday"), [
        entry({ time: "2026-08-31T01:32:00Z" }),
      ])[0].approximate,
    ).toBe(true);
    for (const time of ["04:00", "01:29", "01:40", "07:01"])
      expect(
        tradeMarkers(chart("intraday"), [
          entry({ time: `2026-08-31T${time}:00Z` }),
        ]),
      ).toEqual([]);
  });
  it("删除和修改成交后重新生成，不保留旧点", () => {
    expect(tradeMarkers(chart("daily"), [])).toEqual([]);
    expect(
      tradeMarkers(chart("daily"), [entry({ kind: "sell" })])[0].side,
    ).toBe("sell");
  });
});

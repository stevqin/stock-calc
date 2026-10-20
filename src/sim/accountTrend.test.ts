import { describe, expect, it } from "vitest";
import { smoothPath, accountTrendEvents } from "./accountTrend";
import type { Entry, CashEntry } from "./model";
describe("account trend presentation", () => {
  it("uses cubic curves through original anchors, without overshoot or gap bridging", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 80 },
      { x: 30, y: null },
      { x: 40, y: 60 },
      { x: 50, y: 50 },
    ];
    const path = smoothPath(points);
    expect(path).toContain("C");
    expect(path).not.toContain("L");
    expect(path.match(/M/g)).toHaveLength(2);
    const commands = [
      ...path.matchAll(
        /C([\d.e+-]+),([\d.e+-]+) ([\d.e+-]+),([\d.e+-]+) ([\d.e+-]+),([\d.e+-]+)/g,
      ),
    ];
    expect(commands).toHaveLength(3);
    const starts = [100, 20, 60];
    const ends = [20, 80, 50];
    commands.forEach((command, i) => {
      for (const index of [2, 4]) {
        expect(Number(command[index])).toBeGreaterThanOrEqual(
          Math.min(starts[i], ends[i]),
        );
        expect(Number(command[index])).toBeLessThanOrEqual(
          Math.max(starts[i], ends[i]),
        );
      }
    });
  });
  it("marks T only for same-security same-day buys and sells, and only real transfers as flows", () => {
    const entry = (
      id: string,
      securityId: string,
      kind: Entry["kind"],
    ): Entry => ({
      id,
      securityId,
      kind,
      date: "2026-10-19",
      time: "2026-10-19T01:00:00.000Z",
      price: "10",
      quantity: "100",
    });
    const trades = [
      entry("a", "one", "buy"),
      entry("b", "two", "sell"),
      entry("c", "three", "buy"),
      entry("d", "three", "sell"),
      entry("o", "four", "opening"),
    ];
    const cash = (id: string, kind: CashEntry["kind"]): CashEntry => ({
      id,
      kind,
      date: "2026-10-19",
      time: "2026-10-19T01:00:00.000Z",
      amount: "100",
      note: "",
    });
    const before = JSON.stringify(trades);
    const events = accountTrendEvents(trades, [
      cash("in", "deposit"),
      cash("out", "withdraw"),
      cash("interest", "interest"),
      cash("old", "legacy-balance"),
    ]).get("2026-10-19")!;
    expect(events.trades.map((group) => group.label)).toEqual(["B", "S", "T"]);
    expect(events.trades[2].entries).toHaveLength(2);
    expect(events.transfers.map((flow) => flow.id)).toEqual(["in", "out"]);
    expect(JSON.stringify(trades)).toBe(before);
  });
});

it("keeps axis bounds distinct for large assets with small daily changes", async () => {
  const { axisRangeLabels } = await import("./accountTrend");
  const labels = axisRangeLabels(1000000, 1000100);
  expect(labels.min).not.toBe(labels.max);
  expect(labels.min).toContain("100.00");
  expect(labels.max).toContain("100.01");
  expect(axisRangeLabels(7055.49, 7055.51)).toEqual({
    min: "7055.49",
    max: "7055.51",
  });
});
it("clusters dense event dates without dropping any original dates", async () => {
  const { groupNearbyEvents } = await import("./accountTrend");
  const points = Array.from({ length: 365 }, (_, index) => ({
    x: (index / 364) * 1000,
    index,
  }));
  const groups = groupNearbyEvents(points, 400);
  expect(groups.length).toBeLessThan(10);
  expect(groups.flat().map((point) => point.index)).toEqual(
    points.map((point) => point.index),
  );
  for (let i = 1; i < groups.length; i++)
    expect((groups[i][0].x - groups[i - 1][0].x) * 0.4).toBeGreaterThanOrEqual(
      68,
    );
});

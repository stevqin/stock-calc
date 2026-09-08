import { describe, expect, it } from "vitest";
import {
  analyzeAccount,
  summarizeAnalysis,
  monthSequence,
  shiftMonth,
} from "./analysis";
import { newAccount, replay } from "./ledger";
import { recordFees } from "./recordMath";
import type { Account, Entry } from "./model";
import type { ChartData } from "./chart";
import type { Quote } from "../quotes";
const id = "sh510300";
const profile = {
  commissionWan: "0",
  minimum: "1",
  stampPercent: "0",
  transferPercent: "0",
};
function trade(
  date: string,
  kind: Entry["kind"],
  price: string,
  quantity = "100",
  order = 0,
): Entry {
  return {
    id: `${date}-${kind}-${order}`,
    securityId: id,
    kind,
    date,
    time: `${date}T0${order}:00:00.000Z`,
    price,
    quantity,
    available: quantity,
    profile,
    ...(kind === "opening"
      ? {}
      : { fees: recordFees(kind, price, quantity, profile) }),
  };
}
function account(entries: Entry[]): Account {
  return {
    ...newAccount(),
    initialized: true,
    schemaVersion: 3,
    initialCash: "0.00",
    cashEntries: [],
    entries,
  };
}
function bars(values: Record<string, string>): ChartData {
  return {
    symbol: id,
    mode: "daily-raw",
    adjustment: "不复权",
    fetchedAt: "",
    sessions: [],
    bars: Object.entries(values).map(([date, close]) => ({
      date,
      close,
      open: close,
      high: close,
      low: close,
      volume: "1",
    })),
  };
}
const sum = (
  a: ReturnType<typeof analyzeAccount>,
  start = a.start,
  end = a.end,
) => summarizeAnalysis(a, start, end);
describe("analysis", () => {
  it("excludes idle cash and chains securities daily returns without daily rounding", () => {
    const a = account([
      trade("2026-08-24", "buy", "10"),
      trade("2026-08-25", "sell", "11"),
    ]);
    a.cashEntries = [
      {
        id: "deposit",
        kind: "deposit",
        amount: "2000",
        date: "2026-08-24",
        time: "2026-08-24T00:00:00Z",
        note: "",
      },
    ];
    const result = analyzeAccount(
      a,
      { [id]: bars({ "2026-08-24": "10" }) },
      {},
      "2026-08-26",
    );
    expect(result.days[0].returnBase).toBe("1001.00");
    expect(result.days[0].returnRate).toBe("-0.10");
    expect(result.days[1].returnBase).toBe("1000.00");
    expect(result.days[1].returnRate).toBe("9.90");
    expect(sum(result).returnRate).toBe("9.79");
    a.cashEntries = [];
    expect(
      sum(
        analyzeAccount(
          a,
          { [id]: bars({ "2026-08-24": "10" }) },
          {},
          "2026-08-26",
        ),
      ).returnRate,
    ).toBe("9.79");
  });
  it("cash income and transfers do not create a securities return", () => {
    const a = account([]);
    a.cashEntries = [
      {
        id: "capital",
        kind: "deposit",
        amount: "1000",
        date: "2026-08-24",
        time: "2026-08-24T00:00:00Z",
        note: "",
      },
      {
        id: "income1",
        kind: "interest",
        amount: "100",
        date: "2026-08-24",
        time: "2026-08-24T01:00:00Z",
        note: "",
      },
      {
        id: "add",
        kind: "deposit",
        amount: "1100",
        date: "2026-08-25",
        time: "2026-08-25T00:00:00Z",
        note: "",
      },
      {
        id: "income2",
        kind: "interest",
        amount: "220",
        date: "2026-08-25",
        time: "2026-08-25T01:00:00Z",
        note: "",
      },
      {
        id: "remove",
        kind: "withdraw",
        amount: "2420",
        date: "2026-08-26",
        time: "2026-08-26T00:00:00Z",
        note: "",
      },
    ];
    const result = analyzeAccount(a, {}, {}, "2026-08-27");
    expect(result.days.map((d) => d.returnRate)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(sum(result).returnRate).toBeNull();
    expect(sum(result, "2026-08-25", "2026-08-25").returnRate).toBeNull();
    expect(sum(result).profit).toBe("320.00");
  });
  it("never invents rates for missing valuation or zero securities basis", () => {
    const unfunded = account([trade("2026-08-24", "buy", "10")]);
    const result = analyzeAccount(
      unfunded,
      { [id]: bars({ "2026-08-24": "11" }) },
      {},
      "2026-08-24",
    );
    expect(sum(result).profit).toBe("99.00");
    expect(sum(result).returnRate).toBe("9.89");
    const funded = account(unfunded.entries);
    funded.initialCash = "2000";
    expect(
      sum(analyzeAccount(funded, {}, {}, "2026-08-24")).returnRate,
    ).toBeNull();
    const incomeOnly = account([]);
    incomeOnly.cashEntries = [
      {
        id: "interest",
        kind: "interest",
        amount: "10",
        date: "2026-08-24",
        time: "2026-08-24T00:00:00Z",
        note: "",
      },
    ];
    expect(
      sum(analyzeAccount(incomeOnly, {}, {}, "2026-08-24")).returnRate,
    ).toBeNull();
    expect(
      sum(analyzeAccount(account([]), {}, {}, "2026-08-24")).returnRate,
    ).toBeNull();
  });
  it("nets buys and sells across securities before flooring daily investment, and excludes interest", () => {
    const a = account([
      trade("2026-08-24", "buy", "10"),
      trade("2026-08-25", "sell", "11"),
      { ...trade("2026-08-25", "buy", "10", "100", 1), securityId: "sz159915" },
    ]);
    a.cashEntries = [
      {
        id: "interest",
        kind: "interest",
        amount: "10",
        date: "2026-08-25",
        time: "2026-08-25T02:00:00Z",
        note: "",
      },
    ];
    const b = bars({ "2026-08-25": "10" });
    b.symbol = "sz159915";
    const result = analyzeAccount(
      a,
      { [id]: bars({ "2026-08-24": "10" }), sz159915: b },
      {},
      "2026-08-25",
    );
    expect(result.days[1]).toMatchObject({
      profit: "108.00",
      returnBase: "1000.00",
      returnRate: "9.80",
    });
    expect(sum(result).returnRate).toBe("9.69");
  });
  it("reconstructs net 98, costs once, and closes only after sell day", () => {
    const a = account([
      trade("2026-08-24", "buy", "10"),
      trade("2026-08-25", "sell", "11"),
    ]);
    const result = analyzeAccount(
      a,
      { [id]: bars({ "2026-08-24": "10" }) },
      {},
      "2026-08-26",
    );
    expect(result.days.map((d) => d.profit)).toEqual([
      "-1.00",
      "99.00",
      "0.00",
    ]);
    expect(sum(result)).toMatchObject({
      profit: "98.00",
      realized: "98.00",
      unrealizedChange: "0.00",
      fees: "2.00",
      wins: 1,
      closed: 1,
      winRate: "100.00",
      averageWin: "98.00",
      averageLoss: null,
    });
    expect(sum(result, "2026-08-25", "2026-08-25").closed).toBe(1);
    expect(analyzeAccount(a, {}, {}, "2026-08-25").cycles).toEqual([]);
  });
  it("uses untraded daily mark changes and FIFO partial cost allocation", () => {
    const a = account([
      trade("2026-08-24", "buy", "10", "3"),
      trade("2026-08-25", "buy", "12", "2"),
      trade("2026-08-26", "sell", "13", "2"),
    ]);
    const result = analyzeAccount(
      a,
      {
        [id]: bars({
          "2026-08-24": "10",
          "2026-08-25": "12",
          "2026-08-26": "13",
          "2026-08-27": "14",
        }),
      },
      {},
      "2026-08-27",
    );
    expect(sum(result).realized).toBe(replay(a, "2026-08-27").realized);
    expect(sum(result).profit).toBe("11.00");
    expect(result.days.at(-1)?.profit).toBe("3.00");
  });
  it("keeps same-day sell/rebuy in one cycle", () => {
    const a = account([
      trade("2026-08-24", "buy", "10"),
      trade("2026-08-25", "sell", "11"),
      trade("2026-08-25", "buy", "12", "100", 1),
      trade("2026-08-26", "sell", "13"),
    ]);
    const result = analyzeAccount(a, {}, {}, "2026-08-27");
    expect(result.cycles).toEqual([
      {
        securityId: id,
        start: "2026-08-24",
        end: "2026-08-26",
        profit: "196.00",
      },
    ]);
  });
  it("includes income and excludes capital flows, including weekends", () => {
    const a = account([]);
    a.cashEntries = ["deposit", "withdraw", "interest"].map((kind, i) => ({
      id: String(i),
      kind: kind as "deposit" | "withdraw" | "interest",
      date: "2026-08-29",
      time: `2026-08-29T0${i}:00:00.000Z`,
      amount: "10.00",
      note: "",
    }));
    expect(sum(analyzeAccount(a, {}, {}, "2026-08-29"))).toMatchObject({
      profit: "10.00",
      income: "10.00",
      unrealizedChange: "0.00",
      winRate: null,
      averageWin: null,
    });
  });
  it("does not invent snapshot baseline or bridge missing weekdays", () => {
    const a = account([trade("2026-08-24", "opening", "10")]);
    const r = analyzeAccount(
      a,
      {
        [id]: bars({
          "2026-08-24": "10",
          "2026-08-26": "12",
          "2026-08-27": "13",
        }),
      },
      {},
      "2026-08-27",
    );
    expect(r.days.map((d) => d.profit)).toEqual([null, null, null, "100.00"]);
    expect(sum(r)).toMatchObject({ profit: null, missingDays: 3 });
  });
  it("ignores adjusted bars, outdated quotes, and all quotes for historical dates", () => {
    const a = account([trade("2026-08-24", "buy", "10")]);
    const raw = bars({ "2026-08-24": "10", "2026-08-25": "11" });
    const q = { latest: "99", quoteTime: "20260824150000" } as Quote;
    expect(
      analyzeAccount(a, { [id]: raw }, { [id]: q }, "2026-08-25").days[0]
        .profit,
    ).toBe("-1.00");
    expect(
      analyzeAccount(
        a,
        { [id]: { ...raw, adjustment: "前复权" } },
        { [id]: q },
        "2026-08-25",
      ).days[0].profit,
    ).toBeNull();
    expect(
      analyzeAccount(
        a,
        { [id]: bars({ "2026-08-24": "10" }) },
        { [id]: q },
        "2026-08-25",
      ).days[1].profit,
    ).toBeNull();
    q.quoteTime = "20260825120000";
    q.latest = "11";
    expect(
      analyzeAccount(a, { [id]: raw }, { [id]: q }, "2026-08-25").days[1]
        .profit,
    ).toBe("100.00");
  });
  it("counts flat cycles in win denominator and handles empty accounts", () => {
    const a = account([
      trade("2026-08-24", "buy", "10"),
      trade("2026-08-25", "sell", "10.02"),
    ]);
    expect(sum(analyzeAccount(a, {}, {}, "2026-08-26"))).toMatchObject({
      closed: 1,
      flat: 1,
      winRate: "0.00",
      averageWin: null,
      averageLoss: null,
    });
    expect(analyzeAccount(account([]), {}, {}, "2026-08-26").days).toEqual([]);
  });
  it("supports known holiday gaps but keeps absent benchmark coverage conservative", () => {
    const a = account([trade("2026-08-24", "buy", "10")]);
    const raw = bars({ "2026-08-24": "10", "2026-08-26": "11" });
    const r = analyzeAccount(a, { [id]: raw }, {}, "2026-08-27", {
      calendar: raw,
      calendarCoverage: [{ start: "2026-08-24", end: "2026-08-26" }],
    });
    expect(r.days.map((d) => d.profit)).toEqual([
      "-1.00",
      "0.00",
      "100.00",
      null,
    ]);
  });
  it("handles weekend baselines and all historical securities without watchlist membership", () => {
    const a = account([trade("2026-08-28", "buy", "10")]);
    a.securities = [];
    const r = analyzeAccount(
      a,
      { [id]: bars({ "2026-08-28": "10", "2026-08-31": "11" }) },
      {},
      "2026-08-31",
    );
    expect(r.days.map((d) => d.profit)).toEqual([
      "-1.00",
      "0.00",
      "0.00",
      "100.00",
    ]);
  });
  it("keeps current-day cycles open until the supplied Shanghai close", () => {
    const a = account([
      trade("2026-08-24", "buy", "10"),
      trade("2026-08-25", "sell", "11"),
    ]);
    expect(
      analyzeAccount(a, {}, {}, "2026-08-25", {
        now: new Date("2026-08-25T06:59:00Z"),
      }).cycles,
    ).toHaveLength(0);
    expect(
      analyzeAccount(a, {}, {}, "2026-08-25", {
        now: new Date("2026-08-25T07:00:00Z"),
      }).cycles,
    ).toHaveLength(1);
  });
  it("retains the full negative cycle profit when the chosen interval starts after entry", () => {
    const a = account([
      trade("2026-08-24", "buy", "10"),
      trade("2026-08-25", "sell", "9"),
    ]);
    const r = analyzeAccount(
      a,
      { [id]: bars({ "2026-08-24": "10" }) },
      {},
      "2026-08-26",
    );
    expect(sum(r, "2026-08-25", "2026-08-25")).toMatchObject({
      profit: "-101.00",
      averageLoss: "-102.00",
      losses: 1,
      closed: 1,
      winRate: "0.00",
    });
  });
  it("reconciles repeated fractional FIFO allocations with ledger cumulative rounding", () => {
    const a = account([
      trade("2026-08-24", "buy", "10.123456", "3"),
      trade("2026-08-25", "sell", "11", "1"),
      trade("2026-08-26", "sell", "12", "1"),
      trade("2026-08-27", "sell", "13", "1"),
    ]);
    const r = analyzeAccount(
      a,
      {
        [id]: bars({
          "2026-08-24": "10",
          "2026-08-25": "11",
          "2026-08-26": "12",
        }),
      },
      {},
      "2026-08-28",
    );
    expect(sum(r).realized).toBe(replay(a, "2026-08-28").realized);
    expect(sum(r).profit).toBe("1.63");
    expect(r.cycles[0].profit).toBe("1.63");
  });
  it("uses a fresh baseline after a missing day without marking the whole future missing", () => {
    const a = account([trade("2026-08-24", "buy", "10")]);
    const r = analyzeAccount(
      a,
      { [id]: bars({ "2026-08-26": "12", "2026-08-27": "13" }) },
      {},
      "2026-08-27",
    );
    expect(sum(r, "2026-08-27", "2026-08-27")).toMatchObject({
      profit: "100.00",
      missingDays: 0,
    });
    expect(sum(r).contributions[0].profit).toBeNull();
  });
  it("does not turn missing benchmark years or implicit calendar gaps into holidays", () => {
    const a = account([trade("2024-12-31", "buy", "10")]);
    const sparse = bars({ "2024-12-31": "10", "2026-01-05": "12" });
    const r = analyzeAccount(a, { [id]: sparse }, {}, "2026-01-05", {
      calendar: sparse,
      calendarCoverage: [
        { start: "2024-01-01", end: "2024-12-31" },
        { start: "2026-01-01", end: "2026-01-05" },
      ],
    });
    expect(r.days.find((d) => d.date === "2025-06-02")?.status).toBe("missing");
    expect(sum(r).profit).toBeNull();
    const withoutCoverage = analyzeAccount(
      account([trade("2026-08-24", "buy", "10")]),
      { [id]: bars({ "2026-08-24": "10", "2026-08-26": "12" }) },
      {},
      "2026-08-26",
      { calendar: bars({ "2026-08-24": "10", "2026-08-26": "12" }) },
    );
    expect(withoutCoverage.days[1].status).toBe("missing");
  });
  it("rounds aggregate account FIFO profit after adding raw security results", () => {
    const otherId = "sz159915";
    const a = account([
      trade("2026-08-24", "buy", "10", "3"),
      { ...trade("2026-08-24", "buy", "10", "3", 1), securityId: otherId },
      trade("2026-08-25", "sell", "11", "1"),
      { ...trade("2026-08-25", "sell", "11", "1", 1), securityId: otherId },
    ]);
    const r = analyzeAccount(a, {}, {}, "2026-08-25");
    expect(replay(a, "2026-08-25").realized).toBe("-0.67");
    expect(sum(r).realized).toBe("-0.67");
    expect(r.days[1].contributions.map((c) => c.realized)).toEqual([
      "-0.33",
      "-0.33",
    ]);
    a.entries.push(trade("2026-08-26", "sell", "11", "1"));
    const next = analyzeAccount(a, {}, {}, "2026-08-26");
    expect(sum(next).realized).toBe(replay(a, "2026-08-26").realized);
    expect(sum(next, "2026-08-26", "2026-08-26").realized).toBe("-0.33");
  });
  it("produces cross-year months and clamps leap-day date arithmetic", () => {
    expect(monthSequence("2026-01")).toEqual([
      "2026-01",
      "2025-12",
      "2025-11",
      "2025-10",
      "2025-09",
      "2025-08",
      "2025-07",
      "2025-06",
      "2025-05",
      "2025-04",
      "2025-03",
      "2025-02",
    ]);
    expect(shiftMonth("2024-03-31", -1)).toBe("2024-02-29");
  });
});

it("uses a documented suspension valuation without inventing a traded daily bar", () => {
  const a = account([trade("2025-04-28", "buy", "8.53")]);
  const prices = bars({ "2025-04-28": "8.53", "2025-04-30": "8.10" });
  const calendar = bars({
    "2025-04-28": "10",
    "2025-04-29": "10",
    "2025-04-30": "10",
  });
  expect(
    analyzeAccount(a, { [id]: prices }, {}, "2025-04-30", {
      calendar,
    }).days.find((d) => d.date === "2025-04-29")?.profit,
  ).toBeNull();
  prices.suspensions = [
    {
      date: "2025-04-29",
      referenceDate: "2025-04-28",
      source: "https://disc.static.szse.cn/disc/notice.pdf",
    },
  ];
  const result = analyzeAccount(a, { [id]: prices }, {}, "2025-04-30", {
    calendar,
  });
  expect(result.days.find((d) => d.date === "2025-04-29")?.profit).toBe("0.00");
  expect(result.days.find((d) => d.date === "2025-04-30")?.profit).toBe(
    "-43.00",
  );
  expect(prices.bars).toHaveLength(2);
});

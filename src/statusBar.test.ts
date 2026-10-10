import { describe, expect, it } from "vitest";
import {
  statusBarFrames,
  shortNames,
  statusTone,
  compactMoney,
} from "./statusBar";

describe("menu bar portfolio frames", () => {
  it("combines each holding's quote change and daily profit, then the account total", () => {
    expect(
      statusBarFrames(
        [
          { name: "贵州茅台", change: "1.25", profit: "320", stale: false },
          {
            name: "沪深300ETF",
            change: "-0.50",
            profit: "-25.25",
            stale: false,
          },
        ],
        { percent: "1.25", profit: "1280", stale: false },
      ),
    ).toEqual([
      {
        label: "贵州茅台 ",
        change: "+1.25%",
        profit: "+¥320",
        changeTone: "up",
        profitTone: "up",
        stale: false,
      },
      {
        label: "沪深300ETF ",
        change: "-0.50%",
        profit: "-¥25.25",
        changeTone: "down",
        profitTone: "down",
        stale: false,
      },
      {
        label: "合计",
        change: "+1.25%",
        profit: "+¥1,280",
        changeTone: "up",
        profitTone: "up",
        stale: false,
      },
    ]);
  });
  it("keeps unavailable data distinct from zero and marks delayed data", () => {
    expect(
      statusBarFrames(
        [{ name: "测试", change: null, profit: null, stale: true }],
        { percent: null, profit: null, stale: true },
      ),
    ).toEqual([
      {
        label: "测试 ",
        change: "—",
        profit: "—",
        changeTone: "flat",
        profitTone: "flat",
        stale: true,
      },
      {
        label: "合计",
        change: "—",
        profit: "—",
        changeTone: "flat",
        profitTone: "flat",
        stale: true,
      },
    ]);
    expect(
      statusBarFrames([], { percent: null, profit: "0", stale: false }),
    ).toMatchObject([
      { change: "—", profit: "¥0", changeTone: "flat", profitTone: "flat" },
    ]);
  });
  it("does not display negative zero after rounding", () => {
    expect(
      statusBarFrames([], {
        percent: "-0.001",
        profit: "-0.001",
        stale: false,
      }),
    ).toMatchObject([
      {
        change: "0.00%",
        profit: "¥0",
        changeTone: "flat",
        profitTone: "flat",
      },
    ]);
  });
  it("colors change and today's profit independently", () => {
    expect(
      statusBarFrames(
        [{ name: "测试", change: "1.20", profit: "-50", stale: false }],
        { percent: "-0.20", profit: "80", stale: false },
      ),
    ).toMatchObject([
      { changeTone: "up", profitTone: "down" },
      { changeTone: "down", profitTone: "up" },
    ]);
  });
});

describe("智能简称", () => {
  it("uses recognizable names, preserves index numbers and disambiguates collisions", () => {
    expect(
      shortNames([
        { id: "1", name: "贵州茅台" },
        { id: "2", name: "誉衡药业" },
        { id: "3", name: "科森科技" },
        { id: "4", name: "和顺石油" },
        { id: "5", name: "卫星ETF富国" },
        { id: "6", name: "沪深300ETF" },
        { id: "7", name: "中信证券" },
        { id: "8", name: "中信银行" },
      ]),
    ).toEqual({
      "1": "茅台",
      "2": "誉衡",
      "3": "科森",
      "4": "和顺",
      "5": "卫星",
      "6": "沪深300",
      "7": "中信证券",
      "8": "中信银行",
    });
  });
  it("supports overrides but keeps identical names identifiable by code", () => {
    expect(
      shortNames([
        { id: "sh1", name: "同名基金" },
        { id: "sz2", name: "同名基金" },
      ]),
    ).toEqual({ sh1: "同名基金·sh1", sz2: "同名基金·sz2" });
    expect(
      shortNames([{ id: "1", name: "贵州茅台" }], { "1": "贵茅" }),
    ).toEqual({ "1": "贵茅" });
  });
  it("colors each numeric value independently and normalizes rounded zero", () => {
    expect(["1", "-1", "-0.001", null].map(statusTone)).toEqual([
      "up",
      "down",
      "flat",
      "flat",
    ]);
  });
});

it("compacts large positive and negative menu amounts", () => {
  expect(compactMoney("128000.50")).toBe("+¥12.8万");
  expect(compactMoney("-1280000")).toBe("-¥128万");
  expect(compactMoney("100000000")).toBe("+¥1亿");
});

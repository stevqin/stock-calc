import type { StatusSnapshot } from "../../src/statusBar";
export const sample: StatusSnapshot = {
  frames: [],
  trades: [],
  date: "2026-09-08",
  updatedAt: Date.now(),
  holdings: [
    {
      id: "sh600519",
      market: "sh",
      code: "600519",
      name: "贵州茅台",
      shortName: "茅台",
      change: "1.25",
      price: "1580.25",
      profit: "320",
      dailyPercent: "0.85",
      holdingPercent: "-3.25",
      holdingProfit: "2240",
      stale: false,
    },
    {
      id: "sz002437",
      market: "sz",
      code: "002437",
      name: "誉衡药业",
      shortName: "誉衡",
      change: "-2.28",
      price: "3.21",
      profit: "-243.01",
      dailyPercent: "0.85",
      holdingPercent: "-3.25",
      holdingProfit: "-1520.28",
      stale: false,
    },
    {
      id: "sh603626",
      market: "sh",
      code: "603626",
      name: "科森科技",
      shortName: "科森",
      change: "9.99",
      price: "12.50",
      profit: "591",
      dailyPercent: "0.85",
      holdingPercent: "-3.25",
      holdingProfit: "8650",
      stale: false,
    },
    {
      id: "sh563230",
      market: "sh",
      code: "563230",
      name: "卫星ETF富国",
      shortName: "卫星",
      change: "1.20",
      price: "1.235",
      profit: "-25.50",
      dailyPercent: "0.85",
      holdingPercent: "-3.25",
      holdingProfit: "180.50",
      stale: false,
    },
    {
      id: "sh510300",
      market: "sh",
      code: "510300",
      name: "沪深300ETF",
      shortName: "沪深300",
      change: null,
      price: null,
      profit: null,
      dailyPercent: null,
      holdingPercent: null,
      holdingProfit: null,
      stale: true,
    },
  ],
  total: { percent: "1.25", profit: "1280", stale: false },
};
let paused = false;
export const isTauri = () => false;
export async function invoke(command: string, args?: { paused: boolean }) {
  if (command === "get_status_active_index") return 0;
  if (command === "get_status_portfolio") return sample;
  if (command === "set_status_paused") paused = args!.paused;
  if (command === "get_status_paused" || command === "set_status_paused")
    return paused;
  return undefined;
}
export async function listen() {
  return () => {};
}
export async function emitTo() {}

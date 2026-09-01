import type { Asset, FeeProfile, FeeResult } from "../core/calculator";
import type { Market } from "../quotes";
export interface Security {
  id: string;
  market: Market;
  code: string;
  name: string;
  asset: Asset;
  category:
    "stock" | "domestic" | "cross-border" | "gold" | "bond" | "unconfirmed";
  settlement: "T+1" | "T+0" | "unconfirmed";
}
export interface Entry {
  id: string;
  securityId: string;
  kind: "opening" | "buy" | "sell";
  quantity: string;
  price: string;
  time: string;
  date: string;
  available?: string;
  fees?: FeeResult;
  profile?: FeeProfile;
  feeSource?: "estimated" | "actual";
  note?: string;
}
export interface CashEntry {
  id: string;
  kind:
    | "deposit"
    | "withdraw"
    | "repo-interest"
    | "interest"
    | "other-income"
    | "legacy-balance";
  amount: string;
  time: string;
  date: string;
  note: string;
}
export interface Account {
  schemaVersion: 2 | 3 | 4;
  initialized: boolean;
  initialCash: string;
  securities: Security[];
  entries: Entry[];
  selectedId: string;
  profiles: Record<Asset, FeeProfile>;
  feeConfirmed: Record<Asset, boolean>;
  cashEntries?: CashEntry[];
  workspace?: WorkspaceState;
}
export interface WatchGroup {
  id: string;
  name: string;
  members: string[];
}
export interface TableView {
  layoutVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  columns: string[];
  widths: Record<string, number>;
  sort: string;
  direction: "asc" | "desc";
}
export interface WorkspaceState {
  watchlist: string[];
  groups: WatchGroup[];
  activeView: string;
  chartMode: "intraday" | "daily";
  views: Record<string, TableView>;
}
export interface Lot {
  quantity: string;
  cost: string;
  availableDate: string;
}
export interface Position {
  securityId: string;
  quantity: string;
  available: string;
  cost: string;
  averageCost: string | null;
  realized: string;
  netInvestment: string;
  dilutedCost: string | null;
  lots: Lot[];
}
export interface Ledger {
  cash: string;
  capital: string;
  realized: string;
  fees: string;
  positions: Record<string, Position>;
  deposits: string;
  withdrawals: string;
  income: string;
  repoInterest: string;
  cashWarnings: number;
}
export interface DayPair {
  quantity: string;
  profit: string;
  unpairedBuy: string;
  unpairedSell: string;
  cashFlow: string;
}
export function shanghaiDate(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-${p.find((x) => x.type === "day")!.value}`;
}
export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export const securityId = (market: Market, code: string) => market + code;
export function localDateTime(now = new Date()): string {
  return `${shanghaiDate(now)}T${now.toLocaleTimeString("en-GB", { timeZone: "Asia/Shanghai", hour12: false })}`;
}
export function fromShanghaiInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw new Error("请选择发生日期与时间");
  const date = new Date(`${value.length === 16 ? value + ":00" : value}+08:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    localDateTime(date) !== (value.length === 16 ? value + ":00" : value)
  )
    throw new Error("日期时间无效");
  if (date.getTime() > Date.now()) throw new Error("记录时间不能晚于现在");
  return date.toISOString();
}

import {
  defaults,
  type Asset,
  type Direction,
  type FeeProfile,
} from "./core/calculator";
import type { Market } from "./quotes";

export type EtfKind =
  "unconfirmed" | "domestic" | "cross-border" | "gold" | "bond";
export interface SavedState {
  version: 1;
  asset: Asset;
  etfKind: EtfKind;
  direction: Direction;
  market: Market;
  code: string;
  buyPrice: string;
  sellPrice: string;
  quantity: string;
  target: string;
  holdingQuantity: string;
  holdingPrice: string;
  profiles: Record<Asset, FeeProfile>;
  confirmations: Record<string, { asset: Asset; etfKind: EtfKind }>;
}
export const STORAGE_KEY = "t-calculator.v1";
export function initialState(): SavedState {
  return {
    version: 1,
    asset: "stock",
    etfKind: "unconfirmed",
    direction: "buy-first",
    market: "sh",
    code: "",
    buyPrice: "10.00",
    sellPrice: "10.11",
    quantity: "100",
    target: "",
    holdingQuantity: "",
    holdingPrice: "",
    profiles: structuredClone(defaults),
    confirmations: {},
  };
}
const etfKinds = ["unconfirmed", "domestic", "cross-border", "gold", "bond"];
export function loadState(storage: Pick<Storage, "getItem">): SavedState {
  const clean = initialState();
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (!raw || raw.version !== 1) return clean;
    for (const key of [
      "buyPrice",
      "sellPrice",
      "quantity",
      "target",
      "holdingQuantity",
      "holdingPrice",
      "code",
    ] as const) {
      if (typeof raw[key] === "string" && raw[key].length <= 40)
        clean[key] = raw[key];
    }
    if (["stock", "etf"].includes(raw.asset)) clean.asset = raw.asset;
    if (etfKinds.includes(raw.etfKind)) clean.etfKind = raw.etfKind;
    if (["buy-first", "sell-first"].includes(raw.direction))
      clean.direction = raw.direction;
    if (["sh", "sz"].includes(raw.market)) clean.market = raw.market;
    for (const asset of ["stock", "etf"] as const)
      for (const field of Object.keys(
        defaults[asset],
      ) as (keyof FeeProfile)[]) {
        const value = raw.profiles?.[asset]?.[field];
        if (typeof value === "string" && value.length <= 40)
          clean.profiles[asset][field] = value;
      }
    if (raw.confirmations && typeof raw.confirmations === "object") {
      for (const [key, value] of Object.entries(raw.confirmations).slice(
        0,
        200,
      )) {
        const v = value as Record<string, unknown> | null;
        if (
          /^(sh|sz)\d{6}$/.test(key) &&
          v &&
          ["stock", "etf"].includes(String(v.asset)) &&
          etfKinds.includes(String(v.etfKind))
        )
          clean.confirmations[key] = v as SavedState["confirmations"][string];
      }
    }
  } catch {
    /* Corrupt or disabled storage must never prevent offline calculation. */
  }
  return clean;
}

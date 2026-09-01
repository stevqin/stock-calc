import { invoke, isTauri } from "@tauri-apps/api/core";
import { match } from "pinyin-pro";
import { validSymbol } from "./quotes";
import type { Security } from "./sim/model";

export type SecurityHit = Pick<
  Security,
  "market" | "code" | "name" | "asset"
> & { initials?: string };
export const searchId = (s: SecurityHit) => s.market + s.code;
export const normalizeSearch = (q: string) =>
  q.normalize("NFKC").toLowerCase().replace(/[\s']/g, "");
export const validSearch = (q: string) =>
  /^[a-z0-9\u3400-\u9fff*._-]{1,64}$/.test(q);
export class LocalSearchOnlyError extends Error {}

export function localSecuritySearch(
  securities: readonly SecurityHit[],
  query: string,
): SecurityHit[] {
  const q = normalizeSearch(query);
  if (!validSearch(q)) return [];
  return securities
    .filter(
      (s) =>
        validSymbol(s.market, s.code) &&
        (normalizeSearch(s.name).includes(q) ||
          searchId(s).includes(q) ||
          s.initials?.toLowerCase().includes(q) ||
          match(s.name, q) !== null),
    )
    .sort(
      (a, b) =>
        Number(b.code === q || normalizeSearch(b.name) === q) -
        Number(a.code === q || normalizeSearch(a.name) === q),
    )
    .slice(0, 20);
}

export async function remoteSecuritySearch(
  query: string,
): Promise<SecurityHit[]> {
  const q = normalizeSearch(query);
  if (!validSearch(q)) throw new Error("请输入1～64位名称、拼音或代码");
  if (!isTauri())
    throw new LocalSearchOnlyError(
      "浏览器预览仅搜索已保存证券；全市场搜索请打开Mac版",
    );
  return invoke<SecurityHit[]>("search_securities", { query: q });
}

export function mergeSearchHits(
  local: SecurityHit[],
  remote: SecurityHit[],
): SecurityHit[] {
  const hits = new Map<string, SecurityHit>();
  for (const hit of [...local, ...remote]) {
    if (
      validSymbol(hit.market, hit.code) &&
      ["stock", "etf"].includes(hit.asset) &&
      !hits.has(searchId(hit))
    )
      hits.set(searchId(hit), hit);
  }
  return [...hits.values()].slice(0, 20);
}

import { describe, expect, it } from "vitest";
import {
  localSecuritySearch,
  mergeSearchHits,
  normalizeSearch,
  validSearch,
  type SecurityHit,
} from "./securitySearch";

const stock: SecurityHit = {
  market: "sh",
  code: "600519",
  name: "贵州茅台",
  asset: "stock",
};
const etf: SecurityHit = {
  market: "sz",
  code: "159915",
  name: "创业板ETF",
  asset: "etf",
};
describe("证券本地模糊搜索", () => {
  it.each([
    "贵州茅",
    "茅台",
    "guizhoumaotai",
    "maotai",
    "GZMT",
    "gz",
    "6005",
    "00519",
    "SH600519",
    "gui zhou mao tai",
    "ｇｚｍｔ",
  ])("支持名称、全拼、简称、代码：%s", (query) => {
    expect(localSecuritySearch([stock, etf], query)).toEqual([stock]);
  });
  it.each(["创业", "chuangyeban", "cyb", "1599", "ETF"])(
    "ETF同样支持检索：%s",
    (query) => {
      expect(localSecuritySearch([stock, etf], query)).toEqual([etf]);
    },
  );
  it("空值、无匹配、非法查询不返回候选", () => {
    for (const q of [
      "",
      "  ",
      "不存在",
      "https://example.com",
      "a".repeat(65),
    ]) {
      expect(localSecuritySearch([stock], q)).toEqual([]);
    }
    expect(validSearch(normalizeSearch("600519&t=all"))).toBe(false);
  });
  it("去重保留已保存名称，排除不支持的证券", () => {
    expect(
      mergeSearchHits(
        [stock],
        [
          { ...stock, name: "远端名称" },
          etf,
          { ...stock, code: "688001" },
          { ...stock, market: "hk" as "sh", code: "600519" },
        ],
      ),
    ).toEqual([stock, etf]);
  });
});

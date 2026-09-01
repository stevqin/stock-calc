import { describe, expect, it } from "vitest";
import { initialState, loadState } from "./state";
describe("本机设置", () => {
  it("损坏或禁用存储安全回退", () => {
    expect(loadState({ getItem: () => "{broken" })).toEqual(initialState());
    expect(
      loadState({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(initialState());
  });
  it("分别保存股票与ETF佣金、输入和品种确认", () => {
    const state = initialState();
    state.profiles.etf.minimum = "0";
    state.profiles.stock.commissionWan = "1";
    state.confirmations.sh518880 = { asset: "etf", etfKind: "gold" };
    state.buyPrice = "4.444";
    expect(loadState({ getItem: () => JSON.stringify(state) })).toEqual(state);
  });
  it("忽略非法结构与未知版本", () => {
    const valid = initialState();
    expect(
      loadState({ getItem: () => JSON.stringify({ ...valid, version: 2 }) }),
    ).toEqual(valid);
    expect(
      loadState({
        getItem: () =>
          JSON.stringify({
            ...valid,
            asset: "bad",
            market: "evil",
            profiles: null,
          }),
      }),
    ).toEqual(valid);
  });
});

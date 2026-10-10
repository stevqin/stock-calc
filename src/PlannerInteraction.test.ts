import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import LedgerWorkbench from "./LedgerWorkbench.vue";
import DateTimeField from "./components/DateTimeField.vue";
import { manualAccount } from "./sim/record";
import { marketQuotes } from "./market";
import { loadAccount, saveAccount } from "./sim/repository";
import { readDraft, writeDraft } from "./sim/drafts";
import { marketColor, MARKET_COLORS } from "./marketTheme";
vi.mock("./sim/repository", () => ({
  loadAccount: vi.fn(),
  saveAccount: vi.fn(),
  exportAccount: vi.fn(),
}));
vi.mock("./sim/drafts", () => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn().mockResolvedValue(undefined),
  flushDrafts: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("./market", async () => ({
  marketQuotes: (await import("vue")).reactive({}),
}));
let wrapper: ReturnType<typeof mount>;
const account = () => {
  const a = manualAccount();
  a.feeConfirmed.etf = true;
  a.profiles.etf.commissionWan = "1";
  return a;
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  Object.keys(marketQuotes).forEach((k) => delete marketQuotes[k]);
  vi.mocked(loadAccount).mockResolvedValue({ account: account(), revision: 1 });
  vi.mocked(readDraft).mockResolvedValue(undefined);
  vi.mocked(writeDraft).mockResolvedValue(undefined);
  marketQuotes.sh510300 = {
    market: "sh",
    code: "510300",
    name: "沪深300ETF",
    latest: "10.000",
    bid: null,
    ask: null,
    kind: "etf",
    quoteTime: "20260831150000",
    fetchedAt: "2026-08-31T07:00:00Z",
  };
});
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function start(props = {}) {
  wrapper = mount(LedgerWorkbench, {
    props: {
      embedded: true,
      initialTab: "planner",
      symbol: "sh510300",
      ...props,
    },
    global: { stubs: { MarketChart: true } },
  });
  await flushPromises();
}
const input = (name: string) => wrapper.find(`input[aria-label="${name}"]`);
const value = (name: string) => (input(name).element as HTMLInputElement).value;
it("正算与反推通过页签切换，同一时间只显示一套输入和结果", async () => {
  await start();
  const tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.map((tab) => tab.text())).toEqual(["正算", "反推"]);
  expect(tabs[0].attributes("aria-selected")).toBe("true");
  expect(wrapper.findAll(".planner-card")).toHaveLength(1);
  expect(
    wrapper
      .find(".planner-forward")
      .find('input[aria-label="买入价"]')
      .exists(),
  ).toBe(true);
  expect(
    wrapper
      .find(".planner-forward")
      .find('input[aria-label="目标配对净利润"]')
      .exists(),
  ).toBe(false);
  expect(wrapper.find(".planner-reverse").exists()).toBe(false);
  expect(input("买入价").exists()).toBe(true);
  expect(input("卖出价").exists()).toBe(true);
  expect(wrapper.find(".planner-forward").text()).toContain("交易后持仓成本");
  expect(wrapper.find(".planner-forward").text()).toContain("交易后持仓市值");
  await tabs[1].trigger("click");
  expect(tabs[1].attributes("aria-selected")).toBe("true");
  expect(wrapper.findAll(".planner-card")).toHaveLength(1);
  expect(wrapper.find(".planner-forward").exists()).toBe(false);
  expect(input("反推固定价").exists()).toBe(true);
  expect(input("目标配对净利润").exists()).toBe(true);
  expect(wrapper.find(".planner-reverse").text()).toContain(
    "持仓收益 / 收益率",
  );
});
it("反推有独立价格和数量，正算输入不会被反推修改", async () => {
  await start();
  await wrapper
    .get('[role="tab"][aria-controls="planner-panel-reverse"]')
    .trigger("click");
  expect(value("反推固定价")).toBe("10.000");
  await input("反推固定价").setValue("9.500");
  await input("反推买入数量").setValue("200");
  await wrapper
    .get('[role="tab"][aria-controls="planner-panel-forward"]')
    .trigger("click");
  expect(value("买入价")).toBe("10.000");
  expect(value("买入数量")).toBe("100");
  await wrapper
    .get('[role="tab"][aria-controls="planner-panel-reverse"]')
    .trigger("click");
  expect(value("反推固定价")).toBe("9.500");
  expect(value("反推买入数量")).toBe("200");
  expect(wrapper.find(".planner-reverse").text()).toContain("最低卖价");
  expect(wrapper.find(".planner-reverse").text()).toContain("目标配对净收益");
});
it("每3秒跟随最新价，单边手动修改/清空后锁定，恢复后继续跟随", async () => {
  await start();
  expect(value("买入价")).toBe("10.000");
  expect(value("卖出价")).toBe("10.000");
  marketQuotes.sh510300.latest = "10.123";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("买入价")).toBe("10.123");
  await input("买入价").setValue("9.900");
  marketQuotes.sh510300.latest = "10.200";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("买入价")).toBe("9.900");
  expect(value("卖出价")).toBe("10.200");
  await input("买入价").setValue("");
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("买入价")).toBe("");
  await wrapper
    .findAll("button")
    .find((b) => b.attributes("aria-label") === "买入价跟随行情")!
    .trigger("click");
  expect(value("买入价")).toBe("10.200");
});
it("价格加减锁定，ETF按0.001档，数量按100加减，金额按10加减", async () => {
  await start();
  await wrapper.find('[aria-label="买入价增加0.001"]').trigger("click");
  expect(value("买入价")).toBe("10.001");
  await wrapper.find('[aria-label="买入数量增加100"]').trigger("click");
  expect(value("买入数量")).toBe("200");
  await wrapper.find('[aria-label="卖出数量设为500"]').trigger("click");
  expect(value("卖出数量")).toBe("500");
  await wrapper
    .get('[role="tab"][aria-controls="planner-panel-reverse"]')
    .trigger("click");
  await wrapper.find('[aria-label="目标配对净利润增加10"]').trigger("click");
  expect(value("目标配对净利润")).toBe("20.00");
  await wrapper
    .get('[role="tab"][aria-controls="planner-panel-forward"]')
    .trigger("click");
  marketQuotes.sh510300.latest = "11";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("买入价")).toBe("10.001");
  expect(value("卖出价")).toBe("11.000");
});
it("隐藏窗口、无效报价不覆盖已有测算价格", async () => {
  await start();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  marketQuotes.sh510300.latest = "11";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("买入价")).toBe("10.000");
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  marketQuotes.sh510300.latest = "invalid";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("买入价")).toBe("10.000");
});
it("旧买入草稿不自动载入，新交易表单双向提交，手改价格后停止跟随", async () => {
  vi.mocked(readDraft).mockImplementation(async (key) =>
    key.endsWith(":buy")
      ? {
          price: "10",
          quantity: "100",
          time: "2026-08-25T09:00:00",
          note: "买入草稿",
          side: "buy",
          feeSource: "estimated",
        }
      : undefined,
  );
  await start({ action: "record", initialTab: "trades" });
  expect(wrapper.find(".trade-sides").exists()).toBe(false);
  expect(wrapper.findAll(".submit-order").map((b) => b.text())).toEqual([
    "买入",
    "卖出",
  ]);
  const price = wrapper.find('input[placeholder="输入已成交价格"]');
  expect((price.element as HTMLInputElement).value).toBe("10.000");
  await price.setValue("9.8");
  marketQuotes.sh510300.latest = "11";
  await vi.advanceTimersByTimeAsync(3000);
  expect((price.element as HTMLInputElement).value).toBe("9.8");
});
it("成交价默认跟随，每3秒更新；手工清空也锁定，可恢复跟随", async () => {
  await start({ action: "record", initialTab: "trades" });
  expect(value("成交价")).toBe("10.000");
  marketQuotes.sh510300.latest = "10.123";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe("10.123");
  await input("成交价").setValue("");
  marketQuotes.sh510300.latest = "11";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe("");
  expect(writeDraft).toHaveBeenLastCalledWith(
    "trade:sh510300:entry",
    expect.objectContaining({ price: "", priceMode: "manual" }),
  );
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "恢复跟随现价")!
    .trigger("click");
  expect(value("成交价")).toBe("11.000");
  expect(writeDraft).toHaveBeenLastCalledWith(
    "trade:sh510300:entry",
    expect.objectContaining({ priceMode: "follow" }),
  );
});
it.each([
  [undefined, "9.876", "9.876"],
  ["manual", "", ""],
  ["follow", "9.876", "10.000"],
])("恢复成交草稿模式 %s 时保留手工价格", async (priceMode, price, expected) => {
  vi.mocked(readDraft).mockImplementation(async (key) =>
    key.endsWith(":entry")
      ? {
          price,
          priceMode,
          quantity: "100",
          time: "2026-08-25T09:00:00",
          note: "",
          feeSource: "estimated",
        }
      : undefined,
  );
  await start({ action: "record", initialTab: "trades" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe(expected);
});
it("主动载入旧草稿后锁定价格，行情填价按钮也视为手动选择", async () => {
  vi.mocked(readDraft).mockImplementation(async (key) =>
    key.endsWith(":buy")
      ? {
          price: "9.88",
          quantity: "100",
          time: "2026-08-25T09:00:00",
          note: "",
          feeSource: "estimated",
        }
      : undefined,
  );
  await start({ action: "record", initialTab: "trades" });
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "载入旧买入草稿")!
    .trigger("click");
  marketQuotes.sh510300.latest = "11";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe("9.88");
  await wrapper
    .findAll(".quote-fill button")
    .find((b) => b.text() === "最新")!
    .trigger("click");
  marketQuotes.sh510300.latest = "12";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe("11");
});
it("成交价格在隐藏、错证券、无效行情时保留原值", async () => {
  await start({ action: "record", initialTab: "trades" });
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  marketQuotes.sh510300.latest = "11";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe("10.000");
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  for (const latest of ["invalid", "0", "-1", "NaN", "Infinity"]) {
    marketQuotes.sh510300.latest = latest;
    await vi.advanceTimersByTimeAsync(3000);
    expect(value("成交价")).toBe("10.000");
  }
  marketQuotes.sh510300.latest = "12";
  marketQuotes.sh510300.code = "600519";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe("10.000");
});
it("股票跟随保留两位价格，提交保存时行情不会改动价格", async () => {
  const a = account();
  a.feeConfirmed.stock = true;
  vi.mocked(loadAccount).mockResolvedValue({ account: a, revision: 1 });
  marketQuotes.sh600519 = {
    ...marketQuotes.sh510300,
    code: "600519",
    latest: "10.126",
    kind: "stock",
  };
  let finish!: (revision: number) => void;
  vi.mocked(saveAccount).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await start({ action: "record", initialTab: "trades", symbol: "sh600519" });
  expect(value("成交价")).toBe("10.13");
  await wrapper.find(".submit-order.buy").trigger("click");
  marketQuotes.sh600519.latest = "11.50";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("成交价")).toBe("10.13");
  expect(saveAccount).toHaveBeenCalledTimes(1);
  finish(2);
  await flushPromises();
});
it("使用红涨绿跌灰平色值，包含零变化", () => {
  expect(MARKET_COLORS).toEqual({
    gain: "#c6414b",
    loss: "#48a579",
    flat: "#8f9190",
  });
  expect(marketColor(1)).toBe(MARKET_COLORS.gain);
  expect(marketColor(-1)).toBe(MARKET_COLORS.loss);
  expect(marketColor(0)).toBe(MARKET_COLORS.flat);
});

it("突出扣费做T收益，并分别显示交易后成本和按现价估算的市值", async () => {
  const a = account();
  a.entries.push({
    id: "opening",
    securityId: "sh510300",
    kind: "opening",
    quantity: "1000",
    available: "1000",
    price: "10",
    date: "2026-08-27",
    time: "2026-08-27T01:00:00.000Z",
  });
  vi.mocked(loadAccount).mockResolvedValue({ account: a, revision: 1 });
  await start();
  await input("买入价").setValue("9");
  await input("卖出价").setValue("11");
  expect(wrapper.get(".plan-net-profit").text()).toContain("199.80");
  expect(wrapper.get('[aria-label="买入金额"]').text()).toContain("900.09");
  expect(wrapper.get('[aria-label="卖出金额"]').text()).toContain("1,100.11");
  await input("卖出数量").setValue("200");
  expect(wrapper.get('[aria-label="卖出金额"]').text()).toContain("2,200.22");
  expect(wrapper.get('[aria-label="买入金额"]').text()).toContain("900.09");
  await input("卖出数量").setValue("100");
  expect(wrapper.get(".plan-holding-cost").text()).toContain("10.0000");
  expect(wrapper.get(".plan-holding-cost").text()).toContain("9.8002");
  expect(wrapper.get(".plan-market-value").text()).toContain("10,000.00");
  expect(
    wrapper.get(".plan-calculation-details").attributes("open"),
  ).toBeUndefined();
});

it("买卖价格旁分别显示相对行情昨收的涨跌幅", async () => {
  marketQuotes.sh510300!.previousClose = "10";
  await start();
  await input("买入价").setValue("9");
  await input("卖出价").setValue("11");
  expect(wrapper.findAll(".price-change").map((node) => node.text())).toEqual([
    "较昨收 -10.00%",
    "较昨收 +10.00%",
  ]);
});

it("快捷股数按各自价格折算，点击和行情刷新都不重置已填数量", async () => {
  await start();
  await input("买入价").setValue("3.4");
  const buyButtons = () =>
    wrapper.findAll('button[aria-label^="买入数量设为"]');
  expect(buyButtons().map((b) => b.text())).toEqual([
    "100",
    "1400",
    "2900",
    "5800",
    "8800",
    "14700",
    "23500",
    "29400",
  ]);
  await wrapper.get('[aria-label="买入数量设为14700"]').trigger("click");
  expect(value("买入数量")).toBe("14700");
  marketQuotes.sh510300.latest = "5";
  await vi.advanceTimersByTimeAsync(3000);
  expect(value("买入数量")).toBe("14700");
  expect(wrapper.find('[aria-label="卖出数量设为20000"]').exists()).toBe(true);
  expect(wrapper.find('[aria-label="卖出数量设为1000"]').exists()).toBe(true);
  await input("买入价").setValue("1500");
  expect(buyButtons().map((b) => b.text())).toEqual(["100"]);
  expect(value("买入数量")).toBe("14700");
  await input("买入价").setValue("");
  expect(buyButtons().map((b) => b.text())).toEqual(["100"]);
});

it("交易录入快捷股数随成交价格更新", async () => {
  await start({ action: "record", initialTab: "trades" });
  await wrapper.get("#trade-entry-price").setValue("3.4");
  const buttons = wrapper.findAll(".quantity-shortcuts button");
  expect(buttons.map((b) => b.text())).toContain("29400");
  await buttons.find((b) => b.text() === "5800")!.trigger("click");
  expect(
    (wrapper.get("#trade-entry-quantity").element as HTMLInputElement).value,
  ).toBe("5800");
});

it("每次打开交易录入使用打开时刻，自动恢复草稿不恢复旧成交时间", async () => {
  vi.useRealTimers();
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  vi.setSystemTime(new Date("2026-09-15T04:30:00Z"));
  vi.mocked(readDraft).mockImplementation(async (key) =>
    key.endsWith(":entry")
      ? {
          price: "3.40",
          quantity: "200",
          time: "2026-08-25T09:00:00",
          note: "",
          feeSource: "estimated",
        }
      : undefined,
  );
  await start({ action: "record", initialTab: "trades" });
  const time = () => wrapper.get('[aria-label="成交发生时间"]');
  expect((time().element as HTMLInputElement).value).toContain(
    "2026-09-15 12:30",
  );
  wrapper
    .findComponent(DateTimeField)
    .vm.$emit("update:modelValue", "2026-09-10T09:35:00");
  await wrapper.vm.$nextTick();
  await vi.advanceTimersByTimeAsync(3000);
  expect((time().element as HTMLInputElement).value).toBe(
    "2026-09-10 09:35:00",
  );
  wrapper.unmount();
  vi.setSystemTime(new Date("2026-09-15T05:00:00Z"));
  await start({ action: "record", initialTab: "trades" });
  expect((time().element as HTMLInputElement).value).toContain(
    "2026-09-15 13:00",
  );
});

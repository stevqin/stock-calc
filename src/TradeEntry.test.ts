import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import LedgerWorkbench from "./LedgerWorkbench.vue";
import { manualAccount, draftRecord, insertRecord } from "./sim/record";
import { loadAccount, saveAccount } from "./sim/repository";
import { readDraft, writeDraft } from "./sim/drafts";
vi.mock("./sim/repository", () => ({
  loadAccount: vi.fn(),
  saveAccount: vi.fn(),
  exportAccount: vi.fn(),
}));
vi.mock("./sim/drafts", () => ({
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  flushDrafts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("./market", async () => ({
  marketQuotes: (await import("vue")).reactive({}),
}));
let wrapper: ReturnType<typeof mount>;
let account: ReturnType<typeof manualAccount>;
const id = "sh600519",
  time = "2026-08-28T09:30:00";
const draft = {
  price: "10",
  quantity: "100",
  time,
  note: "测试",
  feeSource: "estimated",
};
beforeEach(() => {
  vi.clearAllMocks();
  account = manualAccount();
  account.selectedId = id;
  account.feeConfirmed.stock = true;
  account.entries.push({
    id: "opening",
    securityId: id,
    kind: "opening",
    quantity: "1000",
    available: "1000",
    price: "10",
    date: "2026-08-27",
    time: "2026-08-27T01:00:00.000Z",
  });
  vi.mocked(loadAccount).mockImplementation(async () => ({
    account: JSON.parse(JSON.stringify(account)),
    revision: 1,
  }));
  vi.mocked(saveAccount).mockResolvedValue(2);
  vi.mocked(readDraft).mockResolvedValue(undefined);
  vi.mocked(writeDraft).mockResolvedValue(undefined);
});
afterEach(() => wrapper?.unmount());
async function start() {
  wrapper = mount(LedgerWorkbench, {
    props: { embedded: true, action: "record", symbol: id },
    global: { stubs: { MarketChart: true } },
  });
  await flushPromises();
  await wrapper.find('[aria-label="成交价"]').setValue("10");
  await wrapper.find('input[type="datetime-local"]').setValue(time);
}
describe("先输入再选择买卖", () => {
  it("紧凑布局只有一个成交时间输入，切换费用口径不清空交易字段或实际费用", async () => {
    await start();
    const originalTime = (
      wrapper.find('input[type="datetime-local"]').element as HTMLInputElement
    ).value;
    expect(wrapper.findAll('input[type="datetime-local"]')).toHaveLength(1);
    expect(
      wrapper.find('.trade-main-fields input[type="datetime-local"]').exists(),
    ).toBe(true);
    await wrapper.find(".trade-fee-fields select").setValue("actual");
    await wrapper.find(".actual-fees input").setValue("1.25");
    await wrapper.find(".trade-fee-fields select").setValue("estimated");
    expect(wrapper.find(".actual-fees").exists()).toBe(false);
    await wrapper.find(".trade-fee-fields select").setValue("actual");
    expect(
      (wrapper.find(".actual-fees input").element as HTMLInputElement).value,
    ).toBe("1.25");
    expect(
      (wrapper.find('[aria-label="成交价"]').element as HTMLInputElement).value,
    ).toBe("10");
    expect(
      (wrapper.find('input[type="datetime-local"]').element as HTMLInputElement)
        .value,
    ).toBe(originalTime);
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("嵌入成交表单不呈现记账提示，也不保留空标题行", async () => {
    await start();
    expect(wrapper.text()).not.toContain("只记账，不下单");
    expect(wrapper.find(".ticket .section-heading").exists()).toBe(false);
    expect(wrapper.find('[aria-label="成交价"]').exists()).toBe(true);
  });
  it("按交割单费用保存卖出，未确认费率也不会改成估算", async () => {
    account.feeConfirmed.stock = false;
    await start();
    await wrapper.find(".ticket select").setValue("actual");
    const fees = wrapper.findAll(".actual-fees input");
    await fees[0].setValue("1");
    await fees[1].setValue("0.5");
    await fees[2].setValue("0.01");
    expect(wrapper.find('[data-direction="sell"] strong').text()).toBe(
      "998.49",
    );
    await wrapper.find(".submit-order.sell").trigger("click");
    await flushPromises();
    const saved = vi.mocked(saveAccount).mock.calls[0][0].entries.at(-1)!;
    expect(saved.feeSource).toBe("actual");
    expect(saved.fees?.cash).toBe("998.49");
  });
  it("可一键填入全部可卖数量，并随价格测算FIFO本次收益与收益率", async () => {
    await start();
    const close = wrapper.get(".quantity-shortcuts .close-position");
    expect(close.text()).toBe("清仓（全部可卖）");
    await close.trigger("click");
    expect(
      (wrapper.get('[aria-label="成交股数"]').element as HTMLInputElement)
        .value,
    ).toBe("1000");
    await wrapper.get('[aria-label="成交价"]').setValue("11");
    const profit = wrapper.get(".trade-profit-preview");
    expect(profit.text()).toContain("本次收益");
    expect(profit.text()).toContain("989.39");
    expect(profit.text()).toContain("+9.89%");
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("公共草稿恢复价格数量和费用而不恢复方向", async () => {
    vi.mocked(readDraft).mockImplementation(async (key) =>
      key.endsWith(":entry") ? { ...draft, quantity: "200" } : undefined,
    );
    await start();
    expect(
      (wrapper.find('[aria-label="成交股数"]').element as HTMLInputElement)
        .value,
    ).toBe("200");
    await wrapper.find('[aria-label="成交价"]').setValue("11");
    await flushPromises();
    const payload = vi.mocked(writeDraft).mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect(payload.price).toBe("11");
    expect(payload).not.toHaveProperty("side");
    await wrapper.find(".submit-order.sell").trigger("click");
    await flushPromises();
    expect(vi.mocked(saveAccount).mock.calls[0][0].entries.at(-1)?.kind).toBe(
      "sell",
    );
  });
  it("保存失败保留输入，允许纠正后重新选择方向", async () => {
    vi.mocked(saveAccount).mockRejectedValueOnce(new Error("磁盘不可用"));
    await start();
    await wrapper.find(".submit-order.buy").trigger("click");
    await flushPromises();
    expect(
      wrapper.find(".trade-fields").attributes("disabled"),
    ).toBeUndefined();
    expect(
      (wrapper.find('[aria-label="成交价"]').element as HTMLInputElement).value,
    ).toBe("10");
    await wrapper.find(".submit-order.sell").trigger("click");
    await flushPromises();
    expect(vi.mocked(saveAccount).mock.calls[1][0].entries.at(-1)?.kind).toBe(
      "sell",
    );
  });
  it.each(["buy", "sell"] as const)(
    "%s按钮决定入账方向，费用预览与实际一致",
    async (direction) => {
      await start();
      expect(wrapper.find(".trade-sides").exists()).toBe(false);
      expect(wrapper.find('[data-direction="buy"] strong').text()).toBe(
        "1,005.01",
      );
      expect(wrapper.find('[data-direction="sell"] strong').text()).toBe(
        "994.49",
      );
      await wrapper.find(".ticket form").trigger("submit");
      expect(saveAccount).not.toHaveBeenCalled();
      await wrapper.find(`.submit-order.${direction}`).trigger("click");
      await flushPromises();
      const saved = vi.mocked(saveAccount).mock.calls[0][0].entries.at(-1)!;
      expect(saved.kind).toBe(direction);
      expect(saved.price).toBe("10");
      expect(saved.quantity).toBe("100");
      expect(saved.fees?.stamp).toBe(direction === "buy" ? "0.00" : "0.50");
      expect(saved.fees?.cash).toBe(direction === "buy" ? "1005.01" : "994.49");
      expect(wrapper.emitted("close")).toHaveLength(1);
    },
  );
  it("无底仓只禁用卖出，买入仍可提交；输入非法时双向均禁用", async () => {
    account.entries = [];
    await start();
    expect(
      wrapper.find(".submit-order.sell").attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find(".submit-order.buy").attributes("disabled"),
    ).toBeUndefined();
    await wrapper.find('[aria-label="成交股数"]').setValue("0");
    expect(
      wrapper.find(".submit-order.buy").attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find(".submit-order.sell").attributes("disabled"),
    ).toBeDefined();
  });
  it("重复确认限定方向，不能用买入确认绕过卖出重复检查", async () => {
    for (const side of ["buy", "sell"] as const)
      insertRecord(
        account,
        draftRecord(account, id, side, "10", "100", "2026-08-28T01:30:00.000Z")
          .entry,
      );
    await start();
    await wrapper.find(".submit-order.buy").trigger("click");
    await wrapper.find(".duplicate-warning input").setValue(true);
    await wrapper.find(".submit-order.sell").trigger("click");
    expect(saveAccount).not.toHaveBeenCalled();
    expect(wrapper.find(".duplicate-warning").text()).toContain("卖出");
    expect(
      (wrapper.find(".duplicate-warning input").element as HTMLInputElement)
        .checked,
    ).toBe(false);
    await wrapper.find(".duplicate-warning input").setValue(true);
    await wrapper.find(".submit-order.sell").trigger("click");
    await flushPromises();
    expect(vi.mocked(saveAccount).mock.calls[0][0].entries.at(-1)?.kind).toBe(
      "sell",
    );
  });
  it("保存期间双向按钮锁定，连点不会记录两笔", async () => {
    let finish!: (revision: number) => void;
    vi.mocked(saveAccount).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await start();
    await wrapper.find(".submit-order.buy").trigger("click");
    await wrapper.find(".submit-order.sell").trigger("click");
    expect(saveAccount).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".trade-fields").attributes("disabled")).toBeDefined();
    finish(2);
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
  it("草稿清理失败后禁止重复入账", async () => {
    vi.mocked(writeDraft).mockImplementation(async (_key, value) => {
      if (value === null) throw new Error("磁盘不可用");
    });
    await start();
    await wrapper.find(".submit-order.buy").trigger("click");
    await flushPromises();
    expect(document.querySelector(".floating-notices")?.textContent).toContain(
      "成交已保存，但旧草稿清理失败",
    );
    await wrapper.find(".submit-order.buy").trigger("click");
    expect(saveAccount).toHaveBeenCalledTimes(1);
  });
  it("旧双向草稿由用户选择，不自动混用；保存清理被选草稿和公共草稿", async () => {
    vi.mocked(readDraft).mockImplementation(async (key) =>
      key.endsWith(":buy")
        ? { ...draft, price: "9", side: "buy" }
        : key.endsWith(":sell")
          ? { ...draft, price: "11", side: "sell" }
          : undefined,
    );
    await start();
    expect(wrapper.findAll(".legacy-trade-drafts button")).toHaveLength(2);
    await wrapper.findAll(".legacy-trade-drafts button")[1].trigger("click");
    expect(
      (wrapper.find('[aria-label="成交价"]').element as HTMLInputElement).value,
    ).toBe("11");
    await wrapper.find(".submit-order.buy").trigger("click");
    await flushPromises();
    expect(vi.mocked(saveAccount).mock.calls[0][0].entries.at(-1)?.kind).toBe(
      "buy",
    );
    expect(writeDraft).toHaveBeenCalledWith(`trade:${id}:sell`, null);
    expect(writeDraft).toHaveBeenCalledWith(`trade:${id}:entry`, null);
    expect(writeDraft).not.toHaveBeenCalledWith(`trade:${id}:buy`, null);
  });
});

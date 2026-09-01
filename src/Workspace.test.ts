import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Workspace from "./LedgerWorkbench.vue";
import SecuritySearch from "./components/SecuritySearch.vue";
import { newAccount } from "./sim/ledger";
import {
  manualAccount,
  draftRecord,
  draftCash,
  insertRecord,
} from "./sim/record";
import { loadAccount, saveAccount } from "./sim/repository";
vi.mock("./sim/repository", () => ({
  loadAccount: vi.fn(),
  saveAccount: vi.fn(),
  exportAccount: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
let wrapper: ReturnType<typeof mount>;
async function start() {
  wrapper = mount(Workspace, { global: { stubs: { MarketChart: true } } });
  await flushPromises();
  return wrapper;
}
const button = (text: string) =>
  wrapper.findAll("button").find((b) => b.text() === text)!;
beforeEach(() => {
  vi.clearAllMocks();
  const a = newAccount();
  a.initialized = true;
  a.initialCash = "10000";
  a.feeConfirmed.etf = true;
  a.profiles.etf = {
    commissionWan: "1",
    minimum: "0",
    stampPercent: "0",
    transferPercent: "0",
  };
  vi.mocked(loadAccount).mockResolvedValue({ account: a, revision: 1 });
  vi.mocked(saveAccount).mockResolvedValue(2);
});
afterEach(() => wrapper?.unmount());
describe("交易台", () => {
  it("证券交易记录倒序筛选，切换证券更新空状态，全局历史仍显示全部记录", async () => {
    const a = manualAccount();
    const fee = { commission: "0.5", stamp: "0", transfer: "0" };
    for (const [id, side, time] of [
      ["sh510300", "buy", "2026-08-25T01:00:00.000Z"],
      ["sz159915", "buy", "2026-08-26T01:00:00.000Z"],
      ["sh510300", "sell", "2026-08-27T01:00:00.000Z"],
    ] as const)
      insertRecord(
        a,
        draftRecord(a, id, side, "10", "100", time, "", fee).entry,
      );
    vi.mocked(loadAccount).mockResolvedValue({ account: a, revision: 4 });
    wrapper = mount(Workspace, {
      props: {
        embedded: true,
        initialTab: "trades",
        symbol: "sh510300",
        historySecurityId: "sh510300",
        historyReadOnly: true,
        snapshot: { account: a, revision: 4 },
      },
      global: { stubs: { MarketChart: true } },
    });
    await flushPromises();
    const rows = () => wrapper.findAll(".ledger-history-table tbody tr");
    expect(rows()).toHaveLength(2);
    expect(wrapper.find("table.compact-history").exists()).toBe(true);
    expect(wrapper.findAll("col")).toHaveLength(8);
    expect(
      wrapper.findAll("col").map((col) => col.attributes("style")),
    ).toEqual([
      "width: 85px;",
      "width: 60px;",
      "width: 70px;",
      "width: 70px;",
      "width: 70px;",
      "width: 90px;",
      "width: 100px;",
      undefined,
    ]);
    expect(rows()[0].find("td:first-child > span").text()).toBe("2026-08-27");
    expect(rows()[0].find("td:first-child > small").text()).toBe("09:00:00");
    expect(rows()[0].text()).toContain("清仓");
    expect(rows()[1].text()).toContain("买入");
    expect(wrapper.find(".record-actions").exists()).toBe(false);
    expect(wrapper.findAll("th").some((th) => th.text() === "证券")).toBe(
      false,
    );
    await wrapper.setProps({ historySecurityId: "sz159915" });
    expect(rows()).toHaveLength(1);
    await wrapper.setProps({ historySecurityId: "sh600519" });
    expect(rows()).toHaveLength(0);
    expect(wrapper.text()).toContain("该证券暂无交易记录");
    await wrapper.setProps({
      historySecurityId: undefined,
      historyReadOnly: false,
    });
    expect(rows()).toHaveLength(3);
    expect(wrapper.find("table.compact-history").exists()).toBe(false);
    expect(
      wrapper.findAll("col").map((col) => col.attributes("style")),
    ).toEqual([
      "width: 85px;",
      "width: 160px;",
      "width: 60px;",
      "width: 90px;",
      "width: 90px;",
      "width: 90px;",
      "width: 120px;",
      "width: 120px;",
      undefined,
      "width: 90px;",
    ]);
    expect(wrapper.findAll(".record-actions")).toHaveLength(3);
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("全局成交记录可快捷搜索证券筛选，证券详情不重复显示搜索", async () => {
    const a = manualAccount();
    for (const [id, time] of [
      ["sh510300", "2026-08-25T01:00:00.000Z"],
      ["sz159915", "2026-08-26T01:00:00.000Z"],
    ] as const)
      insertRecord(
        a,
        draftRecord(a, id, "buy", "10", "100", time, "", {
          commission: "0.5",
          stamp: "0",
          transfer: "0",
        }).entry,
      );
    vi.mocked(loadAccount).mockResolvedValue({ account: a, revision: 3 });
    wrapper = mount(Workspace, {
      props: {
        embedded: true,
        initialTab: "trades",
        snapshot: { account: a, revision: 3 },
      },
      global: { stubs: { MarketChart: true } },
    });
    await flushPromises();
    const search = wrapper.findComponent(SecuritySearch);
    expect(search.exists()).toBe(true);
    expect(search.props("localOnly")).toBe(true);
    expect(search.props("securities")).toHaveLength(2);
    search.vm.$emit("select", a.securities[1]);
    await flushPromises();
    expect(wrapper.findAll(".ledger-history-table tbody tr")).toHaveLength(1);
    expect(wrapper.find(".history-filter-result").text()).toContain(
      a.securities[1].name,
    );
    await wrapper.find(".history-filter-result button").trigger("click");
    expect(wrapper.findAll(".ledger-history-table tbody tr")).toHaveLength(2);
    await wrapper.setProps({
      historySecurityId: "sh510300",
      historyReadOnly: true,
    });
    expect(wrapper.findComponent(SecuritySearch).exists()).toBe(false);
  });
  async function startHistory() {
    const a = manualAccount();
    const t = "2026-08-25T01:00:00.123Z";
    insertRecord(
      a,
      draftRecord(a, "sh510300", "buy", "10", "200", t, "原备注", {
        commission: "2",
        stamp: "0",
        transfer: "0",
      }).entry,
    );
    a.cashEntries!.push(draftCash("deposit", "3000", t));
    vi.mocked(loadAccount).mockResolvedValue({ account: a, revision: 4 });
    await start();
    return a;
  }
  it("修改弹窗回填原始成交，不改时间精度和费用，保存后刷新列表", async () => {
    const a = await startHistory();
    await button("成交记录").trigger("click");
    await button("修改").trigger("click");
    const inputs = wrapper.findAll(".history-editor input");
    expect((inputs[1].element as HTMLInputElement).value).toBe("10");
    await inputs[1].setValue("9");
    await wrapper.find(".history-editor").trigger("submit");
    await flushPromises();
    const saved = vi.mocked(saveAccount).mock.calls[0][0];
    expect(saved.entries[0].id).toBe(a.entries[0].id);
    expect(saved.entries[0].time).toBe(a.entries[0].time);
    expect(saved.entries[0].price).toBe("9");
    expect(saved.entries[0].fees?.total).toBe("2.00");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.querySelector(".floating-notices")?.textContent).toContain(
      "历史记录已修改",
    );
  });
  it("历史编辑双栏布局切换费用口径保留输入，取消不保存", async () => {
    await startHistory();
    await button("成交记录").trigger("click");
    await button("修改").trigger("click");
    expect(wrapper.find(".modal.history-modal").exists()).toBe(true);
    expect(wrapper.find(".history-body > fieldset").exists()).toBe(true);
    expect(wrapper.find(".history-body > .history-impact").exists()).toBe(true);
    expect(
      wrapper.findAll('.history-time-fields input[type="datetime-local"]'),
    ).toHaveLength(1);
    const editor = wrapper.find(".history-editor");
    const originalTime = (
      editor.find('input[type="datetime-local"]').element as HTMLInputElement
    ).value;
    await editor.findAll("input")[1].setValue("9.5");
    await editor.find(".actual-fees input").setValue("1.23");
    const feeSource = editor.findAll("select")[1];
    await feeSource.setValue("estimated");
    expect(editor.find(".actual-fees").exists()).toBe(false);
    expect(editor.text()).toContain("不使用当前账户设置");
    await feeSource.setValue("actual");
    expect(
      (editor.find(".actual-fees input").element as HTMLInputElement).value,
    ).toBe("1.23");
    expect((editor.findAll("input")[1].element as HTMLInputElement).value).toBe(
      "9.5",
    );
    expect(
      (editor.find('input[type="datetime-local"]').element as HTMLInputElement)
        .value,
    ).toBe(originalTime);
    await button("取消").trigger("click");
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it("删除须确认，取消不落库", async () => {
    await startHistory();
    await button("成交记录").trigger("click");
    await button("删除").trigger("click");
    expect(saveAccount).not.toHaveBeenCalled();
    expect(wrapper.find(".history-impact").text()).toContain("200 → 0");
    await button("取消").trigger("click");
    expect(saveAccount).not.toHaveBeenCalled();
    await button("删除").trigger("click");
    await button("确认删除这条记录").trigger("submit");
    await flushPromises();
    expect(vi.mocked(saveAccount).mock.calls[0][0].entries).toHaveLength(0);
    expect(wrapper.text()).toContain("暂无成交记录");
  });
  it("存在依赖成交时删除被拦截，不调用存储", async () => {
    const a = await startHistory();
    wrapper.unmount();
    insertRecord(
      a,
      draftRecord(
        a,
        "sh510300",
        "sell",
        "11",
        "100",
        "2026-08-26T01:00:00.000Z",
        "",
        { commission: "0", stamp: "0", transfer: "0" },
      ).entry,
    );
    await start();
    await button("成交记录").trigger("click");
    const buttons = wrapper.findAll(".record-actions");
    await buttons[1].findAll("button")[1].trigger("click");
    expect(document.querySelector(".floating-notices")?.textContent).toContain(
      "历史持仓不足",
    );
    expect(button("确认删除这条记录").attributes("disabled")).toBeDefined();
    await wrapper.find(".history-editor").trigger("submit");
    expect(saveAccount).not.toHaveBeenCalled();
  });
  it.each(["edit", "delete"])("%s保存失败保留原数据及弹窗", async (action) => {
    await startHistory();
    vi.mocked(saveAccount).mockRejectedValue(new Error("磁盘不可用"));
    await button("成交记录").trigger("click");
    await button(action === "edit" ? "修改" : "删除").trigger("click");
    if (action === "edit")
      await wrapper.findAll(".history-editor input")[1].setValue("9");
    await wrapper.find(".history-editor").trigger("submit");
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(document.querySelector(".floating-notices")?.textContent).toContain(
      "磁盘不可用",
    );
    expect(wrapper.find("tbody").text()).toContain("10");
    expect(wrapper.find(".account-strip").text()).toContain("998.00");
  });
  it("资金记录可以修改类型和金额，再确认删除", async () => {
    await startHistory();
    await button("资金流水").trigger("click");
    expect(
      wrapper
        .findAll(".cash-history-table col")
        .map((col) => col.attributes("style")),
    ).toEqual([
      "width: 85px;",
      "width: 130px;",
      "width: 140px;",
      "width: 100px;",
      undefined,
      "width: 90px;",
    ]);
    await button("修改").trigger("click");
    await wrapper.find(".history-editor select").setValue("repo-interest");
    await wrapper.findAll(".history-editor input")[1].setValue("3.52");
    await wrapper.find(".history-editor").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".account-strip").text()).toContain(
      "含逆回购利息 3.52",
    );
    await button("删除").trigger("click");
    await wrapper.find(".history-editor").trigger("submit");
    await flushPromises();
    expect(vi.mocked(saveAccount).mock.calls[1][0].cashEntries).toHaveLength(0);
    expect(wrapper.find(".account-strip").text()).toContain(
      "含逆回购利息 0.00",
    );
  });
  it("保存过程中重复提交只写入一次", async () => {
    await startHistory();
    let resolve!: (v: number) => void;
    vi.mocked(saveAccount).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await button("成交记录").trigger("click");
    await button("删除").trigger("click");
    await wrapper.find(".history-editor").trigger("submit");
    await wrapper.find(".history-editor").trigger("submit");
    expect(saveAccount).toHaveBeenCalledTimes(1);
    expect(button("正在保存…").attributes("disabled")).toBeDefined();
    resolve(5);
    await flushPromises();
  });
  it("新账本直接打开，不要求初始化资金", async () => {
    vi.mocked(loadAccount).mockResolvedValue({
      account: manualAccount(),
      revision: 0,
    });
    await start();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("初始化账户");
    expect(wrapper.find(".account-strip").text()).toContain("0.00");
  });
  it("转入资金按所填历史时间保存到现金流水", async () => {
    vi.mocked(loadAccount).mockResolvedValue({
      account: manualAccount(),
      revision: 0,
    });
    await start();
    await button("＋ 资金流水").trigger("click");
    await wrapper
      .find('.modal input[type="datetime-local"]')
      .setValue("2026-08-25T09:00:00");
    await wrapper
      .find('input[placeholder="以实际到账 / 转出金额为准"]')
      .setValue("1000");
    await wrapper.find(".modal form").trigger("submit");
    await flushPromises();
    const a = vi.mocked(saveAccount).mock.calls[0][0];
    expect(a.cashEntries?.[0].amount).toBe("1000.00");
    expect(a.cashEntries?.[0].time).toBe("2026-08-25T01:00:00.000Z");
    expect(a.entries).toHaveLength(0);
    expect(document.querySelector(".floating-notices")?.textContent).toContain(
      "资金流水已保存",
    );
  });
  it("国债逆回购利息不写入交易数量", async () => {
    vi.mocked(loadAccount).mockResolvedValue({
      account: manualAccount(),
      revision: 0,
    });
    await start();
    await button("＋ 资金流水").trigger("click");
    await wrapper.find(".modal select").setValue("repo-interest");
    await wrapper
      .find('input[placeholder="以实际到账 / 转出金额为准"]')
      .setValue("3.52");
    await wrapper.find(".modal form").trigger("submit");
    await flushPromises();
    expect(vi.mocked(saveAccount).mock.calls[0][0].cashEntries?.[0].kind).toBe(
      "repo-interest",
    );
    expect(wrapper.find(".account-strip").text()).toContain(
      "含逆回购利息 3.52",
    );
  });
  it("买入记录保存字符串金额和独立费用", async () => {
    await start();
    await wrapper.find('input[placeholder="输入已成交价格"]').setValue("4.600");
    await button("200").trigger("click");
    await button("买入").trigger("click");
    await flushPromises();
    const saved = vi.mocked(saveAccount).mock.calls[0][0];
    expect(saved.entries[0].price).toBe("4.600");
    expect(saved.entries[0].quantity).toBe("200");
    expect(saved.entries[0].fees?.cash).toBe("920.09");
    expect(document.querySelector(".floating-notices")?.textContent).toContain(
      "历史成交已记录",
    );
  });
  it("保存失败不改现金与成交", async () => {
    vi.mocked(saveAccount).mockRejectedValue(new Error("磁盘不可用"));
    await start();
    await wrapper.find('input[placeholder="输入已成交价格"]').setValue("4.600");
    await button("买入").trigger("click");
    await flushPromises();
    expect(document.querySelector(".floating-notices")?.textContent).toContain(
      "磁盘不可用",
    );
    expect(wrapper.find(".account-strip").text()).toContain("10,000.00");
    expect(wrapper.text()).not.toContain("历史成交已记录");
  });
  it("未确认ETF费率不允许估算费用", async () => {
    const a = newAccount();
    a.initialized = true;
    a.initialCash = "10000";
    vi.mocked(loadAccount).mockResolvedValue({ account: a, revision: 1 });
    await start();
    expect(button("买入").attributes("disabled")).toBeDefined();
    await button("费用设置").trigger("click");
    expect(wrapper.find(".fee-settings").text()).toContain(
      "最低佣金按每笔买入、卖出分别收取",
    );
    expect(wrapper.find(".fee-settings").text()).not.toContain("最低佣金为0");
    expect(
      (wrapper.findAll(".fee-settings input")[4].element as HTMLInputElement)
        .value,
    ).toBe("");
  });
  it("重启恢复多证券持仓，不自动创建示例成交", async () => {
    await start();
    expect(wrapper.text()).toContain("还没有录入持仓");
    expect(vi.mocked(saveAccount)).not.toHaveBeenCalled();
    expect(wrapper.findAll(".watch-row")).toHaveLength(3);
  });
  it("损坏账户只显示失败，不覆盖原数据库", async () => {
    vi.mocked(loadAccount).mockRejectedValue(new Error("JSON损坏"));
    await start();
    expect(wrapper.text()).toContain("原数据未覆盖");
    expect(saveAccount).not.toHaveBeenCalled();
  });
});

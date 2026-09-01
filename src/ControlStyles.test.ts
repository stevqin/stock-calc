import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";

// CSS cascade regressions, not a substitute for browser layout verification.
// Keep imports in the same order as workspace.css.
let style: HTMLStyleElement;
let fixture: HTMLDivElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = ["terminal-base.css", "controls.css", "workspace.css"]
    .map((file) =>
      readFileSync(new URL(file, import.meta.url), "utf8").replace(
        /^@import[^;]+;/gm,
        "",
      ),
    )
    .join("\n");
  document.head.append(style);
});
afterAll(() => style.remove());
beforeEach(() => {
  fixture = document.createElement("div");
  document.body.append(fixture);
});
afterEach(() => fixture.remove());
const css = (selector: string) =>
  getComputedStyle(fixture.querySelector(selector)!);
it("证券身份标签红底白字，T+0标签浅蓝且不影响代码", () => {
  fixture.innerHTML =
    '<table class="securities-table"><tbody><tr><td><small class="security-meta"><em class="security-identity">基</em><span>159915</span><em class="security-t0">T+0</em></small></td></tr></tbody></table>';
  expect(css(".security-identity").color).toBe("rgb(255, 255, 255)");
  expect(css(".security-identity").backgroundColor).toBe("rgb(198, 65, 75)");
  expect(css(".security-t0").color).toBe("rgb(50, 104, 207)");
  expect(css(".security-t0").backgroundColor).toBe("rgb(234, 241, 255)");
  expect(css(".security-t0").borderTopWidth).toBe("1px");
});
it("历史编辑采用自适应双栏，表单与重算预览没有固定高度或独立滚动区", () => {
  fixture.innerHTML =
    '<section class="modal history-modal"><form class="history-editor"><div class="history-body"><fieldset><div class="history-time-fields with-direction"><label>时间<input></label><label>方向<select></select></label></div><div class="actual-fees"></div><p class="footnote">说明</p></fieldset><div class="history-impact"></div></div><div class="backup-actions"></div></form></section>';
  expect(css(".history-body").display).toBe("grid");
  expect(css(".history-body").gridTemplateColumns).toBe(
    "minmax(0, 1.3fr) minmax(0, 1fr)",
  );
  expect(css(".history-time-fields").display).toBe("grid");
  expect(css("fieldset").gap).toBe("10px");
  expect(css(".history-impact").marginTop).toBe("0px");
  expect(css(".actual-fees").marginTop).toBe("0px");
  expect(css(".footnote").marginTop).toBe("0px");
  expect(css(".history-body").overflowY).not.toBe("auto");
  expect(css(".history-impact").overflowY).not.toBe("auto");
  expect(css(".history-modal").maxHeight).toBe("calc(100dvh - 48px)");
});
it("顶部收益金额与收益率同一行基线对齐，收益率保留12px字号", () => {
  fixture.innerHTML =
    '<section class="desk-summary"><div class="summary-with-return"><span>今日收益</span><div class="summary-values"><b>+1,234.56</b><small class="summary-return">+12.34%</small></div></div></section>';
  expect(css(".summary-values").display).toBe("flex");
  expect(css(".summary-values").alignItems).toBe("baseline");
  expect(css(".summary-values").flexWrap).toBe("nowrap");
  expect(css(".summary-values").whiteSpace).toBe("nowrap");
  expect(css(".summary-return").fontSize).toBe("12px");
  expect(css(".summary-return").marginTop).toBe("0px");
  expect(css(".summary-values b").marginTop).toBe("0px");
});
it("抽屉交易表随容器分配列宽，长备注可换行且不截断金额", () => {
  fixture.innerHTML =
    '<table class="ledger-history-table compact-history"><tbody><tr><td>123456789.00</td><td>长备注</td></tr></tbody></table>';
  expect(css("table").tableLayout).toBe("fixed");
  expect(css("table").width).toBe("100%");
  expect(css("table").minWidth).toBe("0");
  expect(css("td").whiteSpace).toBe("normal");
  expect(css("td").overflowWrap).toBe("anywhere");
  expect(css("td").textOverflow).not.toBe("ellipsis");
});
it("历史成交与资金流水隔行换色，只改变背景不覆盖金额颜色", () => {
  fixture.innerHTML =
    '<table class="ledger-history-table"><thead><tr><th>金额</th></tr></thead><tbody><tr><td class="gain">100</td></tr><tr><td class="loss">-100</td></tr><tr><td>0</td></tr></tbody></table><table class="other"><tbody><tr><td>其他表格</td></tr></tbody></table>';
  expect(
    css(".ledger-history-table tbody tr:nth-child(1) td").backgroundColor,
  ).toBe("rgb(255, 255, 255)");
  expect(
    css(".ledger-history-table tbody tr:nth-child(2) td").backgroundColor,
  ).toBe("rgb(243, 246, 250)");
  expect(
    css(".ledger-history-table tbody tr:nth-child(3) td").backgroundColor,
  ).toBe("rgb(255, 255, 255)");
  expect(css(".gain").color).toBe("rgb(198, 65, 75)");
  expect(css(".loss").color).toBe("rgb(72, 165, 121)");
  expect(css(".other td").backgroundColor).toBe("rgba(0, 0, 0, 0)");
});
it("消息栈脱离页面流，位于对话框上方且按钮可操作", () => {
  fixture.innerHTML =
    '<div class="floating-notices"><div class="floating-notice error"><span>错误</span><button>×</button></div></div>';
  expect(css(".floating-notices").position).toBe("fixed");
  expect(css(".floating-notices").zIndex).toBe("1000");
  expect(css(".floating-notices").overflowY).toBe("auto");
  expect(css(".floating-notice").pointerEvents).toBe("auto");
});
it("表格和盈亏文字统一红涨绿跌灰平", () => {
  fixture.innerHTML =
    '<span class="gain">+1</span><span class="loss">-1</span><span class="flat">0</span>';
  expect(css(".gain").color).toBe("rgb(198, 65, 75)");
  expect(css(".loss").color).toBe("rgb(72, 165, 121)");
  expect(css(".flat").color).toBe("rgb(143, 145, 144)");
});
it("共享尺寸令牌只有表单、工具栏和紧凑三档", () => {
  const root = getComputedStyle(document.documentElement);
  expect(root.getPropertyValue("--ui-field-height").trim()).toBe("36px");
  expect(root.getPropertyValue("--ui-button-height").trim()).toBe("32px");
  expect(root.getPropertyValue("--ui-compact-height").trim()).toBe("28px");
});
it("列选项复选框不继承全宽输入框，隐藏文件控件保持隐藏", () => {
  fixture.innerHTML =
    '<div class="column-options"><label><input type="checkbox">走势</label></div><input type="file" hidden>';
  expect(css('[type="checkbox"]').width).toBe("16px");
  expect(css('[type="checkbox"]').height).toBe("16px");
  expect(css("label").display).toBe("flex");
  expect(css('[type="file"]').display).toBe("none");
});
it("证券双行表头不受全局flex按钮影响", () => {
  fixture.innerHTML =
    '<table class="securities-table"><thead><tr><th><button>涨跌幅<small>涨跌额</small></button></th></tr></thead></table>';
  expect(css("button").display).toBe("inline-block");
  expect(css("button").height).toBe("auto");
});
it("证券表溢出时提供明确可见的细横向滚动条", () => {
  fixture.innerHTML = '<div class="securities-scroll"></div>';
  expect(style.textContent).toContain("overflow: auto");
  expect(style.textContent).not.toContain("scrollbar-width: thin");
  expect(style.textContent).toContain(
    ".securities-scroll::-webkit-scrollbar-thumb",
  );
  expect(style.textContent).toContain("height: 9px");
});
it("加减组件内部输入和按钮均为34px，外围边框组成36px", () => {
  fixture.innerHTML =
    '<div class="step-control"><button>−</button><input inputmode="decimal"><button>＋</button></div>';
  expect(css("input").height).toBe("34px");
  expect(css("button").height).toBe("34px");
  expect(css("input").marginTop).toBe("0px");
});
it("分组创建按钮按输入框底部对齐，不继承form顶部对齐", () => {
  fixture.innerHTML =
    '<section class="desk-dialog"><form class="group-form"><label>新增分组<input></label><button>创建分组</button></form></section>';
  expect(css("button").alignSelf).toBe("end");
  expect(css("form").display).toBe("grid");
});
it("成交和资金弹窗不泄露嵌入工作台的页脚", () => {
  fixture.innerHTML =
    '<section class="desk-dialog entry-dialog"><main class="ledger-embedded"><footer class="terminal-footer">旧工作台页脚</footer></main></section>';
  expect(css("footer").display).toBe("none");
});
it("录入与列设置弹窗按内容撑开，嵌入表单不拉伸填满", () => {
  fixture.innerHTML =
    '<section class="desk-dialog entry-dialog"><main class="terminal ledger-embedded record-embedded"><div class="trade-main-fields"></div><div class="trade-fee-fields"><div class="actual-fees"></div></div></main></section><section class="desk-dialog columns"><div class="column-order">少量字段</div></section>';
  expect(css(".entry-dialog").height).toBe("auto");
  expect(css(".entry-dialog").maxHeight).toBe("calc(100dvh - 48px)");
  expect(css(".ledger-embedded").height).toBe("auto");
  expect(css(".ledger-embedded").flexGrow).toBe("0");
  expect(css(".columns").height).toBe("auto");
  expect(css(".trade-main-fields").gridTemplateColumns).toBe(
    "repeat(3, minmax(0, 1fr))",
  );
  expect(css(".actual-fees").display).toBe("contents");
});
it("做T抽屉保持标准宽度，输入在上结果在下且指标按口径分列", () => {
  fixture.innerHTML =
    '<aside class="security-drawer"><main class="planner"><section class="planner-card planner-forward"><div class="planner-form"><div class="form-grid"></div></div><div class="planner-results"><div class="plan-kpis"></div></div></section><section class="planner-card planner-reverse"><div class="planner-form"><div class="form-grid"><label class="reverse-direction-field"></label></div></div><div class="planner-results"><div class="plan-kpis"></div></div></section></main></aside>';
  expect(css(".security-drawer").width).toContain("640px");
  expect(css(".security-drawer").width).not.toContain("820px");
  expect(css(".planner-card").display).toBe("block");
  expect(css(".planner-forward .form-grid").marginTop).toBe("0px");
  expect(css(".planner-forward .form-grid").marginBottom).toBe("0px");
  expect(css(".planner-results").borderTopWidth).toBe("1px");
  expect(css(".planner-results").borderLeftWidth).toBe("0px");
  expect(css(".planner-results").paddingLeft).toBe("0px");
  expect(css(".planner-forward .plan-kpis").gridTemplateColumns).toBe(
    "repeat(3, minmax(0, 1fr))",
  );
  expect(css(".planner-reverse .plan-kpis").gridTemplateColumns).toBe(
    "repeat(2, minmax(0, 1fr))",
  );
  expect(css(".planner-reverse .form-grid").gridTemplateColumns).toBe(
    "repeat(3, minmax(0, 1fr))",
  );
});

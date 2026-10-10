# 屏幕阅读器专用适配清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从项目维护的源代码、测试和 QA 页面中删除显式屏幕阅读器专用适配，同时保持现有视觉状态、鼠标操作、键盘操作和焦点行为。

**Architecture:** 先把 ARIA 同时承担的视觉状态和测试定位迁移到普通 class、`data-state` 或 `data-testid`，再删除 ARIA、显式 role、隐藏朗读文本和第三方 ARIA 配置。组件原生元素、可见标签、键盘事件、焦点管理和 `:focus-visible` 保留。

**Tech Stack:** Vue 3、TypeScript、CSS、Vitest、Vue Test Utils、Vite

**Spec:** `docs/superpowers/specs/2026-10-10-terminology-and-screen-reader-cleanup-design.md`

## Global Constraints

- 删除所有项目代码中的 `aria-*`、显式 `role`、`ariaLabel`、`aria-labels` 和 `.sr-only`。
- 保留可见 `<label>`、按钮文字、字段标题、`title` 和原生 HTML 元素。
- 保留 Esc、方向键、焦点锁定、焦点恢复、`tabindex`、`autofocus` 和 `:focus-visible`。
- 不修改业务计算、账户数据结构、网络接口或页面布局。
- 不编辑第三方依赖包内部代码。

## Review Focus

- 证券搜索键盘高亮：删除 `aria-selected` 后方向键仍滚动到当前候选；Task 1 测试覆盖。
- 无效输入视觉反馈：删除 `aria-invalid` 后错误边框仍出现；Task 1 和 Task 3 测试覆盖。
- 页签与切换按钮：删除 role/ARIA 状态后选中样式仍正确；Task 1 和 Task 3 测试覆盖。
- 弹窗焦点与 Esc：删除 dialog 属性后焦点锁定、恢复和关闭仍正常；Task 2 和 Task 3 测试覆盖。
- 测试定位稳定性：删除语义属性后测试不得依赖模糊的元素顺序；每个拥有重复控件的任务使用明确 class 或 `data-testid` 覆盖。

---

### Task 1: 表单与选择状态组件

**Files:**
- Modify: `src/components/DateTimeField.vue`
- Modify: `src/components/DateTimeField.test.ts`
- Modify: `src/components/PriceField.vue`
- Modify: `src/components/StepField.vue`
- Modify: `src/components/SecuritySearch.vue`
- Modify: `src/components/SecuritySearch.test.ts`
- Modify: `src/components/OrderBook.vue`
- Modify: `src/components/OrderBook.test.ts`
- Modify: `src/controls.css`

**Interfaces:**
- Consumes: Existing component props and emitted values.
- Produces: `DateTimeField.testId?: string` for test location, ordinary `.active`/`.invalid` state classes, and unchanged component events.

- [ ] **Step 1: Rewrite focused tests to avoid ARIA selectors**

Use visible labels, component classes, emitted values, and explicit `data-testid` only where repeated controls cannot be distinguished. Add assertions that search `.active`, order-book unit `.active`, and date field `.invalid` state render correctly.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/components/DateTimeField.test.ts src/components/SecuritySearch.test.ts src/components/OrderBook.test.ts src/App.test.ts`

Expected: FAIL because ordinary state classes/test IDs are not yet present.

- [ ] **Step 3: Migrate component state and remove assistive metadata**

Replace `DateTimeField.ariaLabel` with optional `testId`; remove VueDatePicker `aria-labels`; render invalid state through `.invalid`. In SecuritySearch, query `.active` for scrolling and apply it to the current candidate. In OrderBook and step/price fields, use `.active` and stable test IDs where tests need repeated icon controls. Delete all ARIA and explicit role attributes in these files.

- [ ] **Step 4: Replace CSS selectors tied to ARIA**

Change `aria-invalid`, `aria-selected`, and `aria-pressed` selectors to the ordinary state classes introduced in Step 3. Keep `:focus-visible` rules unchanged.

- [ ] **Step 5: Run focused tests and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components src/controls.css src/App.test.ts
git commit -m "refactor: remove screen reader metadata from controls"
```

### Task 2: 弹层、通知、图表与滚动条组件

**Files:**
- Modify: `src/components/FloatingNotice.vue`
- Modify: `src/components/FloatingNotice.test.ts`
- Modify: `src/components/SummaryHelp.vue`
- Modify: `src/components/RecoveryCenter.vue`
- Modify: `src/components/RowContextMenu.vue`
- Modify: `src/components/RowContextMenu.test.ts`
- Modify: `src/components/OverlayScrollbar.vue`
- Modify: `src/components/OverlayScrollbar.test.ts`
- Modify: `src/components/MarketChart.vue`
- Modify: `src/components/MiniChart.vue`
- Modify: `src/components/QuoteDetails.vue`
- Modify: `src/components/HistoryEditor.vue`
- Modify: `src/components/StatusIntradayChart.vue`
- Modify: `src/components/StatusIntradayChart.test.ts`

**Interfaces:**
- Consumes: Existing open/close, keyboard, chart, scroll, and notification behavior.
- Produces: The same visual and event behavior using component classes and test IDs instead of ARIA/role metadata.

- [ ] **Step 1: Rewrite focused tests and add behavior assertions**

Replace role/ARIA selectors with component classes or test IDs. Keep tests for notification dismissal, context-menu keyboard navigation, overlay scrollbar keyboard movement, chart rendering, Escape closing, and focus restoration.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/components/FloatingNotice.test.ts src/components/RowContextMenu.test.ts src/components/OverlayScrollbar.test.ts src/components/StatusIntradayChart.test.ts`

Expected: FAIL on the new selectors/state hooks.

- [ ] **Step 3: Remove screen-reader-only metadata and preserve behavior**

Delete explicit roles and ARIA attributes. Keep document key handlers, focus calls, native button/input elements, visible close controls, chart SVG, scrollbar `tabindex`, and all emitted events. Add ordinary component classes/test IDs only where required by Step 1.

- [ ] **Step 4: Remove hidden-reader content**

Delete hidden text nodes that exist only for reading assistance. Do not remove visible help copy or visible icon/button text.

- [ ] **Step 5: Run focused tests and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components
git commit -m "refactor: remove screen reader metadata from overlays"
```

### Task 3: 页面级模板与样式

**Files:**
- Modify: `src/App.vue`
- Modify: `src/App.test.ts`
- Modify: `src/TradingDesk.vue`
- Modify: `src/TradingDesk.test.ts`
- Modify: `src/LedgerWorkbench.vue`
- Modify: `src/Workspace.vue`
- Modify: `src/Workspace.test.ts`
- Modify: `src/PnlAnalysis.vue`
- Modify: `src/PnlAnalysis.test.ts`
- Modify: `src/StatusPanel.vue`
- Modify: `src/StatusPanel.test.ts`
- Modify: `src/components/SecuritiesTable.vue`
- Modify: `src/components/SecuritiesTable.test.ts`
- Modify: `src/workspace.css`
- Modify: `src/style.css`
- Modify: `src/terminal-base.css`

**Interfaces:**
- Consumes: Task 1 control state classes/test IDs and Task 2 overlay hooks.
- Produces: Page templates with no explicit screen-reader metadata and unchanged navigation, dialogs, filters, tables, planners, validation and menu-panel behavior.

- [ ] **Step 1: Rewrite page tests with visible/class/test-ID selectors**

Cover main navigation, summary help, security detail, trade entry, history filters, reconciliation, planner tabs, P&L ranges/day detail, table sorting/column settings and status panel actions. Retain assertions for Escape, focus trapping/restoration, arrow controls, invalid state and selected visual classes.

- [ ] **Step 2: Run page tests and verify failure**

Run: `npm test -- --run src/App.test.ts src/TradingDesk.test.ts src/Workspace.test.ts src/PnlAnalysis.test.ts src/StatusPanel.test.ts src/components/SecuritiesTable.test.ts src/PlannerInteraction.test.ts src/TradeEntry.test.ts`

Expected: FAIL on the new non-ARIA selectors and state classes.

- [ ] **Step 3: Remove page-level ARIA and explicit roles**

Delete screen-reader-only attributes from all files in this task. Replace visual CSS selectors such as `[aria-current]` and `[aria-expanded]` with existing or new `.active`/`.open` classes. Replace code queries such as close-button ARIA selectors with dedicated classes or test IDs.

- [ ] **Step 4: Remove `.sr-only` content and style**

Delete hidden search text and the `.sr-only` declaration. Preserve the visible search field, placeholder and search behavior.

- [ ] **Step 5: Run page tests and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "refactor: remove screen reader metadata from pages"
```

### Task 4: QA、静态扫描与完整验证

**Files:**
- Modify: `qa/scrollbars/main.ts`
- Modify only if the scan finds missed project-owned source or tests.

**Interfaces:**
- Consumes: Tasks 1–3 completed source and test migrations.
- Produces: Repository-wide proof that the targeted metadata is absent and the application still builds.

- [ ] **Step 1: Remove QA-only metadata**

Delete QA scrollbar ARIA and explicit role values. Retain its keyboard and scroll behavior.

- [ ] **Step 2: Run the strict source scan**

Run: `rg -n "aria-|role=|:role=|ariaLabel|aria-labels|sr-only" src qa index.html`

Expected: No matches. `font-variant-numeric` is unrelated and must remain.

- [ ] **Step 3: Run all frontend tests**

Run: `npm test -- --run`

Expected: All tests pass.

- [ ] **Step 4: Run formatting and production build**

Run: `npm run check:format && npm run build`

Expected: Prettier, TypeScript and Vite pass.

- [ ] **Step 5: Run native tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: All non-network Rust tests pass; existing explicitly ignored network smoke tests remain ignored.

- [ ] **Step 6: Preview affected surfaces**

Check the main workspace, trade dialog, P&L analysis, security search, context menu, date picker, overlay scrollbar and status-panel QA fixture. Confirm selected/invalid/open visual states and keyboard/focus interactions remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add qa src
git commit -m "test: verify screen reader metadata removal"
```


# 卖出盈亏术语统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有用户可见的“已实现盈亏”表达改成按累计、历史、区间和当日上下文区分的“卖出盈亏”，并明确部分卖出也会计入。

**Architecture:** 保留 `realized` 内部字段、FIFO 算法和数据格式，只修改展示文案、帮助提示、测试期望和说明文档。术语按展示上下文选择，避免把卖出确认盈亏误解为仅在清仓后产生。

**Tech Stack:** Vue 3、TypeScript、Vitest、Markdown

**Spec:** `docs/superpowers/specs/2026-10-10-terminology-and-screen-reader-cleanup-design.md`

## Global Constraints

- `realized` 字段、SQLite、账户 JSON 和 FIFO 计算不得改变。
- “卖出盈亏”必须明确包含部分卖出和已经清仓的交易。
- “清仓盈亏”只用于持仓数量归零后的完整轮次统计。
- 金额、颜色和现有页面布局不得改变。

## Review Focus

- 部分卖出后仍持仓：必须显示在卖出盈亏中，不能写成清仓盈亏；Task 1 的文案测试覆盖。
- 已全部清仓的历史证券：仍计入历史卖出盈亏；Task 1 的证券贡献测试覆盖。
- 区间跨越多次卖出：区间标题必须区别于累计标题；Task 1 的盈亏分析测试覆盖。
- 单日明细：只能写“当日卖出盈亏”；Task 1 的日期弹窗测试覆盖。
- 做 T 同日配对收益：提示必须说明不能与 FIFO 卖出盈亏相加；Task 1 的说明文字测试覆盖。

---

### Task 1: 用户界面术语

**Files:**
- Modify: `src/LedgerWorkbench.vue`
- Modify: `src/Workspace.vue`
- Modify: `src/TradingDesk.vue`
- Modify: `src/PnlAnalysis.vue`
- Modify: `src/components/SecuritiesTable.vue`
- Modify: `src/components/HistoryEditor.vue`
- Modify: `src/sim/workspaceState.ts`
- Test: `src/TradingDesk.test.ts`
- Test: `src/Workspace.test.ts`
- Test: `src/PnlAnalysis.test.ts`
- Test: `src/components/SecuritiesTable.test.ts`
- Test: `src/sim/performance.test.ts`

**Interfaces:**
- Consumes: Existing `Ledger.realized`, `Position.realized`, `AnalysisSummary.realized`, and `SecurityContribution.realized` values.
- Produces: The approved cumulative, historical, interval, and daily display labels without changing any value type.

- [ ] **Step 1: Update tests with the approved terms**

Add assertions for `累计卖出盈亏（FIFO）`, `历史卖出盈亏`, `区间卖出盈亏`, `当日卖出盈亏`, and the explanation `包含部分卖出和已经清仓的交易`. Keep the existing partial-sell and closed-position fixtures so labels are verified against both states.

- [ ] **Step 2: Run the focused tests and verify they fail on the old copy**

Run: `npm test -- --run src/TradingDesk.test.ts src/Workspace.test.ts src/PnlAnalysis.test.ts src/components/SecuritiesTable.test.ts src/sim/performance.test.ts`

Expected: FAIL because the rendered text still contains the old terminology.

- [ ] **Step 3: Replace UI copy by context**

Use exactly these labels: account/detail/history preview `累计卖出盈亏（FIFO）`; holding/contribution table `历史卖出盈亏`; range summary/table `区间卖出盈亏`; day dialog `当日卖出盈亏`. Replace the same-day pairing explanation with `此项与按 FIFO 计算的卖出盈亏口径不同，不能相加。`

- [ ] **Step 4: Add the shared explanation where the metric has help text**

Use `卖出盈亏＝卖出净收入−按 FIFO 匹配的买入成本，包含部分卖出和已经清仓的交易。` Tooltips may prefix the relevant time scope but must keep this meaning.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "fix: clarify realized pnl as sell pnl"
```

### Task 2: 项目说明术语

**Files:**
- Modify: `README.md`
- Modify: `VALIDATION.md`
- Modify: `docs/pnl-analysis.md`
- Modify: `docs/releases/0.4.1.md`
- Modify: `docs/superpowers/specs/2026-09-07-pnl-analysis-design.md`
- Modify: `docs/superpowers/plans/2026-09-07-pnl-analysis.md`

**Interfaces:**
- Consumes: Task 1 approved labels.
- Produces: Documentation that describes the same formula and scope as the UI.

- [ ] **Step 1: Write a repository terminology scan and observe the old copy**

Run: `rg -n "累计已实现|历史已实现|已实现盈亏|FIFO已实现|FIFO 已实现" README.md VALIDATION.md docs src --glob '!docs/superpowers/specs/2026-10-10-terminology-and-screen-reader-cleanup-design.md'`

Expected: Matches in active UI, tests, and documentation before Task 1/2 are complete.

- [ ] **Step 2: Update prose without changing historical figures**

Replace terminology according to Task 1. Preserve every recorded amount, calculation example, validation result, version number, and date.

- [ ] **Step 3: Run the terminology scan**

Run the command from Step 1.

Expected: No matches.

- [ ] **Step 4: Commit**

```bash
git add README.md VALIDATION.md docs
git commit -m "docs: clarify sell pnl terminology"
```

### Task 3: 术语回归验证

**Files:**
- Modify only if verification finds a missed active string.

**Interfaces:**
- Consumes: Task 1 UI and Task 2 documentation.
- Produces: A verified terminology-only change with unchanged calculations.

- [ ] **Step 1: Run all frontend tests**

Run: `npm test -- --run`

Expected: All tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Verify the accounting engine remains unchanged**

Run: `git diff HEAD~2 -- src/sim/ledger.ts src/sim/analysis.ts src/sim/model.ts`

Expected: No diff.

- [ ] **Step 4: Commit any verification-only correction**

Commit only if Step 1–3 exposed a missed string; otherwise leave the task without an empty commit.


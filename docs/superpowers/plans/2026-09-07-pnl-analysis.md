# 盈亏分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 提供同级盈亏分析入口、区间统计和全部／年／月收益日历。

**Architecture:** 独立的纯函数模块重放账本并计算每日收益与轮次。独立历史行情服务按年度补取不复权行情；Vue 页面消费统一结果，不修改账户。

**Tech Stack:** Vue 3、TypeScript、Decimal、Vitest、Tauri/Rust、现有 ECharts。

**Spec:** docs/superpowers/specs/2026-09-07-pnl-analysis-design.md

## Global Constraints

- 沿用现有费用及 FIFO 口径，未知收益不得当作零。
- 月视图固定横排三个月，选择月份最右；默认当前月。
- 所有日期为上海日期，选择日期及视图不得触发账本保存。
- 保留工作区原有未提交改动。

### Task 1: 历史行情服务

Files: 新建 src/analysisHistory.ts、src/analysisHistory.test.ts；修改 src-tauri/src/charts.rs 和 lib.rs。

Interface: `loadAnalysisHistory(security: Security, year: number): Promise<ChartData>`，返回该年份及前一收盘基准的不复权行情。年度缓存与现有180日图表缓存隔离；在途请求去重、并发限制、错误可重试。

- [x] 写测试：缓存命中不重复请求、失败后重试、证券及复权类型不匹配拒绝。
- [x] 运行 `npm test -- src/analysisHistory.test.ts` 确认失败。
- [x] 增加按年请求的 Tauri 命令及解析校验，再实现服务与本地缓存。
- [x] 运行服务测试、Rust 测试；检查注册命令和请求参数。

### Task 2: 分析计算

Files: 新建 src/sim/analysis.ts、src/sim/analysis.test.ts。

Interface: `analyzeAccount(account, barsById, quotes, today)` 返回逐日数据和完整轮次；`summarizeAnalysis(analysis, start, end)` 返回区间汇总及贡献；`monthSequence(month)` 返回前二月及当前月字符串。

- [x] 用手算数据写失败测试：100份10元买入含费1001，11元全部卖出净收1099，总收益98；日间涨跌和已实现部分不重复计算。
- [x] 覆盖入金排除、利息收入、FIFO部分卖出、同日清仓再买、跨年三个月、闰年、缺价和期初快照。
- [x] 运行 `npm test -- src/sim/analysis.test.ts`，然后实现 Decimal 每日重放及轮次汇总。
- [x] 重跑测试，检查区间期初边界及零样本。

### Task 3: 分析页面与日历

Files: 新建 src/PnlAnalysis.vue、src/PnlAnalysis.test.ts、src/analysis.css；修改 TradingDesk.vue。

- [x] 写失败交互测试：顶级入口、三种视图、年12格、月3格及跨年、日详情。
- [x] 添加时间筛选、概览、累计盈亏图、贡献表、日历与数据状态；使用本地ref维护筛选状态。
- [x] 按年加载历史已交易证券行情，限制并发；展示请求失败、缓存、盘中估算和数据缺口。
- [x] 运行 `npm test -- src/PnlAnalysis.test.ts src/TradingDesk.test.ts`。

### Task 4: 整体验证

- [x] 执行 `npm test` 和 `npm run build`。
- [x] 浏览器使用独立预览数据检查1280宽和窄窗口，确保三个月仍为一行且不影响顶部导航。
- [x] 检查最终差异、统计口径说明和用户数据未改变；报告验证边界。

# 个股与分组多模型 AI 分析第一版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现单股抽屉与分组弹窗中的多模型独立分析、综合结论和证据追溯，并将报告长期保存在本机。

**Architecture:** Rust 原生层统一负责公开资料采集、模型网关、任务队列与 SQLite 仓储；Vue 负责配置与报告交互。每个任务冻结证据包，多模型独立分析后再汇总；前端关闭面板不影响任务生命周期。

**Tech Stack:** Vue 3、TypeScript、Tauri 2、Rust 2021（现有最低版本 1.87）、reqwest 0.12、rusqlite 0.32、Vitest。新增系统密钥库、PDF 文本提取、内容哈希和异步队列依赖在所属任务中验证平台兼容及锁文件，不升级无关依赖。

**Spec:** [已确认设计](../specs/2026-10-13-ai-stock-analysis-design.md)。执行前必须同时阅读设计与本计划。

状态：用户已确认并选择当前会话直接实施；任务 1 已完成来源验证，新闻范围调整已于 2026-10-13 确认，正在推进阶段 B。

## Global Constraints

- 默认选择 2～3 个参与模型，不限制配置数量；配置数量与并发数分开。
- 全局默认最多 3 个模型请求并发，同一 API 地址默认最多 2 个。请求超时默认 120 秒。
- 瞬时连接错误、限流和 5xx 默认至多自动重试一次；格式修复最多另调用一次；鉴权、模型标识和协议错误不自动重试。
- 新闻默认最近 72 小时，近 7 天持续事件补充；公告默认最近 30 个自然日；日 K 默认最近 120 个交易日。
- 单股最多纳入 20 条去重新闻和 20 份相关公告；超限说明筛选，超大请求不静默截断。
- 当前到收盘以快照价为基准；未来 1～5 个交易日从下一交易日起算；时区 Asia/Shanghai；交易时段报价超过 2 分钟标为延迟。
- OpenAI 兼容 Chat Completions；默认 HTTPS，仅 localhost/回环地址允许显式 HTTP；密钥只存系统安全存储。
- 公开来源无需额外付费；先验证来源，不绕过访问限制；缺失资料不能伪造。新闻先展示来源链接并支持手动补充资料，自动免费新闻正文渠道继续验证，不阻塞仓储和模型配置。
- 首轮模型互相看不到答案；汇总模型可以参与首轮，汇总必须是独立调用。
- 报告本地长期保存；重新分析产生新快照，重新汇总保留原快照和旧汇总版本。
- 不发送账户成本与成交流水，不实现定时任务、交易执行、付费资讯、收藏或导出。
- 当前 `src/TradingDesk.vue`、`src/components/QuoteDetails.vue` 及未跟踪历史脚本已有用户工作；执行时重新检查，不覆盖、不混入提交。计划确认后再按 worktree 技能决定执行隔离方式。

## Review Focus

五类容易遗漏的真实输入及归属测试：

1. 来源只有日期，或抓取时出现截止时间之后的数据：不能进入已确认催化（任务 4）。
2. 自定义地址含路径、查询参数或重定向到其他主机：规范端点、拒绝歧义输入，不能泄漏鉴权（任务 3）。
3. 模型返回看似合法但引用了另一只股票、无依据价位或正文内嵌指令：拒绝无效引用、隔离资料指令（任务 6）。
4. 取消发生于发送之后、结果写入之前，或进程此时退出：计数与落盘一致，重启不自动再次调用（任务 7）。
5. 历史汇总期间配置被删除，或分组成员改变：身份与成员快照稳定，旧结论不能混入新资料（任务 10、12）。

## 开发顺序与阶段验收

| 阶段 | 任务 | 可审阅交付物 | 通过条件 |
| --- | --- | --- | --- |
| A 公开来源验证 | 1 | 来源能力矩阵、样例与限制说明 | 新闻、公告、日历的可用范围有证据；不可用项明确，不假称已接入 |
| B 配置与基础存储 | 2～3 | DTO、AI 表、密钥与兼容网关 | 迁移不改账本；密钥无明文；端点、并发、超时及重试验证通过 |
| C 冻结资料与时间定义 | 4～5 | 证据包、指标、时间窗口 | 同一截止时间、来源状态可追溯；时间与停牌边界明确 |
| D 多模型分析核心 | 6～7 | 报告校验、汇总映射、任务编排 | 共识不误计、独立快照一致、取消与恢复安全、调用数正确 |
| E 单股闭环与历史 | 8～10 | 设置界面、右侧抽屉、版本历史 | 用户可配置并运行；展开关键结论查看模型依据；重启与版本回看有效 |
| F 分组批量 | 11～12 | 批量执行与弹窗 | 成员冻结、逐只展示、部分失败、分组总结与引用全部可追溯 |
| G 集成验收 | 13 | 验收记录与用户文档 | 全部设计验收项通过，来源和平台限制如实记录 |

按表内顺序执行；来源验证未完成前不开发依赖未经验证端点的采集器。基础模块可以用固定样例验证，但不能据此宣称真实来源已接入。阶段 E 已是可使用的单股闭环，阶段 F 在同一核心上增加批量能力。

## 文件结构与跨模块契约

新增原生模块置于 `src-tauri/src/ai/`：`mod.rs` 注册命令，`types.rs` DTO，`repository.rs` 和 `schema.sql` 仓储，`credentials.rs` 密钥，`gateway.rs` HTTP，`sources/` 资料适配器，`snapshot.rs` 快照，`calendar.rs` 时间窗口，`reports.rs` 输出校验，`prompts.rs` 提示模板，`scheduler.rs` 队列，`runner.rs` 编排。Rust 测试跟随模块，公共固定资料在 `src-tauri/src/ai/fixtures/`。

新增前端功能目录 `src/ai/`：`types.ts`、`client.ts`、`useAiAnalysis.ts`、`calls.ts`、`ModelSettings.vue`、`AnalysisSetup.vue`、`StockAnalysisDrawer.vue`、`BatchAnalysisDialog.vue`、`ReportView.vue`、`EvidenceDetails.vue`、`HistoryList.vue`、`ai.css` 及对应 `.test.ts`。`ReportView` 被单股与批量共享。

现有文件只增加必要接线：`src-tauri/src/lib.rs`、`storage.rs`、`charts.rs`、`fund_flows.rs`、`src/TradingDesk.vue`、`Cargo.toml`、`Cargo.lock`；不拆解或重写现有行情、收益、账本子系统。

`types.rs` 为原生契约源，serde 使用 camelCase；`types.ts` 镜像契约，公共 JSON fixture 同时经过 Rust 反序列化及 TypeScript 测试。核心 DTO 定义如下，所有任务引用同名类型：

| 类型 | 必须包含的字段 |
| --- | --- |
| `SecurityRef` | id、market、code、name、asset（stock/etf） |
| `ModelConfig` / `ModelConfigInput` | id、displayName、provider、baseUrl、model、enabled；对外无密钥和密钥引用 |
| `ModelDefaults` | participantIds、summaryModelId；选择必须引用启用的有效配置 |
| `StartRequest` | requestId、securities、group（可空，id/name/memberIds）、participantIds、summaryModelId |
| `Evidence` | id、securityId、kind、source、url、publishedAt、timePrecision、eventAt、collectedAt、content、contentHash、availability |
| `Snapshot` | id、security、cutoffAt、frozenAt、referencePrice、windows、series、indicators、evidence、sourceStates、ruleVersions |
| `IndependentReport` | id、snapshotId、modelSnapshot、windows、claims、rawOutput、validation、usage |
| `SummaryVersion` | id、snapshotId、version、inputReportIds、summaryModelSnapshot、windows、keyClaims、disagreements、validation |
| `TaskDetail` | id、parentId、status、securitySnapshots、requestSnapshot、progress、callAttempts、reports、summaryVersions、groupSummaryVersions、errors |
| `HistoryQuery` / `HistoryPage` | securityId/dateFrom/dateTo/status/cursor/limit；items/nextCursor，默认 limit=30 |

命令错误统一为 `AiError { code, message, retryable }`。ID 使用 UUID；时间保存带偏移的 ISO 8601；价格金额沿用十进制字符串；模型身份包括配置 ID、显示名、服务商、地址和模型标识，不含凭证。枚举与 JSON 版本随任务 2 固定。

IPC 命令：`ai_list_models`、`ai_save_model`（input、可选 replacementSecret）、`ai_delete_model`、`ai_get_defaults`、`ai_save_defaults`、`ai_test_model`、`ai_start_analysis`、`ai_get_task`、`ai_cancel_task`、`ai_retry_failed_model`（taskId/modelConfigId）、`ai_resummarize`（taskId/inputReportIds/summaryModelId）、`ai_resummarize_group`（taskId/childSummaryVersionIds/summaryModelId）、`ai_list_history`、`ai_delete_task`。均由 `client.ts` 提供返回 DTO 的 Promise 包装。单股重新分析调用 `ai_start_analysis`，不另开协议；批量所有个股重新汇总使用逐子任务 `ai_resummarize` 再 `ai_resummarize_group`。

## Task 1：公开来源可行性与日历验证（阶段 A）

**Files:** 创建 `docs/ai-source-validation.md`，`src-tauri/src/ai/fixtures/sources/` 中脱敏样例及元信息。此任务不添加生产端点或模型请求。

**Interfaces:** 产出来源能力矩阵：渠道、官方参考、获取方式、免费条件、字段、时间精度、正文能力、限流、已测日期、失败情况、启用结论；供任务 4、5 使用。

- [x] 核实设计候选新闻、公告和中国市场交易日渠道，记录使用条件与实际获取路径。
- [x] 对沪市股票、深市股票、ETF 各取小规模样本，记录成功、无内容、正文不可得三类结果；不以单次成功推断长期稳定。
- [x] 核对新闻原始媒体、公告代码和链接、交易日覆盖年份，保存合法可保留的最小样例。
- [x] 形成启用/禁用结论；没有符合条件的新闻、公告或日历渠道时列出实际缺口，提请调整来源方案，不凭空指定端点。无法核验日历时后续进入未知状态。
- [x] 验收：矩阵每个结论有样本或明确失败证据；提交仅包含来源说明与样例，提交信息 `docs: validate public AI analysis sources`。

## Task 2：DTO、迁移与报告仓储（阶段 B）

**Files:** 创建 `ai/types.rs`、`schema.sql`、`repository.rs`、`fixtures/contracts/`、`src/ai/types.ts`、`types.test.ts`；修改 `storage.rs`、`lib.rs`。本节原生路径均相对 `src-tauri/src/`。

**Interfaces:** `repository::initialize(&Connection) -> Result<(), AiError>`；`create_task(&mut Connection, &StartRequest) -> Result<TaskDetail, AiError>`；`save_snapshot(&mut Connection, task_id: &str, &Snapshot)`、`save_report(...)`、`append_summary(...)`、`get_task(&Connection, task_id: &str)`、`list_history(&Connection, &HistoryQuery)`、`delete_task(&mut Connection, task_id: &str)` 均返回对应 DTO 或 `Result<(), AiError>`。后续任务通过仓储追加记录，不覆盖已存在版本。

- [ ] 写测试 `migration_preserves_account_and_history`、`duplicate_request_returns_same_task`、`summary_versions_are_append_only`、`delete_keeps_shared_evidence`：迁移前后原账户与历史不变；相同 requestId 只有一个任务；版本 1、2 都能读；有引用证据不删除。契约 fixture 包含空列表、可空时间、stock/etf 和全部状态枚举。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml ai::repository` 与 `npm test -- src/ai/types.test.ts`，确认新功能断言失败。
- [ ] 实现独立 AI 表、索引和事务；首版必要快照均存 SQLite JSON，避免外置文件一致性复杂度。锁只覆盖短事务，网络请求期间不持有数据库 Mutex；账号备份格式不暗中改变。
- [ ] 重跑上述命令至通过；提交 `feat: add AI report contracts and local repository`。

## Task 3：安全密钥与模型网关（阶段 B）

**Files:** 创建 `ai/credentials.rs`、`gateway.rs`、`scheduler.rs`；修改 `ai/mod.rs`、`lib.rs`、`Cargo.toml`、`Cargo.lock`。

**Interfaces:** `SecretStore` 提供 `set/get/delete(config_id, secret)` 的 Result 方法；`gateway::normalize_endpoint(base_url: &str) -> Result<String, AiError>`；`complete(config: &ModelConfig, request: &CompletionRequest, context: &CallContext) -> Result<CompletionResponse, AiError>`。`CompletionRequest` 包含 messages 和输出 token 上限，响应包含原文和可选 usage；`CallContext` 携带 taskId、callId、取消信号及重试分类。`scheduler::acquire(normalized_origin, cancel)` 返回可释放并发许可。

- [ ] 写 `credentials_never_enter_sqlite_or_errors`、`endpoint_preserves_v1_and_rejects_query_or_credentials`、`cross_host_redirect_is_rejected`、`limits_global_3_origin_2`、`timeout_120s_and_retry_once`。断言 URL 用户信息/查询/fragment 被拒绝、尾斜杠正常、非回环 HTTP 拒绝；鉴权不重试、取消可中止等待、permit 最终释放。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml ai::gateway`、`ai::credentials`、`ai::scheduler` 对应过滤命令，确认失败。
- [ ] 用系统密钥库实现 macOS/Windows 存储，用测试替身隔离真实凭证；网关独立 reqwest client 默认禁止重定向，设 120 秒超时。队列采用可取消信号与 Tokio 信号量；补齐必要依赖。单次逻辑请求总发送最多 3 次：原始请求、一次瞬时错误重试、一次格式修复；修复不再重试。地址容量按 scheme/host/port 归一，不通过路径绕过限制。
- [ ] 添加配置 CRUD、默认选择和连接测试命令；密钥写入失败不能留下可用配置假象，配置删除时避免破坏运行中模型快照。重跑过滤测试通过；提交 `feat: add secure compatible model gateway`。

## Task 4：公开资料适配器与冻结证据（阶段 C）

**Files:** 创建 `ai/sources/mod.rs`、`news.rs`、`announcements.rs`、`market.rs`、`snapshot.rs`；按必要范围修改 `charts.rs`、`fund_flows.rs`，复用现有解析与请求函数。

**Interfaces:** `sources::collect(security: &SecurityRef, cutoff_at: &str, cancel: &CancelToken) -> Result<CollectedData, AiError>`；`snapshot::freeze(data: CollectedData, windows: AnalysisWindows) -> Result<Snapshot, AiError>`。`CollectedData` 含系列数据、证据及逐来源状态 success/empty/failed/unsupported；证据正文级别为 full/excerpt/titleOnly。

- [ ] 写 `same_name_different_code_not_matched`、`reprints_deduplicated`、`post_cutoff_and_date_only_not_confirmed`、`title_only_pdf_not_fact`、`caps_20_news_20_announcements`、`etf_does_not_receive_company_template`。fixture 明确 72 小时、7 天、30 天和 120 交易日窗口，以及输入资料中的“忽略系统指令”文本。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml ai::sources` 和 `ai::snapshot`，确认失败。
- [ ] 仅实现任务 1 验证可用的来源；新闻先显示来源链接，新增手动补充资料入口及 userProvided 证据类型，不自动抓取用户填写的任意 URL；采用限定域名、超时、失败状态和数据大小上限。PDF 提取作为公告适配器子步骤，用明确可兼容依赖；解析失败保存 titleOnly，不进行 OCR。使用 Decimal 对应的精确十进制计算或现有可复用指标，不把空值变 0。
- [ ] 截止时间后报价也不作为快照基准；采集后若只有晚于截止的数据，则明确缺失并允许用户新开任务。冻结后内容不可变，保存哈希、时间精度、来源口径、筛选省略数和版本。任何本地指标都保存原始计算输入。
- [ ] 重跑过滤测试通过，再对已验证来源作小规模集成检查；提交 `feat: collect traceable market news and announcement snapshots`。

## Task 5：交易时间、趋势基准与停牌（阶段 C）

**Files:** 创建 `ai/calendar.rs`、日历 fixture；修改 `snapshot.rs`、`types.rs`。

**Interfaces:** `calendar::resolve_windows(now: &str, calendar: &TradingCalendar, quote: &QuoteState) -> Result<AnalysisWindows, AiError>`；`TradingCalendar` 包含有效覆盖期与已核验交易日，`QuoteState` 包含报价时间、价格、停牌状态及其来源。`AnalysisWindows` 带展示名称、起止时间、比较基准、可预测状态和原因。

- [ ] 写 `before_open_uses_previous_close`、`lunch_uses_last_morning_quote`、`after_close_is_review`、`holiday_uses_next_verified_day`、`future_starts_next_trading_day`、`stale_over_120s_blocks_near_term`、`unknown_calendar_or_suspension_does_not_guess`；使用固定中国时区时间，覆盖 2 分钟阈值前后与跨年假期。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml ai::calendar` 确认失败。
- [ ] 接入任务 1 核验的日历数据并本地缓存；覆盖期外显示未知，不按周一至周五补造。停牌和复牌只用可核验状态；报告中固定两个窗口语义，收盘复盘与下一日展望分别标明。
- [ ] 重跑通过；提交 `feat: define verified trading windows for AI analysis`。

## Task 6：独立报告与汇总证据校验（阶段 D）

**Files:** 创建 `ai/reports.rs`、`prompts.rs`、`fixtures/reports/`；补齐 `types.rs`。

**Interfaces:** `prompts::independent(&Snapshot) -> CompletionRequest`；`prompts::summary(&Snapshot, &[IndependentReport]) -> CompletionRequest`；`reports::validate_independent(raw: &str, &Snapshot) -> Result<IndependentReportBody, ValidationError>`；`validate_summary(raw: &str, &Snapshot, &[IndependentReport]) -> Result<SummaryBody, ValidationError>`。Body 不含身份和时间等由系统提供字段，模型不能改写任务元数据。

- [ ] 写 `independent_prompt_has_no_peer_answers`、`unknown_or_other_stock_reference_invalid`、`price_without_calculation_basis_invalid`、`unsupported_summary_not_published`、`unmentioned_is_not_support`、`one_valid_model_is_not_consensus`、`source_text_is_data_not_instruction`。要求结论 ID 与证据 ID 可关联，不接受另股票证据；缺字段和非法方向返回明确校验错误。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml ai::reports` 和 `ai::prompts` 确认失败。
- [ ] 固定 JSON 输出版本与提示模板；解析非流式响应，严格校验结构与引用，原文保留但无效报告不进入汇总。系统计算共识覆盖数和完整程度；不由汇总模型随意生成计票结果。无法机械验证的推理质量如实视为模型判断，引用有效不等于事实判断已获证明。
- [ ] 重跑通过；提交 `feat: validate independent and synthesized evidence reports`。

## Task 7：单股任务编排、取消和中断恢复（阶段 D）

**Files:** 创建 `ai/runner.rs`；修改 `scheduler.rs`、`repository.rs`、`ai/mod.rs`、`lib.rs`；新增前端 `src/ai/client.ts`、`calls.ts`、`calls.test.ts`。

**Interfaces:** `runner::start(StartRequest) -> Result<TaskDetail, AiError>`、`cancel(task_id)`、`retry_failed_model(task_id, model_config_id)`、`resummarize(task_id, input_report_ids, summary_model_id)`；内部使用应用级 `AiRuntime` 持有运行任务、取消信号及队列。`calls.ts` 提供 `estimateCalls(stockCount: number, participantCount: number, mode: 'single' | 'batch' | 'summaryOnly' | 'allSummaries'): number`。

- [ ] 写 `all_models_receive_same_snapshot_hash`、`summary_role_is_separate_call`、`partial_failure_is_saved`、`all_fail_skips_summary`、`cancel_between_response_and_commit`、`restart_interrupts_without_request`、`repair_and_retry_record_actual_attempts`。前端断言单股 3 模型为 4，10 股为 41，10 股全部重新汇总为 11。
- [ ] 运行 Rust `ai::runner` 过滤测试及 `npm test -- src/ai/calls.test.ts` 确认失败。
- [ ] 实现状态机、幂等 requestId、每次发送前的 attempt 持久化及响应后写入；未知发送结果计为可能已发送，不自动补发。模型身份在启动冻结，汇总用有效独立报告。取消与响应争用不复活任务；完成结果仍保存，但取消后不启动下一调用。
- [ ] 在应用启动将遗留活跃任务改为中断；注册 IPC，返回脱敏错误；存储/网关交互不持锁跨 await。重跑通过；提交 `feat: orchestrate durable cancellable stock analysis tasks`。

## Task 8：模型设置与分析前配置（阶段 E）

**Files:** 创建 `src/ai/ModelSettings.vue`、`AnalysisSetup.vue`、对应 `.test.ts`、`ai.css`；修改 `TradingDesk.vue` 加「AI 设置」入口，接入 `client.ts`。

**Interfaces:** `ModelSettings` 发出 `saved`；`AnalysisSetup` 接收 models/defaults/securities/group，发出 `start(StartRequest)`，所有数量预估调用任务 7 的 `estimateCalls`。新密钥仅在提交时传原生命令，不存前端 localStorage。

- [ ] 写交互测试：配置多个模型、手输自定义地址和模型、密钥遮罩、默认与临时选择分开、禁用模型不能启动、测试连接费用提示、无模型时开始按钮禁用。已有配置编辑留空密钥表示保留，删除或更换需明确动作。
- [ ] 运行 `npm test -- src/ai/ModelSettings.test.ts src/ai/AnalysisSetup.test.ts` 确认失败。
- [ ] 实现表单与错误提示，复用现有样式和对话框习惯；服务商预设只填地址，不硬编码未经确认的模型清单。浏览器预览使用模拟 client，不保存真实密钥。
- [ ] 重跑通过，并手动验证输入、焦点、键盘退出；提交 `feat: add model settings and analysis setup`。

## Task 9：单股抽屉与关键结论展开（阶段 E）

**Files:** 创建 `src/ai/StockAnalysisDrawer.vue`、`ReportView.vue`、`EvidenceDetails.vue`、`useAiAnalysis.ts` 与测试；修改 `TradingDesk.vue` 和右键菜单 items 生成逻辑，复用 `RowContextMenu.vue`。

**Interfaces:** `StockAnalysisDrawer` 接收 `security: SecurityRef`，发出 close；`ReportView` 接收 `detail: TaskDetail`、`summaryVersionId?: string`；`EvidenceDetails` 接收 snapshot 和关键结论 ID。`useAiAnalysis` 提供 `watchTask(taskId)`、`stopWatching()`，只停止轮询、不取消原生任务。

- [ ] 写 `right_click_uses_target_not_checked_rows`、`open_latest_does_not_call_model`、`close_does_not_cancel`、`peer_evidence_expands_per_claim`、`switch_stock_ignores_old_poll_response`；综合摘要置顶，各模型已完成时可先查看，引用链接经安全 URL 检查后打开。
- [ ] 运行 `npm test -- src/ai/StockAnalysisDrawer.test.ts src/ai/ReportView.test.ts src/ai/EvidenceDetails.test.ts` 确认失败。
- [ ] 实现右侧抽屉；与原证券详情抽屉互斥显示，但不取消后台分析。窗口可见且任务活跃时每秒 `ai_get_task`，完成后停止；旧请求用 generation 忽略，计时器卸载清理。Escape 关闭并恢复焦点，取消使用独立按钮；窄窗口内可滚动。
- [ ] 重跑通过，在现有桌面样式下验证综合结论、来源失败、模型失败和证据长文本；提交 `feat: present single-stock AI analysis in a drawer`。

## Task 10：历史回看、重新分析与重新汇总（阶段 E）

**Files:** 创建 `src/ai/HistoryList.vue` 与测试；修改 `repository.rs`、`runner.rs`、`StockAnalysisDrawer.vue`、`ReportView.vue`。

**Interfaces:** 历史查询沿用 `HistoryQuery`；重新汇总显式选择 inputReportIds，记录版本父子关系；替换已删除汇总配置仅影响新版本。删除任务返回影响范围（整批成员数量），确认后才执行已有 `ai_delete_task`。

- [ ] 写 `reanalysis_creates_new_snapshot`、`resummary_keeps_original_cutoff_and_reports`、`deleted_config_requires_replacement`、`history_survives_reopen`、`cache_cleanup_keeps_report_evidence`、`batch_child_visible_in_stock_history`；版本切换不能把新价和旧结论混排。
- [ ] 运行 Rust `ai::repository`、`ai::runner` 过滤测试与 `npm test -- src/ai/HistoryList.test.ts` 确认失败。
- [ ] 实现日期/状态筛选和游标分页、汇总版本选择、重试失败模型和显式删除。正在运行任务不允许删除，提示先取消；批量子报告由父任务管理，删除入口指明整批影响。清理仅针对未引用缓存。
- [ ] 重跑通过，用临时数据库验证重启恢复和旧版本读取；提交 `feat: add durable AI analysis history and summary versions`。

## Task 11：批量编排与分组总结（阶段 F）

**Files:** 修改 `ai/runner.rs`、`repository.rs`、`prompts.rs`、`reports.rs`；补充批量 fixture。

**Interfaces:** `start(StartRequest)` 处理多 securities，建立父任务及单股子任务；`prompts::group_summary(children: &[SummaryVersion], members: &[SecurityRef]) -> CompletionRequest`；`reports::validate_group_summary(raw: &str, children: &[SummaryVersion]) -> Result<GroupSummaryBody, ValidationError>`。分组证据地址采用 securityId/snapshotId/evidenceId 组合。

- [ ] 写 `group_members_frozen`、`one_stock_failure_does_not_block_peers`、`group_summary_uses_only_valid_child_versions`、`cross_stock_claim_rejected`、`zero_valid_children_skips_group_summary`、`changed_child_marks_group_version_stale`。断言 10 股 3 模型无重试实际发送 41 次，所有子任务共用全局并发上限。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml ai::runner` 和 `ai::reports` 确认失败。
- [ ] 建立有限队列，个股可先完成；最终分组汇总引用固定子报告版本，列出覆盖/缺失。取消父任务停止全部后续调用；子任务单独失败可重试，分组总结不会自动重写旧版本。
- [ ] 重跑通过；提交 `feat: orchestrate batch stock analysis and group synthesis`。

## Task 12：批量弹窗与范围交互（阶段 F）

**Files:** 创建 `src/ai/BatchAnalysisDialog.vue` 与测试；修改 `TradingDesk.vue`、`AnalysisSetup.vue`、`ai.css`，复用 `ReportView.vue`。

**Interfaces:** `BatchAnalysisDialog` 接收 group、members、checked，发出 close；默认 members 包含真实分组全体，checked 仅用户显式切换后使用。

- [ ] 写 `search_does_not_shrink_default_members`、`checked_scope_updates_calls`、`close_keeps_task_running`、`each_row_expands_peer_evidence`、`member_edit_does_not_change_running_batch`、`stale_group_summary_offers_one_call_refresh`。空分组/空勾选禁用开始；重复证券去重且预估一致。
- [ ] 运行 `npm test -- src/ai/BatchAnalysisDialog.test.ts src/ai/AnalysisSetup.test.ts` 确认失败。
- [ ] 实现宽弹窗、进度、分组总结、个股表格和行展开；临时汇总模型切换不改默认值。单只重试只作用于失败任务；重新汇总全部先显示 N+1 预估，再依次追加版本。
- [ ] 重跑通过，手动验证大量成员时滚动、长结论、键盘焦点和弹窗关闭；提交 `feat: present batch AI analysis in a modal`。

## Task 13：整体验收与交付说明（阶段 G）

**Files:** 创建 `docs/ai-analysis.md`、`docs/ai-analysis-acceptance.md`、`src/ai/AnalysisIntegration.test.ts`；修改 `README.md`。

**Interfaces:** 不增加新产品接口；验收记录关联设计第 12 节每项到具体测试命令、场景、结果和已知限制。

- [ ] 编写集成测试：2～3 模型、一个来源失败、一个模型失败、汇总格式错误、关闭重开、旧报告重新汇总及批量部分完成。先运行 `npm test -- src/ai/AnalysisIntegration.test.ts` 确认失败，再补齐接线并验证通过。
- [ ] 运行 `npm test`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 和新增/修改前端文件的 Prettier 检查，记录实际结果。既有未修改文件失败单独辨认，不将失败写成通过。
- [ ] 在 QA profile 的桌面环境做小规模真实来源与兼容模型检查；真实模型测试使用用户已提供且授权用于测试的配置，调用前显示预计次数，不从环境中搜索凭证。未配置密钥则记录真实模型联调未完成，模拟测试不能替代它。
- [ ] 验证 macOS 系统密钥库及 Windows 编译/凭证兼容；当前主机不能进行 Windows 实机验证时记录未验证范围，不宣称双平台实测通过。
- [ ] 更新使用说明：配置、调用数、免费来源限制、资料发送范围、报告存储、历史版本、取消和中断恢复；注明账号备份不包含 AI 报告，第一版没有跨设备恢复入口。
- [ ] 对照设计 11 条验收标准完成表格，确认现有行情刷新、账户存储、右键菜单和证券详情未回归；提交 `test: verify AI analysis v1 workflow and document limits`。

## 执行与审阅规则

每个实现任务采用失败测试 → 最小实现 → 对应测试通过 → 独立提交；提交前仅暂存本任务明确文件。任务 1 是读接口与来源验证，不人为编造失败测试。跨任务接口变化同步修改本文与契约 fixture，避免前后命名漂移。

阶段验收围绕已交付软件，不以预测涨跌是否猜中作为通过条件。关键功能失败则保留阶段未完成状态，不用模拟结果冒充来源或模型实测。完成阶段 G 后再决定发布与打包，实施计划本身不授权版本发布。

推荐由当前会话按顺序直接实施：资料、仓储、报告与界面的接口依赖密集，集中维护有利于减少契约反复；如用户选择子代理方式，再按对应技能执行。实施前用户先审阅计划并选择执行方式。

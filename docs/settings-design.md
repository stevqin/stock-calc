# 统一设置：界面规划与交付

日期：2026-10-13。用户授权设计、实施、打包并运行。

## 信息结构

顶部主导航将原来的「AI 设置」「费用设置」合并为「设置」。进入后使用左侧分类、右侧内容的固定布局，默认显示 AI 模型。设置页面隐藏账户摘要，让用户集中完成配置；业务页面仍显示摘要。

分类一「AI 模型」：服务连接与默认模型，提供模型列表、新增/编辑表单、连接测试、默认参与模型及默认汇总模型。分类二「费用设置」：股票与 ETF 独立费率，复用现有费率表单与账本保存逻辑。当前只有两类真实功能，不展示未实现的设置项；后续配置可按责任增加分类。

## 视觉系统

沿用证券工作台的冷灰与蓝色：背景 #F3F6FA、侧栏 #F7F9FC、内容卡片 #FFFFFF、边界 #E1E7F0、主色 #3268CF、正文 #31445F。标题使用系统字体的中等粗细，正文沿用 PingFang/SF 系统字体，数值及地址沿用工作台工具字体。

190px 分类侧栏与可滚动内容区分工明确；选中项以蓝色竖线和轻蓝底色表示，说明文字直接解释分类内容。模型列表与编辑表单并排，默认模型位于下方；窄于 1100px 时模型区改为单列。费用用两张并列卡片区分股票和 ETF。

## 交互与状态

分类切换通过 KeepAlive 保留表单草稿；保存费用继续发出原来的账户与修订事件，由主工作台同步。配置修改不替代历史成交费率。API Key 仍使用系统安全存储，浏览器预览不允许配置真实密钥。

侧栏按钮支持键盘焦点和当前分类状态；表单及错误提示沿用现有语义。实际浏览器检查发现自动高度容器中费用区继承 flex-basis:0 导致塌陷，已改为内容高度并由外层统一滚动。修复后费率表单实际可见，未仅依赖 DOM 测试判断。

## 验证与范围

新增回归覆盖：顶部只有统一设置入口、切换分类保留费率草稿、保存同步账本及费用保存失败提示。完整前端 449 项通过；Rust 56 项通过（6 项按原规则跳过）；Vue 类型检查和生产前端构建通过。

独立审查没有 Critical/Important 问题。保留一个后续优化项：缓存的费用面板在 AI 分类下仍保留原有计时器，属于后台开销，不影响本次配置与保存行为。

打包包含原工作区已有的行情工具栏 slot 调整，原文件未被覆盖。页脚版本改为读取 package.json，避免构建 0.6.0 却显示固定 0.4。版本号本轮不额外递增。

macOS 打包使用 Tauri app 构建与 ad-hoc 签名，再执行 codesign 和 DMG 校验。当前执行环境没有 npm，前端已用现有 Node/Vue/Vite 运行时单独构建；此次构建临时覆盖 beforeBuildCommand，未改变正式项目打包配置。

新闻/公告采集、AI 报告生成和分组分析仍属于原实施计划的后续阶段；此次运行版可先供用户输入并测试模型配置。

## 本轮打包与运行结果

- 应用：`src-tauri/target/release/bundle/macos/T刻.app`，版本 0.6.0。
- 安装包：`src-tauri/target/release/bundle/dmg/T刻_0.6.0_aarch64.dmg`。
- Release 构建完成，codesign --verify --deep --strict 通过，hdiutil verify 校验和有效。
- 正常退出旧实例后启动新构建，实际桌面界面显示统一「设置」入口，已打开 AI 模型新增表单，新增/保存按钮可用。
- 用户凭证由用户自行填写；未输入、读取或发送用户 API Key。

## MiMo compatibility and model versions (2026-10-13)

- Investigation: the saved configuration initially used `MIMO-TokenPlan` as the model ID. After changing it to `mimo-v2.6-pro`, the application returned “模型未返回可用文本”. No key was read into tool output. Configuration inspection queried only provider, base URL and model ID from the local database.
- Xiaomi official docs: https://mimo.mi.com/docs/en-US/api/chat/openai-api and https://mimo.mi.com/docs/en-US/api/model/list-models. The Chat Completions API supports Bearer authentication, uses `max_completion_tokens`, and enables thinking by default. The former 16-token connection test could exhaust output during thinking.
- MiMo gateway adapts output limits by provider or exact official API/Token Plan host, preserving legacy custom configurations. Connection tests use 64 tokens and disable MiMo thinking; independent analysis keeps the default thinking behavior.
- Settings adds Xiaomi MiMo provider, text-model version presets, custom model ID input, and a native `GET /models` action using saved credentials. Credentials never cross back into the webview. Unsaved address/provider/key changes disable list retrieval until saved; changing these settings clears fetched versions. Unsupported lists retain manual entry. Presets do not imply account entitlement.
- Model listing shares endpoint validation, origin concurrency scheduling, no-redirect client and 120-second timeout, caps JSON at 2MB and validates at most 10,000 IDs. HTTP error messages expose only status and safe guidance, not server response bodies.
- Subscription names are rejected in the MiMo editor. Switching to the MiMo provider preserves an existing official Token Plan address. Existing keys and defaults are retained unless the user explicitly changes them.
- Verification: 452 frontend tests passed, 60 Rust tests passed (6 existing/manual tests ignored), TypeScript typecheck and production build passed. New tests cover MiMo wire parameters, thought behavior, exact-host legacy detection, model-list parsing and redirects, saved-credential boundaries, and selecting/customizing model versions.
- Native acceptance: rebuilt and signed macOS app launched. The live settings view showed `XiaoMi-MIMO连接成功 · 实际调用 1 次` with the existing `mimo-v2.6-pro` / Token Plan configuration. The user performed the native test while taking over the UI; no additional test was sent by the agent and no saved configuration or key was changed. New DMG passed signature/checksum verification.

## Corrected release baseline (2026-10-13)

The original AI worktree was incorrectly forked from local main based on v0.6.0 (`12eedf2`), which had not incorporated the released v0.8.0 commit `a8b04c2` from `panel-refresh-fix` / origin/main. This produced an AI package missing recent trading, chart, status-bar, reconciliation and PnL calendar features. All source changes and user database data remained intact.

Merged the complete `a8b04c2` history into this AI worktree. Conflict resolution retains unified Settings but uses the v0.8.0 QuoteDetails / chart-tabs layout. The status bar, LedgerWorkbench, PnlAnalysis, StatusPanel, QuoteDetails, tradeStages, workspace.css and analysis.css are byte-identical to v0.8.0. The original checkout and the release worktree remain untouched. Combined regression: 483 frontend tests passed; Rust suite and typecheck passed. Future packages use this merged baseline.

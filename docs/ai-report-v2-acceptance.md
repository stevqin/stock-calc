# AI 报告 V2 · 0.9.0 验收

2026-10-14，Asia/Shanghai。

- 五类建议、资金/持仓同一截止、本轮交易与T+1约束、旧报告兼容、删除/回收站/恢复/永久删除已接入。
- `npm test`：51个测试文件，508项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：85项通过，7项明确忽略的实网/系统凭证测试。
- TypeScript检查、Vite构建、Rust格式、修改前端文件Prettier及git diff检查通过。
- 真实Vue组件使用虚构资料与模拟IPC完成浏览器验收：五模块、冻结资金、删除唯一报告、同抽屉恢复、Esc和390px窄屏通过；未调用模型。
- 独立审查发现的可卖0仍允许卖出/做T、零余额允许买入、恢复唯一报告无入口、不同原文交叉升级action/actionable均已补回归修复。
- `npm run package:mac`：0.9.0 app与DMG生成；本地签名校验及DMG校验通过，未进行Apple公证。
- 旧进程正常退出，新进程启动，Info.plist版本核对为0.9.0，运行数据库回收站迁移schema3初始化成功。
- 切换前后账户、模型配置、独立报告与汇总原文payload哈希完全一致；没有新增AI任务或模型调用。

本轮未执行真实模型联调。需要重新分析才能用新的五类协议和账户资金快照，旧报告不能通过改标题获得新依据。当前中长期缺少已核验基本面时明确资料不足。Windows实机未验证。

安装包：`src-tauri/target/release/bundle/dmg/T刻_0.9.0_aarch64.dmg`。

# 0.9.9：JSON格式与枚举诊断修复

本次保存样本的首次输出是合法JSON，但operations.today.status填写review；review只允许用于action，原校验未给字段路径。一次模型修复解决了枚举，却在对象末尾多了一个结束括号，导致最终只显示无效JSON。

MiMo请求带工具时也明确发送response_format=json_object，覆盖模型未选择工具而直接返回正文的路径。MiMo工具选择只支持auto，不能假设工具schema一定强制执行。官方JSON模式保证语法，不保证业务字段枚举。工具与JSON组合仅做本地模拟HTTP验证，本次未调用真实模型。

枚举错误显示具体字段、实际值与允许值；提示中明确review只属于action，复盘状态应为wait。未将非法状态自动映射为合法值，缺字段、无效引用和订单限制继续校验。

解析器只接受完整对象后恰好多一个结束括号的确定性语法归一化，记录formatWarnings并保留原始输出，不改正文、价格、股数；多对象、尾随说明、截断和其他不明确语法错误仍拒绝。独立与汇总共用解析器，其他语法错误说明行号与列号。

本机保存的本次修复输出已离线重新校验通过；此前多步骤/股数违规样本继续通过离线回放。私人样本不写入仓库，用户数据库未重写。

官方依据：
- https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output
- https://mimo.mi.com/docs/en-US/api/chat

验证结果：523项前端、126项Rust测试通过，14项显式忽略；本次JSON失败样本与此前违规分支样本分别执行只读离线回放通过。类型检查、生产构建和格式检查通过。

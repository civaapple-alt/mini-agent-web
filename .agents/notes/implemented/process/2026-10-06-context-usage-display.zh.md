# 上下文用量与命中率显示

状态：implemented；日期：2026-10-06；范围：Web Studio 输入栏与运行详情

## 决策

上下文详情默认收起。展开后，窗口占用率始终按最近一次模型请求显示；缓存命中率明确标出是最近请求还是本会话累计。两个数值不再根据可用数据在同一位置切换含义。命中率显示到小数点后两位。

输入 token 与缓存 token 使用 Provider 实际报告值。上下文来源条显示的是按序列化字节占比拆分的估算值，并在 UI 中标记为估算。来源明细默认收起。窗口占用率使用该请求模型快照中的完整窗口；缺少模型窗口时显示未知。

模型请求的 TTFT 和总响应时间放在对应用户输入下，避免用户在回答末端和较早问题之间来回寻找指标。

## 边界

App Server 持有模型快照和 Provider 用量；Web Studio 只解释并展示。来源字节估算不会被当作 Provider token 用量，也不影响 Harness 压缩决策。上下文水位规则见 Harness 已实现记录：[上下文字节硬限制与模型快照](https://github.com/civaapple-alt/mini-agent-harness/blob/main/.agents/notes/implemented/architecture/2026-10-05-context-waterline-safety-and-model-snapshot.zh.md)。

## 验证证据

- `ContextUsageControl.test.jsx`、`context_usage.test.js` 覆盖固定标签、未知值、小数位、来源估算及超窗值。
- 使用说明位于 `docs/session-context.md`；实现提交为 `3b9f84d`。本文补录没有重跑前端测试。

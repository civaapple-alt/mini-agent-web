# Responses 供应商预设与地址纠正

状态：implemented；日期：2026-10-06；范围：Web Studio 模型设置与 Harness Host

## 决策

供应商预设按产品和协议选择地址。Kimi API 与 Kimi Code 使用不同 Base URL；Kimi Code 地址匹配 Coding API 后建议 `k3-256k`。GLM Coding Plan 的 Responses 地址使用 `https://open.bigmodel.cn/api/v1`。保存的 `/api/paas/v4` 或 `/api/coding/paas/v4` 地址属于 Chat Completions，Web Studio 显示说明并提供一键切换。

GLM 5.3 与 Flash 建议把推理等级映射到 Responses 的 `reasoning.effort`，不再生成 Chat Completions 的 `thinking` 和 `reasoning_effort` 字段。保存旧模型时，用户可以按模型 ID 重新运行“智能匹配”以更新参数。

## 验证证据

- `ModelSettingsPanel.test.jsx` 覆盖 Kimi Code、GLM Responses 地址、旧地址修正和模型参数映射。
- 供应商使用说明位于 `docs/models.md`；Host 连接探测约束见 Harness `docs/configuration.md`。
- 实现提交：`1965d32`、`0e3bbd6`。测试使用 mock；本记录未验证真实供应商账号或发起请求。

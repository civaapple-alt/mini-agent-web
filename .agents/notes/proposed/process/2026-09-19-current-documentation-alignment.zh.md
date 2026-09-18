# 当前文档与运行时对齐

- status: proposed
- date: 2026-09-19

## 决策

Web 仓库只记录 SDK、Gateway 和 Web Studio 已实现的适配层行为。Thread、Turn、
Session、approval、operation 与恢复语义由 Mini Agent App Server 定义。稳定文档
不复制旧实现过程，也不把 Gateway 的投影描述成另一份运行时权威。

本批次以 SDK client、Gateway routes/session catalog、Studio API 模块以及 App
Server 的公开协议为事实来源。无法由这些来源确认的数字或安全保证不再保留在稳定
文档中。

## 已观察的问题

| ID | 观察 | 证据 | 影响 |
| --- | --- | --- | --- |
| WEB-DOC-01 | `docs/limits.md` 把 App Server 运行时限制与 Web 客户端限制混写。 | `server/routes/agent_models.py`、SDK client、frontend attachment utilities。 | 读者无法知道限制由哪一层实施。 |
| WEB-DOC-02 | `docs/privacy.md` 把所有工具调用描述为必须前端审批。 | App Server approval policy 与 Gateway 仅转发 pending approval 的实现。 | 与 `automatic`、`trusted` 和 Host 权威冲突。 |
| WEB-DOC-03 | 长任务能力的说明分散在根 README、目录 README 和历史 notes。 | child/notebook/background/scheduled routes 和 Studio API。 | 产品定位与实际控制面链路不易核对。 |

## 验收

- Limits 区分 SDK/网关/Studio 的本地边界与 App Server 的运行时边界。
- Privacy 不承诺 Gateway 或 Studio 不拥有的审批行为。
- 文档链接和命令能在两个仓库的当前目录结构中解析。

## 非目标

- 不改变 App Server 协议、Gateway API、前端行为或本地数据格式。

## Worktree 验证

- Web 文档已将 SDK/Gateway/Studio 的本地限制与 App Server runtime 限制分开，
  并修正 Gateway 默认 bind host、`/health` 路径、DeepSeek Responses 根 URL、
  trusted Shell 行为和 SDK 默认日志行为。
- SDK 长指南现在只描述当前 `MiniAgentClient` 方法与 App Server 所有权；旧的
  框架图、过时日志承诺和不稳定示例已移除。
- 验证命令：`uv run pytest tests/sdk/test_sdk_apis.py tests/sdk/test_sdk_events.py -q`、
  `uv run pytest tests/gateway/test_gateway_api.py tests/gateway/test_session_manager.py -q`、
  `uv run python cookbook/python-demo/06_protocol_compatibility.py`，以及
  `python ../mini-codex/scripts/check_docs_links.py README.md docs server frontend sdk tui cookbook tests`。

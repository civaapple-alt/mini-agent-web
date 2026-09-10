# Web Studio 多项目多会话并发与实时流切换

## Status

Implemented

## Date

2026-09-10

## Result

Web Studio 现支持同一项目或多个项目下的不同会话并发运行。项目切换只更新当前
查看和路由上下文，不会停止其他项目的 Client、Turn 或流任务；同一
`project_id` + `thread_id` 仍由 Gateway 保持单 active Turn 约束。

切换会话时，Studio 按 snapshot → bounded event replay → live WebSocket 的顺序
恢复当前会话视图。事件游标只在当前会话 reducer 实际应用事件后推进，切换期间的
实时事件会有界缓存，回放缺口会回退到 canonical history 并提示用户。侧栏通过
catalog 轮询和生命周期事件刷新多个会话的状态与项目活跃数。

由其他进程持有锁的会话以只读模式打开，禁止发送、纠偏、打断和审批响应。成功
结算、失败、中断、步数上限、暂停和可恢复状态在侧栏中分别投影。

项目级访问范围和审批策略更新会并行 fan-out 到该项目的所有空闲 Client；active
Turn 存在时拒绝变更。审批请求补齐 Project/Thread/Turn 身份，前端切换回等待中的
会话时通过审批快照恢复卡片，并使用原请求身份提交响应。

## Implementation

- `SessionManager` 的客户端解析、运行时重启、审批撤销和兼容指针均按项目隔离。
- 项目切换路由改为 `start()` 目标项目，不再调用全局 restart。
- WebSocket turn submission 补齐 `threadId`；前端按项目/会话键处理、回放和缓存事件。
- 前端恢复活跃 Turn、只读锁定会话、状态轮询和完成/中断标签。
- 审批快照按项目/会话过滤，审批响应增加 Thread/Turn 身份校验。
- 增加 Gateway、前端状态和 UI 测试，并同步 troubleshooting 与 changelog。

## Verification

已通过：

```text
uv run pytest -q
uv run ruff check .
npm --prefix frontend run lint
npm --prefix frontend run test:unit
npm --prefix frontend run test:ui
npm --prefix frontend run build
git diff --check
```

Python 测试会产生两个 Windows Proactor 子进程清理警告，但没有失败。

## Boundaries

首版仍是单窗口单面板查看；同一会话不支持并行 Turn；外部 Gateway/进程只提供
有界快照和最终状态，不承诺跨进程实时流；不修改 App Server JSON-RPC 协议。

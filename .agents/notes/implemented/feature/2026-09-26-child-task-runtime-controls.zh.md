# 运行面板的子任务接管与共享控制

- status: implemented
- date: 2026-09-26

## 决策

运行面板和父代理的 `task_control` 共用 Gateway 控制服务。App Server 持久化的 Child operation 是状态依据；Gateway 执行控制和调度；WebStudio 从服务端投影刷新状态，不维护第二份任务账本。

每次控制请求绑定父子 Thread、`operation_id`、当前 `attempt` 和稳定 request ID。Gateway 在执行前验证 operation 和 attempt。服务端拒绝过期请求、启动失败和满额的后续指令时，面板保留权威状态并显示原因。重放稳定 request ID 会返回原控制结果。

面板根据任务状态提供操作：

| 状态 | 用户操作 | 状态反馈 |
| --- | --- | --- |
| 运行中 | 停止、暂停、steer、排队一条后续指令 | 停止和暂停在 Turn 结算前显示处理中 |
| 排队中 | 修改提示词、停止 | 刷新后读取持久 operation 状态 |
| 暂停中 | 等待结算 | 保留并发槽位并显示处理中 |
| 已暂停 | 继续、停止 | 继续复用原 Session、operation 和 attempt |
| 失败或取消 | 在同一 Session 重试 | 重试递增 attempt |

一个 operation 最多保存一条待执行后续指令。当前 attempt 成功后，Gateway 启动后续 Turn；当前 attempt 失败时，指令保持受阻，直至重试成功或用户取消。停止当前任务会同时取消待执行指令。

暂停和停止通过协作式中断当前 Turn。只有 App Server 确认 Turn 结算后，operation 才变为已暂停或已取消，Gateway 才释放并发槽位。Gateway 重启后根据持久 operation 与 Turn 状态恢复处理中控制和队列调度。

## 接口与文档

- `POST /api/threads/{thread_id}/children/{child_thread_id}/control`
- 当前行为规范：[代理子任务](../../../../docs/child-tasks.md)
- App Server 持久协议见 `mini-agent-harness/docs/app-server.md`。

## 验证

- `uv run pytest tests/gateway/test_session_manager.py tests/gateway/test_gateway_api.py tests/sdk/test_sdk_apis.py -q`：149 项通过。
- 使用 Harness App Server 构建运行 `tests/smoke/test_child_agent_report_scenario.py`：2 项通过，没有调用付费模型。
- `npm test`：74 项 Node 测试和 128 项 Vitest 测试通过。
- `npm run lint`、受影响 Python 文件的 Ruff 检查和 `npm run build` 通过。Vite 报告主 JS chunk 为 708.10 KB，超过 500 KB 提示线。

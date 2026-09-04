# 模块化测试体系重构与 FastAPI Gateway 质量保障深度演进

- **日期**：2026-09-04
- **状态**：已落地实施 (Implemented)
- **作者**：Mini Agent Architecture & Quality Team
- **范围**：`tests/` 目录组织重构、`server/` (FastAPI Gateway) 深度测试用例补齐、E2E Smoke 测试归口

---

## 1. 背景与问题诊断

### 1.1 `tests/` 目录组织扁平，职责混杂
重构前 `mini-agent-web/tests/` 下存在 8 个平铺的 Python 测试文件：
- `test_sdk_apis.py`、`test_sdk_events.py`（属于 `sdk/python` 核心协议）；
- `test_gateway_api.py`、`test_session_manager.py`、`test_world_security.py`（属于 `server/` 网关）；
- `test_tui_rendering.py`、`test_tui_commands_expanded.py`（属于 `tui/` 实验性客户端）；
- `test_cookbook_validation.py`（属于 `cookbook/` 示例程序验证）；
- 另有独立的 `scripts/full_stack_smoke_test.py` 承担全栈带凭据冒烟测试，但未形成统一的分层测试规范。

**存在的问题**：
1. **模块归属不清**：开发者修改 `server/` 或 `sdk/` 时，无法通过目录级命令（如 `pytest tests/gateway`）进行模块化聚焦测试；
2. **测试层级缺失**：未明确划分单元测试（Unit）、网关集成测试（Gateway Integration）、端到端契约测试（E2E / Smoke）；
3. **随着功能演进，平铺文件将继续恶化**：如果不建立清晰的模块子目录，后续补充的测试将使根目录杂乱膨胀。

---

### 1.2 FastAPI Gateway (`server/`) 深度代码审计与严重盲区复盘

虽然原有网关测试对健康检查、会话创建、线程重命名、路径防穿越等基础功能有覆盖，但经过对 `server/` 的全量代码审计，**核心 Agent 交互与工作流控制面存在大范围零覆盖盲区**（网关整体覆盖率不足）：

#### 盲区 A：核心 Agent 交互端点完全未测（`server/routes/agent.py`）
1. **同步 REST 轮次执行 (`POST /api/agent/turn`)**：直接向网关发送 Prompt 等待终态结果的同步接口未做测试；
2. **SSE 流式传输 (`GET/POST /api/agent/stream`)**：Server-Sent Events 协议解析、增量分块推流、以及与 WebSocket 的同步广播未做测试；
3. **交互式纠偏 (`POST /api/agent/steer`)**：执行中的动态纠偏下发及 actionId 回复未做断言；
4. **任务主动中断 (`POST /api/agent/interrupt`)**：用户主动取消任务时的内部状态流转与响应未测试；
5. **剪贴板图片附件处理 (`_process_attachments`)**：Web 端粘帖图片（Base64 转码、落盘到 `.mini-agent/attachments`、Prompt 上下文注入）的核心逻辑未被任何测试调用；
6. **HTTP 授权响应端点 (`POST /api/approval/respond`)**：暴露给外部客户端的 HTTP 路由层参数反序列化与 404/400 校验未测试。

#### 盲区 B：Thread 与 Goal 控制面端点缺失（`server/routes/threads.py` & `world.py`）
1. **ThreadItems 增量恢复 (`GET /api/threads/{thread_id}/items`)**：**Web Studio 恢复历史卡片、游标分页的核心 API**，网关路由层此前无覆盖；
2. **Goal HTTP 全套生命周期**：
   - `POST /api/threads/{thread_id}/goal`（创建/更新 Goal）
   - `GET /api/threads/{thread_id}/goal`（查询 Goal）
   - `POST /api/threads/{thread_id}/goal/pause`（暂停 Goal）
   - `POST /api/threads/{thread_id}/goal/resume`（恢复 Goal）
   - `DELETE /api/threads/{thread_id}/goal`（清除 Goal）
   网关对外暴露的这 5 个 HTTP 路由与状态映射完全未被测试；
3. **Session 外部锁探测与 Attach (`POST /api/threads/{thread_id}/attach`)**：多进程锁冲突、只读会话探测及 re-attach 的行为未在测试中覆盖。

#### 盲区 C：MCP 与环境治理端点缺失（`server/routes/world.py`）
1. **MCP 服务探测与重试**：`GET /api/mcp/status` 与 `POST /api/mcp/retry` 未测试；
2. **权限撤销**：`POST /api/world/approval/revoke` 未测试。

---

## 2. 目标与设计原则

1. **模块对齐原则（Domain-Aligned）**：测试目录与工程源码业务域严格对齐（`sdk/` -> `tests/sdk/`，`server/` -> `tests/gateway/` 以彻底杜绝与顶级包名冲突，`tui/` -> `tests/tui/`，`cookbook/` -> `tests/cookbook/`）；
2. **无缝兼容已有命令**：保持 `pyproject.toml` 中的 `testpaths = ["tests"]` 配置，`uv run pytest -q` 一键运行全量测试，无需改变 CI 或日常提交习惯；
3. **按需精准测试能力**：支持单模块毫秒级验证，如 `uv run pytest tests/gateway -q`；
4. **零 Token 消耗与强环境隔离**：日常单元与集成测试严禁调用付费模型，利用隔离 Fixtures 保证测试状态与真实开发环境完全隔离；
5. **真实全链路冒烟规范化**：建立两级冒烟测试规范（Tier 1 离线自动化冒烟 + Tier 2 真实模型全栈验收）。

---

## 3. 落地测试目录架构

```text
tests/
├── conftest.py                             # 全局合成目录隔离与锁清理 Fixtures
├── README.md                               # 测试目录导航与分层执行说明
│
├── sdk/                                    # 【模块 1：Python SDK】
│   ├── test_sdk_apis.py                    # SDK JSON-RPC 方法构造与参数序列化
│   └── test_sdk_events.py                  # 事件流解析、未知事件降级、ThreadItem 投影
│
├── gateway/                                # 【模块 2：FastAPI Gateway】
│   ├── test_gateway_api.py                 # 基础路由：健康检查、线程 CRUD、系统设置
│   ├── test_gateway_agent.py               # 核心交互：turn / SSE stream / steer / interrupt / 附件 / 授权
│   ├── test_gateway_goals_and_items.py     # 控制面：ThreadItems 游标分页、Goal 完整状态机、Attach 锁探测
│   ├── test_session_manager.py             # 会话管理：单例状态、授权缓存、多进程锁
│   └── test_world_security.py              # 安全治理：路径防穿越、工作区树扫描、项目 CRUD
│
├── tui/                                    # 【模块 3：实验性 TUI】
│   ├── test_tui_rendering.py               # 终端流式输出、ANSI 高亮、ThreadItem 折叠
│   └── test_tui_commands_expanded.py       # TUI 斜杠命令解析与补全逻辑
│
├── cookbook/                               # 【模块 4：Cookbook 脚本验证】
│   └── test_cookbook_validation.py         # Cookbook 示例语法编译与离线协议兼容性
│
└── smoke/                                  # 【模块 5：全栈集成与冒烟测试】
    ├── README.md                           # 冒烟测试规范与两级执行指南
    └── test_smoke_offline.py               # [新增] Tier 1 离线端到端链路自动化冒烟
```

---

## 4. Gateway 补齐用例规范

### 4.1 `tests/gateway/test_gateway_agent.py`
聚焦 `server/routes/agent.py` 的关键 Agent 交互：
1. **同步执行测试 (`test_agent_turn_execution_success_and_error`)**：
   - 验证 `POST /api/agent/turn` 正常轮次流转并返回 `turn_id`、`final_text`、`steps`；
   - 验证并发冲突状态 (`status="busy"`)；
   - 验证 `AppServerError` 异常映射为 HTTP 400。
2. **SSE 流式传输测试 (`test_agent_stream_sse_endpoint`)**：
   - 使用异步客户端调用 `GET /api/agent/stream?prompt=Hello`；
   - 断言返回响应头 `Content-Type: text/event-stream`；
   - 断言分块推流符合 SSE `data: {...}\n\n` 规范。
3. **纠偏与中断端点测试 (`test_agent_steer_and_interrupt_endpoints`)**：
   - 测试 `POST /api/agent/steer` 成功下发并返回 `status: steered` 与 `action_id`；
   - 测试 `POST /api/agent/interrupt` 成功请求中断返回 `status: interrupted`。
4. **剪贴板附件与图片处理 (`test_process_attachments_pipeline`)**：
   - 传入 Base64 PNG 图片；
   - 验证文件被正确解码落盘至当前项目的 `.mini-agent/attachments/`；
   - 验证 Prompt 末尾自动追加了 `[User Attached Image: ...]` 与 `[User Referenced Files: ...]` 上下文提示。
5. **授权审批 HTTP 端点 (`test_approval_respond_http_endpoint`)**：
   - 验证 `POST /api/approval/respond` 在存在待决授权时的 `status: resolved` 返回；
   - 验证非法/已关闭的 `request_id` 触发 HTTP 404。
6. **WebSocket 交互动作测试 (`test_gateway_websocket_steer_interrupt_actions`)**：
   - 验证 WebSocket 收到 `steer` 与 `interrupt` 动作时分别返回 `steer_ack` 与 `interrupt_ack`；
   - 验证无活跃轮次时返回友好错误提示。

### 4.2 `tests/gateway/test_gateway_goals_and_items.py`
聚焦 `server/routes/threads.py` 与 `server/routes/world.py` 中的关键控制面：
1. **ThreadItems 游标分页 (`test_thread_items_pagination_endpoint`)**：
   - 测试 `GET /api/threads/{id}/items?limit=1` 返回首页及 `next_cursor`；
   - 使用 `cursor` 参数拉取下一页，验证分页数据无缝拼接与 `backwards_cursor`。
2. **Goal 全生命周期状态机 (`test_goal_http_full_lifecycle`)**：
   - `POST /api/threads/{id}/goal` 设置目标 `objective="重构测试体系"`, `token_budget=10000`；
   - `GET /api/threads/{id}/goal` 验证目标正确读取；
   - `POST /api/threads/{id}/goal/pause` 验证目标暂停；
   - `POST /api/threads/{id}/goal/resume` 验证目标恢复；
   - `DELETE /api/threads/{id}/goal` 验证目标清理完成。
3. **Session 外部锁探测与 Attach (`test_thread_attach_locked_and_resumable`)**：
   - 模拟包含 `session.lock` 且对应外部活跃进程的 Session；
   - 测试 `POST /api/threads/{id}/attach` 正确返回 `attached: false` 与 `locked_by` 元数据，不强行占有；
   - 模拟无锁的历史 Session，测试返回 `attached: true`。
4. **会话关闭端点 (`test_thread_close_endpoint`)**：
   - 验证 `POST /api/threads/{thread_id}/close` 正确关闭活跃会话连接。
5. **MCP 状态/重试与权限撤销 (`test_mcp_and_approval_revoke_endpoints`)**：
   - 验证 `GET /api/mcp/status` 与 `POST /api/mcp/retry`；
   - 验证 `POST /api/world/approval/revoke`。

### 4.3 `tests/smoke/test_smoke_offline.py`
1. **HTTP 健康与状态探测 (`test_smoke_offline_http_and_status`)**：
   - 校验 `/health`、`/api/world/state`、`/api/threads` 路由联通性。
2. **全双工 WebSocket 流式生命周期 (`test_smoke_offline_full_duplex_turn_streaming`)**：
   - 校验 `/ws/agent` 连接握手、ping/pong；
   - 校验从 `_turn_submission` -> `turn_started` -> `content_delta` -> `turn_finished` 的事件流与状态清理。
3. **交互控制与历史投影 (`test_smoke_offline_interactive_control_and_items`)**：
   - 校验 ThreadItems 投影读取；
   - 校验 WebSocket 动态纠偏 (steer) 与中断 (interrupt)。

---

## 5. 实施落地结果与验证结论

1. **测试用例大幅扩充**：
   - 测试用例总数由重构前的 **48 项** 提升至 **62 项**（净增 **+14 项**，增幅 **+29.2%**）；
   - 网关层测试由原来的 15 项扩充至 26 项，覆盖率显著跃升；
   - 新增 3 项端到端 Tier 1 离线集成冒烟测试。
2. **多维质量保障验证**：
   - `uv run pytest -q`：62 passed in 1.91s（全绿通过）；
   - 各模块按需测试（`tests/sdk` 15 passed, `tests/gateway` 26 passed, `tests/tui` 11 passed, `tests/cookbook` 7 passed, `tests/smoke` 3 passed）全部独立通过；
   - `uv run ruff check .` 与 `uv run ruff format --check .`：全部检查通过，0 警告，代码格式完全规范；
   - 前端代码检查与测试：`npm --prefix frontend run lint`（0 error）、`npm --prefix frontend test`（12 passed, 5 passed in vitest）、`npm --prefix frontend run build`（打包成功）；
   - Python 包打包发布：`uv build --package mini-agent` 成功生成 wheel 与 sdist。

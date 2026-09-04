# 模块化测试体系重构与 FastAPI Gateway 质量保障深度演进提案

- **日期**：2026-09-04
- **状态**：评审中 (Proposed)
- **作者**：Mini Agent Architecture & Quality Team
- **范围**：`tests/` 目录组织重构、`server/` (FastAPI Gateway) 深度测试用例补齐、E2E Smoke 测试归口

---

## 1. 背景与问题诊断

### 1.1 `tests/` 目录组织扁平，职责混杂
当前 `mini-agent-web/tests/` 下存在 8 个平铺的 Python 测试文件：
- `test_sdk_apis.py`、`test_sdk_events.py`（属于 `sdk/python` 核心协议）；
- `test_gateway_api.py`、`test_session_manager.py`、`test_world_security.py`（属于 `server/` 网关）；
- `test_tui_rendering.py`、`test_tui_commands_expanded.py`（属于 `tui/` 实验性客户端）；
- `test_cookbook_validation.py`（属于 `cookbook/` 示例程序验证）；
- 另有独立的 `scripts/full_stack_smoke_test.py` 承担全栈带凭据冒烟测试，但未形成统一的分层测试规范。

**存在的问题**：
1. **模块归属不清**：开发者修改 `server/` 或 `sdk/` 时，无法通过目录级命令（如 `pytest tests/server`）进行模块化聚焦测试；
2. **测试层级缺失**：未明确划分单元测试（Unit）、网关集成测试（Gateway Integration）、端到端契约测试（E2E / Smoke）；
3. **随着功能演进，平铺文件将继续恶化**：如果不建立清晰的模块子目录，后续补充的测试将使根目录杂乱膨胀。

---

### 1.2 FastAPI Gateway (`server/`) 深度代码审计与严重盲区复盘

虽然现有网关测试对健康检查、会话创建、线程重命名、路径防穿越等基础功能有覆盖，但经过对 `server/` 的全量代码审计，**核心 Agent 交互与工作流控制面存在大范围零覆盖盲区**（网关整体预估覆盖率仅约 50% ~ 60%）：

#### 盲区 A：核心 Agent 交互端点完全未测（`server/routes/agent.py`）
1. **同步 REST 轮次执行 (`POST /api/agent/turn`)**：**零测试**。直接向网关发送 Prompt 等待终态结果的同步接口未做任何测试；
2. **SSE 流式传输 (`GET/POST /api/agent/stream`)**：**零测试**。Server-Sent Events 协议解析、增量分块推流、以及与 WebSocket 的同步广播未做测试；
3. **交互式纠偏 (`POST /api/agent/steer`)**：**零测试**。执行中的动态纠偏下发及 actionId 回复未做断言；
4. **任务主动中断 (`POST /api/agent/interrupt`)**：**零测试**。用户主动取消任务时的内部状态流转与响应未测试；
5. **剪贴板图片附件处理 (`_process_attachments`)**：**零测试**。Web 端粘帖图片（Base64 转码、落盘到 `.mini-agent/attachments`、Prompt 上下文注入）的核心逻辑未被任何测试调用；
6. **HTTP 授权响应端点 (`POST /api/approval/respond`)**：**零测试**。虽然底层的 `SessionManager` 逻辑测过，但暴露给外部客户端的 HTTP 路由层参数反序列化与 404/400 校验未测试。

#### 盲区 B：Thread 与 Goal 控制面端点缺失（`server/routes/threads.py` & `world.py`）
1. **ThreadItems 增量恢复 (`GET /api/threads/{thread_id}/items`)**：**零测试**。**Web Studio 恢复历史卡片、游标分页的核心 API**，网关路由层完全没有测试覆盖；
2. **Goal HTTP 全套生命周期**：**零测试**。
   - `POST /api/threads/{thread_id}/goal`（创建/更新 Goal）
   - `GET /api/threads/{thread_id}/goal`（查询 Goal）
   - `POST /api/threads/{thread_id}/goal/pause`（暂停 Goal）
   - `POST /api/threads/{thread_id}/goal/resume`（恢复 Goal）
   - `DELETE /api/threads/{thread_id}/goal`（清除 Goal）
   SDK 虽测了底层 RPC，但网关对外暴露的这 5 个 HTTP 路由与状态映射完全未被测试；
3. **Session 外部锁探测与 Attach (`POST /api/threads/{thread_id}/attach`)**：**零测试**。多进程锁冲突、只读会话探测及 re-attach 的行为未在测试中覆盖。

#### 盲区 C：MCP 与环境治理端点缺失（`server/routes/world.py`）
1. **MCP 服务探测与重试**：`GET /api/mcp/status` 与 `POST /api/mcp/retry` 未测试；
2. **权限撤销**：`POST /api/world/approval/revoke` 未测试。

---

## 2. 目标与设计原则

1. **模块对齐原则（Domain-Aligned）**：测试目录与工程源码目录严格 1:1 对齐（`sdk/` -> `tests/sdk/`，`server/` -> `tests/server/`，`tui/` -> `tests/tui/`，`cookbook/` -> `tests/cookbook/`）；
2. **无缝兼容已有命令**：保持 `pyproject.toml` 中的 `testpaths = ["tests"]` 配置，`uv run pytest -q` 一键运行全量测试，无需改变 CI 或日常提交习惯；
3. **按需精准测试能力**：支持单模块毫秒级验证，如 `uv run pytest tests/server -q`；
4. **零 Token 消耗与强环境隔离**：日常单元与集成测试严禁调用付费模型，利用 `tests/conftest.py` 保证测试状态与真实开发环境完全隔离；
5. **真实全链路冒烟规范化**：将全栈冒烟测试（如 `full_stack_smoke_test.py`）建立规范化索引，作为生产发布前的二阶段可选验收手段。

---

## 3. 目标测试目录架构

```text
tests/
├── conftest.py                          # 全局合成目录隔离与锁清理 Fixtures
├── README.md                            # 测试目录导航与分层执行说明
│
├── sdk/                                 # 【模块 1：Python SDK】
│   ├── __init__.py
│   ├── test_sdk_apis.py                 # SDK JSON-RPC 方法构造与参数序列化
│   └── test_sdk_events.py               # 事件流解析、未知事件降级、ThreadItem 投影
│
├── server/                              # 【模块 2：FastAPI Gateway】
│   ├── __init__.py
│   ├── test_gateway_api.py              # 基础路由：健康检查、线程 CRUD、系统设置
│   ├── test_gateway_agent.py            # [新增] 核心交互：turn / SSE stream / steer / interrupt / 附件
│   ├── test_gateway_goals_and_items.py  # [新增] 控制面：ThreadItems 游标分页、Goal 完整状态机、Attach 探测
│   ├── test_session_manager.py          # 会话管理：单例状态、授权缓存、多进程锁
│   └── test_world_security.py           # 安全治理：路径防穿越、工作区树扫描、项目 CRUD
│
├── tui/                                 # 【模块 3：实验性 TUI】
│   ├── __init__.py
│   ├── test_tui_rendering.py            # 终端流式输出、ANSI 高亮、ThreadItem 折叠
│   └── test_tui_commands_expanded.py    # TUI 斜杠命令解析与补全逻辑
│
├── cookbook/                            # 【模块 4：Cookbook 脚本验证】
│   ├── __init__.py
│   └── test_cookbook_validation.py      # Cookbook 示例语法编译与离线协议兼容性
│
└── smoke/                               # 【模块 5：全栈集成与冒烟测试】
    ├── README.md                        # 冒烟测试运行与凭据配置指南
    └── test_smoke_cli.py                # 冒烟测试入口与自动化报告验证
```

---

## 4. Gateway 详细补齐用例规范 (Gateway Test Specification)

### 4.1 新增 `tests/server/test_gateway_agent.py`
主要聚焦 `server/routes/agent.py` 的关键 Agent 交互：

1. **同步执行测试 (`test_agent_turn_execution`)**：
   - 模拟 `MiniAgentClient.start_turn` 与 `wait_for_turn`；
   - 断言 `POST /api/agent/turn` 正确返回 `turn_id`、`final_text`、`steps`、`items`；
   - 验证 `AppServerError` 异常自动映射为 HTTP 400。
2. **SSE 流式传输测试 (`test_agent_stream_sse`)**：
   - 使用异步客户端调用 `GET /api/agent/stream?prompt=Hello`；
   - 断言返回响应头 `Content-Type: text/event-stream`；
   - 断言数据流格式为标准 `data: {...}\n\n`；
   - 验证流式事件同时被广播给活跃的 WebSocket 连接。
3. **纠偏与中断测试 (`test_agent_steer_and_interrupt`)**：
   - 测试 `POST /api/agent/steer` 成功下发并返回 `action_id`；
   - 测试 `POST /api/agent/interrupt` 成功请求中断；
   - 测试 WebSocket 收到 `steer` 与 `interrupt` 动作时分别返回 `steer_ack` 与 `interrupt_ack`。
4. **剪贴板附件与图片处理 (`test_agent_attachments_processing`)**：
   - 传入合法的 Base64 PNG/JPEG 图片；
   - 验证文件被正确解码落盘至当前项目的 `.mini-agent/attachments/`；
   - 验证 Prompt 末尾自动追加了 `[User Attached Image: ...]` 与 `[User Referenced Files: ...]` 上下文提示。
5. **授权审批 HTTP 端点 (`test_approval_respond_endpoint`)**：
   - 验证 `POST /api/approval/respond` 在存在待决授权时的 `status: resolved` 返回；
   - 验证非法/已关闭的 `request_id` 触发 HTTP 404。

### 4.2 新增 `tests/server/test_gateway_goals_and_items.py`
主要聚焦 `server/routes/threads.py` 与 `server/routes/world.py` 中的关键控制面：

1. **ThreadItems 游标分页 (`test_thread_items_pagination`)**：
   - 模拟包含 10 条不同类型 Item（userMessage、assistantMessage、toolCall）的线程；
   - 测试 `GET /api/threads/{id}/items?limit=5` 返回前 5 条与 `next_cursor`；
   - 使用 `cursor` 参数拉取下一页，验证数据连续性与无重复。
2. **Goal 全生命周期状态机 (`test_goal_lifecycle_endpoints`)**：
   - `POST /api/threads/{id}/goal` 设置目标 `objective="重构测试体系"`, `token_budget=10000`；
   - `GET /api/threads/{id}/goal` 验证目标正确读取；
   - `POST /api/threads/{id}/goal/pause` 验证目标暂停；
   - `POST /api/threads/{id}/goal/resume` 验证目标恢复；
   - `DELETE /api/threads/{id}/goal` 验证目标清理完成。
3. **Session 外部锁探测与 Attach (`test_thread_attach_locked_and_resumable`)**：
   - 模拟包含 `session.lock` 且对应外部活跃进程的 Session；
   - 测试 `POST /api/threads/{id}/attach` 正确返回 `attached: false` 与 `locked_by` 元数据，不强行占有；
   - 模拟无锁的历史 Session，测试返回 `attached: true`。

---

## 5. 实施路线图 (Phased Implementation Plan)

### 阶段 1：测试目录模块化划分（即刻推进）
1. 创建 `tests/sdk/`、`tests/server/`、`tests/tui/`、`tests/cookbook/`；
2. 移动现有 8 个测试文件至对应子目录（保持所有内部 import 不变）；
3. 运行 `uv run pytest -q`，确认现有 48 个测试全部原样通过（0 破坏）；
4. 更新 `tests/README.md`，给出新的目录结构与运行示例。

### 阶段 2：网关核心 Agent 交互测试补齐（高优先级）
1. 实现 `tests/server/test_gateway_agent.py`；
2. 补齐 `/api/agent/turn`、`/api/agent/stream` (SSE)、`steer`、`interrupt`、附件 Base64 解码、`/approval/respond` 测试；
3. 验证网关交互层覆盖率。

### 阶段 3：网关 Goal 控制面与 ThreadItems 测试补齐（中优先级）
1. 实现 `tests/server/test_gateway_goals_and_items.py`；
2. 补齐 `/api/threads/{id}/items`、Goal 5 个端点以及 Attach 状态探测；
3. 验证网关工作流与历史投影层覆盖率。

### 阶段 4：冒烟测试（Smoke Test）规范化归口
1. 在 `tests/smoke/` 建立与 `scripts/full_stack_smoke_test.py` 的清晰分工；
2. 编写无 Provider 的离线冒烟桩测试；
3. 将带真实 Provider 的全栈冒烟测试确立为发版前的推荐准入步骤。

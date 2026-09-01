# Mini Agent Python SDK 成熟度与协议覆盖报告

本文档全面记录了 `mini-agent-web` 官方 Python SDK (`mini-agent`) 0.6.0、Cookbook 实战示例以及底层 App Server JSON-RPC 2.0 协议的成熟度、接口覆盖矩阵与设计决策。

---

## 1. 总体成熟度与能力雷达

| 评估维度 | 评级 | 说明 |
| :--- | :---: | :--- |
| **API 完整性** | **100%** | 覆盖当前 App Server v1 的初始化、会话、轮次、流式事件、安全审批、运行时控制、环境快照与工作流方法。 |
| **类型安全性** | **95%** | 提供 PEP 561 `py.typed`、协议数据类和事件解析器；未知未来事件仍保留为 `GenericEvent`。 |
| **依赖与便携性** | **100%** | **零外部依赖 (Zero-Dependency)**，纯 Python 标准库（`asyncio`, `json`, `subprocess`, `dataclasses`）实现。 |
| **健壮性与容错** | **95%** | 异步双向管道、异常自动映射、目标 Turn 事件分流、`wait_for_turn` 轮询与超时保护。 |
| **Cookbook 验证度** | **确定性 100% / Live 需 Provider** | Demo 06 和全部脚本编译检查进入默认测试；Demo 01–05 需要显式 App Server 与模型 Provider。 |

---

## 2. App Server JSON-RPC 2.0 协议覆盖矩阵

| 协议命名空间 | 协议方法 (`method`) | SDK 封装接口 | 覆盖状态 | 核心功能与说明 |
| :--- | :--- | :--- | :---: | :--- |
| **Handshake** | `initialize` | `client.initialize()` | ✅ 覆盖 | 协议版本协商 (v1) 与 Capability Manifest 校验 |
| | `initialized` | 内部自动完成 | ✅ 覆盖 | 握手完成确认 |
| **Thread** | `thread/start` | `client.start_thread()` | ✅ 覆盖 | 启动或关联指定会话线程 |
| | `thread/read` | `client.read_thread()` | ✅ 覆盖 | 读取会话最新结算检查点与消息历史 |
| | `thread/close` | `client.close_thread()` | ✅ 覆盖 | 关闭会话并释放服务端资源 |
| | `thread/list` | `client.list_threads()` | ✅ 覆盖 | 列出所有活跃与持久化会话 |
| | `thread/fork` | `client.fork_thread()` | ✅ 覆盖 | 会话分支派生与状态复制 |
| | `thread/resume` | `client.resume_thread()` | ✅ 覆盖 | 从持久化检查点恢复历史会话 |
| **Turn** | `turn/start` | `client.start_turn()` | ✅ 覆盖 | 提交 Prompt 启动推理轮次 |
| | `turn/event` | `client.stream_turn()` | ✅ 覆盖 | 目标 Thread/Turn 的 Thinking/Tokens/Tools/Compaction/Run lifecycle 事件 |
| | `turn/read` | `client.read_turn()` | ✅ 覆盖 | 读取结算轮次的执行结果与停机原因 |
| | `turn/read` (Poll) | `client.wait_for_turn()` | ✅ 覆盖 | 轮询等待轮次结算并返回终态数据 |
| | `turn/steer` | `client.steer_turn()` | ✅ 覆盖 | 运行期动态注入纠偏指令 |
| | `turn/interrupt` | `client.interrupt_turn()` | ✅ 覆盖 | 运行期协作式取消与中断 |
| **Security** | `approval/request` | `client.approval_handler` | ✅ 覆盖 | 服务端权限拦截请求回调 |
| | `approval/respond` | 内部自动分发 | ✅ 覆盖 | 异步向服务端回传授权决策 |
| **Workflows** | `world/state` | `client.get_world_state()` | ✅ 覆盖 | 读取沙箱、系统、工具可用性快照 |
| | `world/refresh` | `client.refresh_world()` | ✅ 覆盖 | 动态刷新工作区与工具链可用性探测 |
| | `world/set_execution` | `client.set_world_execution()` | ✅ 覆盖 | 动态配置交互式/静默执行模式与安全策略 |
| | `mcp/status` | `client.get_mcp_status()` | ✅ 覆盖 | 读取 MCP 服务器与工具注册状态 |
| | `mcp/retry` | `client.retry_mcp()` | ✅ 覆盖 | 重试未就绪或断连的 MCP 服务 |
| | `session/info` | `client.get_session_info()` | ✅ 覆盖 | 读取会话持久化与数据库路径元数据 |
| | `workflow/state` | `client.get_workflow_state()` | ✅ 覆盖 | 读取 Plan Mode 与 Goal 工作流状态 |
| | `workflow/plan/set` | `client.set_plan_mode()` | ✅ 覆盖 | 切换只读 Plan Mode 规划模式 |
| | `workflow/goal/start` | `client.start_goal()` | ✅ 覆盖 | 启动多阶段 Goal 里程碑目标执行流 |
| | `workflow/goal/pause` | `client.pause_goal()` | ✅ 覆盖 | 暂停活跃的 Goal 工作流 |
| | `workflow/goal/fail` | `client.fail_goal()` | ✅ 覆盖 | 将活跃 Goal 标记为失败 |
| | `workflow/goal/criteria` | `client.get_goal_criteria()` | ✅ 覆盖 | 获取当前里程碑评测指标与约束 |
| | `workflow/goal/advance` | `client.advance_goal()` | ✅ 覆盖 | 携带外部校验员判定（Verdict）推进里程碑 |
| | `workflow/goal/record_verdict` | `client.record_verifier_verdict()` | ✅ 覆盖 | 记录里程碑检查点的外部审计输出 |

---

## 3. Cookbook 场景矩阵与测试结果

| 示例编号 | 示例文件 | 覆盖的核心机制 | 实测结果 |
| :---: | :--- | :--- | :---: |
| **Demo 01** | `01_basic_turn.py` | 基础问答、Thinking 提取、响应解析、Token 消耗统计 | **Live / 显式运行** |
| **Demo 02** | `02_streaming_events.py` | 深度流式事件（Token 级打字、Step 状态机、Compaction、Run lifecycle、输出截断） | **Live / 显式运行** |
| **Demo 03** | `03_approval_handling.py` | 敏感工具（Shell/File Write）拦截与交互式终端安全审批 | **Live / 显式运行** |
| **Demo 04** | `04_steering_and_interrupt.py` | 运行期动态转向 (`steer`) 与协作式中断取消 (`interrupt`) | **Live / 显式运行** |
| **Demo 05** | `05_workflows_and_inspection.py` | WorldState 环境检查、只读 Plan Mode 规划模式、会话检查点审查 | **Live / 显式运行** |
| **Demo 06** | `06_protocol_compatibility.py` | 0.6.0 全事件解析、结构化失败原因、未知事件保留 | **PASS / 无 Token** |

---

## 4. 架构与工程规范

1. **SDK 零第三方依赖**：
   - 避免引入 `pydantic` 或 `requests`/`httpx`，纯标准库保障了极其纯净的依赖环境与瞬间拉起速度。
2. **日志自动隔离**：
   - 自动提取当前执行脚本名称（例如 `02_streaming_events`），将日志输出至 `logs/02_streaming_events.log`，支持 `w` 与 `a` 模式。
3. **Rust 行数预算控制**：
   - 本次 SDK 建设完全在客户端层完成，严格遵循 `mini-codex` 的 20,000 行运行时硬限制与 30,000 行全工作区限制。

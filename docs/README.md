# Mini Agent Web & Python SDK Documentation

本目录包含 `mini-agent-web` 0.6.0、官方 Python SDK (`mini-agent`) 的架构设计、开发者指南、协议覆盖报告与决策记录（ADR）。当前 wire protocol 为 JSON-RPC version `1`。

---

## 📚 核心文档索引

### 1. 开发者指南与技术报告
* 📘 [**Python SDK 开发者指南 (`docs/python-sdk-guide.md`)**](python-sdk-guide.md)  
  包含 SDK 0.6.0 快速上手、`MiniAgentClient` 异步生命周期、Thread/Turn 约束的 Token 级流式推流、权限审批拦截与运行时动态控制。
* 🖥️ [**Web API Gateway 与 Web Studio 架构设计 (`docs/web-gateway-and-studio-architecture.md`)**](web-gateway-and-studio-architecture.md)  
  包含 FastAPI 网关架构、WebSocket/SSE 双流式通道、Thinking 思考折叠、工具状态卡片与双向安全审批握手实现。
* 📊 [**SDK 成熟度与协议覆盖报告 (`docs/sdk-maturity-and-protocol-coverage.md`)**](sdk-maturity-and-protocol-coverage.md)  
  包含 App Server JSON-RPC 2.0 协议全景覆盖矩阵、SDK 0.6.0 事件覆盖和 Cookbook 确定性/live 验收边界。
* 🧪 [**Python Cookbook (`cookbook/python-demo/README.md`)**](../cookbook/python-demo/README.md)
  包含 Demo 01–05 的 Provider 依赖说明，以及 Demo 06 的无 Provider、无 Token 协议验证。
* 📈 [**客户端架构与性能全景对比 (`docs/client-architectures-and-performance-comparison.md`)**](client-architectures-and-performance-comparison.md)  
  包含 Rust 原生 REPL、Python TUI 与 Web Studio 在进程模型、通信通道、启动延迟、内存开销与适用场景上的多维度系统性对比。
* 🛠️ [**App Server 并发死锁与流式挂起根因剖析 (`docs/app-server-concurrency-and-deadlock-analysis.md`)**](app-server-concurrency-and-deadlock-analysis.md)  
  深入剖析并记录了 Tokio 多线程运行时阻塞、Transport Actor 自锁、SSE Keep-Alive 挂起及子进程 Stdin 继承等 4 个底层死锁机制与加固方案。

---

## 🏛️ 架构决策记录 (ADR)

| 日期 | 状态 | 标题 | 决策说明 |
| :--- | :---: | :--- | :--- |
| 2026-08-31 | Accepted | [Python SDK Architecture & App Server Integration](adr/2026-08-31-python-sdk-architecture-and-app-server-integration.md) | 建立官方 `mini-agent` Python SDK，采用强类型事件体系与异步上下文管理器，对齐 Codex 架构分层 |
| 2026-08-31 | Accepted | [FastAPI Gateway & Web Studio UI](adr/2026-08-31-fastapi-gateway-and-web-studio-ui.md) | 基于 FastAPI、WebSocket/SSE 与零构建轻量 Web 前端构建 Web Studio 交互控制台与终端 TUI |
| 2026-09-02 | Proposed | [Tauri Desktop Shell for Mini Agent](adr/proposed/2026-09-02-tauri-desktop-app-and-app-server-integration.md) | 以 sidecar-first 方式复用 React UI，规划桌面 transport、窗口/托盘、通知、工作区约束与跨平台 fallback |
| 2026-09-02 | Proposed | [Rust Native TUI for Mini Agent](adr/proposed/2026-09-02-rust-native-tui-ratatui-architecture.md) | 规划由 Rust workspace 负责的 Ratatui 全屏 TUI，明确 App Server 复用、TEA reducer、终端恢复、性能测量与测试门槛 |
| 2026-09-02 | Proposed | [Local Web Studio Evolution](adr/proposed/2026-09-02-local-web-studio-evolution-and-roadmap.md) | 分阶段交付有界的 Diff/Artifact、工作区树、loopback 预览、Goal 投影、Mention、预算提示与结构化审批 |

---

## 当前发布验证

- `uv run pytest tests/ -v`：43 个测试通过；覆盖网关、WebSocket、线程分支、审批流与事件契约。
- `cd frontend && npm test`：7 个测试通过；覆盖 API 请求构造、WebSocket 发送守卫、流式事件状态机与斜杠命令解析。
- `uv run pytest tests/test_cookbook_validation.py -q`：编译全部 Cookbook，并运行 Demo 06 的无 Provider、无 Token 事件协议验证。
- Demo 01–05 仍是需要显式 Provider 的 live 示例，不作为默认 CI 依赖。
- 贡献者规则见仓库根目录的 [`AGENTS.md`](../AGENTS.md)。

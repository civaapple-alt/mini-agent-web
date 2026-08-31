# Mini Agent Web & Python SDK Documentation

本目录包含 `mini-agent-web` 项目、官方 Python SDK (`mini-agent`) 的架构设计、开发者指南、协议覆盖报告与决策记录（ADR）。

---

## 📚 核心文档索引

### 1. 开发者指南与技术报告
* 📘 [**Python SDK 开发者指南 (`docs/python-sdk-guide.md`)**](python-sdk-guide.md)  
  包含 SDK 快速上手、`MiniAgentClient` 异步生命周期、Token 级流式推流、权限审批拦截与运行时动态控制。
* 🖥️ [**Web API Gateway 与 Web Studio 架构设计 (`docs/web-gateway-and-studio-architecture.md`)**](web-gateway-and-studio-architecture.md)  
  包含 FastAPI 网关架构、WebSocket/SSE 双流式通道、Thinking 思考折叠、工具状态卡片与双向安全审批握手实现。
* 📊 [**SDK 成熟度与协议覆盖报告 (`docs/sdk-maturity-and-protocol-coverage.md`)**](sdk-maturity-and-protocol-coverage.md)  
  包含 App Server JSON-RPC 2.0 协议全景覆盖矩阵、Cookbook 5 大核心场景实测验收与工程规范。
* 🛠️ [**App Server 并发死锁与流式挂起根因剖析 (`docs/app-server-concurrency-and-deadlock-analysis.md`)**](app-server-concurrency-and-deadlock-analysis.md)  
  深入剖析并记录了 Tokio 多线程运行时阻塞、Transport Actor 自锁、SSE Keep-Alive 挂起及子进程 Stdin 继承等 4 个底层死锁机制与加固方案。

---

## 🏛️ 架构决策记录 (ADR)

| 日期 | 标题 | 决策说明 |
| :--- | :--- | :--- |
| 2026-08-31 | [Python SDK Architecture & App Server Integration](adr/2026-08-31-python-sdk-architecture-and-app-server-integration.md) | 建立官方 `mini-agent` Python SDK，采用强类型事件体系与异步上下文管理器，对齐 Codex 架构分层 |
| 2026-08-31 | [FastAPI Gateway & Web Studio UI](adr/2026-08-31-fastapi-gateway-and-web-studio-ui.md) | 基于 FastAPI、WebSocket/SSE 与零构建轻量 Web 前端构建 Web Studio 交互控制台与终端 TUI |

# Mini Agent Web & Python SDK Documentation

本目录包含 `mini-agent-web` 0.7.0 的核心操作手册、限制规范、隐私说明与故障排查指南。

> 💡 **架构决策记录 (ADR) 与演进设计**：请参阅 [`.agents/notes/README.md`](../.agents/notes/README.md)。

---

## 📚 核心文档索引

| 文档名称 | 对应路径 | 核心内容说明 |
| :--- | :--- | :--- |
| 🛡️ **运行边界与限制** | [`limits.md`](limits.md) | 输入长度、流式输出、工具结果、执行步数与网络帧的显式硬限制。 |
| 🔒 **数据与隐私保护** | [`privacy.md`](privacy.md) | 零遥测声明、本地数据流向、API 凭证防泄漏与安全审批防护。 |
| 🚀 **版本发布流程** | [`releasing.md`](releasing.md) | 全栈多模块版本同步清单、自动化门禁测试套件与 Git 标签发布规范。 |
| 🛠️ **故障排查指南** | [`troubleshooting.md`](troubleshooting.md) | App Server 丢失、端口冲突、WebSocket 断开、401 鉴权失败与审批卡死的解决方案。 |
| 📘 **Python SDK 开发者指南** | [`python-sdk-guide.md`](python-sdk-guide.md) | `MiniAgentClient` 异步生命周期、流式推流、权限审批拦截与运行时动态控制说明。 |

---

## 🏛️ 架构决策与设计笔记 (Agent Notes)

技术选型、架构设计与并发优化笔记已按规范归档至 [`.agents/notes/`](../.agents/notes/README.md)：

- **已落地决策 (Implemented)**：
  - [Python SDK 架构与 App Server 集成](../.agents/notes/implemented/architecture/2026-08-31-python-sdk-architecture-and-app-server-integration.md)
  - [FastAPI 网关与 Web Studio 交互设计](../.agents/notes/implemented/architecture/2026-08-31-fastapi-gateway-and-web-studio-ui.md)
  - [App Server 并发死锁与加固复盘](../.agents/notes/implemented/bug-fix/2026-08-31-app-server-concurrency-and-deadlock-analysis.md)
  - [客户端架构与性能全景对比分析](../.agents/notes/implemented/architecture/2026-09-02-client-architectures-and-performance-comparison.md)
  - [SDK 0.7.0 适配评审与控制面演进落地](../.agents/notes/implemented/architecture/2026-09-03-sdk-0.7.0-alignment-review-and-control-plane-evolution.md)
- **规划与演进提案 (Proposed)**：
  - [Local Web Studio 演进路线提案](../.agents/notes/proposed/feature/2026-09-02-local-web-studio-evolution-and-roadmap.md)
  - [Rust 原生 TUI (Ratatui) 架构提案](../.agents/notes/proposed/architecture/2026-09-02-rust-native-tui-ratatui-architecture.md)
  - [Tauri 原生桌面 Shell 提案](../.agents/notes/proposed/architecture/2026-09-02-tauri-desktop-app-and-app-server-integration.md)

---

## 当前验证门禁

- `uv run pytest tests/ -v`：46 个测试通过；
- `cd frontend && npm test`：10 个测试通过；
- `cd frontend && npm run build`：生产构建 0 错误通过；
- `uv run python cookbook/python-demo/06_protocol_compatibility.py`：14 类协议事件离线校验通过；
- 贡献者规则见仓库根目录的 [`AGENTS.md`](../AGENTS.md)。

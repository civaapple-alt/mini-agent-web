# Architecture Notes

本目录只索引 `mini-agent-web` 的架构决策、问题复盘和演进提案，不承担产品
使用说明或完整实现文档。

## 目录

```text
.agents/notes/
├── README.md
├── proposed/       评审中或尚未落地的方案
└── implemented/    已落地并完成验证的决策
```

## 已落地

- [Python SDK 与 App Server 集成](implemented/architecture/2026-08-31-python-sdk-architecture-and-app-server-integration.md)
- [FastAPI Gateway 与 Web Studio](implemented/architecture/2026-08-31-fastapi-gateway-and-web-studio-ui.md)
- [Web Gateway 与 Studio 架构](implemented/architecture/2026-08-31-web-gateway-and-studio-architecture.md)
- [App Server 并发问题复盘](implemented/bug-fix/2026-08-31-app-server-concurrency-and-deadlock-analysis.md)
- [客户端架构与性能对比](implemented/architecture/2026-09-02-client-architectures-and-performance-comparison.md)
- [SDK 0.7.0 适配与控制面演进](implemented/architecture/2026-09-03-sdk-0.7.0-alignment-review-and-control-plane-evolution.md)
- [SDK 成熟度与协议覆盖](implemented/testing/2026-08-31-sdk-maturity-and-protocol-coverage.md)

## 提案

- [Local Web Studio 演进路线](proposed/feature/2026-09-02-local-web-studio-evolution-and-roadmap.md)
- [Rust 原生 TUI](proposed/architecture/2026-09-02-rust-native-tui-ratatui-architecture.md)
- [Tauri Desktop Shell](proposed/architecture/2026-09-02-tauri-desktop-app-and-app-server-integration.md)
- [Web Studio 前端测试与质量保障体系](proposed/testing/2026-09-04-web-studio-frontend-test-and-quality-assurance.md)

## 维护规则

- 一项决策对应一个主题文件，不在旧文件末尾无限追加新阶段；
- 提案落地后移动到 `implemented/`，并在本索引同步状态；
- 只有仍然影响当前实现的决策才保留在索引中；
- 具体代码、运行命令和用户操作不写入这里。

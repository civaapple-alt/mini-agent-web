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

- [Session fork 结构化冲突契约](implemented/bug-fix/2026-09-15-session-fork-structured-conflict.md)
- [Session fork 上下文策略契约](implemented/bug-fix/2026-09-15-session-fork-context-policy-contract.md)
- [Session fork 重试幂等](implemented/bug-fix/2026-09-15-session-fork-retry-idempotency.md)
- [Python SDK 与 App Server 集成](implemented/architecture/2026-08-31-python-sdk-architecture-and-app-server-integration.md)
- [FastAPI Gateway 与 Web Studio](implemented/architecture/2026-08-31-fastapi-gateway-and-web-studio-ui.md)
- [Web Gateway 与 Studio 架构](implemented/architecture/2026-08-31-web-gateway-and-studio-architecture.md)
- [App Server 并发问题复盘](implemented/bug-fix/2026-08-31-app-server-concurrency-and-deadlock-analysis.md)
- [客户端架构与性能对比](implemented/architecture/2026-09-02-client-architectures-and-performance-comparison.md)
- [SDK 0.7.0 适配与控制面演进](implemented/architecture/2026-09-03-sdk-0.7.0-alignment-review-and-control-plane-evolution.md)
- [SDK 成熟度与协议覆盖](implemented/testing/2026-08-31-sdk-maturity-and-protocol-coverage.md)
- [Web Studio 前端测试与质量保障体系](implemented/testing/2026-09-04-web-studio-frontend-test-and-quality-assurance.md)
- [模块化测试体系重构与 FastAPI Gateway 质量保障](implemented/testing/2026-09-04-modular-test-architecture-and-gateway-coverage.md)
- [持续集成 (CI) 流水线建设与日常 PR 门禁](implemented/testing/2026-09-04-continuous-integration-pipeline-and-pr-gate.md)
- [Web Studio 状态持久化层拆分与解耦](implemented/architecture/2026-09-07-decoupled-state-persistence-architecture.md)
- [Web Studio 多项目多会话并发与实时流切换](implemented/feature/2026-09-10-web-studio-concurrent-sessions-and-live-stream-switching.md)
- [Web Studio 与 Gateway 的职责化模块重构](implemented/architecture/2026-09-10-webstudio-gateway-modular-refactor.md)
- [Web Studio UI 交互、布局与主题升级](implemented/feature/2026-09-14-web-studio-ui-simplification.md)
- [审批身份与生命周期收敛](implemented/bug-fix/2026-09-14-approval-identity-and-lifecycle.md)
- [停止超时与大 Session 重启恢复](implemented/bug-fix/2026-09-14-session-recovery-after-large-checkpoint.md)
- [Trusted 低打断工具执行](implemented/feature/2026-09-14-trusted-low-interruption-execution.md)
- [用户输入 Trace 与 Thread 历史](implemented/feature/2026-09-14-user-input-trace-and-thread-history.md)
- [Thread/Session 停止、派生与 Attach 竞态](implemented/bug-fix/2026-09-15-thread-session-control-races-and-attach.md)
- [Web Studio 实际 Session ID 展示](implemented/feature/2026-09-14-web-studio-session-id-visibility.md)

## 提案

- [Local Web Studio 演进路线](proposed/feature/2026-09-02-local-web-studio-evolution-and-roadmap.md)
- [Rust 原生 TUI](proposed/architecture/2026-09-02-rust-native-tui-ratatui-architecture.md)
- [Tauri Desktop Shell](proposed/architecture/2026-09-02-tauri-desktop-app-and-app-server-integration.md)

## 维护规则

- 一项决策对应一个主题文件，不在旧文件末尾无限追加新阶段；
- 提案落地后移动到 `implemented/`，并在本索引同步状态；
- 只有仍然影响当前实现的决策才保留在索引中；
- 具体代码、运行命令和用户操作不写入这里。

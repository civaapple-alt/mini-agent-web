# mini-agent-web Architecture and Design Decisions (Agent Notes)

本文档索引并规范了 **`mini-agent-web`** 仓库的架构决策记录（ADR）、技术选型、并发加固及演进设计笔记。

---

## 1. 维护门禁与协议纪律 (Maintenance Gates & Discipline)

当前版本处于 `0.7.0` 演进期，严格遵循以下硬性门禁：

1. **线缆协议稳定性**：保持线缆通信层为 **JSON-RPC Wire Protocol Version 1**。公共字段名称（如 `thread_id`、`turn_id`、`collaborationMode`、`builtinTools`）不得随意修改；
2. **全栈版本一致性**：`pyproject.toml`、`sdk/python/pyproject.toml`、`sdk/python/src/mini_agent/__init__.py`、`server/app.py` 与 `frontend/package.json` 必须全量同步；
3. **零 Token 自动化测试**：默认自动化测试（`pytest`、`npm test`、`06_protocol_compatibility.py`）绝不依赖外部真实大模型 Provider 或消耗付费 Token；
4. **未知事件前向兼容**：SDK 必须将未知的新增 App Server 事件反序列化为 `GenericEvent`，杜绝协议升级破坏旧版客户端；
5. **受控内置工具集合**：严格约束为 6 种标准内置工具（`read_file`, `write_file`, `edit_file`, `shell`, `web_fetch`, `read_image`）。

---

## 2. 目录组织规范 (Directory Semantics & Layout)

每一篇技术决策笔记均依据其生命周期与类别进行两级分类定位：
`{lifecycle}/{class}/yyyy-mm-dd-<topic-title>.md`

```text
.agents/notes/
├── README.md                  # 本索引文档
├── proposed/                  # 评审中、待落地或部分立项的方案与路线图
│   ├── architecture/          # 跨模块架构、底层传输与原生桌面 Shell 方案
│   └── feature/               # 用户可见的功能特性规划与演进路线
└── implemented/               # 已在生产环境完整落地并经过测试验证的决策
    ├── architecture/          # 已落地的系统分层、SDK 架构、多端协同与协议适配
    ├── bug-fix/               # 深度并发死锁根除、长连接挂起修复等事后复盘
    └── testing/               # 协议测试矩阵、成熟度雷达与零 Token 验证设计
```

---

## 3. 已落地决策索引 (Implemented Notes)

| 类别 | 日期 | 标题与链接 | 核心决策要点 |
| :--- | :---: | :--- | :--- |
| **architecture** | 2026-08-31 | [Python SDK Architecture & App Server Integration](implemented/architecture/2026-08-31-python-sdk-architecture-and-app-server-integration.md) | 建立官方 `mini-agent` 异步 Python SDK，基于标准库实现 Stdio JSON-RPC 2.0 驱动，采用强类型事件树对齐 Codex 规范。 |
| **architecture** | 2026-08-31 | [FastAPI Gateway & Web Studio UI](implemented/architecture/2026-08-31-fastapi-gateway-and-web-studio-ui.md) | 建立 FastAPI 网关与 WebSocket 全双工通道，实现 Web Studio 交互式控制台、Thinking 展开与双向审批 Dock。 |
| **architecture** | 2026-08-31 | [Web API Gateway 与 Web Studio 架构设计](implemented/architecture/2026-08-31-web-gateway-and-studio-architecture.md) | 深入梳理 C/S 双流式通道架构、`SessionManager` 实例池、DOM 防重绘流式聚合与安全审批状态机。 |
| **bug-fix** | 2026-08-31 | [App Server 并发死锁与流式挂起根因剖析与加固](implemented/bug-fix/2026-08-31-app-server-concurrency-and-deadlock-analysis.md) | 彻底排查并根治 Tokio 单线程阻塞、Transport Actor 自锁死锁、OpenAI SSE Keep-Alive 挂起及子进程 Stdin 继承假死。 |
| **architecture** | 2026-09-02 | [客户端架构与性能全景对比分析](implemented/architecture/2026-09-02-client-architectures-and-performance-comparison.md) | 对 Rust REPL、Python TUI 与 Web Studio 的进程模型、通信机制、延迟（微秒级 vs 亚毫秒级）与内存占用做深度横向评测。 |
| **testing** | 2026-08-31 | [SDK 成熟度与协议覆盖报告](implemented/testing/2026-08-31-sdk-maturity-and-protocol-coverage.md) | 全景建立 25+ 接口覆盖矩阵、类型契约雷达与零 Token 自动化测试验证体系。 |
| **architecture** | 2026-09-03 | [SDK 0.7.0 适配评审与控制面演进落地](implemented/architecture/2026-09-03-sdk-0.7.0-alignment-review-and-control-plane-evolution.md) | 评审 0.7.0 Codex 对齐改造，解耦运行时线程绑定，落地 Builtin Tools 选择器、全量 ThreadItem 流规约与多线程会话路由。 |

---

## 4. 规划与演进提案索引 (Proposed Notes)

| 类别 | 日期 | 标题与链接 | 核心提案要点 |
| :--- | :---: | :--- | :--- |
| **feature** | 2026-09-02 | [Local Web Studio 演进路线提案](proposed/feature/2026-09-02-local-web-studio-evolution-and-roadmap.md) | 分阶段规划 Monaco Diff 审查、工作区文件变动监听、Loopback 预览代理、DAG 结构化 Goal 投影与可编辑审批。 |
| **architecture** | 2026-09-02 | [Rust 原生 TUI (Ratatui) 架构提案](proposed/architecture/2026-09-02-rust-native-tui-ratatui-architecture.md) | 规划由 Rust 工作区承载的 Ratatui 原生全屏 TUI，采用 TEA（The Elm Architecture）状态规约与直接通道复用。 |
| **architecture** | 2026-09-02 | [Tauri 原生桌面 Shell 提案](proposed/architecture/2026-09-02-tauri-desktop-app-and-app-server-integration.md) | 采用 sidecar-first 架构复用 React 前端，规划桌面 Transport、原生托盘/通知、工作区受限访问与平台降级方案。 |

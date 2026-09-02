# ADR: Native Desktop Application for Mini Agent based on App Server and Tauri 2.0

## Status
Proposed

## Date
2026-09-02

## Context

当前 Mini Agent 生态已具备两大核心交互形态：
1. **Rust 原生 REPL / CLI**：高性能、单二进制、严苛代码行数控制，适合 Harness 实验与 CI/CD 评测；
2. **Web Studio (`mini-agent-web`)**：具备现代 React 19 前端与 FastAPI 网关，支持多项目看板、流式 Thinking 打字机、内联工具卡片、Plan/Goal 工作流可视化。

然而，在日常深度人机结对编程（Pair Programming）场景中，Web 浏览器形态存在固有局限：
* **本地端口与网络安全边界**：需监听 `localhost:8000` / `5173`，面临浏览器同源策略（CORS）与跨域凭据安全隐患；
* **缺乏系统级全局感知**：无法注册全局快捷键（如 `Alt+Space` / `Option+Space`）即呼即用，必须切回浏览器标签页；
* **审批体验受阻**：Agent 在后台执行耗时任务并触发敏感命令审批时，浏览器无法弹出**带操作按钮的原生交互式系统通知（Actionable OS Notifications）**；
* **资源开销偏大**：浏览器独立 Tab 常驻占用 150MB~300MB 内存。

由于 Mini Agent 底座原生采用 Rust 编写，而前端采用 React 19 + Vite 构建，天然契合 **Tauri 2.0（Rust 宿主 + 系统原生 Webview）** 的技术架构。

---

## Decision

我们提议构建 **Mini Agent Desktop Studio** 原生桌面应用，技术决策如下：

### 1. 宿主框架选型：Tauri 2.0
* **核心选型**：采用 Tauri 2.0 作为桌面外壳框架（Rust 宿主 + 操作系统原生 Webview：Windows Webview2、macOS WebKit、Linux WebKitGTK）。
* **资产复用**：100% 完整复用 `mini-agent-web/frontend` 的 React 19 单页应用代码与 UI 组件资产，无需重写界面。
* **分发指标**：安装包体积控制在 **~10 MB**，运行态内存占用控制在 **30 MB ~ 50 MB**，冷启动延迟 **< 150 ms**。

---

### 2. 双阶段引擎接入架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Mini Agent Desktop (Tauri 2.0)                        │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    React 19 Web Studio (Webview)                      │  │
│  │     (Thinking Blocks / ToolCards / SidePanel / Plan / Goal / Git)     │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │ Tauri IPC (invoke / listen)          │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                   Tauri Rust Main Process (Host)                      │  │
│  │   - TrayManager (系统托盘)           - HotkeyManager (Alt+Space 唤醒) │  │
│  │   - NotificationBridge (交互式审批)   - WindowManager (毛玻璃/悬浮窗)  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│                ┌─────────────────────┴─────────────────────┐                │
│                ▼ (阶段一: Sidecar 模式)                    ▼ (阶段二: In-Process)    │
│  ┌───────────────────────────────┐     ┌─────────────────────────────────┐  │
│  │    mini-agent-app-server      │     │  mini-agent-host / core (Crate) │  │
│  │ (Stdio JSON-RPC 2.0 子进程)    │     │   (Tokio MPSC 零拷贝内存通道)   │  │
│  └───────────────────────────────┘     └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

* **阶段一（Sidecar 模式 · 快速交付）**：
  - 利用 Tauri `externalBin` 特性将 `mini-agent-app-server` 作为 sidecar 打包；
  - Tauri Rust 端拉起子进程并通过标准输入输出（Stdio）进行标准 **JSON-RPC 2.0** 通信；
  - 严格保持与官方 Protocol 规范 100% 一致，无额外协议变更。
* **阶段二（In-Process 直连模式 · 极致性能）**：
  - Tauri Rust 宿主直接依赖 `mini-agent-host` 与 `mini-agent-core` crates；
  - 消除跨进程管道序列化开销，直接通过 Tokio MPSC 零拷贝内存通道驱动事件流。

---

### 3. 桌面端专属增强特性

1. **Spotlight 极简悬浮唤醒窗 (HUD Mode)**：
   - 注册全局快捷键（`Alt + Space` / `Option + Space`）；
   - 在屏幕中央唤出无边框毛玻璃交互栏，支持快速提问、粘贴截图、即时执行，回车后后台执行。
2. **原生 Actionable 审批通知**：
   - 触发敏感命令需要审批时，向操作系统推送原生通知卡片；
   - 通知卡片内嵌快捷按钮：`[ 允许 (Allow) ]`、`[ 始终允许 (Always) ]`、`[ 拒绝 (Deny) ]`，用户无需切换主窗口即可完成授权。
3. **系统托盘与会话常驻 (System Tray)**：
   - 支持关闭窗口时最小化至托盘后台运行；
   - 托盘右键菜单支持：新建会话、最近项目切换、查看运行日志、快捷设置。
4. **原生工作区拖拽与本地文件系统直通**：
   - 直接将本地文件夹或代码文件拖入应用窗口，自动识别并加入项目工作区（Project Workspace），绕过所有 Web 安全沙箱限制。

---

## Consequences

### Positive (收益)
* **零配置分发**：用户下载单个安装包即开即用，不再需要安装 Node.js、Python 或手动启动网关服务；
* **极度轻量与节能**：内存开销从浏览器标签页的 ~200MB 骤降至 ~40MB，功耗大幅降低；
* **无缝人机结对**：全局快捷键 + 原生审批通知彻底消除开发流程中的打断感与切屏成本；
* **代码资产高利用率**：前端 React 代码与后端 Rust 引擎 100% 复用，维护成本极低。

### Negative / Trade-offs (代价与妥协)
* **跨平台打包流水线**：需要在 CI/CD 中针对 Windows (MSI/NSIS)、macOS (DMG/Notarization)、Linux (AppImage/deb) 维护多端构建与签名流程；
* **Webview 平台差异**：Windows (Webview2 / Chromium) 与 macOS (WebKit / Safari) 存在微小的 CSS/Webkit 渲染差异，需在 CI 中纳入跨端视觉校验。

---

## Implementation Roadmap

* **Phase 1: Tauri 2.0 脚手架与前端资产集成 (M1)**
  - 初始化 Tauri 2.0 工程；
  - 打通 React 19 前端在 Tauri 内部的加载与热重载。
* **Phase 2: Sidecar JSON-RPC 通信通道打通 (M2)**
  - 打包 `mini-agent-app-server` 作为 sidecar；
  - 实现 Rust 端 JSON-RPC 事件路由与 `app_handle.emit` 桥接。
* **Phase 3: 桌面原生能力落地 (M3)**
  - 落地 System Tray、全局热键 `Alt+Space` 与 Actionable 系统通知；
  - 接入原生文件拖拽与系统剪贴板支持。
* **Phase 4: 多平台打包与 CI 流水线 (M4)**
  - 编写 GitHub Actions 自动构建跨平台 Release 包。

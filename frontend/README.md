# Web Studio

本目录是 Mini Agent Web Studio 的 React 单页应用，使用 React 与 Vite。它
负责消息、工具卡片、审批和工作流面板的展示，不持有 App Server 的运行时
权威状态。

## 本地开发

```bash
npm install
npm run dev
```

开发服务器默认监听 `http://127.0.0.1:5173`。代码扫描、测试与构建：

```bash
npm run lint
npm test
npm run build
```

## 本地边界

- `src/api.js`：REST 与 WebSocket 请求封装；
- `src/App.jsx`：页面级状态和事件分发，集成顶层 ErrorBoundary 容错保护；
- `src/utils/`：消息聚合、ThreadItem 投影、状态选择器和斜杠命令等纯逻辑；
- `src/components/`：消息、工具、审批、状态栏、详情抽屉、侧栏、设置组件与 ErrorBoundary；
- `src/tests/`：Node 原生测试与 Vitest 组件挂载测试；
- `eslint.config.js`：ESLint 9 静态语法与 JSX 导入未声明标识符安全扫描。

事件消费遵循 Thread/Turn 身份，并用稳定 item ID 合并工具和上下文压缩状态。
历史消息通过 ThreadItem 分页投影恢复，生命周期通知不会创建重复卡片；相邻的上下文压缩
会合并为可展开的计数卡，并在详情中保留 Turn/Item 身份。

Thread、Workflow、Runtime 和文件请求都绑定当前 `project_id` 与 Session 上下文。
会话切换、创建、Fork、关闭或项目切换会递增 request epoch、取消旧请求，并先清空
旧消息、Turn、Plan、Goal、Runtime 和审批投影；晚到响应会被丢弃。`/clear` 只清空
当前页面显示，不删除 Session history。

页面使用统一状态栏显示当前生命周期、Project/Session/Turn 作用域、连接状态和执行设置；
运行详情抽屉提供 phase、operation、checkpoint、审批、错误和最近工作流事件。计划、目标以及
World/MCP/Git 详情均从抽屉顶部 Tab 进入；内置工具权限属于工作区，“计划”使用独立的全高
Markdown 阅读区，不把 README.md 作为计划文件展示。WebSocket 重连后，页面
用有界 `turn/event` cursor 重放短暂断线期间的事件，遇到 `has_gap` 则重新读取
canonical Thread/Item projection。

同一 Gateway 下的多个浏览器可以同时观察同一 Session。工具审批会在同 Project 的
客户端间同步；首个有效响应生效，其他浏览器收到权威结算后关闭本地审批卡片，过期
或冲突响应会提示“可能已由其他浏览器处理或已失效”。

Studio 侧栏从 App Server 的 SessionStore 投影同时展示历史、活跃 Turn 和已暂停
Session。侧栏的“运行中”只表示当前 Turn 尚未结算；SessionStore 进程锁单独显示为
“在线”或“待命”，避免把空闲进程误判为运行中。选择历史或已暂停 Session 会请求 attach；
如果 Session 仍被另一个 App Server 进程锁定，Studio 保持只读历史，锁释放后即可再次 attach。活动 Goal
统一显示在状态栏和详情抽屉中，状态和暂停、恢复、更新、删除操作仍以 App Server
为准。Plan Turn 完成后，待用户选择“继续规划”或“开始实施”；该待确认状态随
Session 恢复，不依赖浏览器内存。

“派生独立分支”只复制 source Thread 最近一次已结算 checkpoint；默认精确复制，不
在派生时调用模型或触发压缩，也不复制完整 `session.jsonl`。侧栏另提供“派生并压缩”，
通过显式 `contextPolicy=compact` 请求。Gateway 随后为 child Session 启动
独立的 App Server client。Header、侧栏和运行详情使用 canonical `session_id`，并
保留父 Session、checkpoint 和压缩前后大小信息。

访问范围、审批策略和会话推进方式统一在状态栏“运行设置”中调整；当前 Turn、审批
等待或停止结算期间会锁定设置并说明原因。停止审批中的 Turn 时，审批卡保持可见但不可操作，
直到终态事件结算；来自其他浏览器的审批结算会关闭本地操作卡并提示请求已失效或已被处理。

Studio 只提供 `Light` 与 `Dark` 两种主题。历史 `midnight` 和 `cyberpunk` 设置读取时
统一迁移为 `Dark`，组件颜色使用语义化主题 Token，并支持键盘焦点和减少动效偏好。

## 入口文件

```text
index.html
package.json
eslint.config.js
vite.config.js
src/main.jsx
src/App.jsx
src/api.js
src/components/
src/utils/
src/tests/
```

构建产物位于 `dist/`，属于生成文件，不应提交。

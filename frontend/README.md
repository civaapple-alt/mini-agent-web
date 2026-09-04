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
- `src/utils/`：消息聚合、ThreadItem 投影和斜杠命令等纯逻辑；
- `src/components/`：消息、工具、审批、侧栏、设置组件与 ErrorBoundary；
- `src/tests/`：Node 原生测试与 Vitest 组件挂载测试；
- `eslint.config.js`：ESLint 9 静态语法与 JSX 导入未声明标识符安全扫描。

事件消费遵循 Thread/Turn 身份，并用稳定 item ID 合并工具和上下文压缩状态。
历史消息通过 ThreadItem 分页投影恢复，生命周期通知不会创建重复卡片。

Studio 侧栏从 App Server 的 SessionStore 投影同时展示历史、运行中和已暂停
Session。选择历史或已暂停 Session 会请求 attach；如果 Session 仍被另一个
App Server 进程锁定，Studio 保持只读历史，锁释放后即可再次 attach。活动 Goal
固定显示在当前 Thread 顶部，状态和暂停、恢复、更新、删除操作仍以 App Server
为准。

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

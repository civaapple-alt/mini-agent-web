# Web Studio 前端

本目录是 Web Studio 的 React 单页应用。它通过 Gateway 的 REST API 与 WebSocket
展示和控制 App Server Session。浏览器只保存显示状态与请求状态，不拥有执行、
授权、Session history 或恢复状态。

## 本地运行

首次运行时安装 JavaScript 依赖，然后启动 Vite：

```bash
npm install
npm run dev
```

Vite 默认监听 `http://127.0.0.1:5173`，开发时将 `/api` 代理到
`http://127.0.0.1:8000`，将 `/ws` 代理到 `ws://127.0.0.1:8000`。使用
Studio 前先启动 Gateway。

在本目录中运行以下命令检查改动：

```bash
npm run lint
npm run test
npm run build
```

`npm run test:unit` 运行纯工具函数的 Node 测试。`npm run test:ui` 运行
Happy DOM 中的 Vitest 组件测试。`npm run build` 将部署文件写入 `dist/`；
该目录是生成产物，不应提交。

## 目录分工

```text
index.html              Vite HTML 入口
src/main.jsx            React 启动入口
src/App.jsx             页面状态、请求生命周期和事件投影
src/api/                Gateway REST 与 WebSocket 客户端
src/components/         布局和交互组件
src/utils/              纯投影、选择器和输入辅助函数
src/tests/              单元与组件测试
```

`src/api/request.js` 为 Gateway 请求附加活动 `project_id`。`src/App.jsx`
在 Project 或 Thread 变更时清空本地投影，并拒绝来自过期 request epoch 的响应。
新增请求路径时必须保留这项客户端保护。请求与 Session 切换竞争时，Gateway 和
App Server 仍是权威。

## UI 边界

Web Studio 读取 canonical Thread 与 ThreadItem 投影，并在 WebSocket 重连后使用
有界事件重放。如果重放结果报告 gap，客户端重新读取 canonical history，而不猜测
缺失事件。

UI 可以提交 Turn、steer 或 interrupt 运行中的 Turn，并响应审批请求。每个控制请求
必须保留 Project、Thread 和 Turn 身份。Gateway 校验这些身份，App Server 决定是否
执行。

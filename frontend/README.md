# Web Studio

本目录是 Mini Agent Web Studio 的 React 单页应用，使用 React 与 Vite。它
负责消息、工具卡片、审批和工作流面板的展示，不持有 App Server 的运行时
权威状态。

## 本地开发

```bash
npm install
npm run dev
```

开发服务器默认监听 `http://127.0.0.1:5173`。生产构建和单元测试：

```bash
npm test
npm run build
```

## 本地边界

- `src/api.js`：REST 与 WebSocket 请求封装；
- `src/App.jsx`：页面级状态和事件分发；
- `src/utils/`：消息聚合、ThreadItem 投影和斜杠命令等纯逻辑；
- `src/components/`：消息、工具、审批、侧栏和设置组件；
- `src/tests/`：Node 原生测试。

事件消费遵循 Thread/Turn 身份，并用稳定 item ID 合并工具和上下文压缩状态。
历史消息通过 ThreadItem 分页投影恢复，生命周期通知不会创建重复卡片。

## 入口文件

```text
index.html
package.json
vite.config.js
src/main.jsx
src/App.jsx
src/api.js
src/components/
src/utils/
src/tests/
```

构建产物位于 `dist/`，属于生成文件，不应提交。

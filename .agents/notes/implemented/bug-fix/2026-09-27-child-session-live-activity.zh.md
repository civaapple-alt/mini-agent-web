# 子 Session 详情实时活动与事件回放

- status: implemented
- date: 2026-09-27

## 问题

子任务列表能显示运行状态和当前阶段，但打开运行中的子 Session 详情时可能为空。详情此前只读取 checkpoint
和已结算 Turn 写入的 ThreadItems；运行中的思考、文本和工具活动通过实时通知发送，尚未进入持久化活动列表。

## 决策

- App Server 的实时事件仍是运行中活动的来源，WebSocket 只负责即时投递；前端不建立第二份持久事件账本。
- 详情订阅精确限定在 `(project_id, child_thread_id)`，避免相同 ID 的其他项目或父 Thread 的消息混入。
- 打开详情和定时刷新使用已有有界 `turn/events` 接口补齐实时事件。按 sequence 去重并分页追到事件缓存末端；结算后的 ThreadItems 继续负责刷新和长期恢复。
- 仅将当前或最近执行 Turn 的事件应用到子 Session transcript；该 Turn 的持久化 assistant 活动出现后，以持久化投影为准。
  父 checkpoint 仍作为模型上下文，但不呈现为子任务活动。
- App 的主消息流仍按当前 Thread 隔离。子事件在主流过滤之前分流给只读详情订阅者，观察者异常不会中断正常事件处理。
- 回放缓存有缺口时提示用户；可用事件先显示，Turn 结算后的持久化记录再补齐。

## 实现

- `frontend/src/utils/childRuntimeEvents.js`：增加按项目和 child Thread 精确匹配的进程内事件订阅；不缓存事件。
- `frontend/src/App.jsx`：在父消息流隔离前分流 App Server event 通知。
- `frontend/src/components/ChildSessionViewer.jsx`：复用主会话的流事件 reducer，订阅实时事件并用 bounded replay 恢复序列；继续轮询状态和持久活动。
- `frontend/src/components/SidePanel.css`：添加事件回放缺口提示样式。
- `docs/child-tasks.md` 与 `CHANGELOG.md`：记录详情的实时活动和恢复行为。

## 验证

- `git diff --check`：通过。
- `npm run lint`：通过。
- `npm run build`：通过；Vite 提示现有 JS bundle 超过 500 kB。
- 未运行测试。

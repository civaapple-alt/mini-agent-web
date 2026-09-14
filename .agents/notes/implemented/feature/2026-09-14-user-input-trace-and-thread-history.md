# Web Studio 用户输入 Trace 与 Thread 历史

## 状态

已实现并完成前端单元测试、Lint 与构建验证。

## 决策

Web Studio 为每条用户输入生成一个有界的展示型 `inputTrace`，记录：

- Project、Thread、Turn 作用域；
- 提交当时的访问范围、审批策略、推进方式，以及 Plan/Goal 是否激活；
- 图片数量和文件引用摘要；
- 普通输入、实时纠偏和 Goal 输入来源。

Trace 不复制完整 Prompt，也不成为运行或授权权威。Prompt 继续由消息和
Session 历史负责，执行与授权仍由 Host/Capabilities 负责。

## 交互

用户消息悬停或聚焦时显示 Trace 卡片。卡片支持：

- 将原始文本、图片和文件引用放回输入框继续调整；
- 打开详情抽屉中的“输入历史”，查看当前已加载 Thread 的用户输入；
- 通过 Project/Thread/Turn 识别输入所属作用域。

输入历史复用 App 已加载的 Session/Thread 投影，不新增 REST/WebSocket
接口，也不在 SidePanel 维护第二份运行权威。历史投影没有保存提交时设置时，
界面显示“历史设置未记录”，不会用当前配置冒充历史值。历史附件字段同样
按是否真实存在区分“无附件”和“历史投影未提供明细”。

## 生命周期边界

实时发送的用户消息先显示 `Turn: 提交后分配`，收到 `_turn_submission` 后将
服务端 Turn ID 回填到同一条消息的 Trace。切换、创建、派生或关闭 Thread 时，
Trace 视图焦点和待关联消息 ID 与其它 Session 投影一起清理，避免跨会话串用。

“调整输入”只更新 Composer 草稿，不自动重发；当前会话的只读和运行状态仍由
原有发送路径检查。输入历史展示的是当前已加载的有界投影，完整对话仍在主消息流
中查看。

## 验证

- `frontend/src/tests/InputTrace.test.jsx` 覆盖实时作用域/策略、历史字段缺失、
  Trace 卡片调整和 Thread 历史调整入口；
- `npm run lint`、`npm test`、`npm run build` 通过。

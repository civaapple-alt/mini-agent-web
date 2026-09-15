# Thread/Session 停止、派生与 Attach 竞态

## 结论

本轮检查确认，执行权仍由 App Server worker 和 Host/Capabilities 持有；Gateway
只维护连接、流和审批桥接。控制命令按以下边界收敛：

| 场景 | 处理 | 终态依据 |
| --- | --- | --- |
| `turn/interrupt` 已接收 | 发布 `runtime/status.phase=stopping`，继续保留流和 active Turn | 同一 `turnId` 的 `turn_finished` |
| 停止与审批竞争 | 先失效当前 Turn 的审批，迟到请求拒绝；已接受的审批不被反写 | App Server 的 Turn 结算 |
| 运行中 `thread/fork` / `session/fork` | worker 返回 busy，不复制未结算消息、工具或审批 | 源 Thread 空闲后的新请求 |
| 派生先于停止 | 派生按命令进入 worker 的顺序处理；运行中仍拒绝 | 原命令的 action 结果 |
| 本 Gateway 内 `attach` | 复用现有 Client，并返回本地 active Turn 标识 | live Client 与 canonical Session |
| 外部进程持锁 `attach` | 返回只读锁信息，不抢锁、不创建第二个 writer | SessionStore lock |

## 根因

`turn/interrupt` 的 JSON-RPC 响应只表示协作式停止请求已经被 worker 接收，
不表示工具、审批回调、模型调用和 checkpoint 已经结束。Gateway 原先在收到成功
响应后取消自己的流任务，导致 active Turn 过早消失；如果工具审批还在收尾，页面
就可能出现“停止按钮消失但运行仍未结算”的分裂状态。

## 实现

- App Server 增加 `RuntimePhase::Stopping`。同一 Turn 进入该阶段后，迟到的审批、
  工具或模型阶段不能把运行状态回退为可运行阶段；只有 `Completed` 或 `Failed`
  终态可以结束该阶段。
- worker 在接受精确 `turnId` 的取消时记录停止标志并发布 stopping；监听器在
  终态前保持该阶段，仍按原顺序持久化和发送最终事件。停止后新的 steer、follow-up
  和运行时 mutation 会被拒绝，避免被悄悄排到已取消 Turn 之后。
- Gateway 的 HTTP/WebSocket 停止路径不再因“请求已接受”取消流任务；失败仍保留
  active 状态并允许重试。真实 `turn_finished` 负责清理流和 UI 身份。
- `session/fork` 在准备 checkpoint 前再次检查源 Thread 状态，避免未来调用路径
  绕过 worker 的运行中保护。
- `attach` 成功响应增加 `active_turn_id` 与 `turn_active`，让重新打开或第二个
  浏览器可以沿用同一运行身份；外部锁响应保持只读且使用一致字段。

## 不在本轮改变

- 不新增 REST/WebSocket endpoint，不把 Gateway 的活动表变成执行权威。
- 不取消 cooperative stop；工具仍只在安全边界停止，已发生的副作用不回滚。
- 不把 `thread/fork` 改成独立 Session；Web Studio 的独立分支仍使用 `session/fork`。

## 验证

- App Server `mini-agent-app-server`：56 tests passed；新增停止阶段断言。
- Gateway：新增“停止确认不取消流任务”以及本地 attach 返回 active Turn 的回归测试；全量 129 tests passed。
- Frontend：新增远端 stopping 状态模型测试；Node/Vitest 共 52 tests passed。
- 文档同步：`mini-codex/docs/app-server.md`、`mini-agent-web/docs/troubleshooting.md`。

## 后续观察

若 App Server 进程在 stopping 阶段异常退出，Gateway 应按既有 runtime EOF/reconnect
流程显示恢复态，并以 SessionStore canonical history 对账；不能用 Gateway 自己的
“停止请求已发送”推断完成。多项目、多 Thread 的控制仍以
`projectId + threadId + turnId` 进行隔离。

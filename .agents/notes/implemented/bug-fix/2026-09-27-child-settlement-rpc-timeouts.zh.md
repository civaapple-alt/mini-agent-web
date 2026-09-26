# 子任务结算观察超时与 WebSocket 背压

## 问题

Gateway 在等待子 Turn 结算时，单次 `turn/read` JSON-RPC 超时会作为普通 `ServerProcessError` 向外抛出。
`_wait_for_child_turn` 随后清除该子 Session 的活动 Turn 登记并尝试排空队列，即使 App Server 中的 Turn 可能仍在运行。
另一个阻塞点是 Python SDK 的 stdout 读取循环会等待 Gateway 通知回调；回调又同步等待 WebSocket `send_json`，
慢浏览器连接因此可能延迟同一 App Server stdout 上后续 RPC 响应的处理。

## 决策与实现

- 用 `AppServerRequestTimeoutError` 区分单次 JSON-RPC 请求超时与 App Server 进程退出。`wait_for_turn` 在自己的有界等待窗口内重试 `turn/read`，窗口结束后返回既有的 `TurnTimeoutError`；Gateway 保持对子 Turn 的等待与活动登记，不把观察超时投影成终态。
- WebSocket Broker 对并发连接并行发送，按连接串行化写入，并限制单次发送和关闭时间。发送超时或失败的连接会被移除，客户端通过现有事件回放与持久化活动恢复。
- App Server 拒绝或进程退出仍走原错误路径；队列控制请求失败仍由既有的限次调度重试处理。

## 证据边界

触发问题的日志包含 `turn/read` 与 `session/control` 请求超时。代码路径证明这些读取超时此前会被按结算失败处理，
且 WebSocket 回调确实处于 stdout 响应读取之前。现有日志没有记录 WebSocket 发送耗时，因此无法确认这次是否由慢浏览器连接触发；
本次修改补充了慢连接超时日志，便于下一次运行确认。

## 验证

实现后执行 Python SDK 与 Gateway 的静态检查和语法检查；未调用真实 Provider。未运行自动化测试。

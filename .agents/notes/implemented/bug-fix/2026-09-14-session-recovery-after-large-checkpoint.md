# 停止超时与大 Session 重启恢复

## 现象

用户在 `blender-intro/default` 会话中点击停止后，页面长时间停留在“停止中”。重启
Web Gateway 后，`GET /api/threads/default/events?after_sequence=0&project_id=blender-intro`
对应的会话无法加载。

## 根因

- 该 Session 的 `session.jsonl` 约 8.59 MB，最大 checkpoint 行约 500 KB；App Server 的
  SessionStore 上限是 32 MB，Gateway catalog 却用 8 MB 作为整体过滤上限。
- Python SDK 创建 asyncio 子进程时使用默认 64 KiB `StreamReader` 行限制。合法的
  checkpoint JSON-RPC 响应超过该限制后，stdout 读取失败，停止/读取请求只能等到通用超时。
- Gateway 进程重启时看不到被 8 MB 上限隐藏的旧 Session，于是新建空 Session 并更新
  `thread_index.json`，从而遮蔽了旧历史。

## 决策

- Gateway catalog 的 Session 总大小上限与 App Server 32 MB 上限对齐；单条大 checkpoint
  继续只投影有界历史，不把完整模型上下文复制到 Gateway 响应。
- SDK 的 stdout/stderr 子进程流使用 2 MiB 有界行限制，覆盖 512 KiB Session record
  加 JSON-RPC envelope，同时保留上限，异常超大输出仍会 fail closed。
- 如果 index 指向一个没有 Turn/消息历史的空 Session，catalog 在同一 workspace/Thread
  中选择历史最完整的可读 Session；锁状态不被隐藏，后续 attach 仍由 App Server 判定。
- SDK 读管道发生 EOF/异常时回收失联进程，client pool 不再复用 `is_running=false` 的
  客户端。Gateway 不写入 SessionStore 文件，恢复后的正常 resume 由 App Server 继续维护
  index 权威。

## 验证证据

- 新增 catalog 测试覆盖 index 指向空 Session 时恢复旧历史和 Session path。
- 新增 SDK 测试覆盖 stdout 失败后的进程回收，以及子进程流行限制大于 Session record
  边界。
- 新增 client pool 测试覆盖失联 SDK client 的替换。


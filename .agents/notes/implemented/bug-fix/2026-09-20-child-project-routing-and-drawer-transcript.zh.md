# Child Session 项目路由与运行详情消息流

- status: implemented
- date: 2026-09-20

## 现象

`apple-2016` 的父 Session `s-1a0b37cb4f6-a3b4-0` 委派的六个子 Session 被 Web Studio 项目索引登记到 `memory-card`。
运行详情中的“打开”复用了全局会话选择回调，因此查看子 Session 会替换主消息流。

该父 Session 的模型请求还遇到 Windows `os error 10053`：请求正文写入期间连接被中止。日志无法确定是本地代理、VPN、安全软件、网络路径还是远端关闭连接，也无法证明服务端未收到请求。由于可能发生重复计费，发送阶段的歧义故障不自动重放。

## 根因与决策

`ClientPool.fork_thread` 虽然按显式项目 ID 取得了正确的父客户端，但随后先从未限定的 `_client_projects[source_thread_id]` 推导项目。跨项目同名的 `default` 线程会让这个兼容映射指向当前项目，造成 child metadata、child client cwd/runtime 和客户端绑定使用错误 Project。

创建 child 时先通过 `_project_for_thread(source_thread_id, project_id)` 解析规范项目，再把同一 ID 用于父客户端选择、fork 投影、子客户端创建和绑定。子 Session 继承父 Session 的规范 Project。

子 Session 查看改为运行详情右侧抽屉内的只读 transcript。读取通过带显式项目 ID 的 canonical history 与 ThreadItem API，不 attach 子会话、不更改父会话选择。运行中的子任务每 3 秒刷新；ThreadItem 按 128 项读取，支持向前分页。

## 既有数据修复

核对六条索引记录的 `parent_session_id` 和实际 `session.jsonl` 路径后，将它们从 `memory-card/threads.json` 迁回 `apple-2016/threads.json`。六个 Session 日志和 operation 记录未改动。修改前索引备份位于：

`C:\Users\alwar\AppData\Local\Temp\mini-agent-child-project-index-backup-20260920`

Gateway 下次启动时按父项目恢复 queued child operation。

## 网络错误恢复

`os error 10053` 是发送期间的连接失败，没有可靠证据表明请求未被服务端处理。保持 checkpoint，并在同一 Thread 继续推进；不把该故障当作建连失败自动重试。Windows 排查说明补入 `mini-codex/docs/troubleshooting.md`。

## 验证

- `npm run lint`：通过。
- `npm run build`：通过；Vite 提示现有 bundle 超过 500 kB。
- 未运行或新增测试。
- 直接核对两个项目索引，确认六条 child metadata 仅存在于 `apple-2016`，且 Session 路径仍在原位置。

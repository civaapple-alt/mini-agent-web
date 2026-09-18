# 定时任务

“定时任务”是模型可见的、有界延时唤醒标记，不是后台 Shell，也不是通用
Scheduler。模型调用 `scheduled_task` 创建一个 `task_id` 和延时；当前 Turn
立即结束。到期后任务变为 `ready`，下一轮模型读取它，再执行一次远程状态查询，
例如查询 GitHub Action。系统不会在到期时自动执行 Shell、自动发送模型 Turn，
也不会凭空取消远程任务。

这解决了模型用 `sleep 30` 占住当前 Turn、导致 `steer` 或手动停止排队的问题，
同时保持远程操作和本地进程的边界清晰：

```text
BackgroundShellTask = 本地进程及进程组生命周期
ScheduledTask       = 下一轮可继续查询的有界时间标记
```

允许的动作是 `create`、`list`、`read` 和 `cancel`。第一版只支持 delay 触发，
延时范围为 1 秒至 24 小时；取消只取消本地等待标记，不取消 GitHub Action、云端
构建或部署。Child Session 可以读取父 Thread 的标记，但不能创建或取消。

相关 REST 接口：

```text
GET  /api/threads/{thread_id}/scheduled-tasks
GET  /api/threads/{thread_id}/scheduled-tasks/{task_id}
POST /api/threads/{thread_id}/scheduled-tasks/{task_id}/cancel
```

运行面板展示任务状态、用途摘要和剩余时间。状态来自 App Server runtime 的权威
记录；Gateway 和前端不维护第二份调度状态。runtime 关闭时，未完成的标记随该
runtime 清理；第一版不做重启恢复、Webhook、供应商适配器或自动模型续跑。

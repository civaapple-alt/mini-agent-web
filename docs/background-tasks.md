# 后台 Shell 任务

Web Studio 的“后台任务”只表示由当前主 Thread runtime 托管的本地 Shell 进程，
例如 Web、Backend 或 Dev Server。它不是通用 Service Registry，也不提供健康检查、
端口声明、Scheduler 或隐式自动重启。

Agent 通过 Shell 的显式后台模式创建任务。Turn 完成、runtime idle 和页面切换不
会停止它；后续 Turn 可以读取状态和有界日志，并显式请求停止或重启。主 Thread
runtime 关闭时，App Server 负责清理完整进程组。Web Studio 的运行面板只投影
App Server 的权威结果，不维护自己的进程注册表。

Child Session 可以读取父 Thread 的后台任务，但不能创建、停止或重启。修改代码后
是否重启由模型或用户显式决定，第一版不会从文件变更自动猜测。

运行面板和模型工具控制同一份任务状态。重启会替换当前 PID 和日志尾部，系统不保留
每次运行的完整历史，也不记录由模型还是运行面板发起；仅凭 PID 或启动时间变化不能
判断是谁重启的。

GitHub Actions、云端构建、部署状态和其他没有本地进程的长时间等待不属于后台
Shell 任务。`ScheduledTask` 只记录延时，不会自动启动下一轮模型；只有用户或 Host
明确启动后续 Turn 时，它才可作为查询时间的提示。停止标记不等于取消远程操作。
详见 [`scheduled-tasks.md`](scheduled-tasks.md)。

相关 REST 接口：

```text
GET  /api/threads/{thread_id}/background-tasks
GET  /api/threads/{thread_id}/background-tasks/{task_id}
GET  /api/threads/{thread_id}/background-tasks/{task_id}/logs
POST /api/threads/{thread_id}/background-tasks/{task_id}/stop
POST /api/threads/{thread_id}/background-tasks/{task_id}/restart
```

列表和详情只返回有限命令摘要、命令 hash、工作目录、PID、状态、退出码以及有限
日志尾部。完整 Shell 命令不会被 Gateway 的后台任务日志重复打印。

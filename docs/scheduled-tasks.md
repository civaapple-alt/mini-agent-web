# 定时任务

`scheduled_task` 创建和读取的是 runtime 内存中的有界延时标记，不是会自动唤醒
Agent 的 Scheduler。创建标记不会等待、不结束当前 Turn，也不会在到期时唤醒或续跑
Thread、查询远程任务或执行 Shell。

本地长驻进程（例如 Web 或 Tauri Dev Server）使用后台 Shell，并通过 `status` 和
`logs` 查看；不要为后台 Shell 创建 `scheduled_task` 轮询标记。远程任务（例如 GitHub
Action 或云端部署）只有在用户或 Host 会显式启动后续 Turn 时，才适合创建延时标记，
供后续 Turn 知道何时读取状态并调用对应的远程查询工具。

```json
{
  "action": "create",
  "task_id": "check-action",
  "delay_seconds": 300,
  "summary": "后续检查 GitHub Action 状态"
}
```

runtime 不运行计时 worker；标记的到期状态会在下一次 `create`、`list`、`read` 或
`cancel` 时刷新为 `ready`。`ready` 只表示延迟已到，不代表远程任务完成，也不会触发
新的 Turn。后续 Turn 必须由用户或 Host 显式启动。

允许的动作是 `create`、`list`、`read` 和 `cancel`。延时范围为 1 秒至 24 小时；`create`
必须提供 `task_id` 和 `delay_seconds`。同一 `task_id` 重复创建会返回原标记，不会修改
已有的到期时间。`cancel` 只取消本地标记，不取消 GitHub Action、云端构建或部署。Child
Session 可以读取父 Thread 的标记，但不能创建或取消。

相关 REST 接口：

```text
GET  /api/threads/{thread_id}/scheduled-tasks
GET  /api/threads/{thread_id}/scheduled-tasks/{task_id}
POST /api/threads/{thread_id}/scheduled-tasks/{task_id}/cancel
```

运行面板展示状态、用途摘要和剩余时间。状态来自 App Server runtime 的权威记录；Gateway
和前端不维护第二份调度状态。runtime 关闭时，未完成的标记随该 runtime 清理；当前不做
重启恢复、Webhook、供应商适配器或自动模型续跑。

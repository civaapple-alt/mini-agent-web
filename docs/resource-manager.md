# 资源管理器

在设置面板左侧的 **运行管理** 下打开 **资源管理**。页面展示当前 Gateway 进程，以及 Gateway 管理的 App Server 和对应 Session。

资源页用一行指标和精简列表显示进程状态、PID、运行时间、内存、CPU 和 JSON-RPC 流量。PID 与运行时间合并在一列，表格每页显示 10 行，并降低行高。选择一行后，详情显示在列表上方，包括历史趋势和 RPC 方法统计。

## 进程采样

页面每 2 秒请求一次 Gateway 快照。每个快照请求采样一次，页面停止轮询后不会继续采样。Gateway 只读取自己的 PID 和 ClientPool 中的 App Server PID，不扫描其他系统进程。进程数据包括 PID、父 PID、CPU、RSS、累计 CPU 时间和运行时长。

CPU 使用进程 CPU 时间增量除以采样间隔和系统逻辑 CPU 数计算。RSS 是进程驻留内存。合计值相加了各进程 RSS，共享内存可能被重复计算。

每个进程最多保留 300 个数值样本，约 10 分钟。样本包括 CPU、RSS、累计 CPU、JSON-RPC 请求和字节速率、错误速率、延迟分位数及待处理请求数。历史只保存在 Gateway 内存，不记录请求正文；停止轮询后，已有历史仍可读取。

休眠后 Session 行仍可查看最近进程的历史样本，直到 10 分钟窗口过期；唤醒后趋势切换为新 App Server 进程的样本。

App Server 的 JSON-RPC 总数和方法统计由对应 SDK Client 从启动时累计。进程重启后计数重新开始。页面不显示操作系统网络流量。Gateway 自身只显示 CPU 和内存。

Thread/Child Session 目录摘要最多每 15 秒刷新一次，资源页最多展示最近更新的 512 条已休眠或历史 Session。运行中的 App Server 每次快照都会合并，因此不会被历史行数上限隐藏。资源页仍每 2 秒刷新进程指标，不会每次轮询都重新扫描 Session 目录。

当系统可用内存低于总内存的 10% 或低于 1 GiB 时，页面显示提醒。提醒不会自动休眠或结束进程。

## 执行和驻留状态

执行状态描述 Thread 当前是否有工作。驻留状态描述 App Server 是否仍在进程中。

| 状态 | 含义 |
| --- | --- |
| `running` | App Server 报告活动 Turn，或 Gateway 正在跟踪活动任务。 |
| `waiting_approval` | Thread 有待处理审批。 |
| `idle` | 已确认当前没有活动 Turn。 |
| `unknown` | Gateway 无法从当前 Session 投影确认活动状态。休眠检查会再次向 App Server 查询，未知状态会阻止休眠。 |
| `loaded` | App Server 进程正在运行。 |
| `idle_grace` | 进程仍在运行，当前没有可见 Thread 查看者，空闲计时已开始。 |
| `checking` | Gateway 正在检查 Turn、审批和后台操作。 |
| `parking` | Gateway 已确认可以停止进程，正在等待优雅退出。 |
| `stopping_unconfirmed` | Gateway 尚未确认进程退出。唤醒请求会等待确认，不会启动替代进程。 |
| `parked` | 没有由当前 Gateway 管理的 App Server 进程。Session 数据保留在 SessionStore。 |
| `external_locked` | 其他进程持有 Session 锁。当前 Gateway 只显示锁信息，不采样或控制该进程。 |
| `blocked` | 休眠被阻止。详情列出活动 Turn、审批、后台任务、子操作或未知状态。 |

多个浏览器打开同一个项目和 Thread 时，共用 ClientPool 中的 App Server。可见 Thread 页面每 15 秒续查看租约，45 秒未续期的租约会过期。隐藏页面、切换 Thread 或断开连接时，Studio 会释放租约。

WebSocket、HTTP Turn 和 SSE Turn 共用同一条 Thread 启动锁：Gateway 收到 App Server 的 Turn ID 并登记为活动状态后才释放锁。项目运行时重启也会暂时关闭新 Turn admission；若 `stop()` 未确认退出，原 Session 保持门禁关闭，重启流程不会启动替代进程。没有受管进程时，手动 Park 只读取追加式 Session 摘要；无法确认 Session 状态时会阻止操作。

最后一个查看者离开后，Gateway 等待 10 分钟再尝试自动休眠。手动休眠使用相同的活动检查。Gateway 会检查活动 Turn、审批、后台 Shell 任务和子操作，并查询 App Server Runtime Status。只有状态已确认空闲时，Gateway 才会关闭标准输入并等待 App Server 优雅退出。

## 休眠和唤醒

点击运行中 Session 行的 **休眠** 可手动休眠。存在查看者时操作不可用；有活动阻塞原因或状态未知时，按钮显示 **重新检查**。Gateway 会重新查询 App Server，只有确认空闲后才会停止进程。

Gateway 通过 SDK 的优雅停止路径关闭 App Server，并保留 SessionStore。若 3 秒内没有确认退出，页面显示 `stopping_unconfirmed`。Gateway 会继续跟踪原进程。在确认退出前，Gateway 不会为该 Session 启动另一个 App Server。

点击已休眠 Session 行的 **唤醒** 会调用现有 Attach 流程。ClientPool 读取原 Session 并以 resume 模式启动 App Server，因此 Thread 和 Session 身份保持不变。被其他进程锁定的 Session 不能从当前 Gateway 唤醒。

## Gateway API

| 请求 | 用途 |
| --- | --- |
| `GET /api/resources` | 获取 Gateway、受管 App Server、Session 状态和系统内存快照，并采样一次。 |
| `GET /api/resources/history?process_key=...` | 读取指定进程最多 10 分钟的样本。 |
| `POST /api/threads/{thread_id}/park?project_id=...` | 安全休眠指定 Thread 的 App Server。响应包含 `status` 和阻止原因 `blockers`。 |

唤醒使用现有 `POST /api/threads/{thread_id}/attach` 接口。App Server JSON-RPC protocol 保持 V2；资源管理没有新增 RPC 方法。

## 本地性能验收

2026-10-06 的本地合成测量使用 Gateway 加 32 个受管进程描述符，采集 300 个完整样本。数值环形缓冲区占 871,200 字节；包含 Python 采样状态的 `tracemalloc` 增量为 1,107,700 字节，峰值为 1,148,621 字节；每次快照平均消耗 1.85 ms Python CPU。该测量用模拟的进程统计对象，不代表真实 App Server 的操作系统采样成本。

同日的 Session 列表测量使用 64 个 Session、每个 1,000 个 Turn、总计 11,310,006 字节的 JSONL。未变化列表轮询平均耗时 4.03 ms、CPU 4.03 ms；清空摘要缓存并重读、重解析全部文件时平均耗时 175.15 ms、CPU 172.11 ms。该本地合成数据测得约 43 倍差异；它不构成接口延迟承诺，实际结果会受磁盘、Session 数量和记录大小影响。

App Server JSON-RPC 诊断默认关闭。设置 `MINI_AGENT_JSON_RPC_DIAGNOSTICS=1` 后可在标准错误中观察读取、解析、分发、队列等待、序列化和写入阶段耗时。一次本地空闲 App Server 测量对比了诊断关闭和开启时各 3 轮、每轮 500 次 `runtime/status`：吞吐中位数分别为 10,724 和 11,025 次/秒，P50 为 0.0921 和 0.0918 ms，P95 为 0.1008 和 0.1015 ms。差异处于批次间波动范围内；这是诊断开关比较，不是协议优化前后对比，也不代表模型请求延迟。

另一轮诊断日志采集了 530 次 `runtime/status`。阶段耗时中位数/P95（微秒）分别为：读取 46/67、解析 1/2、分发 3/4、队列等待 5/8、序列化 4/5、写入 16/27。`read_us` 包含等待下一行输入的时间。v1 没有据此改变 JSON-RPC v2 协议或分发策略；性能优化应在目标环境采集并比较诊断数据后再决定。

## Session 列表读取

`/api/threads` 的 Session 摘要读取使用 Gateway 内存缓存。Session JSONL 未变化时，Gateway 不解析旧记录；追加完整记录时只处理新增记录。文件被替换、截断，或补完末尾的未完成记录后，Gateway 会重建摘要。缓存最多保留 512 个 Session 摘要，不写入 SessionStore。

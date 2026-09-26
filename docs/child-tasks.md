# 代理子任务

委派任务由父 Session 管理。每个父 Turn 的委派任务在消息流第一次出现的位置汇总为一张
批次卡，批内任务各自显示名称、执行模式、生命周期和最近的有界进展报告。
`delegate_task` 使用父 Session 内唯一的 `child_key`；Capabilities 从父 Session ID
和 key 派生 canonical `child_thread_id` 并返回给主线程。不同父 Session 可以复用相同 key，
会得到不同的子 Thread。标题只用于展示，可以重复；子任务范围只属于创建它的 main Session。
Gateway 会先按父 Turn 和工具调用 ID 持久化有界 `tool_started` 参数，再与成功结果配对；
结果不重复回显提示词，因此 32 KiB 上限的委派提示不会被 16 KiB 工具输出限制截断。

## 消息流与状态

任务状态来自 App Server 持久化的 Session operation。Gateway 的
`child_operation_updated` 事件用于及时刷新投影，不是另一份状态账本。刷新或重新打开父会话后，
消息流和“子智能体”页会从同一份 operation/report 投影恢复状态。若终态 operation 快照缺失，
`task_list`、`task_read` 和 WebStudio 会用匹配的 `turn_settled` 恢复状态；`task_read` 还会从该 Turn
的最终 assistant item 恢复有界结果。匹配的 `turn_settled` 优先于仍停在 `pausing` 或 `cancelling`
的控制快照：暂停请求遇到已中断 Turn 时投影为“已暂停”，停止请求投影为“已取消”；若 Turn 在控制
生效前已完成或失败，则保留 Turn 的真实终态。这样重启恢复不会对已结算的 Turn 重放中断。

排队 operation 没有当前 Turn；Gateway 不会用同一 Child Session 上一次 attempt 的 Runtime phase
覆盖排队状态。对持久化为活动状态的 operation，Gateway 只有在 Runtime 返回的 Turn ID 与 operation
当前 Turn ID 相同且 phase 仍活动时才确认运行、占用并发槽或重放暂停/停止。Runtime 明确不匹配时，
任务显示为“需要处理”，释放并发槽并隐藏无法作用于旧 Turn 的控制按钮；Gateway 不会自动中断或重启
该 Turn。用户可查看诊断并决定后续处理。

子代理可用 `task_report` 报告有界进展。父代理通过带游标的 `task_read` 读取报告，使用有界分页
`task_list` 查询所有子任务摘要，并可用 `task_control` 修改或停止排队任务、steer 或停止运行任务、
暂停并继续任务、重试失败或取消的任务、排队一条后续指令、取消顺序组；需要新增方向时继续使用
`delegate_task`。每项控制都携带 `child_thread_id`、`operation_id` 和预期 `attempt`，Gateway 会拒绝
已经过期的 attempt。完整工具活动和 transcript 留在各自子 Session，不复制到父消息流。
`reports` 仅包含显式 `task_report` 进展；空报告列表不表示最终回答缺失。

父代理可在子任务运行期间多次 steer 同一个子 Session。父代理提交 `task_control.assign` 后，Gateway
按持久状态自动路由：运行中或等待审批时，使用当前 Turn 的 steer；报告后仍在运行的任务也继续 steer
当前 Turn。子任务成功完成后，assign 会在原 child Session 上创建新的 follow-up Turn，供原子代理处理评审意见，
不创建替代 Session。活动任务最多保留一条待执行后续指令；达到上限会明确拒绝，不覆盖已排队指令。
当前 attempt 成功后，后续指令以同一 operation 的新 attempt 启动；若当前 attempt 失败，指令保留为受阻状态，
待用户或父代理重试成功后再启动。取消当前任务时同时取消待执行后续指令。请求最多 32 KiB，并用稳定 request ID 去重。
若 `turn/steer` 返回 `status: "pending"`，Gateway 会将路由标为 `steer_pending` 并保留服务端原因。
这表示请求结果尚未确认，指令可能已提交，也可能未提交。Gateway 不会自动重发该请求 ID；父代理应先刷新权威子任务和 Turn 状态，再决定后续操作。

暂停通过协作式中断当前 Turn 请求。面板先显示“暂停中”；只有 App Server 确认 Turn 已结算后，任务才变为“已暂停”并释放并发槽位。继续操作复用原 child Session、operation 和 attempt，不计为重试。停止活动任务也会先显示“停止中”，并在结算后释放槽位。Gateway 重启后会按持久 control request 和 Turn 状态恢复这两种处理中状态。

初次执行、失败重试和完成后的 follow-up 共用稳定的 child Thread、Session 与 operation ID；每轮 attempt 带有
`initial`、`retry` 或 `follow_up` 类型。`retry` 仍只接受失败、取消或步数受限的任务，并沿用该 attempt 保存的
提示词。排队项继续通过 `update_queued` 修改。follow-up 遇到并发上限或顺序组阻塞时持久排队，释放槽位后自动启动。
提示词更新后，Gateway 会立即尝试排空可运行的排队任务。
列表和消息流对每个 child Session 保持一张卡，卡内显示各轮状态、当前阶段、最新进展、顺序组位置和恢复异常。

默认最多同时运行 2 个子任务，项目设置可调整为 1–8 个。超出并发槽位的任务会先创建并持久化为
“排队中”，有任务结束后自动启动；任务提示可以包含普通换行和制表符，单条提示仍限制为 32 KiB。
父代理优先读取运行中或已结束且拥有 Session 的任务。排队任务会自动等待空位，不需要反复查询；
创建 Session 前失败的任务只从 operation 投影读取状态和诊断，不调用 `task_read`。
若 Gateway 在 follow-up 持久化后丢失 RPC 响应，它会用 operation、attempt 和 `control_request_id` 识别已排队的轮次并继续排空，不会再创建一轮。暂时性启动错误会触发合并的限次退避重试；Gateway 重启时也会重新扫描持久队列。
Gateway 重启时会重新连接同一父 Session 下的活动子任务，并排空 App Server 已持久化的排队 operation。
Gateway 只重试 `parent_session_id` 与当前父 Session 相同的 `pending` 委派回执；缺少 Session 身份或属于旧 Session 的回执不会重放。
`materialized` 表示 App Server 已接收 operation，恢复时由 operation 状态负责续接，不会再次创建或启动子任务。
如果 App Server 返回 `not_submitted`，Gateway 会通过 `cancel_queued` 结束仍处于排队状态的 operation，保存拒绝原因，并唤醒父 Session。若取消失败，子任务仍显示权威的排队状态，同时显示保存的拒绝原因。

报告和终态会合并为父会话的待处理唤醒。父 Turn 运行时，Gateway 只更新持久状态和批次卡，
不发送 `steer`。父 Turn 结束后，Gateway 合并待处理更新并启动一轮带
`turnSource: "child_wakeup"` 标记的续行。更新在续行期间到达时，会留到下一轮结束后处理。
批次卡显示子任务状态；自动续行来源显示在 Turn 轨道，不会显示为用户消息，也不会产生
steer 提示。Gateway 重启不会重放尚未送达的待处理唤醒，但报告仍留在子 Session，
父代理可以在后续 Turn 读取。

Gateway 按父 Session 合并唤醒。待处理队列最多保留 64 个不同子任务的最新状态；每轮最多把 16 个子任务
交给父代理。超出单轮容量的更新会留待下一轮；队列达到上限时，Gateway 合并后续更新的数量，
并保留最多 8 个示例 ID。父代理可依据示例和已知任务 ID 调用 `task_read` 查看权威状态。
Gateway 通过同一 Session 的启动锁串行化用户 Turn 与自动续行，避免两者同时通过空闲检查。

## 主会话停止与恢复

主线程的“停止”冻结整个父 Session，而不只是当前 parent Turn。Gateway 先让 App Server
持久化 `freezing`，再协作式中断 parent Turn、暂停活动子任务。排队任务保留原 operation 和
attempt，不启动新任务。冻结完成后状态变为 `frozen`。Gateway 重启后按持久状态继续结算冻结，
不会因子任务完成、子报告或队列重试而自动开启 parent Turn。

只有用户明确点击“继续整个会话”才会进入 `resuming`。继续时恢复由 `parent_freeze` 暂停的
子任务，排空原队列，并以 `session_resume` Turn 恢复 parent 进度。用户面板或 main agent 单独
暂停的子任务不会被父会话 Continue 自动恢复；用户单独停止的子任务保持取消。单个子任务操作会
持久记录 `control_source`，用于区分 `user_panel`、`main_agent` 和 `parent_freeze`。

子任务报告与控制竞态时，报告正文仍写入子 Session。每条报告在状态投影中显示“待主线程读取”
（`reported`）；父代理的 `task_read` 成功返回报告后，父 Session 会写入有界、可重放的读取回执，
并投影为“主线程已收到”（`main_received`）。停止期间收到的报告不会唤醒冻结的 parent；用户继续后，
parent 从现有报告与任务状态恢复，不会因重复读取产生额外报告或重复任务。

## 运行面板与会话入口

右侧抽屉的“子智能体”顶层页显示父会话的全部子任务，包括排队、运行、完成、失败和取消项。
列表优先显示需要处理的审批、失败、未开始任务和恢复异常，然后显示运行中及排队任务；顺序任务按组内步骤排列。
完成和取消项默认收起并分页。选择任务后，详情仍在该页中打开，
可以返回列表；返回后保留已结束任务的展开状态和已加载页数。切换父 Session 或项目时重置列表展开状态。
数量摘要用颜色区分运行、排队、待处理和已结束，并显示总数。任务默认以紧凑行展示标题、状态、耗时和阶段/进展；排队项展示阻塞或等待原因，恢复异常和失败会在摘要中给出诊断提示。
展开任务后再查看尝试历史、完整进展报告、等待原因和错误详情。存在对应子 Session 时，可从任务行进入只读消息流，不切换主会话或运行状态页。

运行面板与主线程工具调用共享 Gateway 控制执行器，面板不维护第二份子任务账本。停止是任务行上的快捷操作，提交前需确认；暂停、steer 和“排队后续”放在展开行的“更多操作”中。排队项可修改提示词；暂停项可继续；失败或取消后可在同一 Session 重试。
提交后显示服务端确认结果。处理中状态由持久 operation/control request 投影恢复；请求过期、启动拒绝或后续队列已满时，
面板显示服务端原因，保留当前权威状态并要求刷新或重新选择操作。

详情抽屉可吸附在主会话右侧，也可作为覆盖浮层打开。偏好会保存在当前浏览器；窗口宽度低于
1200 像素时，抽屉使用浮层布局以保留可读的主消息流。

子会话详情只显示该子 Session 自己持久化的活动项和各次 Turn。fork 时继承的父 checkpoint
继续作为子代理模型上下文，但不作为子代理消息流显示。旧 Session 没有本地活动项时显示明确的空态。
运行中的任务突出当前阶段、最新报告、耗时和最近活动；已结束任务突出终态、最终回复或失败诊断、
总耗时。详情明确分隔同一 Session 上的初始执行、重试与后续 Turn。运行中的子 Session 每 3 秒刷新一次最近活动；
活动列表按 128 项分页，可向前加载。
子会话内容按子任务投影中的 `project_id` 读取；旧投影缺少该字段时使用父会话的项目身份。
创建 Session 前失败的任务仍显示为失败项，但没有无效的打开入口。

事件回放缺口后，WebStudio 以 Runtime 快照校正本地流状态：活动快照保留匹配当前 Turn 的流块，
已结算快照冻结残留的思考和文本流块。思考耗时只在流块进入活动状态时启动，在结算时冻结，页面持续打开
不会继续累加已结束 Turn 的时间。

项目侧栏隐藏委派子 Session，避免子任务挤占普通会话列表。Session 历史和直接导航仍然保留；普通用户派生的会话继续显示在项目列表中。

子 Session 继承父 Session 的规范 Project。Gateway 创建 fork、写入项目元数据、创建子客户端和绑定客户端时，
都使用同一个 project-qualified `(project_id, thread_id)`。对于 `default` 这类跨项目同名 Thread，
未限定的兼容客户端映射不能决定子任务归属。Gateway 启动恢复时会按父项目重连活动任务并排空持久化队列。

## 排查

若消息流与运行面板暂时不一致，刷新父会话和“子智能体”页。没有“打开”入口
通常表示 Child Session 尚未创建，请查看失败项的诊断信息。Gateway 重启后仍能读取已持久化报告；
没有自动续行时，可在后续 Turn 让父代理调用 `task_read`。

父 Turn 运行期间收到子代理报告时，Gateway 不会通过 `steer` 打断父 Turn。批次卡和子任务页会先更新，
父 Turn 结束后再合并续行。若页面仍因子代理报告显示纠偏提示，请检查是否运行旧版 Gateway。
内部报告和自动续行不发送 `steer`；手动 steer 只在收到 `steer_ack` 后显示一次确认。

如果子任务出现在错误的项目下，先核对子 Session 的 `parent_session_id` 和 `path`。它们应分别指向当前父 Session，
以及父项目对应的 Session 目录。更新 Gateway 后重启服务以加载修正后的项目元数据和恢复队列；不要把子 Session
日志文件手工移动到另一个项目目录。

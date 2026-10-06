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

子代理只在有实质进展或遇到阻塞时用 `task_report` 发送简短更新；最终交付留在正常的 assistant 最终回答中，
自然说明结果、依据、未完成项和不确定处，不要求固定格式。父代理通过带游标的 `task_read` 读取报告和有界结果，
并对照委派目标做轻量复核。`operation.status` 表示该 attempt 的执行结果，不代表内容已符合要求；任务仍在运行时，
缺少最终回答不算缺口，父代理根据最新报告决定等待或处理具体问题。任务结算后，发现明确缺口时用
`task_control.assign` 在同一子 Session 中给出具体追问；结果满足目标时就总结结果及其依据，并说明剩余不确定性。
父代理使用有界分页 `task_list` 查询所有子任务摘要，也可用 `task_control` 修改或停止排队任务、steer 或停止运行任务、
暂停并继续任务、重试失败或取消的任务、排队一条后续指令、取消顺序组；需要新增方向时继续使用 `delegate_task`。
每项控制都携带 `child_thread_id`、`operation_id` 和预期 `attempt`，Gateway 会拒绝已经过期的 attempt。完整工具活动和
transcript 留在各自子 Session，不复制到父消息流。
`reports` 仅包含显式 `task_report` 进展；空报告列表不表示最终回答缺失。
`task_list` 和 `task_read` 会把 operation 状态、该 attempt 对应的 `turn_outcome`、以及
子 Session 的 `latest_session_turn` 分开返回。后续 Turn 完成不会把较早的失败 attempt 改成成功；
主线程应以 `operation.status` 判断任务结果，并结合 `operation.turn_outcome.stop_reason`、`steps`
和 `operation.error` 定位失败原因。

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
child operation Turn 使用 main“连续执行”相同的 loop profile：`max_steps=0` 并允许上下文压缩。它会在同一个 Turn
内持续运行到最终回答、失败或明确的控制请求；活动 Goal 显式设置的里程碑步数预算仍优先。当前 WebStudio 子任务路径
没有五分钟总时限。Gateway 的 SDK 等待窗口为 60 秒，超时后会继续轮询同一 Turn。显式预算导致步数耗尽时，operation
会显示 `step_limit`、实际步数和诊断，不会静默开启另一个 Turn；父代理可决定是否重试。
运行中的 child task 接受 steer 后会在同一个 Turn 继续处理，operation 不会因这次 steer 提前失败。
单次 `turn/read` JSON-RPC 请求超时只表示暂时无法观察状态；SDK 会在 60 秒等待窗口内重试读取，
窗口结束后 Gateway 继续等待同一 Turn。它不会仅因一次读取超时就清除活动登记、释放并发槽或把子任务标成终态。
如果 WebSocket 消费端持续无法接收事件，Gateway 会在有界发送超时后断开该连接；客户端重连后从有界事件回放和持久化活动恢复。

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
批次卡显示子任务状态；自动续行不会作为用户消息显示。Turn 轨道和对应回复会标记
“子代理更新”，并在子任务信息可用时显示相关子任务名称。子 Session 消息流会把父会话
发来的 steer 标为“主会话中途纠偏”，并与初始任务分隔。Turn 活动时，详情页读取
`turn/read`，在 steer 写入活动历史前显示它；
历史项到达后，页面会合并两者，不重复显示。Gateway 重启不会重放尚未送达的待处理唤醒，但报告仍留在子 Session，
父代理可以在后续 Turn 读取。

Gateway 按父 Session 合并唤醒。待处理队列最多保留 64 个不同子任务的最新状态；每轮最多把 16 个子任务
交给父代理。超出单轮容量的更新会留待下一轮；队列达到上限时，Gateway 合并后续更新的数量，
并保留最多 8 个示例 ID。父代理可依据示例和已知任务 ID 调用 `task_read` 查看权威状态。
Gateway 通过同一 Session 的启动锁串行化用户 Turn 与自动续行，避免两者同时通过空闲检查。

## 主会话停止与恢复

输入栏的“停止本轮”只中断当前 parent Turn。结算后会话仍可接收新指令；活动子任务继续运行，
其完成或报告可能唤醒 parent。Gateway 用同一 Session 的启动锁串行化用户 Turn 与自动续行。
停止后发送“继续”或补充内容会基于现有会话历史启动一个新 Turn；若要恢复原 Turn 的执行检查点，
请使用该 Turn 提供的“继续当前 Turn”操作。

若要暂停整个工作流，在子任务面板选择“停止整个会话”。Gateway 先让 App Server 持久化
`freezing`，再协作式中断 parent Turn、暂停活动子任务。排队任务保留原 operation 和 attempt，
不启动新任务。冻结完成后状态变为 `frozen`。Gateway 重启后按持久状态继续结算冻结，不会因子任务
完成、子报告或队列重试而自动开启 parent Turn。

只有用户明确点击“继续整个会话”才会进入 `resuming`。继续时恢复由 `parent_freeze` 暂停的
子任务，排空原队列，并以 `session_resume` Turn 恢复 parent 进度。用户面板或 main agent 单独
暂停的子任务不会被父会话 Continue 自动恢复；用户单独停止的子任务保持取消。单个子任务操作会
持久记录 `control_source`，用于区分 `user_panel`、`main_agent` 和 `parent_freeze`。

已处于 `frozen` 的会话仍需显式继续；普通停止的新行为只影响后续停止操作。

恢复工作由 Gateway 的独立任务执行，不依赖发起请求的浏览器连接。页面刷新或 Gateway 重启后，读取
到持久化 `resuming` 状态会按原 request ID 接管一次未完成的恢复；重复读取共享同一个活动任务。若恢复
仍返回错误，状态保持可重试，输入区和运行面板提供“重试恢复”入口。

子任务报告与控制竞态时，报告正文仍写入子 Session。每条报告在状态投影中显示“待主线程读取”
（`reported`）；父代理的 `task_read` 成功返回报告后，父 Session 会写入有界、可重放的读取回执，
并投影为“主线程已收到”（`main_received`）。停止期间收到的报告不会唤醒冻结的 parent；用户继续后，
parent 从现有报告与任务状态恢复，不会因重复读取产生额外报告或重复任务。

## Main 与 Child 的执行检查点

Session checkpoint 保存已结算 Turn 的对话上下文，供后续 Turn 和 Child fork 使用。Execution checkpoint 保存当前逻辑 Turn 的输入、模型上下文、阶段和下一步位置，供同一个 Turn 接续。Main 与每个 Child 都把 execution journal 追加到各自的 App Server SessionStore。

App Server 在每次模型请求前和整批工具完成后保存 execution checkpoint。工具批次记录意图、每个工具调用的开始和结果。重启后，已记录的工具结果可供恢复复用；工具已开始但没有记录结果时，任务进入“待核对”，不会自动重放该调用。

服务重启、模型暂时错误或采样停滞不会自行启动恢复执行。持久化的活动 Turn 会显示为“停滞待继续”，并显示阶段与最近进展时间。用户通过“继续当前 Turn”从最新 checkpoint 恢复原 Turn。`turn/read` 的 `in_progress` 只表示执行尚未结算；Gateway SDK 会继续读取，直到收到终态或等待超时。恢复请求绑定原 Turn ID、checkpoint 序号和稳定 request ID，不会创建新 attempt。

App Server 每 10 秒记录一次执行器心跳。Responses provider 在 120 秒没有收到 provider 数据时结束当前采样并等待用户继续；识别出的暂时传输错误、不完整流和 HTTP 408、429、5xx 响应会按 1、2、4、8 秒退避，最多 5 次且总窗口不超过 120 秒。失败采样段的部分事件不会并入恢复后的回答。

`turn/read` 和子任务投影提供有界的恢复状态、阶段、最后心跳和进展时间、checkpoint 序号及原因；运行中的 Turn 也可读取当前恢复快照。所有未知调用核对完成前，App Server 拒绝 `turn/resume` 和覆盖该 checkpoint 的新 `turn/start`。运行面板刷新或重新连接只重建这些状态，不会启动恢复请求。Main 对话区和 Child Session 详情都通过 `turn/reconcile` 记录人工决定：`completed` 要求提交有界结构化结果，`not_executed` 确认副作用未发生并允许后续显式恢复。请求绑定 `turnId + checkpointSeq + toolCallId + requestId`；相同请求幂等，旧 checkpoint 或冲突 request ID 会被拒绝。核对只更新 App Server 的 execution journal，不会自行执行工具或恢复 Turn；全部核对后，用户仍需显式使用 `turn/resume`。

Studio 会先让用户选择“已执行并成功”、“已执行但失败”或“确认尚未执行”，再显示相应字段。成功或失败都使用 `completed` disposition，并通过 result 的 `status` 区分；真实工具输出会作为原调用结果交给 Agent。切换实际状态时会清空之前填写的工具输出，避免把失败输出误提交为成功结果；核对依据会保留。尚未执行时只记录核对依据，并会在显式恢复时重新运行该调用。核对依据只写入 execution journal，不会传给 Agent。保存核对决定不会自动恢复 Turn；全部调用核对完成后，用户还需显式继续。Studio 显示检查点编号和待核对调用数。超出字节上限时会提示删减内容。若恢复期间再次发生进程重启，当前被重跑的调用结果可能再次变为未知；之前的核对依据不会替代对这次执行结果的检查，已记录的 `completed` 或 `failed` 结果仍保存在 execution journal 中，需要按最新待核对项处理。

运行详情把“会话检查点”和“执行检查点”分开展示。会话检查点在 Turn 结算后更新，供后续对话和 Child fork 使用；执行检查点是当前 Turn 最近的安全恢复位置，运行面板同时显示其阶段、最近进展和执行器心跳。检查点序号标识持久化日志位置，不代表完成步数；模型请求或工具批次执行期间，执行检查点可能保持不变。`checkpoint/committed` 只确认结算后的会话 checkpoint 已提交；运行详情会标出该通知所属的 Turn 和时间。

## 运行面板与会话入口

右侧抽屉的“子智能体”顶层页显示父会话的全部子任务，包括排队、运行、完成、失败和取消项。
列表优先显示需要处理的审批、失败、未开始任务和恢复异常，然后显示运行中及排队任务；顺序任务按组内步骤排列。
完成和取消项默认收起并分页。选择任务后，详情仍在该页中打开，
可以返回列表；返回后保留已结束任务的展开状态和已加载页数。切换父 Session 或项目时重置列表展开状态。
数量摘要用颜色区分运行、排队、待处理和已结束，并显示总数。任务默认以紧凑行展示标题、状态、耗时和阶段/进展；当前 attempt 运行时，耗时从启动时间按秒增长，结算后固定为服务端记录的耗时。排队项展示阻塞或等待原因，恢复异常和失败会在摘要中给出诊断提示。
展开任务后可查看尝试历史、完整进展报告、等待原因和错误详情。已完成且带有结果的任务会显示当前 attempt 的结果预览，最多 240 个 Unicode 字符；更长内容会明确标记截断。此时任务行上的“查看结果”入口打开对应子 Session，查看完整回复与活动记录。开始重试或 follow-up 后，App Server 清空上一 attempt 的 operation result，因此活动任务不会显示旧轮次的最终结果。存在对应子 Session 时，入口始终打开只读消息流，不切换主会话或运行状态页。

运行面板与主线程工具调用共享 Gateway 控制执行器，面板不维护第二份子任务账本。停止是任务行上的快捷操作，提交前需确认；暂停、steer 和“排队后续”放在展开行的“更多操作”中。排队项可修改提示词；暂停项可继续；失败或取消后可在同一 Session 重试。
提交后显示服务端确认结果。处理中状态由持久 operation/control request 投影恢复；请求过期、启动拒绝或后续队列已满时，
面板显示服务端原因，保留当前权威状态并要求刷新或重新选择操作。

详情抽屉可吸附在主会话右侧，也可作为覆盖浮层打开。偏好会保存在当前浏览器；窗口宽度低于
1200 像素时，抽屉使用浮层布局以保留可读的主消息流。

子会话详情只显示该子 Session 自己的实时事件和持久化活动项。详情打开时会订阅按
`project_id + child_thread_id` 路由的实时事件，并使用跨 App Server 重启的有界 `turn/events` 摘要推进游标、发现缺口；
摘要不含文本增量、工具参数或工具正文，不能投影成聊天内容。ThreadItems 是持久活动和断线对账来源。fork 时继承的父 checkpoint 继续作为子代理模型上下文，
但不会作为子代理消息流显示。事件回放缓存有缺口时，详情提示缺口并显示仍可回放的活动；结算后由持久化活动补齐。
旧 Session 没有本地活动项或实时事件时显示明确的空态。详情按原顺序呈现执行活动，并与主会话使用相同的执行段规则：当前 Turn 的活动段保持展开，先前已结算活动折叠为摘要，结算后的最后一段与最终回复保持相邻可见。点击摘要可查看其中的思考和工具卡；工具输出仍由各自卡片展开，思考正文保持限高滚动。长任务提示在独立限高区域内阅读，不撑开整条消息流。
运行中的任务突出当前阶段、最新报告、耗时和最近活动；已结束任务突出终态、最终回复或失败诊断、
总耗时。最终回复优先留在时间线末尾；仅当活动记录未包含 operation result 时才补显示，
避免把中间文字误认为最终回复或重复置顶。详情明确分隔同一 Session 上的初始执行、重试与后续 Turn。运行中的子 Session 每 3 秒刷新一次
Runtime 状态、持久化活动和有界事件回放；持久化活动按 128 项分页，可向前加载。
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

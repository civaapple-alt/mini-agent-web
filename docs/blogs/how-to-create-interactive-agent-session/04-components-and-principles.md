# 04 从组件边界推导设计原则

交互与恢复的可靠性取决于每一层是否只拥有自己能够证明的事实。运行时需要一条清晰的控制路径；未来面向个人需求的 Agent 再把比价、邮件和日历等业务能力接入这条路径，而不是在每个客户端重复实现执行、审批和持久化。

## 当前组件和权威边界

| 组件 | 当前拥有的责任 | 明确不应成为的权威 |
| --- | --- | --- |
| Core | 有界模型/工具循环、上下文限制、停止分类和执行事件 | 文件、进程、审批 UI、Session 持久化 |
| Host | 运行时组装、提示组合、工具准入、审批顺序与执行协调 | 浏览器状态或另一份对话历史 |
| Capabilities | 模型、工作区、进程、沙箱、MCP 和具体外部副作用 | 第二条 Agent Loop |
| App Server / SessionStore | Thread、Turn、Session、Actor/CAS、执行检查点、事件次序和恢复 | 对模型循环再造一套执行器 |
| Python SDK | 启动或连接 App Server，协商 JSON-RPC，提供类型化状态与控制方法 | 执行权限、grant 或 canonical 历史 |
| FastAPI Gateway | Web Project 元数据、Thread 路由、客户端池和浏览器 REST/WebSocket | Session、审批或执行结果的第二个来源 |
| Web Studio | 展示有界状态、提交交互和控制请求 | 执行循环、授权决定或恢复判断 |

这条路径让个人应用能够直接使用 SDK，也允许 Web Studio 复用相同的 App Server。面向新领域的能力应由 Host/Capabilities 的接口接入；界面负责把动作呈现出来，App Server 负责验证身份和保存生命周期。

## 从当前系统推导出的取舍

| 选择 | 得到什么 | 付出的代价 |
| --- | --- | --- |
| 单一 App Server 持有运行和恢复状态 | CLI、SDK 应用和 Web Studio 共享同一套 Turn 与 Session 语义 | 每个客户端都要理解协议并处理断线对账 |
| 副作用由 Host/Capabilities 执行 | Core 保持可移植；准入、审批和具体 Runtime 可以审查 | 新业务工具必须明确参数、身份、权限和结果契约 |
| 中断的未知调用不自动重放 | 不把“进程断了”误当成“外部动作没发生” | 用户可能需要检查外部服务并人工核对 |
| 交互用不同方法和状态表达 | 客户端能分别处理提问、审批、停止、steer 和核对 | 协议与 UI 状态比一个通用确认框多 |
| 有界事件回放加 canonical 状态读取 | 短暂断线可快速恢复，缺口可从权威记录修复 | 客户端需要实现稳定身份合并与重连状态机 |

这些选择优先保护身份一致、执行安全和状态可核查。它们适用于工作台类长任务，也构成未来个人助理的运行底座；它们本身不会自动提供邮件、购物或日历产品功能。

## 未来个人助理需要补上的业务组件

当前 Harness/Web 组合提供通用运行时、工作区工具、Web 能力、MCP 和 SDK 扩展入口。当前源码没有比价、邮件收发或日历操作的一等领域集成；`scheduled_task` 也是有界延时标记，不会自行触发后续 Turn。未来要实现你设想的个人助理，还需要至少设计：

1. **领域 Connector**：分别封装价格来源、邮件服务和日历服务的 API、分页、速率限制和返回契约。
2. **身份与授权**：安全保存用户凭据，按资源和动作限制读取/写入范围。不能把访问令牌交给模型或放入项目文件。
3. **动作策略**：对发送邮件、接受邀请或下单等不可逆动作定义审批和确认规则，并在 Capability 边界执行。
4. **幂等与对账**：给可重试请求使用外部幂等键；保存可查询的操作 ID、服务端回执和取消/补偿结果。
5. **定时与事件触发**：把日历变化、价格监控和收件箱事件连接到受控调度/唤醒组件。当前的延时标记不能替代这个调度器。
6. **用户偏好与数据保留**：明确哪些信息属于 Session 上下文、哪些是用户授权的长期资料、哪些仅是一次任务输入。

这些是面向未来产品的设计问题，不是当前 SDK Cookbook 示例的实现清单。业务集成成熟前，不要在 Core 或 Gateway 里塞入领域专用逻辑。

## 六条可以被证伪的设计原则

1. **身份显式传递**：请求、通知和结果带有可验证的 Thread、Turn、call 或 interaction 身份；迟到响应不能作用到新工作。
2. **每项事实只有一个权威**：Session 与执行状态由 App Server 持有；权限和副作用由 Host/Capabilities 决定；其他层提供投影。
3. **先持久化再确认**：需要跨重连保留的答案、操作结果和状态转换先写入持久记录，再向客户端确认。
4. **不确定性是一种状态**：心跳丢失、HTTP 超时或进程退出都不等于工具未执行、Turn 已结束或 Session 空闲。
5. **恢复按契约决定是否可重放**：已有结果直接复用；未知副作用先核对；只有确认未执行，或当前 Capability 使用经过验证的外部幂等契约，才允许重跑。
6. **模型可见输入有界**：问题、工具结果、事件和恢复摘要都需要明确大小/数量上限，并按需加载详细内容。

## 怎样验证这些原则

验证不能只看最终回复。每个恢复场景应记录假设、公开调用路径、确定性故障点、Thread/Turn/call 身份、事件与检查点顺序、外部副作用计数和最终状态。例如：

| 场景假设 | 可观察证据 | 必须失败的情况 |
| --- | --- | --- |
| 已持久化的工具结果不会被重复执行 | 重启前后的 call ID 与执行计数；恢复后模型收到同一 outcome | 结果已保存却再次调用副作用 |
| 未知结果不会被猜测或自动重试 | `needs_reconciliation`、调用身份和外部系统查询结果 | 未核对就开始同一副作用 |
| 交互答案继续原问题 | interaction/Thread/Turn/call/question 身份与下一个模型请求 | 过期或重复冲突答案被接受 |
| 事件断档可从权威历史修复 | 回放 cursor、`hasGap`、canonical ThreadItem 和状态快照 | 客户端仅凭本地缓存伪造完成状态 |

这些场景能验证协议和控制面行为；它们不能证明某个邮件服务、购物网站或日历供应商的真实 API 契约，也不能证明模型会始终做出正确的领域判断。真实 Connector 仍需在自己的 Provider、认证和副作用边界上单独验证。

## 收束

可交互、可恢复的 Agent 会话不是“把聊天记录存起来”。它需要稳定身份、类型化交互、单一状态权威、显式副作用结果，以及用可观察轨迹验证恢复决定。Mini Agent 当前已经提供这类运行时边界；你的个人助理愿景可以在这些边界上继续设计领域能力和产品体验。

## 代码与规范入口

- [Harness Runtime architecture](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/harness-framework.md)
- [Harness change boundaries](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/harness-boundaries.md)
- [Harness evidence standard](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/harness-evidence.md)
- [Builtin and extension tool surface](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/harness-tool-surface.md)
- [MCP capability registry](https://github.com/civaapple-alt/mini-agent-harness/blob/main/crates/mini-agent-capabilities/src/registry.rs)
- [Scheduled-task contract](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/harness-tool-surface.md#background-shell-and-delayed-markers)

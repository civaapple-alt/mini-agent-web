# Mini Agent Web & SDK 运行时边界与硬限制 (Limits)

本文档定义了 `mini-agent-web`（包含 Python SDK、FastAPI 网关、Web Studio 前端及终端 TUI）各层级的显式硬边界与安全限制。遵循 Mini Agent 零无界输入（Bounded Surface）纪律，杜绝无限制内存膨胀与阻塞。

---

## 1. 客户端与协议核心边界一览

| 边界维度 | 默认限制 | 超限行为与处理策略 |
| :--- | :---: | :--- |
| **单次用户输入 (Prompt Input)** | **32 KiB** | 输入框与网关直接拦截并抛出错误，拒绝将超限 Payload 注入 Stdio 管道 |
| **单次实时纠偏 (Steer Input)** | **16 KiB** | 前端与 SDK 校验长度，超限拒绝发送并提示原因 |
| **单条工具返回结果预览** | **16 KiB** | `ToolCard` 与 TUI 保留 UTF-8 安全的首尾截断预览，避免撑爆 DOM / 控制台 |
| **单轮模型流式文本输出** | **64 KiB** | 流式规约器持续追踪字节数，超限时触发截断告警并结束当前块聚合 |
| **内置基础工具集** | **6 种标准工具** | 严格限制为 `read_file`、`write_file`、`edit_file`、`shell`、`web_fetch`、`read_image` |
| **管理接口请求超时** | **30 秒** | `initialize`、`thread/start`、`thread/settings/update` 等控制面 RPC 30 秒超时熔断 |
| **Goal 自治执行轮次上限** | **50 步** | 触发 App Server 的 `usageLimited` 并结算退出 |
| **Goal 执行墙上时钟超时** | **600 秒** | 触发协作式取消（`turn/interrupt`）并标记为超时结算 |
| **WebSocket 帧与缓冲区** | **1 MiB** | 超出单帧大小的异常报文直接拒绝解析并断开异常连接 |

---

## 2. 前端 Web Studio 渲染与状态边界

### 2.1 消息流与 DOM 保护
- **结构化聚合（Blocks）**：前端采用 `messageState.js` 将原始细碎的字符级 Delta 聚合成结构化的 Thinking 块、Markdown 文本块与 Tool 卡片，防止高频触发 React Virtual DOM 重绘；
- **思考链截断与折叠**：`ThinkingBlock` 默认折叠，实时显示耗时与字符数，单次思考链文本展示上限为 64 KiB；
- **图片上传与 Lightbox**：工作区图片读取（`read_image`）经由网关受控暴露，前端单张图片预览分辨率自适应适配视窗，杜绝内存溢出。

### 2.2 工作区与会话列表
- **会话历史检索**：会话搜索在前端进行亚毫秒级模糊过滤，历史会话加载采用异步渐进骨架屏（Skeleton Loading）；
- **工作区项目管理**：支持多项目并行固定（Pin），系统目录选择器受限于宿主操作系统权限。

---

## 3. Python SDK 与网关传输边界

### 3.1 零外部依赖传输保障
- SDK 仅依赖 Python 3.10+ 标准库（`asyncio`, `json`, `subprocess`），使用 Stdio 行缓冲读取，单行 JSONL 读取缓冲区上限设为 **1 MiB**；
- 收到超出协议规范的超大行或格式错误帧时，SDK 记录错误日志并跳过解析，避免主读循环挂起。

### 3.2 动态 Steering 与 Interrupt 竞态边界
- 运行时纠偏（`turn/steer`）仅在当前 Turn 处于活动生成状态时允许下发；
- 协作中断（`turn/interrupt`）采用幂等设计，如果 Turn 已在此前完成结算，服务端安全返回无害结果，不抛出异常。

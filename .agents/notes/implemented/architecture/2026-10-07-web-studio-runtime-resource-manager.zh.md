# Web Studio 运行时资源管理与 Session 驻留

状态：implemented；日期：2026-10-07；范围：Gateway、Web Studio、Python SDK、App Server

## 决策

Web Studio 的独立资源管理器展示 Gateway 自身及其 ClientPool 管理的 App Server，不扫描其他系统进程。页面每 2 秒读取一次快照；每个进程的历史最多保留 300 个数值样本，约 10 分钟，不保存逐请求记录或 RPC 正文。历史只存在 Gateway 内存，快照轮询停止后不再采样。

Thread 页面通过 WebSocket 可见状态租约表达查看者：每 15 秒续期，45 秒过期。最后一个查看者离开后，Gateway 等待 10 分钟，再检查活动 Turn、审批、后台任务、子操作和 App Server Runtime Status。状态未知、仍有活动或停止未确认时，Park 被阻止或保持 stopping_unconfirmed；不会因等待超时启动替代进程。确认优雅退出后保留 SessionStore。多个浏览器查看同一 Thread 共用 ClientPool 中的 App Server；Wake 复用原有 attach/resume 流程。

Gateway 的 Session 列表摘要缓存最多保留 512 个 Session。JSONL 未变化时不重读；文件追加时增量读取；替换或截断时重建。SDK 和 App Server 的 RPC 观测边界、限制及诊断配置记录在 sibling mini-agent-harness 的 implemented note；docs/resource-manager.md 是 Web 操作说明及测量数据的规范入口。

## 验证证据

- Gateway 资源管理及 SessionManager 针对性测试 177 项通过；覆盖固定样本上限、租约、多查看者、Park 阻塞条件、状态未知和停止未确认等情况。
- 前端 ESLint、Node 测试 103 项、Vitest 222 项及 Vite 构建通过。
- sibling Harness 的 SDK 测试 106 项、App Server 库测试 103 项和二进制测试 1 项通过；Rust 格式、Clippy 与行数门禁通过。
- 本地合成采样测量使用 1 个 Gateway 和 32 个进程描述符，300 个完整样本的 tracemalloc 增量为 1,107,700 字节，单次快照平均 Python CPU 为 1.85 ms。该数值不代表真实操作系统进程采样成本。
- Session 列表合成测量覆盖 64 个 Session、每个 1,000 个 Turn；未变化轮询平均 4.03 ms，全量重读解析平均 175.15 ms。JSON-RPC 空闲状态测量和阶段耗时也记录在 docs/resource-manager.md；这些本地数据不是接口延迟承诺，也不等于协议优化结果。
- 未运行 Rust 全工作区测试；未进行真实模型调用或手动浏览器端到端走查。

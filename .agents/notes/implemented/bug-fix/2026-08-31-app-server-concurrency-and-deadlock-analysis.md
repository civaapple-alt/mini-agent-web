# ADR: Mini Agent App Server 并发死锁与流式挂起根因剖析与加固

* **日期**: 2026-08-31
* **状态**: Implemented
* **范围**: App Server Runtime / JSON-RPC 传输层 / 子进程隔离
* **上下文**: 在 `mini-agent-web` 与 `mini-codex`（`mini-agent-app-server`）进行 Stdio JSON-RPC 2.0 联调与全流程验证过程中，定位并修复了 4 个底层的并发死锁与长连接流式挂起隐患。本文档详细记录其机制、复现条件与修复方案，作为系统并发设计与故障排查的重要参考。

---

## 1. 死锁 1：单线程 Tokio Runtime 下的同步阻塞死锁

### 机制与现象
* **发生位置**：`ApprovalBroker::request` 与 `mini-agent-app-server` 主入口。
* **复现路径**：
  1. 服务端入口配置为单线程运行模式：`#[tokio::main(flavor = "current_thread")]`。
  2. 当大模型触发敏感工具（如 `shell`）时，`ApprovalBroker::request` 发起安全拦截，并通过同步通道 `receiver.recv()` 阻塞等待客户端回复。
  3. 客户端发送 `approval/respond` JSON-RPC 请求，由于 Tokio 运行时仅有的单线程被 `recv()` 占死，网络与 I/O Actor 无法调度，无法接收来自 stdin 的 JSON-RPC 请求并将其写入 channel。
  4. **系统产生死锁**：服务端在等客户端的授权，客户端在发授权但服务端没线程读，双方永久挂死。

### 修复方案
1. 在 `crates/mini-agent-app-server/Cargo.toml` 中显式引入 `tokio` 的 `rt-multi-thread` 特性。
2. 将服务端的 main 宏切换为多线程运行时：`#[tokio::main]`。
3. 同步 `receiver.recv()` 仅阻塞当前工具的工作线程，Tokio 的 I/O 线程仍可正常调度处理 `approval/respond` 请求。

---

## 2. 死锁 2：Transport Actor 的自锁死锁 (Self-Deadlock)

### 机制与现象
* **发生位置**：`crates/mini-agent-app-server/src/json_rpc/transport.rs` (第 147 行附近)。
* **复现路径**：
  1. 在底层 Core 发出核心事件时，Transport 收到事件后准备向客户端派发 `turn/event` 通知。
  2. 在构造通知结构体时，代码调用了 `connection.thread_id().await`。
  3. `connection.thread_id().await` 内部需要请求 `Connection` Actor 的锁或向其发送查询信令并等待回复。
  4. 然而，此时正处于该 Actor 的消息处理循环内部！
  5. **自身等待自身释放处理权**，引发经典的 Actor 自锁死锁。

### 修复方案
* 不在事件派发路径中异步重入 Actor 查询 `thread_id`，改为直接读取轻量、已同步维护的 `connection.server.thread_id().clone()`，消除异步重入与死锁。

---

## 3. 挂起 1：OpenAI 兼容 SSE 流式长连接 Keep-Alive 挂起

### 机制与现象
* **发生位置**：`crates/mini-agent-capabilities/src/openai/mod.rs` 与 `responses.rs`。
* **复现路径**：
  1. 当对接 DeepSeek 或某些兼容 OpenAI 协议的第三方 API 服务商时，服务端在返回完整的流式内容并在数据末尾发出 `data: {"type": "response.completed"}` 后，底层 HTTP/1.1 TCP Socket 依然保持 60 秒以上的 Keep-Alive 长连接状态，并不立即发送 `FIN` 包关闭流。
  2. `drain_sse` 原始实现仅依赖底层 Stream 读取返回 `None`（即流完全 EOF 关闭）作为退出循环条件。
  3. **导致现象**：大模型已经生成完毕所有 Token，但请求处理函数在 `drain_sse` 中死等 Socket 关闭，造成 60s+ 的假死（Hang）。

### 修复方案
* 在 `drain_sse` 的事件回调状态机中引入提前跳出机制：当 `on_event` 成功消费到 `response.completed`（或终止信标）时返回 `Ok(true)`，`drain_sse` 立即提前跳出循环，不再等待长连接断开。

---

## 4. 挂起 2：子进程 Stdin 继承与交互式 Pager 挂起

### 机制与现象
* **发生位置**：`crates/mini-agent-capabilities/src/workspace/shell.rs`。
* **复现路径**：
  1. `run_sandboxed_command` 在启动 Shell 子进程时，只配置了 `stdout(Stdio::piped())` 和 `stderr(Stdio::piped())`，未显式指定 `stdin`。
  2. 在 Windows 和 Unix 下，`std::process::Command` 默认继承父进程的 `stdin`（即 Python 与 Server 通信的 JSON-RPC 管道）。
  3. 当大模型调用 `git` 等命令时，Git 探测到输入终端可能处于交互状态，或由于分页器（`less` / `more`）拉起而等待按键输入，或者竞争读取 JSON-RPC 管道字节，导致后台进程卡住。

### 修复方案
1. 显式为所有 Shell 工具配置 `.stdin(Stdio::null())`，与主进程通信管道彻底隔离。
2. 注入静默与无头环境变量：
   ```rust
   fn apply_non_interactive_env(cmd: &mut Command) {
       cmd.env("GIT_TERMINAL_PROMPT", "0");
       cmd.env("GIT_PAGER", "cat");
       cmd.env("PAGER", "cat");
       cmd.env("CI", "1");
       cmd.env("TERM", "dumb");
   }
   ```

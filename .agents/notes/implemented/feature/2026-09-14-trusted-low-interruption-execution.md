# Trusted 低打断工具执行

日期：2026-09-14  
范围：`mini-codex` Capabilities / Host 审批边界、Web Studio 文档与策略说明

## 背景

检查 `blender-intro` 的 Thread
`s-1a09e9d943c-9b40-0` 时，`approval-evidence.jsonl` 记录了 88 次
`shell` 审批请求，其中 87 次已经处理。Thread 使用 `trusted + full-machine`，
但原实现把除少数只读工具外的 Shell 都视为高风险，因此普通检查、构建和维护命令
逐条打断用户任务。

## 决策

`trusted` 调整为低打断执行策略：

- 普通、已通过工具自身参数和工作区校验的 Shell 命令自动执行；
- 普通工作区 `apply_patch` 继续沿用现有直接准入；删除文件或移动文件的 Patch
  仍进入审批；
- 递归/强制删除（Unix `rm`、Windows `Remove-Item`/`rmdir`/`del`）、破坏性 Git、
  系统级命令和间接删除调用仍进入审批；命中 Security Deny 的规则优先拒绝；
- MCP 和工作区外 `read_image` 仍保留显式审批；`web_fetch` 沿用已有的有界 URL 准入，
  不新增审批打断；`read_file` 等普通读取不增加审批；
- `interactive` 与 `automatic` 的既有语义不变，授权存储和审批权威仍在
  Host/Capabilities，Web Studio 只展示结果。

这不是无条件 allow-all。`full_machine` 只扩大路径范围；它不会取消安全 Deny、
Plan 锁、沙箱或外部副作用边界。当前默认策略中的 `rm -rf` Deny 规则仍然优先于
trusted 的审批判定。

## 实现与边界

- `ApprovalController` 根据策略选择 `is_high_risk` 或新的 trusted 高风险判定；
  trusted 的普通 Shell 在审批控制器内同步通过，因此不会创建 Web pending approval。
- Shell 的直接执行路径携带 `tool_name=shell`，避免旧的 legacy 请求因缺少工具身份被
  误判为高风险。
- 危险命令识别覆盖大小写归一化、Shell/PowerShell 描述形式、递归/强制删除、
  `git reset --hard`、`git clean -f`、强制 push、删除分支、丢弃工作树和系统管理命令。
- 没有新增 REST/WebSocket 字段或第二套授权缓存；现有 `call_id`、Session 日志和
  `approval-evidence.jsonl` 关联方式不变。

## 证据

- `workspace::tests::trusted_policy_directly_admits_non_destructive_patches_but_not_deletes`
  保证普通 Patch 与删除 Patch 的差异；
- `workspace::tests::trusted_policy_auto_approves_ordinary_shell_commands` 保证普通
  Shell 不调用审批回调；
- `security::tests::trusted_policy_only_bypasses_non_destructive_and_local_read_actions`
  覆盖普通 Shell、Unix/Windows 删除、破坏性 Git、普通读取和 MCP 分类；
- `cargo test -p mini-agent-capabilities`：74 passed；
- `cargo test -p mini-agent-app-server`：56 passed；
- Capabilities 与 App Server `clippy -D warnings`、`cargo fmt --check` 通过；
- `python scripts/line_budget.py --base HEAD --check-delta --json` 通过，release 增量
  为 145 行，未触发 150 行非 Red 增量上限。

## 六项变更准入记录

1. **所属层**：实现属于 Capabilities 的安全策略和 Workspace Shell 适配；Host 的
   `ToolOrchestrator` 继续拥有 admission → approval → execution 顺序，App Server 和
   Web Studio 不持有授权权威。
2. **重复职责**：复用现有 `ApprovalController`、`SecurityPolicy`、`ToolAdmission` 和
   `ToolOrchestrator`；没有新增 Gateway/前端审批缓存或并行审批路径。
3. **旧概念**：替换 trusted 中过于粗糙的“非只读工具即高风险”判定；保留
   `interactive`、`automatic`、Security Deny 和现有 grant scope，不增加第四种策略。
4. **行数预算**：runtime `19703 -> 19703 (+0)`；release `29338 -> 29483 (+145)`；
   control-plane `20332 -> 20477 (+145)`。增加量主要用于有界危险命令判定和回归证据，
   未删除既有核心测试或授权边界。
5. **可见面变化**：只改变 trusted 策略下是否产生 approval pending；不增加模型可见
   输入、事件、持久化内容或公共协议字段。现有策略说明、变更日志和故障排查文档已同步。
6. **边界测试**：使用上述 Capabilities/App Server 单测、Clippy、fmt 和 line budget；
   未使用真实 Provider 或付费调用。Web Studio 的 frontend 文档改动不改变运行时代码
   协议；重新启动 Gateway/App Server 后新 Thread 才会使用新 Capabilities 二进制。

## 操作提示

对持续维护项目，建议使用 `full_machine + trusted`，并保留 Auto Copilot 的
`trusted + continuous` 组合。用户仍会在真正具有不可逆影响的命令、外部工具或命中
安全 Deny 时看到审批/拒绝；若仍看到普通 Shell 审批，应确认 Gateway 使用的是包含本次
Capabilities 改动的 App Server 二进制并重启运行时。

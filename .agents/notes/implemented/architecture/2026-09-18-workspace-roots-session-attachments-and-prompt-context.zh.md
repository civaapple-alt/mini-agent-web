# Workspace Root、Session 附件根与 Prompt Context

状态：implemented

Gateway 将 Project 的主目录、关联目录和当前 Thread 的附件目录分开传给
App Server：关联目录使用 `MINI_AGENT_EXTRA_READ_ROOTS` /
`MINI_AGENT_EXTRA_WRITE_ROOTS`，附件目录只使用
`MINI_AGENT_SESSION_READ_ROOTS`。附件根是只读的，不能指向整个
`~/.mini-agent/sessions`；SessionStore 的 `session.jsonl`、审批证据和 sidecar
仍由 App Server/Host 管理。

Host 向模型提供稳定的逻辑 `session_capabilities`，而不是物理 Session 路径。
WebStudio 的 Prompt Context 诊断可以展示附件根数量和受控路径标题，但前端不参与
权限判断，也不扫描 Session 文件。Project 根集合变化会触发 Runtime 重绑；附件文件
的增删不会追加 Workspace Root 或污染稳定 Prompt 前缀。

附件文件可通过现有 `read_file` / `read_image` 按需读取。复制、拖拽或粘贴产生的
内容仍由 Gateway 按既有限制保存；读取不代表执行，脚本执行和写入继续走 Host 的
审批与 Sandbox 边界。

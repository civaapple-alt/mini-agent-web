# Thread 输入历史投影与时间显示修复

状态：implemented  
日期：2026-09-17

## 结论

- 输入历史不再只依赖 checkpoint；展示层将 checkpoint 用户消息与有界的
  ThreadItem `userMessage` 投影合并，因此上下文压缩或 checkpoint 预览受限时，
  较早的用户输入仍可见。
- Gateway 从 SessionStore item 的 `timestamp_ms` 投影 `capturedAt`。历史记录缺少
  合法时间时省略时间，不再显示“历史时间未记录”这一误导性提示。
- WebStudio 最多读取最近 256 个历史 item，并跟随 App Server 的 cursor；面板改为
  紧凑列表，保留 Turn、附件摘要和调整输入入口。
- 历史回放不复制图片 base64。当前输入和队列继续保留图片数据；历史文本中的
  Gateway 附件上下文会被隐藏，已持久化的图片标记只显示有限数量。

## 根因

此前 `loadThreadHistory` 只把 `readThread` 的 checkpoint 消息放进输入历史，
而 `listThreadItems` 只用于补全助手和工具块；同时 SessionStore item 的时间没有
进入公开投影，历史 `inputTrace` 因而始终没有 `capturedAt`。

## 边界

历史 item 仍是有界投影，不等价于无限读取 Session JSONL。历史列表不复制图片原始
字节，也不向用户界面展示 Gateway 注入的物理路径；图片是否可在历史中重新编辑，
取决于 runtime 是否持久化了附件元数据。脚本、附件和其他工具资源不因此获得额外
执行或写入权限。

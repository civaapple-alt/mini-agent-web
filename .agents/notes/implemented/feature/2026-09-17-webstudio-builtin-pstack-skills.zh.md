# WebStudio 内置 pstack 技能组与显式激活

状态：implemented
日期：2026-09-17
范围：WebStudio 资源、FastAPI Gateway、Python SDK、React 前端

## Decision

WebStudio 将 ChatGPT 适配版 `pstack` 技能作为随产品发布的资源，放在
`resources/builtin-skills/pstack`。Gateway 启动时把资源同步到
`%USERPROFILE%/.mini-agent/skills/builtin/pstack`，并用版本号和源文件哈希
判断是否需要更新。

同步过程使用临时 staging 目录。新目录准备完成后再切换目标目录；切换失败
时恢复原目录。相同版本和哈希的重复启动不重写已有文件。

Mini Agent App Server 是 Skill Discovery 的唯一事实来源。Gateway 从选定
Project 的最新 `initialize.capabilityManifest` 缓存读取目录，`GET /api/skills`
只返回有界的 group 和 skill 元数据。前端不扫描文件系统，也不接收物理路径
或正文。

## Project and Turn behavior

Project 使用 `builtin_skill_groups` 保存启用的 builtin group。新 Project 默认
启用 `pstack`。空列表关闭所有 builtin group。切换时如果目标 Project 有活动
Turn 或待审批操作，Gateway 返回 409；成功后只重启目标 Project 的 runtime，
再读取新的 capability manifest。

输入框把 token 边界上的 `$skill-name` 转为 `selectedSkills`，并从实际 prompt
中移除。前端处理搜索、键盘选择、技能 chips、转义 `$`、重复和最多 8 个技能。
真正的技能读取仍由 Host 完成。前端只负责选择，不在用户提交前加载正文。

REST、SSE、WebSocket 和 Python SDK 共用同一组字段。SDK 对旧的无技能调用
省略空字段，保留旧客户端的请求形状。

## Observable behavior

App Server 在 `turn_started` 之后、`run_started` 之前发送一次
`skills_loaded` 或 `skills_load_failed`。Gateway 原样保留事件的 Thread、Turn、
sequence 和 item identity。Web Studio 在信息流中把成功事件显示为
`已加载技能：a、b、c`，失败事件显示为紧凑错误块。事件进入 replay，因此刷新
页面后仍可看到。

普通 metadata-first Discovery 不显示技能加载事件。该事件只说明用户通过
`$skill` 在当前 Turn 显式激活了技能。

## Why this boundary

资源同步属于 WebStudio 的发布生命周期。技能目录和正文的信任、校验与读取
属于 Mini Agent Host/Capabilities。Gateway 只负责 Project 路由、runtime
生命周期和协议映射。这个划分避免前端成为第二个技能目录，也避免把
`pstack-plugin` 的 MCP、Hook、命令或 Cursor 专属行为隐式安装进 Mini Agent。

## Verification

- 26 个 pstack 技能目录与 front matter 名称已校验；
- Gateway 启动同步、重复启动、版本变化和异常恢复测试通过；
- `/api/skills`、Project 409 冲突、SDK 事件解析和队列消息测试通过；
- Python 测试 150 项通过，前端 Node 测试 57 项、Vitest 36 项通过；
- Vite production build 通过，Rust 跨仓受影响包测试和边界检查通过。

## Consequence

后续 builtin skill group 可以复用同一套资源同步、Project 开关、manifest、
`$` 激活和事件投影。增加新组时仍需为资源版本、启用策略和目录上限补充测试。

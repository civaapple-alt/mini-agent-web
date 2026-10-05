# 文档索引

本目录只维护 `mini-agent-web` Gateway、Web Studio 的稳定参考文档、运行手册和故障
排查内容。Python SDK 与通用 App Server 示例由 `mini-agent-harness` 维护；Web
通过同级 Harness checkout 的可编辑 SDK path source 联调，并消费 App Server 的权威
运行状态，不创建第二条 Agent 执行链路。
按问题选择文档即可；实现细节和历史决策不放在这里。

| 文档 | 用途 |
| --- | --- |
| [`limits.md`](limits.md) | 输入、输出、工具、会话和传输的硬限制 |
| [`privacy.md`](privacy.md) | 本地数据、凭证、日志和网络边界 |
| [`preferences.md`](preferences.md) | Web Studio 偏好设置分类、保存和安全边界 |
| [`releasing.md`](releasing.md) | 版本同步、验证和发布步骤 |
| [`skills.md`](skills.md) | 内置技能组、项目开关、技能目录和 `$skill` 激活 |
| [`models.md`](models.md) | Responses 供应商、模型目录、默认值和输入框切换 |
| [`web-search.md`](web-search.md) | 搜索服务设置、Gateway/SDK 路径和会话流中的搜索及网页阅读展示 |
| [`session-context.md`](session-context.md) | 会话上下文来源、注入时间线和 Provider 用量 |
| [`session-history.md`](session-history.md) | Web Studio 对话历史分页、滚动锚点和虚拟列表 |
| [`user-questions.md`](user-questions.md) | 会话流中的 Agent 提问、推荐选项、回答和恢复行为 |
| [`workspaces.md`](workspaces.md) | 项目工作区及本机快捷打开入口 |
| [`child-tasks.md`](child-tasks.md) | 子代理批次、进展、动态控制及运行面板入口 |
| [`background-tasks.md`](background-tasks.md) | 跨 Turn 本地后台 Shell 任务及运行面板行为 |
| [`scheduled-tasks.md`](scheduled-tasks.md) | 跨 Turn 的有界延时标记及远程状态等待边界 |
| [`troubleshooting.md`](troubleshooting.md) | 启动、连接、端口和审批故障排查 |

## 维护规则

- 稳定规则写入对应主题文档，不在本索引复制正文；
- 每个主题只保留一个权威页面，避免同一限制在多个页面重复维护；
- 发布后仍然有效的规则更新原文；一次性过程、实验记录和架构决策不追加到这里。

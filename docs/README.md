# 文档索引

本目录只维护 `mini-agent-web` 的稳定参考文档、运行手册和故障排查内容。
文档围绕 Web Studio 作为长时间运行任务的控制与观察工作台展开；SDK、Gateway
和前端消费 App Server 的权威运行状态，不创建第二条 Agent 执行链路。按问题
选择文档即可；实现细节和历史决策不放在这里。

| 文档 | 用途 |
| --- | --- |
| [`limits.md`](limits.md) | 输入、输出、工具、会话和传输的硬限制 |
| [`privacy.md`](privacy.md) | 本地数据、凭证、日志和网络边界 |
| [`releasing.md`](releasing.md) | 版本同步、验证和发布步骤 |
| [`skills.md`](skills.md) | 内置技能组、项目开关、技能目录和 `$skill` 激活 |
| [`background-tasks.md`](background-tasks.md) | 跨 Turn 本地后台 Shell 任务及运行面板行为 |
| [`troubleshooting.md`](troubleshooting.md) | 启动、连接、端口和审批故障排查 |

## 维护规则

- 稳定规则写入对应主题文档，不在本索引复制正文；
- 每个主题只保留一个权威页面，避免同一限制在多个页面重复维护；
- 发布后仍然有效的规则更新原文；一次性过程、实验记录和架构决策不追加到这里。

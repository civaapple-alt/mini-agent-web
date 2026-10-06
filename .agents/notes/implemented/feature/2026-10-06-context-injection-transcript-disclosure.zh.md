# 会话流上下文注入来源的折叠展示

状态：implemented；日期：2026-10-06；范围：Web Studio 会话流

## 决策

每个持久化注入边界在会话流中显示为一行“上下文已注入”和来源数量。展开后按行列出来源类别、名称以及可用的工作区和路径，便于确认 AGENTS.md、Skill 和其他上下文具体来自哪里。

会话流只显示来源元数据，不显示注入正文、字节数、指纹或替换细节。来源记录缺少路径时，仍显示已知的名称和类别。完整来源信息继续由上下文面板展示。

## 边界

App Server 持有规范注入记录；Web Studio 只投影会话流中的折叠摘要。该交互不改变注入、权限或上下文持久化语义。

## 验证证据

- `MessageItem.jsx` 将来源卡片改为原生 `details` 折叠行；展开列表使用现有记录中的 `kind`、`source`、`workspace` 和 `path`。
- `docs/session-context.md` 记录新的会话流展示行为。
- 更新了已有的 `MessageItem.test.jsx` 断言以匹配折叠行；本轮未运行测试或浏览器走查。
- `npm --prefix frontend run build` 和 `npm --prefix frontend run lint` 通过；`git diff --check` 通过。

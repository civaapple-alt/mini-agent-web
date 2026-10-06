# 技能目录来源、主动选择与显式调用

状态：implemented；日期：2026-10-06；范围：React Web Studio、Gateway、Harness App Server

## 决策

技能面板将搜索和来源筛选放在列表前面，按 builtin group、个人目录、项目和插件分组。来源只显示 runtime 目录给出的结构化类别，不显示绝对路径。搜索覆盖规范名、别名和简介；点击技能卡仍插入规范 `$skill` 调用名。

技能的“可主动选择”状态和启用状态分开显示。`modelInvocable: false` 的技能仍可搜索、查看和手动插入。仅在有真实内置组关联时显示 `+ group` 按需调用。旧 Runtime 未返回 `origin` 或 `modelInvocable` 时，Studio 使用文档定义的兼容标签和默认值，不从 `source` 猜测技能组。

pstack 的原则技能移除 `disable-model-invocation: true` 后，模型可从 metadata-first 目录按需选择匹配技能。模型应先简短说明技能名和使用原因，再读取所需正文；用户无需先输入 `$skill` 或 `+ pstack`。正文仍按需加载，不预读整个组。`bro` 和 `technical-writing` 保持仅手动调用。

## 所有权

App Server 的技能目录是唯一来源。Gateway 透传有限元数据；Web Studio 只做筛选、显示和调用名插入。技能启用和文件读取权限仍由 Host 决定。面板不会为了搜索而扫描磁盘。

## 验证证据

- `SkillPanel.test.jsx` 覆盖来源计数、来源筛选、跨来源别名搜索、状态标签和调用名插入。
- `InputBar.test.jsx`、`skill_tokens.test.js` 覆盖手动技能仍可补全和选择。
- `tests/gateway/test_gateway_api.py` 覆盖目录字段透传与旧响应兼容。
- `docs/skills.md` 描述来源、启用状态、自动选择和手动调用边界。相关提交：`ed8d298`、`c7479d5`、`17a3047`。
- 最后一批 Harness/Web 定向测试、lint 与 build 在实施时通过。本文补录没有重跑这些检查。

## 未完成验证

面板和键盘交互经过宽、窄布局检查。匹配任务中模型主动选择技能的比例尚未完成 3–5 位开发者的对照走查；自动调用率不能由目录组件测试推断。

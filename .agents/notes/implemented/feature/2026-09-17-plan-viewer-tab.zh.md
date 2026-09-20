# WebStudio 顶层计划查看入口

## 决策

计划是当前会话的核心产物，不应与 Plan Mode、Builtin Tools 和 Thread Goal
控制项共用一个狭窄的底部文件区域。因此在运行状态和工作区同级增加“计划查看”
Tab，并将状态栏的计划详情入口直接指向该 Tab。

## 交互边界

- “计划查看”只负责阅读 `plan/plan.md` 及 Session 投影出的配套规划文件；
- 文件列表和正文阅读器占满侧栏内容区，正文按 Markdown 阅读态渲染；
- “计划与目标”保留 Plan Mode、Builtin Tools 和 Thread Goal 的控制能力；
- 计划文件仍由 Gateway 的受控文件接口读取，前端不扫描会话目录；
- Markdown 渲染不执行 HTML、脚本或文件内容中的行为。

## 原因

原来的文件查看器位于“计划与目标”内容底部，固定高度且以原文方式展示。
长计划需要频繁滚动，标题、列表和检查项也难以快速识别。独立 Tab 将“阅读”
与“配置”分开，保留同一侧栏入口和会话权限边界，不增加新的运行时状态。

## 验证

`PlanViewer.test.jsx` 覆盖顶层 Tab、默认计划文件读取、Markdown 标题/检查项渲染
和文件切换；前端 lint、组件测试与生产构建作为提交前验证。

## Session 计划路径与刷新

Plan Mode 中模型使用逻辑别名 `plan.md` 读写当前 Session 的计划产物。Session 文件接口将它
公开为 `plan/plan.md`；项目根目录的 `plan.md` 是另一份工作区文件。“计划”页优先选中当前
Session 的 `plan/plan.md`，不扫描或拼接物理 Session 路径。

Turn 结算后，侧栏根据新的 Turn 结果重新加载计划文件列表和正文。这样 Plan Mode 写入的内容会在同一 Session 的运行面板中更新。相关修复由 Harness 提交 `0f7a8cd`、`0bf5189` 和 WebStudio 提交 `af85c51` 完成；计划查看入口本身由 `7faf8b3`、`dc78c45` 建立和调整。

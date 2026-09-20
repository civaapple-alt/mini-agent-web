# 子代理抽屉停靠与尝试阶段列表

状态：Implemented

## 问题

运行详情使用覆盖浮层并模糊主消息流，难以在跟踪子代理时同时查看父会话。子代理列表虽然读取持久化 operation 投影，
却没有清楚区分重试轮次、运行阶段、顺序组位置和等待恢复状态。

## 决策

- 将详情面板作为主布局的右侧兄弟区域，保留原覆盖模式作为可切换布局。
- 在窗口宽度低于 1200 像素时使用覆盖模式；保存停靠偏好，并在宽屏恢复时继续停靠。
- 按需要处理状态（包括未开始）、运行、排队、其他状态的顺序显示子任务；完成和取消任务继续折叠分页。
- 主消息流批次卡和子任务列表共用尝试阶段分组，显示最近两次尝试、当前阶段、顺序位置、恢复异常和带尝试编号的最新报告。
- `/children` 和 App Server operation 继续作为唯一任务状态来源。
- 已完成的子 Session 不能接收新的评审提示；失败任务的 `retry` 仍复用原提示词。需要返工时，父代理创建新子任务。

## 实现与验证

- `frontend/src/components/AppLayout.jsx`：持久化停靠偏好；窗口宽度不足时改用覆盖布局。
- `frontend/src/components/SidePanel.jsx`、`SidePanel.css`：新增右侧停靠呈现和切换按钮，停靠时不遮挡或模糊主会话。
- `frontend/src/utils/childTasks.js`、`ChildTaskAttemptHistory.jsx`：集中计算优先级、计数、阶段文案和最近尝试分组。
- `ChildTasksPane.jsx`、`ChildTaskBatchCard.jsx`、`StatusDetailsPane.jsx`：显示子任务阶段、顺序、尝试、恢复提示和进展。
- `docs/child-tasks.md` 与 `docs/troubleshooting.md`：记录重复 steer、原提示词 retry、已完成任务后续安排的边界。
- 验证：`npm test` 通过（73 项 Node 测试、106 项 Vitest）；`npm run lint` 通过；`npm run build` 通过；`python ..\mini-codex\scripts\check_docs_links.py README.md docs` 通过；`git diff --check` 通过。
- 构建仍提示主 JavaScript chunk 超过 500 kB；构建成功，此项为现有体积提示。

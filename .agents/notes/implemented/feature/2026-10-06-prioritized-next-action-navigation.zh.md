# 状态栏定位下一项待处理工作

状态：implemented；日期：2026-10-06；范围：Web Studio 状态投影、ChatArea、工具和问题卡

## 决策

StatusRail 从现有 App Server 状态生成一个前端待处理摘要，显示优先事项、剩余数量和“前往下一项”。优先级为状态同步或停止限制、工具结果核对、审批、问题回答，再到继续当前 Turn 或确认计划。连接恢复和停止结算期间显示同步等待，不展示已过期操作。

摘要只负责定位。回答、审批和结果核对仍在对应问题卡或工具活动中完成；继续 Turn 仍由 Turn 检查点入口处理。跳转通过 `callId`、`interactionId`、`turnId` 等结构化身份查找目标，再让虚拟列表挂载、滚动、展开并聚焦卡片。找不到目标时，原有待处理入口继续可见。

该状态是 App Server 状态的前端投影，不新增 Gateway 或 App Server 公共接口，也不合并连接状态与 Turn 生命周期。

## 验证证据

- `status_model.test.js` 覆盖优先级、计数和恢复/只读/停止时隐藏过期操作。
- `attention_targets.test.js` 覆盖结构化身份匹配；`ChatArea.test.jsx`、`StatusRail.test.jsx`、`ToolCard.test.jsx` 覆盖目标定位和组件状态。
- 设计依据与组件边界记录在 `docs/blogs/how-to-create-interactive-agent-session/`；实现提交为 `927e7c0`。
- 用户走查计划要求同一组开发者做前后对照。当前没有记录 3–5 位参与者的基线和复测数据，因此 10 秒与 30% 目标尚未获得用户研究证据。

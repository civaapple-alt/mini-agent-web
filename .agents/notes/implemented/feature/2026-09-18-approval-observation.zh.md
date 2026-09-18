# Web Studio 审批变更观测

**状态：已落地**

## 决策

审批 Dock 不再只展示 `apply_patch` 工具名。服务端复用现有审批协议中的
`actionSummary` 和 `pathScope.paths`，在审批发生前提供结构化变更摘要与有界目标路径。

## 展示规则

- `apply_patch` 显示新增、修改、删除文件数量；删除会使用醒目的风险图标；
- 目标路径默认收起，展开后最多展示 32 条；
- 审批卡不展示完整补丁，完整参数仍保留在工具详情；
- `action` 继续作为授权身份，摘要只作为观测信息，不参与授权匹配；
- 缺少结构化摘要时保留现有兼容展示，不由前端解析补丁文本猜测删除。

## 验证

- 前端 ApprovalDock 测试覆盖修改与删除摘要、目标文件展开；
- Capabilities 测试覆盖删除补丁的摘要和目标路径；
- Rust App Server、Capabilities、Host 与前端 lint/test 已通过。

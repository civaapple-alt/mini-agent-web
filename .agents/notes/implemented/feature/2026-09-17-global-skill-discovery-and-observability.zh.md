# 全局 Skill 发现、按需加载与阶段状态

状态：implemented

## Decision

WebStudio 不建立第二套 Skill 扫描器。它消费当前 Project runtime 的
`capabilityManifest`；Mini Agent 负责从项目 `.agents/skills`、用户
`%USERPROFILE%/.agents/skills`、用户 `%USERPROFILE%/.mini-agent/skills` 和
同步的 builtin group 发现 Skill。SkillPanel、`$` 补全和 `/api/skills` 都只使用
这份有界 catalog。

优先级为 project > Agent Skills user > Mini Agent user > builtin > plugin。
pstack 的规范名保留 `pstack:<skill>`，兼容别名由 runtime 返回；面板可以展示
来源、分组、规范名和简介，但不接触路径或正文。

## Observable contract

普通 metadata-first Turn 不预加载 Skill 正文。模型首次通过 `read_file` 读取
启用 Skill 的 `SKILL.md` 时，App Server 在读取前发送
`skills_loaded(phase=started, activation=on_demand)`，读取成功后发送
`skills_loaded(phase=loaded)`；失败发送既有 `skills_load_failed`。同一 Turn 的
相同 qualified name 合并为一个状态块，references、scripts、assets 和其他关联
文件不单独生成技能事件。旧事件缺少 `phase` 时按 `loaded` 显示。

`+ pstack` 仍只激活当前 Turn 的 Skill Group 元数据；`$pstack:skill` 才显式
加载指定正文。Gateway 原样转发并保留 replay，前端把阶段事件合并为“正在加载技能”
或“已加载技能”的单一轻量行。

## Consequences

启用 Skill 的实际根目录仍由 Host 作为独立只读根管理。面板不会因为全局发现而
获得文件系统权限，脚本也不会因为可读而自动执行。刷新后状态依赖 runtime 的
有界 replay，而不是 WebStudio 的本地推断。

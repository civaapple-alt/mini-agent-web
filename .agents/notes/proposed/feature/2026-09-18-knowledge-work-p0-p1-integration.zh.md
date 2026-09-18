# Knowledge Work Builtin Skill P0/P1 短期接入提案

- status: proposed
- date: 2026-09-18
- scope: `mini-agent-web` 的 Builtin Skill 资源、Gateway 同步、Project 配置、WebStudio Catalog 和 P0/P1 场景验证

本提案是长期架构提案的第一批实现切片。长期能力分级、领域接入顺序和资源模型见
[Builtin knowledge-work 技能组长期演进提案](../architecture/2026-09-18-builtin-knowledge-work-skill-group.zh.md)。

## 结论

在现有 Builtin Skill 管道上增加 `knowledge-work` 可行。当前 Project 配置、运行时
Catalog、Skill 数量限制和正文读取限制已经支持多组概念。实现主要集中在三处：

- 将 `server/builtin_skills.py` 的单组同步改为多组同步；
- 移除 `server/routes/world_projects.py` 和 `frontend/src/components/SkillPanel.jsx`
  中的 pstack 特例；
- 为导入器、Gateway、前端 Catalog 和 P1 mock-provider 场景补测试。

`InputBar.jsx` 和 `skillTokens.js` 已经按运行时 `skillGroups` 工作。P0 不重写这两处，
只增加多组场景测试。

## 目标

在不引入外部 MCP 和系统写入的前提下，把 Knowledge Work Plugins 的第一批知识能力
作为 `knowledge-work` Builtin Skill Group 接入 Mini Agent。短期只交付 P0 和 P1：
资源可发现、正文可按需读取，以及基于本地输入的产品、效率和数据工作流。

源仓库：

`D:\gh-ws\skill-ws\knowledge-work-plugins`

[打开 Knowledge Work Plugins 本地仓库](D:/gh-ws/skill-ws/knowledge-work-plugins/README.md)

实现时必须记录源仓库 commit。当前调查快照为：

`bdf7160f2b33598fb0cb3860027e033cbaec7ce6`

该值只描述提案调查时的快照。导入器必须在每次生成资源时记录实际 commit，而不能
永久使用此值。

## 现状证据

| 结论 | 证据 | 对本提案的影响 |
| --- | --- | --- |
| 同步器当前只有一个 group | `server/builtin_skills.py` 使用 `GROUP_NAME = "pstack"`，但已经有版本、内容 hash、临时目录、原子替换和失败回滚 | 泛化现有同步流程，不新增第二套同步器 |
| Project 和运行时已有多组管道 | `builtin_skill_groups` 已进入 Project 配置和运行时环境，当前上限为 8 个 group | P0 不新增配置字段或执行循环 |
| 运行时已有边界 | Catalog 最多 64 个 Skill，激活正文合计最多 32 KiB，受信读取输出最多 64 KiB | 导入器和 P1 场景必须遵守现有限制 |
| WebStudio 仍有 pstack 特例 | `world_projects.py` 会补注入 pstack；`SkillPanel.jsx` 有 pstack 默认卡片、排序、开关和提示 | P0 必须移除这两处特例 |
| 加号入口和 `$` 解析已经通用 | `InputBar.jsx` 使用运行时 `skillGroups`，`skillTokens.js` 按 group id 解析 | P0 只补多组测试，不重写解析链路 |
| 首批资源规模可控 | 源仓库共有 252 个 `SKILL.md`；`product-management` 有 8 个，`productivity` 有 4 个，`data` 有 10 个 | 首批只整理三个岗位级入口 |

资源数量可以用下面的命令重新核验：

```powershell
$source = 'D:\gh-ws\skill-ws\knowledge-work-plugins'
Get-ChildItem -Recurse -Filter SKILL.md $source | Measure-Object
Get-ChildItem -Recurse -Filter SKILL.md "$source\product-management" | Measure-Object
Get-ChildItem -Recurse -Filter SKILL.md "$source\productivity" | Measure-Object
Get-ChildItem -Recurse -Filter SKILL.md "$source\data" | Measure-Object
```

## 短期范围

首批只整理三个岗位级入口：

- `knowledge-work:product-management`
- `knowledge-work:productivity`
- `knowledge-work:data`

每个入口保留简短的 `SKILL.md` 和必要的 `references/`。首批内容包括：

| 入口 | P1 能力 |
| --- | --- |
| `product-management` | PRD、用户故事、范围控制、Roadmap、研究综合、指标复盘、Stakeholder 更新和产品头脑风暴 |
| `productivity` | 本地任务整理、工作简报、术语和项目上下文整理 |
| `data` | SQL 草稿、数据探索、指标解释、图表建议和分析验证 |

资源只提供知识和工作流。不要复制 `.mcp.json`、Claude 命令、hooks、插件 manifest
或外部系统写入逻辑。

## P0：Builtin Group 基础

### 交付内容

1. 将 `server/builtin_skills.py` 的单一 pstack 同步改成可处理多个 group。
2. 新增 `resources/builtin-skills/knowledge-work`。
3. 为每个 group 生成独立的版本、源 commit 和内容 hash marker。
4. 保持 pstack 的默认行为、目标目录和失败回滚行为不变。
5. 继续使用现有 Project 配置：

   ```json
   {
     "builtin_skill_groups": ["pstack", "knowledge-work"]
   }
   ```

6. 将 `world_projects.py` 的 pstack fallback 改为通用的资源组元数据补全：manifest
   中已有的 group 以运行时内容为准；资源目录中可用但未启用的 group 以
   `enabled: false` 展示，供用户重新启用。不为 pstack 单独维护 fallback。
7. 将 `SkillPanel.jsx` 的组卡片、开关、排序、提示和 Skill 标签改为通用逻辑。
8. 保留 `InputBar.jsx` 和 `skillTokens.js` 的现有 Catalog 驱动逻辑，并增加
   pstack 与 knowledge-work 并存时的测试。
9. 为 `knowledge-work` 增加发现、显式激活、禁用、未知 group 和失败事件测试。

### P0 不包含

- 默认打开 `knowledge-work`；
- 连接 Slack、Linear、Notion、Amplitude 或其他 MCP；
- 外部系统写入；
- 完整导入所有 Knowledge Work 叶子 Skill；
- 新增 JSON-RPC 字段或新的执行循环；
- 重写已经按 Catalog 工作的 `$` 解析和加号入口。

### P0 验收标准

| ID | Given | When | 可观察 trace | 反例 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P0-01 | 资源目录同时包含 pstack 和 knowledge-work | 运行同步器 | 两个 group 都有独立 marker、目标目录和同步结果 | knowledge-work 同步失败时 pstack 目标目录内容和 marker 不变 | Gateway 单元测试，检查目录、marker 和 hash |
| P0-02 | pstack 已同步，knowledge-work 内容发生变化 | 再次运行同步器 | 只有 knowledge-work 被原子替换 | pstack 的文件、hash 和 marker 不变 | 同步器隔离测试 |
| P0-03 | Project 启用两个 group | 请求 `/api/skills` 并打开 Skill 面板 | 返回真实 group；面板显示两个通用 group 卡片 | manifest 缺少某个 group 时，路由只按资源组元数据补充 disabled 条目，不为 pstack 单独注入 | Gateway 路由测试和前端组件测试 |
| P0-04 | Project 只启用 knowledge-work | 使用 `+ knowledge-work` 或 `$knowledge-work:data` | 事件包含正确的 group 和 Skill 标识；正文只在需要时读取 | 使用未知 group 或被禁用 group 时不读取正文、不执行对应 Skill | Catalog、激活和 fail-closed 测试 |
| P0-05 | 同步器已完成一次同步 | 重复运行同步器 | 返回无变化结果，不产生不必要的替换 | 内容未变化但 target 被重新删除和复制 | 幂等测试和文件 hash 检查 |
| P0-06 | 已选 Skill 正文需要进入当前 Turn | 完成一次带 Skill 的请求 | 正文只存在于受限的当前 Turn 上下文 | 正文出现在后续会话历史或全局 system prompt | Harness 场景、事件和历史断言 |
| P0-07 | 导入源仓库存在未提交变更，或入口缺少许可证 | 运行导入器 | 导入器失败并说明目录、commit 或许可证问题 | 导入器继续生成无法追溯的资源 | 导入器失败测试 |

## P1：本地只读工作流

### 交付内容

1. `product-management` 支持从用户文本、附件和项目文件生成 PRD、Roadmap 摘要、
   研究综合和指标复盘。
2. `productivity` 支持整理本地任务、会议输入和工作上下文，但外部同步只输出建议。
3. `data` 支持用户粘贴 SQL、CSV 或分析结果，并生成查询草稿、分析说明和验证清单。
4. 所有输出都明确区分输入事实、推断、建议和缺失信息。
5. 通过 `read_file` 按需读取 references，不在发现阶段预加载整组正文。
6. P1 只生成回答、报告、计划和草稿，不自动发送、发布、付款或更新外部系统。

### P1 验收方法

P1 的输出结构属于模型行为。单元测试和静态 lint 不能证明这些场景已经可用。
实现必须增加 deterministic mock-provider Harness 场景。场景固定输入、允许读取的
Skill、工具调用和模型响应，断言结果结构、读取范围、事件和禁止的副作用。

测试不得依赖付费 Provider 或真实 MCP 登录。真实 Provider 只用于人工体验验证，
不作为合并门槛。

### P1 验收场景

| ID | Given | When | 可观察 trace | 反例 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P1-01 | 用户输入“为团队做一个统一搜索功能” | 激活 `$knowledge-work:product-management` | 输出包含 Goals、Non-goals、User Stories、Acceptance Criteria 和 Open Questions；事件显示只读取必要正文 | 把假设写成输入事实，或自动创建项目任务 | mock-provider Harness 场景和结构断言 |
| P1-02 | 用户提供任务列表和会议记录 | 激活 `$knowledge-work:productivity` | 输出任务、阻塞项、待跟进项和缺失信息；不调用外部写入工具 | 自动改动日历、任务系统或发送提醒 | mock-provider Harness 场景和副作用断言 |
| P1-03 | 用户提供业务问题、SQL 片段和 CSV 摘要 | 激活 `$knowledge-work:data` | 输出 SQL 草稿、数据定义、验证点和结论限制 | 在没有数据口径时给出确定性业务结论，或连接未授权数据源 | mock-provider Harness 场景和读取事件断言 |
| P1-04 | `knowledge-work` 被 Project 关闭 | 请求上述三个入口 | 请求 fail closed，并记录禁用原因 | 通过别名或旧 Catalog 缓存绕过 Project 开关 | Gateway、Host 和 Harness 场景 |
| P1-05 | 入口 `SKILL.md` 或 references 超过运行时可用预算 | 导入或执行对应场景 | 导入器或运行时拒绝并给出大小信息 | 截断正文后继续生成看似完整的结果 | 导入预检和运行时边界测试 |

## 资源导入和边界

### 导入器

导入器必须可重复运行，并接收源仓库路径和 commit。默认拒绝 dirty source tree。
只有显式的开发覆盖选项可以导入未提交内容，覆盖信息必须写入生成记录。

每次生成至少记录以下信息：

- 源仓库路径和 commit；
- 原始目录和目标 group；
- 版本和内容 hash；
- 导入时间；
- 适用的 LICENSE、NOTICE 和依赖许可证检查结果。

当前首批三个源目录均包含 LICENSE。导入器仍必须逐目录读取并检查许可证内容，不能
根据父目录名称推断许可证类型。缺少许可证或 NOTICE 要求未满足时，导入失败。

### 大小检查

当前运行时限制仍是最终边界：激活正文合计最多 32 KiB，单次受信读取输出最多
64 KiB。导入器应计算每个入口的 `SKILL.md` 大小、references 文件大小和默认读取
计划，并在默认计划无法满足这些限制时失败。

references 的目录总大小不直接等同于一次读取的 64 KiB 限制，因为 references 是
按需读取的。导入器必须检查可执行的读取计划，运行时仍需保留最终的拒绝逻辑。

### 内容边界

资源中不得包含：

- `.mcp.json` 或连接器凭据；
- Claude 命令、hooks、sub-agent 或插件 manifest；
- 自动发送、发布、付款、过账或更新外部系统的逻辑；
- 要求模型跳过 Host 权限、审批或受信读取边界的指令。

## 建议实现顺序

1. 添加可重复运行的 Knowledge Work 导入器，并实现 source commit、许可证和大小预检。
2. 从源仓库提取三个岗位入口和必要 references。
3. 保留 Apache License 2.0、NOTICE 和源仓库地址，并写入生成记录。
4. 泛化 Builtin Skill 同步器，为每个 group 保留独立 marker。
5. 移除 `world_projects.py` 和 `SkillPanel.jsx` 中的 pstack 特例。
6. 增加 Gateway、前端、Catalog、Host 和 mock-provider Harness 测试。
7. 运行验证命令，检查预算、diff 和生成资源，再评估 P2 只读连接器。

## 所有权和六问准入

### 所有权

| 层 | 责任 | 本批次是否修改 |
| --- | --- | --- |
| 源仓库 | 维护 Knowledge Work 原始知识和许可证 | 否 |
| `resources/builtin-skills` | 保存经过审查的生成资源 | 是 |
| Gateway | 同步 group、保存 Project 选择、返回 Catalog | 是 |
| WebStudio | 消费运行时 Catalog 和事件 | 是 |
| Host、App Server、Capabilities | 校验名称、读取受信内容、执行权限和副作用控制 | 仅增加测试，不改变职责 |
| Core、Protocol | 模型回合、事件和协议契约 | 否 |

### 六问

1. **变更属于哪一层？** 资源导入、Gateway 同步、Project 配置和 WebStudio UI 属于
   `mini-agent-web`。Host 和 App Server 只复用已有的多组 Skill 契约。Core、Protocol
   不增加新概念。
2. **是否已有同一职责？** 源仓库是知识内容的唯一来源。运行时 Catalog 是 Skill
   清单的唯一来源。WebStudio 不再维护 pstack 或 knowledge-work 的第二份清单。
3. **能否删除旧概念？** 删除单一 `GROUP_NAME`、`world_projects.py` 的 pstack
   fallback，以及 `SkillPanel.jsx` 的 pstack 专用分支。保留 pstack 作为默认 group，
   因为 Project 默认行为仍需要它。
4. **预算是多少？** 2026-09-18 基线为：`builtin_skills.py` 99 行，
   `world_projects.py` 133 行，Builtin Skill 测试 36 行，`SkillPanel.jsx` 174 行，
   `InputBar.jsx` 1094 行，`skillTokens.js` 123 行。实现目标是删除 pstack 特例后
   在这些现有文件中保持净增长接近零；新增导入器和 Harness 测试必须单独记录增量。
   本批次不修改 Rust Core、Protocol 或公共 JSON-RPC 契约，因此这些部分的 delta 为 0。
5. **是否扩大模型可见输入、事件、持久化或公共协议？** 不新增公共协议字段。Catalog
   只增加可选 group 和三个岗位入口。正文仍按当前 Turn 按需读取，并遵守现有大小限制。
6. **已有边界测试是否足够？** 现有 pstack 同步和前端测试不能覆盖多组隔离、未知 group、
   许可证失败、mock-provider 输出和正文生命周期。P0/P1 必须补上表中的证据。

## 验证命令

文档和导入资源变更后运行：

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

同时执行：

```bash
git diff --check
```

验证不得依赖付费 Provider，也不应要求真实 MCP 登录。P1 必须运行 deterministic
mock-provider Harness 场景。

## 实施记录

2026-09-18 的实现已完成 P0 基础和 P1 资源边界：

- `server/builtin_skills.py` 已按资源组元数据同步多个 group，并为每个 group 保留
  独立的版本、源 commit、内容 hash、原子替换和失败回滚记录；
- `knowledge-work` 已导入 `product-management`、`productivity` 和 `data` 三个入口，
  导入器执行 source commit、逐目录许可证和大小预算检查；
- Gateway、SkillPanel、加号入口和 `$` 激活路径已改为通用 group 逻辑，未知或禁用
  group 继续 fail closed；
- Host/Capabilities 已按启用的 group 发现 builtin Skill，且不改变 Core/Protocol；
- 已有 Gateway、前端、Capabilities 和 Host 测试覆盖多组隔离、Catalog 展示、显式激活、
  未知 group、幂等同步和 group id 边界。

P1 的三个 mock-provider Harness 场景仍是合并前的证据门槛；在这些场景补齐前，本提案
不把模型输出结构宣称为已验证完成。实现提交不得使用付费 Provider 或真实 MCP 登录。

## 后续明确不纳入本短期提案的能力

- sales、marketing、customer-support、human-resources、legal、finance 和
  small-business 的完整导入；
- CRM、项目管理、客服、邮件、日历和 Slack 写入；
- 财务分录、付款、薪酬、合同正式 redline 和法律结论；
- 后台调度、自动发送和无人值守执行。

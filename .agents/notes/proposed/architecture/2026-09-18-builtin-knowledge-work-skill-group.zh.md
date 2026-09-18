# Builtin knowledge-work 技能组长期演进提案

- status: proposed
- date: 2026-09-18
- scope: WebStudio、Gateway、Builtin Skill discovery，以及与 App Server 的现有 Skill 契约

## 摘要

将 Knowledge Work Plugins 的稳定知识内容整理为 Mini Agent 的
`knowledge-work` Builtin Skill Group。该组与 `pstack` 使用同一套发现、按需读取、
Project 开关和事件投影机制，但不把 Claude 插件运行时、MCP 配置、命令、hooks 或
外部写入权限带入 Mini Agent。

长期目标是让 Mini Agent 按阶段提供知识工作能力：先做受边界约束的本地分析和文档
生成，再接入只读连接器，最后在独立审批和审计边界内支持外部系统写入。财务、法务、
人事和付款类能力不进入默认工作流。

## 来源

Knowledge Work Plugins 的本地源仓库：

`D:\gh-ws\skill-ws\knowledge-work-plugins`

[打开源仓库 README](D:/gh-ws/skill-ws/knowledge-work-plugins/README.md)

当前 pstack 资源位于：

`resources/builtin-skills/pstack`

同步和运行时契约见：

- [`docs/skills.md`](../../../../docs/skills.md)
- [`server/builtin_skills.py`](../../../../server/builtin_skills.py)

## 背景和问题

Knowledge Work Plugins 是 Claude/Cowork 的文件型插件集合。它同时包含技能、命令、
MCP 配置、连接器说明和岗位工作流。Mini Agent 当前只需要其中的知识和工作流说明，
不能直接执行插件生态中的其他运行时部件。

当前 pstack 的资源同步已经具备版本标记、源哈希、临时目录和原子替换。但同步器、
Project 默认值和部分 WebStudio 入口仍以 `pstack` 为特例。增加
`knowledge-work` 前，应先把这些位置改成通用的 Builtin Skill Group 处理。

## 目标

- 允许多个 Builtin Skill Group 独立同步、发现、启用和关闭。
- 将 Knowledge Work Plugins 的内容整理成受控、可审查、可重复生成的资源。
- 保持 metadata-first discovery，正文只在当前 Turn 按需读取。
- 保持现有 Skill 数量、正文大小、读取输出和 Project 开关限制。
- 让 WebStudio 使用运行时 Catalog，而不是维护第二份 Skill 清单。
- 让每个能力阶段都有明确的来源、权限、证据和验收标准。
- 保留源仓库的许可证和必要的 NOTICE 信息。

## 非目标

- 不把整个 Knowledge Work Plugins 仓库原样复制到运行时。
- 不安装或自动启用 `.mcp.json` 中的外部服务。
- 不执行插件的 Claude 命令、hooks、sub-agent 或客户端专属逻辑。
- 不在 Core 中增加岗位路由器、连接器策略或外部系统权限。
- 不把所有叶子 Skill 平铺到一个无限增长的 Catalog。
- 不默认启用财务、法务、人事、付款或其他高风险写入流程。

## 资源模型

第一版采用一个 `knowledge-work` 组和岗位级入口 Skill。每个入口可以带有受控的
`references/` 目录，细分的工作流在需要时读取。

```text
resources/builtin-skills/knowledge-work/
├── productivity/
│   ├── SKILL.md
│   └── references/
├── product-management/
│   ├── SKILL.md
│   └── references/
├── data/
│   ├── SKILL.md
│   └── references/
├── sales/
├── marketing/
├── customer-support/
├── human-resources/
├── legal/
└── finance/
```

岗位级入口负责识别请求、选择工作流和说明输出边界。细分内容通过
`read_file` 从当前 Skill 的受信任只读根按需读取。该结构避免把 Knowledge Work
Plugins 的一百多个叶子技能全部暴露给模型和 WebStudio。

Canonical names 使用 `knowledge-work:<skill>`。例如：

```text
$knowledge-work:product-management
$knowledge-work:data
+ knowledge-work
```

`+ knowledge-work` 只传递组元数据。它不预加载所有岗位正文。

## 能力分级

| 级别 | 能力 | 主要内容 | 默认状态 |
| --- | --- | --- | --- |
| P0 | 内置资源和 Skill 入口 | 多组同步、Catalog、显式激活、按需读取、事件 | 可选启用 |
| P1 | 本地只读分析 | PRD、Roadmap、研究综合、SQL 草稿、指标解释、文档草稿 | 可选启用 |
| P2 | 只读连接器 | Linear、Notion、Figma、Amplitude、Intercom、Slack 等只读上下文 | 单独启用 |
| P3 | 可执行业务产物 | 工程任务、周报、销售邮件草稿、客服升级单、营销 Brief | 预览优先 |
| P4 | 外部系统写入 | 更新任务、CRM、客服系统、Slack、日历和文档 | 显式审批 |
| P5 | 高风险工作流 | 分录、付款、合同正式处理、薪酬和员工敏感数据 | 默认关闭 |

P0 和 P1 是本提案的最小落地面。P2 以后需要单独的连接器、权限、证据和失败恢复
设计，不能因为 Skill 文本提到了某个系统就自动获得该系统的能力。

## 推荐的领域接入顺序

领域接入顺序同时考虑用户价值、数据敏感度、外部副作用和验证成本。先接入能够在
本地输入上完成分析和文档生成的领域，再接入只读连接器，最后处理外部写入和高风险
业务流程。

| 顺序 | 领域 | 首批边界 | 主要原因 |
| --- | --- | --- | --- |
| 1 | `product-management` | PRD、Roadmap、研究综合、指标复盘和产品头脑风暴 | 与当前项目协作最接近，价值清晰，容易用本地材料验证 |
| 2 | `productivity` | 本地任务、工作简报和项目上下文 | 可以形成日常使用闭环，初期不需要外部写入 |
| 3 | `data` | SQL 草稿、数据探索、图表建议和分析验证 | 能先处理 CSV、Excel 和文本结果，再接入数据仓库 |
| 4 | `marketing` | 内容、Campaign、品牌审查、SEO 和竞争简报 | 以草稿和分析为主，外部副作用较低 |
| 5 | `customer-support` | 工单分类、问题研究、回复草稿、升级单和知识库文章 | 能先用工单和文档验证，发送和更新仍保持审批 |
| 6 | `sales` | 账户研究、会议准备、通话总结、Pipeline 和 Forecast | 只读销售上下文容易接入，CRM 写入需要单独的幂等和审批设计 |
| 7 | `human-resources` | 招聘、入职、政策查询、绩效和组织报告 | 涉及员工和候选人隐私，需要更严格的数据边界 |
| 8 | `legal` | 合同风险标注、NDA 预审、供应商协议查询和合规材料整理 | 输出可能影响法律决策，必须保留管辖区和专业复核边界 |
| 9 | `finance` | 财务分析、对账说明、结账清单和审计材料草稿 | 涉及账务、审计和正式报表，写入能力应后置 |
| 10 | `small-business` | 跨财务、销售、营销、运营和招聘的自然语言路由 | 它组合多个高风险领域，应在基础领域稳定后接入 |

首个可交付批次采用顺序中的前三项。`small-business` 不作为第一批入口，因为它会
同时引入多个领域的路由、审批和数据边界。

## 各领域的使用方式和能力

### Product management

使用 `$knowledge-work:product-management`，或在当前 Turn 中使用
`+ knowledge-work` 让模型按请求选择该领域。

它处理从问题发现到产品沟通的主线工作：

- 从功能想法生成 PRD、User Stories、P0/P1/P2 需求、验收标准和 Open Questions；
- 创建或调整 Now/Next/Later、季度主题和 OKR Roadmap；
- 综合访谈、问卷、Support Ticket 和行为数据，提取主题、Persona 和机会点；
- 复盘 Activation、Conversion、Retention、Adoption 和其他产品指标；
- 生成面向管理层、工程团队、客户或董事会的状态更新；
- 通过 How Might We、JTBD、Opportunity Solution Tree 和 First Principles 进行产品头脑风暴。

P1 只读取用户提供的文本、附件和项目文件，输出 PRD、Roadmap 摘要、研究报告和
决策草稿。它不直接更新 Linear、Jira 或其他项目系统。

### Productivity

使用 `$knowledge-work:productivity` 管理个人和团队工作上下文。

它可以：

- 整理本地任务列表和待办事项；
- 识别过期任务、阻塞项和需要跟进的人；
- 根据会议记录、邮件文本和用户输入生成工作简报；
- 维护人员、项目、缩写和团队术语的有限上下文；
- 生成任务看板或日常工作摘要。

第一阶段只处理本地任务和用户提供的输入。外部任务同步、邮件发送和日历变更属于
后续连接器和审批能力。

### Data

使用 `$knowledge-work:data` 进行数据分析准备和结果复核。

它可以：

- 根据业务问题编写 SQL 草稿；
- 探索 CSV、Excel 或用户粘贴的查询结果；
- 检查字段质量、缺失值、异常值和分组口径；
- 设计趋势、留存、转化和分群分析；
- 提供图表和 Dashboard 结构建议；
- 检查聚合逻辑、分母、偏差和结论中的限制。

第一阶段不直连数据仓库。后续接入 Snowflake、Databricks、BigQuery、Amplitude 或
其他分析系统时，先保持只读。

### Marketing

使用 `$knowledge-work:marketing` 生成营销内容和活动方案。

它可以：

- 起草博客、社交媒体、邮件、落地页和新闻稿；
- 制定 Campaign brief、渠道计划、内容日历和成功指标；
- 根据品牌声音、术语和目标受众审查内容；
- 生成竞争简报、定位比较和市场机会分析；
- 进行 SEO 审计、关键词整理和内容缺口分析；
- 生成营销效果报告和邮件序列草稿。

第一阶段只生成草稿和分析。发布内容、修改营销平台和发送邮件需要单独审批。

### Customer support

使用 `$knowledge-work:customer-support` 处理客户问题的整理和回复准备。

它可以：

- 对工单进行分类、P1-P4 优先级判断和路由建议；
- 从知识库、历史对话、CRM 和项目记录中研究客户问题；
- 生成带来源和置信度的回答；
- 起草客户回复；
- 整理面向工程、产品或管理层的升级单；
- 从已解决问题生成知识库文章。

第一阶段不自动回复客户、不自动关闭工单，也不直接创建工程任务。输出需要保留
客户上下文、证据和缺失信息。

### Sales

使用 `$knowledge-work:sales` 支持销售准备、客户研究和 Pipeline 分析。

它可以：

- 生成销售日报、周报和会议准备材料；
- 研究账户、联系人、利益相关者和竞争对手；
- 将通话记录整理为总结、跟进邮件草稿和 CRM 更新建议；
- 分析 Deal health、Pipeline coverage、阶段停滞和 Forecast；
- 识别续约风险、客户健康度和扩展机会；
- 生成个性化外联和异议处理建议。

第一阶段支持用户粘贴通话记录或上传 Pipeline 文件。CRM 更新、邮件发送和会议预约
需要后续的 connector write 能力、审批和幂等操作。

### Human resources

使用 `$knowledge-work:human-resources` 处理 People Operations 工作流。

它可以：

- 生成职位描述、Offer 草稿和入职清单；
- 组织招聘漏斗、面试计划和候选人评分卡；
- 准备绩效评估、自评和校准材料；
- 查询 PTO、福利、差旅和远程办公政策；
- 进行薪酬区间、市场对标和组织规划分析；
- 生成 Headcount、Attrition 和组织健康报告。

该领域涉及员工和候选人个人信息。首批只处理用户提供的脱敏材料或本地文档，不能
默认读取 HRIS、ATS 或薪酬系统。

### Legal

使用 `$knowledge-work:legal` 进行法务材料整理和风险预审。

它可以：

- 按组织 playbook 逐条检查合同；
- 标记 GREEN、YELLOW 和 RED 风险；
- 生成需要人工复核的修改建议；
- 对 NDA 做标准条款预审和升级分类；
- 查询供应商协议、NDA、MSA、DPA 和到期时间；
- 整理隐私、合规、数据主体请求和法律会议材料；
- 根据批准的模板起草常见回复。

该领域不提供正式法律意见。组织需要先配置适用的管辖区、标准条款、可接受范围和
升级条件。正式 redline、签署和法律结论必须由合格的法律人员复核。

### Finance

使用 `$knowledge-work:finance` 支持会计和财务分析准备。

它可以：

- 准备应计、预付、固定资产、工资和收入类分录草稿；
- 比较总账、子账、银行或第三方余额；
- 生成损益表、资产负债表和现金流分析草稿；
- 分解收入、成本和预算差异；
- 生成月末结账清单和状态说明；
- 准备 SOX 控制测试和审计工作底稿草稿。

第一阶段只生成分析和工作底稿。分录过账、报表发布、付款和审计结论需要专业人员
复核、明确审批和完整审计记录。

### Small business

使用 `$knowledge-work:small-business` 作为小企业经营事务的自然语言入口。

它可以路由到多个基础领域：

- 财务和现金流；
- 销售、线索和 CRM；
- 营销、广告、SEO 和社交内容；
- 客户投诉和工单；
- 库存和补货；
- 招聘和职位描述；
- 业务简报、报告和重复工作自动化。

它的价值在于减少用户对具体 Skill 名称的依赖。它的风险也更高，因为一个请求可能
跨越付款、客户数据、营销发布和员工信息。该入口应在底层领域能力、审批、证据和
错误恢复稳定后再接入。任何发送、发布、付款或系统写入都必须停在明确批准点。

## 模块和所有权

```text
Knowledge Work source repository
    ↓ curated import/generator
mini-agent-web/resources/builtin-skills/knowledge-work
    ↓ Gateway startup sync
~/.mini-agent/skills/builtin/knowledge-work
    ↓ App Server capability discovery
Host validates and reads selected SKILL.md
    ↓ bounded temporary Turn context
Model produces an analysis or draft
```

- 源仓库维护外部领域知识。
- 导入工具负责选择目录、压缩内容、重写 front matter、保留许可证并检查边界。
- Web Gateway 只负责资源同步和 Project 配置，不扫描并生成第二份 Skill Catalog。
- App Server 和 Capabilities 负责发现、名称校验、受信任读取和事件。
- Host 负责当前 Turn 的正文加载、工具权限、审批和副作用。
- WebStudio 只消费运行时的 Catalog 和事件。

## 同步器设计

将 `server/builtin_skills.py` 从单一 `GROUP_NAME` 改为 Builtin Group 目录表或资源
发现器。每个 group 独立拥有：

- `id`；
- `version`；
- `source_hash`；
- source directory；
- target directory；
- marker 文件。

同步必须保持以下性质：

- 单个 group 内容变化不会替换其他 group；
- 重复启动不重复写入；
- 复制失败时保留旧版本；
- 新版本通过临时目录和原子替换生效；
- 运行时只发现同步后的目录，不读取源仓库路径。

## Project 和 UI 契约

Project 继续保存：

```json
{
  "builtin_skill_groups": ["pstack", "knowledge-work"]
}
```

新 Project 默认仍只启用 `pstack`。用户明确启用后，Gateway 将两个 group 传给运行时。
WebStudio 的 Skill 面板和加号入口必须依据 Catalog 渲染 group，不再硬编码 pstack
之外的第二套逻辑。

未知、禁用或不存在的 group 必须 fail closed。Group 配置变更继续遵守当前 Turn 和
审批活动期间的冲突保护。

## 许可证和来源

Knowledge Work Plugins 根目录和相关插件目录包含 Apache License 2.0 文件。导入的
资源必须保留适用的 LICENSE、NOTICE 和源仓库地址。转换后的 Skill 应在资源说明中
记录原始目录和生成方式，避免后续更新时失去出处。

## 备选方案

### 方案 A：一个 group，岗位级入口

选择该方案。它保持一个清晰的 `knowledge-work` 开关，Catalog 小，适合当前的
metadata-first 加载和 64 个 Skill 上限。

### 方案 B：每个岗位一个 Builtin Group

不作为默认方案。当前运行时最多暴露 8 个 Builtin Group，而 Knowledge Work 的岗位
种类超过这个数量。Project 设置也会变成一组容易失控的开关。

### 方案 C：把所有叶子 Skill 平铺

不采用。`sales` 和 `small-business` 已经包含大量细分技能，和其他岗位合并后会
超过当前 Catalog 上限，并增加名称冲突和选择噪声。

## 分阶段路线

1. **P0：通用 group 基础**
   - 泛化同步器；
   - 增加 `knowledge-work` 资源目录；
   - 增加岗位级 Catalog；
   - 保留 pstack 默认启用；
   - 完成 UI、协议和事件的通用化测试。
2. **P1：本地只读工作流**
   - 首批接入 `product-management`、`productivity` 和 `data`；
   - 支持手工输入、文本附件和本地文件上下文；
   - 只生成分析、计划、报告和草稿；
   - 不安装 Knowledge Work 的 MCP 和外部写入能力。
3. **P2：只读连接器**
   - 按领域接入项目、文档、设计、分析和反馈系统；
   - 记录来源、缺失数据和置信度；
   - 为连接器不可用和权限不足增加降级证据。
4. **P3：受控业务产物**
   - 生成可导入的工程任务、周报、客服升级单和销售草稿；
   - 默认预览，写入仍由用户确认。
5. **P4/P5：写入和高风险工作流**
   - 为每个外部系统建立审批、幂等、审计和失败恢复契约；
   - 财务、法务、人事和付款能力单独评审，不随普通 group 默认发布。

## 主要风险

- 外部 Skill 内容更新后与 Mini Agent 资源版本不同步；
- 岗位级入口过大，触发正文或读取输出限制；
- 不同岗位出现相同的短名称；
- 用户误以为配置了 MCP 就等于获得了连接器权限；
- 高风险岗位内容被误用于正式法律、财务或人事决策；
- 一个 group 内包含过多领域，导致模型选择错误。

导入工具、资源边界和每阶段的受控测试是这些风险的主要缓解手段。

## 验收方向

- pstack 和 knowledge-work 可以独立同步和升级；
- `GET /api/skills` 返回真实的 group 和 Skill Catalog；
- `$knowledge-work:product-management` 能显式加载正文；
- `+ knowledge-work` 只激活 group 元数据并按需读取；
- 禁用 group 后，UI 和 Host 都拒绝对应入口；
- Skill 正文不会进入后续 Turn 或全局 system prompt；
- 外部 MCP、命令、hooks 和写入权限不会因资源导入而自动出现；
- P0/P1 场景在无真实 Provider 的测试中可重复验证。

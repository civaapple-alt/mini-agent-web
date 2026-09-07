# ADR: Web Studio 状态持久化层拆分与解耦架构 (State Persistence Layer Decoupling)

* **日期**: 2026-09-07
* **状态**: Implemented
* **范围**: `server` Gateway (`SessionManager`, `routes`), `tests`
* **上下文**: Web Studio 早期持久化方案使用单个单体文件 `~/.mini-agent/web/state.json` 同时记录全局设置、工作区项目注册表以及所有项目的会话元数据（`thread_metadata`）。随着项目数与多线程会话的增加，单文件承担了过高的读写频次，带来了并发写冲突、配置覆盖与项目会话归属错位等隐患。经方案评估，决定将状态层彻底解耦为三层独立存储，引入原子文件替换保障，并彻底清除遗留兼容逻辑，实现高内聚、低耦合、零外部依赖的轻量持久化体系。

---

## 1. 背景与问题动因 (Context & Motivation)

在多会话与多项目演进过程中，FastAPI Gateway 的 `SessionManager` 负责维护 Web Studio 运行时所需的全部持久化数据。此前所有数据均混杂存储在 `state.json` 中：

```json
// 旧版单体 state.json 结构
{
  "current_project_id": "pi-fx",
  "projects": { ... },
  "thread_metadata": { ... },
  "settings": { ... }
}
```

该模式在实际运行中暴露出以下核心痛点：

1. **高频读写与并发脏写隐患**：
   - 用户的交互行为（如修改会话标题、调整执行权限、切换偏好设置、接收后台会话流推送）都会触发对同一个 `state.json` 的全量序列化与落盘；
   - 当多个客户端或后台异步任务同时写回状态时，缺乏行级锁或细粒度隔离机制，极易发生写覆盖甚至写截断损坏。
2. **爆炸半径过大 (Blast Radius)**：
   - 任何一个会话元数据的异常写入或 JSON 序列化失败，都会导致全局配置与所有项目注册表无法加载，甚至使 Web Studio 无法启动。
3. **职责模糊与状态穿透**：
   - `settings` 属于全局运行时偏好（如主题、自动滚动、`reasoning_effort`）；
   - `projects` 属于工作区元信息；
   - `thread_metadata` 属于具体项目生命周期内的会话索引。
   - 三者生命周期与更新频率截然不同，硬性捆绑破坏了单一职责原则。
4. **项目重启与会话亲和性脆弱**：
   - 重启时，若项目主路径与目录基名存在自定义偏差（例如目录名为 `pi` 但项目注册 ID 为 `pi-fx`），单文件扫描容易误判为未注册项目，进而导致会话投影与项目归属错位。

---

## 2. 方案选型与评估 (Evaluation & Trade-offs)

针对上述问题，团队评估了三种演进路线：

| 方案 | 架构机制 | 优点 | 缺点 | 结论 |
| :--- | :--- | :--- | :--- | :---: |
| **方案 1：单体文件 + 进程/文件锁** | 在原 `state.json` 基础上增加跨进程/跨协程文件锁机制 | 改动范围小 | 依然存在高频 IO 瓶颈，锁竞争显著，爆炸半径未缩小 | 淘汰 |
| **方案 2：引入 SQLite 关系型存储** | 使用本地 `state.db`，通过表与事务保障隔离 | 天然支持并发与 ACID 事务 | 引入额外依赖与驱动，文件不具备直接人类可读性，破坏了 Mini Agent 极简透明的设计哲学 | 淘汰 |
| **方案 3：三层领域解耦的文件系统架构** | 按全局设置、项目注册、分项目会话三层目录切分，使用原子文件重命名写盘 | 职责彻底隔离、零外部依赖、人类可读、天然局部锁/局部写 | 需维护多文件路径与多层目录生命周期 | **采纳** |

---

## 3. 架构决策与设计 (Architectural Decisions)

### 3.1 存储目录与文件规约

将 `~/.mini-agent/web/`（或自定义 `MINI_AGENT_WEB_STATE_DIR`）划分为清晰的三层领域布局：

```text
~/.mini-agent/web/
├── settings.json                       # 1. 全局系统偏好与 UI 设置 (高频读、低频写)
├── projects.json                       # 2. 项目工作区注册表与当前活跃项目 ID (低频读写)
└── projects/                           # 3. 分项目隔离的会话元数据目录
    ├── <project_id_1>/
    │   └── threads.json                # 项目 1 专属会话元数据 (高频独立读写)
    ├── <project_id_2>/
    │   └── threads.json                # 项目 2 专属会话元数据
    └── ...
```

各文件承载的内容契约：
- **`settings.json`**：
  ```json
  {
    "theme": "dark",
    "reasoning_effort": "high",
    "access": "project",
    "approval": "per_action",
    "auto_scroll": true,
    "panel_collapsed": false
  }
  ```
- **`projects.json`**：
  ```json
  {
    "current_project_id": "pi-fx",
    "projects": {
      "pi-fx": {
        "id": "pi-fx",
        "name": "pi-fx",
        "primary_path": "/path/to/workspace",
        "source_folders": [{ "name": "pi-fx", "path": "/path/to/workspace", "is_primary": true }],
        "access": "project",
        "approval": "per_action",
        "pinned": false
      }
    }
  }
  ```
- **`projects/<project_id>/threads.json`**：
  ```json
  {
    "default": {
      "title": "默认会话 (Default Session)",
      "project": "pi-fx",
      "summary": "Main interactive coding workspace",
      "pinned": true,
      "created_at": "2026-09-07T08:00:00Z",
      "updated_at": "2026-09-07T08:00:00Z"
    }
  }
  ```

### 3.2 决策 1：文件写入原子性保障 (Atomic Writes)

为防止写操作中途断电、进程被 kill 或并发读取导致的文件损坏，实现通用的原子安全写函数 `_atomic_write_json`：
1. 先将内容写入目标目录下的同级临时文件 `file.tmp.<uuid>`；
2. 确保刷新操作系统缓存 (`flush()` + `os.fsync()`)；
3. 调用 `os.replace`（Windows 和 POSIX 系统均保证同卷文件原子重命名替换）；
4. 异常时清理未完成的临时文件。

### 3.3 决策 2：按需持久化与写放大消除 (Zero Write Amplification)

改造 `SessionManager` 的内部写路径，禁止调用全量无差别保存，建立细粒度写入方法：
- **`_save_settings()`**：当用户在设置面板调整偏好时，仅刷入 `settings.json`；
- **`_save_projects()`**：当创建项目、重命名项目或调整项目执行策略时，仅刷入 `projects.json`；
- **`_save_project_threads(project_id)`**：当特定会话的标题、置顶状态或元数据变更时，仅将该项目下的会话数据写入 `projects/<project_id>/threads.json`。其他项目的会话文件与全局配置文件的 mtime 毫秒不受影响。

### 3.4 决策 3：稳健的重启动态绑定与加载流

在 `_load_state()` 中按明确顺序依次加载：
1. **加载 `settings.json`**：按白名单加载设置项，缺失则保留系统默认值（如 `reasoning_effort: "high"`）；
2. **加载 `projects.json`**：载入项目列表与当前活跃项目 ID，并过滤不存在的临时测试目录；
3. **分区加载各项目的 `threads.json`**：遍历 `projects/` 目录下的子文件夹，将每个项目的会话元数据装配进内存中的 `_thread_metadata`；
4. **工作区目录自保底绑定**：检测当前工作区物理路径是否已在注册表中；若不在，则追加注册；若已注册（无论 ID 是否与目录基名相同），严格保持该项目与 `_current_project_id` 的绑定，杜绝重复创建；
5. **落盘当前必要状态**。

### 3.5 决策 4：纯粹精简，拒绝遗留兼容与迁移垫片 (No Legacy Shims)

为保持架构纯净与代码低熵（KISS 原则），团队达成共识：
- **不保留旧版 `state.json` 运行时自动迁移检测**；
- **不保留生成 `state.json.migrated` 归档备份逻辑**；
- **彻底移除兼容性的 `_state_file` 属性和 setter**；
- 系统的生产环境和测试套件直接基于新版多文件结构初始化与加载，确保新方案的代码路径精炼、确定、易于长期维护。

---

## 4. 架构拓扑与数据流 (Topology & Data Flow)

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           Web Studio Frontend                             │
│       ├── Settings Modal        ├── Project Switcher     ├── Chat / Threads│
└───────────────┬───────────────────────────┬───────────────────────┬───────┘
                │                           │                       │
                ▼                           ▼                       ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      FastAPI Gateway (SessionManager)                     │
│ ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────────┐ │
│ │   _save_settings()   │  │   _save_projects()   │  │_save_project_...()│ │
│ └──────────┬───────────┘  └──────────┬───────────┘  └─────────┬─────────┘ │
└────────────┼─────────────────────────┼────────────────────────┼───────────┘
             │ (atomic write)          │ (atomic write)         │ (atomic write)
             ▼                         ▼                        ▼
┌────────────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
│     settings.json      │  │    projects.json     │  │projects/<pid>/    │
│                        │  │                      │  │  threads.json     │
└────────────────────────┘  └──────────────────────┘  └───────────────────┘
```

---

## 5. 架构成效与验证 (Review & Verification)

### 5.1 收益对比

| 指标 | 旧版单体 `state.json` | 新版解耦架构 |
| :--- | :--- | :--- |
| **持久化粒度** | 全局单一粗粒度，任何修改全量覆写 | 细粒度三层解耦，按领域精准写入 |
| **写冲突与并发安全** | 极高，无并发保护，容易写丢失或覆写截断 | 领域隔离 + `os.replace` 原子替换，无截断风险 |
| **文件读写频率** | 随项目与会话线性叠加，极高频 | 各项目会话互不干扰，仅当对应领域变更时触发 |
| **爆炸半径** | 单文件损坏导致全局服务瘫痪 | 单项目损坏仅影响该项目会话，全局设置与注册表依然完整 |
| **可测试性** | 测试需要全量 mock 单个文件 | 各模块测试可独立注入与验证对应持久化文件 |

### 5.2 质量保障

- **自动化单测与集成测试**：
  - `tests/gateway/test_session_manager.py`：新增 `test_decoupled_persistence_isolation`，通过各文件的 `mtime_ns` 精确断言修改设置时仅 `settings.json` 更新，修改会话时仅对应项目的 `threads.json` 更新，修改权限时仅 `projects.json` 更新；
  - `test_session_manager_avoids_duplicate_project_for_custom_id_path`：断言自定义项目 ID 重启后不产生重复项目，且直接生成正确的解耦目录。
- **全栈回归通过**：
  - `uv run pytest -q`（64 项测试全部通过）；
  - `uv run ruff check .` 与 `uv run ruff format --check .` 校验零告警；
  - 前端 Lint、Vitest 及生产打包均 100% 通过。

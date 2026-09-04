# 持续集成 (CI) 流水线建设与日常 PR / Commit 门禁演进提案

- **日期**：2026-09-04
- **状态**：已实施 (Implemented)
- **作者**：Mini Agent Architecture & CI/CD Team
- **范围**：GitHub Actions CI 流水线建设、日常 PR / Commit 自动化门禁、版本同步一致性守卫

---

## 1. 背景与现状诊断

当前 `mini-agent-web` 已经建立了坚实的本地测试与质量防护基础：
1. **测试体系已实现领域模块化**：`tests/` 下划分了 `sdk/`、`gateway/`、`tui/`、`cookbook/`、`smoke/` 5 大模块，共计 62 项测试用例，本地运行耗时 < 2 秒；
2. **前端建立了立体防线**：ESLint 9 Flat Config 静态拦截未声明变量（如 `jsx-no-undef`）、Vitest + `@testing-library/react` 挂载测试 ToolCard 与 ErrorBoundary；
3. **版本同步约束明确**：`AGENTS.md` 规范要求发版时必须同步修改 6 处版本号（`pyproject.toml`、`sdk/python/pyproject.toml`、`sdk/python/src/mini_agent/__init__.py`、`server/app.py`、`frontend/package.json`、`frontend/package-lock.json`）。

**存在的核心痛点**：
- **无自动化 CI 门禁**：代码库尚未配置 `.github/workflows/`，所有测试与规范检查均依赖开发者在本地手动运行，无法阻断有缺陷或版本漂移的代码合并入 `main`；
- **App Server 原生二进制的解耦认知需明确**：需清晰界定日常 PR 门禁与真实二进制 E2E 验证的边界，避免在每次 PR 中引入耗时数分钟的 Rust 全量编译或非必要外部网络下载。

---

## 2. 核心架构设计与原则

### 2.1 零 Token、免 Rust 编译的极速日常门禁
- **日常 PR / Commit 门禁不需要 `mini-agent-app-server` 原生二进制**：
  - SDK 测试验证协议序列化与事件流；
  - Gateway 测试通过 `AsyncMock` 模拟后端 RPC；
  - Tier 1 冒烟测试在进程内模拟全双工 WebSocket 和流式事件；
  - **整套 62 项全量测试 100% 离线、零 Token、零编译**。
- **Fail-Fast 极速反馈**：
  - 依赖 `astral-sh/setup-uv`（带 uv cache）与 `actions/setup-node`（带 npm cache）；
  - 静态检查 15 秒内报错，全流程 1.5 分钟内执行完毕。

### 2.2 两类场景与 App Server 二进制解耦定位

| 流水线场景 | 触发时机 | 是否需要 App Server 二进制 | 二进制来源 | 耗时预期 |
| :--- | :--- | :--- | :--- | :--- |
| **阶段 1：日常 PR / Commit 门禁** | Push 到 main / PR 提交 | ❌ **不需要**（跑 62 项全量离线单元+集成+Tier 1 冒烟） | 无 | **< 1.5 分钟** |
| **阶段 2：发版准入 / 跨端 E2E 验证** | Release Tag / 手动 `workflow_dispatch` |  **需要**（跨进程管道通信验证） | 从 `mini-agent-harness` Release 下载预编译资产 | **~ 2 分钟** |
| **阶段 3：双仓主干夜间联调 (Nightly)** | 定时 Cron |  **需要**（验证 harness 最新代码与 web 最新代码） | 现场 checkout 编译最新 main 分支 | **~ 3-5 分钟** |

---

## 3. 流水线 Job 拓扑设计 (阶段 1：日常 PR / Commit 门禁)

```text
[ Git Push / Pull Request ]
            │
            ├──► Job 1: 静态语法与代码风格 (Lint & Format) ─── (~15s)
            │      ├─ Python: ruff check . & ruff format --check .
            │      ├─ Frontend: eslint src (拦截 jsx-no-undef)
            │      └─ Version Guard: python scripts/check_version_sync.py
            │
            ├──► Job 2: 后端全量离线测试矩阵 (Python Test Matrix) ─── (~40s)
            │      ├─ OS Matrix: ubuntu-latest (必跑) / windows-latest / macos-latest
            │      ├─ Python Matrix: 3.10, 3.11, 3.12
            │      ├─ uv sync --frozen
            │      └─ uv run pytest -q (全量 62 项测试)
            │
            ├──► Job 3: 前端组件测试与生产构建 (Frontend Test & Build) ─── (~40s)
            │      ├─ Node 22 (LTS)
            │      ├─ npm ci
            │      ├─ npm test (12 unit + 5 ToolCard component tests)
            │      └─ npm run build (Vite 生产构建校验)
            │
            └──► Job 4: 发版打包构建与工作区卫生 (Package & Hygiene) ─── (~20s)
                   ├─ uv build --package mini-agent (验证 wheel & sdist 打包)
                   └─ git diff --check (验证无遗留未提交产物)
```

---

## 4. 实施路线图

### 阶段 1：日常 PR / Commit 门禁体系落地（即刻推进）
1. **补齐 SDK 导出版本**：在 `sdk/python/src/mini_agent/__init__.py` 中补齐 `__version__ = "0.7.0"` 并对外导出；
2. **编写版本守卫脚本**：实现 `scripts/check_version_sync.py`，自动校验 6 处版本号严格一致；
3. **编写 GitHub Actions 工作流**：创建 `.github/workflows/ci.yml`，配置 Lint、Python Matrix、Frontend、Package 4 个并行门禁；
4. **本地仿真与验证**：在本地验证版本检查脚本与全套 CI 命令的执行正确性。

### 阶段 2：预编译 App Server 二进制下载与 Live E2E 验证（后续演进）
1. 配置当打发版 Tag（如 `v*`）或手动触发时，自动通过 `gh release download` 从 `civaapple-alt/mini-agent-harness` 下载对应平台预编译二进制；
2. 注入 `MINI_AGENT_APP_SERVER_PATH` 运行带真实进程管道通信的验证。

### 阶段 3：自动化发版发布流水线（后续演进）
1. 打 Tag 时自动构建前端生产产物并打包 Python SDK；
2. 自动发布至 PyPI 与 GitHub Releases。

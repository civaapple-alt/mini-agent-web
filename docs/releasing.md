# 发布流程指南 (Releasing Runbook)

本文档是 `mini-agent-web` 的官方发布操作手册（Runbook）。发布过程采用版本全栈对齐、自动化验证门禁与 Git 标签驱动机制。

---

## 1. 核心发布原则

1. **版本一致性**：`mini-agent-web` 的 Python SDK、网关、React 前端和锁文件必须保持相同的 SemVer，并与 `mini-agent-harness` 的发布版本一致；
2. **协议版本**：App Server 协商 `protocolVersion: 2`，请求 envelope 使用 JSON-RPC 2.0。协议 V1 客户端和 V1 Session journal 不兼容；升级前按 Harness 的 [App Server 迁移说明](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/app-server.md) 备份 Session；
3. **零 Token 门禁纪律**：发布前测试与静态检查绝不消耗外部模型 Provider 的实际 Token；
4. **工作区干净度**：禁止将编译产物（`dist/`）、临时日志（`logs/`）或密钥（`.env`）打包提交。

---

## 2. 版本对齐清单 (Version Sync Checklist)

在准备新版本时，先设置目标版本，再同步更新所有版本来源和锁文件。`1.0.0` 是本次发布版本。

| 文件路径 | 版本来源 |
| :--- | :--- |
| `pyproject.toml` | `project.version` |
| `sdk/python/pyproject.toml` | `project.version` |
| `sdk/python/src/mini_agent/__init__.py` | `__version__` |
| `sdk/python/src/mini_agent/client.py` | 客户端版本和默认 `client_version` |
| `server/__init__.py` | `__version__` |
| `server/app.py` | FastAPI 版本和 `/health` 的 `version` |
| `frontend/package.json` | `version` |
| `frontend/package-lock.json` | 根及 `packages[""]` 的版本 |
| `uv.lock` | 两个本地 workspace 包的版本 |

同时更新 `README.md` 中的当前发布版本和 `CHANGELOG.md`。使用
`uv run python scripts/check_version_sync.py` 验证所有包版本、客户端默认版本、
FastAPI 元数据、`/health` 和本地 workspace 锁版本一致。App Server 协议版本是独立字段；
不要把 `protocolVersion: 2` 与 JSON-RPC 2.0 envelope 混为一谈。

---

## 3. 发布前验证命令集 (Verification Suite)

在根目录下按顺序运行以下门禁命令：

```bash
# 1. 代码风格与格式检查
uv run ruff check .
uv run ruff format --check .

# 2. 后端 API 与 SDK 自动化测试套件
uv run pytest -q

# 3. 前端轻量单元测试
cd frontend && npm test && cd ..

# 4. 前端生产打包构建验证
cd frontend && npm run build && cd ..

# 5. 离线协议兼容性验证 (0 Token 消耗)
uv run python cookbook/python-demo/06_protocol_compatibility.py

# 6. Python SDK 独立 Wheel 打包测试
uv build --package mini-agent

# 7. Git 空白符与变更检查
git diff --check
git status
```

---

## 4. CHANGELOG、提交与版本标记

1. 打开 `CHANGELOG.md`，将 `## [Unreleased]` 下已完成的变更移入新增的带日期的版本章节：
   ```markdown
   ## [1.0.0] - 2026-10-04
   
   ### Breaking Changes
   ...

   ### Changes
   ...
   ```
2. 保留顶部的空 `## [Unreleased]` 章节供后续开发使用；
3. 运行版本同步检查、测试、前端构建和 SDK 分发包构建。`uv build` 只构建
   SDK wheel 和 sdist；此仓库的发布步骤不向 PyPI 发布：
   ```bash
   uv run python scripts/check_version_sync.py
   uv build --package mini-agent
   (
     cd dist
     shasum -a 256 mini_agent-1.0.0* > SHA256SUMS
     shasum -a 256 -c SHA256SUMS
   )
   ```
4. 提交并推送版本变更，等待该提交的 CI 全部通过后再创建和推送 tag：
   ```bash
   git add -u
   git commit -m "release: prepare v1.0.0"
   git push origin main
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
5. Web 仓库没有 tag 发布工作流。CI 通过且 tag 已推送后，手动创建 GitHub Release，
   在说明开头突出 V1 客户端/Session 不兼容和备份步骤，再附上 SDK wheel、sdist
   与 `SHA256SUMS`。确认 Release 页面列出的 tag 和资产与这次构建一致。

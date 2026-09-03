# 发布流程指南 (Releasing Runbook)

本文档是 `mini-agent-web` 的官方发布操作手册（Runbook）。发布过程采用版本全栈对齐、自动化验证门禁与 Git 标签驱动机制。

---

## 1. 核心发布原则

1. **全栈版本一致性**：整个工程、Python SDK、网关后端、React 前端必须保持相同的语义化版本号（SemVer）；
2. **线缆协议稳定性**：线缆协议版本（Wire Protocol Version）严格保持为 `1`（JSON-RPC 2.0 基础），切勿随发布版本随意变更；
3. **零 Token 门禁纪律**：发布前测试与静态检查绝不消耗外部模型 Provider 的实际 Token；
4. **工作区干净度**：禁止将编译产物（`dist/`）、临时日志（`logs/`）或密钥（`.env`）打包提交。

---

## 2. 版本对齐清单 (Version Sync Checklist)

在准备新版本（例如 `0.8.0`）时，必须同步更新以下 6 个关键文件：

| 文件路径 | 待更新字段 |
| :--- | :--- |
| `pyproject.toml` | `project.version = "0.8.0"` |
| `sdk/python/pyproject.toml` | `project.version = "0.8.0"` |
| `sdk/python/src/mini_agent/__init__.py` | `__version__ = "0.8.0"` |
| `server/app.py` | `__version__ = "0.8.0"` / API version |
| `frontend/package.json` | `"version": "0.8.0"` |
| `frontend/package-lock.json` | 根及包定义中的 `"version": "0.8.0"` |

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

## 4. CHANGELOG 与版本标记

1. 打开 `CHANGELOG.md`，将 `## [Unreleased]` 下已完成的变更移入新增的带日期的版本章节：
   ```markdown
   ## [0.8.0] - 2026-09-XX
   
   ### Added
   ...
   ```
2. 保留顶部的空 `## [Unreleased]` 章节供后续开发使用；
3. 提交版本变更并创建带注释的 Git Tag：
   ```bash
   git add -u
   git commit -m "chore: release 0.8.0"
   git tag -a v0.8.0 -m "Release v0.8.0"
   git push origin main --tags
   ```

# 发布流程指南

本文档记录 `mini-agent-web` Gateway、Web Studio 和实验性 TUI 的发布流程。
Web 发布版本由本仓维护；Python SDK 由 `mini-agent-harness` 维护并单独发布。

## 版本规则

- `pyproject.toml`、Gateway、前端和 Web 锁文件中的 `mini-agent-web` 版本保持一致。
- Web 通过 `pyproject.toml` 和 `uv.lock` 固定一个兼容的 Harness SDK wheel。SDK
  版本可以与 Web 版本不同；运行 `uv run python scripts/check_version_sync.py`
  检查本仓版本及 SDK pin。
- App Server 协商 `protocolVersion: 2`，请求 envelope 使用 JSON-RPC 2.0。协议
  V1 客户端和 V1 Session journal 不兼容；升级前按 Harness 的
  [App Server 迁移说明](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/app-server.md)
  备份 Session。
- 测试和静态检查不调用外部模型 Provider，也不消耗 Provider Token。
- 不要提交 `dist/`、`logs/`、密钥或本地产生的 Session 数据。

当前 Web v1.0.0 继续使用本仓历史 v1.0.0 Release 中的 SDK wheel。Harness 后续
Release 会提供 SDK wheel/sdist 和 App Server 可执行文件；Web 只有在升级 SDK 时
才需要更新 wheel URL、`uv.lock` 和兼容性验证。

## 发布前检查

从仓库根目录运行：

```bash
uv run python scripts/check_version_sync.py
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
uv build --project .
git diff --check
git status --short
```

测试默认使用锁定的 SDK 包，不构建 SDK 源码。需要本地 App Server 的测试应通过
`MINI_AGENT_APP_SERVER_PATH` 指向与 SDK 兼容的 Harness 可执行文件。

## 提交 Web 版本

1. 将 `CHANGELOG.md` 的 `Unreleased` 内容移入带日期的版本章节，并保留空的
   `Unreleased` 标题。
2. 更新 Web 自有版本来源和 README，再运行上面的检查。
3. 提交并等待该提交的 CI 通过。Web 仓库没有自动 tag 发布工作流；确认 Web
   发布方式和 tag 命名后，再创建对应 GitHub Release。
4. Web Release 不构建或附加 SDK 包。不要覆盖已经发布的 SDK wheel；SDK 版本更新
   由 Harness 的版本与 Release 流程处理。

MIT License。

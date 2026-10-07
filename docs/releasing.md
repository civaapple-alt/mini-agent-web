# 发布流程指南

本文档记录 `mini-agent-web` Gateway、Web Studio 和实验性 TUI 的发布流程。
Web 发布版本由本仓维护；Python SDK 由 `mini-agent-harness` 维护并单独发布。Web
GitHub Release 只标记 Web 源码版本，不附带 Harness SDK；SDK 和 App Server 产物以
Harness Release 为准。

## 版本规则

- `pyproject.toml`、Gateway、前端和 Web 锁文件中的 `mini-agent-web` 版本保持一致。
- Web 在 `pyproject.toml` 声明最低兼容 SDK 版本；开发环境通过 sibling
  Harness checkout 的 editable source 运行。`uv.lock` 保留此开发路径，版本检查会将它
  与 Harness SDK 源码版本核对。SDK 版本可以与 Web 版本不同；运行
  `uv run python scripts/check_version_sync.py` 检查本仓版本及 SDK source。
- App Server 协商 `protocolVersion: 2`，请求 envelope 使用 JSON-RPC 2.0。协议
  V1 客户端和 V1 Session journal 不兼容；升级前按 Harness 的
  [App Server 迁移说明](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/app-server.md)
  备份 Session。
- 测试和静态检查不调用外部模型 Provider，也不消耗 Provider Token。
- 不要提交 `dist/`、`logs/`、密钥或本地产生的 Session 数据。

Web v1.1.0 使用 Harness SDK 1.1.0 的 API。SDK wheel 和 sdist 由 Harness v1.1.0
Release 提供；Web Release 不重复附带这两个文件。旧 Web v1.0.0 Release 中的
`mini_agent-1.0.0` 是迁移前的 SDK 产物，不代表当前 Web 包。

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
3. 提交并等待该提交的 CI 通过，然后推送 `v<version>` tag。
4. Web 仓库没有自动 tag 发布工作流；在 GitHub 上为已验证的 tag 创建 Release，使用
   Web changelog 摘要和自动生成的提交说明。无需上传 SDK wheel/sdist；SDK 版本更新与
   App Server 平台归档由 Harness 的版本与 Release 流程处理。

MIT License。

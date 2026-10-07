# Gateway 控制台日志时间戳

状态：implemented；日期：2026-10-07；范围：Gateway 与 Uvicorn 控制台日志

## 决策

Gateway 应用日志、Uvicorn 服务日志和 HTTP access log 使用本机时间，并附带 UTC 偏移量。沿用现有日志记录器，不再创建第二套请求日志。

## 验证

- `uv run ruff check server`：通过。
- `uv run ruff format --check server/main.py server/app.py`：通过。
- `git diff --check`：通过。

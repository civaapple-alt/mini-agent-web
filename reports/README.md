# Test Execution Reports

本目录用于持久化保存和代码库跟踪 mini-agent 全栈及核心组件的自动化测试执行报告。

## 文件命名规范

测试报告按执行开始时间戳命名，格式如下：
smoke-test-report-<YYYYMMDD-HHMMSS>.md

示例：
smoke-test-report-20260904-142500.md

## 运行与生成方式

从仓库根目录执行全栈冒烟测试脚本时会自动在本目录生成带时间戳的完整测试报告：

`ash
uv run python scripts/full_stack_smoke_test.py
`

如需自定义输出目录或跳过报告生成，可使用命令行参数：

`ash
uv run python scripts/full_stack_smoke_test.py --report-dir custom_reports/
uv run python scripts/full_stack_smoke_test.py --no-report
`

## 报告结构规范

每份报告包含以下结构：
1. **执行摘要元数据**：时间戳、最终判定结果、总耗时、运行环境（OS、Python、平台架构）、App Server 二进制路径及版本、LLM 模型与端点；
2. **阶段状态速查表**：Phase 1 ~ 7 的执行状态（PASSED / FAILED）与精确耗时（秒）；
3. **分阶段详细记录**：每个阶段的自然语言 Prompt、LLM 思考过程（Thinking Tokens）、工具调用及参数、权限审批往返、WebSocket 事件收敛详情等。

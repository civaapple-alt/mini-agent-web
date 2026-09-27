# 模型供应商与模型设置

App Server/Host 持有供应商、凭据、全局默认模型和 Goal Verifier 默认模型。SDK 与
Web Studio 使用同一份 Host 模型目录；Gateway 只转发模型目录接口。模型设置存放在
`~/.mini-agent/model_catalog.json`，API Key 单独存放在
`~/.mini-agent/provider-credentials/<providerId>.key`。Windows 使用
`%USERPROFILE%/.mini-agent/`。Key 以明文保存，Unix 上凭据目录和文件分别限制为
`0700` 和 `0600`；页面只显示是否已配置，绝不回显 Key。

## 首次配置

首次启动不显示向导。没有可用默认模型时，输入框会显示“先配置模型”，点击后打开
现有的模型设置。打开页面和保存配置都不会请求模型供应商。

在 **设置 → Agent 能力 → 模型设置** 配置供应商、模型和全局默认值。DeepSeek、Kimi、
GLM、Volcengine 提供本地维护的供应商和模型建议；建议不联网校验。自定义 Responses
供应商可手动填写 Base URL 和模型 ID。Host 会在 Base URL 后追加 `/responses`，供应商
必须支持 Responses API。

供应商、模型和默认值按卡片显式保存。未保存时切换或关闭页面会要求确认；删除供应商、
模型和清除 API Key 也会先在应用内确认。清除供应商凭据后，页面只显示未配置状态。

## 测试模型连接

在模型列表中找到已保存且启用的模型，点击该行后面的 **测试连接**。Host 发出一次有界、
无工具请求，最多生成 32 个输出 token，最多读取 4 KiB 响应，并在 12 秒后超时。供应商
可能对这次请求计费。页面不会自动测试；返回值只包含有限状态和短说明，不包含 API Key、原始请求或
响应。成功、凭据无效、供应商拒绝、超时、无法连接、响应无效和其他失败会分别说明。

## 选择模型

全局默认模型和推理等级在模型设置中配置。Goal Verifier 是独立的可选默认值；没有配置
Verifier 不影响普通对话，但启动需要验证的 Goal 时会明确报错。创建 Goal 时会记录当时
的 Verifier 选择，后续修改只影响新 Goal。

项目默认模型在对应项目的设置中配置。Thread 模型和推理等级保留在输入框的模型控件中，
切换从下一轮开始生效。Host 按以下顺序解析主模型：

1. Thread 显式选择。
2. 项目默认模型。
3. 全局默认模型。

不再读取旧 `OPENAI_*` 或 `VERIFIER_OPENAI_*` 环境变量，也不会从旧 `.env` 自动迁移。旧值
不会配置模型、覆盖页面设置或作为项目级回退；请在模型设置中重新录入供应商与默认值。

推理等级可以选择“使用 API 默认”或该模型声明的等级，包括 `disabled` 和自定义等级。
“使用 API 默认”会在请求中省略推理参数。模型 ID、推理等级和参数映射由用户维护；本地
建议只提供初始值，不会验证远端支持情况。

## 供应商搜索能力

Host 在模型目录中返回供应商搜索支持状态和当前是否生效，Web Studio 不自行维护供应商判断。
官方 OpenAI Responses 端点默认为支持；官方 DeepSeek Responses 端点不支持内置
`web_search`，Host 会忽略对它的开启设置。其他端点默认为关闭且支持状态未知；用户确认兼容后
可手动开启。供应商接口或搜索设置有未保存修改时，Studio 会先要求保存，再更新能力判断。

模型级 `web_search` 只有在供应商搜索当前生效时才能编辑；否则会显示锁定状态和原因。运行时
仍同时检查供应商状态、Thread/CLI 搜索开关和模型能力，三者缺一都不会发送内置搜索工具。
CLI 的 `--no-web-search` 可在单次运行中临时关闭搜索。

## 本地接口

Gateway 将模型管理请求原样映射到 App Server：

| 路径 | 用途 |
| --- | --- |
| `GET /api/models` | 读取供应商、模型和默认值，不返回 API Key；供应商包含 Host 计算的 `webSearchSupport` 与有效状态 `webSearchEnabled`。 |
| `POST /api/models/manage` | 管理供应商、模型、全局默认值和项目默认值；`test_connection` 手动执行一次连接测试。 |
| `GET /api/threads/{thread_id}/model-settings` | 读取 Thread 模型覆盖和推理选择。 |
| `POST /api/threads/{thread_id}/settings` | 更新 Thread 模型覆盖和推理选择。 |

Python SDK 提供 `manage_model_catalog()` 和 `test_model_connection()`。`/api/settings`
只保存全局界面偏好，不保存模型选择或凭据。

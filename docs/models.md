# 模型供应商与模型设置

Web Studio 的模型设置管理机器级 Responses 供应商目录。Host 负责读取目录、凭据和模型；Gateway 只转发本地 App Server 请求。

## 配置供应商

打开 **设置 → Agent 能力 → 模型设置**，在详情区添加 DeepSeek、Kimi、GLM、字节火山或自定义供应商。填写供应商名称、Responses API Base URL 和 API Key。Base URL 不预填，Host 会在其后追加 `/responses`。设置窗口的分类和保存方式见[偏好设置](preferences.md)。

供应商必须提供兼容的 Responses 接口。Host 不会改用 Chat Completions。接口不兼容时，当前 Turn 会返回错误。

API Key 保存到运行 Host 的机器凭据库。Web Studio 不会在读取设置时取回 Key，只会显示是否已配置。输入新的 Key 会替换旧值；清除操作会删除系统凭据库中的 Key。

## 配置模型

在供应商下添加模型，填写供应商要求的模型 ID 和显示名称。你可以维护上下文长度、最大输出 Token、输入模态、模型能力、该模型支持的推理等级和推理参数映射。推理等级是 Thread 可选值的枚举，不代表模型默认启用的等级。除了 `low`、`medium`、`high`、`xhigh`、`max`，也可以添加供应商支持的自定义等级。

`disabled` 也是模型支持的等级之一，可以像其他等级一样设为全局默认或在输入框中选择。它需要在该模型的参数映射中配置供应商对应的关闭参数；不同供应商的关闭字段和值可能不同。Host 将映射字段加入 Responses 请求，同时阻止映射覆盖模型、输入、工具和流控制字段。

“智能匹配”使用随 Web Studio 提供的本地资料。它只按模型 ID 提供建议，不会请求供应商。手动修改匹配结果后，模型转为手动管理，后续资料更新不会覆盖该配置。

停用的供应商或模型不会出现在可选的运行配置中。删除当前默认模型会清除引用该模型的全局、Goal Verifier 和项目默认值。

## 设置默认模型

配置全局默认模型及其推理选择，再配置独立的 Goal Verifier 默认模型。推理选择为“使用 API 默认”或该模型声明的任意等级，包括 `disabled`；“使用 API 默认”会在请求中省略推理参数。两个默认模型不能指向同一个模型。Goal 创建时会保存当时的 Verifier 模型引用；修改全局 Verifier 默认值只影响之后创建的 Goal。

你也可以为当前项目选择默认模型。项目默认只指定模型；Thread 没有推理覆盖时，项目默认模型使用 API 默认等级。清除项目选择后，项目会继承全局模型和它对应的推理选择。

Host 按以下顺序选择主模型：

1. Thread 显式选择。
2. 项目默认模型。
3. 没有项目界面默认值时，兼容旧配置的项目 `OPENAI_MODEL`。
4. 全局默认模型。

如果没有配置 Goal Verifier 默认模型，也没有旧版 `VERIFIER_OPENAI_MODEL`，Goal 验证会明确失败。Host 不会改用主模型。

## 在输入框切换模型

输入框右下角按供应商分组列出模型，并提供独立的推理等级选择。Thread 可以选“使用 API 默认”或当前模型声明的任意等级，`disabled` 和自定义等级也会在此列出。选择会通过 Thread 设置接口保存；清除 Thread 推理覆盖会回到默认选择。修改从下一 Turn 开始生效，正在运行的 Turn 不会切换模型。

Fork 和子会话会继承父 Thread 的模型选择和推理等级。停用、缺少 Base URL 或缺少 API Key 的模型会显示原因，并阻止发送。选择其他可用模型，或在模型设置中补齐配置后再发送。

## 本地接口

Gateway 将模型管理请求转发给 App Server：

| 路径 | 用途 |
| --- | --- |
| `GET /api/models` | 读取供应商、模型和默认值。 |
| `POST /api/models/manage` | 新增、修改、删除供应商或模型，并设置全局、Goal Verifier 或项目默认值。 |
| `GET /api/threads/{thread_id}/model-settings` | 读取 Thread 的模型覆盖和推理选择。 |
| `POST /api/threads/{thread_id}/settings` | 更新 Thread 的模型覆盖和推理选择；选择为 `{ "kind": "api_default" }` 或 `{ "kind": "level", "value": "disabled" }` 等模型声明的等级。 |

SDK 和 Gateway 的普通查询响应都不包含 API Key 值。机器级目录位于 `~/.mini-agent/model_catalog.json`；Windows 使用 `%USERPROFILE%/.mini-agent/model_catalog.json`。目录保存模型元数据，API Key 保存到操作系统凭据库。

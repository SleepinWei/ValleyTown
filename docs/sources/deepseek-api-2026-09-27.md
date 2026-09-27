# DeepSeek API 接入核验摘录

核验日期：2026-09-27。来源：[DeepSeek 官方「首次调用 API」](https://api-docs.deepseek.com/zh-cn/)。通过 Firecrawl 获取，页面返回 HTTP 200；抓取内容的缓存时间为 2026-09-27T00:20:17.300Z。

## 官方信息

| 项目 | 值 |
|---|---|
| OpenAI 兼容 base URL | `https://api.deepseek.com` |
| Anthropic 兼容 base URL | `https://api.deepseek.com/anthropic` |
| 模型 ID | `deepseek-flash`、`deepseek-v4-pro` |
| 官方示例调用路径 | `POST https://api.deepseek.com/chat/completions` |
| 流式说明 | 示例默认非流式，设置 `stream: true` 可使用流式输出 |

官方对模型名的原文说明：

> 模型名请使用 `deepseek-flash`。旧模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍可调用，但对应模型已下线，请求将由 DeepSeek-V4.1-Flash 模型提供服务，并按 Flash 价格计费。

官方示例使用 `deepseek-flash`，包含 `thinking: {"type": "enabled"}`、`reasoning_effort: "high"`。这只是文档示例，不代表本项目已确认高低层分配或推理参数。

## 本次核验边界

- 已核对用户提供的地址与模型列表，明确 V4.1-Flash 对应的 API ID。
- 没有申请或读取 API key，没有进行付费模型调用。
- 本页面不足以确定具体价格、上下文限制、全部参数取值、结构化输出契约和实际性能。
- API 文档不决定本项目的模型分工；用户随后明确确认高层使用 `deepseek-flash`（V4.1），低层保留 Jev。

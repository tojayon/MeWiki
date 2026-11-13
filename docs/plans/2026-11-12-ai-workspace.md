# MeWiki 自配 AI 服务与笔记 Agent 实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用户自行配置 API 地址、密钥、协议及模型，在 MeWiki 内执行有来源的资料检索、问答与笔记修改建议，经显式审阅应用并可撤回。

**Architecture:** 模型服务、任务执行器、领域工具和资料提交四层分离。模型只通过注册工具读取当前授权范围并提出草稿；实际修改由用户在界面触发，通过现有 controller 保存。工具定义、执行入口及能力说明共用注册表，后续产品功能变更同步相邻工具测试与手册。

**Tech Stack:** TypeScript、React、Vite 本机服务、Fetch/NDJSON、Vitest、Edge Playwright；不新增远程资源和运行依赖。

## 工作区与边界

- 当前工作区有大量既有未提交改动，直接在其现状上进行增量实现，保留暂存关系，不提交、不搬动现有修改。
- 服务仍只绑定 `127.0.0.1`。AI 密钥与应用配置独立保存，不写笔记、插件清单、资料备份或日志。
- 保留资料版本 8、外部宿主 v1 以及未知插件内容，不扩大宿主权限。
- 首版支持多服务配置、OpenAI Chat Completions / Responses / Anthropic Messages、手填模型与获取列表、实际响应/流式/工具测试、取消、超时、用量和来源记录；不自动跨供应商切换。
- 当前笔记与词典 / 当前资料库为用户明确选择的范围。语义向量、PDF OCR、联网搜索、多 Agent 和自动写入不在首版范围。

## 任务 1：本机服务与协议

**文件：** `src/ai/types.ts`、`server/aiServicePlugin.ts`、`server/aiProviderStore.ts`、`server/aiTransport.ts` 及相邻单测；根配置由主任务接入。

1. 先写失败测试，验证密钥不回显、修订冲突、地址改变不沿用旧密钥、协议工具往返、流式分片、错误脱敏与取消。
2. 实现配置存储，Windows 使用当前用户 DPAPI；其他平台明确限制为当前用户权限的密钥存储，不宣称系统凭据加密。
3. 同源本机接口 `/api/mewiki/ai/settings` GET/PUT、`/models` POST、`/test` POST、`/chat` POST；全部客户端请求携带 `X-MeWiki-Request: ai`。
4. `/chat` 返回 NDJSON：`text` 增量、`done` 完整规范化消息与用量、`error` 安全错误。禁止重定向泄露凭据，限制体积、步数与时间。
5. 验证针对虚构本机服务，不使用任何真实密钥或资料。

### 前后端共享契约

- `AiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic'`。
- `AiProvider = { id, name, baseUrl, protocol, model, hasApiKey }`；`AiProviderInput` 不含 `hasApiKey`，`apiKey?: string` 缺省保留、空串清除。
- `AiSettings = { revision: string, defaultProviderId: string | null, providers: AiProvider[] }`；更新请求为同名字段和 `AiProviderInput[]`。
- `AiMessage = { role: 'system' | 'user' | 'assistant' | 'tool', content: string, toolCalls?: AiToolCall[], toolCallId?: string }`；`AiToolCall = { id, name, arguments: string }`。
- `AiToolDefinition = { name, description, parameters: Record<string, unknown> }`。
- `AiCompletion = { message: AiMessage, usage: { inputTokens: number, outputTokens: number } }`。
- `AiStreamEvent = { type: 'text', text: string } | { type: 'done', result: AiCompletion } | { type: 'error', error: string }`。
- 请求 `/chat` 为 `{ providerId, model?: string, messages, tools? }`；`/models` 返回 `{ models: string[] }`；`/test` 返回 `{ response: boolean, stream: boolean, tools: boolean, message: string }`。

## 任务 2：领域工具与审阅事务

**文件：** `src/ai/tools.ts`、`src/ai/proposals.ts` 及相邻单测。

1. 先验证检索范围隔离、稳定引用、未知内容保留、旧基线拒绝、撤回不覆盖后续编辑。
2. 单一工具注册表提供能力说明、笔记列表与检索、读取原文、词典查询、创建笔记/追加内容/修改现有文字块的建议。
3. 原生函数构建及修改内容。模型没有保存或删除工具；用户应用时重新校验资料库与基线，记录可撤回变更。

## 任务 3：设置与 AI 工作区

**文件：** `src/ai/client.ts`、`src/ai/runner.ts`、`src/ai/session.ts`、`src/components/AiServiceSettings.tsx`、`AiWorkspace.tsx`、相关 CSS；增量接入 `SettingsPage.tsx`、`settingsNavigation.ts` 与 `ResearchNotebook.tsx`。

1. 配置列表、显式保存/密钥清除、服务选择、模型手填/列表、连接测试；请求错误不回显凭据。
2. AI 工作区支持输入任务、选择资料范围、查看流式结果和工具进度、取消、查看来源、审阅应用与撤回。
3. 会话、建议与中断状态按稳定库 ID 隔离，切库/关闭取消旧请求；模型工具调用循环有限额。
4. 同步中英文消息，保持 44px 工具栏、纯图标入口、中性边框和原生控件焦点。

## 任务 4：维护规则与文档

**文件：** `docs/wiki/22-ai-workspace.md`、手册目录与注册表、`docs/ai/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/AI_HANDOFF.md`、`docs/integrations/README.md`、`AGENTS.md`。

- 说明服务自配、收费与发送范围、密钥存储、模型能力、使用步骤、修改冲突、取消与恢复限制。
- 明确每次增加/修改用户可见能力时，判断 Agent 工具是否受影响，并同步注册表、测试及手册；工具未支持的能力不宣称可以执行。

## 任务 5：验收与运行

- 针对 AI 的单测先红后绿；新增独立 Edge 用例，使用隔离服务、虚构笔记与虚构 API，覆盖配置和完整工具循环、应用/撤回、取消、切库与窄屏。
- 运行 `npm test`、`npm run lint`、`npm run build`、翻译校验及相关 Edge 回归。
- 独立复查资料隔离、密钥保护与工具写入边界，修复后重验。
- 正式服务更新后按当前用户要求构建并重启，只操作已确认的 MeWiki 服务进程，不触碰其他聊天的测试服务或真实资料。

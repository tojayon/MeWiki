# AI 符号词典书写约束实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI 在回答和修改中沿用词典的完整 LaTeX；确定的字体丢失在建议进入审阅前反馈给模型纠正。

**Architecture:** 查询和完整读取词条同时返回默认 bindings、解析后的 tex 和稳定引用 Markdown，系统提示明确字体与角标属于定义。笔记读取附带有界的相关符号约定；工具边界只拦截新增且唯一可识别的默认实例字体简化，不静默改写，不改变用户批准、保存或词典编辑权限。

**Tech Stack:** TypeScript、现有 TeX 符号匹配器、remark 数学解析、Vitest、Edge Playwright。

---

### 1. 复现与约束范围

- 新增 `src/ai/symbolNotation.test.ts`，通过实际工具复现 `v_{\\mathrm T}` 变成 `v_T`，先观察失败。
- 覆盖默认实例、稳定引用、原生公式与文字编辑；保留自定义角标、歧义、代码与原有错误，失败不登记建议、不写资料。
- 不对聊天正文作无语义的全局替换；不修改全局正文渲染或资料格式。

### 2. 词典投影与默认提示

- 新增 `src/ai/symbolNotation.ts`，复用 `resolveSymbolEntry`、`dictionaryReferenceMarkdown` 和 `findInlineResearchSymbols`。
- 修改 `src/ai/tools.ts`、`src/ai/nativeTools.ts`：查询／完整读取返回 `resolved: {tex,bindings,markdown}`，相关符号随原文有界返回，全部计入原读取预算。
- 系统提示要求使用词典精确书写、优先稳定引用，原生公式使用已读取的 entryId 与 bindings。

### 3. 建议边界检查

- 使用纯预览／原生变换比较同一内容块前后的数学表达式；只识别默认实例的字体包装丢失，保留分组、实际角标与其他数学命令。
- 相同裸形有合法词条时接受；有多个规范字体时不猜测。既有错误未增加时不阻碍无关修改。
- 检查在 push 建议之前完成；错误返回词条 ID、名称和精确写法，供模型下一轮纠正。
- 流式临时草稿不是已通过检查的建议，最终工具结果仍为准。

### 4. 验收与手册

- 增加 `src/ai/evaluation.ts` 虚构纠正任务，验证错误反馈、单一合法建议、审阅后应用。
- Edge 专项使用隔离资料和独立构建，验证字体简化被模型纠正后，在渲染审阅中批准／撤回，原文不提前保存。
- 同步 `docs/wiki/22-ai-workspace.md`、`docs/wiki/05-symbol-dictionary.md`、`docs/ai/ARCHITECTURE.md` 和接续说明。
- 运行专项单测、`npm run ai:evaluate`、`npm test`、`npm run lint`、`npm run build`、国际化及品牌检查；记录实际结果。
- 本轮在现有共享工作区保留其他更改，不自动提交、推送或操作真实资料。

### 验收结果

- 42 项符号专项与 3 项评测单测通过；补测包含参考式符号链接、首次定义、显式字体作用域、默认斜体、粗希腊字母及多字母正体标签。
- 完整单测 1306 项通过、4 项默认跳过；7／7 离线虚构任务通过，无越界或无效来源。
- Edge 73 个不同场景完成验收：首批 70 项通过，3 项窄屏断言按现有两侧 44px 导航和手册的收起侧栏操作更新后专项全过；没有把首批失败记录为全通过。新增 2 项验证拒绝错误、纠正、渲染正体、批准、刷新与撤回。
- lint 退出 0，仅既有字体设置 effect 警告；国际化 3787 条／2860 处引用／0 问题，22 份品牌资源一致；标准和隔离构建成功。
- 正式 5280 首页与 27 个直接引用资源均为 HTTP 200，与标准构建一致；客户端改动无需重启现有服务，刷新页面使用新版。详细日志见 `.mewiki/ai-notation-checks/`，正式记录见 [VERIFICATION](../VERIFICATION.md)。

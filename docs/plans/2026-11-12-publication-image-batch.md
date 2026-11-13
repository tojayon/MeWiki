# 图片与批量设备图导出实现计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有图文导出工作区选择笔记或电脑中的多张图片，共用模板与设备设置，逐张取景并生成和下载成品。

**Architecture:** 图片模式保存为个人模板的可选样式字段，主图片和逐图裁切仅属于本次会话。图片页面复用现有设备外壳、连续圆角、纹理和后台任务；大批次按已有请求预算串行拆组，保持顺序和整批取消语义。沿用现有笔记导出与旧模板协议。

**Tech Stack:** React、TypeScript、Vitest、Playwright / Microsoft Edge、fflate。

---

本工作区含现有导出依赖和主聊天的未提交修改，原地局部实现，保留其他改动；不自动提交、不操作真实资料、不重启正式服务。

### Task 1：图片模式与安全渲染

- 修改 `src/domain/publicationTypes.ts`、`publicationValidation.ts`、`publicationMarkup.ts`、`publicationFrames.ts`、`publicationTextures.ts` 和 `server/publicationPagination.ts` / `publicationRenderer.ts`。
- 新建 `src/domain/publicationImagePages.ts`，复用外壳和背景生成每图一页的静态页面。
- 先在 `publicationTypes.test.ts` 和新 `publicationImagePages.test.ts` 中覆盖可选模式、逐图取景、旧请求不变、错误位置、无正文空间约束、复用外壳与页面数量。
- 运行 `npx vitest run src/domain/publicationTypes.test.ts src/domain/publicationImagePages.test.ts` 确认先失败，再补最小实现使其通过。

### Task 2：候选收集与批量编排

- 新建 `src/domain/publicationImages.ts` / `.test.ts`，按显示顺序从图片块、Markdown、标签页与同库内容引用收集候选，排除代码、未知 JSON 和网络资源；只解析引用，不读取原件。
- 新建 `src/state/publicationImageBatch.ts` / `.test.ts`，按请求预算懒读取、串行分组生成，冻结参数和逐图裁切，检查张数、像素及总输出预算，失败和取消立即停止后续组。
- 先写顺序、分组、参数冻结、进度与取消测试，运行对应 Vitest 确认失败，再实现并通过。

### Task 3：图片选择与取景工作区

- 新建 `src/components/PublicationImageWorkspace.tsx` 及样式，提供笔记 / 本地来源、多选、缩略图、全选清空、当前图片、逐张裁切和清楚标记的示例预览。
- 修改 `PublicationDialog.tsx`、`PublicationFrameSettings.tsx` 和相邻 CSS：互斥内容模式、适配方式、隐藏正文专用参数、批量进度、保序结果及 ZIP / 单张下载。
- 模板只包含模式和共用样式；选图与逐图裁切不进入模板，图片模式不被无关字体加载阻塞。
- 为新增文本和诊断路径补齐 `src/i18n/en.ts` / `publicationError.ts`。

### Task 4：浏览器验收与手册

- 新建 `e2e/publication-images.spec.ts`，用虚构笔记和本地生成图片覆盖笔记 / 本地批量、同模板多输出、contain / cover、独立裁切、模板不包含原件、ZIP、取消及具体诊断。
- 同步 `docs/wiki/20-social-export.md`、`docs/plugins/API_V2.md`、`docs/plugins/README.md`、`docs/integrations/README.md`、`docs/DEVELOPMENT.md`、`docs/AI_HANDOFF.md` 和验收记录。
- 运行 `npm test`、`npm run lint`、`npm run build`（完整 `npm run check` 一并检查品牌和翻译）。
- 以 `.mewiki/publication-images-*` 的独立设置 / 构建 / 输出和 `127.0.0.1:5426` 执行新增及相关 Edge 场景；目视检查实际成品。测试不使用正式服务和用户资料。

## 执行结果

上述四项已实现并同步手册。完整检查 112 个文件、861 项通过，4 项真实大文件测试按默认配置跳过；新增图片专项最后 7 项全部通过，包含三张约 7.8 MiB 原件自动拆为 2 + 1 个串行任务，以及 WebP、逐图裁切、ZIP、模板重开和无资料写入。相关既有导出场景 49 项通过。完整浏览器批次首轮唯一未过项为新增测试对 `#FFFFFF` / `#ffffff` 的大小写断言，修正后图片专项全部通过，未为此改变产品颜色。

最后验收日志与已知提示见 `docs/VERIFICATION.md`；本轮未自动提交、未重启正式服务。

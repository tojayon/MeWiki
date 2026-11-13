# 导出问题内容定位实现计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实际导出发现裁切或无法分页的内容时，在原文选择页标记所属内容并支持定位。

**Architecture:** 静态项保留可选的原文来源 ID；静态 HTML 与分页副本保留静态项 ID。隔离浏览器返回结构化诊断，服务任务和客户端保留原有错误字符串并传递可选诊断。界面通过本次冻结文档映射到原文顶层选择项，不用阅读视口猜测导出溢出。

**Tech Stack:** React、TypeScript、Vitest、Playwright / Microsoft Edge。

---

## 1. 失败回归与来源

- 在 `server/publicationRenderer.test.ts` 复现两种原生滚动裁切，要求返回各静态项的横/纵问题；超大公式要求带来源。
- 在 `src/state/publicationClient.test.ts` 复现结构化诊断丢失，要求保留合法诊断并继续释放任务。
- 在 `src/domain/publication.test.ts` 要求嵌套标签页和引用展平后仍记录顶层来源，来源 ID 可以含冒号。
- 先运行相邻 Vitest 确认失败，再在 `publicationTypes.ts`、捕获与快照中添加可选 `sourceId`，旧请求继续有效。

## 2. 服务排版诊断

- 新建 `src/domain/publicationDiagnostics.ts`，定义有界的诊断解析及携带诊断的错误。
- `publicationMarkup.ts` 为源 section 标记静态项 ID；`publicationPagination.ts` 将 ID 传给分页单元并随 clone/slice 继承。
- 对滚动裁切汇总所有已排版的问题项并去重；无法分页时报告当前项；封面、页眉、像素、总高度等全局错误不误标正文。
- `publicationRenderer.ts` 显式序列化隔离浏览器错误的诊断，`publicationPlugin.ts` 的任务继续保留 `error` 并添加可选 `diagnostics`。
- `publicationClient.ts` 只接受属于本次文档的合法诊断，旧纯字符串错误仍按原样显示。

## 3. 原文定位界面

- `PublicationDialog.tsx` 将静态项诊断映射到顶层原文；失败后打开“选择内容”，提供按原文序号定位的按钮。
- `PublicationContentSelection.tsx` 显示具体问题与调整建议，支持滚动并聚焦；嵌套内容定位其所属选择项。
- 调整配置、选择或页签后清除过期诊断；再次生成重新检测。`PublicationDialog.css` 只添加问题提示背景和文字，不添加交互焦点外框。
- 补全 `src/i18n/en.ts`。扩展 `e2e/native-export-parity.spec.ts`，覆盖多处问题、选择过滤、原文序号、定位、过期清理及修正后成功导出。

## 4. 文档与验收

- 更新 `docs/wiki/20-social-export.md` 的错误处理说明，以及 `docs/plugins/API_V2.md`、`docs/integrations/README.md`、`docs/DEVELOPMENT.md` 和 `docs/AI_HANDOFF.md` 的开发约定。
- 使用 `.mewiki/publication-content-*` 隔离测试配置、资料、输出与构建，端口 5428，禁止真实资料测试。
- 运行 `npm run check`（含 npm test、lint、build、i18n、品牌）与相关 Edge 回归；检查桌面和 390px 布局、文档链接及差异。
- 只读审查并将实际结果记入 `docs/VERIFICATION.md`。保留所有既有改动，不自动提交；按用户已有要求不重启正式 5280 服务。

# 正文引用渲染编辑实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 编辑正文和表格单元格时直接显示可整体删除、点击调整的符号、术语、笔记及附件引用，并兼容现有 Markdown 资料。

**Architecture:** 使用 ProseMirror 管理文字、光标、输入法、撤销和原子引用节点；仅把有稳定来源的引用转换成原子节点，其他 Markdown 原文保留。引用节点保留完整原文，显示从当前资料库解析，保存仍使用原有 Markdown，不迁移资料格式。复用现有分类选择器和触发规则，代码及明确的整表源码编辑保持源码。

**Tech Stack:** React、TypeScript、ProseMirror model/state/view/history、remark、KaTeX、Vitest、Playwright / Edge。

---

### Task 1: 原子引用文档与兼容性

**Files:** 新建 `src/domain/researchReferenceEditor.ts` 与对应 `.test.ts`；修改 `package.json` 和锁文件。

1. 添加 Markdown 原样往返、代码与未知地址排除、选区映射、整项删除和撤销测试，运行并确认缺失功能导致失败。
2. 添加最小编辑内核依赖，实现引用解析、文档构造、序列化及 Markdown/编辑位置映射。
3. 运行 `npm test -- src/domain/researchReferenceEditor.test.ts`，确认通过。

### Task 2: 编辑器与引用修改浮层

**Files:** 新建 `src/components/ResearchReferenceEditor.tsx`、`ResearchReferenceEditor.css`、`ResearchReferencePopover.tsx`；修改 `ResearchMentionTextarea.tsx`、`ResearchTextBlock.tsx`、`ResearchTableBlock.tsx`、`src/i18n/en.ts`。

1. 新建 Edge 场景，复现编辑时仍显示 Markdown 源码的问题。
2. 接入渲染编辑内核：整项 Backspace/Delete、选区删除、撤销/重做、复制粘贴、输入法及原有快捷键。
3. 复用 `@ / # / $ / ￥` 分类选择器，插入后立即显示引用单元。
4. 引用浮层显示来源说明，支持更换目标、术语引用形式、符号本次角标和附件页码；应用只修改当前引用，取消保持原文。
5. 接入正文与单元格；代码和明确的表格源码入口继续使用纯文本输入。

### Task 3: 浏览器回归与手册

**Files:** `e2e/rendered-reference-editing.spec.ts`、受影响的正文编辑测试、`docs/wiki/03-pages-and-tags.md`、`05-symbol-dictionary.md`、`07-links-and-references.md`、`17-shortcuts.md`、`docs/DEVELOPMENT.md`、`docs/VERIFICATION.md`。

1. 将受影响测试改为真实编辑面操作，并在保存后校验 Markdown；不使用隐藏 textarea。
2. 检查鼠标、键盘、输入法、表格、窄屏、缺失来源、当前资料库粘贴与刷新恢复。
3. 同步手册与开发说明，运行 `npm test`、`npm run lint`、`npm run build`、`npm run i18n:check` 和相关 Edge 批次。
4. 复核关键差异与截图，修复发现的问题并记录实际结果。
5. 核实正式进程，重建并重启绑定 `127.0.0.1:5280` 的服务，检查首页引用最新资源。

本轮在现有工作区继续，不覆盖已有修改、不自动提交、不读写真实资料库。

## 完成情况

Task 1、Task 2、Task 3 均已完成。正文及单元格接入渲染引用、整体删除和修改浮层，手册与开发说明已同步；领域检查、全量单测、代码检查、翻译校验、正式构建、89 项相关 Edge 场景与 4 项手册场景通过。快速按键的光标同步问题先复现再修复，连续 10 次键盘检查通过。正式服务已在最终构建后重启并确认首页和静态资源一致，详情见 `docs/VERIFICATION.md` 的“正文引用渲染编辑”。

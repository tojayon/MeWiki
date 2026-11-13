# 术语原子词汇与词典交互美化实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 降低正文中的词典标记噪声，统一术语列表与笔记列表的视觉语言，并让术语支持按名称顺序拆分为可解释的原子词汇。

**Architecture:** 保留现有 `mewiki-term:<id>` / `mewiki-symbol:<id>` 稳定引用，在 Markdown 只读渲染层将两类引用改成可键盘操作的无常态装饰按钮；按钮通过统一的窗口事件打开词典详情。`ResearchTermEntry` 增加可选的 `atoms` 数组，规范化时兼容旧资料，保存时校验原子词汇拼接结果必须完整等于术语名称。术语详情页继续复用符号词典的中间面板框架：中央只显示一次完整术语，下面按原子顺序放置无文字的可点击下划线入口，解释卡片通过连接线关联到对应入口，悬停术语片段时只改变片段颜色。

**Tech Stack:** React 19、TypeScript、Vitest、Playwright、react-markdown、Lucide 图标、现有 MeWiki 资料格式 v8。

---

### Task 1: 先覆盖原子词汇数据契约

**Files:**
- Modify: `src/domain/researchTerms.test.ts`
- Modify: `src/domain/researchTerms.ts`
- Modify: `src/state/researchLibraryFile.ts`
- Modify: `src/domain/researchNotebook.test.ts`（如需补充 round-trip）
- Modify: `src/state/researchLibraryFile.test.ts`（如需补充 schema）

**Steps:**
1. 为原子词汇规范化、名称完整覆盖、片段不重叠、空解释拒绝和旧资料无 `atoms` 兼容行为写失败测试。
2. 单独运行术语领域测试，确认失败原因来自缺少数据契约。
3. 增加 `ResearchTermAtom` 和可选 `ResearchTermEntry.atoms`，实现规范化与保存校验；原子词汇使用稳定 ID，文本按 Unicode 字符拼接校验。
4. 为资料库 schema 增加可选原子词汇数组，保持版本 8 和 `webbench-research-library` 不变。
5. 运行相关领域和资料库测试，确认全部通过。

### Task 2: 先覆盖正文引用交互

**Files:**
- Modify: `src/components/ResearchMarkdown.tsx`
- Modify: `src/components/ResearchMarkdown.css`
- Modify: `src/components/ResearchNoteLinkContext.ts`
- Modify: `src/components/ResearchNotebook.tsx`
- Modify: `src/components/ResearchFormulaItemEditor.tsx`
- Modify: `src/components/ResearchFormulaRelations.tsx`
- Modify: `src/components/ResearchMarkdown.test.tsx`（若当前仓库无该测试文件则新增最小组件测试）

**Steps:**
1. 增加正文交互测试：术语和符号默认无下划线，悬停/键盘聚焦显示提示，点击发出带 `kind` 和 `id` 的统一打开事件；删除条目仍显示失效提示。
2. 运行测试确认失败。
3. 将 `NoteAnchor` 的词典引用渲染为可访问的内联按钮，加入类型化 `aria-label` / `title`，统一分发词典打开事件；保留旧的字符串事件兼容符号入口。
4. 调整样式为默认继承正文颜色和装饰，悬停/聚焦才显示术语点线、符号虚线和轻微背景；不改变公式本身颜色。
5. 运行组件和相关 Edge 测试。

### Task 3: 统一术语左栏条目样式

**Files:**
- Modify: `src/components/ResearchClassifiedList.tsx`
- Modify: `src/components/ResearchSelection.css`
- Modify: `src/i18n/en.ts`
- Modify: `e2e/research-dictionary-terms.spec.ts`

**Steps:**
1. 增加术语左栏可见名称、Atom 图标、选中态和键盘聚焦的 Edge 断言。
2. 运行该场景确认现有文件图标和样式导致失败。
3. 使用 Lucide `Atom` 图标，补齐 `research-term-item` 与笔记条目一致的布局、选中态和窄栏规则。
4. 复跑术语和侧栏 Edge 场景。

### Task 4: 实现术语详情与原子词汇编辑器

**Files:**
- Modify: `src/components/ResearchTermDictionary.tsx`
- Modify: `src/components/ResearchDictionary.css`
- Modify: `src/domain/researchTerms.ts`
- Modify: `src/domain/researchTerms.test.ts`
- Modify: `e2e/research-dictionary-terms.spec.ts`

**Steps:**
1. 增加失败测试：详情页居中显示术语名称；原子词汇逐项带下划线；点击原子词汇显示解释卡片；编辑后保存并重新加载仍保持拆分。
2. 运行测试确认失败。
3. 在术语编辑器增加原子词汇列表、解释输入、新增/删除和拼接校验；旧条目无原子数据时使用完整名称和术语含义作为只读兜底。
4. 在详情页增加居中标题、无文字的原子下划线入口、全部原子解释卡片和术语元数据，保持与符号详情页相同的间距、边框和滚动行为；窄视图为长术语提供横向查看，并让连接线避开无关卡片。
5. 运行相关单测和 Edge 测试并修复窄屏布局问题。

### Task 5: 同步使用手册与最终验收

**Files:**
- Modify: `docs/wiki/05-symbol-dictionary.md`
- Modify: `docs/wiki/02-workspace.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/VERIFICATION.md`

**Steps:**
1. 在手册中说明正文词典引用的悬停、点击、键盘操作，术语原子词汇的拆分规则和详情解释方式。
2. 运行 `npm run check`、相关 Edge 测试和 `git diff --check`。
3. 按项目约束确认正式服务只在最终构建后由协调方统一重启，不改动真实资料库、`dist` 或 `node_modules`。

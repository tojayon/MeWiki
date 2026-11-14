# 正文所见即所得编辑实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 点击正文只在对应位置出现光标，标题、粗体、斜体、列表和引用保持排版，并继续兼容既有 Markdown、稳定引用和保存流程。

**Architecture:** 扩展现有 ProseMirror 编辑器，以结构节点和文字样式表达 Markdown。保留原文及可见位置到原文位置的映射，普通文字修改只替换对应原文；结构改变时按同一 Markdown 协议序列化。沿用 controller 提交、词典详情及引用编辑入口，不增加资料迁移。

**Tech Stack:** React、ProseMirror、remark-parse/GFM/math、KaTeX、Vitest、Playwright / Edge。

### 1. 可渲染文档及原文映射

- 修改 `src/domain/researchReferenceEditor.ts`，新增 `src/domain/researchRichText.ts`。
- 在 `src/domain/researchRichText.test.ts` 先覆盖标题/强调、逐字往返、文字修改、引用原子、选区映射及撤销；在旧编辑器确认排版测试失败。
- 实现块结构、行内样式、原文保留与 clipboard，保护未知 Markdown 和稳定 URL。

### 2. 编辑交互及排版

- 修改 `src/components/ResearchReferenceEditor.tsx`、相邻 CSS、`ResearchTextBlock.tsx` 和表格单元格入口。
- 使用真实富文本结构，复用文档排版；点击按坐标设置光标，不跳到末尾。
- 保留中文组合输入、续写、快捷键、撤销、mentions 和引用修改。术语/符号点击打开详情，F2 明确进入引用修改。
- 用 Edge 验证点击前后几何、内部文字修改保存、窄屏、表格及详情。
- 术语渲染改用可换行的行内交互文字，保留按钮语义、键盘和详情；阅读／未聚焦／编辑前后逐字核对段落、列表、表格和提示块的断行位置。
- 符号引用共用正文 `.katex` 字号，移除编辑原子的单独缩放。用密集公式／符号引用段落及有序列表，在桌面、390px 和 15／20px 正文字号下逐字核对横纵位置、符号宽高及字号；防止每个符号缩窄后产生累积左移。
- 点击普通正文的滚动补充：行内公式 node view 在独立 React root 提交前就以相同 KaTeX 配置与 DOM 结构同步绘制，防止坐标选区时短暂变空、公式恢复后滚动锚定再移动页面。去掉通用单段落零 margin，保留纯文字分支，统一普通 paragraph 的 1px 上下间距。`e2e/rendered-click-scroll.spec.ts` 先复现长公式列表 516px 滚动及普通段落 2px 高差，再覆盖段首／后部正文、反复跨块点击、末尾、退出编辑，比较整页全部标记坐标、块高、总高度与实际点击光标。

### 3. 验收与手册

- 源码／返回排版按钮归入当前内容块右侧操作列，位于删除上方，提示设置依次在下；通过 portal 统一标题、段落、列表、提示和嵌套标签页的定位基准。不增加正文高度或留白；槽位不随编辑器失焦卸载而移动，防止删除点击落空。portal 按钮参与编辑会话，键盘移入不提前保存，移出沿原链保存；独立 AI 编辑器和表格工具保留既有入口。
- 同步 `docs/wiki/04-content-blocks.md`、`07-links-and-references.md`、`21-content-showcase.md`、`22-ai-workspace.md` 与维护说明。
- 检查 AI 选区原文映射和既有建议保存，不新增工具宣称。
- 运行 `npm test`、`npm run lint`、`npm run i18n:check`、`npm run build`，用固定构建执行相关 Edge 回归。
- 更新验收记录，核实并重启正式服务，保留其他已有修改，不自动提交。

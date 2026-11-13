# 左侧浏览与当前内容分离实施计划

**目标：** 切换左侧工作区及符号 / 术语标签页时只更换列表；点击条目、新建条目或打开明确引用时才切换中间内容。

**架构：** 保留版本 8 的 `view`、活动条目 ID 及资料格式，让它们继续表示当前打开的内容。左侧浏览位置作为窗口内界面状态独立保存，实际打开其他内容时跟随目标。笔记、词典和地图分别接收列表与正文显示状态；筛选操作显式指定所浏览的笔记类型。

**技术栈：** React、TypeScript、Vitest、Playwright / Microsoft Edge。

1. 在 `e2e/sidebar-interactions.spec.ts` 与 `e2e/research-dictionary-terms.spec.ts` 增加浏览不切页、点击条目才切页、草稿保留、独立筛选和新建的场景，先验证缺失行为会失败。
2. 修改 `src/components/ResearchNotebook.tsx`，独立控制左侧工作区；修改 `ResearchNoteTree.tsx`、`ResearchNoteManagement.tsx` 与 `src/domain/researchNoteLibraries.ts`，使列表筛选、选择及新建面向所浏览的类型。
3. 修改 `ResearchDictionary.tsx`、`ResearchTermDictionary.tsx` 和 `ResearchTheoryDocuments.tsx`，分别控制列表与详情；确保空列表仍可新建，明确引用能打开正确内容。
4. 更新受交互变更影响的既有浏览器用例，同步 `docs/wiki/02-workspace.md`、`docs/wiki/05-symbol-dictionary.md`、开发说明和验收记录。
5. 运行 `npm run check` 及相关 Edge 回归，在隔离虚构资料中验收；确认正式进程后重启本地服务。保留工作区原有修改，不自动提交。

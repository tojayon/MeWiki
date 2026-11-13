# 使用手册独立标签页实施计划

> **For Codex:** 按 `superpowers:executing-plans` 逐项执行；保留工作区已有修改，不自动提交。

**Goal:** 使用手册从研究记录列表移到可打开、关闭的独立左栏标签页。

**Architecture:** 保留现有手册笔记及稳定 ID，通过身份区分手册和普通笔记。手册标签页的可见性、搜索和左栏选择属于界面状态；打开标签页只临时补全章节列表，不替换中间正文和保存资料，实际点击章节才补存缺失页面并打开对应笔记，保留用户编辑。

**Tech Stack:** React、TypeScript、现有公共分类列表、Vitest、Microsoft Edge / Playwright。

---

## 1. 先验证预期行为

- 新增 `e2e/manual-sidebar.spec.ts`，使用虚构资料并拦截资料库接口。
- 验证研究记录不含手册、显式开关、正文保持、章节打开、独立搜索、关闭保留资料、窄屏与键盘导航。
- 先在现有实现运行，确认因缺少独立手册标签页而失败。

## 2. 实现独立入口

- 在 `src/domain/meWikiManual.ts` 提供手册稳定身份判断，在 `meWikiWorkspace.ts` 分离只补缺页和打开目录操作。
- `ResearchNoteTree.tsx` / `ResearchNoteManagement.tsx` 的列表、计数和筛选排除手册，保留普通同名或同标签笔记。
- 新增 `ResearchManualSidebar.tsx` 复用公共列表，提供章节搜索和关闭按钮。
- `ResearchNotebook.tsx` 增加可选手册图标标签页，原“使用手册”按钮切换其开关；设置页入口始终打开手册。保留标签页与正文解离、侧栏折叠和按库隔离。
- 调整 `ResearchNotebookPage.tsx` 和受影响旧场景，补充英文消息。

## 3. 文档与验收

- 同步 `docs/wiki/README.md`、`02-workspace.md`、必要的快捷操作说明、`docs/DEVELOPMENT.md` 与 `docs/AI_HANDOFF.md`。
- 运行 `npm test -- --maxWorkers=2`、`npm run lint`、`npm run i18n:check`、`npm run build`。
- 用独立端口、设置和构建运行手册、侧栏、设置、中英文及工具栏 Edge 检查，目视复核桌面与窄屏。
- 将实际结果写入 `docs/VERIFICATION.md`；沿用已报告的服务重启审批限制，不重试被拒绝的停止操作，只读核对正式资源。

## 完成记录

已实现独立手册入口、正文与列表解离、按库开关偏好和空库延迟保存；使用手册与开发说明已同步。最终 751 项单元测试、64 项 Edge 检查、翻译、代码检查及构建通过。实际验证、一次附件测试超时后的原样复查、正式资源核对和未重启服务的边界见 `docs/VERIFICATION.md` 对应记录。未自动提交。

## 后续调整：与研究笔记统一样式

按用户后续要求，手册列表改用研究笔记相同的标签分类表格和条目样式，保留原标签、核对状态、分类折叠及独立搜索。删除不再使用的平铺列表分支与手册专用样式，不修改手册内容或标签数据。使用既有手册、侧栏及公共选择器浏览器场景验证，并同步使用手册和开发说明；实际结果见验收记录。

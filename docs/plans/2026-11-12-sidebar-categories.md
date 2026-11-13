# 左侧分类面板调整 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 分类表格贴合左栏边缘，在搜索工具栏最右侧提供全部折叠／全部展开按钮，移除笔记核对统计栏。

**Architecture:** 保留共用分类树及现有折叠偏好，在侧栏搜索行末尾提供独立工具位置，分类树通过 React context 与 portal 显示当前列表的批量按钮。左栏折叠只隐藏条目，所有父、子分类与未分类标签始终显示；批量操作递归覆盖当前分类，搜索中的开合仍是临时状态。字符串数组偏好用标记区分旧的整分支折叠与新的条目折叠，单独展开子分类后刷新保持状态；引用选择器保留原折叠方式。

**Tech Stack:** React 19、TypeScript、CSS、Lucide、Vitest、Playwright / Edge。

## Task 1：验证分类行为

- 新增 `e2e/sidebar-categories.spec.ts`，使用虚构笔记、符号和术语，拦截资料库 API。
- 先在独立 5438 开发服务运行，确认缺少批量按钮和留白导致预期失败。
- 验证各侧栏的贴边布局、递归开合、刷新保持、筛选临时状态与空结果禁用。

## Task 2：实现界面

- 修改 `src/components/ResearchTagTree.tsx`、`ResearchClassifiedList.tsx`，新增 `ResearchTagTreeToolbarContext.ts` 与 `ResearchTagTreeToolbar.tsx`，复用原折叠状态及保存路径。
- 修改 `ResearchNotebook.tsx`、`ResearchNotebook.css` 与各侧栏搜索工具，将批量按钮放在搜索行最右侧，顶部标签切换栏保持原样；分类表格取消外部留白及外层圆角。
- 修改 `ResearchNoteManagement.tsx`、`ResearchNoteManagement.css`，移除已核对数量、篇数及进度条，保留筛选入口和笔记自身核对状态。
- 在 `src/i18n/en.ts` 补齐新按钮英文文案。

## Task 3：手册与验收

- 更新 `docs/wiki/02-workspace.md`、`03-pages-and-tags.md` 与 `docs/DEVELOPMENT.md`，说明批量开合和搜索恢复。
- 调整 `e2e/manual-sidebar.spec.ts` 的旧统计断言，保留手册排除检查。
- 运行 `npm test`、`npm run lint`、`npm run i18n:check`、`npm run build`；运行分类、侧栏、手册及公共选择器的 Edge 回归。
- 更新 `docs/VERIFICATION.md`；核对进程归属及启动配置后重新启动本项目正式服务。保留已有修改，不自动提交，不访问真实资料做测试。

## 完成记录

初次实现三项任务后，按钮按用户说明移至搜索工具栏最右侧；此前 874 项单测与 38 项 Edge 为历史验收。

按用户进一步说明，折叠已改为只隐藏条目，所有父、子分类及未分类标签保留。旧偏好通过完整未筛选分类树转换，覆盖搜索外和另一笔记库的子分类；单独展开与刷新保持。最新单测 921 项通过、4 项跳过，lint、翻译检查和构建通过；正式构建相关 Edge 39 项通过，正式静态页面另以全部接口拦截的虚构数据完成复查。手册及开发说明同步，正式服务为 `127.0.0.1:5280` / PID 48252，临时验收服务已停止。详见最新验收记录；保留工作区未提交状态。

后续修正长父标签撑高后右侧分类出现白条的问题：子列表沿高度拉伸，并由实际可见子行分配剩余空间，使多层分类背景和边框连续铺满。新增回归已先复现失败，再验证四类列表在桌面／窄屏、展开／折叠及单链／多行后代下的连续性。最终 921 项单测与 40 项相关 Edge 通过，lint 和构建通过；手册同步。正式服务已更新为 `127.0.0.1:5280` / PID 61484，未访问真实资料或提交改动。

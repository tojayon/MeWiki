# 图片创作面板与相册整理

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把图片创作属性固定在右侧，图片选择改为固定高度的横向相册，并落实减少重复标签和说明的 UI 原则。

**Architecture:** `PublicationDialog` 管理三栏与右栏开关；属性面板从画布内容移到工作区同级，复用左侧的 44px 工具栏和分区样式，内容独立滚动。窄屏使用可收起的右侧抽屉。中间图片区分为可滚动画布和固定相册，选图时不重复渲染第二套缩略图；仅调整呈现，不改变图层、模板、作品和批次协议。

**Tech Stack:** React、TypeScript、CSS Grid/Flex、原生输入控件、现有 Lucide 图标与 Edge/Playwright。

## Task 1：规范与行为验收

- 在 `AGENTS.md`、`docs/DEVELOPMENT.md` 及贡献入口记录 “Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.”，保留必要字段名、无障碍名称、错误和条件性状态说明。
- 在 `e2e/publication-composition.spec.ts` 增加右侧贴边、工具栏对齐、独立滚动、收起恢复、单行横向相册和窄屏检查，先在现有隔离构建观察缺失行为。

## Task 2：固定面板与精简内容

- 修改 `PublicationDialog.tsx`、`PublicationCompositionPanel.tsx` 与对应 CSS：右栏同级布局、44px 顶栏、独立滚动、外部开关；宽度不足时使用右侧抽屉。
- 去掉重复的画布说明、尺寸、批量描述与已选数量；属性标签精简，保留完整无障碍名称。必要的操作说明移入现有信息入口及使用手册。

## Task 3：横向相册

- 修改 `PublicationImageWorkspace.tsx/.css`：画布占用中间剩余空间并独立滚动，相册固定高度，缩略图单行横向浏览；保留勾选、原图预览、删除、上传、空白画布与当前项。
- 选图视图只保留一条相册；画布编辑视图保留已选图片切换条，原件仍按需解码，导出顺序不变。

## Task 4：文档与最终验证

- 更新第 20 章手册、开发/接手说明和验收记录，说明右侧面板与相册操作。
- 使用独立 `.mewiki/composition-layout-*` 配置、构建与结果目录完成相关 Edge 回归和目视检查；执行 `npm test`、lint、i18n、品牌及标准构建。
- 只修改本请求涉及的页面和文档，保留共享工作区其他修改，不自动提交，不操作真实资料或重启正式服务。

## 完成记录

- [x] Task 1：规范已写入独立文档并关联开发入口；旧构建上的两项新增布局验收先失败。
- [x] Task 2：右栏固定、独立滚动、窄屏抽屉与焦点恢复完成；删除重复说明，动态短标签补齐英文，错误定位自动展开。
- [x] Task 3：固定高度横向相册完成，保留原图颜色、导出顺序和键盘操作；编辑视图切换条完整显示文件名。
- [x] Task 4：手册、开发/接手说明和验收记录同步。最终 Edge 30 项通过；单测 921 项通过、4 项跳过，lint 退出 0（仅既有字体模块警告），翻译/品牌检查与标准构建通过。桌面及中英文窄屏截图已目视核对，详细日志见 [VERIFICATION](../VERIFICATION.md#图片创作固定面板与横向相册2026-11-12)。

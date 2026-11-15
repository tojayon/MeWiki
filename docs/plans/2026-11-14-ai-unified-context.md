# AI 统一引用入口实施计划

> **For Codex:** 按以下步骤在当前工作区执行，保留前阶段修改；本轮不自动提交。

**Goal:** 用一个 `@` 入口管理当前对象、明确引用、选区和整库检索，所见范围与实际发送一致。

**Architecture:** 草稿在自动当前对象与明确引用之间切换；移除默认对象或选定其他对象后保持明确模式，不偷偷补回当前页面。整库检索有独立可移除标签，并冻结到任务快照；普通功能模块引用不授权整库。选区继续锁定来源，所有修改仍由现有审阅与保存流程处理。

**Tech Stack:** React、TypeScript、Vitest、Playwright（Edge）。

## 1. 范围解析与任务快照

- 新增 `src/ai/composerContext.ts` 与相邻测试，覆盖默认对象、移除后导航、显式 B 排除 A、整库排除手册、选区冲突。
- 扩展 `src/ai/taskSupport.ts`、`chatActions.ts`、`session.ts`、`conversations.ts`：可选字段兼容 v1，重试冻结原范围，编辑旧消息沿用原对象，下一问草稿独立保留。
- 先运行新增测试观察预期失败，再实施；运行 `npm test -- src/ai/composerContext.test.ts src/ai/taskSupport.test.ts src/ai/chatActions.test.ts src/ai/session.test.ts src/ai/conversations.test.ts`。

## 2. 单一引用入口

- 调整 `AiWorkspace.tsx/.css`、`AiReferencePicker.tsx/.css` 与 `AiMaterials.tsx`，移除旧下拉框及对应样式和插槽。
- 当前页面是可移除标签；`@` 菜单可重新添加当前页面或开启整库检索，范围标签和选区可见；运行中可准备下一问但不改变原任务。
- 补全英文翻译；键盘、中文输入、短窗、窄屏与菜单内部滚动继续可用。

## 3. 浏览器验证与文档

- 新增隔离 Edge 用例，并把既有测试对旧下拉框的操作改为引用入口，保留权限、选区、失败重试和界面断言。
- 更新 `docs/wiki/22-ai-workspace.md`、架构、接手说明与验收记录。
- 运行完整 `npm test -- --maxWorkers=2`、lint、build、i18n、brand、离线 AI 评测及相关 Edge 回归。测试仅使用虚构资料与隔离设置，不接触真实资料或服务密钥。

# 独立界面与正文字号 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在通用设置中独立调整界面与正文字号，记住每个资料库的阅读偏好，并查清旧的 20 MiB 字体提示。

**Architecture:** 界面默认 14px、范围 12–20；正文默认 15px、范围 12–32，均为整数。偏好按稳定资料库 ID 存在浏览器中，支持同库窗口同步及存储失败后的会话回退。界面文字与正文分别使用独立 CSS 尺寸单位，不缩放整页；正文复用共享排版主题。导出捕获显式使用自己的基准尺寸，不继承阅读字号。

**Tech Stack:** React、TypeScript、CSS 自定义属性、Vitest、Playwright / Edge。

---

### Task 1: 偏好与边界

Files: 新建 `src/state/fontSizes.ts`、`src/state/fontSizes.test.ts`。

1. 先测试 `readFontSizes` / `saveFontSize`：默认值、单独修改和恢复、库隔离、损坏数据、上下限、整数、存储失效。
2. 运行 `npm test -- src/state/fontSizes.test.ts`，确认因缺少模块失败。
3. 实现 `fontSizeLimits = { interface: { default: 14, min: 12, max: 20 }, document: { default: 15, min: 12, max: 32 } }`，只接收范围内整数；持久化 JSON、事件带稳定库 ID。
4. 复跑测试，确认通过。按用户要求不自动提交。

### Task 2: 设置与共享排版

Files: `InterfaceFontContext.ts`、`InterfaceFontProvider.tsx`、`InterfaceFontSettings.tsx/.css`、`SettingsPage.tsx`、`index.css`、普通组件 CSS、`PublicationReadingSurface.tsx`、`publicationMarkup.ts`、`src/i18n/en.ts`。

1. 先增加 `e2e/font-sizes.spec.ts`：分别调整字号、刷新、同库窗口/切库同步、编辑与分屏、Callout/标签页/表格、手机大字、导出隔离。
2. 建立独立端口 5422、隔离配置与构建，运行一项浏览器测试确认设置尚不存在。
3. 扩展提供器，通过独立 effect 设置根字号及两种单位；切库卸载清理。设置采用原生选择框与各自恢复默认的图标按钮，实时预览。
4. 普通界面字号用 `calc(var(--mewiki-interface-unit, 1px) * N)`；正文文字用对应 document 单位。保留图形画布和 PDF 内嵌几何。手机与桌面均使用用户选择的正文字号，移除手机固定 14px 覆盖。
5. 导出读取面显式重置基准字号与单位，模板仍决定输出字号。运行专项 Edge 检查与现有相邻回归。

### Task 3: 大字体、手册与验收

Files: `e2e/interface-fonts.spec.ts` 或 `e2e/font-sizes.spec.ts`、`docs/wiki/02-workspace.md`、`docs/wiki/15-*.md`、`docs/wiki/20-social-export.md`、`README.md`、`docs/DEVELOPMENT.md`、`docs/AI_HANDOFF.md`、`docs/VERIFICATION.md`。

1. 在浏览器和临时本地库中导入 >20 MiB 的有效字体，核对原件和重新加载；不接触真实资料。
2. 只读核对正式服务进程和静态资源。当前 5280 的 PID 25024 启动于 2026-11-12 09:42，早于后续更新；源码统一为 100 MiB，不给旧服务添加兼容请求。
3. 更新手册说明两种字号的影响、范围、默认恢复、库隔离、导出独立，以及更新后台并刷新页面才能替换旧限制。
4. 运行 `npm test -- --maxWorkers=2`、`npm run lint`、`npm run i18n:check`、`npm run build`、相关 Edge；目视检查截图、本地文档链接和 `git diff --check`。
5. 只读审查并修复发现的问题；记录本轮实际验收结果。保留用户此前“暂不重启”的选择，不主动重启正式服务；验收时重新核对进程与静态资源，若外部已更新运行环境，则核对当前版本。

## 实施补充

- 用户追问行内代码字体后，将其接入普通正文字体；多行代码块继续使用等宽字体。原生和参数模板均同步，样板含行内代码示例。
- 独立只读审查发现正文公式与分类标签遗漏，新 Edge 用例先复现后修复，并复核通过。顶部笔记名称属于 UI，正文内容标题属于正文。
- 正式 5280 原进程 PID 25024 / 09:42 已在开发期间被外部更新为 PID 68852 / 11:46；本轮未执行重启。源码限制保持 100 MiB，使用隔离临时库验证大字体。

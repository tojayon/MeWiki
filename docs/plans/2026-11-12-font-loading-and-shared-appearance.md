# 字体首次显示与独立页面外观 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 刷新后首次显示已选字体，切换字体时保持连续显示，所有应用页面共用当前资料库的界面与正文字号偏好。

**Architecture:** 将现有界面字体提供器分为资料库工作区包装与显式库 ID 的通用提供器。界面加载直接校验和解码原字体二进制；页面在首次字体和布局用到的本地字库准备好后显示，后续切换在解码完成后替换。独立导出页接入同一提供器，原文阅读跟随偏好，静态捕获和样板继续使用模板自己的字体及字号。默认使用现有本地 Noto Sans SC Variable，保留操作系统备用字体。

**Tech Stack:** React 19、TypeScript、CSS 自定义属性、FontFace / FontFaceSet、IndexedDB、Vitest、Playwright / Edge。

---

### Task 1：先复现首次闪烁和独立页遗漏

- 新增 `e2e/font-loading.spec.ts`：阻塞已保存字体的解码，逐帧记录实际内容的可见字体；覆盖刷新、字体切换、失败 / 超时与本地默认字库。
- 覆盖导出 UI 与原文阅读的字体 / 字号同步、刷新恢复；确认样板、捕获基准和模板参数不被阅读偏好修改，实际生成图片。
- 使用 `.mewiki/font-loading.playwright.config.mts`、5424 端口与独立设置文件，不读取真实资料。
- 运行新检查，确认因当前可见字体切换、导出 UI 未接入偏好而失败。

### Task 2：二进制加载与首次显示

- 在 `src/state/userFonts.test.ts` 先补界面二进制加载的摘要 / 格式 / 隔离 / 取消检查，运行确认失败。
- `src/state/userFonts.ts` 复用库绑定与原件读取，新增二进制 `FontFace` 入口，保留导出的 data URL 接口和 100 MiB 上限。
- `src/components/InterfaceFontProvider.tsx` 保留工作区适配，提取 `src/components/LibraryTypographyProvider.tsx`；首次显示屏障不改变应用布局，加载异常解除屏障，后续切换保留上一字体直到新字体就绪，卸载 / 切库取消旧请求并移除旧 FontFace。
- `src/index.css` 引入本地字库，`src/styles/documentTheme.ts` 同步默认字体；不新增字体依赖、运行时 CDN 或整页缩放。

### Task 3：导出页复用与模板隔离

- `src/components/PublicationPage.tsx` 使用冻结会话的稳定库 ID 挂载同一提供器，不挂载笔记控制器。
- `src/components/PublicationReadingSurface.tsx` 显式设置模板字体、合成和界面 / 正文基础尺寸；原文选择区域继承阅读设置。
- 保持同库窗口事件 / storage / focus 同步，模板选择、字体原件和笔记内容协议不变。
- 运行新专项与既有字体、字号、导出、设置、多库检查；检查桌面和窄屏。

### Task 4：手册、审查与交付

- 更新 `docs/wiki/02-workspace.md`、`docs/wiki/20-social-export.md`，说明字体来源、刷新准备、小字号建议以及页面 UI 与模板输出的关系。
- 更新 `docs/DEVELOPMENT.md`、`docs/AI_HANDOFF.md`、`docs/integrations/README.md`，维护英文消息。
- 按 requesting-code-review 技能请求只读审查，修复实际问题。
- 运行 `npm test`、`npm run lint`、`npm run build`、i18n / 品牌检查与文档链接检查，将本轮证据记入 `docs/VERIFICATION.md`。
- 尊重用户先前暂不重启的选择；交付构建结果，不自动提交、不重启正式服务、不覆盖真实手册。

## 完成记录

四项已完成。只读审查后追加默认分段、placeholder 和内置字库挂起的失败回归并修复；最后复核通过。`npm run check` 通过，840 项单测通过、4 项默认跳过；相关 Edge 扩展 78 项、最新生产构建字体专项 8 项、开发 StrictMode 15 项分别通过，存在重叠不相加。文档与目视检查完成，详见[验收记录](../VERIFICATION.md#字体首次显示与独立页面外观2026-11-12)。保留现有工作区修改，不自动提交；正式服务依用户要求暂不重启。

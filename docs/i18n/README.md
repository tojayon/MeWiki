# 界面翻译 · Interface translations

[中文项目首页](../../README.md) · [English overview](../../README.en.md) · [开发说明](../DEVELOPMENT.md)

## 使用与边界

顶部语言图标提供简体中文和 English；窄屏时在“更多笔记功能”菜单中。首次根据浏览器的首选语言选择，已选偏好优先，保存在当前站点的 `mewiki:locale`。同一站点的窗口同步界面语言；存储不可用时仍能在当前会话切换。

切换语言只更新界面。笔记、符号、标签、资料库名称、附件和已经保存的手册不会被自动翻译；编辑器和弹窗中的草稿不因切换而重建。完整手册当前为中文；新增的社交图文导出章节与原有章节使用同一 Markdown 来源。

## 翻译维护

- `src/i18n/locale.ts`：语言检测、偏好、订阅、参数化消息及日期/数字格式。
- `src/i18n/react.ts`：React 订阅，使用 `useSyncExternalStore` 更新现有界面。
- `src/i18n/mediaError.ts`：仅按完整系统模板和固定媒体类型翻译错误，包含视频封面的图片校验；外部未知错误原样保留。
- `src/i18n/publicationError.ts`：仅翻译固定的导出设置路径、纹理层、静态内容项及原因模板；任意未知错误与用户文本保持原样。
- `src/i18n/en.ts`：本地英文词典，中文源消息是稳定键，无运行时翻译服务。
- `scripts/check-i18n.mjs`：重复消息、参数集合和静态调用覆盖检查。

组件调用 `useLocale()` 订阅语言，使用 `t("取消")` 或带参数的 t 模板。动态值按原样插入，不二次解释其中的消息键或 HTML。只翻译明确属于系统的界面文案；不要对用户标题、标签、说明、笔记内容或服务器载荷遍历翻译。

选项 value、React key、业务比较、资料协议、资料库 ID 和偏好存储键保持稳定。向 `ResearchSelectionField` 传显式稳定的 `storageKey`，不要用翻译后的 label 生成它。系统角标位置标签在显示时翻译，角标值和说明保持原样。

错误与长期状态保留源消息，在显示边界调用 `localizeError`，以便切回中文。外部服务未识别的错误原样保留。异步操作和 memo 不应为换语言重写资料；只在确实输出本地化文字时依赖语言。直接写 DOM 的 tooltip/无障碍标签需随语言更新，PDF 不需要为翻译重新渲染页面。

媒体错误保存中文源类型，通过 `localizeMediaError` 在显示时翻译完整提示和其中的系统类型名称。视频封面按图片校验，不沿用视频类型；不要保存已翻译的提示，或对用户文件名执行替换。相关回归位于 `src/i18n/mediaError.test.ts` 和 `e2e/media-errors.spec.ts`。

新增文案时补充英文，保留所有 `{0}`、`{1}` 等参数。执行 `npm run i18n:check` 和 `npm run check`；动态系统标签还需人工核对。浏览器回归为 `e2e/i18n.spec.ts`，覆盖初始选择、刷新、跨窗口同步、草稿保留、存储受限、窄屏和插件入口。

## Contributing a translation

MeWiki currently supports Simplified Chinese and English. Translate interface messages in `src/i18n/en.ts`, keep numbered placeholders unchanged, and run `npm run i18n:check`. Use `useLocale()` to subscribe and `t()` only for system interface messages. Notes, symbol names, descriptions, tags, library names, identifiers, and saved manual pages remain user data.

New locales should extend the locale type, detection, catalog selection, language settings and tests together. Do not translate values used by persistence, protocols or business logic. Keep asynchronous status in its source form and translate at the display boundary. No external translation service or runtime CDN is required.

## 截图更新 · Gallery

执行 `npm run build` 后运行 `npm run docs:screenshots`。需要安装 Microsoft Edge；如需安装浏览器，可使用 Playwright 的标准安装流程。截图脚本启动独立 5282 预览，仅使用内置虚构示例，拦截资料库 API，不读取真实笔记和设置。生成 8 张图片到 `docs/assets/`，普通浏览器回归默认跳过此任务，避免意外改写公开图片。

After building, run `npm run docs:screenshots` to recreate the eight screenshots using isolated fictional data. Review the images visually before publishing. The screenshot suite refuses other ports and does not use real libraries.

# 术语逐处显示模式实施计划

**目标：** 在笔记中逐处选择术语名称、英文名称、中英文缩写、具体别名（含英文别称），由用户多次引用同一术语自由组合，选项清楚标明类型。

**架构：** 延续版本 8 和现有 `mewiki-term:` 引用模式，不增加预设搭配。中英文类型标签集中管理，插入选择器与引用编辑面板共用；旧模式和逐条别名 ID 保持兼容。

**技术栈：** TypeScript、React、Vitest、Playwright / Microsoft Edge。

1. 在 `e2e/term-reference-formats.spec.ts` 先增加按类型选择单一显示形式的检查，覆盖在一段文字中多次引用同一术语并独立修改、英文别称、保存刷新和窄屏操作，运行并确认新选项类型说明尚未出现。
2. 新建 `src/components/researchTermReferenceForms.ts` 管理类型标签；更新 `ResearchMentionTextarea.tsx`、`ResearchReferencePopover.tsx` 与 `src/i18n/en.ts`，编辑选项同时展示类型与实际文本，提供本次引用预览。缺少的字段显示“未填写”并禁用，引导回词典补充。英文别称仍按已有逐条别名稳定身份选择。
3. 保留已有完整形式的兼容行为，不增加组合模式或自动首次出现逻辑；各次引用只保存各自的现有 `display` 和别名 ID。
4. 浏览器检查使用独立端口 5434 与 `.mewiki/term-display-*` 配置和产物，只操作虚构资料。
5. 同步 `docs/wiki/05-symbol-dictionary.md` 的字段说明、格式示例和操作步骤，以及开发、集成与接续说明。运行全量单测、lint、翻译、构建与相邻 Edge 回归；记录实际结果。
6. 核对本项目正式服务身份后，按当前根目录要求重新构建并重启服务，不自动提交、不覆盖用户资料。

验收时发现开发态 StrictMode 重建编辑器节点后，直接点击渲染引用会保留旧 DOM 作为浮层锚点，使浮层落在主对话框外而无法点击。在 `ResearchReferenceEditor.tsx` 的编辑器布局阶段按当前位置恢复待打开引用的当前 NodeView DOM，用作锚点与 portal 宿主，保留节点身份校验；专项同时验证开发态直接打开、真实取消和应用操作。

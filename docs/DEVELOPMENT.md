# MeWiki 开发说明

AI 原位置逐项审阅：`AiInlineSuggestion` 在块／标签／属性附近提供同意、拒绝、调整；`reviewDecisions.ts` 保留原建议身份与基线，复用字段和操作校验，调整只写本库会话。`AiWorkspace` 逐项批准后对独立的未处理项衔接基线，已批准项不得重写，常规手动编辑不得触发此转换；保持同页、手选标签及滚动。会话 v1 的可选 `rejectedIds` 按库恢复，存储失败不丢建议。手册及回归见[第 22 章](wiki/22-ai-workspace.md)、[计划](plans/2026-11-12-ai-inline-decisions.md)、`reviewDecisions.test.ts` 和 `e2e/ai-inline-review.spec.ts`。

图片创作画布由 `src/domain/publicationComposition.ts` 的版本化白名单场景驱动，仍只有左侧 `PublicationOptions.width/height` 一套画幅尺寸。文字、系统贴纸和本地装饰分别放在 canvas/screen 百分比空间；screen 随设备主体整体变换。预览和最终 Edge 使用 `publicationImagePages.ts` 与 `publicationCompositionLayout.ts`，新增图层属性时同时维护解析、逐图属性合并、静态构造、布局诊断、英文、模板 v2 与作品备份。iframe 节点跨 window，DOM 增量更新使用 nodeType、稳定层 ID 与 importNode，避免 instanceof 使样式更新失效。

`useCompositionEditor.ts` 保存共用场景和单图属性覆盖，拖动一次事务、最多 50 步；`useCompositionLibrary.ts` 首次显式保存原件后自动保存，不因图层显示而把未保存原图写入资料。作品/贴纸服务按稳定库与插件隔离，revision 冲突不能静默覆盖，删除不回收原件。`imageDesignPackage.ts` 作品 ZIP 只接受固定条目名、原件摘要和有界解压流；模板仅保存共用层，不得混入批次原图或逐图修改。独立图片入口使用空快照，不挂载原笔记控制器。详见[API v2](plugins/API_V2.md#宿主图片创作画布)及[使用手册](wiki/20-social-export.md#在画幅内添加文字和贴纸)。

## 接续开发与文档入口

界面开发统一遵循 [UI 开发规范](UI_GUIDELINES.md)：**Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.** 优先用布局和分组表达关系，减少重复提示；必要字段名、单位、无障碍名称和错误状态仍需保留。

图片创作的 `PublicationCompositionPanel` 是 `PublicationDialog` 的同级右栏，与左侧设置共用 44px 顶栏和折叠分区，内容独立滚动；1100px 及以下改为可收起的右侧抽屉，开关留在中间工具栏。`PublicationImageWorkspace` 将可滚动画布与固定高度相册分开，选图视图只显示一条横向相册，编辑视图保留已选切换条。当前项定位只滚动相册，不能让整页跳动。短可见标签与完整 aria 名称分开维护，动态字段也必须补英文；常规帮助放 `PublicationInfo` 和手册。回归见 `e2e/publication-composition.spec.ts`。

[AI 接手指南](AI_HANDOFF.md)记录阅读顺序、关键数据流、测试隔离、发布现状与下一阶段入口。接续任务先检查当前差异与实际源码，不能将历史聊天或设计提案当成已实现能力。

- 使用者操作以 [Wiki 手册](wiki/README.md)为准；手册随构建进入首次资料库。
- 外部程序使用现有[开放集成协议](integrations/README.md)；随附插件贡献见[插件开发入口](plugins/README.md)。
- 声明式本地插件包、[内容 API v1](plugins/API_V1.md)与[图文导出 API v2](plugins/API_V2.md)已实现；可执行运行环境、通用编辑器贡献点与社区目录见[生态设计](plugins/ARCHITECTURE.md)与[分阶段路线](plans/2026-11-10-plugin-ecosystem.md)。

## 目录与边界

| 目录 | 内容 |
| --- | --- |
| `src/components/` | 页面编辑、阅读、符号与选择界面 |
| `src/i18n/` | 界面语言、英文消息与 React 订阅 |
| `src/domain/` | 资料模型、公式、标签、引用及校验逻辑 |
| `src/state/` | 浏览器保存、本地资料库客户端与窗口状态 |
| `src/integrations/`、`src/plugins/` | 外部内容协议、插件宿主与随附插件 |
| `server/` | 本地资料库、附件、导出、元信息和资源服务 |
| `public/integration/` | 外部宿主使用的公开 SDK 与类型 |
| `docs/wiki/` | 内置完整手册的 Markdown 单一来源 |
| `e2e/` | Edge 浏览器验收与隔离示例 |

`npm run dev` 提供开发服务器；`npm run build` 生成正式资源，`npm start` 启动包含本地 API 的预览服务。完整应用依赖 Node 服务，不能只发布静态页面替代。贡献流程见[贡献指南](../CONTRIBUTING.md)，开源准备见[材料目录](open-source/README.md)。

## 品牌标志与应用图标

品牌 SVG 原件统一保存在 `public/brand/`，文件选择与预览见 [Logo 与应用图标](BRANDING.md)。导航、设置和关于页使用黑底方形 M；笔画按方形重新延展，左下和右侧延伸至画幅外，不能复用圆形版的截断弧线收尾。`mewiki-app-icon.svg` 是方形笔画的单一来源，圆角、白底、透明前景和 App PNG 均由它生成；圆角版对背景与笔画整体裁切。浏览器标签页与中英文 README 使用圆形 Logo，由 `mewiki-mark.svg` 去除外围留白，派生 `public/mewiki.svg`、透明 `mewiki-favicon-{16,32,48}.png` 与 ICO。`index.html` 的 SVG、PNG、ICO 版本参数一同更新以刷新缓存。180px 主屏幕图标和 `manifest.webmanifest` 的 192/512px 图标继续使用满版方形，源图不预裁切系统圆角。

修改 SVG 后运行 `npm run brand:generate`，通过 `scripts/generate-brand-assets.mjs` 和已有 Sharp 依赖统一生成本地 PNG、ICO、SVG 别名和产品介绍横幅。横幅布局在 `scripts/branding/hero-template.svg` 维护，圆形图标由原件注入；不要直接修改派生曲线或引用项目外资源。`npm run brand:check` 检查派生文件与原件一致，已纳入 `npm run check`。资源变更同步快速开始手册，完成桌面与窄屏 Edge 检查。README 的产品理念、能力和文档入口保持中英文一致，公开截图通过 `npm run docs:screenshots` 在隔离配置与虚构资料上更新。

## 手册内容展示与离线素材

`docs/wiki/21-content-showcase.md` 是“内容类型展示”笔记的单一内容来源，目录和正文说明页均链接到它。普通内容继续使用 Markdown；不能用普通 Markdown 表达的图表、媒体、文献、草图、同步引用及兼容卡片，以 `mewiki-block` 代码围栏保存普通内容块 JSON。`createMeWikiManual()` 仅在生成内置手册时解析这些围栏，经共享的 `normalizeResearchBlock()` 校验后成为正常内容块，稳定 ID 不随标题和位置改变。此语法不是普通 Markdown 导入的新协议；交换手册时使用应用导出的 Markdown 或含附件备份。

随附原创素材位于 `docs/wiki/assets/`，清单登记原件 SHA-256、大小和类型；手册 JSON 的 `assetId: "manual:文件名"` 及行内 `webbench-asset:manual:文件名` 在生成时解析为既有哈希引用，不修改版本 8 或附件协议。`meWikiManualAssets.ts` 通过构建资源 URL 读取并核验原件，浏览器附件读取可直接使用随附文件；本地客户端仅在对应演示原件返回 404 时，通过既有上传协议补齐。含附件导出也先补齐所选内容引用的演示原件，其他缺失附件和服务错误保持原有行为。迁移与备份因此保留完整附件，不依赖是否曾打开过展示页。

重建素材可运行 `node scripts/generate-manual-assets.mjs`，只使用本项目依赖和本机 Edge；会更新这五份示例与清单，不读用户资料。新增类型时同步扩展示例、资源 URL 登记及覆盖测试。回归入口：`meWikiWorkspace.test.ts`、`server/meWikiManualMedia.test.ts`、`e2e/manual-content-showcase.spec.ts`。

## 流程图放大预览

查看入口位于 `ResearchDiagramBlock.tsx`，点击图形或工具栏放大图标均使用图片的 `DeviceInspectorModal`；草图只由工具栏打开，保留画布绘制事件。流程图从已挂载且校准完整边界的 SVG 生成独立图片快照，避免重复 Mermaid 元素 ID 与样式；草图共用 `drawingSvg()` 的矢量输出。dialog 保持挂载，通过 `open` 控制原生关闭及焦点恢复，并用组件唯一 ID 关联标题。开窗时只阻断 Escape 冒泡，保留原生 cancel，避免在 AI 审阅内连带退出外层。内容、模式或库上下文变化丢弃快照；界面状态不进入资料或 Agent 工具。相邻回归在 `e2e/research-rich-content.spec.ts` 和 `e2e/ai-workspace.spec.ts`，操作见[绘图手册](wiki/14-diagrams.md#放大查看)。

## 符号与术语词典

`ResearchNotebookState` 保持版本 8，新增的 `terms` 为可选数组，旧资料没有该字段时继续按原符号资料读取。术语与符号都使用稳定 ID；正文绑定写成 `mewiki-term:<id>` 或 `mewiki-symbol:<id>`，渲染时从当前词典解析名称和记号，所以改名、改记号不会改写链接本身。符号改名会自动保留旧名称为别名，术语的别名由用户维护。

术语的 `englishName`、`englishAbbreviation`、`chineseAbbreviation` 为可选字符串，空值保存时省略。`aliases: string[]` 继续用于旧格式，新增可选 `aliasEntries: { id, name }[]` 保存逐条别名身份，两个数组在编辑保存时同步；文件校验拒绝重复别名 ID、空名称或与 `aliases` 不一致的记录，避免规范化静默丢失文字。没有 `aliasEntries` 的旧术语通过 `researchTermAliases()` 为每个旧名称提供确定 ID，不因读取而向旧资料添加字段；编辑该术语后保留这些 ID，别名改名和重排不会改变目标。

术语引用可选查询参数 `display=full|english|english-abbreviation|chinese-abbreviation|alias`，别名形式另存 `alias=<稳定别名 ID>`；未指定或未知形式按 `name` 处理，符号的 `x1/x2/x3` 继续兼容。`formatTermReference()` 负责从当前词条生成显示内容：完整形式为 `名称（英文名称, 英文缩写）` 并省略缺失项，失效缩写或别名回退名称。`termReferenceMarkdown()` 在插入时同时写可读标签及显示形式；渲染从稳定 ID 实时取值，旧 Markdown 标签不作为当前词典名称的依据。`ResearchMentionTextarea` 在 `#` 专用术语选择器提供形式选择，别名模式为每个别名生成独立候选，包含用户填写的英文别称；`@` 只选择笔记。`researchTermReferenceForms.ts` 统一插入和引用编辑面板的类型标签与顺序，编辑选项同时显示类型和当前文本，未填写字段禁用并保留说明，本次预览复用领域格式化；没有新增组合模式。用户可以多次引用同一条目，分别选择单一名称并手动添加标点，各处的 `display` 和别名 ID 独立保存。正文、分屏、同步引用和选择预览共用同一解析器与样式。首次出现的位置由用户决定，不按渲染顺序自动改变内容。回归入口为 `researchTerms.test.ts`、`researchLibraryFile.test.ts` 与 `e2e/term-reference-formats.spec.ts`。

`ResearchTermDictionary.tsx` 的填写区按“命名与引用”“含义与使用”和“术语组成”分区。`ResearchDictionary.css` 限定术语编辑器的输入、卡片、复选框和底部操作样式；使用 `research-symbol-pane` 容器宽度在 960px 起并排显示前两区，窄面板自动单栏，不依赖整个窗口宽度。适用范围以多行文本编辑，保存数据仍是原字符串；原子卡片保持数组顺序、稳定 ID 和既有校验，底部保存/取消与顶部工具栏共用逻辑。布局验收入口为 `e2e/term-editor-layout.spec.ts`，覆盖面板利用率、草稿在缩窄时保留、移动端长文本、逐条别名、原子编辑及保存刷新。

术语可选 `atoms: ResearchTermAtom[]`。`termEntryError()` 要求原子词汇名称和解释非空，并要求按数组顺序拼接后的名称与术语名称完全相同；这同时保证完整覆盖和片段不重叠。旧资料缺少 `atoms` 时，`researchTermAtoms()` 提供完整术语名称的单个只读兜底片段。`ResearchTermDiagram.tsx` 在中央只渲染一次完整术语并强制单行，术语下方按原子顺序渲染不含文字的下划线入口；解释卡片在下一行按原子顺序横排，不使用左右分栏或多行堆叠。术语详情容器使用中间面板的全部宽度，长名称与卡片行各自提供横向滚动。`ResizeObserver` 和两个滚动区域共同驱动几何测量，SVG 连接线从可见下划线连接到下方卡片顶部，完全离开各自视口的端点不绘线；点击解释入口只滚动卡片行并聚焦对应卡片。悬停中央术语中的原子片段时只改变该片段的颜色，不重复渲染原子名称。`data-term-atom-piece`、`data-term-atom-link`、`data-term-callout` 和 `data-term-connection` 供验收使用。原子解释不再由单个选中状态驱动，也不把拆分结果写入正文引用。

正文中的稳定词典引用由 `ResearchMarkdown.tsx` 渲染为可访问按钮：默认继承正文样式，悬停或键盘聚焦才显示术语点状下划线或符号虚线下划线。术语按钮由 `ResearchTermReference` 管理打开状态，并通过 `createPortal` 渲染 `ResearchTermPopover.tsx`；该组件复用 `useFormulaPopover` 与 `.research-formula-inline-editor` 的定位、Escape、外部点击和焦点恢复逻辑。浮层中的词典按钮才分发 `research-dictionary-open` 事件，由笔记容器切换词典类型和选中条目；符号引用内部的 `ResearchInlineFormula` 禁用行内符号检查，避免嵌套按钮抢走点击事件。

词典引用的基础、悬停和键盘焦点样式直接作用于 `.research-dictionary-term-reference` 与 `.research-dictionary-symbol-reference`，不依赖 `.research-markdown` 祖先。`ResearchMathText` 也用于右侧阅读、同步引用和选择预览的列表，这些位置可能没有 Markdown 外层；收窄样式作用域时必须保留这些路径。`e2e/dictionary-reference-rendering.spec.ts` 将同一列表直接打开时的样式与上述三个入口对比，并覆盖桌面、窄屏、术语解释、Escape 与键盘打开。

`ResearchDictionaryConsistencyPanel.tsx` 调用 `scanResearchDictionaryText()` 检查普通正文。扫描只覆盖可编辑的正文、列表、提示和证据备注，解析时排除代码、链接、数学公式和 URL；用户逐处选择绑定或替换，不能在保存时隐式全文替换。新增正文字段时要明确它的安全扫描和回写方式，并为稳定链接、别名和旧资料 round-trip 补测试。

## 应用设置页

`SettingsPage.tsx` 提供统一的应用内设置视图，URL 使用 `?page=settings&section=general` 等分类。`settingsNavigation.ts` 负责进入、返回和搜索；URL 保留资料库、宿主入口、嵌入参数及正文定位。浏览器历史导航继续固定当前窗口资料库。

设置页与笔记界面共用应用外壳。进入设置时只隐藏笔记界面，保留组件、滚动与草稿；外壳以外的资料操作仍由原有 controller、workspace 和 integration provider 负责。语言、资料库管理、存储和插件内容组件直接嵌入设置页，不创建额外的管理弹窗。

存储、备份、历史共用 `ResearchLibraryStorage.tsx` 的操作会话，切换分类不清空路径草稿或恢复预览。异步任务进行中禁用返回、分类和搜索，刷新或关闭前使用浏览器离开提醒。偏好即时生效，资料库迁移与恢复保留预览确认。版本号在构建时读取 `package.json`。

回归入口：`src/state/settingsNavigation.test.ts`、`e2e/settings.spec.ts`、`e2e/i18n.spec.ts`、`e2e/multiple-libraries.spec.ts` 及媒体备份恢复用例。

### 主软件与导出共用用户字体

“通用 → 界面字体”由 `InterfaceFontSettings.tsx` 提供原生选择框与导入、下载图标按钮。`ResearchNotebookPage.tsx` 按稳定资料库 ID 挂载 `InterfaceFontProvider`，使字体在设置关闭后继续应用；切库重建工作区时取消旧读写与解码，删除旧 FontFace 及根变量。`interfaceFonts.ts` 只将校验过的摘要保存为 `mewiki:library:<编码 ID>:interface-font` 浏览器偏好，不写入笔记、导出模板或服务资料配置；存储不可用时当前会话保留选择。

`InterfaceFontProvider` 只适配工作区，实际行为由显式接收稳定库 ID / 目录的 `LibraryTypographyProvider` 共用。提供器使用 `userFonts.ts` 的 `loadUserFontFace()`，按当前库绑定读取同一原件，校验大小、格式与摘要后直接将二进制交给 FontFace，避免界面加载的 Base64 往返；导出接口继续使用可携带的 data URL。成功后设置 `--mewiki-interface-font-family`、`--mewiki-document-font-family` 与普通字重合成。默认栈首选本地随附的 `Noto Sans SC Variable`，由 `index.css` 引入并与 `documentTheme.ts` 同步；系统字体继续作为备用。明确指定普通字体的组件使用对应变量，不用通配符或 `!important` 覆盖公式、多行代码、PDF 或专用图形。

首次准备时，提供器在 layout effect 中给 `#root` 设置不可交互、辅助技术隐藏及透明状态，不改变布局；注册所选字体、刷新实际文字布局后等待 `document.fonts.ready`，确保本地中文分段也准备好再显示。每次切换也根据当前可见文字、输入值与 placeholder，通过 `document.fonts.load()` 预备默认字库分段，防止自定义字体覆盖全部字形时，切回默认或另一份缺字字体后闪现系统备用字体；用户原件与默认字库并行准备，一方失败不丢弃另一方可用的结果。等待图标通过 body portal 显示，不依赖字体。`withFontLoadingLimit()` 对原件解码和当前页面字库准备分别提供 10 秒上限；内置字库已失败或超时时直接解除屏障，不再对同一请求叠加一次 `document.fonts.ready` 等待。错误保留偏好并回退。后续切换不隐藏页面，加载 effect 保留当前 FontFace，新的结果通过 layout effect 在同一次提交中替换；旧请求取消或迟到不得注册，StrictMode 重设与卸载移除对应 face / 根变量。字体缺失时重新导入同一原件可恢复。回归为 `fontLoading.test.ts`、`userFonts.test.ts`、`e2e/font-loading.spec.ts` 与[实现计划](plans/2026-11-12-font-loading-and-shared-appearance.md)。

`ResearchMediaStore.fonts()` 只查询现有附件目录，不为读取空列表创建 `assets/`；不存在时返回空列表，非目录和符号链接继续拒绝。主软件在工作区挂载时读取字体列表，因此这一步必须保持无写入副作用，不能通过放宽多资料库原件隔离测试掩盖目录创建。

`userFonts.ts` 在成功保存并复查目录绑定后发出同窗口事件和按库的浏览器存储通知。界面与导出订阅资源变化刷新列表，界面选择还通过独立偏好事件同步同库窗口。导出所选字体尚未加载时，匹配的资源通知会重新加载，支持在界面设置恢复缺失原件；已加载资源不因通知重载，避免干扰正在生成的图片。`PublicationPage` 根据冻结会话的稳定库 ID 挂载同一外观提供器，操作界面和原文阅读跟随主软件；不挂载笔记工作区或控制器。模板选择仍独立，停用导出插件不影响主软件字体。原件迁移与完整备份保持原机制，界面偏好不随资料 ZIP 转移。实现计划见[界面字体计划](plans/2026-11-12-interface-user-fonts.md)，操作见[手册](wiki/02-workspace.md#使用自己的界面字体)；回归为 `interfaceFonts.test.ts`、`e2e/interface-fonts.spec.ts` 与既有字体、设置和多库场景。

### 界面与正文的独立字号

`fontSizes.ts` 将两种整数尺寸保存为 `mewiki:library:<编码 ID>:font-sizes` 浏览器偏好：界面 12–20 / 默认 14，正文 12–32 / 默认 15。每次保存先读取最新偏好再更新一个字段，避免同库窗口覆盖另一项；坏字段分别恢复默认，存储失败保留会话值。同库事件、`storage` 和重新聚焦由 `InterfaceFontProvider` 同步，独立 layout effect 应用尺寸并在切库卸载时移除，不依赖自定义字体是否加载成功。

界面根字号使用 `--mewiki-interface-font-size`，普通 UI 固定文字尺寸使用 `calc(var(--mewiki-interface-unit, 1px) * 原尺寸)`；正文使用 `--mewiki-document-font-size` 和共享主题的 `--mewiki-document-unit`。新增 UI 不应重新写死文字字号；布局、44px 顶部工具栏、PDF 内嵌文字和专用图形几何保留固定像素。顶部笔记名称属于界面字号，正文内容标题属于正文字号。手机不再用固定 14px 覆盖用户选择。Callout / 标签页标签预留随文字增长的垂直空间。

行内代码通过 `documentTheme.ts` 的普通正文字体变量显示，多行代码块继续使用等宽字体。参数模板在 `publicationMarkup.ts` 同步此行为，样板段落包含行内代码示例。`PublicationReadingSurface` 显式恢复正文 15px、界面 14px、两个单位 1px，并设置模板的两种字体变量与合成规则，避免页面偏好泄漏到静态捕获；导出仍由模板参数缩放。`PublicationContentSelection` 则继承页面阅读偏好。尺寸不写入笔记格式、宿主协议或导出模板。专项见 `fontSizes.test.ts`、`e2e/font-sizes.spec.ts` 与[实现计划](plans/2026-11-12-interface-font-sizes.md)。

## 搜索与左侧面板

`ResearchNotebookState.view` 和活动条目 ID 继续代表中间实际打开的内容，资料格式保持版本 8。`ResearchNotebook.tsx` 用独立的窗口内 `sidebarNavigation` 记录左侧浏览的工作区；切换标签页不调用资料状态更新。浏览状态与当前内容身份关联，明确打开其他条目后跟随目标工作区，刷新后回到当前内容对应的列表。右侧大纲、反向链接、分屏和正文编辑会话仍取决于实际内容。

左栏有 `symbols`、`terms`、`foundations`、`notes`、`maps` 五个独立浏览入口，顶部只显示图标，通过翻译后的 `aria-label` 和 `title` 保留名称，左右方向键、Home/End 与活动项的 `tabIndex` 提供键盘切换。资料中的 `view` 仍保留原有四种值，符号与术语都使用 `dictionary`，不迁移资料。

使用手册是可选的第六个 `manual` 图标标签页。`ResearchManualSidebar.tsx` 直接使用研究笔记相同的 `ResearchClassifiedList` / `ResearchTagTree` 分类列表，保留紧凑条目、文件图标、分隔线、核对状态及选中背景，并提供独立搜索与滚动。左栏使用 `meWikiManual.ts` 中的章节稳定 ID 映射，按“入门与界面、编辑与组织、词典与知识、媒体与数据、保存与维护、插件与导出”的顺序分组；不显示旧的统一“MeWiki/使用手册”分类。这里只派生候选条目的显示分类，不回写已保存的标题、正文或标签；自定义旧标签仍可搜索。分类名按界面语言显示并加入搜索，未知手册 ID 暂归“其他手册”；新增 Markdown 章节时须登记分类，`meWikiWorkspace.test.ts` 检查所有随附章节恰好归类一次。同一分类内按章节稳定 ID 排序，分类折叠使用手册专用偏好键，不混用研究笔记的折叠状态；不再保留单独的平铺列表分支或手册行样式覆盖。研究记录和基础理论的列表、数量及标签筛选通过稳定 ID 判断排除手册，不根据标题或标签判断。手册仍使用现有笔记及引用协议，不搬迁内容、不升级资料格式。

顶部“使用手册”按钮切换标签页开关，设置页的手册入口始终打开。打开时展开左栏并显示完整章节列表，中间正文保持；缺失章节使用 `ensureMeWikiManual()` 生成临时列表状态，实际点击章节才经原有笔记导航保存缺页、打开正文并关闭本篇地图。打开或关闭标签页本身不回写笔记状态，空资料库也不会因首篇回退而提前显示手册。关闭标签页回到此前浏览的普通列表，保留当前正文、研究记录筛选与手册搜索，并恢复合适的键盘焦点。开关偏好使用 `mewiki:manual-sidebar-open:<稳定资料库 ID>`，首次没有偏好且正在显示手册时打开；切库随工作区重新挂载，不混用偏好。回归入口为 `e2e/manual-sidebar.spec.ts`、`mewiki.spec.ts` 与相邻侧栏、设置和中英文检查。

`ResearchDictionary.tsx` 接收外层控制的 `sidebarKind`，仅在自身记录中间 `detailKind`，符号与术语组件分别接收 `showSidebar`、`showDetail`，只切换图标标签时保留详情 DOM 和词条草稿。新建通过 `onOpenKind` 将外层浏览身份与即将打开的词典内容对齐，避免从笔记新建时退回另一类左栏。地图继续接收 `sidebarActive` 和 `active`；点击条目时必须显式设置相应 `view`。在浏览列表但尚未打开该类型内容时，左侧提供新建入口，空术语列表也能创建首条定义。地图导入输入保留在列表条件渲染之外，确保左侧正在浏览其他类型时中间地图的工具仍可用。

符号、术语的左栏工具条使用单行弹性布局。标签选择保留原生 `select` 和可访问名称，以漏斗图标作为紧凑外观，非空标签使用 `data-active` 着色并在 `title` 展示路径；清除筛选与可用的新建入口同行。窄屏缩小图标间距并隐藏搜索装饰图标，搜索输入保持可收缩，不增加第二行工具条。

`ResearchDictionary.css` 只在词典左栏将名称、别名和说明靠右对齐，名称保留粗体及字体合成。符号条目覆盖公共列表的 40px 公式列限制，使用可换行的弹性布局，数学区域按自然宽度分配、文本保留基本阅读宽度；长公式先占整行，超长公式在预览内横向滚动，不裁切且不撑宽侧栏。公共选择器和正文引用不受这些侧栏样式影响。`e2e/sidebar-interactions.spec.ts` 使用上下角标、分数和超长记号检查桌面与窄侧栏的可见范围。

词典子组件按活动条目 ID 设置 `key`，打开其他条目时重置原条目的临时草稿，只切换标签页时保持身份不变。术语搜索与标签筛选保存在外层，避免详情切换后重置左侧筛选条件。

笔记列表与筛选工具显式接收所浏览的 `ResearchNoteLibrary`，`libraryNotes`、`libraryFilters` 和 `setLibraryFilters` 的可选类型参数默认沿用当前内容的类型。不要用伪造 `state.view` 的整份状态回写筛选，否则会误切换正文。选择笔记使用 `openLibraryNote(..., false)` 保留当前筛选，新建则指定左侧类型并打开新笔记。

原生按钮、链接、输入框、选择框和文本域使用浏览器默认的焦点反馈。`index.css`、`ui-controls.css` 及各组件不再声明彩色焦点 `outline`、`outline-offset`、聚焦边框变色或描边 `box-shadow`，也不通过全局 `outline: none` 隐藏键盘焦点。自定义选择界面的已有背景、文字和标签页标记继续表达状态，不额外叠加选中外框；透明原生标签选择框的可见外层仅以背景和文字提示键盘焦点。React Flow 自定义节点保留单层必要的选择边框和焦点背景，表格编辑单元格使用轻量背景，编辑光标和拖放落点保持原含义。

工具栏按钮使用 `data-ui="icon-action"` 的纯图标样式；弹出功能菜单使用 `data-ui="menu-action"` 的左图标、右文字布局，允许长英文换行且不添加焦点外框。搜索输入继续使用 `data-ui="search-input"`，由 `src/ui-controls.css` 保留原有边框和文字光标；搜索容器不另加 `:focus-within` 强调。正文编辑面的光标、来源定位与路由标题聚焦保持既有语义。

每个左栏列表只由一个容器处理滚动。笔记侧栏直接约束 `.research-classified-list` 的弹性高度；符号侧栏由 `.research-dictionary-list` 提供可收缩的布局，内部分类列表承担滚动。侧栏分类表格不留外围内边距，取消外层圆角和重复边框，并允许在窄栏收缩；引用及弹窗选择器保持各自原有留白。不要再给分类列表内层的 `nav` 设置独立滚动，否则 `overscroll-behavior: contain` 会截断外层滚轮。理论地图侧栏的直接 `nav` 保持独立滚动。

`ResearchTagTreeToolbar` 在当前侧栏搜索工具栏的最右侧提供工具挂载点，通过 `ResearchTagTreeToolbarContext` 与当前分类树共享。导航用的 `ResearchClassifiedList` 通过 `showBulkToggle` 让当前分类树以 portal 渲染“全部折叠分类／全部展开分类”按钮，弹窗选择器不会接管按钮。左栏另传 `keepTagsVisible`：全部或单个分类的开合只控制条目，父、子标签始终显示，前置分类继续竖排，末级分类在条目隐藏时铺满余宽。批量状态按实际可见条目判断，含同时拥有条目和子分类的分支；分类按钮的 `aria-controls` 指向所控制的条目，关闭的父分类不会隐藏子分类标签。原折叠偏好仍为字符串数组，`view:items-only` 标记区分新的逐分类条目状态；首次读取旧的父分类折叠时扩展为后代条目折叠，此后单独展开子分类并刷新不会再次被父分类覆盖。公共选择器仍沿用原来的整分支折叠方式。搜索的临时状态、清空恢复、空结果禁用及理论地图不显示保持原有行为。搜索栏按钮与列表键盘事件隔离，顶部图标标签页结构与键盘语义保持原样。`ResearchNoteListTools` 移除核对数量、篇数及进度条，核对筛选、单篇状态和状态圆点保留。专项回归为 `e2e/sidebar-categories.spec.ts`。

分类树的子列表使用纵向 flex 布局，作为 grid 单元格沿高度拉伸，直接子行在保留内容所需高度的基础上共同分配多余空间。竖排长父标签的最小高度向后代逐级传递，分类按钮背景及边框随行铺满；不要恢复 `align-self: start`，或仅拉伸列表而不分配行高，否则折叠后会在右侧留下白色空条。`[hidden]` 仍显式隐藏折叠条目，不参与空间分配。`e2e/sidebar-categories.spec.ts` 用多字父标签、单链及多行子分类检查展开／折叠时列表与实际子行的上下边缘对齐。

旧折叠偏好的首次转换使用完整分类树。各导航入口通过 `foldingItems` 提供未筛选的原始条目，`ResearchClassifiedList` 构建 `preferenceBranches` 传给分类树；笔记入口包含基础理论和研究记录的所有非手册笔记，以覆盖共用偏好里的另一笔记库分类。不要使用当前搜索结果转换旧偏好，否则清空搜索或切换笔记库后会漏掉子分类。手册使用完整章节候选，符号与术语使用当前资料库全部词条。

底栏左侧 `.research-sidebar-account-slot` 预留账户头像和菜单位置，当前显示禁用的登录占位；接入真实账户控件时替换该按钮并恢复对应菜单行为。资料库切换入口可收缩并截断长名称，设置入口固定在最右端。回归入口为 `e2e/sidebar-interactions.spec.ts`，覆盖五个入口的图标、单行工具条、滚轮、短窗口、键盘导航、搜索焦点和底栏布局。

## 公共分类选择组件

笔记和符号的选择入口共用左侧面板的标签分类表格。新增入口应复用下列组件，避免重新实现平铺列表或原生下拉框。候选始终来自当前资料库状态；各场景先保留自身的资格筛选，再交给公共组件显示。

| 层次 | 文件 | 职责 |
| --- | --- | --- |
| 分类结构 | `src/components/ResearchTagTree.tsx` | 标签路径、分类单元格、折叠偏好、搜索时临时展开 |
| 公共列表 | `src/components/ResearchClassifiedList.tsx` | 笔记与符号条目、单选/多选、选中态、可见条目键盘导航 |
| 弹出选择框 | `src/components/ResearchSelectionField.tsx` | 当前值、搜索、弹窗位置、确认与关闭后的焦点 |
| 数据适配 | `src/components/researchChoices.ts` | 将笔记、符号和术语转换成统一候选，按名称、别名、记号、含义与标签搜索 |
| 公式来源 | `src/components/researchFormulaChoices.ts` | 将来源结果映射到其笔记标签，区分同式不同结果 |
| 共享样式 | `src/components/ResearchSelection.css` | 左栏、浮窗和弹窗相同的条目与表格样式 |

`ResearchClassifiedList` 接收 `choices` 和 `onSelect`。单选传 `selectedId`，多选传 `selectedIds`；导航列表传 `navigation`。`id` 表示业务身份，空字符串也是合法选项值，例如“仅使用词典定义”；没有当前值时不传 `selectedId`。同一对象的多个标签位置共享业务 ID，每个按钮会生成独立的 DOM ID。

标签树由 `ResearchTagTree.tsx` 为每个分类分支标记 `data-tag-orientation`。展开且仍有子分类的前置层级采用竖排窄列，末级或横排标签采用宽列；`ResearchNoteManagement.css` 通过两个容器宽度变量统一调整笔记、基础理论、符号、术语和引用选择窗口中的列宽。修改宽度时要同时检查窄侧栏、深层标签和折叠分支。

分类树可能嵌在 `.research-markdown` 正文编辑器中。正文的 `ul/ol/li` 通用规则不能影响分类网格，因此 `ResearchNoteManagement.css` 要在 `.research-markdown .research-note-tree`、子列表和条目层重新归零 `margin` 与 `padding`；修改选择器样式时必须检查多层 `@`、`#` 和 `$` 浮层没有左侧空白。

需要带搜索框的紧凑入口时使用 `ResearchSelectionField`，提供 `label`、`choices`、`value`、稳定的 `storageKey` 和 `onChange`。`label` 是用户可读名称，`value` 仍使用稳定 ID。不要按标题回查选项。停用选项、循环来源、基础理论范围等资格由调用方约束。

列表外置搜索时，先筛选 `choices`，把同一搜索词传给 `query`，并从完整候选中提供当前选择的 `activeTags`。这样搜索前后的展开状态不会误变。键盘移动、活动项与回车确认共用有效活动行；已经收起或禁用的条目不会被键盘选中。

正文 `@`/`#`/`$` 使用公共列表，但保留正文编辑会话的焦点处理：从正文进入搜索、分类或候选按钮属于同一会话；离开整个会话才提交正文。中文输入候选确认不能自动选中词条。嵌套选择窗的 Escape 由内层处理，保留外层公式草稿。

`findResearchTermMention()` 识别单个 `#`，排除井号后的首个空格、连续井号、转义、代码、数学、链接、URL 与 HTML，保留 Markdown 标题写法。三类触发查询互相作为边界，`ResearchMentionTextarea` 选择光标处最近的有效会话；术语候选为空时仍显示专用标题、搜索与引用形式，不按当前结果推断弹框类型。稳定引用及已有笔记无需迁移。回归入口为 `researchTerms.test.ts`、`e2e/hash-term-picker.spec.ts`、`term-reference-formats.spec.ts` 和 `classified-pickers.spec.ts`。

`findResearchSymbolMention()` 同时接受半角 `$` 和中文全角 `￥`，沿用转义、代码、链接及已有数学公式的排除规则；`￥` 只用于打开符号选择器，不作为 Markdown 数学分隔符。选择词条仍由 `insertResearchSymbolMention()` 生成使用 `$…$` 的稳定引用，取消则保留原文。`ResearchMentionTextarea` 在组合期间暂停判断，最终 `input` 事件立即处理；如果输入法先提交文字再发送 `compositionend`，则在下一帧读取最终文本。新输入、新组合、失焦和卸载会取消待执行的检查，避免旧候选重新打开浮层。回归入口为 `researchSymbolMentions.test.ts` 与 `e2e/classified-pickers.spec.ts`。

## 内容引用

正文与表格单元格使用 `ResearchReferenceEditor.tsx`。ProseMirror 只管理普通 Markdown 文本与有来源的原子引用；`researchReferenceEditor.ts` 通过 remark 的位置识别 `mewiki-term:`、`mewiki-symbol:`、内部笔记和 `webbench-asset:` 链接，代码、数学、图片与未知链接保持原文。节点保存完整原 Markdown、href 和旧标签，显示由当前库上下文解析；未修改引用逐字往返，不升级版本 8。浏览器生成的多段或换行会规范为一段可换行文本，不丢弃后续行。

`ResearchReferencePopover` 只修改当前节点，术语形式、别名 ID 与符号角标沿用现有协议；来源选择复用公共分类窗口。编辑器节点重建时，在布局阶段按当前位置恢复待打开引用的 NodeView DOM，浮层锚点和 portal 宿主继续来自当前节点，避免开发态挂载重演后沿用旧节点而落在主对话框外。`ResearchReferencePresentation` 用安全 KaTeX 输出符号，不向可编辑 DOM 放阅读态导航按钮。编辑会话包含候选、修改面板及嵌套选择器，离开会话才提交；代码块和显式表格源码保留 `ResearchMentionTextarea`。`MentionPicker` 在两种编辑器中共用，触发规则仍由领域检测器维护。

Chromium 在行末不可编辑引用后插入 `img.ProseMirror-separator` 和辅助换行，以保持光标可达；`ResearchReferenceEditor.css` 将该图片辅助元素限定为零尺寸的行内元素，避免 Markdown 正文的块级图片样式增加空行。不要删除或隐藏这些光标辅助节点，也不要把它们写入资料；验收同时覆盖四类行末引用、窄屏高度、单项删除与来源保留。

复制时同时写可读纯文本与带当前资料库 ID 的内部剪贴板格式；同库恢复原 Markdown，跨库只取可读文字，不隐式绑定目标。整项删除、引用替换与粘贴使用独立历史事务。回归入口为 `researchReferenceEditor.test.ts`、`e2e/rendered-reference-editing.spec.ts` 与现有术语、分类选择、笔记引用、媒体和行内符号场景；`e2e/helpers/referenceEditor.ts` 从可见 DOM 读取保存内容，不用隐藏 textarea 模拟兼容。

多个验收批次同时运行时，分别指定构建输出、端口和 Playwright 的 `--output` 目录；测试进程与预览服务传入同一个 `MEWIKI_RESEARCH_SETTINGS`。附件与 PDF 场景按此变量清理自己的隔离设置，未指定时继续使用 `.mewiki/media-e2e-settings.json`，避免上一项测试绑定的临时资料库干扰后续浏览器存储检查。

`noteEmbed` 只保存同库来源笔记和内容块 ID，展示通过 `ResearchReadOnlyContent.tsx` 读取当前状态。插入前要对拟保存的完整内容树校验，避免标签页包含自己。导出附件只展开选中的资源；Markdown 导入为本篇生成新 ID 时，同时重映射本篇内部的内容引用。

`ResearchNoteEmbedPicker.tsx` 将分类来源、搜索和确认放在同一选择会话中，右侧复用 `ResearchReadOnlyContent`。嵌套标签页通过 `renderBlocks` 回调插入内容选择控件，不将其正文转成摘要，也不在可交互内容外套一个大 label。块编号按来源全树固定，切换页签不改变业务 ID；选中整个标签页时子块由容器统一包含。

主窗口的 `.device-record-modal-content` 与 header 样式只使用直接子选择器，避免覆盖内层选择弹窗的留白与高度。引用窗口保留 44px 单行操作栏、四周留白和独立滚动，窄屏改为上下布局。

回归入口：`e2e/classified-pickers.spec.ts`、`e2e/note-embed.spec.ts`、`e2e/formula-editing-experience.spec.ts`、`e2e/research-inline-symbols.spec.ts`。

## 插件与外部程序集成

`src/plugins/sdk/` 提供声明式内容 API v1、图文导出 API v2 的类型与清单解析，以及内容表单和来源规则的统一执行器；`bundled.ts` 从 `plugins/*/manifest.json` 发现随附插件，与本地安装包合入统一注册表。`IntegrationProvider` 管理启停、宿主临时上下文、按内容类型选择和来源打开，`PluginContentPicker` / `PluginContentView` 负责通用表单与视图，`ExternalContentCard` 处理未知版本降级和用户备注。WebBench 已迁入清单，不再使用品牌专属选择器或核心注册分支。

本地服务的 `pluginPackageArchive` / `pluginPackageStore` / `pluginPackagePlugin` 提供 JSON / ZIP 校验、摘要、不可变版本和原子登记；默认包目录为 `.mewiki/plugins/`，指定隔离设置时使用 `<设置文件>.plugins`。独立作者使用 `plugin:validate`、`plugin:pack`，参考 `examples/plugins/measurement/`。插件安装、启停和资料库内容分开保存，失败不撤销旧启停，成功升级或版本切换后重新启用。详见[插件开发入口](plugins/README.md)。

宿主 v1 通信、清单、插件 API、实现版本和各内容类型版本分别管理，不修改宿主 SDK 的权限含义。当前 API 不执行第三方代码；图文导出是数据贡献，其他隔离运行、通用编辑器贡献点和社区目录继续按[插件路线](plans/2026-11-10-plugin-ecosystem.md)推进。

## 社交图文导出

图片与批量模式见[实现计划](plans/2026-11-12-publication-image-batch.md)。`publicationImages.ts` 按已知正文、所有标签页和同库内容引用收集本地图片候选，使用 Markdown AST 排除代码与普通链接，不读取原件或插件私有 JSON。`usePublicationImages.ts` 管理本地 File、选择和逐图取景，支持从工作草稿恢复；`PublicationImageWorkspace.tsx` 提供中间多选、懒缩略图、示例、拖动与键盘取景。选中多图共用模板，一图一张成品，顺序为候选列表顺序。

工作草稿见[实施计划](plans/2026-11-12-publication-workspace-drafts.md)。`publicationDrafts.ts` 使用宿主 IndexedDB `mewiki:publication-drafts`，按库、插件、导出器、笔记与入口模式分区，每个 publication 随机会话独立槽位、每范围最近八份；刷新优先自己的槽位，新页面读取最后编辑的草稿。`PublicationPage` 读完后才初始化工作区，`reconcilePublicationDraft` 剔除新快照已删除的块、页签与替换的图片候选，笔记正文继续只从原快照读取。配置和 Blob 原件在同一事务内写入，原件独立存储，频繁改参数不重复写图片，裁掉槽位时仅回收本范围无草稿引用的原件。

`usePublicationDraft` 合并 250ms 内连续修改，串行写入并继续追上保存期间的新版本，事务完成才标记已保存；失败保留配置并可重试，未完成时 `beforeunload` 提示，页面内关闭先 flush。隐藏页面时主动保存。未完成数值保留、不通过输出校验正规化，生成继续用原严格校验。草稿含图片来源描述、编辑器 items/scope/selectedId、两种工作模式与长图切换参数、作品保存基线；不含成品、DOM、函数、笔记正文或字体原件。命名作品恢复比对 updatedAt，变化时暂停写回；草稿不创建作品、不改个人模板。AI 投影、工具、审阅和 controller 保存均不变，模型不新增草稿读取或导出能力。回归在 `publicationDrafts.test.ts` 与 `e2e/publication-tab.spec.ts`。

`PublicationOptions.imageMode` 为可选宿主配置；没有字段的旧请求和模板不迁移。存在时规范无关正文参数、跳过字体和正文空间检查，纹理范围统一为屏幕背景；每个图片块可含本次 `crop`，不写入模板。`publicationImagePages.ts` 为预览和最终生成共用构造器，复用 `publicationFrames.ts` / `publicationTextures.ts`，不能再复制一套设备外壳或圆角。`publicationImageBatch.ts` 固定参数、取景和顺序，懒读取并按原请求预算串行拆组，合并全批进度，取消 / 失败不启动后续组，成品整批满足数量 / 像素 / 总大小限制后才发布结果。新字段、错误路径、中英文及个人模板往返同步维护；回归入口为同名领域和状态单测、`e2e/publication-images.spec.ts`。使用手册的[批量图片步骤](wiki/20-social-export.md#导出单张或批量图片)是交付验收的一部分。

`plugins/social-export/manifest.json` 使用 API v2 的 `exporters`，与独立示例 `examples/plugins/publication/` 共用 `sdk/exportTypes.ts`、清单解析器和包安装器。v1 继续严格拒绝 v2 字段，v2 不要求纯导出插件伪造内容类型。平台与模板是数据，核心不按官方 ID 或品牌建立分支。

默认“MeWiki 原生”使用 `{ id, name, style: "document" }` 引用宿主正文。`PublicationReadingSurface.tsx` 直接复用 `ResearchReadOnlyContent.tsx` 及网页的内容组件，以整篇大纲生成标题编号，保留笔记引用图标、Callout 外观、标签页和媒体卡片。`ResearchContentLibraryContext.ts` 只提供冻结笔记与资源位置；普通页面继续订阅现有工作区，导出页不创建写入会话。`src/styles/documentTheme.ts` 保存共同基础样式和默认参数，组件 CSS 继续在其原文件维护；不得在导出器复制内容块样式。

共用正文主题为 Markdown 表格包装、表格与正文单元格提供白色实底，普通引用使用浅色实底；数据表的底层在 `ResearchDatasetBlock.css` 维护。`documentTableTheme` / `documentTableHeaderCss` 为普通表格、数据表和参数模板共用深墨蓝表头、明亮文字与浅色链接，正文局部固定可读的深色文字和链接；数据表行号列保留白底。实底引用中的标题与参数模板的强调继承本容器文字；`ResearchExamples.css` 让标签页引用使用自身不透明底色，避免深色标签页出现浅字浅底。Callout、标签页和媒体保留自身背景，普通段落、公式和图片透明区域不强制铺白。`documentCodeTheme` / `documentCodeCss` 统一网页阅读、代码编辑、行内代码及参数模板的终端配色；网页、样板与服务使用同一本地 `github-dark.css` 高亮。参数模板也安全高亮已知语言，未知或未指定语言转义后以普通浅色代码输出。样板包含代码示例；`e2e/document-surfaces.spec.ts` 对照网页样式、真实图片像素和长表格/代码分页完整性。

表格外框、横线与列线共用 `documentTableTheme.border`，与表头同为深墨蓝；数据表 CSS 使用共用注入的 `--mewiki-table-border`。编辑单元格不覆盖实底，表头链接悬停与聚焦保持浅色，表格原位编辑器使用 `caret-color: currentColor`，在表头与正文之间按 Tab 移动仍可辨认输入和光标。不要重新加入按当前文字色生成的半透明编辑背景，它会让深底表头变成白字白底。

内容块默认使用对称水平留白，仅在直接包含 `.research-block-insert` 的编辑块上预留右侧工具空间；块列表没有插入手柄时取消左侧编辑缩进。标签页的特殊左缩进也只用于实际编辑块。规则位于共用 `ResearchNotebook.css` / `ResearchExamples.css`，自动进入网页阅读、样板和原生输出，不在导出器复制相反方向的修补边距。用户设置的媒体对齐和标签位置不变；回归同时检查静态页面左右边距、嵌套缩进与编辑工具仍可使用。

`publicationTheme.ts` 将宿主主题解析为导出参数；切换到原有参数模板会清除 `style`，旧个人模板不隐式迁移。个人模板保存的参数固定，原生内容组件与样式跟随应用更新。输出按 `fontSize / documentTheme.fontSize` 缩放；Vite 构建通过 `collectPublicationStyles()` 自动收集全部 CSS 资源，生成 `mewiki-publication.css`，包括延迟加载内容组件的样式，不维护独立文件清单。修改组件结构或普通 CSS 后重新构建即可纳入；更新服务后还需重启，再从笔记重新打开导出并生成。新增 Canvas、SVG 或特殊控件需同步核对静态捕获与资源边界，并在内容展示页和原生浏览器回归中增加样例。

冻结内容上下文的 `pixelRatio` 向 PDF 预览传递输出倍率，PDF Canvas 继续受 800 万像素内存边界约束；流程图、手绘与数据图表按至少 2 倍、且不低于输出倍率生成静态 PNG。不要将阅读区的低分辨率缓冲区直接放大作为高清导出。

`ResearchNotebook.tsx` 从启用清单生成“更多笔记功能”入口，并在用户打开时固定当前状态、页签及已显示 PDF 的临时页码；页码仅复制到导出快照，不回写笔记。`PublicationDialog.tsx` 提供顶层块选择、参数、预览、下载与个人模板。原生分支经 `publicationDomCapture.ts` 等待内容加载，捕获受限只读 DOM；图片、PDF Canvas、流程图、手绘与图表转静态 PNG，视频优先使用用户封面，音视频保留静态卡片。捕获只保留安全标签、状态和样式，去除事件、链接目标、原始资源 URL、脚本与外部卡片的原始 JSON。`publication.ts` / `publicationSource.ts` 继续用于旧参数模板的简化内容与图片解析，网络图片均要求先本地化。

导出中间有“样式预览 / 选择内容 / 导出结果”三个工作视图。`PublicationSamplePreview.tsx` 默认显示固定虚构样板，随配置延迟更新并取消过期捕获；原生样板复用阅读组件和受限 DOM，参数模板复用领域转换。`src/domain/publicationMarkup.ts` 是样板与正式输出共用的无环境静态 HTML/CSS 生成入口；服务端 `publicationHtml.ts` 继续读取本地字体并对所有图片执行二进制校验。样板 iframe 不允许脚本，CSP 只开放当前本机样式/字体及内联图片，不请求图片任务、不提供下载；它不执行正式分页。长图样板按实际页面内容测量高度，不能用 iframe 视口高度作为内容高度。

`PublicationContentSelection.tsx` 在中间复用完整只读正文，在顶层块旁提供选择与此前分页，沿用整篇大纲编号、冻结资源上下文及本次页签。`staticView` 避免页签偏好写入，`onSelectTab` 透传同步引用；冻结上下文的 `pdfPages` / `onSelectPdfPage` 只记录本次 PDF 页码，捕获使用同一页码。生成期间原文区域 `inert`，参数、勾选及页签/PDF回调锁定；任务捕获固定选项，不挂载写入控制器。左侧默认使用 `publicationCanvas.ts` 的比例与清晰度，精确像素保留在高级设置；清晰度按短边或长图宽度换算，字号和留白同步缩放，画幅切换遵守服务上限。多页切长图再切回恢复此前画幅与文字尺度。模板文件及旧自定义参数格式保持兼容。新增浏览器入口为 `e2e/publication-workspace.spec.ts`。

左栏设置用三个原生 `details/summary` 分区，顺序为“内容 / 画幅 / 样式”，默认展开且互不排斥。分类栏覆盖设置滚动区全宽，使用中性矩形背景、右对齐文字与左侧展开图标，不添加额外焦点外框；设置内容单独留内边距。折叠不卸载控件或触发结果失效；模板切换保持开合状态。内容区包括标题、正文选择入口与数量、封面和作者文字及头像、页码；画幅区负责规格，样式区包括文字配色与封面图片。正文选择入口只切换中间视图并将原文带入可视区域，复用同一份选择状态，不新增第二套正文列表或资料写入路径。

`PublicationTextureSettings.tsx` 在“样式”中提供最多 6 层背景纹理，列表上方在前，可选中、增删和排序，各层独立编辑。`publicationTypes.ts` 严格校验互斥的旧单层 `options.texture` 与新 `options.textureLayers`；`withPublicationTextureLayers()` 在 0/1/多层时分别清除字段、保留旧单层形态、保存数组，旧模板不迁移或补字段。每层自定义素材最多 2 MiB 字符，全部图层素材合计最多 8 MiB 字符，仍受整体请求和模板大小限制。所有图层的图片进入同一个 `images` 集合，服务继续执行二进制图片校验。

`publicationTextures.ts` 提供八种确定性预设、背景 CSS 及受限静态 `<template>`；样板和正式分页从同一模板克隆独立背景元素，按反序 DOM 绘制前层在先的配置。范围为全部、正文、封面或 `margins`；内边距使用 `clip-path: polygon(evenodd, ...)` 裁出中央矩形，环形四边均为当前 `options.margin`，随长图实际高度变化。背景置于正文、页眉页脚之下，不改变正文盒模型。预设 SVG 只能由宿主生成，用户 SVG、外部地址与任意 CSS 不接收。

`publicationTexturePixels.ts` 是有界裁切、积分图去低频光照、灰度/背景同色化与镜像拼接的纯像素处理；`publicationTextureImage.ts` 复用图片来源验证，生成最多 256px 裁切/512px 镜像的三个本地 PNG 候选。上传不直接应用，用户选中后才写入当前层；切层、增删排序、切模板和恢复会卸载编辑草稿，离开或禁用也取消处理，身份校验阻止迟到结果替换新现场。个人模板沿用 v1，保存层序、每层参数/种子及已应用 PNG，不保存原图、候选、路径或正文；插件 API v2 的清单字段不变。回归入口为 `publicationTextures.test.ts`、`publicationTexturePixels.test.ts` 与 `e2e/publication-textures.spec.ts`，包括真实像素检查页边范围、前后层序、长图、PNG/JPEG、模板往返及窄屏键盘操作。

图文导出在独立浏览器标签页中使用完整页面。`publicationNavigation.ts` 在用户点击时同步打开空白页、解除 `opener`，失焦提交后将快照写入新页自己的 `sessionStorage`，再转到仅包含稳定 `library` ID 与随机 `publication` 标识的 URL。`main.tsx` 的该分支只挂载 `PublicationPage.tsx` 和集成提供器，不启动笔记控制器，也不改写原笔记缓存或入口偏好。页面检查库 ID、快照、插件启用状态和版本；刷新保留原快照，源页切笔记或切库不影响该页。临时存储失败或弹出页被拦截时保留原现场并提示重试；关闭/离开触发取消，任务释放请求使用 `keepalive`。回归入口为 `publicationNavigation.test.ts`、`e2e/publication-tab.spec.ts` 与现有导出验收。

导出窗口不显示总标题栏，两栏各自提供 44px 工具栏。左栏用一个原生选择框按系统与个人分组，内部值分别加 `system:` / `personal:` 前缀。`systemPublicationOptions()` 从干净默认值、首个画幅预设及模板声明构建完整参数，个人项复制已保存的 `options`；任意切换和“恢复模板样式”都替换整套参数，恢复目标始终是当前选中项。导出标题、内容选择、手动分页和 `allTabs` 属于本次笔记，不纳入模板。

“模板操作”打开竖向功能菜单，顺序为保存、复制、删除、导出、导入、恢复，每行左图标、右侧直接显示翻译后的功能名称。保存系统项创建个人项，保存个人项更新原项并允许改名；复制和导出使用选中模板的保存值，未保存调整需先保存。系统项不可删除，删除个人项后切到首个系统项。操作浮层复用 `useFormulaPopover` 的定位、外部点击和 Escape，支持方向键与焦点恢复；保存时另显示名称表单。说明放在信息图标 tooltip，支持悬停、聚焦、点击与 Escape。个人操作等待 `collection`，生成或保存期间禁用参数及模板切换。

桌面设置和预览各自滚动，工具栏固定；窄屏将两条工具栏排在顶部，设置和预览依次滚动，模板、生成和关闭始终可达。通用 `WorkspaceModal.css` 使用四边相同的中性 1px 边框，弹窗及阅读分屏不添加顶部蓝色装饰线，图标操作复用 `data-ui="icon-action"`。

`server/publicationPlugin.ts` 管理本机同源任务；`publicationHtml.ts` 从受限 Markdown、KaTeX、PNG/JPEG 或宿主内部 `native` 树生成静态 HTML。`publicationDom.ts` 对原生树执行标签、属性、内联样式、深度和数量校验，`native` 不允许混入参数模板，也不是第三方 HTML API。公式需保留 SVG 的 `preserveAspectRatio` 和方向边框宽度/线型，脚注需保留 `data-footnotes`。`publicationPagination.ts` 测量并分页，保留容器、重复标签与表头、延续有序列表编号；能放进空白页的卡片先整体换页。内部滚动裁切需明确失败，不能仅检查外层宽度。

`publicationRenderer.ts` 使用运行依赖 `playwright-core` 调用本机 Edge；隔离页面不运行应用入口或脚本，网络仅由宿主拦截提供已登记本地字体。中文 Noto Sans SC / Noto Serif SC 和数学字体均随依赖本地提供。原生模板保留网页代码高亮节点，参数模板复用相同深色高亮规则；分页保留高亮节点和代码文本。预览显示生成成品，下载不重新读取笔记。

导出内容诊断由 `publicationDiagnostics.ts` 定义 `horizontal-overflow`、`vertical-overflow`、`page-overflow`，不能通过中文错误文本反推类型。原生捕获与 `buildPublicationDocument()` 在静态项的可选 `sourceId` 中记录顶层原文选择项；静态 `id` 仍唯一，嵌套标签页、引用和展平后的多项共用其所属选择项的来源。`publicationMarkup.ts` 将静态项 ID 转义放入 `data-publication-block`，分页单元和 clone/slice 继承它。完成排版后汇总滚动裁切并按项/方向去重；原子内容、表格行等无法分页时报告当前项。封面、页眉页脚、长图总高度和总量错误不归咎于正文。

Playwright 的异常传输会丢失自定义属性，渲染器必须显式返回并校验诊断，再抛出 `PublicationContentError`；任务继续保留 `error` 并可附 `diagnostics`。客户端只接收本次静态项白名单内的已知代码，丢弃非法/重复项；旧纯字符串错误继续显示。`PublicationDialog` 通过本次冻结文档的 `sourceId` 映射到顶层原文序号，打开选择页、滚动聚焦并显示问题说明。不要按阅读页面的滚动尺寸猜测导出失败，或用字符串前缀猜来源；参数、选择、页签、PDF 页码改变后清除旧诊断。提示不回写笔记。手册见[原文定位](wiki/20-social-export.md#在原文中找到超宽或超高的内容)，回归见 `publicationRenderer.test.ts`、`publicationPlugin.test.ts`、`publicationClient.test.ts`、`publicationTypes.test.ts`、`publication.test.ts` 和 `e2e/native-export-parity.spec.ts`。

`exportProfileStore.ts` 将个人模板按稳定库 ID、插件 ID 摘要隔离并持久保存，修订号防止多窗口覆盖；默认 `.mewiki/export-profiles/`，隔离设置旁为 `<设置文件>.export-profiles`。每组最多 20 份、总计 32 MiB。`exportProfiles.ts` 的单模板 JSON 使用 `mewiki-export-template` v1，头像和封面内联；它是独立配置交换格式，不是插件清单或现有资料库备份格式。卸载保留模板，跨库复用需用户主动导入。

`researchFonts.ts` 校验 TTF / OTF / WOFF / WOFF2 的二进制表边界、100 MiB 上限与 SHA-256，`userFonts.ts` 在写入前用 `FontFace` 解码。字体原件沿用附件 `assets/` 和分片上传，`GET /api/research-library/media/fonts?directory=...` 列出本地库字体；浏览器模式使用 `browserFontStore(libraryId)` 的独立 IndexedDB，名称为 `mewiki:library:<编码 ID>:fonts`。`prepareBrowserMediaMigration` 与完整 ZIP 备份包含未被正文引用的字体，单篇 Markdown 和 JSON 结构快照不包含原件。字体读写每次按稳定库 ID 查询当前目录，不使用导出笔记冻结的资源位置；保存后复查绑定，迁移同时发生时重存到新位置或明确报错。

浏览器字体存储同样使用 `MAX_USER_FONT_BYTES` 的 100 MiB 上限，普通附件继续使用 `BROWSER_MEDIA_BYTES` 的 100 MB 上限；两者均检查浏览器剩余配额。修改字体上限时须同时核对本地附件、浏览器存储、模板交换和完整导出请求，避免只放宽选择文件时的检查。

`options.fontAssetId` 只保存字体摘要。样板、原生捕获和正式请求共用已加载的资源；正式请求可选 `font: { id, name, dataUrl }`，资源必须与摘要相符，仅接受经过校验的内联字体，不接受 URL 或 CSS。行内代码跟随所选正文字体，公式与多行代码块保留专用字体，普通文字允许粗体合成和缺字回退。`PublicationDialog` 在重新导入原件时递增字体加载版本，确保相同摘要也能恢复缺失字体。模板日常保存只存摘要，导出文件 v1 可附所用 `font`，整体 UTF-8 大小最多 140 MiB；导入先存字体再存模板，旧无字体文件保持兼容。插件清单的 `fontFamily` 仍只有 `sans` / `serif`，不新增插件访问用户字体的能力。验收入口为 `researchFonts.test.ts`、`userFonts.test.ts`、附件存储与模板测试及 `e2e/user-fonts.spec.ts`。

图片输出参数、任务及资源限制以 `publicationTypes.ts` 和服务校验为准；`PUBLICATION_MAX_REQUEST_BYTES` 将含内联字体的完整请求限制为 160 MiB，`PUBLICATION_MAX_BODY` 仍将正文内容限制为 32 MiB。常规输出上限为单页 1600 万像素、50 页、总计 8000 万像素、90 秒。取消、关闭导出页和插件换版撤销旧会话并清理浏览器；来源页切库不改变已固定的导出库。超大原子内容和缺失资源明确失败，不以裁切图片冒充成功。

回归入口：`exportManifest.test.ts`、`publication*.test.ts`、`exportProfiles.test.ts`、`exportProfileStore.test.ts` 及 `e2e/social-export.spec.ts`、`publication-tab.spec.ts`、`native-export-parity.spec.ts`。原生回归对照网页计算样式、公式伸缩与线条、完整内容展示页、静态媒体、分页连续性和滚动裁切错误；其他回归验证真实图片尺寸、长图高度、模板备份与冲突。使用隔离配置，不调用正式资料目录。用户操作与限制见[图文导出手册](wiki/20-social-export.md)。HTML、PDF、自由画布及平台账户发布仍未提供。

回归入口：`src/plugins/sdk/manifest.test.ts`、`registry.test.ts`、`webbench.test.ts`、`webbenchReplayCatalog.test.ts`、`server/pluginPackage*.test.ts`、`pluginTools.test.ts`、`src/integrations/` 及 `e2e/plugin-packages.spec.ts`、`plugin-insertion.spec.ts`、`multiple-libraries.spec.ts`、`i18n.spec.ts`。资料格式与备份改动还需对应往返测试。

图文导出的设备边框由 `src/domain/publicationFrames.ts` 提供固定本地几何与受限 CSS/HTML，`options.frame` 可选保存系统 ID、背景、大小、阴影和屏幕内容缩放。旧请求不补字段，“无设备边框”清除字段；长图保留配置但不生成设备层。设备在选定输出尺寸内居中，`publicationContentSize()` 返回屏幕的逻辑文档尺寸，原生捕获、静态排版、样板和正式分页均使用此尺寸。屏幕只做同比缩放，正文按逻辑高度分页；分页测量、标题预留和页眉页脚间距须考虑实际显示倍率，不用缩放后的高度和逻辑高度直接比较。

`publicationMarkup.ts` 生成静态 `publication-device-frame` 模板，样板与 `publicationPagination.ts` 克隆同一外壳，将原有纹理、页眉、正文和页脚放入 `.publication-sheet`；最终截图仍以 `.publication-page` 为单位，输出宽高和像素上限保持原约束。设备不是插件清单贡献，不接受远程素材、任意 SVG/CSS 或用户脚本。个人模板 v1 自然携带参数。回归为 `publicationFrames.test.ts`、参数与模板测试及 `e2e/publication-frames.spec.ts`，操作见[设备边框手册](wiki/20-social-export.md#给宣传图片套上设备边框)。

`publicationPageInsets()` 根据屏幕圆角与横向留白计算页眉、页脚和正文的安全纵向留白，计入页眉头像高度；默认留白不额外变化。参数校验与两种预览共用此结果，极小留白也不能让圆角遮住正文。

设备轮廓使用 CSS `corner-shape: superellipse(1.6)` 连续曲率，当前 Edge 157 已实测支持；较旧浏览器保留同尺寸普通圆角。手机以 420 × 900、44 圆角和四边 12 的内缩量推导屏幕几何，横屏使用同一规格旋转，禁止重新分别猜测机身与屏幕的圆角。`rectCss(rect, unit)` 将外壳、屏幕、边线、听筒及阴影直接换算到输出像素，设备父层不再 `transform: scale()`，避免滤镜合成后再放大边缘；正文依然按 `unit * contentScale` 同比缩放。原有圆弧安全区域是连续超椭圆的保守内接范围，同时保护旧浏览器回退。设备轮廓属于系统资源，旧模板参数不迁移；专项增加横竖屏 720p/1080p/1440p 的四角中心、四边等厚及真实连续曲率像素检查。

### 图文导出错误定位

`publicationValidation.ts` 共用固定的设置路径、数值／文字／资源校验与上下文包装。`publicationTypes.ts` 分别报告尺寸范围、像素总量、正文宽高、颜色、作者信息、资源、纹理层和静态内容顺序；`publicationFrames.ts` 也按具体控件报告设备参数错误，校验限制及模板格式保持兼容。不要恢复一个无参数的通用 `fail()` 来合并这些原因。

`publicationMarkup.ts` 在单次构建内记录图片的来源上下文，按正文顺序去重；公式／Markdown 失败附带静态内容项序号，`publicationHtml.ts` 的实际图片解码失败保留作者头像、封面、纹理层或正文位置。上下文只由系统标签与序号组成，不回显用户路径、原始图片数据或正文。原有任务接口仍用 `error` 字符串传递原因，无新增协议字段。

样板和正式错误在显示边界使用 `localizePublicationError()`，只翻译认可的系统路径、层号、项号及原因模板，不翻译任意未知错误或用户文本。回归包括 `publicationTypes.test.ts`、`publicationError.test.ts`、`publicationPlugin.test.ts`、`publicationRenderer.test.ts` 及 `e2e/publication-workspace.spec.ts`；手册见[错误定位](wiki/20-social-export.md#无法导出时如何定位问题)。

## AI 服务与笔记 Agent

实时协作由现有传输的 `onTool` 参数增量、`drafts.ts` 纯投影与 runner 独立 `onDraft` 回调组成。草稿只在任务内存，不能扩充会直接序列化的 progress/session 或绕过 controller 保存。中央自动跟随、暂停／恢复及任务取消必须共用代次检查；默认渲染差异复用原生只读组件，源码视图作为切换项。新增流式或内容能力时同时检查完整调用的授权、已读目标、参数限制和迟到结果，使用独立设置的受控流 Edge 证明 done 前已呈现、草稿不持久化与确认保存边界。详见[实时协作计划](plans/2026-11-12-ai-live-rendered-review.md)。

维护入口为 [Agent 架构约定](ai/ARCHITECTURE.md)，用户操作见 [AI 工作区手册](wiki/22-ai-workspace.md)。`src/ai/tools.ts` 的单一注册表负责工具 schema、能力发现和执行；`readable.ts` 对已知正文做受限投影，不能使用包含备份 JSON 的序列化器向模型提供资料。`proposals.ts` 复用原生领域操作并验证基线，工作区只在用户点击后通过现有 controller 保存。

同一笔记的旧文字与原生建议经 `proposalGroup.ts` 累积为整篇差异，预览与批准共用原始基线预检和顺序组合；中央顶部一次应用整页，修改附近及右侧均可逐项操作。统一 renderer 只显示一套可切换标签栏，手选保留在预览内，显式选择建议重新定位到具体页与块。无效果项由会话 v1 可选 `mergedIds` 标记，不生成空撤回记录。runner 正常工具交互最多 32 轮、40 次调用／20 项建议，预留一次无工具总结；相同读取缓存、重复改写去重与连续三轮无进展停止均不能省略权限校验。维护和回归见[整篇统一审阅计划](plans/2026-11-12-ai-note-review-unified.md)。

原生工具契约 v3 在 `nativeSchema.ts` 定义字段，`nativeTools.ts` 共用 schema、授权和完整读取检查，`nativeEdits.ts` / `nativeProposals.ts` 负责纯领域转换、基线与副作用。块清单保留容器及标签路径，`read_block` 定位具体子块；笔记正文、块清单和 `{metadata,theory}` 属性文档分别分页，连续读完后才允许整篇操作。中央 `AiNativeProposalReview` 默认用原生块与语义字段显示红删绿增，复杂结构完整到达后展示，字符串更新可通过共享权限校验逐步预览。新增内容类型与动作有穷尽检查，新增字段仍须主动维护投影、schema、领域转换、恢复和审阅。详见[原生操作计划](plans/2026-11-12-ai-native-editing.md)。

AI 工作区使用右侧“AI”标签，与大纲、反向链接和变量配方互斥显示，首次访问后保持挂载；标签切换保留草稿和运行任务。底栏入口同时展开面板，无原生大纲的视图也可使用。收起整个面板沿用取消与中断恢复，桌面打开参考来源保留 AI。布局维护见[右侧面板计划](plans/2026-11-12-ai-right-panel.md)，测试需覆盖正文可操作、标签生命周期、窄屏与来源对照。

对话工作区采用固定底部输入区与独立历史滚动，模型 / 服务设置收在向上展开的 details 菜单，范围选择与发送 / 停止保持在底部。输入法确认不发送；回复期间保留下一条草稿；只在用户跟随最新消息时滚动。布局验收见[对话工作区计划](plans/2026-11-12-ai-chat-workspace.md)，不修改资料或会话版本。

AI 会话标题和操作放在输入框下方，顶部只保留与正文 44px 工具栏对齐的面板标签。回复复用 `ResearchMarkdown`，用户提问保留原始输入；对话内标题、列表、表格与代码样式不能受大纲导航选择器覆盖。验收包含底栏长标题、按钮位置、清空确认、Markdown 结构、公式与长代码滚动，以及窄屏英文。

新增内容类型、修改领域操作或权限时，必须同时判断 Agent 工具和投影是否需要更新，维护范围隔离、取消、建议/撤回测试及手册；工具尚未支持的能力不能由提示词承诺。协议、模型和服务配置独立于笔记与宿主 v1，密钥不进入资料备份或会话。验收使用 `src/ai/`、`server/ai*.test.ts` 以及独立 `playwright.ai.config.ts`，不读取真实资料或调用用户密钥。

## 手册与发布材料

`meWikiWorkspace.ts` 从 `docs/wiki/*.md` 构建首次生成的手册，章节间链接转换成内部笔记链接。已经存在的手册页面保留用户编辑；`ensureMeWikiManual()` 只补缺失页面，不修改当前视图和筛选；`openMeWikiManual()` 保留显式打开目录的领域操作。界面的“使用手册”开关使用前者，将左栏浏览与正文打开分离。不要为更新说明而覆盖真实资料库。

维护安装文档时避免作者专用绝对路径；示例使用通用数据。核心创建入口使用 `meWikiExamples.ts` 与 `createDefaultSymbolEntries()`，应用另外添加手册。领域、状态和界面测试需要更多数学形式时，使用 `src/domain/testUtils/notebook.ts` 的通用测试数据。

资料读取只做结构规范化，不按笔记或符号 ID 推断研究主题，不补齐默认内容，不修改已有正文或数学记号。旧命名槽位按保存的模板转换成三个位置；缺少旧模板的混合历史引用使用只含编码布局的兼容表。当前编码的值、说明、来源与结果 ID 保持原样。不要再引入自动生成研究内容的升级路径。清理边界见[源码清理记录](open-source/SOURCE_CLEANUP.md)，公开前事项见[发布清单](open-source/RELEASE_CHECKLIST.md)。

第三方声明通过 `node scripts/generate-third-party-notices.mjs` 生成，`--check` 检查当前环境与已生成材料一致。工具读取锁文件与本机安装包，不执行依赖脚本、不联网，生成的清单不包含本机绝对路径。跨平台和二进制分发还要单独核对其组件。

## 界面国际化与公开截图

中英文界面复用同一资料模型；翻译只在显示边界进行，不改用户内容、稳定 ID 或协议。新增组件订阅语言、补充消息和参数校验，细节见[翻译约定](i18n/README.md)。

`npm run check` 同时执行翻译校验、代码检查、单测与构建。`npm run docs:screenshots` 用隔离虚构内容更新 README 的 8 张截图；发布前目视核对，不以真实资料充当演示。

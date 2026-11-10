# MeWiki 开发说明

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

## 公共分类选择组件

笔记和符号的选择入口共用左侧面板的标签分类表格。新增入口应复用下列组件，避免重新实现平铺列表或原生下拉框。候选始终来自当前资料库状态；各场景先保留自身的资格筛选，再交给公共组件显示。

| 层次 | 文件 | 职责 |
| --- | --- | --- |
| 分类结构 | `src/components/ResearchTagTree.tsx` | 标签路径、分类单元格、折叠偏好、搜索时临时展开 |
| 公共列表 | `src/components/ResearchClassifiedList.tsx` | 笔记与符号条目、单选/多选、选中态、可见条目键盘导航 |
| 弹出选择框 | `src/components/ResearchSelectionField.tsx` | 当前值、搜索、弹窗位置、确认与关闭后的焦点 |
| 数据适配 | `src/components/researchChoices.ts` | 将笔记/符号转换成统一候选，按名称、记号、含义与标签搜索 |
| 公式来源 | `src/components/researchFormulaChoices.ts` | 将来源结果映射到其笔记标签，区分同式不同结果 |
| 共享样式 | `src/components/ResearchSelection.css` | 左栏、浮窗和弹窗相同的条目与表格样式 |

`ResearchClassifiedList` 接收 `choices` 和 `onSelect`。单选传 `selectedId`，多选传 `selectedIds`；导航列表传 `navigation`。`id` 表示业务身份，空字符串也是合法选项值，例如“仅使用词典定义”；没有当前值时不传 `selectedId`。同一对象的多个标签位置共享业务 ID，每个按钮会生成独立的 DOM ID。

需要带搜索框的紧凑入口时使用 `ResearchSelectionField`，提供 `label`、`choices`、`value`、稳定的 `storageKey` 和 `onChange`。`label` 是用户可读名称，`value` 仍使用稳定 ID。不要按标题回查选项。停用选项、循环来源、基础理论范围等资格由调用方约束。

列表外置搜索时，先筛选 `choices`，把同一搜索词传给 `query`，并从完整候选中提供当前选择的 `activeTags`。这样搜索前后的展开状态不会误变。键盘移动、活动项与回车确认共用有效活动行；已经收起或禁用的条目不会被键盘选中。

正文 `@`/`$` 使用公共列表，但保留正文编辑会话的焦点处理：从正文进入搜索、分类或候选按钮属于同一会话；离开整个会话才提交正文。中文输入候选确认不能触发选择。嵌套选择窗的 Escape 由内层处理，保留外层公式草稿。

## 内容引用

`noteEmbed` 只保存同库来源笔记和内容块 ID，展示通过 `ResearchReadOnlyContent.tsx` 读取当前状态。插入前要对拟保存的完整内容树校验，避免标签页包含自己。导出附件只展开选中的资源；Markdown 导入为本篇生成新 ID 时，同时重映射本篇内部的内容引用。

`ResearchNoteEmbedPicker.tsx` 将分类来源、搜索和确认放在同一选择会话中，右侧复用 `ResearchReadOnlyContent`。嵌套标签页通过 `renderBlocks` 回调插入内容选择控件，不将其正文转成摘要，也不在可交互内容外套一个大 label。块编号按来源全树固定，切换页签不改变业务 ID；选中整个标签页时子块由容器统一包含。

主窗口的 `.device-record-modal-content` 与 header 样式只使用直接子选择器，避免覆盖内层选择弹窗的留白与高度。引用窗口保留 44px 单行操作栏、四周留白和独立滚动，窄屏改为上下布局。

回归入口：`e2e/classified-pickers.spec.ts`、`e2e/note-embed.spec.ts`、`e2e/formula-editing-experience.spec.ts`、`e2e/research-inline-symbols.spec.ts`。

## 手册与发布材料

`meWikiWorkspace.ts` 从 `docs/wiki/*.md` 构建首次生成的手册，章节间链接转换成内部笔记链接。已经存在的手册页面保留用户编辑；“使用手册”操作只补缺失页面。不要为更新说明而覆盖真实资料库。

维护安装文档时避免作者专用绝对路径；示例使用通用数据。核心创建入口使用 `meWikiExamples.ts` 与 `createDefaultSymbolEntries()`，应用另外添加手册。领域、状态和界面测试需要更多数学形式时，使用 `src/domain/testUtils/notebook.ts` 的通用测试数据。

资料读取只做结构规范化，不按笔记或符号 ID 推断研究主题，不补齐默认内容，不修改已有正文或数学记号。旧命名槽位按保存的模板转换成三个位置；缺少旧模板的混合历史引用使用只含编码布局的兼容表。当前编码的值、说明、来源与结果 ID 保持原样。不要再引入自动生成研究内容的升级路径。清理边界见[源码清理记录](open-source/SOURCE_CLEANUP.md)，公开前事项见[发布清单](open-source/RELEASE_CHECKLIST.md)。

第三方声明通过 `node scripts/generate-third-party-notices.mjs` 生成，`--check` 检查当前环境与已生成材料一致。工具读取锁文件与本机安装包，不执行依赖脚本、不联网，生成的清单不包含本机绝对路径。跨平台和二进制分发还要单独核对其组件。

## 界面国际化与公开截图

中英文界面复用同一资料模型；翻译只在显示边界进行，不改用户内容、稳定 ID 或协议。新增组件订阅语言、补充消息和参数校验，细节见[翻译约定](i18n/README.md)。

`npm run check` 同时执行翻译校验、代码检查、单测与构建。`npm run docs:screenshots` 用隔离虚构内容更新 README 的 8 张截图；发布前目视核对，不以真实资料充当演示。

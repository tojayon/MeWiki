# MeWiki AI 接手指南

流程图放大查看（2026-11-13）：`ResearchDiagramBlock` 新增工具栏放大入口，流程图本身也可点击或用 Enter/Space 打开；草图保留画布编辑事件，仅由工具栏打开。复用图片的 `DeviceInspectorModal`，常驻 dialog 使用稳定唯一标题关联，沿原生 close 恢复入口焦点；开窗时阻断 Escape 冒泡，避免 AI 审阅被连带关闭。Mermaid 读取已校准完整边界的 SVG 生成隔离图片，草图复用 `drawingSvg()`，不重复渲染 Mermaid 或改写笔记；内容、模式或库上下文变化丢弃快照。空白、生成中和错误时禁用流程图放大。手册见[第 14 章](wiki/14-diagrams.md#放大查看)与第 21、22 章，方案见[实施计划](plans/2026-11-13-diagram-preview.md)，回归为 `e2e/research-rich-content.spec.ts`、`e2e/ai-workspace.spec.ts` 及完整展示的原生导出。最终验收与正式服务状态见 [VERIFICATION](VERIFICATION.md)，本轮隔离端口 5473、`.mewiki/diagram-preview-*`，只使用虚构资料。

AI 原位置逐项审阅（2026-11-12）：中央修改附近增加同意／拒绝／调整图标，处理一项后继续留在当前笔记与标签，全部处理完才退出。调整仅保存为待审建议，明确同意后才由 controller 写笔记，保留 stable ID、原始 before 和撤回；拒绝用会话 v1 可选 `rejectedIds`，可恢复且按库隔离。`rebaseAiReviewProposals` 只在用户批准／撤回的可信转换后衔接未处理独立项，禁止对已应用项或普通手动编辑重基线。目标删除、重叠改写及过期原文仍冲突。维护在 `reviewDecisions.ts`、`AiInlineSuggestion`、统一渲染器与 `AiWorkspace`；[计划](plans/2026-11-12-ai-inline-decisions.md)、[手册](wiki/22-ai-workspace.md)，验收以 [VERIFICATION](VERIFICATION.md) 本轮记录为准。独立 5471、`.mewiki/ai-inline-*`，仅虚构资料，未修改服务端。

导出设置自动草稿（2026-11-12）：`PublicationPage` 先读宿主 IndexedDB 草稿再初始化编辑区，读取失败只提供重读，不用默认配置覆盖原数据。`publicationDrafts.ts` 按库、插件、exporter、笔记及入口分区，每个随机 publication 独立槽位，最近八份；新页继承最近编辑、原页刷新保持自己的版本，初始化重写不提升编辑排序。图片 Blob 独立存储，不把函数、DOM、字体原件、笔记正文或成品写入草稿。`usePublicationDraft` 250ms 合并、单循环串行追上新版本，事务完成才报成功，未保存时 beforeunload 提示，工具栏关闭先 flush。恢复过滤新快照失效块、页签和图片候选；独立作品原件不参与候选过滤，命名作品内容减少或基线变化暂停写回。模板切换继续完整重置且不自动改个人模板。实施与验收见[计划](plans/2026-11-12-publication-workspace-drafts.md)、[手册](wiki/20-social-export.md#自动保留本次设置)及 [VERIFICATION](VERIFICATION.md)。本轮独立 5467、`.mewiki/publication-drafts-*`，不重启正式服务。

本轮状态：AI 文字／原生建议已统一为整篇笔记累计审阅，同一笔记不逐处翻页；可正常切换标签查看各页差异，中央批准当前整组，右侧逐项定位、批准与逆序撤回。32 轮工具交互与无工具收尾替代旧 12 轮直接报错。最终测试及正式前端状态以 [VERIFICATION](VERIFICATION.md) 的“AI 整篇笔记统一审阅与执行预算”记录为准。上一轮 AI 服务端重启被自动审批拒绝（`blocked by policy`）的历史保留；本轮只改客户端与文档，未再次操作正式进程，也不据静态资源验证推断服务端增量已加载。

AI 整篇统一审阅（2026-11-12）：`proposalGroup.ts` 先对每项原始基线预检，再顺序组合旧文字与原生操作；预览与批准共用转换，整组冲突不部分保存。`AiNativeProposalReview` 共用正常 `ResearchExamples`，单套标签栏、单活动内容区，增删／改名／移动可在原位置审阅。手选仅在组件内，增量及任务结束保留；右侧显式选择用 focusKey 精确定位到标签及块。实际 effects 按项记录，重复无效果项用 v1 可选 `mergedIds` 显示“已合并”，不生成假撤回。runner 保留 40 调用／20 建议限制，增加 32 轮及一次无工具总结，完整参数读取缓存、已校验等价提案去重、连续三轮无进展停止；同批超预算回复不使工具日志突破会话边界。见[实施计划](plans/2026-11-12-ai-note-review-unified.md)、[架构](ai/ARCHITECTURE.md)和[手册](wiki/22-ai-workspace.md)。本轮独立 5459 与 `.mewiki/ai-unified-*`，只用虚构资料。

AI 标签页重复预览第一轮修复（2026-11-12，已由上方整篇方案扩展）：当时仅修复文字建议及等待草稿使用导出 `allTabs` 的问题，未覆盖原生结构建议。原生路径与逐项翻页随后按上方统一方案修复；导出仍保留展开所有页的用途。历史回归在 `src/ai/review.test.ts` 与 `e2e/ai-workspace.spec.ts`，当时独立 5459 与 `.mewiki/ai-tabs-review-*`，记录见 [VERIFICATION](VERIFICATION.md)。

AI 逐轮答复（2026-11-12）：助手显示图标头像和深色 MeWiki 徽标，每轮工具记录在正文前、建议在正文后。会话 v1 的助手消息可选 activity 保存工具和建议 ID，任务开始即创建占位消息，进度同步；旧会话及裁剪后无所属消息的建议留在历史建议区。仅调整对话展示和持久归属，不改工具或批准保存流程。见[设计](plans/2026-11-12-ai-conversation-turns.md)、[手册](wiki/22-ai-workspace.md)，专项 `e2e/ai-conversation.spec.ts`，独立 5465 与 `.mewiki/ai-conversation-*`；最终验收见 [VERIFICATION](VERIFICATION.md)。

Agent 原生操作（2026-11-12）：工具契约 v3 新增精确字段查询、原生块／完整词条／地图读取与 `propose_edit`，涵盖笔记属性、原生块、标签页、符号术语、地图和关系。`examples` 是可定位子块的标签页容器，不能据 `editableText=false` 推断其中内容不可编辑。已有目标先读取，整篇操作须读完正文、块清单和属性的独立分页；插件私有数据及附件原件保持隔离。维护入口是 `nativeSchema.ts`、`nativeTools.ts`、`nativeEdits.ts`、`nativeProposals.ts`、会话 effects 与 `AiNativeProposalReview`；相邻测试包含 `nativeSession.test.ts`。内容类型和动作有编译检查，未来字段仍需主动接入。见[原生操作计划](plans/2026-11-12-ai-native-editing.md)和[架构](ai/ARCHITECTURE.md#能力与提交)。

AI Token 底栏记录（2026-11-12）：统计移入输入框下方图标，`AiUsagePanel` 向上展开最多五行的记录，旧记录内部滚动；短窗口按实际历史区域收缩，不遮挡输入。可选 `usageHistory` 保持会话 v1 兼容，逐任务汇总、多轮工具调用不拆条，最多保留 100 次，按库恢复并随清空重置。维护在 `src/ai/usage.ts` 与 `session.ts`，新增回归 `e2e/ai-usage.spec.ts` 已纳入 AI 专项；本轮独立端口 5463，文件前缀 `.mewiki/ai-usage-`，验收见 [VERIFICATION](VERIFICATION.md)。

AI 实时渲染协作（2026-11-12）：传输的 `tool` 参数增量经 `drafts.ts` 投影为中央暂态草稿，runner 独立 `onDraft` 回调，不进入可持久化的 progress/session。已有笔记必须授权且已读；最终建议仍经注册表，用户按项批准后才走 controller。任务自动跟随，返回编辑／主动导航暂停，右侧眼睛图标恢复；未完成草稿在停止、失败、关闭和切库时清除。审阅默认原生渲染红删绿增，可切源码。维护见[计划](plans/2026-11-12-ai-live-rendered-review.md)、[架构](ai/ARCHITECTURE.md#实时协作与渲染预览)与[手册](wiki/22-ai-workspace.md#审阅应用与撤回)；验收和服务状态见 [VERIFICATION](VERIFICATION.md)。

AI 差异审阅（2026-11-12）：右侧建议“查看修改”在中间笔记区显示 Git 风格红删绿增、行号与行内强调，未改的原生内容保留。预览共用 apply 的基线校验，旧建议可审阅但不能应用；切库、切换活动内容、清空与关闭时退出。工具契约 v2 增加受限 delete-text，删除须先读且用户按项批准，不开放删除笔记。维护见[计划](plans/2026-11-12-ai-change-review.md)、[架构](ai/ARCHITECTURE.md#中间差异审阅)及[手册](wiki/22-ai-workspace.md#审阅应用与撤回)。

差异审阅接续验收（2026-11-12）：`review.test.ts` 覆盖暂态空白文字块的删除标记；持久化会规范化这类空块，不用被规范化后已不存在的块构造浏览器场景。Edge 覆盖窄屏被遮挡控件的 inert、返回按钮和 Escape 的焦点恢复，以及键盘重新打开预览。最终构建与相邻回归使用 `.mewiki/ai-review-continuation-*` 和独立 5455 / 5456 端口；包含真实临时库操作的测试必须让 worker 与服务共用同一个 `MEWIKI_RESEARCH_SETTINGS`。最终结果见 [VERIFICATION](VERIFICATION.md)。

AI 面板样式精简（2026-11-12）：移除重复的顶部“AI 对话”栏和快捷键提示，会话标题与清空 / 设置 / 关闭放在输入框下方。右侧标签栏与正文工具栏统一为 44px。AI 回复复用 `ResearchMarkdown` 显示列表、表格、代码及公式，用户输入保持原文；注意导航列表样式不能污染回复。行为见[手册](wiki/22-ai-workspace.md)，回归在 `e2e/ai-workspace.spec.ts`，本轮使用独立 5453 与 `.mewiki/ai-panel-polish-*`；本轮验收状态以 [VERIFICATION](VERIFICATION.md) 为准。

图片创作面板与相册（2026-11-12）：右侧图层属性已移到与左栏同级的贴边面板，独立滚动；窄屏为可收起抽屉，外部开关始终可达。选择图片使用固定高度单行横向相册，当前项定位只改变相册滚动。统一遵循 [UI 开发规范](UI_GUIDELINES.md) 的 “Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.”，保留错误、必要单位和无障碍名称。维护范围与验收见[计划](plans/2026-11-12-publication-docked-panels.md)、[手册](wiki/20-social-export.md#在画幅内添加文字和贴纸)及 [VERIFICATION](VERIFICATION.md)。

AI 对话布局（2026-11-12）：右侧 AI 改为上方历史、底部固定输入框，模型设置向上展开，资料范围与发送 / 停止留在输入区。Enter / Shift+Enter、中文输入法、运行中草稿及历史跟随行为见[聊天工作区计划](plans/2026-11-12-ai-chat-workspace.md)和[用户手册](wiki/22-ai-workspace.md)；会话格式、服务与工具契约未改。

右侧 AI 面板（2026-11-12）：AI 工作区已移入原大纲 / 反向链接面板的“AI”标签，底栏入口可直接展开。桌面正文继续可交互，切换右侧标签保留任务与草稿；收起整个面板卸载并保存中断记录，重新打开按库恢复。布局与验收范围见[计划](plans/2026-11-12-ai-right-panel.md)，最终结果见 [VERIFICATION](VERIFICATION.md)。

内置 AI 工作区（2026-11-12）：见[实现计划](plans/2026-11-12-ai-workspace.md)、[维护约定](ai/ARCHITECTURE.md)和[用户手册](wiki/22-ai-workspace.md)。用户自配地址、Key、协议和模型，传输与领域工具分层；单一注册表生成能力与执行入口，可读投影排除插件私有数据和附件原件。模型只提出建议，用户点击后校验库 ID/基线，通过 controller 保存；撤回拒绝覆盖后续编辑。会话按库隔离，关闭/切库取消并拒绝迟到工具；Responses 加密推理仅在任务内存续接。新增核心能力时同步检查工具、投影、权限、测试和手册。专项 Edge 用独立 5441 与 `.mewiki/ai-e2e-*`，不碰正式资料。最终验收与服务状态以本轮 [VERIFICATION](VERIFICATION.md) 记录为准。

图片创作画布（2026-11-12）：见[实现计划](plans/2026-11-12-image-composition-editor.md)、[手册](wiki/20-social-export.md#在画幅内添加文字和贴纸)与 [API 约定](plugins/API_V2.md#宿主图片创作画布)。`publicationComposition.ts` 定义受限相对图层及逐图覆盖，左侧 width/height 是唯一画布；`publicationImagePages.ts`/`publicationCompositionLayout.ts` 共用静态预览与 Edge 输出、文字溢出和旋转边界诊断。iframe DOM 同步必须用 nodeType 判断，不能用父窗口的 instanceof Element。`useCompositionEditor.ts` 维护共用/单图属性继承及 50 步撤销，拖动按单事务；字体和 imageData 随批次冻结，保持串行分组与全批序号。`imageWorkspaceStore.ts` 按库/插件隔离作品、贴纸与摘要原件，显式首次保存后自动保存；模板 v2 只含共用层，作品 ZIP 另含原图和字体，严格限定解压流，均不写原笔记。专项 `e2e/publication-composition.spec.ts` 使用 `.mewiki/composition-*` 隔离设置/构建和独立端口；不要重启主聊天服务或覆盖其他并行改动。当前验收状态以 [VERIFICATION](VERIFICATION.md) 的本轮记录为准。

术语逐处显示模式（2026-11-12）：见[实施计划](plans/2026-11-12-term-reference-display.md)和[引用操作手册](wiki/05-symbol-dictionary.md#选择术语引用形式)。用户在正文多次引用同一术语，每处独立选择名称、英文名称、中英文缩写或具体别名／英文别称，自行输入标点组合；不要扩充固定搭配模式。`researchTermReferenceForms.ts` 统一插入和编辑的类型标签，编辑选项显示类型及文字、未填写字段禁用，并展示本次引用预览；沿用现有 `display` 和稳定别名 ID。`ResearchReferenceEditor` 在节点重建的布局阶段恢复待打开引用的当前 DOM，避免开发态旧锚点使浮层无法点击。专项为 `e2e/term-reference-formats.spec.ts`，使用独立 5434 与 `.mewiki/term-display-*` 测试配置。重启正式服务被自动审批拦截，原 PID 44452 保留；静态入口与已验收构建一致，已确认刷新可加载新版引用界面。实际单测、Edge 复查及限制见[验收记录](VERIFICATION.md#术语逐处显示模式2026-11-12)。

图片与批量导出（2026-11-12）：见[实现计划](plans/2026-11-12-publication-image-batch.md)、[使用步骤](wiki/20-social-export.md#导出单张或批量图片)与 [API v2 的宿主图片配置](plugins/API_V2.md#宿主服务与限制)。沿用官方导出工作区，`imageMode` 可选地保存适配方式；主图、选图与逐图 `crop` 现由上方工作草稿保留，不再只留在会话内存中。`publicationImages.ts` 从冻结笔记的已知正文、所有标签页与同库内容引用收集本地候选，不读任意 JSON 或其他笔记资源；`usePublicationImages.ts` / `PublicationImageWorkspace.tsx` 提供本地多选、缩略图和逐图取景。`publicationImagePages.ts` 与最终渲染共用设备 / 纹理构造器，一图一页，不使用正文排版空间；画布图层字体由图片创作流程单独准备。`publicationImageBatch.ts` 保序冻结参数，按原预算懒读取、串行拆组，整批满足 50 张 / 8000 万像素 / 32 MiB 后发布结果，取消或失败不继续后续组。图片模板规范无关正文资源和纹理范围；旧模板不补字段。专项为 `e2e/publication-images.spec.ts`，原轮独立 5426 与 `.mewiki/publication-images-*` 设置、构建及输出；不要占用其他聊天的服务或重启正式服务。

本文是接续开发的固定入口。先确认当前代码与用户要求，再查具体模块；聊天记录、设计稿和历史测试数字都不能代替仓库现状。最近一次文档梳理：2026-11-12。

导出问题内容定位（2026-11-12）：见[实现计划](plans/2026-11-12-publication-content-diagnostics.md)和[原文定位手册](wiki/20-social-export.md#在原文中找到超宽或超高的内容)。`PublicationBlock.sourceId` 可选地记录顶层原文选择项，原生捕获和参数模板快照都填写；不要解析带冒号的静态 ID 猜来源。静态 HTML 的 `data-publication-block` 随分页 clone/slice 保留，实际排版后的滚动裁切汇总横/纵诊断，无法分页报告当前项。`PublicationContentError` 经渲染器显式序列化、任务可选 `diagnostics` 与客户端白名单解析，界面映射回原文序号并自动打开选择页；调整参数或范围清除过期诊断。封面、页眉和总量错误不标正文。原有 `error`、插件协议和模板文件继续兼容。验收入口为相关 publication 单测与 `e2e/native-export-parity.spec.ts`；测试使用独立 5428，不操作真实资料，不自动重启正式服务。

字体首次显示与独立页面（2026-11-12）：见[实现计划](plans/2026-11-12-font-loading-and-shared-appearance.md)与[手册解释](wiki/02-workspace.md#刷新时字体如何加载)。`InterfaceFontProvider` 仅适配工作区，`LibraryTypographyProvider` 按显式库 ID 管理字体与字号；独立 `PublicationPage` 共用它，不挂载笔记控制器。界面从原件直接解码二进制，不走导出的 Base64 路径。首次注册字体并等待实际布局所需的本地字库后显示，后续切换保留旧 face 到新 face 准备好；每次准备有 10 秒期限，取消 / 超时 / 切库不允许迟到结果注册。默认字体为已随项目打包的 Noto Sans SC Variable。导出 UI / 原文阅读跟随偏好，样板和正式捕获显式重置模板字体、合成与 15px / 14px 基准。验收见 `fontLoading.test.ts`、`userFonts.test.ts`、`e2e/font-loading.spec.ts` 与最新验收记录；用户先前选择暂不重启正式服务，勿自动重启。

字号设置与行内代码（2026-11-12）：见[字号计划](plans/2026-11-12-interface-font-sizes.md)和[操作手册](wiki/02-workspace.md#分别调整界面与正文字号)。`fontSizes.ts` 维护按库的浏览器字号偏好；`InterfaceFontProvider` 独立设置两种字号与 CSS 单位，不依赖字体加载；普通 UI 和正文文字各用自己的单位，固定画布和 PDF 不跟随。顶部笔记名称属 UI，正文内容标题属正文。行内代码改用所选正文字体，多行代码仍等宽。导出捕获显式恢复 15px / 1px 基准，模板字号独立；回归 `fontSizes.test.ts` 与 `e2e/font-sizes.spec.ts`。源码及两种存储方式上限为 100 MiB，正式 5280 旧进程启动于 09:42，开发期间已被外部替换为 PID 68852 / 11:46 的新进程；本轮未执行重启。用户此前选择暂不重启，勿用旧服务兼容请求掩盖；已打开的旧页面需刷新加载新前端。

## 建议阅读顺序

1. 根目录 [AGENTS.md](../AGENTS.md)：项目边界、资料保护和验证要求。
2. [开发说明](DEVELOPMENT.md)：源码结构、公共组件与交互约定。
3. [贡献指南](../CONTRIBUTING.md)和[翻译约定](i18n/README.md)：开发命令、测试环境和中英文维护。
4. 插件工作先读[当前插件开发入口](plugins/README.md)，再读[生态设计提案](plugins/ARCHITECTURE.md)和[分阶段路线](plans/2026-11-10-plugin-ecosystem.md)。
5. 按任务阅读 [Wiki 手册](wiki/README.md)、[开放集成协议](integrations/README.md)及相邻测试。

`docs/wiki/` 面向使用者，描述已经能操作的功能；`docs/plugins/` 面向开发者，明确区分现有能力与设计提案；`docs/plans/` 记录阶段安排。阶段路线不等于功能已完成。

## 先确认工作区

在本项目根目录执行：

```sh
git status --short --branch
git diff --stat
git diff --cached --stat
git log -5 --oneline
```

逐项阅读目标文件的暂存和未暂存差异，保留既有修改与暂存关系。不要用整文件恢复、清理目录或重新生成旧版本来处理不熟悉的改动，也不要自动提交。只有需要隔离较大实现时才另建工作区；测试和依赖仍来自 MeWiki 本身。

2026-11-10 核对时，`package.json` 的应用版本为 `0.1.0`，工作区另有统一设置页及相关测试、手册的未提交改动。接手时重新检查状态，不把这些改动当成本轮新写的内容，也不因没有提交就删掉。版本号与当前源码能力应分别核对。

## 从哪里改

| 任务 | 首先阅读 |
| --- | --- |
| 应用装配与资料库切换 | `src/main.tsx`、`src/components/LibraryWorkspaceProvider.tsx`、`src/components/ResearchNotebookPage.tsx` |
| 页面编辑、工具栏、设置入口 | `src/components/ResearchNotebook.tsx`、`SettingsPage.tsx`、`src/state/settingsNavigation.ts` |
| 笔记和内容块模型 | `src/domain/researchNotebook.ts`、`researchBlockTree.ts`、`researchRichContent.ts` |
| 符号、公式、层级标签 | `src/domain/researchDictionary.ts`、`researchTags.ts`、`src/components/ResearchClassifiedList.tsx`、`researchChoices.ts` |
| 内容引用与只读显示 | `src/domain/researchNoteEmbed.ts`、`src/components/ResearchReadOnlyContent.tsx`、`ResearchNoteEmbedPicker.tsx` |
| 保存、冲突与 pending 恢复 | `src/state/useResearchNotebook.ts`、`researchLibrarySession.ts`、`researchLibraryController.ts`、`researchNotebookStorage.ts` |
| 本地目录、历史与格式校验 | `src/state/researchLibraryClient.ts`、`researchLibraryFile.ts`、`server/researchLibraryStore.ts`、`researchLibraryPlugin.ts` |
| 附件、含附件备份与恢复 | `src/state/researchMediaStorage.ts`、`researchMediaArchive.ts`、`server/researchMediaStore.ts`、`researchMediaPlugin.ts` |
| 外部宿主通信 | `public/integration/mewiki-host.js`、同名 `.d.ts`、`src/integrations/sdk.ts`、`IntegrationProvider.tsx` |
| 插件契约、表单与卡片 | `src/plugins/sdk/`、`PluginContentPicker.tsx`、`PluginContentView.tsx`、`src/integrations/ExternalContentCard.tsx` |
| 插件包安装与随附发现 | `server/pluginPackageStore.ts`、`pluginPackageArchive.ts`、`pluginPackagePlugin.ts`、`src/plugins/bundled.ts`、`plugins/webbench/manifest.json` |
| 图文导出与个人模板 | `plugins/social-export/manifest.json`、`src/plugins/sdk/exportTypes.ts`、`src/components/PublicationDialog.tsx`、`src/domain/publication*.ts`、`src/state/publicationSource.ts`、`server/publication*.ts`、`server/exportProfileStore.ts` |
| 默认手册与通用示例 | `src/domain/meWikiWorkspace.ts`、`meWikiManual.ts`、`meWikiExamples.ts`、`src/components/ResearchManualSidebar.tsx`、`docs/wiki/` |
| 本地 API 与构建入口 | `vite.config.ts`、`server/`、`scripts/start-mewiki.mjs` |

同一行省略目录的文件沿用前面的对应目录；修改前用 `rg --files` 确认实际位置。不要假设项目存在 `src/App.tsx` 或独立的公网后端。

## 需要守住的数据流

**保存。** 界面更新当前库状态，经现有 hook、session 和 controller 保存；本地服务校验资料结构、目录归属与修订号，再写盘和记录历史。插件或新面板也应经过这条路径，不额外调用文件写入绕开冲突检测。pending 草稿保留自己的基线，不能把后来读到的新修订号当作覆盖许可。

**多资料库。** 窗口用稳定 `library` ID 固定身份；`workspace` 只表示进入应用的入口。笔记、符号、附件、缓存、pending 和历史按库隔离。旧 `default` 库保留既有配置与缓存键；切库先保存，失败保留原现场，从列表移除只取消登记。URL 参数不是访问权限。

**外部内容。** 外部程序提供临时上下文，插件校验并展示；用户明确插入后才生成当前库的 `external` 内容块。异步选择返回时重新核对当前笔记和插入位置；切库、切笔记、退出编辑或停用插件要取消，迟到结果不得写入新现场。打开来源也由用户点击触发。

**格式与导出。** `webbench-research-library`、既有文件名、旧 `evidence`、v1 宿主协议和稳定 ID 均有兼容用途，不能为了统一品牌直接改名。未知插件和未知内容版本的通用字段及 `data` JSON 继续往返保存；没有插件时仍可读标题、摘要和备注。大型原件走附件服务，不塞入外部内容 JSON。

**手册。** 构建从 `docs/wiki/*.md` 生成首次手册。左栏使用独立、可开关的手册标签页，普通笔记列表、计数和标签筛选排除手册稳定 ID，保留同名或同标签的用户笔记。左栏按 `meWikiManual.ts` 的稳定章节 ID 映射显示六个主题分类，适配旧手册标签但不回写用户资料；增加章节时一并登记分类。打开只切换左栏并临时补全章节列表，实际点击章节才保存缺页并切换正文；空库打开列表也保持空页，关闭不删资料。开关偏好按资料库隔离，已有手册副本保留用户修改。更新说明时改 Markdown 单一来源，不写用户资料库，也不手动编辑构建产物。回归入口为 `e2e/manual-sidebar.spec.ts`。

设备边框（2026-11-12）：见[实现计划](plans/2026-11-12-publication-device-frames.md)与[使用说明](wiki/20-social-export.md#给宣传图片套上设备边框)。`publicationFrames.ts` 共用本地设备几何、屏幕逻辑尺寸和静态外壳；`options.frame` 可选，旧模板不迁移，连续长图保留参数但不套框。屏幕内正文、纹理、页眉页脚仍使用原有排版和正文组件，每页各自套框，输出画布宽高不变。捕获宽度须使用 `publicationContentSize()`，分页测量须统一缩放坐标。勿将边框素材或正文塞入个人模板。专项为 `e2e/publication-frames.spec.ts`，本轮使用独立 5418、`.mewiki/publication-frame-*` 设置、构建和测试输出，避免干扰其他聊天。

设备圆角修整（2026-11-12）：见[连续圆角方案](plans/2026-11-12-publication-continuous-corners.md)。边框和屏幕改用 `corner-shape: superellipse(1.6)`；手机 `phoneFrame()` 从同一个 44 圆角与 12 内缩量生成横竖屏，保证四边一致、圆角对应。所有外壳几何直接乘 `unit`，仅 `.publication-sheet` 缩放正文，不恢复设备整体缩放和独立半径。旧参数、旧模板和长图行为保持兼容。圆弧安全区域继续作为保守保护；回归含三档清晰度的真实四角像素与样板计算样式。

导出错误定位（2026-11-12）：`publicationValidation.ts` 提供固定设置路径和受限数值／文字校验，`publicationTypes.ts`、`publicationFrames.ts` 按字段、纹理层和静态内容项报告原因。`publicationMarkup.ts` 按请求保留图片与公式的来源，服务端图片解码沿用此上下文；不要把这些错误重新合并成通用“参数或内容无效”。界面使用 `localizePublicationError()` 只翻译固定系统路径，不翻译用户文本。请求及个人模板字段未变，回归包含单测和 `publication-workspace.spec.ts` 的样板、真实生成、中英文与服务端坏图场景；见[方案](plans/2026-11-12-publication-validation-diagnostics.md)与[手册](wiki/20-social-export.md#无法导出时如何定位问题)。

## 在隔离环境验证

使用 Node.js 22.13 或更新的受支持版本与本项目依赖。开发界面时同时指定独立配置和独立端口，例如 PowerShell：

```powershell
$env:MEWIKI_RESEARCH_SETTINGS = Join-Path (Get-Location).Path '.mewiki/dev-sandbox-settings.json'
npm run dev -- --port 5281
```

在该隔离配置中只使用通用示例或新建临时目录；换端口只隔离浏览器来源，不能单独保证服务端资料目录隔离。不要查看、连接或修改日常资料库来复现问题。

完成改动后运行：

```sh
npm run check
npm run test:e2e -- e2e/mewiki.spec.ts e2e/plugin-insertion.spec.ts e2e/plugin-packages.spec.ts e2e/multiple-libraries.spec.ts e2e/i18n.spec.ts e2e/settings.spec.ts
```

`check` 包括翻译校验、`npm run lint`、`npm test` 和 `npm run build`。第二行是手册、当前插件和设置页的相关 Edge 检查示例；按改动增加相邻场景，完整回归为 `npm run test:e2e`。不要新写只复述实现的测试。

运行浏览器测试前确认未设置指向日常服务的 `MEWIKI_BASE_URL` 或 `MEWIKI_PLUGIN_DIRECTORY`，5282 空闲。默认 Playwright 启动自己的正式构建预览，使用 `.mewiki/media-e2e-settings.json`，插件包使用该设置文件旁的 `.plugins` 目录；不要同时启动第二批共享这份配置的浏览器测试。不同测试对配置的删除和临时资料设置有依赖，不能随意并发。

常规单测跳过真实大文件往返；涉及原件传输或备份的大改动再按[验收记录](VERIFICATION.md)运行大文件检查。记录本轮实际通过、失败和跳过数，不能复用历史数字宣称当前通过。

## 交付与发布

更新功能时同步使用手册、开发说明、相关接口文档和实际验证记录。设计提案中的状态只有在代码与测试落地后才能改为“已实现”。结束前再次检查差异，说明本轮修改和未完成事项。

正式服务代码变更后重新构建并重启 MeWiki。先确认进程属于本项目、启动参数和配置文件，再重启对应服务；不要按端口盲目结束其他进程，也不要给旧服务追加兼容请求。单纯编写设计文档不需要重启日常服务。

当前源码发布说明见[开源材料](open-source/README.md)和[发布检查清单](open-source/RELEASE_CHECKLIST.md)。2026-11-10 核对时，仓库没有 `publish:check`、`publish:source` 或 `publish:verify` 命令，也没有已入库的专用发布工具。旧聊天里“准备好了”的工具包不能当成已经安装；先查 `package.json` 和实际脚本，不从其他项目目录引用临时工具。提交、推送和创建 Release 按用户本轮及有效上下文中的授权处理。

## 下一阶段入口

主软件用户字体（2026-11-12）：[界面字体计划](plans/2026-11-12-interface-user-fonts.md)已接入“设置 → 通用 → 界面字体”，操作见[手册](wiki/02-workspace.md#使用自己的界面字体)。`InterfaceFontProvider` 随稳定库 ID 重建并管理根级界面/正文变量及 FontFace；复用 `userFonts.ts` 原件，不增加第二套字体存储。选择为按库的浏览器偏好，和导出模板独立；同库窗口同步，缺失字体保留摘要并回退，重导原件会重新加载。不要让导出分支挂载资料库写入控制器，也不要用全局强制字体覆盖公式、多行代码块和专用图形。`subscribeUserFonts` 同步两处资源列表；新专项 `e2e/interface-fonts.spec.ts` 用独立 5420、`.mewiki/interface-fonts-*` 设置、构建与输出，保留导出 5416 的隔离。正式服务继续遵循用户暂不重启的选择。

正文实色底层与终端代码（2026-11-12）：见[计划](plans/2026-11-12-document-content-surfaces.md)及[正文手册](wiki/04-content-blocks.md#表格代码与提示块)。`documentTheme.ts` 为普通表格与引用设置实色，`ResearchDatasetBlock.css` 修复数据表透底；保留 Callout、标签页及媒体已有配色。`documentCodeTheme` / `documentCodeCss` 共用网页、代码编辑和所有导出模板的近黑背景与浅字，三处高亮入口均使用本地 `github-dark.css`；参数模板也高亮已知语言，未知语言安全转义。不要恢复浅色高亮或在导出器复制原生内容规则。专项 `e2e/document-surfaces.spec.ts` 使用 5417、`.mewiki/content-surfaces-*` 隔离设置与构建，覆盖纹理下实色像素、复制、手机编辑和分页全文；不与其他聊天共用测试配置，不操作正式服务。

用户追加表头与边框美化：普通表格、数据表与参数模板使用 `documentTableTheme` / `documentTableHeaderCss` 的深墨蓝实底、明亮文字和浅色链接，外框与全部行列分隔线使用同一深墨蓝，跨页重复表头保持同一配色。正文继续白底，数据表行号列也改为白底；不要只改背景而留下深色粗体或链接。表头进入编辑仍保留实底，表格编辑光标跟随文字颜色，链接悬停保持浅色。用户自定义深色标签页内的引用仍跟随自己的底色与文字。

图文导出背景纹理及多层叠加（2026-11-12）：先读[纹理计划](plans/2026-11-12-publication-textures.md)、[图层与页边范围计划](plans/2026-11-12-publication-texture-layers.md)和[手册](wiki/20-social-export.md#设置笔记背景纹理)。八种预设与图片制纹理收在“样式”，最多 6 层，列表上方在前，每层独立参数和范围；`margins` 只铺四周当前页面留白，中央裁空，跟随长图实际高度。`publicationTextures.ts` 提供确定性背景及静态 `<template>`，样板与正式分页克隆同一背景容器；不要恢复单个伪元素。保留互斥的旧单层 `options.texture` 和新 `textureLayers`，UI 单层保存旧形态，移除全部图层时清除字段；旧模板不迁移。每张素材最多 2 MiB 字符，所有层合计 8 MiB 字符，并全部校验图片二进制。`publicationTexturePixels.ts` / `publicationTextureImage.ts` 提供有界本地处理。个人模板保存层序、种子和已应用图片，草稿及原图不保存，不改插件清单 API v2。`PublicationDialog.tsx` 的 `textureEditorKey` 在切换/恢复模板时卸载草稿，图层编辑器在切层、增删排序时也重建，以取消迟到操作。首轮纹理验收使用 5413、`.mewiki/publication-texture-*`，图层验收使用 5414、`.mewiki/publication-layers-*`；勿和字体、原生布局等其他聊天的设置或测试产物混用。

统一契约和声明式本地安装已落到代码，当前参考为[插件开发入口](plugins/README.md)、[内容 API v1](plugins/API_V1.md)与[图文导出 API v2](plugins/API_V2.md)，实际验收见 [VERIFICATION](VERIFICATION.md)。WebBench 只提供 `plugins/webbench/manifest.json`，与独立测量示例共用同一个解析器、表单和视图；不要恢复已删除的专用选择器或按品牌猜资料库。

作者工具已提供 `plugin:validate` 与 `plugin:pack`。内容示例位于 `examples/plugins/measurement/`，数据导出示例为 `examples/plugins/publication/`。[API v2](plugins/API_V2.md)已提供声明式图文模板，官方“社交图文导出”使用本机 Edge 生成静态图片；其数据分支不依赖可执行 P2。当前仍无通用命令/面板或第三方代码运行能力。[路线 P2](plans/2026-11-10-plugin-ecosystem.md#p2隔离插件运行环境与最小插件-api)继续先完成运行隔离和能力代理，再实现可执行编辑器贡献点与在线社区目录，不直接将下载的 JS 导入主页面。

接续导出先读[用户手册](wiki/20-social-export.md)与[实施计划](plans/2026-11-11-social-export-implementation.md)，核对当前验证记录。个人模板采用含内联图片的 JSON，不是设计稿中的 ZIP 模板包；按库配置存在设置目录，现有资料库备份不会自动携带。不要读正式模板或正文测试。默认测试配置的模板路径为 `.mewiki/media-e2e-settings.json.export-profiles`，需要独立端口与设置才能与其他测试安全隔离。最终验收数字由当轮实际运行填入，不复用旧数字。

图文导出支持用户字体（2026-11-12）：见[字体计划](plans/2026-11-12-user-font-library.md)与[字体操作](wiki/20-social-export.md#导入与重复使用自己的字体)。`researchFonts.ts` 负责四种格式、100 MiB 上限、摘要与二进制校验；`userFonts.ts` 负责按库当前绑定的存取、浏览器解码和原件下载。本地字体在附件区，浏览器字体在按稳定库 ID 隔离的 IndexedDB；迁移与完整附件 ZIP 需包含未被正文引用的字体。日常模板只存 `fontAssetId`，模板交换文件 v1 可携带 `font`，整体最多 140 MiB；带字体的图片导出请求最多 160 MiB，正文内容仍最多 32 MiB。缺失原件重新导入须重新加载，即使摘要不变；旧导出页也必须跟随当前库保存目录读写字体，冻结正文资源仍用原目录。插件清单与外部宿主 v1 权限不变。隔离验收用 5416、`.mewiki/user-fonts-*`，不操作正式服务与资料。

默认“MeWiki 原生”模板的同步方案见[原生模板计划](plans/2026-11-11-native-export-template.md)。原生分支由 `PublicationReadingSurface.tsx` 复用网页只读内容组件，`ResearchContentLibraryContext.ts` 只提供冻结资源上下文，不启动写入控制器。`publicationDomCapture.ts` 捕获受限 DOM 并静态化图片、SVG、Canvas 和视频封面；标题编号、引用图标、Callout、标签页、脚注及媒体卡片直接沿用组件结构。共同基础样式仍在 `documentTheme.ts`，组件样式保留原位置，构建自动聚合全部 CSS 到 `mewiki-publication.css`，不要在导出器复制内容规则。普通组件与 CSS 变化自动纳入构建，特殊渲染介质需补捕获适配与 `native-export-parity.spec.ts` 验收。原生分页延续列表编号，拒绝内部滚动裁切；PDF 临时页码只复制到导出快照。个人参数是快照，已下载图片不会更新；服务更新需重新构建并重启后重新打开导出、生成图片。用户已选择暂缓本轮正式服务重启，交付时必须说明运行核对仍待后续处理。

当前导出界面按[扁平模板方案](plans/2026-11-11-flat-export-templates.md)维护：系统与个人模板共用一个分组选择框，任何切换均恢复完整参数；“恢复模板样式”重载当前选中项。保存系统项创建个人项，保存个人项更新原项；复制与导出使用保存值。两栏独立工具栏替代总标题栏，模板操作收进左图标、右文字的菜单，说明放在信息 tooltip。通用弹窗和阅读分屏已移除顶部蓝色装饰线，后续窗口遵循同一规范。不要恢复双选择框或只覆盖颜色而保留上一模板参数的旧交互。

[交互反馈统一方案](plans/2026-11-11-control-feedback.md)移除了公共和组件层为原生控件额外添加的彩色描边、偏移外框、聚焦边框变色及重复描边阴影，键盘焦点交回浏览器。不要重新添加全局自定义焦点边框，也不要全局隐藏原生焦点；搜索、编辑光标和内容选择保持各自既有语义。模板菜单使用 `menu-action`，顶部工具栏仍使用 `icon-action`。

图文导出已按[新标签页方案](plans/2026-11-11-publication-tab.md)改为独立浏览器页面。入口与临时快照在 `src/state/publicationNavigation.ts`，页面装配在 `PublicationPage.tsx`，完整工作区沿用 `PublicationDialog.tsx`。导出分支不挂载资料库/笔记写入控制器；源页切笔记或切库不终止已经固定身份的导出。URL 无正文，新页使用自己的会话存储并解除 `opener`；刷新保留打开时的内容，最新内容需重新从笔记打开。关闭页签时必须中止生成并释放后台任务，不恢复遮挡原笔记的模态窗口。浏览器验收增加 `e2e/publication-tab.spec.ts`。

导出工作区的[样板与可视选择方案](plans/2026-11-11-publication-workspace.md)新增中间三个视图：默认虚构样板、完整原文勾选和真实图片结果。`PublicationSamplePreview.tsx` 与服务端通过 `publicationMarkup.ts` 共用静态排版，样板无脚本、不占生成任务；服务端保留图片二进制验证。`PublicationContentSelection.tsx` 复用正文，只改变本次顶层选择、分页和页签，不写回原文。`publicationCanvas.ts` 将比例/清晰度转换为原有参数并缩放字号留白，像素字段收在高级设置；旧模板不迁移。继续维护 `e2e/publication-workspace.spec.ts` 的即时更新、无后台任务、原文选择无写入、清晰度与窄屏检查，相关操作同步第 20 章。

通用内容块已按实际编辑工具是否存在分配占位：默认左右 8px，仅编辑块预留右侧按钮列；没有插入手柄的块列表取消左缩进，标签页内部同样处理。网页阅读、样板和导出共享这一修正，避免 Callout 等视觉偏左；不要在静态输出中重新保留 28px/40px 的编辑工具空白。编辑模式仍保留工具空间，媒体自定义对齐和标签位置继续生效。

导出左侧设置按[分类方案](plans/2026-11-11-publication-settings-sections.md)整理为“内容、画幅、样式”三个独立的原生折叠区。全宽矩形分类栏文字靠右；折叠不卸载控件、重置参数或清除导出。标题、封面与作者信息归内容，规格归画幅，字体配色与封面图片归样式。内容选择入口切换到既有中间原文视图并显示已选数量，不在左侧复制正文选择器。继续使用浏览器原生点击、键盘和焦点反馈。

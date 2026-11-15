# MeWiki AI 接手指南

公共发布与在线入口（2026-11-16）：中英文 README 现区分本仓库的开源本地版和 [wiki.mecore.cc](https://wiki.mecore.cc) 官方在线服务，完整范围与迁移见[在线指南](HOSTED.md)。公共代码只发布已完成的 AI 引用／技能及界面改动；独立服务版的身份、在线存储与部署配置不整分支合回这里。后续维护公开文案时同步两种语言、手册第 1／15 章与当前服务能力，不宣称自动同步、公众注册、在线 AI 或端到端加密已实现。实际复验见 [VERIFICATION](VERIFICATION.md)。

编辑选区点击无响应修复（2026-11-14）：`AiSelectionToolbar` 的原文投影将 KaTeX 双重渲染归为一份 TeX，并从编辑器引用原子的 `data-mewiki-reference-label` 恢复原标签，排除已改名引用的显示差异。点击先完成普通 blur 保存，再创建原选区，保留草稿及严格边界；定位失败交给现有笔记错误提示，成功重选清除。第 22 章与 AI 架构同步，`e2e/ai-chat-actions.spec.ts` 覆盖真实拖选、未提交文字、公式／符号／笔记引用、精确范围和失败恢复；实际验收见 [VERIFICATION](VERIFICATION.md)。

AI 按钮弹层视觉与定位（2026-11-14）：`useAiAnchoredPopover` 统一管理八类子面板，在原 DOM 内按真实按钮、聊天与可见视口定位，优先上方 6px，空间不足翻转／内部滚动；输入框不作为避让区。移除各组件按表单上沿计算高度和短窗固定顶部的旧规则，观察浮窗移动、缩放、嵌入及 `@` 查询重建。`AiChatPopovers.css` 用深色操作表面、浅色编辑内容／深色标题，记忆与技能增加聊天内部淡遮罩；关闭仅收起子面板并返回焦点，保留草稿，缩放命中区在遮罩上方。第 22 章、UI 规范、开发与架构同步；入口为[计划](plans/2026-11-14-ai-anchored-popovers.md)、`e2e/ai-popovers.spec.ts` 与相邻聊天测试。只改呈现，不新增 AI 工具、权限或保存路径；实际验收见 [VERIFICATION](VERIFICATION.md)。

AI 统一引用入口（2026-11-14）：旧“当前笔记／当前资料库／当前选区”下拉框与局部 `scope` 状态已移除，`composerContext.ts` 同时生成可见对象与实际笔记授权。默认当前对象可移除；显式 `@` 其他对象后不再暗带当前笔记，移除最后一处引用不补回当前页，刷新和导航保持。当前对象固定与整库检索统一在 `@` 菜单，标签持续用于追问；句内引用仅随本条消息发送。整库状态显示可移除标签，附加选区自动退出整库，选区／本行卡片继续严格限制修改。`AiTaskSupport.scope` 冻结 references／library 模式，旧 v1 可选字段兼容；重试沿用原笔记 ID，编辑旧消息沿用原对象和整库标记，下一问草稿独立。手册第 2／22 章与 UI 规范同步；见[计划](plans/2026-11-14-ai-unified-context.md)、[架构](ai/ARCHITECTURE.md)，隔离 Edge 配置 `playwright.ai-unified-context.config.ts`，实际验收记于 [VERIFICATION](VERIFICATION.md)。

AI 自然语言句内引用（2026-11-14，同下批次）：选择器把 `@名称` 插入原生 textarea 的光标位置，`inlineReferences.ts` 保存 UTF-16 范围与稳定 `{kind,id}`，最多 24 处／12 个不同对象；发送后原句可点击，复制不重复引用。主输入和旧消息编辑逐次捕获 native beforeinput／input（含同值替换），外部改字平移、内部编辑解绑，缺范围的同名歧义保守释放。消息／重试记录保存一致快照并检查 support 包含身份；`pinnedReferences` 单独保留固定来源。损坏草稿保留文字、标失效并阻止发送，用户“清除失效引用”后再选择；该状态与编辑草稿均可刷新恢复。维护与回归入口为 inlineReferences／inlineReferenceFlows、会话测试及 `e2e/ai-product-context-skills.spec.ts`，手册第 2／5／22 章同步；不改工具权限或 controller 保存。

AI 产品称呼、引用与资料库技能（2026-11-14）：当前工具 v7，`productCatalog.ts` 为标准名称／别称／帮助／已接入操作的单一目录，`dictionarySearch.ts` 支持符号／术语分类、相关性及分页，`get_product_help` 不读取笔记或扩大权限。`references.ts` 与 `AiReferencePicker` 用稳定 `{kind,id}` 表达模块／笔记／符号／术语／地图；`@` 与当前对象入口共用，明确笔记引用只授权该篇，模块引用不授权整库，词典／地图不沿用旧笔记目标。`skills.ts`／`AiSkillsPanel` 独立按库保存默认规范、启用／默认技能，关键词／模块只推荐；导入只预填停用草稿，保存后才成为配置，不执行脚本或电脑路径。`taskSupport.ts` 冻结引用和规范／技能正文到原任务，重试／继续复用快照，消息分支使用当前规范且保留原明确引用，contextKey 同步绑定。保存失败保留草稿与原配置，旧会话 v1 可选字段兼容；本对话固定要求仍独立管理。维护见[计划](plans/2026-11-14-ai-product-context-skills.md)、[架构](ai/ARCHITECTURE.md#产品情境对象引用与资料库技能)与第 2／5／22 章，专项入口为 productCatalog／dictionarySearch／references／skills／taskSupport 及相邻聊天测试，实际验收以 [VERIFICATION](VERIFICATION.md) 为准。

GitHub 首页与源码发布（2026-11-14）：用户明确授权更新中英文 README，并一并发布当前新增功能。首页补充“觅维 智能助理”、辅助文件、选区与内容行任务、对话记忆与恢复、原位审阅与撤回，以及正文排版编辑、词典查看、侧栏快捷入口、流程图画布和图文导出。`e2e/showcase.spec.ts` 提供 11 张虚构截图，AI 演示采用预设会话、无密钥的虚构服务并拦截 AI API；`npm run docs:screenshots` 可重现。变更记录、截图维护说明与新增 ProseMirror 依赖的第三方声明同步。当前仍为源码发布，包版本保持 `0.1.0`，未创建版本化 Release 或构建包。实际检查与上传范围见 [VERIFICATION](VERIFICATION.md)；后续不要将 `.mewiki/` 检查配置、日志和临时预览加入 Git。

正文源码按钮归位（2026-11-14）：`ResearchReferenceEditor` 将笔记正文的源码／排版切换图标 portal 到最近的 `.research-note-block`，与删除按钮同列，依次为源码、删除、提示块设置。操作槽位依据直接正文／提示容器定位，不能跟随 live editor 卸载而移动，否则 pointerdown 失焦会使删除 click 落空；不增加正文高度或留白。源码按钮纳入编辑会话，键盘移入保持草稿、移出沿原失焦保存。表格单元格保留自身工具，AI 建议表单的独立编辑器保留原入口；第 4／7／17 章同步，实测见 [VERIFICATION](VERIFICATION.md)。

AI 符号书写（2026-11-14）：工具 v6 的符号查询／完整读取返回 `resolved.tex/bindings/markdown`，原文读取附带最多 12 项／8000 字符相关约定，仍统一计量且不授予词典编辑权限。`symbolNotation.ts` 在建议登记前检查唯一可识别默认实例的新增字体简化（如 `v_{\mathrm T}` → `v_T`），经工具错误让模型纠正；保留合法自定义角标、歧义、代码及未增加的旧错误，稳定引用按实际 bindings 检查。不修改全局渲染、资料格式、用户手动调整或保存流程。维护见[计划](plans/2026-11-14-ai-symbol-notation.md)、[AI 架构](ai/ARCHITECTURE.md)、第 5／22 章；专项 `symbolNotation.test.ts`／`e2e/ai-symbol-notation.spec.ts`，虚构评测新增第 7 项。隔离 5595／`.mewiki/ai-notation-checks/`，实际验收见 [VERIFICATION](VERIFICATION.md)。

普通正文点击上下移动（2026-11-14）：用户补充在点击任意正文进入编辑时仍会移动。`ResearchReferenceEditor` 的行内公式 node view 以 KaTeX 同步绘制与 `ResearchInlineFormula` 一致的初始结构，再由 React 增添符号交互，避免坐标选区前公式为空、行高短暂缩小并触发浏览器滚动锚定。CSS 不再对所有单段落强制零 margin，仅纯文字分支保持零间距，使普通 paragraph 沿用原 1px 上下间距。`e2e/rendered-click-scroll.spec.ts` 覆盖长段落／列表、反复跨块点击、末尾、桌面／窄屏，核对整页所有标记坐标、块高、scrollHeight、滚动和光标；手册第 4／21 章、[排版计划](plans/2026-11-14-rendered-text-editing.md)同步，实测见 [VERIFICATION](VERIFICATION.md)。

底栏快捷卡片（2026-11-14）：`ResearchFooterQuickSettings` 在资料库、语言、插件按钮上方打开非模态 popover，常用切换直接沿 workspace／locale／integration 进行，管理入口仍打开完整设置。`useFormulaPopover` 增加 `side="top"`，原默认与 right 定位保持；同按钮／外部点击／Esc／关闭收起，临时左栏分层 Esc，切库后寻找新 footer 或收起开关恢复焦点。完整设置保留挂载时，语言卡片传独立 radio groupName，避免两份语言控件互相取消选中。卡片按内容／库／侧栏／设置范围清理，失败原位显示，不新增协议或 AI 工具。手册第 2／15／19 章和集成说明同步；专项 `e2e/footer-quick-settings.spec.ts`，隔离 `5591`／`.mewiki/footer-quick-checks/`，最终实测见 [VERIFICATION](VERIFICATION.md)。

词典详情关闭跳动（2026-11-14）：外部 pointerdown 在焦点转移前发生，不能因 `hasFocus()` 为 false 就卸载正在编辑的正文。`useFormulaPopover` 传递取消目标，`ResearchReferenceEditor` 对会话内点击只关闭详情／F2 面板，保留原 DOM、草稿与撤销；点击其他块在下一帧复核实际焦点后沿原链保存，避免打断点击定位。`e2e/dictionary-inspection-scroll.spec.ts` 复现长列表跳动并核对点击坐标和光标，手册第 7／21 章与[词典查看计划](plans/2026-11-14-dictionary-reference-inspection.md)同步，最终实测见 [VERIFICATION](VERIFICATION.md)。

工作区导航简化（2026-11-14）：正文／引用状态栏使用透明背景并移除上边框，更多功能左侧无分组线；左栏移除产品标志，底部账户／资料库／语言／插件／设置／手册均为 28px 图标，手册固定最右且不再进入顶部与窄屏菜单，资料库换数据库图标并保留库名 tooltip。右栏顶部各模式共用 `ResearchSidebarTabs` 图标、title、方向键与 Home／End，收起开关移到最右端，竖栏开关仍第一位。`focusGroup="right"` 在大纲与嵌入 AI 两份 header 间交接标签焦点，AI 激活不得抢走该焦点；聊天实例与任务保持。手册第 1／2／22 章、品牌和 UI 规范同步；专项 `e2e/workspace-chrome.spec.ts` 使用独立 `5587`／`.mewiki/workspace-chrome-checks/`，相邻竖栏与手册检查以新位置为准，最终实测见 [VERIFICATION](VERIFICATION.md)。

笔记标题优先（2026-11-14）：正文顶栏按信息、标签管理、徽标排序；`useResearchNoteTitleLayout` 根据实际字宽预留标题，空间不足先隐藏徽标并以 `inert`／`aria-hidden` 移出导航。观察正文列、操作区和字体变化，保留同一标题 input、原紧凑模式及元数据草稿。维护与回归见[标题布局计划](plans/2026-11-14-note-title-priority.md)及 `e2e/research-responsive-toolbar.spec.ts`；手册第 2／3 章与 UI 规范同步。

符号引用聚焦微移（2026-11-14）：`ResearchReferenceEditor.css` 移除原子引用 `.katex` 的 1.05em 覆盖，共用正文 1.08em，避免多个符号累积缩窄。普通公式原已一致，词典符号引用才触发差异；不可用整体偏移补偿。`e2e/rendered-text-spacing.spec.ts` 逐字核对段落／有序列表、1863／390px、15／20px 正文字号及公式字号、宽高；仅视觉修复，不改变资料与 Agent 保存路径。手册第 4／7／21 章同步，实际验收见 [VERIFICATION](VERIFICATION.md)。

侧栏开关归位（2026-11-14）：左右开关位于各自侧栏顶部首位，收起后位于各自 44px ribbon 第一位，临时浮层不重复显示。正文、词典、地图和 AI 审阅顶部停止传递开关，旧竖直分隔线移除；右开关跨 header／ribbon 后恢复焦点。窄屏 AI 审阅沿用正文列，只隔离原正文，保留侧栏和聊天入口。手册第 2／22 章与架构同步；专项、工具栏、国际化和 AI 嵌入测试以新位置为准，见[竖栏计划](plans/2026-11-14-workspace-ribbons.md)。

所见即所得正文（2026-11-14）：`researchRichText.ts` 扩展现有 ProseMirror 编辑器，标题、加粗、斜体、删除线、行内代码、列表和引用在编辑时保留排版，`ResearchTextBlock` 和表格按点击坐标定位光标。文本变更优先原文局部补丁，结构变化使用可靠 Markdown 序列化并保留稳定引用；分隔符冲突必须通过结构／文字等价检查回退。不能每次输入重解析替换 live 文档，否则空段落／列表项和 IME 会丢失。词典引用点击仍查看详情，F2 修改本次引用且保留 marks。术语用可自然换行的 `span[role=button]`，三个状态断行一致，Enter／Space 与焦点恢复保留；见 `e2e/term-reference-wrapping.spec.ts`。表格重定位更新编辑器根，避免把 padding 写入 mount。源码有主动切换入口。AI 选区排除自动标题编号，仍先失焦保存、再用原文范围校验；无新增 AI 工具或资料迁移。计划见[正文排版编辑](plans/2026-11-14-rendered-text-editing.md)，最终结果见 [VERIFICATION](VERIFICATION.md)。

双侧竖栏与全局入口（2026-11-14）：`ResearchSidebarTabs` 共用横向／纵向键盘导航，左右收起各留 44px，`ResearchNotebook` 的临时浮层复用现有列表和右面板，不改变正文宽度、不持久化临时打开状态。一次一侧，选择、外部点击、Esc、设置／库／正文切换时关闭；搜索与分类开合保留。AI 保持原实例。语言与插件移到左底栏，插件紧邻设置，资料库只保留底栏入口，中间工具栏无底线。见[计划](plans/2026-11-14-workspace-ribbons.md)、[第 2 章](wiki/02-workspace.md)；专项 `e2e/workspace-ribbons.spec.ts` 使用独立 5581／`.mewiki/workspace-ribbon-checks/`，不操作其他服务。最终结果见 [VERIFICATION](VERIFICATION.md)。

AI 记忆、检索与恢复（2026-11-14）：完整聊天不再裁成 20 条，按对话保留最多 2000 条／4 Mi 字符，UI 每批展示 40 条；模型使用同范围有效问答的有界摘录、固定要求与近期正文。工具 v5 支持检索分页、总数、相关性及命中块路径。失败类型与 Retry-After 经服务端、NDJSON 和会话传递，倒计时结束仍须明确重试；流式请求采用 90 秒空闲与 10 分钟总时限。结构化执行记录可收起并跳原文。固定虚构任务以 npm run ai:evaluate 离线验证，不请求真实模型。维护见[实施计划](plans/2026-11-14-ai-memory-search-recovery.md)、[第 22 章](wiki/22-ai-workspace.md)和[架构](ai/ARCHITECTURE.md)，隔离 5575／.mewiki/ai-memory-checks，实际验收见 [VERIFICATION](VERIFICATION.md)。

编辑模式查看词典引用（2026-11-14）：`ResearchTextBlock` 与 `ResearchTableBlock` 的捕获点击对有效词典按钮放行，不再先激活段落／单元格编辑器。术语沿用解释浮层，稳定符号由 `ResearchSymbolReference` 复用 `FormulaSymbolPopover`，保留实例角标、来源公式、Esc 与焦点恢复；点面板词典入口才导航。普通正文点击仍可编辑，编辑会话内点击术语／符号也查看详情，F2 修改当前引用。资料格式、Agent 工具和保存路径不变。手册第 5／7 章与开发说明同步，计划见[词典引用查看](plans/2026-11-14-dictionary-reference-inspection.md)，专项 `e2e/dictionary-reference-inspection.spec.ts` 及既有引用／术语／行内符号回归；使用隔离 `5573`／`.mewiki/dictionary-inspection-*`，最终验收见 [VERIFICATION](VERIFICATION.md)。

AI 建议反复应用／撤回（2026-11-14）：会话 v1 的 `appliedIds` 表示历史批准，当前批准统一由 `isAiProposalApplied()` 检查有效 change／merge。“已撤回”项恢复查看、再次应用、调整与拒绝；再次批准仍可撤回且不重复计数。撤回将该项基线回到最近一次应用前，覆盖组内重叠改写；保存、冲突和稳定 ID 保护继续沿原流程。维护入口为[第 22 章](wiki/22-ai-workspace.md)、[架构](ai/ARCHITECTURE.md)，专项 `e2e/ai-redo.spec.ts` 已纳入常用 AI 配置；本轮用隔离 `5568`／`.mewiki/ai-redo-checks/`，不请求真实 AI，最终实测见 [VERIFICATION](VERIFICATION.md)。

AI 范围与底栏布局（2026-11-14）：资料范围经 `AiMaterials.scopeControl` 移到“添加文件”左侧，保留选区锁定与原请求语义。底栏改为输入框外顶部居中的单个扁把手，两态复用同一 DOM 按钮，自然保留焦点；收起导航仍不影响草稿／任务，只留下 14px 把手区。见[计划](plans/2026-11-14-ai-context-controls.md)、第 22 章与 UI 规范；本轮隔离 `5567`／`.mewiki/ai-context-controls-checks/`，维护浮窗、嵌入、材料和会话的 Edge 几何及短窗检查。

AI 协作可靠性（2026-11-14）：用户同意精确选区、独立手改保留与部分任务接续，见[实施计划](plans/2026-11-14-ai-collaboration-reliability.md)。`selectionRanges.ts` 将渲染文字映射到 UTF-16 源码范围，DOM 前文区分重复词；完整工具、流式草稿与恢复校验共用边界，旧 v1 引用仅在唯一定位时补算。`kind: 'block'` 仍为既有整行授权。`editDependencies.ts` 按字段、section 和容器路径判断独立修改；公式 tex／parts 互相依赖，逐项批准后的 `rebaseAiReviewProposals` 也复用该校验，不能把目标移动或公式隐式依赖误判成独立变化。冲突显示原文／当前内容／AI 建议，仍禁止覆盖。

runner 达到预算或连续三轮无进展返回 `partial`，不再以步数上限丢弃任务语义；v1 可选 checkpoint 只保存有界的成功读取参数、建议 ID 和公开摘要。点击“继续剩余任务”重验原服务、范围、选区、材料与资料基线，再经原执行器重放只读工具恢复读取权限，不存权限标志、工具输出或私有推理。继续追加 assistant、保留下一问草稿与旧建议归属，每段分别计量；刷新不自动请求，原文或服务改变需新问。维护入口为第 22 章、架构，专项 `selectionRanges.test.ts`、`collaboration.test.ts`、`continuation.test.ts` 与 `e2e/ai-reliability.spec.ts`；固定构建隔离 `5566`／`.mewiki/ai-reliability-checks/`，保留其他验收端口，最终结果见 [VERIFICATION](VERIFICATION.md)。

AI 审阅绿色区直接编辑与左右对比（2026-11-14）：`AiReviewPair` 普通对照改用 grid，红绿之间放逐项操作，标签名 inline 对照仍 contents；点击绿色侧在原位编辑，保留后仍待同意，保存与撤回沿用原流程。`renderComparison` 统一块、标签页、容器属性、词典和新建笔记，操作锚定首个实际变化字段，移动源不重复按钮。`ai-review-layout:v1` 按库记住上下／左右，切换保持输入、停止回放；编辑时禁用源码与目标切换。见[计划](plans/2026-11-14-ai-direct-review.md)、第 22 章和架构，专项 `e2e/ai-direct-review.spec.ts`，隔离 `5565`／`.mewiki/ai-direct-review-checks/`。本轮未改 Agent 工具与 controller。旧条目“普通 pair 始终 contents”是历史实现，最新验收见 [VERIFICATION](VERIFICATION.md)。

AI 聊天头像裂图（2026-11-14）：实测正式 `/brand/mewiki-ai-mascot.svg?v=...` 返回 HTTP 200 的 HTML，标准 dist 缺少该头像，独立构建原件正常。`AiMascot` 改为从同一 public SVG `?raw` 导入并模块级编码 data URL，随界面发布，保留原件与外观；不增加网络／资料权限。新增 `e2e/ai-brand-assets.spec.ts` 故障注入，覆盖入口、标题、欢迎、回复、刷新、选区和 AI 设置，检查真实 naturalWidth／naturalHeight 而非 200。见[计划](plans/2026-11-14-ai-mascot-bundled-assets.md)、品牌说明、第 22 章与架构；红阶段 `5561`、绿及最终隔离 `5563`／`.mewiki/ai-brand-assets-*`，最终实测见 [VERIFICATION](VERIFICATION.md)。

内容行菜单发送到 AI（2026-11-14）：编辑模式每行前置菜单增加“发送到 AI”，把本行附加到既有聊天并保留草稿，不自动请求。`createAiBlockSelection()` 绑定最新 controller 快照的稳定根块／基线，v1 引用可选 `kind: 'block'`；公式和标签子块复用原生工具与逐项审阅，跨行、结构和分区调整不开放。手册第 4／22 章、架构与[计划](plans/2026-11-14-ai-block-menu.md)同步。单测 `blockSelection.test.ts`，专项 `playwright.ai-block-menu.config.ts` 使用隔离 `5561`／`.mewiki/ai-block-menu-*`；不触碰主聊天的 `5559` 验收服务。最终实际结果见 [VERIFICATION](VERIFICATION.md)。

AI 浮窗零边距（2026-11-14）：按用户反馈移除面板四边 8px 限制及气泡侧 70px 避让，直接使用 `aiFloatingBounds()` 的可见窗口交集。拖动、八边缩放、键盘、旧 v1 偏好恢复均可贴边或拉满窗口；气泡沿原 z-index 34 位于浮窗 30 上方，保留点击／拖动。删除只为避让存在的 launcherEdge 父子状态，气泡换边不挤动面板，胶囊自身留白及选区避让不变。见[计划](plans/2026-11-14-ai-floating-panel-flush-edges.md)、第 2／22 章、UI 规范与架构；专项 `aiFloatingPanelLayout.test.ts`、`e2e/ai-floating-panel.spec.ts`，隔离 `5559`／`.mewiki/ai-flush-*`。只用虚构资料及受控回复，最终实测见 [VERIFICATION](VERIFICATION.md)。下文预留 70px 的条目保留历史。

红绿对照中的激光与填字（2026-11-13）：按用户修正恢复上下两段及首帧红／绿段落标记，`AiReviewPair` 始终 contents，不再叠层或调整尺寸。扫描前旧字正常，扫描后用独立 Highlight 保留红字／红底与删除线；下段等待区域不提前显示绿底，炮弹命中才同时显现绿底和文字。三类 Highlight 随停止／退出清理，流式分组、长文和批准保存流程沿用；下段长文中段起播不倒跳到屏外原文。见[计划](plans/2026-11-13-ai-cannon-diff-fill.md)、第 22 章与架构，隔离 `5557`／`.mewiki/ai-cannon-diff-fill/`，最终结果见 [VERIFICATION](VERIFICATION.md)。下文共享排版位置、原文隐藏为旧版记录。

原文、激光删除与大炮新增（2026-11-13）：`AiReviewPair` 提供默认不改变审阅布局的旧／新两侧，播放暂存完整原文，先按完整 grapheme 激光删除，再由炮弹命中显现新增。实时按组串行、同组流式合并并登记新拆分的删除节点；长删除分屏定位，后半篇起播保留新侧锚点。取消清理局部属性、尺寸变量、Highlight、WAAPI 和 rAF，原审阅／批准／保存不变。见[计划](plans/2026-11-13-ai-cannon-laser.md)、第 22 章和架构；隔离 `5555`／`.mewiki/ai-cannon-laser/`，最终结果见 [VERIFICATION](VERIFICATION.md)。下文“命中时旧字隐去”为旧实现记录。

文字大炮完整覆盖与就地回放（2026-11-13）：移除全文前 8 发截断。`cannonReplayTargets()` 按 DOM 顺序从当前可见改动开始，无可见改动时取下方最近处，全文末尾取上方最近处；跨屏长范围仅在确有可见部分时二分到当前行，完全在上方的回退目标从 0 开始。`replayTargetsRef` 统一首帧和素材加载后的暂存，`holdMany()` 批量绘制；generator 逐目标构建有界片段，覆盖所有后续改动、不绕回前文。无模型、建议、保存或持久偏好变化；停止仍立即完整恢复。见[计划](plans/2026-11-13-ai-cannon-replay-coverage.md)、第 22 章与架构，隔离 `5553`／`.mewiki/ai-cannon-coverage/`。下文前 8 发限制为旧实现记录，最终验收见 [VERIFICATION](VERIFICATION.md)。

文字大炮命中呈现（2026-11-13）：新增 `aiCannonTextReveal.ts`，仅用 CSS Highlight 隐藏未命中的新增文字，飞行完成后按原文范围显现，替换旧字此时隐去；流式更新保留已到达前缀。回放重置呈现，分段定位，最后一发显现长文余部；任何中断、失败和结束均恢复完整差异。父级自动滚动通过 `followScrollRef` 区分，避免误清呈现；素材失败不能重新隐藏后续文字。实测本机 Windows 动画关闭，Edge／Helium 在原生媒体偏好下均返回 reduce；自动跟随仍尊重系统，明确回放临时启用完整运动。无模型、会话或笔记写入变化。见[计划](plans/2026-11-13-ai-cannon-arrival.md)、第 22 章与架构，隔离 `5551`／`.mewiki/ai-cannon-visibility/`，截图像素和逐帧位移回归；最终结果见 [VERIFICATION](VERIFICATION.md)。下文回放仅静态提示的描述为旧版记录。

文字大炮手动回放（2026-11-13）：完整有效的笔记渲染预览顶部新增回转箭头，输出结束或重新打开待审建议后可分段重演；同一按钮停止，结束可重播，Escape 先停止。`AiProposalReview.replayProposal` 仅局部持有当前建议身份，`AiTextCannon.setReplay()` 从渲染差异构建有界 grapheme 队列；不录制原流、不请求模型、不写笔记或会话。只读可看，减少动态仅静态落点；回放内定位与用户滚动区分，用户滚动／尺寸／页面隐藏／偏好变化，以及模式、页签、目标和建议变化清理。见[回放计划](plans/2026-11-13-ai-cannon-replay.md)、第 22 章与架构；新增 2 项分段单测和 3 项 Edge 回放场景。独立 `5549`／`.mewiki/ai-cannon-replay/`，最终验收见 [VERIFICATION](VERIFICATION.md)。下条“仅运行时”描述为首版记录。

AI 修改文字大炮（2026-11-13）：`AiTextCannon` 作为中央笔记预览的独立装饰层，仅运行且自动跟随时显示，底部居中、底座固定、炮身转向与后坐；实际修改片段合并发射，落点短暂高亮。复用本地分层 SVG，不制作方向帧，不触及建议、权限和保存。不可见目标不发射，滚动清轨迹，窄屏自适应，减少动态只保留静态大炮和落点透明度提示。维护见[计划](plans/2026-11-13-ai-text-cannon.md)、第 22 章和架构；专项为几何／Unicode 单测及 `e2e/ai-text-cannon.spec.ts`。使用隔离 `5547`／`.mewiki/ai-text-cannon/`、虚构笔记与受控流，不操作真实资料或正式进程；最终实测见 [VERIFICATION](VERIFICATION.md)。

基础理论 AI 对等修正（2026-11-13）：用户定位到条件／结论区域，Edge 复现 list／callout 正文被旧选区类型限制排除；普通段落及标签页原本可用。`textSelection.ts` 从当前块类型推导 text／items，工具与流式草稿共用字段边界，禁止改变 section、提示标题／样式或其他块。两处 AI 来源／预览引用导航由硬编码 notes 改为 `openLibraryNote(..., false)`，保留真实 foundation／research 归属和筛选。读写、预览、批准、刷新撤回与非文字块的当前笔记范围沿用共用实现，未改会话 v1 或工具 v4。见[计划](plans/2026-11-13-ai-foundation-parity.md)、第 2／22 章与架构；新增 `foundationParity.test.ts` 和已纳入常用 AI 配置的 `e2e/ai-foundations.spec.ts`。独立 `5541`／`.mewiki/ai-foundations-*`，仅虚构资料与受控回复，最终结果见 [VERIFICATION](VERIFICATION.md)。

AI 辅助文件警示气泡（2026-11-13）：超限、格式／解析及添加失败从 `AiMaterials` 的排版段落改为 `AiMaterialNotice`。按最新反馈改为聊天标题栏下方的面板内覆盖层，浅橙底、深色文字、22px 警示图标，关闭按钮在右上角；不再使用全窗口 popover。浮窗／嵌入面板的既有 transform 限定 fixed 包含块，拖动／缩放自动跟随，不撑高聊天、不抢焦点；批量错误合并，八秒关闭，悬停／聚焦暂停，手动关闭可回到添加按钮。切换对话、隐藏聊天或卸载清理，持久保存问题继续原状态提示。见[计划](plans/2026-11-13-ai-material-warning-bubbles.md)、第 22 章和架构；原版隔离 `5537`／`.mewiki/ai-material-warning-*`，面板内修正隔离 `5539`／`.mewiki/ai-material-notice-panel-*`，只用虚构文件，最终结果见 [VERIFICATION](VERIFICATION.md)。

AI 可选嵌入右侧栏（2026-11-13）：聊天标题栏增加嵌入／浮窗图标，单个 `AiFloatingPanel`／`AiWorkspace` 切换呈现并保留任务、草稿和材料；嵌入与大纲等工具共用标签和既有分割线，收起右栏不停止任务，气泡可恢复。模式及原大纲开关按库保存为 `ai-panel-placement:v1`，旧浮窗几何独立保留；窄屏沿用右侧抽屉，中央审阅覆盖时 inert 隔离。见[计划](plans/2026-11-13-ai-right-panel.md)、第 2／22 章及架构，专项 `e2e/ai-docking.spec.ts`；独立 `5535`／`.mewiki/ai-docking-*` 验收，不操作正式进程或真实资料。下文仅浮窗描述保留为阶段记录。

AI 选区与来源布局（2026-11-13）：输入区引用改为灰底两行，笔记名／选区各单行省略并悬停全文，请求和会话仍保留原文；来源行移到标题栏正下方，范围 select 含禁用态统一为“当前选区”的灰底样式。修复 pointercancel 后拖选状态未复位、Escape 后清空并重选同文仍被 dismissed 抑制的两条入口失效路径，保留基线与批准保存。见[计划](plans/2026-11-13-ai-context-panel.md)、第 2／22 章及架构；隔离 `5533`、`.mewiki/ai-context-*`，虚构资料与受控回复，最终实测见 [VERIFICATION](VERIFICATION.md)。

产品中文名（2026-11-13）：用户确定“觅维”，中文聊天面板名“觅维 智能助理”，释义“寻觅知识，以多维链接万物”。英文保留 MeWiki／MeWiki AI Assistant。聊天标题、助手署名、工作区品牌、设置／关于及浏览器元信息按语言显示；安装名称为“觅维 MeWiki”。品牌含义见[名称说明](BRANDING.md#中文名称与释义)，维护见[本轮计划](plans/2026-11-13-chinese-product-name.md)。不改资料协议、ID、仓库／缓存命名或已有用户手册副本；下方旧称仅为历史阶段记录。

AI 辅助文本格式扩展（2026-11-13）：JSON／JSONC／JSONL、TeX／BibTeX／样式、YAML／XML／TOML、配置／日志、常见代码和文字文档统一按 `text` 材料解析。`materials.ts` 共用扩展名登记生成文件选择过滤与解析类型，旧材料 kind、摘要及 v1／工具 v4 兼容；保留原文、注释、缩进及语法错误，不执行 HTML／SVG／代码、不编译 TeX 或跟随文件引用。见[计划](plans/2026-11-13-ai-material-text-formats.md)与[手册](wiki/22-ai-workspace.md#添加辅助文件)，验收独立 `5527`／`.mewiki/ai-material-text-*`，最终实测见 [VERIFICATION](VERIFICATION.md)。

AI 留白修正（2026-11-13）：胶囊可见半侧加长到 62×56px，完整背景 124×56px，40px 头像按实际轮廓四边约 11px 留白；浮窗入口空间改为 70px，v1 偏好兼容。折叠时整个 footer 使用 hidden 并移除相邻材料容器的底部间距，展开箭头移入现有 composer 按钮行，点击后交接焦点，不留空白条、不折整窗。见[原计划的后续修正](plans/2026-11-13-ai-footer-capsule.md)、第 2／22 章和[验收](VERIFICATION.md)。独立 `5529`、`.mewiki/ai-spacing-*`；下方条目保留阶段记录。

AI 对话辅助文件（2026-11-13）：输入区可选择／拖入 TXT、Markdown、PDF、DOCX、CSV、TSV、XLSX，本地解析、分段预览、取消、移除；模型通过工具 v4 的 `list_materials/search_materials/read_material` 按需读取。`materials.ts` 冻结库和内容摘要，`materialImport.ts`／`materialPdf.ts` 管理有界解析及取消。v1 可选快照与材料 ID 按库／对话保存，活动最多 6 份、单份 100000 字符、会话 12 份／200000 字符；20 MB 输入，表格另限 10 MB，PDF 200 页。重试／消息编辑分支沿原 user 的材料，移除不删除历史引用；无文件保持旧 contextKey 兼容，仍经中央审阅与 controller 保存。见[计划](plans/2026-11-13-ai-materials.md)、[架构](ai/ARCHITECTURE.md#对话辅助文件)与[手册](wiki/22-ai-workspace.md#添加辅助文件)。测试独立 `5525`／`.mewiki/ai-materials-*`，虚构文件及受控模型，不读取真实资料；仅客户端改动，不操作正式服务进程，最终结果见 [VERIFICATION](VERIFICATION.md)。

AI 底栏与半露胶囊（2026-11-13）：本轮纠正上一轮整窗最小化；删除最小化状态、几何分支及 `AiFloatingPanelControls`。底栏箭头仅折叠自身，`ai-footer-collapsed:v1` 按库记忆，关闭附属菜单，输入和任务不隐藏。气泡改为 toggle，设置页先返回打开，关闭继续停止／保存；标题去重复关闭按钮，28px 栏按语言居中，中文“MeWiki 智能助力”。62×56px 可见命中区贴视口边，伪元素绘制 124×56px 白色阴影胶囊，半露背景、40px 头像完整；v1 edge／ratio 偏好兼容。用户背景限定到气泡，不给外部操作行加白底；仅 AI 聊天／消息编辑输入去粗黑焦点框。见[计划](plans/2026-11-13-ai-footer-capsule.md)、第 2／22 章和架构；隔离 `5519`、`.mewiki/ai-footer-*`，最终实测见 [VERIFICATION](VERIFICATION.md)。以下整窗收起条目保留历史实现记录，以本条为准。

AI 吉祥物（2026-11-13）：`AiMascot` 共用本地 `public/brand/mewiki-ai-mascot.svg`，已接入边缘入口、浮窗标题、欢迎、助手回复、正文选区与 AI 设置导航。按用户最新反馈，头部改为圆心 `(640, 640)`、半径 `450` 的标准 `circle`，耳机宽高约增大四分之一，移除嘴巴。保持黑白蓝三色实心图形，去掉金属环、光泽线、亮点、渐变和入口投影，耳机仅两层椭圆。头部先合成后整体圆形蒙版，M 的蓝白层共用笔画裁切，避免细缝、灰边与漏色；保留父控件的名称、44px 点击目标与原交互。高清 SVG 及透明 PNG 见[品牌资源](BRANDING.md#ai-吉祥物)，操作见第 22 章，[设计记录](plans/2026-11-13-ai-mascot.md)。不修改 AI 数据、权限、工具和保存协议，保留并行改动，不操作正式服务；最终实测见 [VERIFICATION](VERIFICATION.md)。

AI 紧凑浮窗与消息编辑（2026-11-13）：当前标题栏为 28px（收起含边框 30px），删除六点移动和右下角缩放图标，四边及四角无图标命中区支持指针／键盘缩放并固定对边；内容预留滚动条空间。底栏通过 `AiFloatingPanelControls` 收起，紧凑栏／气泡展开，不卸载任务。用户消息外右下方提供复制／编辑；编辑先停止生成，v1 可选 `messageEdit` 独立保存草稿，Ctrl／Cmd+Enter 重发、Escape 取消。`forkAiChatBeforeMessage()` 从原位置分支，先归档再发请求，保存失败保留现场；旧后续从历史查看，笔记不自动回滚。原选区重校验、底部普通草稿、权限与保存锁、迟到拦截保持。延迟焦点恢复优先编辑框。维护见[计划](plans/2026-11-13-ai-compact-window-message-edit.md)、第 2／22 章、[架构](ai/ARCHITECTURE.md#聊天面板的生命周期)及几何／聊天动作／浮窗测试；最终实测见 [VERIFICATION](VERIFICATION.md)。独立 `5515`、`.mewiki/ai-compact-*`，保留其他改动，不自动提交或操作正式进程。下列条目保留此前阶段记录。

AI 浮窗视觉与常驻入口（2026-11-13）：`AiFloatingLauncher` 替代底栏 AI 图标，44px 圆形气泡可拖贴左右边、方向键移动，按库保存 edge／高度比例，关闭／收起／折叠侧栏和设置页仍可见。设置返回先走现有导航，`SettingsPage.onBusyChange` 同步 busy 禁用入口，切库／删除确认同样禁用。聊天淡蓝灰底与深蓝 44px 标题栏，均匀细边框、短阴影；面板为气泡边留 56px，避免盖住输入。两组件 rAF 直接绘制 transform，松手才提交 React／偏好，compact 菜单使用局部坐标。原选区、任务与审阅规则保留。维护见[实施计划](plans/2026-11-13-ai-floating-launcher.md)、第 2／22 章和[架构](ai/ARCHITECTURE.md#聊天面板的生命周期)；专项为几何与浮窗 Edge、设置 busy，最终结果以 [VERIFICATION](VERIFICATION.md) 为准。隔离 `5511` 和 `.mewiki/ai-launcher-*`，不自动提交或操作正式进程。

AI 悬浮聊天（2026-11-13）：依据用户要求，`AiFloatingPanel` 替代右侧 AI 标签，聊天与大纲／反向链接／变量配方独立。标题栏拖动、角部调整大小及方向键／Shift 操作，外部点击和 Escape 不关闭聊天；收起仅隐藏内容、任务继续，明确关闭才卸载中断。位置／尺寸按稳定库独立记住，`aiFloatingPanelLayout.ts` 统一选区避让和 dialog／visualViewport 可达范围；选区入口只额外传临时矩形与 activation，不进入会话或笔记。保留原 `ai-panel-open` 偏好与现有保存／审阅。现行布局见[悬浮计划](plans/2026-11-13-ai-floating-panel.md)、第 2／22 章及[架构](ai/ARCHITECTURE.md#聊天面板的生命周期)；专项为几何单测与 `e2e/ai-floating-panel.spec.ts`，最终结果以 [VERIFICATION](VERIFICATION.md) 为准。独立 5507、`.mewiki/ai-floating-*`，保留并行改动，不自动提交。

界面精简与统一（2026-11-13）：共用 `--mewiki-ui-*` 与 `ui-surfaces.css`，只覆盖工作区外壳，保留正文、图表角色、AI 审阅与导出成品配色。设置、资料库、插件和词典按分区与行对齐，常规教程从 `UiInfo` 按需查看；导出数量只保留左侧内容区，样板／选择／纹理／设备各有信息入口。重要错误、发送范围、密钥行为和测试费用继续可见。规范见 [UI 开发规范](UI_GUIDELINES.md)，本轮计划见[界面统一](plans/2026-11-13-ui-clarity.md)，回归为 `e2e/ui-clarity.spec.ts` 与设置、词典、地图、AI、导出相邻场景；隔离 `5501/5502` 与 `.mewiki/ui-clarity-*`，最终结果以 [VERIFICATION](VERIFICATION.md) 为准。本侧聊不操作主聊天服务进程或真实资料。

AI 聊天操作（2026-11-13）：本轮增加消息／对话复制、最近失败任务的手动重试、服务重读、快捷提问与正文选区入口。用户优先选择快捷提问、选中文字后修改；选区固定到实际来源并在普通编辑器保存后建基线，渲染与编辑态均支持，Alt+Enter 或附近 AI 图标附加，发送仍先生成待审建议。`chatActions.ts` 管理原服务／范围／基线与重试历史，`textSelection.ts` 共用来源与流式／终态范围校验，`AiSelectionToolbar` 处理 DOM 选区；父级消费一次请求，不能重开面板后复活旧引用。重试保留下一条草稿和部分结果，相同基线建议复用，原文／词典／地图变化要求重发。操作、限制与测试入口见[第 22 章](wiki/22-ai-workspace.md)、[架构](ai/ARCHITECTURE.md)和[计划](plans/2026-11-13-ai-chat-actions.md)，最终实测见 [VERIFICATION](VERIFICATION.md)。保留共享工作区其他改动，不在此轮自动提交。

AI 聊天卡片与多会话（2026-11-13）：修改预览为默认收起的原生 details，展开后单行标题和图标操作，已应用绿色、已撤回红色且保留状态文字。底部标题前增加 `AiConversationPanel`，新建／打开旧对话分别保留草稿、审阅、撤回和用量；切换先归档再替换原 v1 活动槽，成功才取消旧任务并清除中央暂态预览，写失败保留现场。`conversations.ts` 与 `restoreAiSession` 共用校验，旧会话兼容、按库隔离、50 段及 4 Mi 字符上限，清空只处理当前对话。历史、用量、模型弹层互斥，模型仅两行字段和范围，短窗口按真实可用高度滚动。见[实施计划](plans/2026-11-13-ai-chat-polish.md)、[手册](wiki/22-ai-workspace.md)与[架构](ai/ARCHITECTURE.md#聊天面板的生命周期)。专项为 `conversations.test.ts`、`session.test.ts` 和 `e2e/ai-chat-panels.spec.ts`；既有动作测试需先展开卡片。隔离 5475、`.mewiki/ai-chat-polish-*`，最终验收及正式状态见 [VERIFICATION](VERIFICATION.md)。

AI 引用与精细对比（2026-11-13）：`AiWorkspace` 给历史及流式 Markdown 提供当前库引用上下文，通过 notebook 的既有阅读入口打开稳定 ID，实际缺失仍禁用，不按标题猜测，不改变模型资料范围。`diff.ts` 对连续替换区整体比较 grapheme，以有界 Myers 补充 LCS，保留长段落中分散的小修改及换行。`RenderedTextDiff`、`researchMarkdownChanges.ts` 把 UTF-16 范围投影到 Markdown AST，只突出改动文字；引用／公式／代码作为完整节点，列表／表格／引用块等结构用原节点属性标记，段落拆分合并有结构兜底。文字、原生建议与可显示字符串字段共用此视图，原逐项批准／调整／撤回不变。设计见[本轮计划](plans/2026-11-13-ai-citations-and-precise-diff.md)，操作见第 22 章，回归在 `diff.test.ts`、`review.test.ts` 与 `e2e/ai-workspace.spec.ts`；最终验收以 [VERIFICATION](VERIFICATION.md) 本轮记录为准。

流程图矢量画布（2026-11-13）：`ResearchDiagramBlock` 保留工具栏、点击与 Enter/Space 入口，草图仅由工具栏打开。`ResearchDiagramViewer` 替换初版随窗口宽度适配的图片，支持围绕指针滚轮缩放、鼠标拖动、单指平移／双指缩放、100%、全图与键盘；手动查看后调整窗口保持中心，重新打开重置全图。`researchDiagramViewport.ts` 集中几何计算。仍复用常驻 `DeviceInspectorModal`，原生关闭恢复入口焦点，开窗时阻断 Escape 冒泡，避免 AI 审阅被连带关闭。Mermaid 读取已校准完整边界的 SVG，草图复用 `drawingSvg()`；以 SVG 原始尺寸显示矢量，不重复渲染、不栅格化、不改笔记或导出。内容、模式或库上下文变化丢弃快照，空白、生成中和错误时禁用入口。手册见[第 14 章](wiki/14-diagrams.md#放大查看)与第 21、22 章，当前方案见[画布计划](plans/2026-11-13-diagram-canvas.md)，初版见[放大预览计划](plans/2026-11-13-diagram-preview.md)。回归为几何单测、`e2e/research-rich-content.spec.ts`、`e2e/ai-workspace.spec.ts` 及完整展示的原生导出；最终验收与正式状态见 [VERIFICATION](VERIFICATION.md)。本轮隔离端口 5493、`.mewiki/diagram-canvas-*`，只使用虚构资料。

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

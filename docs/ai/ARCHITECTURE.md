# MeWiki Agent 维护约定

## 请求与配置持久化适配

`createAiClient` 接受独立请求适配器；适配器必须在请求生命周期内完成响应读取，包括流式工具和最终结果，不能拿到响应头就释放取消范围。`AiWorkspace` 和 `AiServiceSettings` 可注入同一客户端，默认继续使用本机 `/api/mewiki/ai`。任务 runner、投影、工具、审阅与 controller 保存流程共用，不复制聊天实现。

`AiProviderStore` 支持可选持久化适配器的 `read`／原子 `update`；凭据保护由独立 protector 提供。适配器须在同一原子范围内读取、执行变换并保存，不能绕过 revision 冲突、变更地址后的密钥确认及凭据不回传规则。默认文件存储和系统凭据保护保持兼容。

## 产品情境、对象引用与资料库技能

统一引用入口见[计划](../plans/2026-11-14-ai-unified-context.md)。`composerContext.ts` 是主输入可见引用与笔记授权的共同解析入口，移除旧 `scope` React 状态和 `AiMaterials.scopeControl`。草稿可选 `referenceMode: auto|explicit` 与 `libraryScope` 按库、按对话保存；默认当前对象可移除，显式引用或移除后不再自动补回当前页面。`@` 菜单同时提供当前对象固定、句内对象搜索与独立“整库检索”，普通 module 仍不授权笔记。固定标签和整库状态保留用于追问，句内引用仅随本条正文发送；选区附加时退出整库，冲突笔记引用必须移除，选区／本行卡片保留严格边界。

`AiTaskSupport.scope` 是可选 `references|library` 快照，统一入口发送时由实际引用重新生成授权 ID，不合并旧隐含当前笔记；整库排除手册，仅显式引用的手册可单独加入。原 v1 无 scope 的调用和恢复继续兼容。`contextKey` 包含整库标记以隔离范围；重试／继续使用冻结的原笔记 ID，不因导航或新笔记而扩大。消息保存 `libraryScope`，编辑分支沿用原对象及整库状态，底部下一问的引用与草稿独立保留。新字段恢复采用白名单，坏范围快照不能重试，移除默认引用的明确模式可跨刷新保存。未选择笔记仍可使用帮助和词典，不以自然语言提及同名对象作为授权。

当前工具契约 **v7**，实现见[计划](../plans/2026-11-14-ai-product-context-skills.md)，操作与 Markdown 示例见[第 22 章](../wiki/22-ai-workspace.md#资料库规范与技能)。`productCatalog.ts` 是模块标准名称、别称、入口和已接入操作的单一目录，`AiProductHelp`、引用选择器、`get_capabilities`／`get_product_help` 与系统提示共用。帮助工具只返回产品信息并计入读取预算；`mewiki-module:` 链接经过固定模块白名单，仅用户点击时导航，不把模型输出当路由指令。`dictionarySearch.ts` 保留 `terms`／`symbols` 数组，增加 `kind: all|symbol|term`、分页、各类 total／nextOffset 以及名称、别名、完整默认写法相关性；搜索不等于完整读取，不增加修改权限。

`references.ts` 用 `{kind,id}` 固定模块、笔记、符号、术语与地图，最多 12 个不同对象；显示名称按当前资料解析，任务消息另记发送时名称。`aiCurrentReference()` 依据实际当前页面取对象，词典／地图不借用旧 activeNoteId。`AiReferencePicker` 的 `@` 与按钮入口共用搜索、键盘和 IME 保护，选中后在原生 textarea 的光标处插入可读 `@名称`，直接成为自然语言句子的一部分。当前对象固定与旧独立引用标签继续兼容，导航不会暗换目标。只有显式笔记引用进入本次授权 ID 并集，模块引用不授权整库；选区／本行任务仍只允许来源笔记，不得以引用绕过边界。失效对象阻止发送或重试，不按同名内容回退。当前对象快捷提问仅填草稿，工具仍须先读后改。

`inlineReferences.ts` 用 UTF-16 `[start,end)`、完整显示文字和稳定对象保存每处句内引用，最多 24 处／12 个不同对象，正文最多 12000 字符。恢复只接收排序后无重叠、范围与原文逐字一致的白名单副本。主输入与旧消息编辑均捕获原生 `beforeinput` 的实际选区及 `inputType`，验证为同一次编辑后才按范围平移／解除绑定；原生同值替换也通过 `input` 解除被覆盖关联，不依赖 React 是否触发 `onChange`。缺少真实范围且重复文字存在多种解释时保守解除歧义范围，不猜测同名对象。旧消息编辑逐次保存自己的引用草稿，避免把多次无关改动合成覆盖引用的一次替换；原消息与原分支保持不动。损坏草稿保留文字并以 `inlineReferencesInvalid` 阻止发送，用户明确清除失效关联后才恢复；清除状态可刷新保存。

任务消息和 `lastRequest.inlineReferences` 保存相同范围快照，恢复／重试校验二者一致，且每处身份必须包含于 `support.references`；runner 同样验证，不能单靠可读名称获得权限。消息另存 `pinnedReferences`，保留固定对象与句内对象重叠时的来源，旧消息缺少该字段时兼容原推断。发送后 `@名称` 按原位置渲染成可访问按钮并打开稳定对象，复制保留原句，不重复列出句内引用；可选元数据损坏只禁用危险的重试或编辑发送，不丢弃有效对话文字。

`skills.ts` 用独立 `mewiki:library:<encoded stable ID>:ai-guidance:v1` 保存 `AiLibraryGuidance`，与会话 v1 和笔记备份分离。无配置返回空值，损坏／超限或存储失败显式报错，不静默覆盖。默认规范最多 4000 字符；每库 40 项技能、单项正文 12000 字符、全部正文 160000 字符、序列化配置 256000 字符。技能包含名称、适用描述、正文、关键词、模块、启用与默认标记。`resolveAiGuidance()` 合并启用的默认技能和显式选择，最多 6 项／24000 字符正文，缺失或停用的显式 ID 报错；关键词／模块仅推荐，不能自动启用。`AiSkillsPanel` 保存失败保留草稿，模板与 Markdown 导入仅预填，导入初始停用且不自动保存；导出仅带可移植名称／描述／关键词／模块／正文。YAML 采用 core schema、唯一键和禁用别名展开，输入最多 20000 字符，不执行脚本、不跟随电脑路径或隐式资源。

`taskSupport.ts` 的 `AiTaskSupport` 冻结引用和白名单 `AiGuidanceSnapshot`，`beginAiChatTask()` 复制到 `lastRequest.support`；重试／继续只用原快照，编辑旧消息的分支保留明确引用并使用当前规范与选择。`contextKey` 绑定引用身份、规范和技能正文，避免把旧规则下的问答混为新任务历史；句内位置随本次提问单独发送，不因位置变化隔离相同对象的历史。空规则与原范围中冗余的唯一笔记引用继续使用旧 v1 key。消息保存引用名、技能名和是否启用库规范，UI 以“本次生效规则”展示名称。会话／归档沿 v1 可选字段恢复，不持久脚本或工具权限。规则优先级为本次明确要求、本对话固定要求、启用技能、库默认规范；本次规则和固定要求置于历史之后，全部服从原任务权限与用户批准，不能替代读取原文或 controller 保存。相邻验证入口为 productCatalog／dictionarySearch／references／inlineReferences／inlineReferenceFlows／skills／taskSupport 单测及聊天范围、重试、分支与恢复回归；实际执行结果以验收记录为准。

## 相邻功能约束

符号书写约束（自工具契约 **v6** 接入）：`symbolNotation.ts` 复用词典 resolver 与稳定引用构造器，`search_dictionary`／`read_dictionary_entry` 返回 `resolved: {tex,bindings,markdown}`；查询还匹配别名与完整默认写法。`read_note`／`read_block` 附 `symbolConventions`，最多 12 项、8000 字符，不切断 LaTeX，`hasMore` 提示继续检索；随整个响应一起计入读取预算，不授予词典编辑权限。系统提示将数学字体、大小写与角标设为定义，要求聊天与建议使用完整书写，正文优先稳定引用、公式优先已读 entryId／bindings。

`assertAiProposalSymbolNotation` 在三个建议工具 push 前执行，只用纯变换比较同一块前后；词典符号编辑本身仍沿原有授权与审阅流程。Markdown 通过 remark 提取数学节点，代码／HTML／普通 URL 不按公式检查；稳定符号链接按默认值加实际 bindings 解析，而非相信显示标签。公式块按实际渲染 tex 检查；Mermaid 源码不作正文。复用既有符号匹配器寻找默认实例，仅在去字体后的完整记号对应唯一规范字体、且没有合法精确词条时，拒绝新出现或增加的错误写法。比较保留多原子分组、重音和其他命令；不强制合法自定义角标，不借用其他块的旧错误配额，不静默改写。错误包含词条 ID 和规范 tex，runner 按既有工具错误机制交给模型纠正；不合格项不登记。用户在审阅中自行调整的内容仍经原 controller 保存，不被 AI 专用约束阻止。临时草稿与聊天正文没有做全局替换，该检查不是完整数学语义验证。专项为 `symbolNotation.test.ts`、`e2e/ai-symbol-notation.spec.ts`，虚构评测新增 `symbol-notation-repair`。

左右侧栏开关统一在对应侧栏／ribbon 首位，AI 审阅与正文顶栏不再承接开关。`AiFloatingPanel.panelControls` 仅在固定嵌入时放右开关，临时嵌入沿用 ribbon 入口；同一聊天实例和任务不变。窄屏审阅使用中间正文列，只将被替换的原正文设为 inert，侧栏及聊天可继续操作，收起后扩大对照空间。此为界面布局变化，不扩展 Agent 权限、工具或保存流程。

正文所见即所得编辑沿用现有 Markdown 与 controller，不新增 Agent 工具或改变权限。`ResearchReferenceEditor` 的富文本状态在失焦时序列化后提交；`AiSelectionToolbar` 附加选区前先完成这一提交，排除自动标题编号，再交给 `selectionRanges.ts` 计算稳定 UTF-16 原文范围。不要把 ProseMirror 位置或 DOM 字符数直接作为资料偏移。验收覆盖标题／强调内选区、中文输入与撤销后的保存，见[正文编辑计划](../plans/2026-11-14-rendered-text-editing.md)。

`AiSelectionToolbar` 的 DOM 前文与选中文字使用同一原文投影：编辑器引用原子通过 `data-mewiki-reference-label` 提供解析后的原标签（含引用式链接），KaTeX 的 MathML／HTML 双重结构只取一份 TeX，避免显示名称变化和公式重复文字导致前文定位失败。主引用正文也沿用该投影；不修改用户源码、词典写法或范围校验。编辑器先失焦提交，再从 controller 取最终基线；失败通过 `onError` 显示现有笔记错误提示，成功附加清除旧提示，不能吞掉定位错误或改为整篇授权。回归见 `e2e/ai-chat-actions.spec.ts` 的未提交文字、鼠标／键盘、公式／符号／笔记引用前文、完整／局部范围及失败后重选。

双侧竖栏临时打开不改变 Agent 的授权、读取投影、工具、建议或 controller 保存。`ResearchNotebook` 用独立临时状态复用右侧大纲／嵌入 AI，AI 保持同一 `AiWorkspace` 实例；悬停和点击导航不发请求。收起临时 AI 只挂起显示，不卸载、停止或清草稿；`AiFloatingPanel.onEscape` 仅临时侧栏传入，嵌套菜单先处理，独立浮窗行为不变。维护见[布局计划](../plans/2026-11-14-workspace-ribbons.md)、第 2／22 章及 `e2e/workspace-ribbons.spec.ts`。

内容行菜单的“发送到 AI”由 `ResearchBlockInsert` 传递实际按钮矩形，`ResearchNotebook` 在普通 blur 保存后从 controller 最新快照创建 `createAiBlockSelection()`，共用文字选区的附加／激活函数。v1 引用新增可选 `kind: 'block'`，恢复只接受单个根块和有效摘要，缺省保持旧文字选区。正文用既有安全可读投影生成最多 4000 字摘要，超长明确截断；不展开其他笔记、不发送附件原件或插件私有数据。`assertAiSelectionEdit()` 从实际树推导根块及子块、从 schema 推导可写字段，仅允许已有块更新（排除 section）及旧文字 replace-text；工具／流式共用断言，原生先读后改与逐项批准不变。UI 显示“本行内容”，保留草稿、当前面板方式与按库恢复，点击不自动请求。入口、权限与专项验收见[本行菜单计划](../plans/2026-11-14-ai-block-menu.md)、`blockSelection.test.ts`、`e2e/ai-block-menu.spec.ts` 和第 4／22 章。

本轮实现见[计划](../plans/2026-11-12-ai-workspace.md)，用户操作见[AI 手册](../wiki/22-ai-workspace.md)。Agent 与 MeWiki 核心一起维护，使用现有领域函数和保存控制器，不另建笔记实现。

## 四层边界

2026-11-14 接续清单第 4～8 项见[实施计划](../plans/2026-11-14-ai-memory-search-recovery.md)：

- `memory.ts` 将完整聊天与模型上下文分开：会话 v1 不再裁切 20 条，最多 2000 条、4 Mi 字符；UI 每批展示 40 条，复制／消息编辑／分支使用全记录。`scopedAiHistory` 只选同 contextKey 的成功问答；`buildAiModelMemory` 发送最近 8 条及 6000 字符内跨历史采样摘录，最多 24 项、每项有界，保持 JSON 完整。`memoryInstructions` 最多 4000 字，按本对话保存并快照到 lastRequest，重试沿原要求；新建清空、分支继承。摘要按需派生，不存工具结果／推理或权限，旧 v1 无字段继续可用。归档 50 会话／4 Mi 字符总限不变，所有写入失败可见，不静默逐出。
- 工具契约 **v5**：`search.ts` 统一 list_notes／search_notes 的 `{items,total,offset,limit,nextOffset}`；旧参数仍有效，返回值从数组改为分页对象。ID 打破排序平局，标题精确／包含、标签及正文按公开权重排序；每结果最多 3 处片段、含 blockId 与标签路径。仅投影可读字段，保持授权及预算，搜索不授予读取／修改权限。模型根据实际注册表发现新版，无运行中旧服务兼容分支。
- `failures.ts` 统一可选失败类别与恢复动作，校验 Retry-After 的时间截止值，最长一天。`AiServiceError` 经 HTTP JSON 或 NDJSON error 传到 client 和 v1 会话；丢弃损坏附加字段不丢聊天。429 保留等待，401／403 等配置错误提供设置入口；网络／超时／服务错误显式重试，不自动重发或改供应商。transport 90 秒空闲、10 分钟总时限，每个有数据的 chunk 刷新空闲时钟，总时限不延长；AbortSignal 竞速包围读取，finally 清计时与监听，依旧限制字节、结束事件并隐藏密钥。
- `execution.ts` 定义有界 steps、phase 和 metrics。工具开始、完成、失败及复用经 onProgress 发布；目标仅取冻结授权快照中存在的稳定 ID。恢复白名单处理，running 步骤变 interrupted；UI 重新核对目标存在后才允许定位。记录可收起，当前进度不占大量垂直空间；不展示工具参数或私有推理。
- `evaluation.ts` 的 7 个固定虚构工作流覆盖局部改写、精确选区、隐藏条件标签、后续分页、去重、越界拒绝和词典符号字体纠正。使用真实 runner／工具及应用校验，报告完成、范围、来源、建议有效性、耗时、调用与用量；`npm run ai:evaluate` 只跑受控 completion，输出 `.mewiki/ai-evaluation/latest.json`，不载入用户配置、不联网。受控 token 是 fixture 值，不能作为真实模型质量或成本结论。自定义 completion 需调用方明确提供，报告单独标记。

仅有 `memoryInstructions` 的未发送对话也属于有内容的会话，归档和切换须保留，不能按空白对话过滤。专项回归为 memory／search／failures／execution／evaluation／conversations 单测、server/aiRecovery.test.ts、e2e/ai-memory-recovery.spec.ts。正式检查见验收文档。

- `server/aiProviderStore.ts`：多服务配置、revision 乐观锁、密钥保存。默认 `.mewiki/ai-services.json`；隔离设置使用 `<MEWIKI_RESEARCH_SETTINGS>.ai-services.json`。Windows DPAPI 通过 stdin 调用，其他平台限制文件权限。密钥缺省保留、空串清除，切换 origin 不自动沿用密钥。
- `server/aiTransport.ts`、`aiServicePlugin.ts`、`src/ai/client.ts`：三种明确协议、受限请求和 NDJSON 流。只允许本机同源及 `X-MeWiki-Request: ai`，拒绝上游重定向，错误不回显上游正文或密钥。设置可在不同库共用，任务资料和会话按库隔离。
- `src/ai/runner.ts`、`tools.ts`、`readable.ts`：冻结本次资料快照和授权 ID，通过单一注册表发送说明、发现能力和执行工具。最多 32 轮工具交互、40 次调用、每轮 8 个工具及 20 项建议，读取与上下文另有字符上限。预算用尽后尝试一次 `tools: []` 的正文总结，不执行额外工具；无进展停止规则见下文。取消后再次检查信号，拒绝迟到工具。文档内容只作为资料，不能扩大权限。
- `src/ai/proposals.ts`、`session.ts`、`AiWorkspace.tsx`：建议不写入资料；用户点击应用或撤回后重新检查库 ID、基线和保存状态，使用 controller 提交。会话逐字段校验、限制大小、按库存储，恢复运行态为中断态。

`types.ts` 是传输的共享边界，不依赖 React。Responses 使用 `store:false` 和 `reasoning.encrypted_content`，加密推理续接字段仅在同一任务的内存消息中传递，不显示、不写历史或笔记。自然语言历史保留完整的 user/assistant 文本，模型另用有界摘录和近期对话，不复用旧工具调用配对；每条历史的 `contextKey` 绑定服务 ID/地址/协议、模型、授权笔记 ID 集合、选区、材料及可选引用／规则快照的 SHA-256，只发送与本次相同的历史，无标记的旧历史仅显示。

## 能力与提交

### 对话辅助文件

添加警示见[气泡计划](../plans/2026-11-13-ai-material-warning-bubbles.md)：`AiMaterials` 的单次导入错误通过 `AiMaterialNotice` 覆盖在当前聊天标题栏下方，不参与浮窗／侧栏排版，不自动聚焦。组件保留在聊天 DOM 内，使用浮窗和嵌入模式既有的面板 transform 作为 fixed 包含块，随拖动／缩放自动定位，不能恢复成全窗口 top layer。浅橙底、深色文字和 22px 警示图标提高辨识度，关闭按钮独立定位在右上角；宽高受面板限制，长错误列表局部滚动。批量错误共用一处 live alert，八秒计时随新错误重置，悬停／聚焦暂停；关闭、卸载清理计时，祖先 hidden／inert／aria-hidden 变化清除旧警示。警示为临时 UI，不进入会话或笔记；解析限制、材料 ID、工具权限和保存失败状态不变。回归在 `e2e/ai-materials.spec.ts`。

文本格式扩展见[计划](../plans/2026-11-13-ai-material-text-formats.md)：`materials.ts` 统一登记文件扩展名并导出 `AI_MATERIAL_ACCEPT`／`aiMaterialKindForName()`，JSON／TeX／BibTeX／YAML／XML／配置／日志及常见代码归通用 `text` 类型；TXT／MD 和旧文档类型保持原值，既有摘要与 v1 快照继续恢复，工具契约仍为 v4。导入复用 UTF-8／带 BOM 的 UTF-16 解码、二进制检查和原有限制，不调用 JSON／HTML／TeX 解释器，保留原文和语法错误。预览作为 React 文本显示；不执行或编译材料，不追踪本地引用路径。变更扩展名时同时维护材料单测、Edge、格式提示和第 22 章手册。

实现见[计划](../plans/2026-11-13-ai-materials.md)与[手册](../wiki/22-ai-workspace.md#添加辅助文件)。`materials.ts` 定义按库的不可变解析快照，ID 是库 ID、文件名、类型、字节数和各分段文字的 SHA-256。`materialImport.ts` 本地处理 UTF-8／带 BOM 的 UTF-16、DOCX 正文和现有表格 Worker；`materialPdf.ts` 惰性加载本地 PDF.js 与资源，逐页读取文字层并释放任务。输入最多 20 MB，表格沿用 10 MB 与 ZIP／单元格限制；DOCX 只展开固定正文条目并限制实际解压量及 XML 声明。每文件 100000 字符、PDF 200 页，不静默截断；取消、超时、空白、扫描件、加密／损坏和预算错误显式反馈，不写原件。

工具契约 **v4** 增加 `list_materials`、`search_materials`、`read_material`，从同一注册表生成说明和校验。任务上下文只包含明确选中的最多 6 份材料，校验库和内容摘要。目录按 20 段分页、文字按 12000 字符分页，返回文件名与页／表／段标签；全部响应通过 `budgetAiRead`，与笔记共用 100000 总字符及单响应限制。读取材料不记为读取笔记，不授予原生修改权限。材料内容是资料，不能驱动任意路径、脚本、插件、宿主操作或直接保存。

会话继续使用 v1 的可选 `materials/activeMaterialIds`，user 消息可选 `materialIds`；每段最多 12 份快照、合计 200000 字符，当前会话放宽至 4 Mi 字符，归档历史仍限 4 Mi 字符。恢复按字段白名单重算摘要，损坏材料不抹除聊天，仍有有效 ID 的缺失引用显示并阻止复用。`contextKey` 有材料时绑定排序后的 ID／名称，无材料保持原哈希兼容。begin 读取活动材料；retry 与消息分支使用原 user 的材料，切换后的活动集合不能串入。普通追问移除材料后不携带旧材料上下文。

`AiMaterials` 在输入区提供选择／拖入、进度、取消和紧凑条目，文件拖放停止传播，避免触发笔记导入。解析组件按库／会话卸载取消，保存成功才发布已添加状态。`AiWorkspace` 共用一个常驻原生预览 dialog；Escape 不传播给浮窗，关闭恢复触发按钮焦点。移除仅撤销后续任务的活动 ID，历史消息引用的快照继续保留；没有消息但已附材料的对话仍可归档。原文件二进制不进入会话、笔记、备份或模型请求，只发送工具按需返回的解析文字。回归见 `materials.test.ts`、`e2e/ai-materials.spec.ts`。

聊天操作见[计划](../plans/2026-11-13-ai-chat-actions.md)与[第 22 章](../wiki/22-ai-workspace.md#快捷提问与选中文字)。`chatActions.ts` 构造新任务和显式重试：v1 会话可选 `lastRequest` 关联稳定 user 消息 ID、原服务／模型、笔记 ID、目标／选区摘要和内容基线；消息可选 `id/status/selection`、会话可选未发送的 `selection`。恢复逐项白名单校验，坏附加字段不能抹除有效聊天，运行消息恢复为 interrupted；旧会话缺少记录时不猜测重试范围。任务基线包含授权原文、词典与地图知识，排除活动笔记／地图和视口选择，变化后要求重新发送。

重试只响应最近失败／取消／中断任务的用户点击，保留失败回复与完整建议，追加新的 assistant 尝试；不重复 user，不清后续 draft／selection，不发送失败片段作为已完成历史。每次尝试从零统计用量，代次和 AbortController 沿用，切换会话／库拒绝迟到进度。runner 接收仅重试时提供的 `existingProposals`，每次仍先执行原权限、读取与字段校验，再按原基线与语义内容复用旧建议，不将新实体随机 ID 视为语义差异；复用项保留旧归属与已处理状态。已应用内容改变基线时禁止直接重试。

`AiSelectionToolbar` 仅从 reading rail 中同一 reading-note 的文字块抓取渲染选区，排除聊天、工具栏、跨窗和同步引用；编辑器先完成普通 blur 保存，下一帧再记录块摘要。每块附加 DOM 可读前文提示，`selectionRanges.ts` 以 remark 字符位置将可读文字保守映射到 text／items 的 UTF-16 范围，区分重复词，保留强调、转义、实体与 emoji 的源码边界；始终使用首末实际选中字符的源码边界，不因选中全部可见字词扩大到隐藏图片、链接目标或外部格式标记，整行授权仅由 `kind: 'block'` 提供。无法可靠定位时拒绝猜测。v1 引用可选 ranges，旧引用仅在唯一匹配时补算，恢复后校验范围与 quote 一致。绑定稳定库、实际来源及块，最多 4000 字／20 块。`assertAiSelectionEdit` 在工具与流式草稿共用，范围外前后源码与列表项必须原样保留；未闭合字符串临时补回受保护后缀，闭合即严格校验。父级显式消费请求，关闭重开不重新附加。`createAiToolContext` 将读取收窄至来源；contextKey 绑定选区，不复用更宽的旧任务历史。快捷菜单只填草稿，用户仍须审阅并经 controller 保存。

基础理论与研究记录不按 `note.library` 分配不同 AI 权限。选区包括条件／结论抽屉及标签页中的 paragraph、heading、markdown、list、callout；`aiSelectionTextFields()` 从实际块推导 text／items，不信任恢复记录附带的类型或可写字段。旧 replace-text 只处理 paragraph／heading／markdown，列表和提示使用 propose_edit block-update，禁止越块、section、提示标题／样式及词典修改，精确文字范围继续校验。数组建议在完整参数后进入预览。无选区时可读取／修改公式等内容。来源与预览引用统一 `openLibraryNote(..., false)`，保持真实分区及筛选。回归见 `foundationParity.test.ts`、`selectionRanges.test.ts` 与 `e2e/ai-foundations.spec.ts`。

选区入口的手势状态仅由正文内左键 pointerdown 开始，捕获阶段的 pointerup／pointercancel／lostpointercapture、键盘选择与窗口失焦均释放拖选状态；避免取消手势后永久忽略 selectionchange。Escape 的 dismissed 签名在选区清空或变化后解除，同一文字再次选择可重新显示按钮。输入区引用仅以 CSS 两行省略，title、会话原文和请求保留完整文字；原生范围 select 包括 disabled 共用样式，选区锁定与权限不变。参考来源作为 `AiWorkspace` 第一个非滚动区，紧邻外层标题栏，继续沿用稳定 ID 和原有跳转。维护见[选区与来源计划](../plans/2026-11-13-ai-context-panel.md)，回归在 `e2e/ai-chat-actions.spec.ts`、`e2e/ai-conversation.spec.ts`。

消息复制只取正文，整段复制只取当前自然语言消息和显式引用，保留 Markdown；不含工具参数、推理续接、内部 ID 或密钥。异步剪贴板反馈校验当前会话身份。设置重读与任务取消的生命周期分开，重读失败不影响草稿。回归：`chatActions.test.ts`、`runner.test.ts`、`drafts.test.ts` 与 `e2e/ai-chat-actions.spec.ts`。

`tools.ts` 的注册表同时生成 `aiTools`、系统提示和执行器；新增工具不得只改提示词。`AI_TOOLS_VERSION` 表示本地工具契约，与资料版本、插件 API、宿主 v1 分别管理。

工具契约 v3 增加 `get_edit_schema`、`read_block`、`read_dictionary_entry`、`read_theory_maps` 和 `propose_edit`。`nativeSchema.ts` 定义精确字段契约，`nativeTools.ts` 共用契约生成能力说明并检查读取及引用权限，`nativeEdits.ts` 复用领域函数执行纯转换，`nativeProposals.ts` 管理目标、基线和效果。覆盖笔记属性与删除、原生块增删改和移动、标签页管理、符号及术语完整可编辑字段、理论地图及关系。旧 `propose_note`、`propose_term` 和 v1 会话保持兼容；改写优先定位原块，补充才用 append。

所有写操作只提出建议，没有直接保存或应用工具。原生块必须先 `read_block`；删除容器或标签页前须读完将删除的子树。整篇属性、删除及根层插入等要求完整读取笔记；词条要求完整读取对应条目。地图及其全部成员、引用均须在授权范围且已读取，全局地图要求全库普通笔记，手册不作为隐式成员读取；显式引用未授权手册仍禁止修改。`assertNativeEditAccess` 供终态工具和流式草稿共用，不授予读取、不修改预算或状态。搜索命中与来源链接不等于已读原文。

`read_note` 将正文、块清单、属性文档分别按 `offset`、`blockOffset`、`metadataOffset` 连续分页；沿三个 `next*Offset` 从零读完才记入 `readFullNoteIds`。普通页返回 `metadata` 和 `theory`，大属性页返回两者为 null，以及 `{metadata,theory}` 的 `metadataJson` 片段。块清单含容器路径与标签标题，容器详情由 `read_block` 返回。所有返回字段均计入总计 100000 字符、单响应 60000 字符的预算；超限拒绝且不记为完整读取，单个过大块、地图或词条需要缩小内容后再处理。

`readable.ts` 只投影已知可读字段，不使用含备份原始 JSON 的 Markdown 序列化器；未知插件只提供标题、摘要、备注，不读私有 JSON、附件二进制或其他库。内容引用只解析本次授权的同库笔记；附件只能引用授权资料中已知的资源，公式符号及结果来源也要求完整读取。外部来源不能直接创建或修改插件私有数据。固定符号位置只开放 x1/x2/x3 的 key、defaultValue、description，不宣称可编辑领域函数重置的固定元数据。图片创作、导出、插件安装、系统设置、联网及任意脚本未接入工具；后续开放需明确发送范围、预算和取消行为。

建议记录稳定库 ID、目标 ID、原文基线和受限操作。`editDependencies.ts` 对笔记按实际写字段、块类型、section、容器路径与所属库检查，允许手动标题／其他块／另一标签页／同块独立字段共存；appearance 按合并子字段判断，公式 tex／parts 互为隐式依赖。tab-update 依赖原 tab 标题，嵌套插入忽略同一容器的标签标题但严格检查其余字段、内容与顺序，删除保留完整局部块及顺序检查；移动、标签结构、关系、词条与地图保持严格快照。`rebaseAiReviewProposals` 在批准／撤回过渡中复用相同依赖校验，不能仅比较显式字段而跳过路径或隐式依赖。新增 ID 和地图创建时间冻结。旧文字操作也生成 native effects，并以应用前当前 state 记录 before，撤回不会恢复成 AI 生成时的旧快照。撤回仍校验全部 effects 和后续引用，保护应用后的编辑。`AiProposalConflict` 对无法应用的建议展示原文／当前／建议，保持只读。组批准先预检全部项，失败不部分保存。恢复校验快照、目标、baseline 与 effects 对应关系，拒绝无关副作用。保存失败保留变更记录。

`proposalGroup.ts` 将笔记的旧文字与原生操作归于同一业务目标。先对当前状态与批准历史预检每项原始基线，再在临时状态按建议顺序组合；不能用组合后的基线绕过原始检查。预览和批准共用此转换，组合失败不返回部分结果；重叠字段以最后操作为终稿。批准一次写会话并调用 controller，实际 effects 保留每项前后状态以便逆序撤回。无效果项返回 `mergedIds`，会话 v1 可选保存该字段，界面显示“已合并”，不伪造空 effects 或撤回记录；恢复过滤未知、未批准、重复或仍有真实 change 的 ID，旧记录继续兼容。

`appliedIds` 保留曾经批准的历史，不能单独用来禁止再次应用。`isAiProposalApplied()` 结合有效 `changes`／`mergedIds` 判断当前批准状态，界面、待审预览、逐项调整、拒绝与恢复统一使用；仅有历史 ID 的旧 v1 项显示“已撤回”并可重新审阅。撤回时将该项 `before` 恢复为最近一次真实 change 的 `before`，保证组内重叠修改再次应用／撤回仍回到上一项结果；不改其他活动批准项的基线，也不放宽手动编辑冲突检查。再次应用生成新 effects，历史 ID 去重且不增加建议配额，原生生成 ID 保持不变。恢复时先校验合并字段再过滤拒绝项，损坏的可选元数据不能丢失有效对话。回归见 `session.test.ts`、`reviewDecisions.test.ts` 与 `e2e/ai-redo.spec.ts`。

runner 对完整参数规范化缓存成功读取，分页参数变化仍执行；建议每次先经注册表权限与字段校验，再复用相同调用或跨旧／原生工具的等价文字修改。读取仍返回原文，建议尚未保存。连续三轮全为重复／失败调用或耗尽预算均进入一次正文收尾，返回 finishReason=stalled／budget，UI 显示 partial；正常结束为 complete。收尾失败保留结果，取消传播 AbortError。超过总调用数的同批请求有配对错误回复，不计为已执行工具，保持单段 tools／activity 的 40 条边界。

`checkpoint.ts` 定义 v1 有界接续记录，绑定库、原 user ID、scopeKey；只存成功只读工具参数（最新 40 条）、本任务建议 ID 和最多 6000 字的公开输出摘要，总量不超过 40000 字符。不持久工具输出、模型私有推理或权限标志。完整工具批次后更新，坏可选字段只丢 checkpoint。`continueAiChatTask()` 仅响应 partial 的显式点击，和失败重试共用原服务／模型／范围／选区／材料／基线核对；UI 请求前重读设置。runner 通过原执行器重放本地读取恢复读取状态并计入当前段读取预算，按最多 8 项一批重建成配对工具消息，使用通用字符调用 ID；随后发送公开摘要、读取结果与已有建议说明。请求前同时检查字符与 128 条消息上限，为下一完整工具批次及收尾留空间，超限改为 partial 而非服务错误。相同建议先验证再复用，不更改历史归属。每段重新计数和记录用量，整会话仍限 40 建议。刷新不自动调用模型，新提问／消息分支清除旧 checkpoint。实现与验收见[接续计划](../plans/2026-11-14-ai-collaboration-reliability.md)、`continuation.test.ts`、`e2e/ai-reliability.spec.ts`。

旧文字与原生操作使用相同的字段依赖和语义比较，不因 JSON 字段顺序误报冲突，也不依赖批准历史为独立手改授权。`ensureAiTheoryMaps` 为未初始化的系统地图提供稳定投影，读取、生成、审阅及批准共用。地图撤回保留当前导航，只有本次改变的路径参与回退；effects 继续保存 v1 完整快照，兼容此前记录。

内容类型由 `readable.ts` 的 `never` 和 `aiBlockFields satisfies Record<ResearchNotebookBlock['type'], ...>` 检查遗漏；动作由 union、领域 switch 的 `never`、工具 `actionKeys` 和界面标签的 Record 约束。新增字段仍需主动同步字段契约、投影、领域转换、审阅、会话和测试，不能把类型检查当成未来字段自动接入。

## 每次产品变更需要判断什么

1. 新增或修改内容类型：更新 `readable.ts`，确定可读字段及私有数据边界，增加真实结构 fixture 的投影测试。
2. 修改笔记、词典或保存操作：复用原生领域函数，检查 proposal 基线、稳定 ID、撤回、冲突和历史兼容。
3. 新增用户能力：决定是否开放给 Agent；开放时同步工具 schema、执行器、能力说明、相邻单测和手册。未开放时不得在提示词宣称能执行。
4. 修改协议、权限、范围或会话：同步前后端契约、取消和跨库测试；不能因为模型建议而扩大宿主或插件访问权。
5. 修改界面：补中英文、窄屏与键盘操作；更新 `docs/wiki/`，手册登记和验收记录一起交付。

AI 不需要在每次颜色或排版微调时改工具。必须跟进的是它读到的资料、可执行操作、授权和提交规则；界面调整仍按普通手册约定维护。

## 聊天面板的生命周期

子面板呈现统一由 `useAiAnchoredPopover` 和 `AiChatPopovers.css` 维护，历史／用量／模型／快捷提问／引用／功能帮助为深色操作表面，记忆与规范／技能为浅色内容、深色标题和聊天局部淡遮罩。定位采用真实入口按钮和聊天可见范围，不避让整个输入表单；浮窗移动、缩放、嵌入及查询重建后继续跟随。遮罩点击或 Esc 只关闭子面板并恢复入口焦点，原组件的保存、草稿、检索和会话逻辑保持。修改此层须同步第 22 章及 `e2e/ai-popovers.spec.ts`、相邻面板回归；不新增 AI 工具、权限或资料协议。

嵌入右栏的页签沿用 `ResearchSidebarTabs` 的纯图标、tooltip 与键盘导航；右栏的收起按钮位于头部最右端，收起后的竖栏展开按钮仍在顶部首位。大纲／符号反链与 AI 使用两份 header，键盘切换通过 `focusGroup="right"` 将焦点交给可见的同名标签，浮窗激活不覆盖该标签焦点。页签切换不重建聊天、不中断任务或丢失草稿；回归见 `e2e/workspace-chrome.spec.ts` 与 `e2e/ai-docking.spec.ts`。

`conversations.ts` 在本库 `ai-conversations:v1` key 保存历史快照，当前会话继续使用原 `ai-session:v1` key；会话 v1 只增加可选 `conversationId`、稳定 `conversationTitle`、`updatedAt`，旧记录直接作为当前对话进入列表。两个入口共用 `restoreAiSession` 的严格逐字段校验，非法可选元信息不丢主体，历史损坏或跨库内容则明确拒绝改写归档。当前内存覆盖同 ID 的旧快照；按最近使用排序，50 段及 4 Mi 字符总量限制，失败不静默删除历史。空白项离开后不归档，清空只替换当前 ID 并去掉旧快照。

切换先将当前和目标快照写入归档，再写当前 v1 槽；任一步失败不更新 UI、不取消当前任务。成功后才推进 generation、abort 旧请求、取消待写定时器并清除中央预览及暂态草稿。旧运行态归档为 interrupted，保留已收到的回复、用量和完整建议；迟到回调沿原 generation / abort 检查丢弃。未保留的局部建议调整锁定切换；批准及撤回仍经过现有基线检查和 controller，历史选择不触发工具或改变资料授权。

`AiConversationPanel` 的入口在底栏标题之前，列表是非模态浮层，按入口附近的可用聊天空间限制高度。与其他子面板共用互斥打开状态，点击外部关闭，Escape 关闭并恢复入口焦点。修改预览为默认收起的原生 details，单行状态与图标操作；颜色与文字共同区分 applied / undone，不改变建议决策。模型弹层保留原生字段与简短范围，说明放信息提示。测试见 `conversations.test.ts`、`session.test.ts`、`e2e/ai-chat-panels.spec.ts`、`e2e/ai-popovers.spec.ts` 与现有 AI 专项。

会话 v1 的可选 `draft` 保存最长 12000 字符的未发送输入；旧会话缺省为空，损坏草稿只丢弃该字段，不能抹掉有效聊天。输入和 runner 进度通过同一 `publish` 更新最新快照，发送成功写入提问后清空草稿，清空会话一并清除。常规写入合并 250ms；`pagehide`、页面隐藏和组件卸载同步保存最新快照，隐藏标签页只刷新存储，不取消任务。刷新后的 running 仍按既有规则恢复为 interrupted，不重发请求，未完成的原生修改草稿仍只在内存。`ResearchNotebook` 按稳定库 ID 记住 AI 面板是否显示，刷新恢复显示；主动关闭后不强行打开。浏览器与功能标签切换、草稿恢复及刷新前最后一段输出由 AI 专项 Edge 覆盖。

当前布局见[悬浮面板计划](../plans/2026-11-13-ai-floating-panel.md)、[紧凑浮窗及消息编辑](../plans/2026-11-13-ai-compact-window-message-edit.md)、[底栏及半露胶囊修正](../plans/2026-11-13-ai-footer-capsule.md)与[可选嵌入右栏](../plans/2026-11-13-ai-right-panel.md)。`ResearchNotebook` 独立管理 AI 打开状态及按库的 `ai-panel-placement:v1`，旧偏好默认浮窗。单个 `AiFloatingPanel`／`AiWorkspace` 始终位于同一个布局位置，切换只改变呈现，不重建会话或请求。浮窗在原生 dialog 内呈现非模态窗口，28px 标题栏直接捕获拖动，四边与四角提供透明缩放命中区；方向键／Shift 可移动和缩放。`aiFloatingPanelLayout.ts` 统一选区避让、固定对边及 dialog／visualViewport 边界，原 `ai-floating-panel:v1` 几何独立保留。

嵌入时占用既有第三网格列，共用右栏宽度与分割线；44px 标题栏和 `ResearchOutline`／`ResearchSymbolBacklinks` 提供相同工具标签，选中 AI 时隐藏大纲区域，切走仅 suspended 聊天。收起开关位于嵌入标题栏第一位，收起后移到右侧 ribbon 第一位；收起与换标签不触发 dispose，正文和审阅顶栏不重复放置。气泡恢复聊天并激活输入，嵌入显示时隐藏气泡避免重叠。切回浮窗恢复此前大纲开关和浮窗几何。嵌入不消费选区矩形，不改变工具、权限或批准保存；窄屏使用既有右栏抽屉，中央审阅保留其交互，可按需收起以查看完整建议。专项为 `e2e/ai-docking.spec.ts`。

浮窗尺寸位置使用独立的 `mewiki:library:<编码 ID>:ai-floating-panel:v1` 浏览器偏好，坏值回退；原 `ai-panel-open` 键继续兼容。选区只额外传临时矩形与独立 activation ID，不写进会话或笔记，父级消费选区请求后仍保留本次激活位置。从选区唤起时重新避让，边缘气泡唤起使用最近位置；两者都聚焦输入，suspended 期间延后消费 activation。ResizeObserver、窗口及 visualViewport 变化保持可达。底栏收起隐藏整行与间距并关闭附属菜单，聊天、输入、任务和中央预览保留；点击气泡关闭整窗才卸载并执行原 dispose，中断、保存、拒绝迟到输出。设置页面显示时隐藏浮窗，不自动中断，AI 服务设置入口仍按原规则先关闭。测试见 `aiFloatingPanelLayout.test.ts`、`e2e/ai-floating-panel.spec.ts` 与完整 AI 回归。

`AiFloatingLauncher` 位于笔记 dialog 中、隐藏的笔记 shell 外，替代原底栏 AI 图标。62×56px 可见命中区贴视口左右边，伪元素绘制 124×56px 白色圆角胶囊及阴影，外半由窗口裁切，40px 头像完整留在可见半侧。入口常驻设置和各工作区，点击开关整窗；设置页先走 `closeSettings()` 返回并打开笔记中的 AI。`SettingsPage.onBusyChange` 同步现有库管理与存储 busy，加上切库和删除确认状态禁用入口，不能绕过离开限制。关闭聊天将焦点还给气泡。气泡偏好 `mewiki:library:<编码 ID>:ai-launcher:v1` 保存 version、left/right edge 和 0–1 高度比例，viewport 缩放仅投影；5px 阈值区分拖动与点击，拖动结束吸附最近边并抑制误点击，支持方向键及 Shift。位置几何与校验集中在 `aiFloatingPanelLayout.ts`。浮窗直接使用 `aiFloatingBounds()` 的 dialog／visualViewport 交集，拖动、缩放、恢复四边均零外边距，不扣除气泡空间；入口 z-index 34 高于浮窗的 30，重叠时仍可操作。删除仅为避让而存在的 launcherEdge 状态传递，入口换边不投影或挤动面板；气泡自身胶囊留白和高度比例兼容。当前修正见[零边距计划](../plans/2026-11-14-ai-floating-panel-flush-edges.md)，此前设计见[视觉与入口计划](../plans/2026-11-13-ai-floating-launcher.md)及[半露胶囊计划](../plans/2026-11-13-ai-footer-capsule.md)。

浮窗与气泡均通过 Pointer Capture 和 rAF 合并直接绘制 translate3d，移动不逐帧更新 React 或 localStorage，手势结束才提交位置；调整大小同步绘制真实尺寸，will-change 仅在手势期间启用。无边界变化的观察回调不打断拖动，真实视口变化取消捕获并投影原偏好，取消过程不保存临时位置。激活呈现窗口，DOM 提交后再在下一帧聚焦，晚于设置导航的焦点恢复。transform 建立新的 fixed 定位容器，compact 菜单使用浮窗内局部坐标，不再次添加全局坐标。淡蓝灰背景、深蓝工具栏、轻阴影与工具进度的单侧细线仅作用于浮窗，不覆盖中央审阅或导出渲染。

`AiMascot` 从本地品牌 SVG 以 `?raw` 导入并在模块级编码为 data URL，所有聊天头像随界面代码发布，不依赖可缺失的静态图片请求。保留 img 尺寸、装饰语义、禁止拖动及原始品牌文件，不改变 Agent 工具或数据权限。`e2e/ai-brand-assets.spec.ts` 模拟旧图片请求返回 200 HTML 的场景，核对入口、标题、欢迎、回复、刷新、选区与设置中的图片实际完成解码，已加入常用 AI 配置。见[头像资源修正](../plans/2026-11-14-ai-mascot-bundled-assets.md)。

用户期望位置与实际可见 frame 分开：只有拖动、调整大小或选区唤起才更新偏好，临时窗口／键盘视口变化只投影当前可见范围，恢复视口后回到期望尺寸。底栏折叠不改变完整面板尺寸或移动边界。短面板优先保留 composer 的发送／停止行与底栏，选区及 textarea 使用 `mewiki-ai-composer-content` 内部滚动，材料列表独立有界；ResizeObserver 与输入聚焦仅调整该局部滚动，保持活动输入框可见，不滚动笔记。极端高度下表单仍可滚动；内部菜单使用同一浮窗坐标限制，不被输入内容滚动容器裁切。删除笔记确认期间同设置页一起 suspended，确认取消后恢复聊天，避免盖住确认或争抢焦点。

对话布局沿用[聊天工作区计划](../plans/2026-11-12-ai-chat-workspace.md)：独立历史滚动区与固定底部 composer，输入框下的控件栏显示会话首条用户提问的稳定标题，前方是对话历史入口，右侧放置复制、用量、清空及服务设置。输入框外、导航顶部中央的扁把手使用同一个原生按钮切换整行导航，收起时只保留 14px 把手区域，焦点自然保留；按库记忆 `mewiki:library:<编码 ID>:ai-footer-collapsed:v1`，不改变聊天、错误或输入区。28px 标题栏使用对称布局居中显示当前语言名称，中文为“觅维 智能助理”，无重复整窗收起／关闭按钮；整窗由气泡开关。模型菜单使用原生 details 向上展开，最小宽度 41px 保留模型与箭头图标的命中区，资料范围与对象共用输入区的 `@` 入口，可见标签和选区卡片决定实际授权，不再使用独立范围下拉框；运行中准备下一问不会改变原任务快照。按 Enter 发送、Shift+Enter 换行，composition 状态及 keyCode 229 阻止输入法误发送。运行中可编辑追问草稿，但仍只允许一个请求。历史依照用户是否停留底部跟随输出，ResizeObserver 处理换行与面板尺寸变化；向上阅读时提供返回最新消息按钮。既有会话格式和工具、应用 / 撤回规则继续兼容。

用户消息由独立气泡和外部右对齐操作栏组成，复制与编辑不占用气泡正文；`ui-surfaces.css` 的用户背景只作用于气泡，消息外层和操作行透明，跟随聊天背景。按用户明确要求，仅聊天主输入和消息编辑 textarea 去除聚焦 outline／shadow，保留原边框与光标，其他控件继续原生焦点反馈。编辑先沿用 `stop()` 的 abort／generation 保护停止当前任务、暂停中央跟随，再保存会话 v1 可选 `messageEdit: { index, content }`；原消息和底部普通草稿、选区保持独立。恢复时单独校验编辑目标为用户消息及 12000 字符限制，坏编辑字段不丢有效会话。编辑框 Enter 换行、Ctrl／Cmd+Enter 重发、Escape 取消，composition 期间不提交；编辑入口、刷新／重新打开和切回历史时焦点优先给编辑框，延迟恢复不能抢回普通输入框。历史的会话更新及 ResizeObserver 自动跟随在 `messageEdit` 存在时暂停，避免聚焦旧消息后再滚回最新回复。

刷新恢复的编辑框可能早于笔记原生 dialog 打开与字体加载解除 inert 挂载；编辑焦点 effect 只观察自身祖先的 open／inert／hidden 属性，等实际可交互再恢复焦点，成功或卸载即断开，不用固定延时或长期抢焦点。Edge 须检查生产构建中的刷新场景，开发构建的加载时序不足以覆盖此问题。

`forkAiChatBeforeMessage()` 只复制编辑位置之前的消息及其关联建议／变更记录，保留原选区，以新会话身份从该位置重新发送；旧后续、建议与撤回记录保留在原历史，已保存的笔记不会自动回滚。新请求使用当前可见服务、模型和当前规范，沿用原消息的对象及整库检索状态，不混入下一问的资料范围；原消息有选区时固定原来源并重新校验；失效选区禁止重发，须取消后重新选择。`switchAiConversation()` 成功保存原对话和新活动槽后才发出请求，写失败保留编辑草稿和原对话。编辑期间普通发送／重试禁用，现有建议调整、保存及切库锁继续生效。回归入口为 `chatActions.test.ts`、`session.test.ts`、`e2e/ai-chat-actions.spec.ts` 与浮窗 Edge 专项。

AI 回复与未归档的流式输出复用 `ResearchMarkdown`，支持 GFM、代码高亮与公式，沿用 HTML 跳过和链接校验；用户输入仍按原始文本显示。Markdown 包装使用独立界面字号，长代码与表格内部滚动。右侧大纲列表的样式仅作用于导航列表，不能覆盖对话里的有序列表或代码复制按钮。此变更不扩充 Agent 工具或资料读取范围。

`AiWorkspace` 为整个对话提供当前库的 `ResearchNoteLinkContext`，历史与流式回复共用稳定 ID 解析和当前标题。链接导航先校验 controller 最新快照、加载／切库和写入状态，再暂停中央跟随并使用 `ResearchNotebook` 的既有阅读入口；实际缺失目标保留禁用，不按名称回退。该视图上下文不进入 runner 或模型资料范围，切库由工作区稳定 ID 重建。

每轮以图标头像和 MeWiki 深色徽标开头，实际服务／模型放在徽标 tooltip；工具记录位于正文前，建议位于正文后。会话 v1 的助手消息可选 `activity: { tools, proposalIds }` 保存逐轮归属，建议实体和应用状态仍只有原会话数组一份。开始请求即追加助手占位消息，progress 同步正文和活动，确保工具尚未产出正文时也能正确归属完整建议；停止、刷新和关闭沿用既有代次与中断规则。恢复时活动数据独立校验、过滤未知和重复建议引用，坏活动不能丢弃有效消息；旧会话和历史裁剪后失去所属消息的建议保留在前方“历史建议”，不猜测归属。runner 继续只向模型发送角色与正文，不发送展示元数据。实施与回归见[逐轮答复设计](../plans/2026-11-12-ai-conversation-turns.md)、`session.test.ts` 和 `e2e/ai-conversation.spec.ts`。

切换大纲、反向链接或配方不改变悬浮聊天的显示或任务状态。折叠底栏仍挂载 `AiWorkspace`；气泡关闭时沿用 `dispose` 中止请求、拒绝迟到工具并保存中断会话，重新打开读取本库记录。来源点击只打开笔记，不主动关闭聊天。Escape 由内部菜单或中央审阅处理，浮窗阻断其向笔记 dialog 冒泡；普通外部点击不改变打开状态。此布局变更不修改工具契约、发送范围或资料保存规则。

## 中间差异审阅

[实现计划](../plans/2026-11-12-ai-change-review.md)。`ResearchNotebook` 在中间布局提供稳定的 `aiReviewHost`，`AiWorkspace` 通过 portal 显示 `AiProposalReview`。原阅读视图保持挂载；被覆盖的原正文使用 inert 隔离键盘及辅助技术，退出或卸载恢复。窄屏沿用正文列，侧栏、ribbon 与底栏保留交互，不被审阅批量禁用。预览选择绑定当前视图／活动内容位置，导航、切库、清空和关闭 AI 时结束。

`previewAiProposal` 和 `applyAiProposalGroup` 复用批准的纯转换与基线校验，使用当前 `session.changes` 衔接已批准的其他块修改，不调用 controller。`AiProposalReview` 将同一笔记的全部待审建议及当前草稿组合为整篇 before／after，共用 `AiNativeProposalReview`，顶部箭头只切不同业务目标；中央顶部批准整篇待审组，内容附近和悬浮聊天均可逐项处理。未改动块复用原生只读组件，删除时使用原始树保留嵌套位置，追加与新建使用转换后的原生块。公式 composer 在预览内自行提供定位容器，使复制按钮留在公式旁，不越过正文遮住审阅工具栏；悬停及键盘聚焦均可显示。旧建议基线失效时只回退生成时的快照供审阅，并保持错误及应用禁用；用户点击应用时再次 flush 和校验。

所有笔记建议与等待草稿的预览都不启用导出专用的 `ResearchReadOnlyContent.allTabs`。统一 renderer 复用 `ResearchExamples`，仅挂载单个活动页，标签栏通过 `renderTabTitle` 标记增删、改名、移动与含差异页；删除的页保留在预览的联合树中。默认选择由转换后／原始树的 `findResearchBlock(...).path` 及原生 `tabId`、新增 ID、移动容器生成，删除使用原路径。手动选择按库与业务目标保存在内存，同一笔记的实时增量、源码切换及任务结束保留；右侧每次显式选择携带新的 focusKey，重置选择并滚动到具体块或标签，不总找首处差异。`staticView` 避免回写原笔记的页签偏好；导出仍展开全部页。

`diff.ts` 先比较行，连续替换区整体按 grapheme 比较并投影回各行，避免重排换行后逐行错配。常规 LCS 及超网格时的有界 Myers 共用预算；长段落的稀疏修改保留中间相同文字，大型不相交区段仍退为完整删／增，两侧可精确重建。`aiDiffRanges` 给出 UTF-16 位置并保留被修改的换行；`TextDiff` 只为改变片段使用 del/ins，共同文字保持正常。

`RenderedTextDiff` 将两侧范围交给 `ResearchMarkdown` 的可选 `changes`。`researchMarkdownChanges.ts` 在 Markdown AST 上给文字叶片段添加临时标记，映射实体与转义的源码偏移，引用／公式／代码保持完整节点。结构改动通过原节点的 `data-ai-change` 表示，保留列表、表格合法层级和 GFM 任务属性；自定义 code、公式和表格渲染必须透传此标记。代码以侧边标记保留深色语法配色，结构表格标记传播至单元格，避免原生不透明背景遮挡。全局引用定义递归解析，改址也在引用入口可见；纯空白差异用相同解析器比较两侧原始结构，段落合并／拆分可见，普通软换行不整段标红。笔记原生／旧文字建议与可显示的词条字符串字段共用组件；专业记号和引用字段保持专用视图。差异、预览和恢复测试在 `src/ai/`；中央应用／撤回、嵌套、过期、只读、英文、窄屏和键盘检查在 `e2e/ai-workspace.spec.ts`。标记仅影响预览，不写笔记或会话。

## 原位置逐项决策与调整

[实施计划](../plans/2026-11-12-ai-inline-decisions.md)与[绿色区域编辑／左右对比](../plans/2026-11-14-ai-direct-review.md)。`reviewDecisions.ts` 将建议映射为块、标签页、属性或整页位置；旧追加项根据本次组合 effects 找到实际新增块。`renderComparison(location, before, after)` 将实际对照与 `AiInlineSuggestion` 绑定，同意／拒绝／调整插在两侧内容之间，绿色侧原位挂载编辑。多字段建议选第一个实际变化字段，标签容器自身字段保留 blockId；无变化字段仍保持唯一可操作对照，移动内容只在目标位置出现一组按钮。新建／删除笔记在整页新增／删除内容旁操作，不渲染空白编辑区。各项决策始终对应完整建议，不隐式拆分字段或行。

`reviseAiProposal` 复用原有字段 schema 和操作准备、批准校验，保留建议 ID、目标、原始 before 及生成 ID／时间；表单仅调整建议内容，删除和移动不开放编辑。正文复用渲染与现有引用编辑器，结构数据用字段表单，未经保留的输入仅在组件内。表单位于绿色侧，保存／取消以 form ID 关联中间操作组；Ctrl／⌘+Enter 保存、Escape 取消，失焦保留局部文字后恢复渲染。切换上下／左右布局只改根属性，不卸载编辑；源码与目标切换在编辑时禁用。保留调整只写本库会话，不调用笔记 controller；明确同意后才进入原批准保存流程，effects 支持刷新恢复及安全撤回。局部输入未保留时禁用整页应用，并把编辑状态传给 Workspace，同时锁定右侧该项的同意／拒绝和对应动作入口；局部组件卸载清除编辑状态。回归见 `e2e/ai-direct-review.spec.ts` 与原逐项审阅专项。

`TextDiff` 通过 `AiReviewPresentation` 保留由共同原文分隔的各个差异组，不因一项建议只有一组按钮就把所有删除和新增合成同一炮组。共同原文只显示一次，首个差异组放操作，每个绿色片段都可进入同一建议编辑；编辑期间在原位置显示完整原文／完整建议，保留或取消后回到逐组对照。`RenderedTextDiff` 继续按安全 Markdown 范围标记，不拆开公式、链接或其他完整单元。

会话 v1 可选 `rejectedIds` 独立保存拒绝状态，恢复时去重并过滤未知／已应用 ID；无效字段不使有效会话丢失。拒绝、恢复和调整均先持久化成功再发布，存储失败保留原建议和笔记。待审列表排除已应用与已拒绝项；中央逐项处理维持业务目标、手选标签和滚动，全部处理完才退出，不跳其他目标。只读、运行中、切库、保存错误与原文过期继续受限。

逐项批准或撤回后，仅对未处理建议调用 `rebaseAiReviewProposals`：以本次 controller 可信 before→after 转换为边界，先检查原建议在 before 上有效，仅在它要修改的字段／容器未被触及时更新其 before，再验证 after 上可应用。已应用项的 baseline 不变，重叠改写、此前手工编辑、目标删除仍保持冲突；不能在常规状态刷新中重基线。混合有效与冲突建议时，整页应用保持禁用，仅组合有效项展示差异，使独立项仍能在看到实际结果后单独批准；无法组合的预览禁止原位置批准／调整，仍可拒绝。回归在 `reviewDecisions.test.ts`、`review.test.ts` 与 `e2e/ai-inline-review.spec.ts`。

## 实时协作与渲染预览

[实施计划](../plans/2026-11-12-ai-live-rendered-review.md)。三协议传输沿用原解析器，`onTool({ key, name, arguments, reset? })` 提供工具参数增量；`key` 是请求内序号，`reset` 替换当前缓冲。本机 NDJSON 增加 `tool` 事件，保留 `text` / `done` / `error`。客户端限制事件结构、调用数和累计长度，取消后拒绝迟到事件。原始及 JSON 转义密钥采用跨分片保留窗口脱敏，最终完整调用仍独立校验。

`drafts.ts` 解析旧建议的受限顶层字符串，以及 `propose_edit` 的一层字符串 `fields`。action 与目标 ID 必须先闭合，已有词条必须指定 entryId；原生流式仅开放 block-update、note-update、symbol-save、term-save，数组、数字与复杂结构等待完整调用。目标通过共享 `assertNativeEditAccess` 后才构造纯投影，内容允许未闭合的末尾字符串。草稿不执行工具，不改变已读记录或正式建议。runner 用独立 `onDraft` 回调向界面投影，不能放进会被持久化的 `AiRunProgress` / `AiSession`。最终工具经原注册表执行后才发布正式建议；停止、失败、卸载及切库清草稿，不调用保存控制器。

`AiWorkspace` 在任务开始时自动显示中央预览，跟随最新草稿或完整建议；返回编辑、主动导航和选择旧建议暂停跟随，运行中眼睛图标恢复。界面使用任务代次、取消信号及稳定资料库身份拒绝迟到结果。草稿不能应用，完整建议也等任务结束后由用户按项批准，再走现有 controller。服务不提供参数增量时，仍在完整建议到达后展示。

`AiProposalReview` 默认原生渲染，普通文字与 Markdown 使用上方精细词句对比，专用非文字内容按原生前后视图展示；源码切换保留行号比较。`AiNativeProposalReview` 按嵌套子块、标签条目和词条字段展示原生差异，地图与关系显示可定位的笔记标题和块摘要；默认不显示 JSON。未修改内容复用原只读组件，纯预览阶段没有编辑与保存副作用。自动更新保留输入焦点与阅读滚动；窄屏工具栏可停止或返回。受控流 Edge 场景验证上游未完成时内容已渲染、草稿未持久化、暂停／恢复和中止。

### 文字大炮与激光呈现层

`AiTextCannon` 在运行中自动跟随，或用户主动回放完整建议的笔记渲染预览挂载，定位于中央滚动视口底部；错误、建议调整、词典、地图与源码视图不挂载。实时模式读取 `AiReviewLocation` 对应块／标签／字段中的已渲染差异，按 DOM 顺序逐组完成激光删除、文字炮弹新增，不修改 proposal、runner、controller 或会话。`aiTextCannon.ts` 管理视口几何、有界新增片段和完整 grapheme 删除偏移；用户文字只通过 `textContent` 放入装饰胶囊，不作为 HTML 执行。

本地分层 SVG 是唯一图形来源，内联后添加实例 ID 前缀。`carriage` 固定，`aim` 绕资源登记转轴转向，`barrel` 独立后坐，实际炮口从 `muzzle-origin.getScreenCTM()` 换算到覆盖层；不制作方向帧，不拉伸 M。原生 WAAPI 动画 transform／opacity，最少 320ms 合并发射，瞄准 160ms、飞行 260ms、后坐和落点 180ms。激光每个可视页扫描 180–1000ms，由 WAAPI 时间驱动逐 grapheme 的 Highlight 和光束位置，随后先定位下一页再继续；空白只推进偏移。光束从实际炮口发出，不给删除文字发炮弹。不可见、背向或过近的新增目标不发射；自动跟随和明确回放中的分屏定位使用预期 scrollTop 区分用户滚动。

`AiReviewPair` 为文本差异、原生字段／块及标签名提供旧／新两侧。普通对照使用 grid，根 `data-review-layout` 在上下和左右之间切换，中间可放操作组；仅标签名的 inline 对照保持 `display: contents`，整篇笔记和标签容器不复制。布局偏好独立保存在按库 `ai-review-layout:v1`，不进入会话或笔记。切换布局先停止回放；两种布局继续共用原差异范围和炮组。播放期间的 `data-cannon-phase` 只控制顺序与等待态字色，红绿行号／符号从首帧可见；不叠放、隐藏整侧或写入尺寸／位移变量。`aiCannonTextReveal.ts` 注册三类实例 Highlight：未命中的新增范围隐藏文字及底色，扫过的原文前缀显示红字／红底和删除线，命中的新增前缀同时显示绿字／绿底。扫描前原文保持正常字色，扫描后仍在上段供对照；下段不提前铺绿色空壳。停止、结束、失败及卸载还原属性和所有 Highlight，不替换 React 节点。`data-review-text-row` 排除整行兜底，只使用实际标记的文字变化，纯增不能扫描未改的原文，纯删不能把未改的新侧当成新增。

实时队列以 `cannonPair` 分组，`liveBusy`／`backlog` 串行完成每组删写，`Cue.batch` 只合并同组片段；激光／瞄准期间接收最新 DOM 和文字，删除期间新增拆分出的 `del` 也同步登记，避免重复擦除或卡在同一节点。已经命中的共同 grapheme 前缀保留。`cannonEraseSteps()` 不截断长删除；`cannonReplaySteps()` 返回折叠空白后的标签与原始 UTF-16 起止偏移，按段测量新增落点，末段显现完整余文。素材等待在 layout effect 中准备原文首帧；资源失败或不支持 Highlight 时完整显示普通审阅。此层不改变 proposal、保存时机或模型请求。

用户滚动清除旧轨迹和待发片段并恢复完整差异；父级自动定位通过 `followScrollRef` 区分，取消旧视口轨迹，保留当前与所有排队组的文字状态后重新测量。播放自身分屏定位只消费预期 scrollTop，不中断删除或瞄准。尺寸改变、页面隐藏、动态偏好切换与卸载清理计时器、WAAPI、激光 rAF 和文字范围，generation 阻止过时的帧继续转向；卸载同时移除三类 Highlight 注册、样式、观察者和监听器。装饰层 `aria-hidden` 且不接收指针。自动跟随在减少动态时移除转向、激光、后坐、飞行及文字等待，只保留落点透明度提示；用户明确点击回放则只为本次播放启用完整运动，不改变系统或持久偏好。维护见[红绿对照填入计划](../plans/2026-11-13-ai-cannon-diff-fill.md)、[激光调度计划](../plans/2026-11-13-ai-cannon-laser.md)、`aiTextCannon.test.ts` 与 `e2e/ai-text-cannon.spec.ts`。

回放由 `AiProposalReview` 的局部 `replayProposal` 控制，只在完整且有效的笔记渲染预览显示回放／停止按钮；只读权限仍可观看，保存权限不变。`cannonReplayTargets()` 按 DOM 顺序同时考虑新增及其原文范围，从视口内第一处开始；无可见改动时取下方最近处，全文末尾取上方最近处。跨越视口顶部的长范围二分查找当前可见行的文字偏移；两段保持原位，无需叠层补偿。第一组仅将当前行以前的原文前缀标为已扫描，后续删除完整分屏扫描；已经位于下段长新增中间时，屏外的上段标为已扫描，直接填入当前可见行，不能倒跳。`replayTargetsRef` 冻结起点和文字偏移，素材加载前后共用，`holdMany()` 重置原文与等待范围并一次绘制。

首次素材加载期间同样监听滚动、尺寸、页面可见性和动态偏好变化，用户干预立即恢复全文、结束局部回放并取消请求；场景就绪后交给原有监听，卸载一并移除。素材失败也调用 `onReplayEnd` 恢复普通回放按钮，不能留下“停止回放”的假播放状态或在资源迟到后跳回旧位置。

`setReplay()` 以 generator 按目标生成片段，不截取整次发射次数。每组第一次新增前先等待全部删除完成，纯删除组只扫描一次；下一步从实际飞行完成回调继续，不能让固定计时器越过暂停的激光或炮弹。每处新增标签仍最多 32 个 grapheme、至多 4 段，末段显现完整余文；不预先展开整篇字符串队列。回放从选定起点向后继续，不绕回开头，不录制原始流、不改变页签、不请求模型；结束保留观看空间。用户滚动、尺寸／可见性／偏好变化会停止；Escape 优先停止回放，建议身份变化、页签切换、调整或应用等沿父级状态卸载。回放状态不保存到会话或用户笔记，已有待审建议也可重演；见[完整覆盖与起点计划](../plans/2026-11-13-ai-cannon-replay-coverage.md)。

## 验证入口

Token 使用记录由 `usage.ts` 维护，会话 v1 增加可选 `usageHistory`，每条用户任务结束时写入一次，包含 runner 汇总的全部服务轮次；取消、失败和中断仅记录已经报告的非零用量，成功回复可记录零值。最多 100 条，按库保存并随清空重置，不加入模型消息或笔记。恢复校验仅丢弃无效统计，不能删除有效会话；旧会话只恢复最后一次统计，异常退出的 running 会话追加部分用量一次。`AiUsagePanel` 在底部通过图标展开，最新在前，最多五行，按历史区域的实际高度收缩并内部滚动，Escape 不关闭整个侧栏。专项在 `e2e/ai-usage.spec.ts`。

领域回归：`src/ai/*.test.ts`。传输、配置与实际 HTTP 取消：`server/ai*.test.ts`。Edge：`playwright.ai.config.ts` 与 `e2e/ai-workspace.spec.ts`，独立端口 5441、独立 `.mewiki/ai-e2e-*` 配置，所有笔记和 Key 均为虚构，禁止使用真实资料验收。

最终检查包括 `npm test`、`npm run lint`、`npm run build`、`npm run i18n:check` 以及相关设置和多库回归。假服务回归只证明本地契约与行为，真实服务兼容性由用户配置后的实际测试确认。没有用凭据测试过的供应商不得标记为已验证。

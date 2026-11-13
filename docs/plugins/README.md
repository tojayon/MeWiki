# MeWiki 插件开发入口

图片创作现与笔记导出共用 exporter 工作区：左侧画幅是唯一画布，支持共用/单图文字、贴纸、装饰图和设备编辑；模板保存共用样式，作品另外保存原图和逐图调整。此为宿主受限数据能力，不运行插件代码。先读[画布接口和保存边界](API_V2.md#宿主图片创作画布)及[使用手册](../wiki/20-social-export.md#在画幅内添加文字和贴纸)；没有新字段的旧请求继续兼容。

导出设置、正文选择与图片创作自动保留为当前浏览器的工作草稿，刷新与关闭重开可恢复。草稿按库、插件、导出器、笔记和入口隔离，不改个人模板、不隐式创建作品，也不扩展插件读取权限。维护入口为 `publicationDrafts.ts` / `usePublicationDraft.ts`，操作和备份边界见[自动保留设置](../wiki/20-social-export.md#自动保留本次设置)。

MeWiki 提供声明式内容插件 API v1、声明式图文导出 API v2，以及本地 JSON / ZIP 插件包安装、启停、升级和版本切换。随附 WebBench、社交图文导出与独立包共用清单和安装校验；核心按内容或导出贡献处理，不按插件品牌分支。

可执行代码、通用编辑器命令与面板、导入器和在线社区目录仍按[阶段路线](../plans/2026-11-10-plugin-ecosystem.md)推进。图文导出已经以数据贡献实现，不依赖第三方代码执行。[生态设计](ARCHITECTURE.md)中的其他部分继续属于后续设计，实际字段以 [API v1](API_V1.md)、[API v2](API_V2.md)和本文为准。

## 选择契约

- 创建外部内容卡片、填写表单、连接本机目录或定位外部来源：使用 [API v1](API_V1.md)，示例为 `examples/plugins/measurement/`。
- 创建可调整的图文模板与画幅：使用 [API v2](API_V2.md)，示例为 `examples/plugins/publication/`。模板不读取整库，不提供脚本、HTML 或 CSS，排版与下载由核心处理。

官方“社交图文导出”默认使用与前端共用只读内容组件和 CSS 的“MeWiki 原生”模板，保留标题编号、引用图标、Callout、标签页和静态媒体卡片。构建自动收集组件样式，更新后重新生成即可同步。独立插件也可按 [API v2](API_V2.md) 声明 `style: "document"` 引用同一正文。使用步骤及样式同步范围见[使用手册](../wiki/20-social-export.md)。个人模板 JSON 从导出窗口导入，插件 JSON / ZIP 从插件管理页安装，两种文件用途不同。

导出工作区默认显示虚构样板并随参数更新；中间可切换到完整原文勾选内容与分页，或查看生成后的真实图片。左侧优先选择比例和清晰度，精确尺寸收在高级设置。样板与正式输出共用核心静态排版，不调用生成任务，不改变现有清单或个人模板格式。

左侧设置分为可独立折叠的“内容、画幅、样式”：内容包含标题、封面与作者信息及正文选择入口；画幅设置卡片规格；样式包含字体、配色和封面图片。分类采用全宽、文字靠右的原生折叠条栏，折叠保留当前配置。

“内容”也可切换到图片导出：中间从冻结笔记的图片块、Markdown、标签页和同库内容引用选择图片，或一次添加多个本地文件。每张分别一张成品，共用当前模板与设备，支持完整显示、独立取景和 ZIP。个人模板只保存模式与共用样式，本次原图和逐图裁切留在会话内。宿主按现有预算串行生成，不新增插件贡献类型；详见 [API v2](API_V2.md#宿主服务与限制)与[操作手册](../wiki/20-social-export.md#导出单张或批量图片)。

## 做一个独立插件

1. 将[测量记录示例](../../examples/plugins/measurement/README.md)的目录复制到自己的仓库，修改 `manifest.json` 中的稳定 `id`、名称、版本、内容结构、表单和视图。
2. 在 MeWiki 项目根目录使用随项目提供的作者工具校验、打包，不需要修改注册表或导入内部 React 组件：

   ```sh
   npm run plugin:validate -- examples/plugins/measurement/manifest.json
   npm run plugin:pack -- examples/plugins/measurement .mewiki/measurement.mewiki-plugin
   ```

   路径可替换为自己的插件目录。输出父目录需已存在，工具拒绝覆盖已有文件。需要 Node.js 22.13 或更新的受支持版本及本项目依赖；工具不会安装插件依赖或执行插件代码。
3. 打开“设置 → 插件与集成”，选择 JSON 清单或打包后的 `.mewiki-plugin` / `.zip` 文件。检查预览中的来源、ID、版本、SHA-256 和能力，确认安装后再点击“启用”。
4. 返回笔记进入编辑模式，在内容插入菜单中选择插件声明的入口，填写字段后确认。停用或卸载后，标题、摘要、备注与原始数据继续保存。
5. 发布时提供清单或包文件、版本说明和来源程序的要求。当前手动下载并从文件安装；没有自动更新或在线发现入口。包自报的 ID 前缀不代表官方身份。

示例只生成测量卡片，不启动测量程序。打开来源需要用户另行运行相应服务。纯本地表单和视图插件可以声明空 `capabilities`，不提供 `source`；填写、保存和阅读均可离线完成。

## 两种公开契约

**插件作者**使用数据形式的 [API v1](API_V1.md)或 [API v2](API_V2.md)。公开类型为 `src/plugins/sdk/types.ts`，清单解析器是 `manifest.ts`，内容执行逻辑是 `runtime.ts`，导出贡献校验为 `exportTypes.ts`。作者交付 JSON，无需在自己的包中导入仓库内部路径。每个插件的 provider 就是清单 `id`，最多提供 16 个独立内容类型；v2 还可提供最多 16 个导出贡献，并允许纯导出插件不声明内容类型。

**外部程序作者**使用[宿主 SDK](../integrations/README.md)，提供临时上下文并响应用户点击后的来源定位。实现仍是 `public/integration/mewiki-host.js` 与同名 `.d.ts`，宿主通信继续使用 v1。宿主不能读取笔记或自动插入内容；安装插件也不赋予它这些权限。

清单版本 `manifestVersion`、插件 API 版本 `apiVersion`、插件包实现 `version`、宿主通信版本和每种内容的 `schemaVersion` 分别管理。API v1 使用精确整数版本，不接受未实现的 `engines`、`runtime`、`permissions`、`contributes` 或可执行入口字段。

## 安装、状态与资料

- 包由本地服务保存，默认位于 `.mewiki/plugins/`。设置 `MEWIKI_RESEARCH_SETTINGS` 时默认改为 `<设置文件绝对路径>.plugins`，可通过 `MEWIKI_PLUGIN_DIRECTORY` 明确指定。开发和浏览器检查必须使用独立设置及插件目录。
- `registry.json` 登记当前版本及包摘要；`packages/<SHA-256>.bin` 保存通过校验的原始包。按摘要定位，不按插件提供的文件路径读取。跨进程操作通过锁串行执行，登记采用原子替换；读取时复验摘要和清单身份。
- 同一 ID、同一版本的不同字节拒绝覆盖；完全相同的包可重复安装。安装新版本保留旧包以便切换。安装失败保留旧版本及启停状态；安装成功或切换版本后需重新启用。不自动迁移笔记或修改内容版本。
- 随附插件来自 `plugins/*/manifest.json`，与本地包使用同一个解析器和执行器。本地包不能覆盖已随附的 ID；新的独立插件不需要改核心源码。随附插件版本随应用更新。
- 启停沿用浏览器来源内的 `mewiki:plugins:v1`。`available` 表示没有启停记录，`enabled` / `disabled` 表示启用 / 停用；本地包已安装但没有记录时显示“已安装，未启用”。同一来源中的窗口同步启停和安装变化，不同端口或浏览器配置不共用偏好。
- 连接偏好使用 `mewiki:plugins:<完整插件 ID>:connection:v1`；已有 WebBench 短键仅作为声明的旧别名读取。安装器拒绝与其他插件相冲突的旧别名。
- 卡片、备注和未知 JSON 保存在所属资料库。停用、卸载、升级和回滚均不删除这些内容，资料备份也不会自动携带插件包或启用授权。未知类型或版本显示通用卡片，保留完整数据。
- 个人导出模板按 `(libraryId, pluginId)` 由本地服务持久保存，默认位于 `.mewiki/export-profiles/`，隔离配置使用 `<设置文件>.export-profiles`。卸载保留模板；模板 JSON 自带样式、内联作者图片与所用字体，需要独立导出备份，不能误认为已包含在资料库备份中。用户字体原件属于资料库附件，完整 ZIP 与目录迁移会携带；字体设置由宿主提供，不新增插件清单字段或读取权限。

## 核心实现导航

| 位置 | 职责 |
| --- | --- |
| `src/plugins/sdk/` | 公共清单类型、校验、受限字段映射、内容校验与来源 URL |
| `plugins/webbench/manifest.json` | WebBench 随附清单，保留 provider、内容 v1、回放目录与连接偏好 |
| `plugins/social-export/manifest.json`、`sdk/exportTypes.ts` | 随附图文导出清单、模板与预设校验 |
| `src/plugins/bundled.ts`、`registry.ts` | 随附清单发现、统一注册、重复 ID 与旧状态兼容 |
| `PluginContentPicker.tsx`、`PluginContentView.tsx` | 通用表单、可取消目录查询、只读文本字段视图 |
| `src/integrations/IntegrationProvider.tsx` | 插件目录与启停、临时宿主上下文、按内容类型插入及来源打开 |
| `server/pluginPackageArchive.ts`、`pluginPackageStore.ts` | JSON / ZIP 限制、摘要、不可变版本、锁与原子登记 |
| `server/pluginPackagePlugin.ts`、`src/plugins/packageClient.ts` | 本机包管理 API、客户端和窗口变更通知 |
| `scripts/plugin-tools.mjs`、`examples/plugins/measurement/` | 作者校验与打包、独立示例 |
| `PublicationDialog.tsx`、`src/domain/publication*.ts` | 固定内容快照、图文参数与预览下载 |
| `PublicationReadingSurface.tsx`、`src/state/publicationDomCapture.ts`、`ResearchContentLibraryContext.ts` | 共用只读组件、无写入会话的资源上下文、受限 DOM 与静态媒体捕获 |
| `src/styles/documentTheme.ts`、`src/domain/publicationTheme.ts` | 前端与原生导出共用的静态正文样式、模板默认参数 |
| `server/publicationStyles.ts` | 自动聚合全部构建 CSS，让正文组件样式同步进入原生输出 |
| `server/publication*.ts`、`exportProfileStore.ts` | 本地 Edge 静态排版、任务取消、按库个人模板 |
| `src/domain/researchFonts.ts`、`src/state/userFonts.ts` | 用户字体校验、按库持久保存、加载与下载，供宿主导出使用 |

修改选择流程时，继续使用编辑器现有的插入请求与锚点复验。取消、切库、切笔记、退出编辑、停用、卸载或更换版本都应中止旧选择，迟到响应不能写入新现场。来源只在用户点击时打开；查询服务不提供资料写入能力。

## 验证入口

```sh
npm test -- src/plugins src/integrations server/pluginPackageStore.test.ts server/pluginPackageArchive.test.ts server/pluginPackagePlugin.test.ts server/pluginTools.test.ts src/state/researchLibraryCatalog.test.ts
npm run check
npm run test:e2e -- e2e/plugin-packages.spec.ts e2e/plugin-insertion.spec.ts e2e/multiple-libraries.spec.ts e2e/i18n.spec.ts e2e/settings.spec.ts e2e/mewiki.spec.ts
```

检查独立包安装、同版本冲突、新版与回滚、卸载内容保留、多内容类型和能力提示；同时检查 WebBench 独立 / 内嵌流程、取消、跨窗口停用和资料库入口。导出增加 API v2 清单、范围快照、真实图片像素与分页、个人模板迁移和多库隔离检查，入口为 `exportManifest.test.ts`、`publication*.test.ts`、`exportProfiles.test.ts`、`exportProfileStore.test.ts` 和 `e2e/social-export.spec.ts`。网络使用虚构服务响应，不连接真实实验或日常资料。资料格式及附件有变化时再补对应往返检查。

本机端口、隔离设置和正式服务重启规则见 [AI 接手指南](../AI_HANDOFF.md)；每轮实际结果记录在[验收说明](../VERIFICATION.md)。

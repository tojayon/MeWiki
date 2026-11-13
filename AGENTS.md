# MeWiki

- 使用简体中文沟通，产品名为 MeWiki。
- 本项目为独立的本地 Wiki 文档编辑管理应用。源码、资源和依赖保留在本目录，禁止引用原 WebBench 或论文目录。
- 核心工作区为基础理论、研究记录、符号词典和理论地图。默认种子只包含手册和通用示例。
- `docs/wiki/` 是完整手册的单一来源；应用首次启动从同一文件集合生成手册笔记。每完成一项新功能或用户可见行为变更，必须同步完善相关使用手册、示例和必要的操作说明，并将手册更新纳入完成验收。
- 本地运行绑定 `127.0.0.1`。资料库目录由用户配置，服务设置在 `.mewiki/`，不要读写真实资料作测试。
- 已有资料协议、稳定标识、校验与迁移需要保持兼容。保留 `webbench-research-library` 等资料格式名；应用缓存和配置使用 MeWiki 命名空间。
- 所有字体、PDF 和图形渲染资源本地打包，不使用运行时 CDN。
- 浅色界面、深色文字、蓝红橙点缀，圆角 4px，顶部工具栏单行 44px。空间不足时收纳工具，左右侧栏开关始终在外。
- UI 开发遵循 “Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.”：用布局、分组和控件状态表达关系，去掉重复的次级标签与说明，保留必要字段名、无障碍名称及错误状态。具体见 [UI 开发规范](docs/UI_GUIDELINES.md)。
- 所有弹窗和面板使用均匀的中性细边框，不添加顶部蓝色装饰线；工具栏采用纯图标按钮，弹出功能菜单采用左图标、右文字。原生控件使用浏览器自身的交互和键盘焦点反馈，不额外添加蓝色描边、偏移外框、边框变色或描边阴影；自定义选择控件避免重复叠加边框。
- 改动后运行 `npm test`、`npm run lint`、`npm run build` 及相关 Edge 浏览器检查。不要手动编辑 dist、node_modules 或测试产物。
- 正式服务代码更新后需要重新构建并重启 MeWiki 本地服务。不要为旧服务添加兼容请求。
- 不自动提交或覆盖现有用户资料。
- 多资料库通过稳定 ID 固定窗口身份；笔记、符号、附件、缓存、pending 恢复与历史按库隔离。旧 default 配置与缓存继续兼容，不自动复制、移动或混合资料；从列表移除仅取消登记。WebBench 与独立入口分别记忆选择，宿主继续只传临时上下文。
- 本项目是笔记功能的唯一维护来源。WebBench 等宿主只维护嵌入容器和自身数据适配，不复制编辑器、资料库或插件源码。
- 开放协议位于 `public/integration/mewiki-host.js`，外部内容与插件位于 `src/integrations/`、`src/plugins/`。改动保持 v1 协议、未知插件数据、旧 evidence 及资料交换格式兼容，同步 `docs/integrations/README.md`。
- 插件停用或卸载不得删除用户内容。外部程序只能提供临时上下文；插入笔记和打开来源由用户明确操作触发。
- Agent 与核心功能同步维护：内容类型、资料结构、领域操作、权限或保存流程改变时，检查 `src/ai/` 的可读投影、工具注册表、建议与撤回，并同步相邻测试和 `docs/wiki/22-ai-workspace.md`。工具未接入的能力不得在提示词宣称可用；AI 修改仍经用户审阅和现有 controller 保存。维护入口为 `docs/ai/ARCHITECTURE.md`。

## 开发接续入口

- 接手先读 [AI 接手指南](docs/AI_HANDOFF.md)与[开发说明](docs/DEVELOPMENT.md)，检查当前工作区和相邻测试，保留已有修改。
- 插件工作从 [当前开发入口](docs/plugins/README.md)、[内容 API v1](docs/plugins/API_V1.md)与[图文导出 API v2](docs/plugins/API_V2.md)进入；本地声明式安装、内容和数据导出接口已实现。[生态设计](docs/plugins/ARCHITECTURE.md)和[阶段路线](docs/plans/2026-11-10-plugin-ecosystem.md)中的可执行运行环境、通用编辑器贡献点与社区目录仍待实现。随附插件与社区包共用清单和执行器，禁止重新增加品牌分支。

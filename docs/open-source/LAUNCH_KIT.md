# GitHub 首发文案草稿

源码仓库为 [tojayon/MeWiki](https://github.com/tojayon/MeWiki)。本文件的项目介绍可用于源码仓库；Release 部分仍是未来版本的文案草稿，待确定版本与实际分发内容后使用，目前没有二进制下载。

## 仓库名称与 About

仓库名：`MeWiki`，所有者：`tojayon`。

中文描述：

> 本地优先的 Wiki 文档与知识管理工具，支持符号词典、可视化公式、内容同步引用、多资料库、媒体和开放插件接口。

英文描述：

> A local-first wiki for connected notes, mathematical notation, live block references, media, and separate knowledge libraries.

建议 Topics：`wiki`、`knowledge-management`、`local-first`、`note-taking`、`latex`、`markdown`、`react`、`typescript`。

## 中文项目介绍

MeWiki 将页面编辑、数学符号和参考资料放进同一个本地知识库。它既可以整理日常技术文档，也适合需要解释变量、记录公式来源和关联研究材料的笔记。

在一篇笔记里，可以直接引用另一篇笔记的多个段落、公式或图片。引用位置展示来源的最新内容；修改一次，相关页面随之更新。选择来源时使用标签分类表格，右侧保留原笔记的阅读样式，方便定位和勾选。

应用支持可视化公式与 LaTeX、PDF、文献 DOI、媒体、数据图表、流程图和多资料库，并提供外部程序接入接口。资料保存在浏览器或用户指定的本地目录。首次启动附带完整中文手册与通用示例。

## 英文项目介绍

MeWiki is a local-first wiki that brings together connected pages, mathematical notation, and reference material. Define symbols, edit formulas visually or with LaTeX, attach PDFs and media, and organize separate libraries with hierarchical tags.

Reference selected paragraphs, formulas, or images from another page without keeping a disconnected copy. The source selector renders the original content for reading and selection, while references follow later source updates.

MeWiki also includes DOI metadata lookup, datasets, charts, diagrams, backups with attachments, and a versioned host integration API. The interface and complete user manual are currently in Simplified Chinese.

## 首次 Release 草稿

标题：`MeWiki 首次公开预览`。发布前加上确定的版本号。

MeWiki 是一套在本机运行的 Wiki 文档编辑与知识管理工具。这次预览包含：

- 页面、层级标签、符号词典与可视化公式。
- 多块内容同步引用、反向链接和多面板阅读。
- 图片、音频、视频、PDF、附件、DOI、数据图表与流程图。
- 多资料库、本地目录保存、历史及含附件备份。
- 开放集成接口和可选 WebBench 回放插件。
- 完整中文使用手册与通用示例。

**开始使用**：安装 Node.js 22.13 或更新的受支持版本，在源码目录运行 `npm ci`、`npm run build`、`npm start`，打开 `http://127.0.0.1:5280`。Windows 可以使用 `Start-MeWiki.bat`。源码见[GitHub 仓库](https://github.com/tojayon/MeWiki)，操作说明见[完整手册](../wiki/README.md)。

**保存资料**：长期使用建议配置本地资料库。迁移或更新前导出含附件备份；JSON 与纯 Markdown 不包含附件原件。

**当前范围**：本机单用户应用；无云同步、账户或多人实时协作。Windows 与 Edge 为当前主要验证环境，其他平台的支持情况按实际验收填写。WebBench 插件的真实回放操作需要另行启动相应服务。

**许可**：MeWiki 自有代码和文档采用 MIT，第三方组件遵循各自许可。发布时保留 LICENSE 与第三方声明。

反馈问题请附版本、浏览器和最短复现步骤。使用虚构资料和已脱敏截图；安全问题按仓库的私密报告流程提交。

## 展示素材

| 文件 | 用途 |
| --- | --- |
| `docs/assets/workspace.png` | 项目首页，展示内置手册、分类和工作区 |
| `docs/assets/content-reference.png` | 展示渲染后的内容选择、多个块和标签页 |
| `public/mewiki.svg` | 仓库与应用图标原稿 |

展示图来自隔离测试中的通用示例，不包含个人研究笔记。后续可补公式编辑、资料库切换与插件演示的短视频；尚未录制时不要附演示链接。

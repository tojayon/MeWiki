# MeWiki 开源材料

源码仓库为 [tojayon/MeWiki](https://github.com/tojayon/MeWiki)，MeWiki 自有源码和文档采用 MIT。首次提交仅提供源码、手册、通用示例和必要的项目材料，没有创建 GitHub Release，也不包含构建包或安装器。范围与验收见[首次源码提交说明](SOURCE_PUBLICATION.md)。

## 材料入口

| 材料 | 入口 |
| --- | --- |
| 中文项目首页与安装说明 | [README](../../README.md) |
| 英文简明介绍 | [English overview](../../README.en.md) |
| 用户操作手册 | [Wiki 目录](../wiki/README.md) |
| 开发接入与公共组件 | [开发说明](../DEVELOPMENT.md)、[开放接口](../integrations/README.md) |
| 贡献与问题反馈 | [贡献指南](../../CONTRIBUTING.md)、[Issue 表单](../../.github/ISSUE_TEMPLATE/bug_report.yml)、[功能建议](../../.github/ISSUE_TEMPLATE/feature_request.yml) |
| PR 提交说明 | [PR 模板](../../.github/pull_request_template.md) |
| 安全问题报告 | [安全说明](../../SECURITY.md) |
| 项目许可与第三方组件 | [MIT](../../LICENSE)、[第三方声明](../../THIRD_PARTY_NOTICES.md) |
| 第三方待核对项 | [核对记录](DEPENDENCY_REVIEW.md) |
| 变更与后续方向 | [变更记录](../../CHANGELOG.md)、[发展计划](../ROADMAP.md) |
| 对外介绍与未来 Release 文案 | [文案草稿](LAUNCH_KIT.md) |
| 源码提交及后续发行核对 | [检查清单](RELEASE_CHECKLIST.md) |

界面展示图位于 `docs/assets/`，只使用内置或虚构的通用示例。研究种子与自动内容升级已清理，具体见[源码清理记录](SOURCE_CLEANUP.md)。安全问题通过已启用的 GitHub 私密报告入口提交。

## 后续工作

Windows 与 Edge 的干净安装和完整回归已完成；非 Windows 实机验收、GitHub CI、版本化 Release 和二进制分发许可核对继续按[检查清单](RELEASE_CHECKLIST.md)推进。

Wiki 以 `docs/wiki/` 为单一来源。已有资料库中的手册页面保留用户编辑，不会被程序更新覆盖；需要最新版时查看原稿或导入对应章节。

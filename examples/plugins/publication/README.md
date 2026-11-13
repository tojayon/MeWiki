# 独立发布模板示例

本示例使用 MeWiki 插件 API v2 的声明式导出贡献。它只提供配色、字体、字号、行距和画幅，选定内容的读取、排版、图片生成与下载由宿主完成；没有脚本入口、网络请求或资料库扫描权限。

在 MeWiki 项目目录校验和打包：

```sh
npm run plugin:validate -- examples/plugins/publication/manifest.json
npm run plugin:pack -- examples/plugins/publication .mewiki/publication.mewiki-plugin
```

通过“设置 → 插件与集成”安装并启用，随后从笔记的图文导出入口选择“示例知识卡片”。输出文件父目录须已存在，作者工具不覆盖已有文件。

可以复制本目录到自己的仓库，修改插件 ID、名称与版本。模板颜色只接受六位十六进制颜色，字体只支持本地的 `sans` / `serif`；不能添加 HTML、CSS、JavaScript 或远程资源。清单不提供正文和作者资料，用户在自己的资料库中选择内容并设置署名。

API v1 内容插件继续使用原契约；导出贡献使用 `manifestVersion: 2` 和 `apiVersion: 2`，不要向 v1 清单追加 `exporters` 字段。

# 手册演示原件

本目录的 PNG、WAV、WebM、PDF 和 CSV 均由 MeWiki 项目生成，按项目许可证提供，只包含通用图形、合成轻音、柱形动画和虚构数据，不引用用户资料或外部媒体。

`manifest.json` 保存每份原件的 SHA-256、大小和媒体类型。手册通过稳定哈希引用原件；运行时先核验文件，浏览器查看与本地资料库备份均可离线完成。

需要重新生成时，在项目根目录运行 `node scripts/generate-manual-assets.mjs`。生成过程使用项目内的 Sharp、Playwright 和本机 Edge，不需要下载素材；生成视频的字节可能随 Edge 版本变化，更新后应一起检查清单、单测和浏览器展示。

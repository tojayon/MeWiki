# 第三方声明

MeWiki 自有源码和文档采用 [MIT](LICENSE)。依赖、字体、原生库与解码组件保留各自的版权和许可证，不能统一改称 MIT。

此清单由当前 `package-lock.json` 和已安装依赖生成。再生成：`node scripts/generate-third-party-notices.mjs`；核对生成结果：`node scripts/generate-third-party-notices.mjs --check`。不同系统安装的可选二进制包不同；在拟分发的平台重新收集并审阅声明。

## 范围

- 锁定依赖安装位置：**397**；直接运行依赖：**25**；直接开发依赖：**15**。
- 本机已安装位置：**320**；归档声明文件：**333**。
- 锁定但本机未安装的位置：**77**，这些位置未收集声明原文。
- 许可证字段需人工核对：**1**；已安装但未找到根目录声明文件的位置：**5**，均详见完整清单。

[完整依赖清单](docs/open-source/dependency-licenses.json)记录精确版本、依赖位置、运行/开发范围、安装情况和声明文件名；[已收集的声明原文](docs/licenses/THIRD_PARTY_LICENSES.txt)逐份保留当前安装包的文本。这是发布审阅材料，尚未构成完整的二进制分发许可核验。

## 直接依赖

| 包 | 锁定版本 | 用途范围 | 许可证字段 |
| --- | --- | --- | --- |
| @dagrejs/dagre | 3.1.3 | 运行 | MIT |
| @noble/hashes | 2.4.0 | 运行 | MIT |
| @playwright/test | 1.64.1 | 开发 | Apache-2.0 |
| @types/katex | 0.16.8 | 开发 | MIT |
| @types/mdast | 4.0.4 | 开发 | MIT |
| @types/node | 24.19.2 | 开发 | MIT |
| @types/react | 19.3.0 | 开发 | MIT |
| @types/react-dom | 19.3.0 | 开发 | MIT |
| @types/yauzl | 3.4.0 | 开发 | MIT |
| @types/yazl | 3.3.1 | 开发 | MIT |
| @vitejs/plugin-react | 6.1.2 | 开发 | MIT |
| @xyflow/react | 12.12.1 | 运行 | MIT |
| @zip.js/zip.js | 2.24.0 | 运行 | BSD-3-Clause |
| ajv | 8.20.0 | 运行 | MIT |
| fake-indexeddb | 6.2.7 | 开发 | Apache-2.0 |
| fflate | 0.8.3 | 运行 | MIT |
| highlight.js | 11.12.0 | 运行 | BSD-3-Clause |
| katex | 0.19.0 | 运行 | MIT |
| lucide-react | 1.58.0 | 运行 | ISC |
| mermaid | 12.3.0 | 运行 | MIT |
| oxlint | 1.88.0 | 开发 | MIT |
| parse5 | 8.1.1 | 运行 | MIT |
| pdfjs-dist | 6.5.438 | 运行 | Apache-2.0 |
| prettier | 3.9.10 | 开发 | MIT |
| react | 19.3.1 | 运行 | MIT |
| react-dom | 19.3.1 | 运行 | MIT |
| react-markdown | 10.1.0 | 运行 | MIT |
| read-excel-file | 9.3.14 | 运行 | MIT |
| rehype-highlight | 7.0.2 | 运行 | MIT |
| remark-gfm | 4.0.1 | 运行 | MIT |
| remark-math | 6.0.0 | 运行 | MIT |
| remark-parse | 11.0.0 | 运行 | MIT |
| sharp | 0.35.5 | 运行 | Apache-2.0 |
| typescript | 6.0.3 | 开发 | Apache-2.0 |
| unified | 11.0.5 | 运行 | MIT |
| vite | 8.3.4 | 开发 | MIT |
| vitest | 5.0.5 | 开发 | MIT |
| yaml | 2.9.1 | 运行 | ISC |
| yauzl | 3.4.0 | 运行 | MIT |
| yazl | 3.3.1 | 运行 | MIT |

## 随界面打包的资源

- **KaTeX**：数学排版、字体与样式来自对应安装包，保留其 MIT 声明。
- **PDF.js**：脚本使用其包许可证；字形映射、标准字体、色彩配置及 WASM 解码器另有声明。构建插件复制各资源目录时会保留目录内的许可证文件。
- **Liberation 标准字体**：当前安装包的 `standard_fonts/LICENSE_LIBERATION` 包含 GPL-2.0 及字体例外条款，不能仅凭 PDF.js 包的 Apache-2.0 标签判断全部资源。若分发构建产物，需按该原文核对字体原件及对应来源的要求。
- **PDF WASM 组件**：归档包含 JBIG2、OpenJPEG、QCMS、QuickJS 及 PDF.js 包装组件各自的声明，需按拟发布资源逐项核对。
- **sharp / libvips**：sharp 的包许可证与其预构建二进制中的底层组件不同。当前清单记录锁定包与可见声明；随安装器、`node_modules` 或二进制归档分发时，还需核对 libvips 及其组件许可、版权和所需来源材料。

当前公共图标为本仓库中的 `public/mewiki.svg`；宣传截图仅使用通用示例。用户自己导入的图片、论文、媒体与引用内容不由 MeWiki 的 MIT 许可重新授权。

## 发布时保留什么

源码发布保留本文件、项目 LICENSE、锁文件与已整理的第三方声明。构建包或安装器还需携带实际包含组件的许可证与版权声明；不要从 `dist/pdfjs/` 中删除 LICENSE 文件。发布前步骤见[发布清单](docs/open-source/RELEASE_CHECKLIST.md)。

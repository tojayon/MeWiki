# 内容类型展示

这是一篇可以直接阅读和操作的内容样本。文字、数学公式、表格、图表、媒体和引用都使用 MeWiki 实际的内容块渲染；可以从右侧大纲跳到感兴趣的部分，也可以切换标签页、播放媒体、放大图片和翻阅 PDF。

全部数据均为通用演示。图片、两秒轻音、短视频、两页 PDF 和 CSV 随应用提供，查看本页不需要连接外网。音视频默认暂停，点击播放后才会发声或开始播放。

想尝试修改时，可以复制本篇后进入编辑模式。点击下方粗体或标题，只出现光标，原有字重、字号和布局保留；例如在“粗体用于重点”中间插入文字，再移开焦点，格式仍然保留。插入方法见[正文与内容块](04-content-blocks.md)，完整功能说明见[手册目录](README.md)。已有资料库点击“使用手册”即可补齐本篇，已经修改过的手册内容会保留。

## 文字与行内内容

这是一段普通正文。**粗体用于重点**，*斜体用于补充*，~~删除线用于标记旧说法~~，`行内代码`保留字面值。中文、English、数字 0123456789 和标点可以混合排版。

行内数学可以嵌入同一句话：输入 $x$，输出 $y$，线性关系为 $y=2x+1$。上下角标 $x_i^2$、分数 $\frac{a}{b}$ 和希腊字母 $\alpha+\beta$ 也会直接排版。与当前词典匹配的符号可以点击查看解释；插入符号引用后，点击相邻正文进入编辑，符号字号与整句间距保持一致。滚动到本段再点击公式前后的普通文字，光标出现在点击位置，页面与相邻段落保持原位；移开焦点后仍使用相同间距。

内部链接：[公式编辑](06-formulas.md)和[符号与术语词典](05-symbol-dictionary.md)。外部链接：[MeWiki 项目主页](https://github.com/tojayon/MeWiki)；只有主动点击外链时才会打开网站。附件链接：[下载本页演示 CSV](webbench-asset:manual:showcase-data.csv)。

术语和符号的稳定引用保留当前资料库的词条身份。在编辑模式输入 `#` 选择自己的术语，输入 `$` 或 `￥` 选择符号；术语可以选择规范全称、英文名称、缩写或某个别名。插入后直接点击术语或符号即可查看详情，所在段落保持原排版；点击相邻正文关闭详情并继续输入，页面停留在当前位置。修改本次引用时，在文字编辑器内聚焦引用或将光标移到它旁边，再按 F2。使用方法见[链接与引用阅读](07-links-and-references.md)。

脚注示例：演示数据只用于比较渲染效果，不作为研究结论。[^showcase]

[^showcase]: 这条脚注和正文保存在同一 Markdown 内容块内，展示脚注标记及其说明的排版。

## 六级标题

以下依次展示一至六级标题。它们都可以出现在右侧大纲中；日常写作通常只需要其中几级。

# 一级标题示例

一级标题下的正文。

## 二级标题示例

二级标题下的正文。

### 三级标题示例

三级标题下的正文。

#### 四级标题示例

四级标题下的正文。

##### 五级标题示例

五级标题下的正文。

###### 六级标题示例

六级标题下的正文。

## 列表、引用与分隔线

- 无序列表：记录一个概念。
- 无序列表：补充一个例子，支持**重点**和行内数学 $x+1$。
- 无序列表：链接到[常用操作](17-shortcuts.md)。

1. 有序列表：明确问题。
2. 有序列表：整理条件。
3. 有序列表：记录结论。

- [x] 已完成：检查标题与正文。
- [x] 已完成：查看表格和公式。
- [ ] 待尝试：在副本中插入自己的内容。

> 引用块适合引用一段观点或原文。
>
> 这里可以包含**强调**、链接以及公式 $y=2x+1$，并保留分段。

下面是一条分隔线，用于区分相邻的内容。

---

## 代码与表格

代码块采用近黑色终端背景、浅色文字和本地彩色语法高亮，语言栏右侧可复制原文；下面的代码只作为文档展示。表格使用深墨蓝表头、明亮标题文字与白色正文，导出时即使设置纹理背景也能保持清晰。可从本页打开图文导出，对照样式预览与生成图片。

```typescript
type Observation = { x: number; y: number };

const observations: Observation[] = [0, 1, 2, 3].map(x => ({
  x,
  y: 2 * x + 1,
}));

console.table(observations);
```

| 内容 | 左对齐的说明 | 居中的状态 | 右对齐的数值 |
| :--- | :--- | :---: | ---: |
| 正文 | 支持**强调**和链接 | 已展示 | 1 |
| 数学 | 行内公式 $x_i^2$ | 已展示 | 2 |
| 表格 | 单元格可以编辑 | 待尝试 | 3.50 |

## 提示块

```mewiki-block
{
  "id": "manual-showcase:callout",
  "type": "callout",
  "title": "阅读提示",
  "text": "本页的图表和附件均为虚构演示。**点击图片可以放大**，音视频需手动播放；在副本中可以修改每一种内容块。",
  "appearance": { "labelBackground": "#153b6d", "labelColor": "#ffffff", "borderColor": "#224f82", "borderStyle": "solid", "borderWidth": 1 }
}
```

## 标签页容器

点击“定义”与“代入”切换内容。两个页签保存在同一个容器中，可以分别添加文字、公式和其他内容块。

```mewiki-block
{
  "id": "manual-showcase:tabs",
  "type": "examples",
  "title": "同一个关系的两种表达",
  "tabs": [
    { "id": "manual-showcase:tab-definition", "title": "定义", "blocks": [
      { "id": "manual-showcase:tab-text", "type": "paragraph", "text": "线性关系的斜率为 2，截距为 1。输入每增加 1，输出增加 2。" }
    ] },
    { "id": "manual-showcase:tab-substitute", "title": "代入", "blocks": [
      { "id": "manual-showcase:tab-formula", "type": "formula", "tex": "x=3 \\quad\\Longrightarrow\\quad y=2\\times3+1=7", "parts": [{ "type": "latex", "tex": "x=3 \\quad\\Longrightarrow\\quad y=2\\times3+1=7" }], "caption": "代入一个具体输入" }
    ] }
  ]
}
```

## 行间公式

独立公式块可以显示说明和适用条件。下面的线性关系也会在后面的“内容同步引用”中原样呈现。

```mewiki-block
{
  "id": "manual-showcase:linear-formula",
  "type": "formula",
  "tex": "y = 2x + 1",
  "parts": [{ "type": "latex", "tex": "y = 2x + 1" }],
  "caption": "线性关系演示",
  "conditions": "仅用于展示排版，x 为实数。"
}
```

较复杂的数学排版也可以直接显示，例如矩阵、求和与分式：

$$
\mathbf{A}=\begin{bmatrix}1&2\\3&4\end{bmatrix},\qquad
\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i
$$

## 图片

点击图片可以放大查看，图注显示在图片下方。这个 PNG 由项目自己的图形生成，离线可用。

```mewiki-block
{
  "id": "manual-showcase:image",
  "type": "media", "kind": "image",
  "source": { "type": "asset", "assetId": "manual:showcase-image.png" },
  "alt": "MeWiki 图文、数学与数据的本地演示图片",
  "caption": "图 1 · 本地 PNG 示例，包含文字、折线和三个内容标签。",
  "display": { "align": "center", "widthPercent": 100 }
}
```

## 音频

这是两秒钟的轻音示例。点击播放后可以使用播放进度、速度和循环控件。完整说明见[图片、音频与视频](10-media.md)。

```mewiki-block
{
  "id": "manual-showcase:audio",
  "type": "media", "kind": "audio",
  "source": { "type": "asset", "assetId": "manual:showcase-audio.wav" },
  "alt": "两秒轻音示例",
  "caption": "本地 WAV 音频 · 手动播放，默认暂停。"
}
```

## 视频

短视频展示三个柱形随时间变化。封面复用本页的图片，点击播放后显示动画。

```mewiki-block
{
  "id": "manual-showcase:video",
  "type": "media", "kind": "video",
  "source": { "type": "asset", "assetId": "manual:showcase-video.webm" },
  "poster": { "type": "asset", "assetId": "manual:showcase-image.png" },
  "alt": "MeWiki 本地短视频",
  "caption": "本地 WebM 视频 · 带封面与播放控件。"
}
```

## PDF 文档

下面是可以直接阅读的两页 PDF。试试翻页、缩放，或搜索 `MeWiki`；可搜索文本也可以选取复制。原件可通过下载按钮保存。

```mewiki-block
{
  "id": "manual-showcase:pdf",
  "type": "media", "kind": "pdf",
  "source": { "type": "asset", "assetId": "manual:showcase-document.pdf" },
  "alt": "两页 PDF 渲染示例",
  "caption": "本地 PDF · 第一页是演示数据，第二页是阅读说明。",
  "document": { "page": 1 }
}
```

## 普通附件

附件卡片显示文件名、类型和大小。点击下面的 CSV 卡片可以下载数据原件；同一份数据也用于后面的图表。

```mewiki-block
{
  "id": "manual-showcase:file",
  "type": "media", "kind": "file",
  "source": { "type": "asset", "assetId": "manual:showcase-data.csv" },
  "alt": "线性关系演示数据.csv",
  "caption": "普通附件不强制转换为图片或正文，可以直接下载原件。"
}
```

## 网页卡片

网页卡片可以保存标题、站点与摘要。下面的信息已经填写，查看本页不会自动抓取网页；点击卡片才会打开外部网站。

```mewiki-block
{
  "id": "manual-showcase:bookmark",
  "type": "bookmark",
  "url": "https://github.com/tojayon/MeWiki",
  "title": "MeWiki 项目主页",
  "siteName": "GitHub",
  "description": "本地优先的 Wiki 文档编辑与知识管理工具。此卡片演示网页标题、摘要与来源地址的排版。"
}
```

## 文献引用

文献卡片可以显示作者、年份、题名、出版信息、备注和关联 PDF。以下记录为明确虚构的演示文献，关联的是上面的本地 PDF，不提供虚构 DOI。

```mewiki-block
{
  "id": "manual-showcase:citation",
  "type": "citation",
  "title": "线性关系的记录与展示（虚构示例）",
  "authors": "MeWiki 示例作者",
  "year": "2026",
  "venue": "内容类型演示集",
  "notes": "这是用于查看文献卡片样式的虚构记录。可以点击关联 PDF 查看本地演示文档。",
  "pdf": { "type": "asset", "assetId": "manual:showcase-document.pdf" },
  "pdfName": "本地演示 PDF",
  "pdfPage": 1
}
```

## 数据与图表

同一组虚构观测展示折线图、柱状图和散点图。每个数据块都包含实际表格；可以查看数据、下载 CSV，或在副本中选择其他图表类型。

```mewiki-block
{
  "id": "manual-showcase:line-chart",
  "type": "dataset", "title": "折线图 · 观测值与参考值",
  "columns": ["输入 x", "观测值 y", "参考值"],
  "rows": [["0", "1", "1"], ["1", "3.2", "3"], ["2", "4.8", "5"], ["3", "7.1", "7"], ["4", "9", "9"]],
  "source": { "type": "asset", "assetId": "manual:showcase-data.csv" },
  "sourceName": "showcase-data.csv",
  "chart": { "kind": "line", "x": 0, "ys": [1, 2] }
}
```

```mewiki-block
{
  "id": "manual-showcase:bar-chart",
  "type": "dataset", "title": "柱状图 · 不同输入的观测值",
  "columns": ["输入 x", "观测值 y"],
  "rows": [["0", "1"], ["1", "3.2"], ["2", "4.8"], ["3", "7.1"], ["4", "9"]],
  "chart": { "kind": "bar", "x": 0, "ys": [1] }
}
```

```mewiki-block
{
  "id": "manual-showcase:scatter-chart",
  "type": "dataset", "title": "散点图 · 输入与输出的关系",
  "columns": ["输入 x", "观测值 y"],
  "rows": [["0", "1"], ["1", "3.2"], ["2", "4.8"], ["3", "7.1"], ["4", "9"]],
  "chart": { "kind": "scatter", "x": 0, "ys": [1] }
}
```

## 流程图

Mermaid 源码会转换为图形。点击下方流程图或工具栏的放大图标，可在独立矢量画布中用滚轮缩放、拖动平移；点击“适应画布”返回全图，按 Esc 关闭。下面的流程仅由本地文字和图形组成，可以在副本的编辑模式查看或修改源码。

```mewiki-block
{
  "id": "manual-showcase:mermaid",
  "type": "diagram", "mode": "mermaid", "title": "从记录到知识",
  "code": "flowchart LR\n  A[记录问题] --> B[整理条件]\n  B --> C[推导与观察]\n  C --> D[形成笔记]\n  D --> E[链接知识]",
  "strokes": []
}
```

## 手绘草图

草图使用矢量笔画保存。下面同时展示矩形、椭圆、箭头、直线、文字和自由笔画，可在编辑模式继续修改。

```mewiki-block
{
  "id": "manual-showcase:drawing",
  "type": "diagram", "mode": "drawing", "title": "输入、处理与输出的草图",
  "code": "",
  "strokes": [
    { "id": "showcase:rect", "kind": "rect", "points": [{ "x": 80, "y": 160 }, { "x": 310, "y": 300 }], "color": "#3271b8", "width": 3 },
    { "id": "showcase:input", "kind": "text", "points": [{ "x": 152, "y": 240 }], "color": "#153b6d", "width": 6, "text": "输入 x" },
    { "id": "showcase:arrow", "kind": "arrow", "points": [{ "x": 330, "y": 230 }, { "x": 555, "y": 230 }], "color": "#c46a2b", "width": 3 },
    { "id": "showcase:process", "kind": "text", "points": [{ "x": 365, "y": 192 }], "color": "#c46a2b", "width": 4, "text": "y = 2x + 1" },
    { "id": "showcase:ellipse", "kind": "ellipse", "points": [{ "x": 580, "y": 160 }, { "x": 850, "y": 300 }], "color": "#b54f59", "width": 3 },
    { "id": "showcase:output", "kind": "text", "points": [{ "x": 665, "y": 240 }], "color": "#b54f59", "width": 6, "text": "输出 y" },
    { "id": "showcase:line", "kind": "line", "points": [{ "x": 80, "y": 350 }, { "x": 850, "y": 350 }], "color": "#c5d0dd", "width": 2 },
    { "id": "showcase:pen", "kind": "pen", "points": [{ "x": 300, "y": 412 }, { "x": 350, "y": 390 }, { "x": 400, "y": 414 }, { "x": 450, "y": 390 }, { "x": 500, "y": 412 }, { "x": 550, "y": 392 }, { "x": 600, "y": 412 }], "color": "#3271b8", "width": 3 }
  ]
}
```

## 内容同步引用

下面直接引用本篇“行间公式”中的原始公式块。它使用稳定内容块标识显示来源，不是复制出来的第二份公式；在副本中改动引用来源需要重新选择该副本的内容。真实项目可以用它把其他笔记的一段定义、公式或图片同步展示在当前页面。

```mewiki-block
{
  "id": "manual-showcase:embed",
  "type": "noteEmbed",
  "sourceNoteId": "mewiki-manual-21-content-showcase",
  "sourceTitle": "内容类型展示",
  "blockIds": ["manual-showcase:linear-formula"]
}
```

## 插件与外部内容

外部内容块可以保留来源程序的标题、摘要、备注和结构化数据。下面是一个没有安装对应插件的虚构示例，展示通用卡片的保留效果；展开“来源信息”可以查看数据。已安装插件可以提供自己的表单和内容视图，详见[插件与外部程序](19-plugins-and-integrations.md)。

```mewiki-block
{
  "id": "manual-showcase:external",
  "type": "external",
  "provider": "org.mewiki.manual-demo",
  "contentType": "measurement",
  "schemaVersion": 1,
  "title": "外部观测记录（虚构示例）",
  "summary": "观测输入 x=3，输出 y=7。即使来源插件未安装，标题、摘要、备注和原始字段仍然可读。",
  "note": "这是一条随手册提供的演示卡片，没有连接任何外部程序。",
  "data": { "sample": "demo-001", "input": 3, "output": 7, "unit": "示例单位" }
}
```

## 旧版回放证据

MeWiki 继续保留旧资料中的回放证据类型。下面是虚构的兼容格式示例，用于查看时间、运行名称和备注的样式；它没有关联实际运行，不能定位到真实回放。新接入的程序使用上一节的插件内容块。

```mewiki-block
{
  "id": "manual-showcase:evidence",
  "type": "evidence",
  "runId": "manual-demo-run",
  "runTitle": "通用回放演示（无实际来源）",
  "time": 1.25,
  "loopId": "demo-loop",
  "eventLabel": "演示采样点",
  "note": "旧版证据卡片保留原有时间与观察备注。这条记录仅用于展示渲染效果。"
}
```

## 保存这些示例

媒体与文档都是普通的本地附件引用。首次在本地资料库查看附件或导出含附件备份时，MeWiki 会从随附资源补齐这些演示原件；浏览器模式也可以直接查看并导出。选择“导出 Markdown 与附件”或“含附件备份”，可以连同示例原件一起带走。只导出 Markdown 文本不会包含附件字节。

本篇覆盖当前内置内容块，以及外部内容与旧版证据的通用显示。理论地图、词典详情、变量配方和图文导出属于专用工作区或操作窗口，可分别阅读[理论地图](08-theory-maps.md)、[符号与术语词典](05-symbol-dictionary.md)、[变量配方](09-variable-recipes.md)和[社交图文导出](20-social-export.md)。

# MeWiki Logo、应用图标与 AI 吉祥物

## 中文名称与释义

产品中文名为 **觅维**，英文名为 **MeWiki**。中文聊天面板名为“觅维 智能助理”，英文为“MeWiki AI Assistant”。

**寻觅知识，以多维链接万物。**

- **觅**：探索、寻觅知识；读音呼应 Me，与 M 开头的英文名和 Logo 相连。
- **维**：维度、维系、链接万物；以“维”承接 Wiki，表达知识之间的多维连接。

中文界面用“觅维”，英文界面用 MeWiki；需要并列时写作“觅维（MeWiki）”。现有 M 图形与英文 Logo 继续使用。仓库、源码路径、资料格式、应用 ID 和缓存命名保持 MeWiki，不因显示名称变化迁移用户资料。

## 标志与应用图标

觅维使用深蓝、亮青和白色的 M 笔画作为品牌标志，产品理念为“寻觅知识，以多维链接万物”。浏览器标签页和项目 README 使用圆形 Logo；设置页、桌面应用和主屏幕快捷方式使用方形图标。笔记左侧顶部只显示工作区功能图标，不额外放置产品 Logo。完整 Logo 用于产品介绍、文档和宣传材料。SVG 中的图形与文字均为矢量路径，可直接缩放，不依赖外部字体或图片。

方形图标按方形画幅重新延展笔画：左下笔画顺势延伸到画幅下方，右侧蓝白飘带向右延续，边缘由方形或系统圆角统一裁切。圆形 Logo 的内部截断弧线不再作为方形图标的收尾；中间 M 的识别特征与品牌配色保持一致。白底版本采用同一轮廓，以深蓝与亮青笔画呈现。

| 完整 Logo | 圆形标志 | 应用图标 |
| --- | --- | --- |
| <img src="../public/brand/mewiki-logo-white.svg?v=20261120-me-palette" alt="MeWiki 完整 Logo：ME WIKI，知识链接万物" width="180" /> | <img src="../public/mewiki.svg?v=20261120-me-palette" alt="MeWiki 圆形 Logo" width="104" /> | <img src="../public/brand/mewiki-app-icon-rounded.svg" alt="MeWiki 深蓝底、亮青与白色 M 应用图标" width="104" /> |

## 选择文件

| 场景 | 文件 |
| --- | --- |
| 产品介绍、文档，透明底 | [完整 Logo SVG](../public/brand/mewiki-logo.svg) |
| 浅色底展示、印刷排版 | [白底 Logo SVG](../public/brand/mewiki-logo-white.svg) |
| 独立圆形标志 | [圆形标志 SVG](../public/brand/mewiki-mark.svg) |
| 浏览器标签页、README 头图 | [紧凑圆形 SVG](../public/mewiki.svg) · [32px PNG](../public/brand/mewiki-favicon-32.png) · [多尺寸 ICO](../public/favicon.ico) |
| 手机 App、桌面应用图标源图 | [满版方形 SVG](../public/brand/mewiki-app-icon.svg) · [1024 × 1024 PNG](../public/brand/mewiki-icon-1024.png) |
| 网页、介绍页、设计稿 | [圆角图标 SVG](../public/brand/mewiki-app-icon-rounded.svg) |
| 白底备选图标 | [白底图标 SVG](../public/brand/mewiki-app-icon-light.svg) |
| 自定义背景或平台合成 | [透明前景 SVG](../public/brand/mewiki-app-icon-foreground.svg) |
| AI 头像、聊天与助手入口 | [吉祥物 SVG](../public/brand/mewiki-ai-mascot.svg) · [1024 × 1024 透明 PNG](../public/brand/mewiki-ai-mascot-1024.png) |
| AI 修改预览文字大炮 | [文字大炮 SVG](../public/brand/mewiki-text-cannon.svg) · [1024 × 1024 透明 PNG](../public/brand/mewiki-text-cannon-1024.png) |

手机应用源图使用不透明的满版方形，由目标平台裁切圆角。圆角 SVG 适合直接展示；透明前景应配深色背景。浏览器标签使用圆形 SVG，并提供带透明四角的 16、32、48 像素 PNG 与多尺寸 ICO；派生时去掉原圆形标志的外围留白，让小尺寸更清晰。主屏幕快捷方式继续使用方形的 180、192、512 像素 PNG。图标内不放文字，名称由应用或系统显示。

觅维与 MeGit 共享系列色卡：深蓝 `#01357C` 用于标志底色和浅色界面的主要操作，亮青 `#00A9F3` 用于 M 的亮色笔画和深色界面的交互强调，标志白为 `#FFFFFF`，品牌绿 `#86D21F` 对应成功状态色阶。浅底上的信息使用深青 `#005D86`，成功文字使用深绿 `#36540C`。中性色、警告和危险沿用同一色卡。应用界面配色集中在 `src/index.css`，图标在本项目内独立维护。

## AI 吉祥物

<img src="../public/brand/mewiki-ai-mascot.svg?v=20261120-me-palette" alt="MeWiki AI 吉祥物：戴亮青耳机的深蓝正圆头像与亮青白 M" width="160" />

吉祥物依据产品参考图绘制，采用深蓝正圆头部、亮青白 M 和加大的亮青耳机，移除嘴巴，背景透明。为适合小尺寸头像，只使用深蓝 `#01357C`、白和亮青 `#00A9F3` 三种实色色块；去掉金属边缘、细光泽线、亮点、渐变及耳罩内部装饰。SVG 由标准圆、贝塞尔曲线和椭圆组成，可任意放大，不嵌入原图、外部图片或字体。

头部使用标准 `circle`，圆心为 `(640, 640)`、半径为 `450`，不再用近似圆形曲线，避免左右局部鼓出。M 的长弧尽量减少锚点，并使连接处的控制柄沿同一切线。蓝色填充叠在完整白色笔画上，按笔画裁切，再与脸部一起用同一圆形蒙版处理外边缘，避免分层边缘叠色产生灰线、细缝或漏色。耳机只保留深蓝外壳与亮青大块耳垫，宽高约放大四分之一；保留足够透明留白，避免耳机被画布裁切。

应用通过 `AiMascot` 组件统一显示：边缘 AI 入口 40px、浮窗标题 22px、欢迎状态 80px、助手回复 32px、正文选区入口 22px，以及 AI 服务设置导航 17px。入口保持原来的点击目标、键盘名称和拖动方式；图片本身不可拖动，也不重复朗读。浏览器标签页与 App 图标继续采用上方各自的品牌标志。

`AiMascot` 以 `?raw` 导入同一 SVG 原件，编码为模块级 `data:image/svg+xml`，随界面代码一起打包；不再依赖运行时的 `/brand/mewiki-ai-mascot.svg?v=...` 请求。这样即使静态图片路径缺失并被网页回退响应替代，聊天各处头像仍能完整解码。原 SVG／PNG 继续保留为品牌下载和文档素材，不复制图形、不改变头像外观；验收须检查 `complete` 与非零 `naturalWidth/naturalHeight`，不能只检查 HTTP 200 或元素存在。

## 文字大炮素材

<img src="../public/brand/mewiki-text-cannon.svg?v=20261120-me-palette" alt="觅维文字大炮：薄炮嘴暗面、带弧形高亮的深色正圆炮耳，以及参考方形图标向左下圆润延伸的蓝白 M" width="280" />

文字大炮继续采用《捕鱼达人》参考的炮尾俯视关系，使用饱满炮身和单个浅灰蓝底座。炮管、肩部与炮尾以连续曲线连接；拱形炮嘴两端为圆头，薄背面暗壁紧贴厚沿向炮管收拢，只在两端水平线下略微显露，内部不可见。底座保持浅色，两侧炮耳为深蓝正圆，略微伸出底盘，并沿同一光向增加圆头弧形高亮。炮嘴、炮管和左肩各保留一处宽圆高亮，补充光泽与体积；仍不增加突出的横箍、尾钮或细碎金属装饰线。

炮身直接显示蓝白 M，不绘制圆形背景、边圈或徽章底托。左腿参考 `mewiki-app-icon-rounded.svg` 中向左下延伸的饱满笔势，调整蓝白外弧与内弧，保留宽度并用圆弧收尾，让左右视觉重心更平衡。M 的其余主体笔画、显示比例和 `#00A9F3` 系列亮青与标志一致。隐形蒙版仅在左下扩展，以免新笔画被旧圆形边界截断；插画全部为本地 SVG，背景透明。

SVG 使用单个固定底座、随炮身转向的支撑、完整炮身、炮管、蓝白 M 和发射起点。已接入 AI 自动跟随笔记修改的中央预览：底部居中，炮身二维转向，发射修改片段并轻微后坐；实际发射位置随变换计算，无需多角度图片帧。任务完成后可用预览顶部回转箭头分段回放，重用同一素材；减少动态时保持静态图形和落点提示。分层与坐标见[素材设计记录](plans/2026-11-13-text-cannon-asset.md)，行为与验证见[动效实施计划](plans/2026-11-13-ai-text-cannon.md)、[回放计划](plans/2026-11-13-ai-cannon-replay.md)和[AI 手册](wiki/22-ai-workspace.md)。动效本身不写入笔记。

## 项目内使用与维护

SVG 原件位于 `public/brand/`，应用直接读取这些本地资源。设置页和关于页使用方形图标；中英文 README 以圆形标志、产品名和理念为首页，并展示当前界面的示例截图。另提供[产品介绍横幅](assets/hero.svg)，其中同样使用圆形标志。完整 Logo 的文字已转为轮廓，不需要安装额外字体。

圆形标志将深蓝底与亮青、白色笔画先合成为一组，再使用同一个圆形蒙版处理边缘。两侧白色出口直接衔接圆外透明区域，不额外描边，也不单独裁切笔画，以免深蓝底的边缘叠色形成浅灰细线。完整 Logo 中的圆形图案使用相同处理；修改时同步维护三份 SVG 原件。

修改 SVG 后，在项目根目录执行：

```powershell
npm run brand:generate
npm run brand:check
```

生成脚本使用项目已有的 Sharp 依赖，从四份原件分别生成资源：

- 圆形原件 `public/brand/mewiki-mark.svg`：派生 `public/mewiki.svg`、`mewiki-favicon-{16,32,48}.png`、`public/favicon.ico` 和产品介绍横幅。
- 方形原件 `public/brand/mewiki-app-icon.svg`：派生圆角、白底和透明前景 SVG、各版 1024px PNG、`mewiki-icon-*.png` 与 `public/apple-touch-icon.png`。圆角版对背景和笔画整体裁切，避免延伸笔画溢出圆角。
- 吉祥物原件 `public/brand/mewiki-ai-mascot.svg`：派生 `mewiki-ai-mascot-1024.png`，保持透明背景。应用通过 `AiMascot.tsx` 导入同一 SVG，修改后重新构建，头像随界面代码更新。
- 大炮原件 `public/brand/mewiki-text-cannon.svg`：派生 `mewiki-text-cannon-1024.png`，保持透明背景与相同画幅。动效分组只在 SVG 原件维护。

横幅布局在 `scripts/branding/hero-template.svg` 维护；圆形标志从原件注入，无需复制曲线路径。`npm run check` 包括派生资源一致性检查。修改浏览器图标时，同步更新 `index.html` 中 SVG、PNG 和 ICO 的版本参数，以刷新标签页图标缓存。

浏览器主屏幕应用元信息在 `public/manifest.webmanifest`，图标链接在 `index.html`。这些标志文件不属于用户资料库，也不会写入、替换或导出到用户笔记。没有新增后台离线缓存，笔记与附件仍按原有本地资料库方式使用。

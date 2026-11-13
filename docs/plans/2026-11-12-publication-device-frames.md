# 图文导出设备边框实现计划

> 按已确认的首版范围实施，直接保留当前工作区中的导出、字体和纹理改动；本轮不提交、不改写用户资料。

**目标：** 为图文导出增加手机、横屏手机、笔记本和浏览器窗口边框，样板与正式图片一致，配置能随个人模板保存。

**结构：** 可选 `options.frame` 仅记录系统边框 ID、背景、设备大小、阴影与内容缩放。共用领域模块定义固定设备几何、逻辑屏幕尺寸和安全 HTML/CSS；在选定输出尺寸内居中呈现设备，正文在屏幕内完整分页。原生内容继续复用网页样式，背景纹理仅绘制在屏幕内。

**实现顺序：**

1. 在 `src/domain/publicationTypes.test.ts` 增加旧请求兼容、设备参数往返及非法值校验，先运行并确认新增用例失败。
2. 新建 `src/domain/publicationFrames.ts` 与相邻单测；接入 `publicationTypes.ts`。无边框保持旧参数结构，连续长图保留配置但跳过设备层。
3. 在 `publicationMarkup.ts`、`server/publicationPagination.ts`、`PublicationReadingSurface.tsx`、`PublicationSamplePreview.tsx` 中共用屏幕尺寸与静态设备模板。输出尺寸不变，正文不拉伸、无静默裁切；每一页、封面都带设备层。
4. 新建 `PublicationFrameSettings.tsx`，放在“画幅”中；使用原生选择框和滑块，参数变更沿用现有结果失效逻辑。补齐英文翻译。
5. 在 `e2e/publication-frames.spec.ts` 验证样板实时更新、模板保存/恢复/导入导出、所有边框真实像素与分页完整性、长图不套框、窄屏和键盘操作。沿用临时虚构资料与隔离服务。
6. 更新 `docs/wiki/20-social-export.md`、开发说明、接手指南、图文导出 API 和集成说明。
7. 运行 `npm test`、`npm run lint`、`npm run i18n:check`、`npm run build` 和相关 Edge 回归，记录本轮实际结果。本侧任务只交付代码与验证，不干扰主聊天正在运行的服务。

**边界：** 不引入远程素材、任意 SVG/CSS、自定义边框上传、多设备拼贴或透视变换。系统外壳由本地 CSS 绘制，字体、纹理及正文继续沿用现有资源验证。

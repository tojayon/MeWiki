# MeWiki 开放集成接口

MeWiki 是笔记功能的唯一实现与资料保存方。外部程序通过公开 SDK 嵌入同一应用、提供当前内容，并响应用户点击内容卡片后的打开请求。WebBench 仿真回放是第一个可选插件。

## 开发归属

- 编辑、公式、词典、媒体、资料库与插件宿主只在 MeWiki 中开发。
- 外部程序只维护自身数据到外部内容的适配，以及定位/打开自身内容的操作。
- 每个插件声明自己的内容类型和版本，提供校验、显示及来源打开方式。插件代码在 MeWiki 中注册，不反向导入外部程序源码。
- 首期插件随 MeWiki 交付，在“插件管理”中安装、停用或卸载。这里的安装为启用已提供的插件，不支持上传任意脚本。以后可增加独立插件包的分发与审核，沿用当前宿主接口。

## 稳定的外部内容格式

```json
{
  "provider": "org.example.instrument",
  "contentType": "measurement",
  "schemaVersion": 1,
  "title": "本次测量",
  "summary": "可在未安装插件时阅读的摘要",
  "data": { "recordId": "record-1", "time": 0.125 }
}
```

`provider` 是插件的稳定标识，`contentType` 标识该插件内的内容类型，`schemaVersion` 只描述这份内容的结构。内容为 JSON，禁止函数和可执行代码，最多 256 KB；媒体、大型结果和原始记录通过引用传递。标题与摘要用于无插件时阅读。

插入笔记后，MeWiki 增加 `id`、`type: "external"` 与用户备注 `note`。未知插件和未知内容版本依然保存原始 JSON、标题、摘要和备注；停用或卸载不删除卡片。Markdown、完整备份和含附件备份都保留该结构。插件应提供版本迁移，不得静默丢弃旧数据。

## 外部网页接入

启动 MeWiki 后，从它自己的服务加载 SDK，无需复制编辑器源码，也不要复制 SDK 实现。

```js
const { connectMeWiki } = await import(
  'http://127.0.0.1:5280/integration/mewiki-host.js'
);
const connection = connectMeWiki({
  iframe: document.querySelector('#wiki'),
  url: 'http://127.0.0.1:5280',
  app: {
    id: 'org.example.instrument',
    name: '测量程序',
    providers: ['org.example.instrument'],
    capabilities: ['context.read', 'content.open']
  },
  onOpen: async content => {
    // 校验内容版本和真实记录身份，载入并定位完成后才返回。
    await showMeasurement(content.data.recordId, content.data.time);
  }
});
await connection.ready;
await connection.setContext(currentMeasurement);
// 关闭记录或当前内容不可用时清空上下文：
await connection.setContext(null);
// 容器销毁时：
connection.dispose();
```

SDK 自动设置 iframe URL、随机会话与握手。iframe 需要运行脚本、保留同源存储、下载文件及按用户点击打开来源窗口的能力。WebBench 的 `MeWikiEmbed` 是完整接入示例。

`context.read` 的方向是 **MeWiki 读取外部程序主动提供的当前内容**；它不允许外部程序读取笔记。`content.open` 允许 MeWiki 在用户点击卡片时，要求外部程序打开指定内容。上下文更新只更新临时可插入内容；不会静默写入笔记。用户在插入菜单中明确选择后才保存。

## 通信约定与错误

协议名 `mewiki.integration`，当前主版本 `1`。每条消息包含 `protocol`、`version`、随机 `session` 和请求 `id`；响应使用 `replyTo`，返回 `result` 或 `error`。

- `embed.ready` / `embed.connected`：交换程序身份与已开放能力，确认连接就绪。
- `context.set`：外部程序提供或清空当前内容。
- `content.open`：由用户点击发起的来源打开操作。

双方核对准确的 `origin`、发送窗口和会话，不使用 `*` 接收结果。请求受大小与超时约束；同一会话内的近期重复请求不会重复执行。未知操作返回 `unsupported_method`，业务失败返回 `request_failed`，连接关闭会拒绝待完成请求。主版本不匹配时不能接通，应升级对方程序。不要绕过这些检查或为旧后台增加兼容请求。

## 注册新插件

1. 在 `src/plugins/` 新建插件，声明 `id`、名称、版本、协议版本、内容类型与所需能力。
2. 实现内容校验、来源 URL 构造和可选的内容选择界面，在 `registry.ts` 注册插件。选择界面遵循 `ContentPickerProps`，仅在用户确认后通过 `onSelect` 返回有效 `ExternalContent`，取消使用 `onClose`。
3. 在 `PluginContentView.tsx` 注册只负责显示该内容的组件。
4. 提供对应测试：错误版本/错误身份拒绝、无插件仍可读、保存及导出往返、用户点击才打开来源。
5. 外部程序声明相同的 provider，并实现打开请求。

核心只保存通用 JSON 和用户内容；各插件不得直接修改其他插件的资料，不得自动读取或覆盖用户文件。

已启用插件的插入入口由 `insertions` 提供，不依赖宿主是否已发送上下文。`chooseContent(provider, signal)` 有有效当前上下文时直接返回，否则打开插件的 `ContentPicker`。取消、停用插件或中止请求返回空结果，不生成占位块。编辑器在完成选择后重新读取最新笔记并核对原插入位置；切换笔记、资料库或编辑模式会中止选择。外部类型仍不作为“更改类型”的目标。

## WebBench 回放插件

标识：`org.mewiki.webbench`；内容类型：`replay-position`；内容版本：`1`。

引用包含 `runId`、`replayId`、`recordDigest`、本地查询服务 `serviceBase`、WebBench 地址 `webbenchOrigin`、物理时间 `time`，以及可选的 `loopId`、`packetId` 和 `eventLabel`。

独立窗口和无当前上下文的内嵌窗口都可插入。WebBench 插件通过本机查询服务的 `GET /api/replays` 读取已有实验与时间范围，选择合法的物理时间和可选环路后构造同一引用。查询有 10 秒期限，取消或修改服务地址会中止旧请求。默认服务地址为 `http://127.0.0.1:8766`，WebBench 为 `http://127.0.0.1:4173`；用户可以在折叠的连接设置中修改，插入成功后在本机记住。只读取实验目录，完整仿真记录不复制到笔记资料库。

内嵌时由宿主执行定位；独立打开 MeWiki 时，卡片生成包含相同地址的 WebBench 链接。WebBench 从查询服务重新校验实验标识、文件摘要、时间范围和数据包归属，等待真实回放查询完成后才报告定位成功。数据被替换、服务未启动或引用失效时显示具体错误，不定位到其他实验。

旧 `evidence` 卡片继续可读。它们缺少文件摘要和服务地址，不能自动推定来源；载入原实验后可重新插入新版引用。

## 多资料库与入口

每个窗口通过稳定的资料库 ID 读取、保存与获取历史。WebBench 的嵌入 URL 使用 `http://127.0.0.1:5280/?workspace=org.mewiki.webbench`；其他宿主可用自己的稳定标识作为 `workspace`。将带参数的完整 URL 传给 `connectMeWiki` 的 `url` 即可，SDK 会保留这些参数。

- `workspace` 标记入口，分别记忆上次选择，省略时为 `standalone`。WebBench 入口优先使用自己的记忆或已设置的默认库，没有设置时优先名为 Cislunar 的库。
- `library=<id>` 明确指定当前窗口的资料库；切换后更新 URL，刷新仍打开同一库。明确指定的 ID 不存在时显示错误，不静默打开其他资料。
- 这两个参数是导航和偏好，不是用户权限或访问控制；仍仅在本机运行。
- 插件安装状态为应用级。笔记、符号、关系、附件和历史属于资料库；外部上下文只在用户主动插入后写入当前库。切换库会取消未完成的内容选择，保留宿主通信连接。

服务配置升级为 v2，保留原 `directory` 代表 `default` 库，增加库列表、稳定 ID 和入口默认项。读取旧 v1 配置不会重写或搬动资料。`GET /api/research-library/catalog` 列表，`POST` 新建/添加，`PATCH` 改名/入口默认项，`DELETE` 只移除登记。其他资料接口通过 `?library=<id>` 固定身份，无参仍指原库；写入同时校验目录归属，迁移与目录登记共用锁。

原库继续使用 `mewiki:research-notebook` 缓存及原 pending 恢复键；新增库使用 `mewiki:library:<id>:notebook` 和独立恢复/通知键。入口记忆为 `mewiki:workspace:<workspace>:library`。资料库切换先保存当前修改，目标失败时保留原工作区，其他窗口不会被一起切换。新增库只使用手册和通用示例，不复制当前研究内容。

## 资料与运行

独立与内嵌访问应使用同一 MeWiki 地址（默认 `http://127.0.0.1:5280`）。浏览器按来源保存缓存，`localhost` 与 `127.0.0.1`、不同端口的缓存不是同一个空间。本地资料库由 MeWiki 服务统一管理。

WebBench 的启动器会检查或启动 MeWiki；`MEWIKI_ROOT` 可指定其目录。正式服务更新代码后，重新构建并重启 MeWiki；只更新 WebBench 适配时重启 WebBench 即可。开发调试可以分别运行两个项目的 `npm run dev`，用 `VITE_MEWIKI_URL` 指定 MeWiki 地址。

旧本地资料库可在 MeWiki 设置中连接原目录。旧浏览器笔记在 WebBench 的“旧笔记迁移”中导出含附件 ZIP，再在 MeWiki 的设置中恢复。导出代码由 MeWiki 提供，只在用户点击后读取 WebBench 自己的缓存和附件，不删除旧资料。迁移必须在原有 WebBench 地址及浏览器配置下操作。

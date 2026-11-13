# 声明式插件 API v1

本参考对应 `src/plugins/sdk/types.ts`、`manifest.ts` 与 `runtime.ts` 的现有实现。它定义数据清单，不加载第三方 JavaScript、HTML、CSS 或 npm 依赖。完整可安装示例见[测量记录](../../examples/plugins/measurement/manifest.json)，随附插件见 [WebBench](../../plugins/webbench/manifest.json)。

## 清单与版本

| 字段 | 规则 |
| --- | --- |
| `manifestVersion`、`apiVersion` | 当前都精确为 `1`，不推测兼容其他版本 |
| `id` | 稳定 provider，1–128 字符，首字符为字母或数字，其余为字母、数字、`.`、`_`、`-` |
| `name`、`description` | 非空，分别最多 100、4000 字符 |
| `version` | 最多 100 字符的三段版本，可带预发布与构建标签；按完整版本身份保存，不按字符串比较新旧 |
| `capabilities` | 无重复的 `context.read`、`content.open` 子集，可为空 |
| `workspace` | 可选 `{ "name": "外部程序名" }`，向通用资料库入口列表提供显示名 |
| `contentTypes` | 1–16 个类型，每个类型 ID 唯一 |

清单拒绝未知字段和危险原型键。没有作者认证、签名、版本范围协商或任意代码入口；安装预览显示实际本地文件来源和包摘要。

`context.read` 允许 MeWiki 使用宿主主动发送的当前外部内容，方向仍是外部程序到 MeWiki。`content.open` 允许用户点击后向已连接宿主请求定位，或使用内容类型的 `source` 规则打开来源 URL。两者均不开放笔记读取或后台写入。

## 内容类型

每个类型必填 `id`、正安全整数 `schemaVersion`、`insertionLabel`、`schema` 和 `view`，可选 `picker` 与 `source`。各个类型使用自己的结构与内容版本；相同插件内不存在一个通用内容版本。

核心先使用既有 `parseExternalContent` 校验通用字段，再核对 provider、类型和版本，最后校验 `data`。内容结构的未声明字段继续保留。通用内容字段、长度和交换兼容见[外部内容格式](../integrations/README.md#稳定的外部内容格式)。

`schema` 是受限结构描述，根必须为 `object`。支持 `object`、`array`、`string`、`number`、`integer`、`boolean`，以及 `required`、`properties`、`items`、标量 `const` / `enum`、字符串长度、数组长度、数值上下界。字符串可用 `format: "local-origin"` 或 `"http-origin"` 校验程序地址。它不是完整 JSON Schema，不支持 `$ref`、正则、表达式或远程引用。

清单结构的嵌套深度最多 8（根为 0），单层最多 64 个属性或必填键，枚举最多 128 项；长度限制值最大 262144。运行校验保留通用内容的 20 层边界，数组缺省最多 10000 项，字符串缺省最多 262144 字符。`integer` 还要求 JavaScript 安全整数。

`view` 最多 32 个字段，每个字段有 `label` 和 `data.` 开头的 `path`，可选 `unit` 和 0–12 的 `digits`。只按文本显示，缺失值不显示，对象显示为 JSON；数值精度只影响显示，不改保存值。

## 字段映射

`PluginValue` 有两种形式：

```json
{ "literal": "固定文本" }
```

```json
{ "path": "fields.value", "optional": true, "prefix": "读数：", "suffix": " mm" }
```

`literal` 只接受 JSON 标量。`path` 从 `fields`、`connection`、`selected`、`content` 或 `data` 开始，只读取对象自身的点分路径，最多 256 字符和 16 段，不接受原型键、括号表达式或函数。可选 `json: true` 将值转成 JSON 字符串；`prefix` / `suffix` 各最多 1000 字符。必需路径缺失时拒绝生成内容；`optional` 允许缺失、空字符串或 null 时省略该字段。

可用 scope 由具体贡献点决定：表单有 `fields` / `connection` / `selected`，来源规则有 `content` / `data`；目录记录初始化只有 `selected`。只使用当前贡献点提供的路径。

## 内容表单与本机目录

`picker` 包含 `title`、最多 32 个 `fields` 和 `content`。字段必填 `key`、`label`、`type`；类型为 `text`、`number` 或 `select`，可选 `required`、`default`。数值字段支持数值或字段映射形式的 `min` / `max`；选择字段通过 `options` 映射读取数组，选项值仅支持字符串或数字，对象使用自身字符串或数字类型的 `id`，`optionsLabelPath` 指定对象上的标签路径。选择时保留原值类型，空字符串表示未选择。`initial` 在选择目录记录时初始化字段，`emptyLabel` 指定空选项文本。

`content` 用字段映射生成 `title`、可选 `summary` 和最多 64 个 `data` 字段，核心补齐 provider、类型与版本并重新校验。表单失败或取消不生成占位块。

`connection` 可声明最多 8 个 `{ key, label, default }` 程序地址。地址必须为本机 HTTP(S) origin：`127.0.0.1`、`localhost` 或 `[::1]`，不能带凭据、业务路径、查询或片段。成功插入后保存连接偏好；新插件使用完整 ID 的自动存储键。`connectionStorageKey` 仅供已有连接偏好的别名迁移，不能借此读取其他插件的偏好。

可选 `catalog` 包含 `connection` 键、`pathname`、四个界面文字 `label` / `refreshLabel` / `loadingText` / `emptyText`、`itemsPath` / `idPath` / `labelPath` 和 `itemSchema`。核心请求所声明本机地址的路径，使用 10 秒期限、无凭据、拒绝重定向，响应文本最多 2 Mi 字符，记录最多 10000 条。记录 ID 必须为 1–512 字符的唯一字符串，并通过每条结构校验；服务需允许 MeWiki 来源的跨端口请求。取消、关闭或修改连接地址会取消旧请求。

## 来源定位

可选 `source` 要求声明 `content.open`，包含 `origin` 字段映射、固定 `pathname` 和最多 32 个 `query` 参数映射。路径必须以单个 `/` 开头，拒绝反斜杠、空白、查询、片段和 `..` 段；参数由 URL API 编码，不拼接未转义文本。来源 origin 必须为 HTTP(S)，不能带凭据、路径、查询或片段，是否限定本机由内容 schema 进一步约束。

有匹配宿主且开放 `content.open` 时，核心通过宿主 v1 请求定位；否则按 `source` 规则新开窗口。插件未声明打开能力、没有有效定位方式或不支持内容版本时，不提供来源按钮。外部程序仍需核对自己的记录身份，不能靠标题猜测定位。

## 包与服务边界

JSON 清单最大 256 KiB；ZIP / `.mewiki-plugin` 最大 1 MiB，根目录只允许 `manifest.json`、`README.md`、`LICENSE`、`LICENSE.txt` 普通文件。说明和许可各最多 64 KiB，总解压最多 512 KiB，单项压缩比最多 100。拒绝多余文件、链接、目录、重复和大小写冲突路径、加密、非支持压缩及 CRC / 大小异常；ZIP 内容不会解压执行。

包管理 API 位于 `/api/mewiki/plugins`：`GET` 列表、`POST /inspect` 预览、`POST` 安装、`PUT` 使用 `{ id, version }` 切换、`DELETE` 使用 `{ id }` 卸载。写入要求同源本机请求及 `X-MeWiki-Request: plugins`，控制请求使用 JSON；包上传使用 JSON、ZIP 或二进制类型。这是 MeWiki 设置页与本地服务的接口，宿主 SDK 和插件清单不获得调用它的授权。

升级不扫描资料库，不迁移用户内容；未知内容由通用卡片继续阅读、保存与导出。命令、面板、私有按库存储、导入导出和可执行运行环境不在本 API v1 的能力内。数据形式的图文模板与按库个人模板另见 [API v2](API_V2.md)；不能将它们的字段添加到 v1 清单。

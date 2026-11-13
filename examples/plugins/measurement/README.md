# 测量记录示例插件

这是一个独立的声明式 MeWiki 插件示例。清单使用 `src/plugins/sdk/` 中的官方 API v1，通过统一表单、字段视图和来源打开规则工作，无需修改 MeWiki 核心源码。`examples/` 不会被应用自动注册或安装。

## 校验与打包

在 MeWiki 项目根目录、安装好项目依赖后执行：

```sh
npm run plugin:validate -- examples/plugins/measurement/manifest.json
npm run plugin:pack -- examples/plugins/measurement measurement.mewiki-plugin
```

也可以直接运行：

```sh
node --experimental-strip-types scripts/plugin-tools.mjs validate examples/plugins/measurement/manifest.json
node --experimental-strip-types scripts/plugin-tools.mjs pack examples/plugins/measurement measurement.mewiki-plugin
```

需要 Node.js 22.13 或更新的受支持版本；`--experimental-strip-types` 用于加载与应用共用的 TypeScript 校验器。工具只读取清单与允许的文档，打包后再用正式安装校验器检查，不安装依赖、不执行插件代码。输出文件已存在时会拒绝覆盖，重新打包请指定新文件名。

首版插件包目录只能包含 `manifest.json` 和可选的 `README.md`、`LICENSE`、`LICENSE.txt` 普通文件；禁止脚本、HTML、子目录和链接。JSON 清单上限 256 KiB，单份说明或许可证上限 64 KiB，完整包上限 1 MiB。此工具生成 ZIP 容器，扩展名为 `.mewiki-plugin`。

## 安装与使用

1. 在 MeWiki 打开“设置 → 插件与集成”，点击“选择插件包”。
2. 选择生成的 `.mewiki-plugin` 文件，或直接选择 `manifest.json`。核对预览中的身份 `org.example.measurement`、版本与能力后，点击“确认安装”，再在列表中点击“启用”。
3. 返回笔记并进入编辑模式，从插入菜单选择“插入测量记录”。填写记录名称、测量值，确认后生成带 `mm` 单位的内容卡片。
4. 刷新后卡片仍可阅读；停用或卸载插件会保留卡片、备注和原始 JSON。

示例默认来源程序地址为 `http://127.0.0.1:7777`，打开来源时访问 `/measurement?record=<记录名称>`。本示例不附带、不会启动测量服务；没有相应服务时打开链接失败属于预期行为，不影响插件安装与笔记保存。需要对接自己的程序时，修改连接地址和清单里的来源规则，使用虚构数据验证。

## 接续开发

公开类型、清单解析和通用执行逻辑分别位于 `src/plugins/sdk/types.ts`、`manifest.ts`、`runtime.ts`；说明见 `docs/plugins/README.md`。显示字段、选择表单和内容数据均通过清单声明，不能导入 MeWiki 内部 React 组件、store 或控制器来增加专用分支。

保持 provider ID 和已有内容 `schemaVersion` 的含义稳定；插件实现版本与内容版本分别管理。更换字段结构时保留旧卡片可读和导入导出往返，不能在插件启用或升级时自动覆盖用户资料。

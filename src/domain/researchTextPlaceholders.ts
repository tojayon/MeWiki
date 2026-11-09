import { createMarkdownSource, researchMarkdownKinds, type ResearchMarkdownKind } from "./researchMarkdown.ts";

const legacySources: Record<string, string> = {
  paragraph: "点击此处记录研究内容。",
  callout: "在此记录需要强调的内容。",
  list: "新增条目",
  quote: "> 在此记录引用内容。",
  code: "```python\n# 在此输入代码\n```",
  orderedList: "1. 第一项\n2. 第二项",
  taskList: "- [ ] 待完成事项",
  table: "| 项目 | 内容 |\n| :--- | :--- |\n| 第一项 | 填写内容 |",
  image: "![图片说明]()",
  markdown: "记录 Markdown 内容。",
};

const hints: Record<string, string> = {
  paragraph: "输入段落内容…", heading: "输入标题…", list: "输入列表条目…", callout: "输入需要强调的内容…",
  quote: "输入引用内容…", code: "输入代码…", orderedList: "输入列表步骤…", taskList: "输入待办事项…",
  table: "点击单元格输入内容…", image: "填写图片说明与路径…", markdown: "输入 Markdown 内容…",
};

/** Only the complete, untouched legacy template is treated as a hint; authored text is preserved. */
export function researchTextEditorState(value: string, kind = "paragraph") {
  const markdown = researchMarkdownKinds.includes(kind as ResearchMarkdownKind);
  const template = markdown ? createMarkdownSource(kind as ResearchMarkdownKind) : "";
  const source = kind === "heading" ? value.replace(/^(#{1,6}) 新标题$/, "$1 ")
    : value === legacySources[kind] ? template : value;
  const empty = kind === "heading" ? /^#{1,6}\s*$/u.test(source) : source === template && kind !== "divider";
  const caret = empty && kind === "code" ? source.indexOf("\n") + 1 : empty && kind === "image" ? 2 : source.length;
  return { source, empty, caret, placeholder: hints[kind] };
}

export function researchTitleInputValue(title: string) {
  return ["未命名笔记", "未命名基础理论"].includes(title) ? "" : title;
}

export function researchCaptionInputValue(caption = "") {
  return caption === "公式说明" ? "" : caption;
}

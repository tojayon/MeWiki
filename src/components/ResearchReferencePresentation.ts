import katex from "katex";
import type { Node as EditorNode } from "prosemirror-model";
import { dictionaryReferenceBindings, dictionaryReferenceId, formatTermReference, termReferenceSelection } from "../domain/researchTerms.ts";
import { resolveSymbolEntry } from "../domain/researchDictionary.ts";
import { researchNoteLinkId } from "../domain/researchNoteLinks.ts";
import { t } from "../i18n/locale.ts";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import type { ContextType } from "react";

export function referencePresentation(node: EditorNode, context: ContextType<typeof ResearchNoteLinkContext>) {
  const { href, kind, label } = node.attrs;
  const id = dictionaryReferenceId(href);
  const term = kind === "term" ? context?.terms.find(item => item.id === id) : undefined;
  const symbol = kind === "symbol" ? context?.symbols.find(item => item.id === id) : undefined;
  const note = kind === "note" ? context?.notes.find(item => item.id === researchNoteLinkId(href)) : undefined;
  const text = term ? formatTermReference(term, termReferenceSelection(href)) : symbol ? resolveSymbolEntry(symbol, { ...Object.fromEntries(symbol.slots.map(slot => [slot.key, slot.defaultValue])), ...dictionaryReferenceBindings(href) }).tex : note ? note.title || t("未命名笔记") : label;
  const missing = kind !== "file" && !term && !symbol && !note;
  return { text, tex: symbol ? text : undefined, missing,
    title: term ? term.meaning : symbol ? symbol.meaning : note ? note.title : kind === "file" ? t("附件引用") : t("引用来源已移除") };
}

export function paintReference(element: HTMLElement, node: EditorNode, context: ContextType<typeof ResearchNoteLinkContext>) {
  const presentation = referencePresentation(node, context);
  element.dataset.referenceKind = node.attrs.kind;
  element.dataset.mewikiReference = node.attrs.source;
  const dictionaryClass = !presentation.missing && ["term", "symbol"].includes(node.attrs.kind) ? ` research-dictionary-${node.attrs.kind}-reference` : "";
  element.className = `research-reference-atom${dictionaryClass}${presentation.missing ? " is-missing" : ""}`;
  element.title = presentation.title;
  element.setAttribute("aria-label", dictionaryClass ? node.attrs.kind === "term" ? t`术语：${presentation.text}` : t`符号：${context?.symbols.find(entry => entry.id === dictionaryReferenceId(node.attrs.href))?.name ?? presentation.title}` : t`编辑引用：${presentation.tex ? presentation.title : presentation.text}`);
  element.replaceChildren();
  if (node.attrs.kind === "note" || node.attrs.kind === "file") {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("width", "13"); icon.setAttribute("height", "13");
    icon.setAttribute("fill", "none"); icon.setAttribute("stroke", "currentColor"); icon.setAttribute("stroke-width", "1.5"); icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6");
    icon.append(path); element.append(icon);
  }
  const label = document.createElement("span");
  if (presentation.tex) label.innerHTML = katex.renderToString(presentation.tex, { throwOnError: false, strict: "ignore", trust: false });
  else label.textContent = presentation.text;
  element.append(label);
}

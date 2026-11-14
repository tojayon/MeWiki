import { expect, type Locator } from "@playwright/test";
import { referenceDocumentSource, referenceEditorSchema } from "../../src/domain/researchReferenceEditor.ts";

/** Inspect what the visible editor will save, including stable references rather than their current labels. */
export async function editorSource(editor: Locator): Promise<string> {
  const result = await editor.evaluate(element => {
    if (element instanceof HTMLTextAreaElement) return element.value;
    const model = (element as HTMLElement & { pmViewDesc?: { node: { toJSON(): unknown } } }).pmViewDesc?.node;
    if (model) return model.toJSON();
    const read = (node: Node): string => {
      if (node instanceof HTMLElement && node.dataset.mewikiReference !== undefined) return node.dataset.mewikiReference;
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      return [...node.childNodes].map(read).join("");
    };
    return read(element);
  });
  return typeof result === "string" ? result : referenceDocumentSource(referenceEditorSchema.nodeFromJSON(result));
}
export async function pasteEditorMarkdown(editor: Locator, source: string) {
  await editor.press("Control+a");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, source);
}
export async function expectEditorSource(editor: Locator, expected: string | RegExp) {
  if (typeof expected === "string") await expect.poll(() => editorSource(editor)).toBe(expected);
  else await expect.poll(() => editorSource(editor)).toMatch(expected);
}
export async function startEditorComposition(editor: Locator, text: string) {
  await editor.evaluate((element, value) => {
    (element as HTMLElement).focus();
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const line = element.querySelector(".research-reference-line")!;
    line.textContent = value;
    const range = document.createRange(); range.selectNodeContents(line); range.collapse(false);
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: value, isComposing: true }));
  }, text);
}
export async function finishEditorComposition(editor: Locator, text: string, order: "before" | "after") {
  await editor.evaluate((element, { text: value, order }) => {
    const commit = () => {
      const line = element.querySelector(".research-reference-line")!;
      line.textContent = value;
      const range = document.createRange(); range.selectNodeContents(line); range.collapse(false);
      const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: value, isComposing: order === "before" }));
    };
    if (order === "before") commit();
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: value }));
    if (order === "after") commit();
  }, { text, order });
}

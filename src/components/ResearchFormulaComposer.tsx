import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { X, Check, Copy, Pencil, Settings } from "lucide-react";
import katex from "katex";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import { Formula } from "./Formula.tsx";
import { formulaPartsToTex, type FormulaLayout, type FormulaOperator, type FormulaPart } from "../domain/researchDictionary.ts";
import { insertFormulaPart, removeFormulaPart } from "../domain/formulaEditing.ts";
import { renderedFormulaTex, type ResearchNotebookBlock, type ResearchNotebookState } from "../domain/researchNotebook.ts";
import { formulaMetadataError, formulaSourceError, type FormulaAddress } from "../domain/researchFormulaLinks.ts";
import { FormulaReadSurface, FormulaResultSettings, FormulaSymbolPopover } from "./ResearchFormulaRelations.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import { ResearchFormulaItemEditor } from "./ResearchFormulaItemEditor.tsx";
import { FORMULA_CLIPBOARD_MIME, cloneFormulaParts, formulaTransferError, moveFormulaSelection, normalizeFormulaSelection, parseFormulaClipboardData, replaceFormulaSelection, serializeFormulaSelection, type FormulaClipboardParseResult, type FormulaRange } from "../domain/formulaTransfer.ts";
import { FormulaCaretSurface, type FormulaSurfaceApi } from "./ResearchFormulaCaretSurface.tsx";
import { ResearchFormulaTexInput } from "./ResearchFormulaTexInput.tsx";
import { ResearchVariableRecipeContext } from "./ResearchVariableRecipeContext.ts";
import { researchCaptionInputValue } from "../domain/researchTextPlaceholders.ts";

type FormulaBlock = Extract<ResearchNotebookBlock, { type: "formula" }>;
type FormulaEditablePart = Extract<FormulaPart, { type: "symbol" | "operator" | "latex" }>;
type FormulaSnapshot = { parts: FormulaPart[]; layout: FormulaLayout; position: number; selection: FormulaRange | null };
type FormulaEditorSession = {
  id: number;
  mode: "add" | "edit";
  index: number;
  query: string;
  snapshot: string;
  range?: FormulaRange;
  anchor: { left: number; top: number; bottom: number };
};
const formulaFingerprint = (parts: FormulaPart[], layout: FormulaLayout) => JSON.stringify([parts, layout]);

function FormulaSettingsPopover({ block, state, owner, triggerRef, onCancel, onSave, onOpenFormula }: {
  block: FormulaBlock;
  state: ResearchNotebookState;
  owner: FormulaAddress;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onCancel: (restoreFocus?: boolean) => void;
  onSave: (patch: Pick<FormulaBlock, "caption" | "conditions" | "outputs">) => void;
  onOpenFormula: (address: FormulaAddress) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [caption, setCaption] = useState(() => researchCaptionInputValue(block.caption));
  const [conditions, setConditions] = useState(block.conditions ?? "");
  const [outputs, setOutputs] = useState(() => (block.outputs ?? []).map((output) => ({ ...output, bindings: { ...output.bindings } })));
  const [error, setError] = useState("");
  useFormulaPopover({ ref, getAnchor: () => triggerRef.current!.getBoundingClientRect(), onCancel, triggerRef });
  return (
    <div ref={ref} id={"formula-settings-" + block.id} className="research-formula-inline-editor research-formula-settings-popover" popover="manual" role="dialog" aria-label={t("公式设置")}>
      <strong className="research-formula-settings-heading">{t("公式设置")}</strong>
      <label>{t("公式说明")}<textarea aria-label={t("公式说明")} rows={3} value={caption} placeholder={t("填写公式的含义或补充说明")}
        onChange={(event) => setCaption(event.target.value)} /></label>
      <p className="research-formula-settings-hint">{t("显示在公式左下方，留空则隐藏。")}</p>
      <label>{t("适用条件")}<textarea aria-label={t("适用条件")} rows={2} value={conditions} placeholder={t("记录模型假设、使用范围或成立条件")}
        onChange={(event) => setConditions(event.target.value)} /></label>
      <FormulaResultSettings state={state} owner={owner} block={block} outputs={outputs} onChange={(next) => { setOutputs(next); setError(""); }} onOpenFormula={onOpenFormula} />
      {error && <p className="research-formula-error" role="alert">{localizeError(error)}</p>}
      <div className="research-formula-inline-editor-actions">
        <button data-ui="icon-action" onClick={() => onCancel(true)} aria-label={t("取消")} title={t("取消")}><X size={15} /></button>
        <button data-ui="icon-action" className="research-symbol-save" onClick={() => {
          const issue = formulaMetadataError(state, owner, outputs);
          if (issue) { setError(issue); return; }
          onSave({ caption: caption.trim(), conditions: conditions.trim(), outputs });
        }} aria-label={t("保存设置")} title={t("保存设置")}><Check size={15} /></button>
      </div>
    </div>
  );
}

export default function ResearchFormulaComposer({ block, state, owner, readOnly = false, onPatch, onOpenFormula, onComplete }: {
  block: FormulaBlock;
  state: ResearchNotebookState;
  owner: FormulaAddress;
  readOnly?: boolean;
  onPatch: (patch: Partial<FormulaBlock>) => void;
  onOpenFormula: (address: FormulaAddress) => void;
  onComplete?: () => void;
}) {
  useLocale();
  const parts = block.parts ?? [];
  const [isEditing, setIsEditing] = useState(false);
  const confirmDelete = useDeleteConfirmation();
  const [texDraft, setTexDraft] = useState(block.tex);
  const [position, setPosition] = useState(parts.length);
  const [selection, setSelection] = useState<FormulaRange | null>(null);
  const [texInput, setTexInput] = useState<{ snapshot: string; range: FormulaRange } | null>(null);
  const texInputId = useId();
  const selectionAnchor = useRef<number | null>(null);
  const [active, setActive] = useState<FormulaEditorSession | null>(null);
  const activeSession = useRef<FormulaEditorSession | null>(null);
  const sessionNumber = useRef(0);
  const [draft, setDraft] = useState<FormulaEditablePart | null>(null);
  const [error, setError] = useState("");
  const [transferStatus, setTransferStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [inspection, setInspection] = useState<{ index: number; target: HTMLElement } | null>(null);
  const openRecipePanel = useContext(ResearchVariableRecipeContext);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const texRef = useRef<HTMLTextAreaElement>(null);
  const surfaceRef = useRef<FormulaSurfaceApi | null>(null);
  const layout = block.layout ?? "aligned";
  const fingerprint = formulaFingerprint(parts, layout);
  // Keep successful transactions available immediately, including multiple
  // keyboard clicks delivered before React renders the next parent snapshot.
  const currentFormula = useRef({ parts, state, owner, layout, fingerprint, position, selection });
  useLayoutEffect(() => { currentFormula.current = { parts, state, owner, layout, fingerprint, position, selection }; });
  const history = useRef<{ undo: FormulaSnapshot[]; redo: FormulaSnapshot[]; expected: string }>({ undo: [], redo: [], expected: fingerprint });
  useLayoutEffect(() => {
    if (history.current.expected !== fingerprint) {
      history.current = { undo: [], redo: [], expected: fingerprint };
      setSelection(null);
      selectionAnchor.current = null;
      setPosition((value) => Math.min(parts.length, value));
    }
  }, [fingerprint, parts.length]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useLayoutEffect(() => {
    if (isEditing && block.parts === undefined) texRef.current?.focus({ preventScroll: true });
  }, [isEditing, block.parts]);
  const cancelTexEdit = () => {
    setIsEditing(false);
    setTexDraft(block.tex);
    setError("");
    editRef.current?.focus({ preventScroll: true });
  };
  const saveTex = () => {
    const tex = texDraft.replace(/\r\n?/g, "\n");
    try {
      katex.renderToString(tex, { displayMode: true, throwOnError: true });
    } catch {
      setError("公式 LaTeX 语法有误，请检查括号、命令或环境是否完整。");
      texRef.current?.focus({ preventScroll: true });
      return false;
    }
    onPatch({ tex });
    setIsEditing(false);
    setError("");
    editRef.current?.focus({ preventScroll: true });
    return true;
  };
  const copyFormula = async () => {
    clearTimeout(copyTimer.current);
    setCopyStatus("idle");
    try {
      await navigator.clipboard.writeText(renderedFormulaTex(block, state.symbols).tex);
      setCopyStatus("copied");
      copyTimer.current = setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      setCopyStatus("error");
      copyTimer.current = setTimeout(() => setCopyStatus("idle"), 4000);
    }
  };
  const close = (restoreFocus = false) => { activeSession.current = null; setActive(null); setDraft(null); setTexInput(null); setError(""); if (restoreFocus) surfaceRef.current?.focus(); };
  const closeSettings = (restoreFocus = false) => { setSettingsOpen(false); if (restoreFocus) settingsRef.current?.focus({ preventScroll: true }); };
  const closeInspection = (restoreFocus = false) => { if (restoreFocus) inspection?.target.focus({ preventScroll: true }); setInspection(null); };
  const toggleTexInput = () => {
    close(); closeSettings(); closeInspection();
    if (texInput) { surfaceRef.current?.focus(); return; }
    const current = currentFormula.current;
    setTexInput({ snapshot: current.fingerprint, range: current.selection ? { ...current.selection } : { start: current.position, end: current.position } });
  };
  const openFormula = (address: FormulaAddress) => { close(); closeSettings(); closeInspection(); onOpenFormula(address); };
  const openInsert = (query = "") => {
    closeSettings();
    const entry = state.symbols.find((item) => query && (item.name + " " + item.notation).toLowerCase().includes(query.toLowerCase())) ?? state.symbols[0];
    const operators: Record<string, FormulaOperator> = { "+": "plus", "-": "minus", "=": "equals", "/": "divide", "*": "times", "0": "zero", "1": "one", "^": "superscriptStart", "_": "subscriptStart", "(": "leftParen", "[": "leftBracket" };
    setDraft(operators[query] ? { type: "operator", operator: operators[query] } : entry ? { type: "symbol", entryId: entry.id, bindings: Object.fromEntries(entry.slots.map((slot) => [slot.key, slot.defaultValue])) } : { type: "operator", operator: "plus" });
    const session: FormulaEditorSession = { id: ++sessionNumber.current, mode: "add", index: selection?.start ?? position, query, snapshot: fingerprint, range: selection ?? undefined, anchor: surfaceRef.current!.anchor() };
    activeSession.current = session;
    setActive(session);
    setError("");
  };
  const openPart = (index: number) => {
    const part = parts[index];
    if (!part || (part.type !== "symbol" && part.type !== "operator" && part.type !== "latex")) return;
    closeSettings();
    setSelection(null);
    selectionAnchor.current = null;
    setDraft(part.type === "symbol" ? { ...part, bindings: { ...part.bindings } } : { ...part });
    const session: FormulaEditorSession = { id: ++sessionNumber.current, mode: "edit", index, query: "", snapshot: fingerprint, anchor: surfaceRef.current!.anchor(index) };
    activeSession.current = session;
    setActive(session);
    setError("");
  };
  const takeSnapshot = (): FormulaSnapshot => ({ parts: cloneFormulaParts(parts), layout, position, selection: selection ? { ...selection } : null });
  const commit = (next: FormulaPart[], caret: number, nextLayout = layout, nextSelection: FormulaRange | null = null, record = true, keepEditorOpen = false) => {
    const current = currentFormula.current;
    const issue = formulaTransferError(next, current.state, current.owner, nextLayout);
    if (issue) { setError(issue); return false; }
    const tex = formulaPartsToTex(next, current.state.symbols, nextLayout).tex;
    if (record && formulaFingerprint(next, nextLayout) !== current.fingerprint) {
      history.current.undo.push({ parts: cloneFormulaParts(current.parts), layout: current.layout, position: current.position, selection: current.selection ? { ...current.selection } : null });
      if (history.current.undo.length > 100) history.current.undo.shift();
      history.current.redo = [];
    }
    history.current.expected = formulaFingerprint(next, nextLayout);
    const nextParts = cloneFormulaParts(next);
    const nextPosition = Math.max(0, Math.min(next.length, caret));
    currentFormula.current = { ...current, parts: nextParts, layout: nextLayout, fingerprint: history.current.expected, position: nextPosition, selection: nextSelection };
    onPatch({ parts: nextParts, layout: nextLayout, tex });
    setPosition(nextPosition);
    setSelection(nextSelection);
    selectionAnchor.current = nextSelection?.start ?? null;
    if (!keepEditorOpen) close(true);
    else setError("");
    setTransferStatus("");
    return true;
  };
  const latestEdit = useRef({ parts, state, owner, layout, fingerprint, commit });
  useLayoutEffect(() => { latestEdit.current = { parts, state, owner, layout, fingerprint, commit }; });
  const changeLayout = (nextLayout: FormulaLayout) => {
    if (nextLayout === "centered" && parts.some((part) => part.type === "alignmentPoint")) return;
    commit(parts, position, nextLayout, selection);
  };
  const insertStructure = (part: FormulaPart) => {
    const base = selection ? [...parts.slice(0, selection.start), ...parts.slice(selection.end)] : parts;
    const result = insertFormulaPart(base, selection?.start ?? position, part);
    commit(result.parts, result.caret);
  };
  const removeAt = (index: number) => {
    if (!parts[index]) return;
    const result = removeFormulaPart(parts, index);
    const count = parts.length - result.parts.length;
    confirmDelete({ title: t("删除公式内容"), description: count > 1 ? t`确定删除所选公式结构及其中的 ${count} 个公式项吗？` : t("确定删除选中的公式项吗？") }, () => {
      const current = latestEdit.current;
      if (JSON.stringify(current.parts) !== JSON.stringify(parts)) {
        setError("公式内容已变更，请重新选择要删除的公式项。");
        surfaceRef.current?.focus();
        return;
      }
      current.commit(result.parts, result.caret);
    });
  };
  const save = (part: FormulaEditablePart) => {
    const session = activeSession.current, current = currentFormula.current;
    if (!session) return false;
    if (session.snapshot !== current.fingerprint) { setError("公式内容已变更，请关闭面板后重新选择编辑位置。"); return false; }
    if (part.type === "symbol") {
      const issue = formulaSourceError(current.state, current.owner, part);
      if (issue) { setError(issue); return false; }
    }
    const base = session.range ? [...current.parts.slice(0, session.range.start), ...current.parts.slice(session.range.end)] : current.parts;
    let result = session.mode === "add" ? insertFormulaPart(base, session.index, part)
      : { parts: base.map((value, index) => index === session.index ? part : value), caret: session.index + 1 };
    if (session.mode === "edit" && formulaTransferError(result.parts, current.state, current.owner, current.layout)) {
      const removed = removeFormulaPart(base, session.index);
      // Replacing an atom with a fraction or brackets must insert its complete
      // structure. Existing paired structures still require a valid replacement.
      if (removed.parts.length === base.length - 1) result = insertFormulaPart(removed.parts, session.index, part);
    }
    if (!commit(result.parts, result.caret, current.layout, null, true, true)) return false;
    const continued: FormulaEditorSession = { ...session, mode: "add", index: result.caret, query: "", snapshot: currentFormula.current.fingerprint, range: undefined };
    activeSession.current = continued;
    setActive(continued);
    return true;
  };
  const selectRange = (range: FormulaRange | null) => {
    close(); setTransferStatus("");
    const next = range && normalizeFormulaSelection(parts, state.symbols, range.start, range.end, layout);
    setSelection(next && next.start !== next.end ? next : null);
    selectionAnchor.current = next?.start ?? null;
    if (next) setPosition(next.end);
  };
  const moveCaret = (next: number, extend = false) => {
    close(); setTransferStatus("");
    if (extend) {
      const anchor = selectionAnchor.current ?? position;
      selectionAnchor.current = anchor;
      const range = normalizeFormulaSelection(parts, state.symbols, anchor, next, layout);
      setSelection(range.start === range.end ? null : range);
    } else { setSelection(null); selectionAnchor.current = null; }
    setPosition(next);
  };
  const copySelection = (clipboard: DataTransfer, requestedRange?: FormulaRange) => {
    const range = selection ?? requestedRange;
    if (!range) { setTransferStatus("请先单击或拖动选择要复制的公式项。"); return false; }
    try {
      const copied = serializeFormulaSelection(parts, state.symbols, range, layout);
      clipboard.setData("text/plain", copied.text);
      // A cut must retain identities and source references before deleting
      // anything. An incomplete browser clipboard write leaves the formula intact.
      try {
        clipboard.setData(FORMULA_CLIPBOARD_MIME, copied.custom);
        if (clipboard.getData(FORMULA_CLIPBOARD_MIME) !== copied.custom) throw new Error();
      } catch { throw new Error("浏览器未接收完整的公式片段，请重试复制。原公式未改变。"); }
      setError(""); setTransferStatus("已复制所选公式内容");
      return true;
    } catch (problem) { setError(problem instanceof Error ? problem.message : "复制失败，请重新选择完整公式项。"); return false; }
  };
  const removeSelection = (cut = false, requestedRange?: FormulaRange) => {
    const selected = selection ?? requestedRange;
    if (!selected) return;
    const range = { ...selected };
    const expected = fingerprint;
    confirmDelete({ title: cut ? t("剪切公式内容") : t("删除公式内容"), description: t`${cut ? t("所选内容已复制。确定从公式中剪切") : t("确定删除")}选中的 ${range.end - range.start} 个公式项吗？` }, () => {
      const current = latestEdit.current;
      if (current.fingerprint !== expected) { setError("公式内容已变更，请重新选择公式项。"); surfaceRef.current?.focus(); return; }
      const result = replaceFormulaSelection(current.parts, range, [], { state: current.state, owner: current.owner, layout: current.layout });
      if (result.error) { setError(result.error); surfaceRef.current?.focus(); return; }
      if (current.commit(result.parts, result.caret)) setTransferStatus(cut ? "已剪切所选内容，可粘贴或撤销" : "已删除所选内容，可撤销");
    });
  };
  const pasteSelection = (clipboard: DataTransfer) => {
    const customType = Array.from(clipboard.types).find((type) => type.toLowerCase() === FORMULA_CLIPBOARD_MIME);
    const custom = customType ? clipboard.getData(customType) : "";
    const parsed = parseFormulaClipboardData({ custom: custom.trim() ? custom : undefined, text: clipboard.getData("text/plain") }, state.symbols);
    if (parsed.error || !parsed.parts) { setError(parsed.error ?? "剪贴板中没有可识别的公式片段。"); return; }
    const range = selection ?? { start: position, end: position };
    const nextLayout = range.start === 0 && range.end === parts.length ? parsed.layout ?? layout : layout;
    const result = replaceFormulaSelection(parts, range, parsed.parts, { state, owner, layout: nextLayout });
    if (result.error) { setError(result.error); return; }
    if (commit(result.parts, result.caret, nextLayout)) setTransferStatus("已粘贴公式内容，可撤销");
  };
  const insertTexDraft = (parsed: FormulaClipboardParseResult): string | null => {
    const current = currentFormula.current;
    if (!texInput || texInput.snapshot !== current.fingerprint) return "公式内容已变更，请重新打开 LaTeX 输入区选择插入位置。";
    if (!parsed.parts?.length || parsed.error) return parsed.error ?? "请先输入完整公式。";
    const range = texInput.range;
    const nextLayout = range.start === 0 && range.end === current.parts.length ? parsed.layout ?? current.layout : current.layout;
    const result = replaceFormulaSelection(current.parts, range, parsed.parts, { state: current.state, owner: current.owner, layout: nextLayout });
    if (result.error) return result.error;
    if (!commit(result.parts, result.caret, nextLayout)) return "公式无法插入，请检查符号和结构。";
    setTransferStatus("已插入 LaTeX 公式，可撤销");
    return null;
  };
  const moveSelection = (range: FormulaRange, target: number, snapshot: string) => {
    if (JSON.stringify(parts) !== snapshot) { setError("公式内容已变更，请重新拖动。"); return; }
    const result = moveFormulaSelection(parts, range, target, { state, owner, layout });
    if (result.error) { setError(result.error); return; }
    if (result.changed && commit(result.parts, result.caret, layout, result.selection)) setTransferStatus("已移动公式内容，可撤销");
  };
  const restoreHistory = (direction: "undo" | "redo") => {
    const stack = history.current[direction];
    const snapshot = stack.at(-1);
    if (!snapshot) { setTransferStatus(direction === "undo" ? "暂无可撤销的公式修改" : "暂无可重做的公式修改"); return; }
    const current = takeSnapshot();
    if (commit(snapshot.parts, snapshot.position, snapshot.layout, snapshot.selection, false)) {
      stack.pop(); history.current[direction === "undo" ? "redo" : "undo"].push(current);
      setTransferStatus(direction === "undo" ? "已撤销公式修改" : "已重做公式修改");
    }
  };
  return (
    <div className="research-formula-composer">
      <div className={"research-formula-inline-expression" + (isEditing && !readOnly ? " is-editing" : "")} aria-label={t("公式预览")}
        onKeyDown={event => {
          if (!onComplete || !isEditing || readOnly || event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (!(event.target instanceof Element) || !event.target.closest(".research-formula-interactive-expression")) return;
          event.preventDefault(); event.stopPropagation();
          close(); closeSettings(); closeInspection(); setIsEditing(false); onComplete();
        }}>
        {isEditing && !readOnly
          ? block.parts !== undefined
            ? <FormulaCaretSurface parts={parts} symbols={state.symbols} position={position} selection={selection} layout={layout} onPosition={moveCaret} onSelect={selectRange} onInsert={openInsert} onInsertStructure={insertStructure} onLayout={changeLayout} onEdit={openPart} onRemove={removeAt} onRemoveSelection={() => removeSelection()} onCopy={copySelection} onCut={(clipboard, range) => { if (copySelection(clipboard, range)) removeSelection(true, range); }} onPaste={pasteSelection} onMove={moveSelection} onHistory={restoreHistory} onTexInput={toggleTexInput} texInputId={texInputId} texInputOpen={!!texInput} apiRef={surfaceRef} />
            : <div className="research-formula-tex-editor">
              <label>{t("公式 LaTeX")}<textarea ref={texRef} aria-label={t("公式 LaTeX")} value={texDraft} rows={3} spellCheck={false}
                onChange={event => { setTexDraft(event.target.value); setError(""); }}
                onKeyDown={event => {
                  if (event.key === "Escape") {
                    event.preventDefault(); event.stopPropagation();
                    if (!event.nativeEvent.isComposing) cancelTexEdit();
                  } else if (!event.nativeEvent.isComposing && event.keyCode !== 229 && event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
                    event.preventDefault(); event.stopPropagation();
                    if (saveTex()) onComplete?.();
                  }
                }} /></label>
              <div className="research-formula-inline-editor-actions">
                <button type="button" onClick={cancelTexEdit}>{t("取消公式编辑")}</button>
                <button type="button" onClick={saveTex}>{t("保存公式")}</button>
              </div>
            </div>
          : block.parts !== undefined ? <FormulaReadSurface parts={parts} symbols={state.symbols} layout={layout} onInspect={(index, target) => {
            close(); closeSettings(); setInspection((previous) => previous?.index === index ? null : { index, target });
          }} /> : <div className="research-formula-read-expression"><Formula tex={block.tex} block /></div>}
      </div>
      {!readOnly && isEditing && block.parts !== undefined && texInput && <ResearchFormulaTexInput id={texInputId} symbols={state.symbols} onInsert={insertTexDraft} onCancel={() => close(true)} />}
      {openRecipePanel && block.parts === undefined && !!block.outputs?.length && <div className="research-formula-result-recipes">{block.outputs.map(output => <button key={output.id} type="button" aria-label={t("查看公式结果的变量配方 ") + (state.symbols.find(entry => entry.id === output.entryId)?.name ?? t("未知符号"))} onClick={event => {
        close(); closeSettings(); closeInspection();
        openRecipePanel({ owner, part: { type: "symbol", entryId: output.entryId, bindings: output.bindings }, target: event.currentTarget });
      }}>{t("变量配方 ·")} {state.symbols.find(entry => entry.id === output.entryId)?.name ?? t("未知符号")}</button>)}</div>}
      <button type="button" data-ui="icon-action" className="research-formula-copy-button" aria-label={copyStatus === "copied" ? t("公式 LaTeX 已复制") : t("复制公式 LaTeX")}
        title={copyStatus === "copied" ? t("已复制 LaTeX") : copyStatus === "error" ? t("复制失败，点击重试") : t("复制公式 LaTeX")}
        onClick={() => void copyFormula()}>{copyStatus === "copied" ? <Check size={13} /> : <Copy size={13} />}</button>
      <span role="status" className={copyStatus === "error" ? "research-formula-copy-error" : "visually-hidden"}>{copyStatus === "copied" ? t("公式 LaTeX 已复制") : copyStatus === "error" ? t("复制失败，请允许浏览器访问剪贴板后重试。") : ""}</span>
      {!readOnly && <button type="button" ref={editRef} data-ui="icon-action" className="research-remove-block research-formula-edit-button" aria-label={isEditing ? t("完成公式编辑") : t("编辑公式")} aria-pressed={isEditing}
        title={isEditing ? t("完成公式编辑") : t("编辑公式")} onClick={() => {
          close(); closeSettings(); closeInspection();
          if (isEditing && block.parts === undefined) { saveTex(); return; }
          setTexDraft(block.tex);
          setPosition(parts.length);
          setSelection(null);
          selectionAnchor.current = null;
          setTransferStatus("");
          setIsEditing(value => !value);
        }}>{isEditing && block.parts === undefined ? <Check size={13} /> : <Pencil size={13} />}</button>}
      {!readOnly && <button data-ui="icon-action" ref={settingsRef} className="research-remove-block research-formula-settings-button" aria-label={t("公式设置")} title={t("公式设置")}
        aria-expanded={settingsOpen} aria-haspopup="dialog" aria-controls={settingsOpen ? "formula-settings-" + block.id : undefined}
        onClick={() => { close(); closeInspection(); setSettingsOpen((value) => !value); }}><Settings size={13} /></button>}
      {!readOnly && isEditing && error && <p className="research-formula-error" role="alert">{localizeError(error)}</p>}
      {!readOnly && isEditing && transferStatus && <p className="research-formula-transfer-status" role="status">{transferStatus}</p>}
      {!readOnly && isEditing && <p className="research-formula-caret-hint" title={block.parts === undefined ? undefined : t("单击选择单项，拖动选择多项；拖动已选内容移动，双击编辑。Ctrl/Cmd+C/X/V 复制、剪切和粘贴；Ctrl/Cmd+V 也可导入 TeX，Ctrl/Cmd+Z 撤销。")}>{block.parts === undefined ? t("Ctrl/Cmd+Enter 保存并插入下一块 · Esc 取消") : t("回车插入 · Ctrl/Cmd+Enter 下一块 · 单击或拖动选择 · Ctrl/Cmd+V 粘贴 TeX")}</p>}
      {block.caption?.trim() && <p className="research-formula-caption">{block.caption}</p>}
      {!readOnly && settingsOpen && <FormulaSettingsPopover block={block} state={state} owner={owner} triggerRef={settingsRef} onCancel={closeSettings} onOpenFormula={openFormula}
        onSave={(patch) => { onPatch(patch); closeSettings(true); }} />}
      {inspection && parts[inspection.index]?.type === "symbol" && <FormulaSymbolPopover key={inspection.index} state={state} owner={owner} part={parts[inspection.index] as Extract<FormulaPart, { type: "symbol" }>} target={inspection.target} onCancel={closeInspection} onOpenFormula={openFormula} onOpenRecipe={openRecipePanel ? () => {
        openRecipePanel({ owner, part: parts[inspection.index] as Extract<FormulaPart, { type: "symbol" }>, target: inspection.target }); closeInspection();
      } : undefined} />}
      {!readOnly && active && draft && <ResearchFormulaItemEditor key={active.id} part={draft} mode={active.mode} state={state} owner={owner} initialQuery={active.query} error={localizeError(error)} onOpenFormula={openFormula}
        getAnchor={() => active.anchor}
        onCancel={close} onSave={save} onDelete={active.mode === "edit" ? () => removeAt(active.index) : undefined} />}
    </div>
  );
}

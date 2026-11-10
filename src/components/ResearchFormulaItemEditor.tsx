import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Info, PanelRightClose, PanelRightOpen, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Formula } from "./Formula.tsx";
import ResearchFormulaSymbolPicker from "./ResearchFormulaSymbolPicker.tsx";
import { FormulaSourceSelector } from "./ResearchFormulaRelations.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import { formulaOperators, type FormulaPart, type ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import { formulaLatexError } from "../domain/formulaLatex.ts";
import { formulaOperatorPalette } from "./formulaOperatorPalette.ts";
import { frequentFormulaOperators, loadFormulaOperatorUsage, recordFormulaOperatorUse } from "../state/formulaOperatorUsage.ts";
import { type ResearchNotebookState } from "../domain/researchNotebook.ts";
import { type FormulaAddress } from "../domain/researchFormulaLinks.ts";
import { symbolPositions } from "../domain/researchSymbolPositions.ts";
import { annotateSymbolDiagram, markSymbolDiagram } from "./researchSymbolDiagramModel.ts";
import "./ResearchFormulaItemEditor.css";

type FormulaEditablePart = Extract<FormulaPart, { type: "symbol" | "operator" | "latex" }>;
type SymbolPart = Extract<FormulaPart, { type: "symbol" }>;
type SymbolPositionKey = (typeof symbolPositions)[number]["key"];

export interface ResearchFormulaItemEditorProps {
  part: FormulaEditablePart;
  mode: "add" | "edit";
  state: ResearchNotebookState;
  owner: FormulaAddress;
  initialQuery: string;
  error: string;
  getAnchor: () => { left: number; top: number; bottom: number };
  onCancel: (restoreFocus?: boolean) => void;
  onSave: (part: FormulaEditablePart) => boolean;
  onDelete?: () => void;
  onOpenFormula: (address: FormulaAddress) => void;
}

type SlotEditor = { key: SymbolPositionKey; value: string };
type PositionRect = { left: number; top: number; width: number; height: number };

const positionLabels: () => Record<SymbolPositionKey, string> = () => ({
  x1: t("右上角标"),
  x2: t("右下角标"),
  x3: t("右侧变量"),
});

function entryBindings(entry: ResearchSymbolEntry) {
  return Object.fromEntries(entry.slots.map((slot) => [slot.key, slot.defaultValue]));
}

/** Shared formula palette with a dictionary tree, visual positions and operators. */
export function ResearchFormulaItemEditor({
  part: initialPart, mode, state, owner, initialQuery, error, getAnchor, onCancel, onSave, onDelete, onOpenFormula,
}: ResearchFormulaItemEditorProps) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const latexInputRef = useRef<HTMLInputElement>(null);
  const slotInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const slotPopupRef = useRef<HTMLDivElement>(null);
  const positionButtons = useRef<Partial<Record<SymbolPositionKey, HTMLButtonElement | null>>>({});
  const [part, setSymbolPart] = useState<SymbolPart>(() => initialPart.type === "symbol"
    ? { ...initialPart, bindings: { ...initialPart.bindings } }
    : { type: "symbol", entryId: state.symbols[0]?.id ?? "", bindings: state.symbols[0] ? entryBindings(state.symbols[0]) : {} });
  const [query, setQuery] = useState(initialQuery);
  const [explicitSymbolChoice, setExplicitSymbolChoice] = useState(initialPart.type === "symbol");
  const [slotEditor, setSlotEditor] = useState<SlotEditor | null>(null);
  const [positionRects, setPositionRects] = useState<Partial<Record<SymbolPositionKey, PositionRect>>>({});
  const [inserted, setInserted] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedId = useId();
  const [operatorsOpen, setOperatorsOpen] = useState(true);
  const operatorPanelId = useId();
  // Keep the keyboard stable while open; newly frequent keys appear on reopening.
  const [operatorPalette] = useState(() => {
    const keys = new Map(formulaOperatorPalette.flatMap(group => group.keys.map(key => [key.id, key] as const)));
    const frequent = frequentFormulaOperators(loadFormulaOperatorUsage()).flatMap(id => keys.has(id) ? [keys.get(id)!] : []);
    return frequent.length ? [{ label: "常用", shortLabel: "常用", keys: frequent }, ...formulaOperatorPalette] : formulaOperatorPalette;
  });
  const [latex, setLatex] = useState(() => {
    const value = initialPart.type === "latex" ? initialPart.tex
      : mode === "edit" && initialPart.type === "operator" ? formulaOperators.find(item => item.id === initialPart.operator)?.tex ?? "" : "";
    return value && !formulaLatexError(value) ? value : "";
  });
  const latexError = useMemo(() => formulaLatexError(latex), [latex]);

  useFormulaPopover({ ref, getAnchor, onCancel, draggable: true });
  useEffect(() => { if (initialPart.type === "latex") latexInputRef.current?.focus({ preventScroll: true }); }, [initialPart.type]);

  const symbol = state.symbols.find((entry) => entry.id === part.entryId);
  const replacingOperator = mode === "edit" && initialPart.type !== "symbol";
  const symbolChosen = !!symbol && (!replacingOperator || explicitSymbolChoice);
  useLayoutEffect(() => {
    if (slotEditor) slotInputRef.current?.focus({ preventScroll: true });
  }, [slotEditor]);

  // useFormulaPopover installs an Escape listener on document.  A slot editor
  // is nested inside this popover, so handle Escape one capture phase earlier
  // to cancel only the slot draft and keep the main editor open.
  useEffect(() => {
    const cancelSlot = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.isComposing || event.keyCode === 229) { event.stopImmediatePropagation(); return; }
      if (!slotEditor) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSlotEditor(null);
      positionButtons.current[slotEditor.key]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", cancelSlot, true);
    return () => window.removeEventListener("keydown", cancelSlot, true);
  }, [slotEditor]);

  const chooseSymbol = (entryId: string) => {
    const entry = state.symbols.find((value) => value.id === entryId);
    if (!entry) return;
    const next: SymbolPart = part.entryId === entry.id
      ? slotEditor ? { ...part, bindings: { ...part.bindings, [slotEditor.key]: slotEditor.value } } : part
      : { type: "symbol", entryId: entry.id, bindings: entryBindings(entry) };
    setSymbolPart(next);
    setSlotEditor(null);
    setExplicitSymbolChoice(true);
    if (mode === "add" && onSave(next)) setInserted(value => value + 1);
  };

  const previewBindings = useMemo(() => slotEditor
    ? { ...part.bindings, [slotEditor.key]: slotEditor.value }
    : part.bindings, [part, slotEditor]);
  const preview = useMemo(() => symbol ? markSymbolDiagram(symbol, previewBindings) : undefined, [symbol, previewBindings]);
  const previewTex = preview?.tex;
  const previewMarkedTex = preview?.markedTex;

  useLayoutEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !previewMarkedTex) return;
    const measure = () => {
      const targets = annotateSymbolDiagram(canvas, previewMarkedTex);
      const origin = canvas.getBoundingClientRect();
      const bounds = (items: (Element | Range)[]) => {
        const rects = items.flatMap((item) => [...item.getClientRects()]).filter((rect) => rect.width > 0 && rect.height > 0);
        if (!rects.length) return undefined;
        const left = Math.max(origin.left, Math.min(...rects.map((rect) => rect.left)));
        const right = Math.min(origin.right, Math.max(...rects.map((rect) => rect.right)));
        if (right <= left) return undefined;
        const top = Math.min(...rects.map((rect) => rect.top));
        return { left: left - origin.left, top: top - origin.top, width: right - left, height: Math.max(...rects.map((rect) => rect.bottom)) - top };
      };
      const body = bounds(targets.body) ?? { left: 48, top: 28, width: 24, height: 24 };
      const actualPositions = Object.fromEntries(symbolPositions.map(({ key }) => [key, bounds(targets[key])])) as Partial<Record<SymbolPositionKey, PositionRect>>;
      const occupied = [body, ...Object.values(actualPositions).filter((rect): rect is PositionRect => !!rect)];
      const upperEdge = Math.min(...occupied.map((rect) => rect.top));
      const lowerEdge = Math.max(...occupied.map((rect) => rect.top + rect.height));
      const next: Partial<Record<SymbolPositionKey, PositionRect>> = {};
      for (const { key } of symbolPositions) {
        const actual = actualPositions[key];
        if (actual) {
          const left = Math.max(0, actual.left - 1);
          let top = actual.top - 1, bottom = actual.top + actual.height + 1;
          const upper = actualPositions.x1, lower = actualPositions.x2;
          if (upper && lower) {
            const boundary = (upper.top + upper.height + lower.top) / 2;
            if (key === "x1") bottom = Math.min(bottom, boundary - 1);
            if (key === "x2") top = Math.max(top, boundary + 1);
          }
          const right = key !== "x3" && actualPositions.x3 ? Math.min(left + actual.width + 2, actualPositions.x3.left - 1) : left + actual.width + 2;
          next[key] = { left, top, width: Math.max(1, Math.min(origin.width - left, right - left)), height: Math.max(1, bottom - top) };
          continue;
        }
        const x1 = actualPositions.x1, x2 = actualPositions.x2;
        const right = Math.max(body.left + body.width, x1 ? x1.left + x1.width : 0, x2 ? x2.left + x2.width : 0);
        const empty = key === "x1"
          ? { left: body.left + body.width + 1, top: upperEdge - 24, width: 20, height: 20 }
          : key === "x2"
            ? { left: body.left + body.width + 1, top: lowerEdge + 4, width: 20, height: 20 }
            : { left: right + 24, top: body.top + body.height / 2 - 10, width: 20, height: 20 };
        next[key] = { ...empty, left: Math.max(0, Math.min(origin.width - 20, empty.left)) };
      }
      setPositionRects(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    canvas.addEventListener("scroll", measure, true);
    return () => { active = false; observer.disconnect(); canvas.removeEventListener("scroll", measure, true); };
  }, [previewTex, previewMarkedTex]);

  useLayoutEffect(() => {
    if (!slotEditor) return;
    const popup = slotPopupRef.current, button = positionButtons.current[slotEditor.key];
    if (!popup || !button) return;
    const place = () => {
      const anchor = button.getBoundingClientRect(), rect = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(12, Math.min(window.innerWidth - rect.width - 12, anchor.right + 8))}px`;
      popup.style.top = `${Math.max(12, Math.min(window.innerHeight - rect.height - 12, anchor.top + anchor.height / 2 - rect.height / 2))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = new ResizeObserver(place);
    observer.observe(popup);
    if (ref.current) observer.observe(ref.current);
    // Fixed-position slot editors follow a dragged window as well as resizing.
    const movement = new MutationObserver(place);
    if (ref.current) movement.observe(ref.current, { attributes: true, attributeFilter: ["style"] });
    return () => { observer.disconnect(); movement.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [slotEditor, positionRects]);

  const openSlot = (key: SymbolPositionKey) => {
    const current = part.bindings[key] ?? "";
    setSlotEditor({ key, value: current });
  };
  const commitSlot = () => {
    if (!slotEditor) return;
    setSymbolPart({ ...part, bindings: { ...part.bindings, [slotEditor.key]: slotEditor.value } });
    setSlotEditor(null);
    positionButtons.current[slotEditor.key]?.focus({ preventScroll: true });
  };
  const saveItem = () => {
    if (!symbolChosen) return;
    const next = slotEditor ? { ...part, bindings: { ...part.bindings, [slotEditor.key]: slotEditor.value } } : part;
    if (onSave(next)) {
      setSymbolPart(next);
      setSlotEditor(null);
      setInserted(value => value + 1);
    }
  };

  return (
    <div ref={ref} className={`research-formula-inline-editor research-formula-item-editor${operatorsOpen ? "" : " is-operators-collapsed"}`} popover="manual" role="dialog"
      aria-label={mode === "add" ? t("添加公式项") : t("编辑公式项")}>
      <div className="research-formula-input-columns">
        <div className="research-formula-symbol-column">
          <ResearchFormulaSymbolPicker entries={state.symbols} selectedId={part.entryId} query={query} inputRef={queryInputRef}
            inserting={mode === "add"} onQueryChange={setQuery} onSelect={chooseSymbol} />
          <section className="research-formula-item-symbol-editor" aria-label={t("符号选择与编辑")}>
            {symbol ? <>
              <div className="research-formula-symbol-preview-heading">
                <strong>{symbol.name}</strong>
                <span className="research-formula-symbol-preview-tools">
                  <button type="button" data-ui="icon-action" aria-label={t("高级设置")} title={t("高级设置：推导来源")}
                    aria-expanded={advancedOpen} aria-controls={advancedId}
                    onClick={() => setAdvancedOpen(value => !value)}><SlidersHorizontal size={14} /></button>
                  <button type="button" data-ui="icon-action" aria-label={t("符号说明")}
                    title={[symbol.meaning, symbol.unit && t`单位：${symbol.unit}`, symbol.scope && t`范围：${symbol.scope}`, t("点击预览中的角标编辑，空位置点击 + 添加；回车完成，Esc 取消。")].filter(Boolean).join("\n")}><Info size={14} /></button>
                  <button type="button" data-ui="icon-action" className="research-definition-open"
                    onClick={() => window.dispatchEvent(new CustomEvent("research-dictionary-open", { detail: symbol.id }))}
                    aria-label={t("打开词典词条")} title={t("打开词典词条")}><BookOpen size={14} /></button>
                  <button type="button" data-ui="icon-action" aria-expanded={operatorsOpen} aria-controls={operatorPanelId}
                    aria-label={operatorsOpen ? t("收起运算符面板") : t("展开运算符面板")} title={operatorsOpen ? t("收起运算符面板") : t("展开运算符面板")}
                    onClick={() => setOperatorsOpen(value => !value)}>{operatorsOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</button>
                </span>
              </div>
              <div ref={previewRef} className="research-formula-symbol-preview" aria-label={t("符号预览")}>
                <div className="research-formula-symbol-preview-drag-area" data-popover-drag-handle="" aria-hidden="true" title={t("拖动空白处移动窗口")} />
                <Formula tex={previewTex ?? ""} block />
                {symbolPositions.map(({ key }) => positionRects[key] && <button type="button" key={key}
                  ref={(element) => { positionButtons.current[key] = element; }} style={positionRects[key]}
                  className={`research-formula-symbol-position-hit${previewBindings[key] ? " has-value" : ""}`}
                  aria-label={t`编辑${positionLabels()[key]}`} title={t`编辑${positionLabels()[key]}`}
                  onClick={() => { if (slotEditor && slotEditor.key !== key) commitSlot(); openSlot(key); }}>{!previewBindings[key] && "+"}</button>)}
                {slotEditor && <div ref={slotPopupRef} className="research-formula-symbol-slot-popover" role="dialog" data-popover-no-drag=""
                  aria-label={t`编辑${positionLabels()[slotEditor.key]}`} onPointerDown={(event) => event.stopPropagation()}>
                  <label>{positionLabels()[slotEditor.key]}<input ref={slotInputRef}
                    aria-label={t(symbol.slots.find((slot) => slot.key === slotEditor.key)?.label ?? positionLabels()[slotEditor.key])}
                    value={slotEditor.value} placeholder={symbol.slots.find((slot) => slot.key === slotEditor.key)?.defaultValue}
                    onChange={(event) => setSlotEditor({ ...slotEditor, value: event.target.value })} onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commitSlot(); }
                    }} /></label>
                  <div className="research-formula-symbol-slot-actions">
                    <button type="button" onClick={commitSlot} aria-label={t("完成位置编辑")} title={t("完成位置编辑")}><Check size={13} /></button>
                    <button type="button" onClick={() => setSlotEditor(null)} aria-label={t("取消位置编辑")} title={t("取消位置编辑")}><X size={13} /></button>
                  </div>
                </div>}
              </div>
            </> : <p className="research-formula-symbol-empty">{t("暂无符号，请先在词典中添加。")}</p>}
            {(symbol || onDelete) && <div className="research-formula-symbol-insert-actions">
              {symbol && <button type="button" className="research-symbol-save" disabled={!symbolChosen} onClick={saveItem}
                  aria-label={mode === "add" ? t("插入符号") : replacingOperator ? t("替换为符号") : t("保存公式项")}
                  title={!symbolChosen ? t("请先从候选中选择符号") : mode === "add" ? t("插入当前符号，可连续点击") : t("保存当前公式项并继续插入")}>
                  {mode === "add" ? <Plus size={14} /> : <Check size={14} />}{mode === "add" ? t("插入符号") : replacingOperator ? t("替换为符号") : t("保存修改")}
              </button>}
              {onDelete && <button type="button" className="research-symbol-delete" data-tone="danger"
                onClick={onDelete} aria-label={t("删除")} title={t("删除当前公式项")}><Trash2 size={14} />{t("删除")}</button>}
            </div>}
            {symbol && <div id={advancedId} className="research-formula-symbol-advanced" hidden={!advancedOpen}>
                <FormulaSourceSelector state={state} owner={owner} part={part} onChange={setSymbolPart} onOpenFormula={onOpenFormula} />
            </div>}
          </section>
        </div>
        <div id={operatorPanelId} className="research-formula-operator-column" hidden={!operatorsOpen} data-popover-no-drag="">
          <form className="research-formula-latex-input" aria-label={t("LaTeX 输入")} onSubmit={event => {
            event.preventDefault();
            if (latexError) return;
            if (slotEditor) commitSlot();
            if (onSave({ type: "latex", tex: latex.trim() })) setInserted(value => value + 1);
          }}>
            <div className="research-formula-latex-actions">
              <input ref={latexInputRef} aria-label={t("LaTeX 数学符号")} placeholder={t("LaTeX，如 \\alpha")} value={latex}
                onChange={event => setLatex(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
                aria-invalid={!!latex.trim() && !!latexError} title={t("输入 LaTeX，回车插入；矩阵等完整表达式也可使用")} />
              <button type="submit" aria-label={mode === "edit" ? t("替换为 LaTeX") : t("插入 LaTeX")}
                title={localizeError(latexError) || (mode === "edit" ? t("替换当前项") : t("插入 LaTeX，可连续点击"))} disabled={!!latexError}><Plus size={14} /></button>
            </div>
            {latex.trim() && (latexError ? <p className="research-formula-latex-error" role="status">{localizeError(latexError)}</p>
              : <div className="research-formula-latex-preview" aria-label={t("LaTeX 预览")}><Formula tex={latex} /></div>)}
          </form>
          <div className="research-formula-operator-palette" role="group" aria-label={t("运算符键盘")}>
          {operatorPalette.map(group => <section className="research-formula-operator-group" key={group.label} aria-label={t(group.label)}>
            <h4 title={group.label === "常用" ? t("近期多次使用的运算符，下次打开面板时更新") : t(group.label)}>{t(group.shortLabel)}</h4>
            <div className="research-formula-operator-keys">{group.keys.map(key => <button type="button" key={key.id}
              data-operator={key.id} className={mode === "edit" && initialPart.type === "operator" && initialPart.operator === key.id ? "is-current" : ""}
              aria-label={t`插入运算符 ${t(key.label)}`} title={`${mode === "edit" ? t("替换为") : t("插入")}${t(key.label)}`}
              onClick={() => {
                if (slotEditor) commitSlot();
                if (onSave({ type: "operator", operator: key.id })) {
                  recordFormulaOperatorUse(key.id);
                  setInserted(value => value + 1);
                }
              }}><Formula tex={key.preview} /></button>)}</div>
          </section>)}
          </div>
        </div>
      </div>
      {error && <p className="research-formula-error" role="alert">{localizeError(error)}</p>}
      <span role="status" className="visually-hidden">{inserted ? t`已写入 ${inserted} 次，可继续输入` : ""}</span>
    </div>
  );
}

export default ResearchFormulaItemEditor;

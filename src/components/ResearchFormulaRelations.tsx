import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useLayoutEffect, useMemo, useRef } from "react";
import ResearchSelectionField from './ResearchSelectionField.tsx';
import { researchSymbolChoice } from './researchChoices.ts';
import { researchFormulaChoices } from './researchFormulaChoices.ts';
import { ArrowUpRight, BookOpen, ChevronRight, FileText, Plus, SquareFunction, Trash2 } from "lucide-react";
import { Formula } from "./Formula.tsx";
import ResearchMathText from "./ResearchMathText.tsx";
import { VariableRecipePreview, VariableRecipeSettings } from "./ResearchVariableRecipe.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import { InlineSymbolDetailsContext } from "./ResearchInlineSymbolContext.ts";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import { buildFormulaEditModel } from "../domain/formulaEditing.ts";
import { formulaPartsToTex, resolveSymbolEntry, type FormulaLayout, type FormulaOutput, type FormulaPart, type ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import { renderedFormulaTex, type ResearchNotebookState, type ResearchFormulaBlock } from "../domain/researchNotebook.ts";
import { formulaSourceError, formulaSourceKey, listFormulaConsumers, listFormulaOutputs, researchFormulaTitle, resolveFormulaSource, sourceIndexMapping, type FormulaAddress, type SymbolPart } from "../domain/researchFormulaLinks.ts";
import { listVariableRecipes } from "../domain/researchVariableRecipes.ts";

export function FormulaReadSurface({ parts, symbols, layout = "aligned", onInspect }: {
  parts: FormulaPart[];
  symbols: ResearchSymbolEntry[];
  layout?: FormulaLayout;
  onInspect: (index: number, element: HTMLElement) => void;
}) {
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildFormulaEditModel(parts, symbols, layout), [parts, symbols, layout]);
  useLayoutEffect(() => {
    // The interactive HTML carries the focusable symbol controls; expose it instead of the duplicate MathML.
    ref.current?.querySelector(".katex-html")?.removeAttribute("aria-hidden");
    ref.current?.querySelector(".katex-mathml")?.setAttribute("aria-hidden", "true");
    for (const { index, selector } of model.targets) {
      const part = parts[index];
      if (part.type !== "symbol") continue;
      const element = ref.current?.querySelector<HTMLElement>(selector);
      if (!element) continue;
      const name = symbols.find((entry) => entry.id === part.entryId)?.name ?? t("未知符号");
      element.dataset.formulaIndex = String(index);
      element.tabIndex = 0;
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", t("查看符号 ") + name);
      element.title = t("查看含义与推导来源");
    }
  }, [model, parts, symbols, locale]);
  const inspect = (target: EventTarget) => {
    const element = target instanceof Element ? target.closest<HTMLElement>("[data-formula-index]") : null;
    if (element) onInspect(Number(element.dataset.formulaIndex), element);
  };
  return <div ref={ref} className="research-formula-read-expression" onClick={(event) => inspect(event.target)} onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(event.target); }
  }}><Formula tex={formulaPartsToTex(parts, symbols, layout).tex} markedTex={model.tex} block interactive /></div>;
}

function FormulaSourcePreview({ state, owner, part, onOpenFormula, showHeading = false }: {
  state: ResearchNotebookState;
  owner: FormulaAddress;
  part: SymbolPart;
  onOpenFormula: (address: FormulaAddress) => void;
  showHeading?: boolean;
}) {
  useLocale();
  const source = part.source && resolveFormulaSource(state, part.source);
  const entry = state.symbols.find((item) => item.id === part.entryId);
  const error = formulaSourceError(state, owner, part);
  const jump = !error && source && entry && <button type="button" className="research-formula-preview-button" onClick={() => onOpenFormula(source.reference)} aria-label={t("跳转来源公式")} title={t("跳转来源公式")}><ArrowUpRight size={14} />{t("跳转来源")}<ChevronRight size={14} /></button>;
  const heading = showHeading && <div className="research-formula-relation-heading"><strong>{t("推导来源")}</strong>{jump}</div>;
  if (!part.source) return <>{heading}<p className="research-formula-relation-hint">{listVariableRecipes(state, owner, part).selected ? t("当前公式已将此变量声明为结果，可逐层查看它的输入。") : t("未关联推导来源，当前仅使用词典定义。")}</p></>;
  if (error || !source || !entry) return <>{heading}<p className="research-formula-error" role="alert">{localizeError(error) || t("来源不存在")}</p></>;
  const mapping = sourceIndexMapping(entry, source.output, part);
  return <>{heading}<section className="research-formula-source-preview" aria-label={t("来源公式预览")}>
    <div className="research-formula-source-equation"><Formula tex={renderedFormulaTex(source.formula, state.symbols).tex} block /></div>
    <div className="research-formula-source-metadata" role="group" aria-label={t("公式来源信息")}>
      <span title={t("来源笔记")}><FileText size={14} aria-hidden="true" /><span>{source.note.title}</span></span>
      <span title={t("来源公式")}><SquareFunction size={14} aria-hidden="true" /><span>{researchFormulaTitle(source.formula, source.note)}</span></span>
    </div>
    {source.formula.conditions?.trim() && <p className="research-formula-source-conditions"><strong>{t("适用条件")}</strong><ResearchMathText text={source.formula.conditions} /></p>}
    {mapping.length > 0 && <dl className="research-formula-index-mapping" aria-label={t("索引对应")}>{mapping.map((item) => <div key={item.key}>
      <dt>{t(item.label)}</dt><dd><Formula tex={item.from} /><span>→</span><Formula tex={item.to} /></dd>
    </div>)}</dl>}
    {!showHeading && jump}
  </section></>;
}

export function FormulaSourceSelector({ state, owner, part, onChange, onOpenFormula }: {
  state: ResearchNotebookState;
  owner: FormulaAddress;
  part: SymbolPart;
  onChange: (part: SymbolPart) => void;
  onOpenFormula: (address: FormulaAddress) => void;
}) {
  useLocale();
  const candidates = listFormulaOutputs(state, part.entryId, owner);
  const selected = part.source ? formulaSourceKey(part.source) : "";
  const missing = selected && !candidates.some((candidate) => formulaSourceKey(candidate.reference) === selected);
  return <div className="research-formula-source-picker">
    <label>{t("推导来源")}<ResearchSelectionField storageKey="mewiki:selection-folds:推导来源" label={t("推导来源")} value={selected} emptyLabel={missing ? t('已关联的来源失效，请重新选择') : t('仅使用词典定义')} choices={[...researchFormulaChoices(candidates), { id: '', label: t('仅使用词典定义'), searchText: t('仅使用词典定义') }]} onChange={id => {
      const candidate = candidates.find((item) => formulaSourceKey(item.reference) === id);
      const { source: _previous, ...symbol } = part;
      onChange(candidate ? { ...symbol, source: candidate.reference } : symbol);
    }} /></label>
    {!candidates.length && !part.source && <p className="research-formula-relation-hint">{t("尚无可用结果。先在来源公式的设置中声明此符号；循环依赖的公式不列入候选。")}</p>}
    <FormulaSourcePreview state={state} owner={owner} part={part} onOpenFormula={onOpenFormula} />
  </div>;
}

export function FormulaSymbolPopover({ state, owner, part, target, instanceTex, onCancel, onOpenFormula, onOpenRecipe }: {
  state: ResearchNotebookState;
  owner?: FormulaAddress;
  part: SymbolPart;
  target: HTMLElement;
  instanceTex?: string;
  onCancel: (restoreFocus?: boolean) => void;
  onOpenFormula: (address: FormulaAddress) => void;
  onOpenRecipe?: () => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef(target);
  useFormulaPopover({ ref, getAnchor: () => target.getBoundingClientRect(), onCancel, triggerRef });
  useLayoutEffect(() => { if (!owner) ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); }, [owner]);
  const entry = state.symbols.find((item) => item.id === part.entryId);
  const definitions = owner ? [] : listFormulaOutputs(state, part.entryId);
  return <InlineSymbolDetailsContext.Provider value={false}><div ref={ref} className="research-formula-inline-editor research-formula-symbol-popover" popover="manual" role="dialog" aria-label={t("符号含义与推导来源")}>
    <header className="research-formula-symbol-heading">
      <strong className="research-formula-settings-heading">{entry?.name ?? t("未知符号")}</strong>
      {entry && <button data-ui="icon-action" className="research-formula-dictionary-button" aria-label={t("打开词典词条")} title={t("打开词典词条")}
        onClick={() => { onCancel(); window.dispatchEvent(new CustomEvent("research-dictionary-open", { detail: entry.id })); }}><BookOpen size={14} /></button>}
    </header>
    {entry && <><div className="research-formula-symbol-instance"><Formula tex={instanceTex ?? resolveSymbolEntry(entry, part.bindings).tex} block /></div><p className="research-formula-symbol-meaning"><ResearchMathText text={entry.meaning} /></p>
      {(entry.unit || entry.scope) && <p className="research-formula-relation-hint">{[entry.unit, entry.scope].filter(Boolean).join(" · ")}</p>}</>}
    {onOpenRecipe && owner && <VariableRecipePreview state={state} owner={owner} part={part} onOpen={onOpenRecipe} />}
    {owner ? <FormulaSourcePreview state={state} owner={owner} part={part} onOpenFormula={onOpenFormula} showHeading />
      : <><div className="research-formula-relation-heading">{t("定义与计算公式")}</div>{definitions.length ? <div className="research-inline-symbol-definitions">{definitions.map(definition => <button type="button" key={formulaSourceKey(definition.reference)} onClick={() => onOpenFormula(definition.reference)}>
        <span>{definition.note.title} · {researchFormulaTitle(definition.formula, definition.note)}</span><ArrowUpRight size={13} aria-hidden="true" />
      </button>)}</div> : <p className="research-formula-relation-hint">{t("当前仅使用词典定义，尚无已声明的定义或计算公式。")}</p>}</>}
  </div></InlineSymbolDetailsContext.Provider>;
}

export function FormulaResultSettings({ state, owner, block, outputs, onChange, onOpenFormula }: {
  state: ResearchNotebookState;
  owner: FormulaAddress;
  block: ResearchFormulaBlock;
  outputs: FormulaOutput[];
  onChange: (outputs: FormulaOutput[]) => void;
  onOpenFormula: (address: FormulaAddress) => void;
}) {
  useLocale();
  const confirmDelete = useDeleteConfirmation();
  const latest = useRef({ state, owner, outputs, onChange });
  useLayoutEffect(() => { latest.current = { state, owner, outputs, onChange }; }, [state, owner, outputs, onChange]);
  const consumers = listFormulaConsumers(state, owner);
  const patch = (index: number, update: Partial<FormulaOutput>) => onChange(outputs.map((output, at) => at === index ? { ...output, ...update } : output));
  const add = () => {
    const first = block.parts?.find((part) => part.type === "symbol");
    const entry = state.symbols.find((item) => item.id === (first?.type === "symbol" ? first.entryId : "")) ?? state.symbols[0];
    if (entry) onChange([...outputs, { id: crypto.randomUUID(), entryId: entry.id, bindings: first?.type === "symbol" && first.entryId === entry.id ? { ...first.bindings } : Object.fromEntries(entry.slots.map((slot) => [slot.key, slot.defaultValue])) }]);
  };
  const uniqueConsumers = consumers.filter((use, index) => consumers.findIndex((other) => other.noteId === use.noteId && other.formulaId === use.formulaId) === index);
  return <section className="research-formula-result-settings" aria-label={t("公式结果")}>
    <div className="research-formula-results-heading"><strong>{t("结果符号")}</strong><button data-ui="icon-action" className="research-definition-open" disabled={!state.symbols.length} onClick={add} aria-label={t("添加结果符号")} title={t("添加结果符号")}><Plus size={12} /></button></div>
    {!outputs.length && <p className="research-formula-relation-hint">{t("选择此公式定义或求解的量。允许多个结果，约束或中间推导也可以不声明结果。")}</p>}
    {outputs.map((output, index) => {
      const entry = state.symbols.find((item) => item.id === output.entryId);
      const used = consumers.some((consumer) => consumer.outputId === output.id);
      return <div className="research-formula-result-row" key={output.id}>
        <div className="research-formula-result-select"><label>{t("结果符号")} {index + 1}<ResearchSelectionField storageKey={`mewiki:selection-folds:结果符号 ${index + 1}`} label={t("结果符号 ") + (index + 1)} value={output.entryId} disabled={used} emptyLabel={t("缺少词条")} choices={state.symbols.map(researchSymbolChoice)} onChange={id => {
          const symbol = state.symbols.find((item) => item.id === id)!;
          patch(index, { entryId: symbol.id, bindings: Object.fromEntries(symbol.slots.map((slot) => [slot.key, slot.defaultValue])), recipe: undefined });
        }} /></label>
          <button data-tone="danger" data-ui="icon-action" className="research-remove-block" aria-label={t("移除结果 ") + (index + 1)} disabled={used} title={used ? t("该结果仍被其他公式引用") : t("移除此结果声明")} onClick={() => confirmDelete({ title: t("移除公式结果"), description: t`确定移除结果 ${index + 1}“${entry?.name || t("未命名结果")}”的声明吗？公式正文和符号词条会保留。` }, () => {
            const current = latest.current;
            if (listFormulaConsumers(current.state, current.owner).some(consumer => consumer.outputId === output.id)) return;
            current.onChange(current.outputs.filter(item => item.id !== output.id));
          })}><Trash2 size={13} /></button></div>
        {entry && <><div className="research-formula-result-bindings">{entry.slots.map((slot) => <label key={slot.key}>{t(slot.label)}<input aria-label={t("结果 ") + (index + 1) + " " + t(slot.label)} value={output.bindings[slot.key] ?? ""} onChange={(event) => patch(index, { bindings: { ...output.bindings, [slot.key]: event.target.value }, recipe: undefined })} /></label>)}</div>
          <div className="research-formula-result-preview"><Formula tex={resolveSymbolEntry(entry, output.bindings).tex} /></div>
          <VariableRecipeSettings state={state} owner={owner} block={{ ...block, outputs }} output={output} index={index} onChange={next => onChange(outputs.map(item => item.id === output.id ? next : item))} /></>}
      </div>;
    })}
    {uniqueConsumers.length > 0 && <div className="research-formula-consumers"><strong>{t("使用此结果的公式")}</strong>{uniqueConsumers.map((use) => <button className="research-definition-open" key={use.noteId + ":" + use.formulaId} onClick={() => onOpenFormula(use)}>{use.noteTitle} · {researchFormulaTitle(use.formula, state.notes.find((note) => note.id === use.noteId)!)}<ArrowUpRight size={12} /></button>)}</div>}
  </section>;
}

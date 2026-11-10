import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useMemo, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { listSymbolUses, resolveSymbolEntry, type ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import { findResearchFormula, listFormulaOutputs, researchFormulaTitle, type FormulaAddress } from "../domain/researchFormulaLinks.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import { Formula } from "./Formula.tsx";
import "./ResearchOutline.css";

export default function ResearchSymbolBacklinks({ state, entry, onOpenFormula, onClose, recipe, recipeActive = false, onRecipeActiveChange }: {
  state: ResearchNotebookState;
  entry: ResearchSymbolEntry;
  onOpenFormula: (address: FormulaAddress) => void;
  onClose: () => void;
  recipe?: ReactNode;
  recipeActive?: boolean;
  onRecipeActiveChange?: (active: boolean) => void;
}) {
  useLocale();
  const definitions = useMemo(() => listFormulaOutputs(state, entry.id), [state, entry.id]);
  const appearances = useMemo(() => listSymbolUses(state.notes, entry.id).flatMap(use => {
    const found = findResearchFormula(state, { noteId: use.noteId, formulaId: use.blockId });
    if (!found || !found.formula.parts?.some(part => part.type === "symbol" && part.entryId === entry.id && (part.source || !found.formula.outputs?.some(output => output.entryId === entry.id)))) return [];
    return [{ ...use, ...found }];
  }), [state, entry.id]);

  return <aside id="research-note-outline" className="research-note-outline research-symbol-backlinks" aria-label={t("符号反向链接")} onKeyDown={event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); onClose();
  }}>
    <header><div className="research-outline-tabs" role="tablist" aria-label={t("符号右侧面板")}>
      <button id="research-symbol-backlinks-tab" type="button" role="tab" aria-selected={!recipeActive} aria-controls="research-symbol-backlinks-panel" onClick={() => onRecipeActiveChange?.(false)}>{t("反向链接")}</button>
      {recipe && <button id="research-symbol-recipe-tab" type="button" role="tab" aria-selected={recipeActive} aria-controls="research-symbol-recipe-panel" onClick={() => onRecipeActiveChange?.(true)}>{t("变量配方")}</button>}
    </div></header>
    {recipe && <div id="research-symbol-recipe-panel" className="research-outline-recipe-panel" role="tabpanel" aria-labelledby="research-symbol-recipe-tab" hidden={!recipeActive}>{recipe}</div>}
    <div id="research-symbol-backlinks-panel" className="research-symbol-backlinks-content" role="tabpanel" aria-labelledby="research-symbol-backlinks-tab" hidden={recipeActive}>
      <p className="research-symbol-backlinks-name">{entry.name}</p>
      <nav aria-label={t("定义与计算公式")}>
        <h3>{t("定义与计算公式")}</h3>
        {definitions.length ? <ol className="research-note-backlinks">{definitions.map(definition => <li key={JSON.stringify([definition.note.id, definition.formula.id, definition.output.id])}>
          <button type="button" onClick={() => onOpenFormula(definition.reference)}>
            <strong><FileText size={14} aria-hidden="true" />{definition.note.title || t("未命名笔记")}</strong>
            <span>{researchFormulaTitle(definition.formula, definition.note)}</span>
            <Formula className="research-symbol-backlink-result" tex={resolveSymbolEntry(entry, definition.output.bindings).tex} />
          </button>
        </li>)}</ol> : <p className="research-outline-empty">{t("暂无定义或计算公式。")}<span>{t("在公式中将此符号声明为结果后，会在这里显示。")}</span></p>}
      </nav>
      <nav aria-label={t("使用此符号的公式")}>
        <h3>{t("使用此符号的公式")}</h3>
        {appearances.length ? <ol className="research-note-backlinks">{appearances.map(use => <li key={JSON.stringify([use.noteId, use.blockId])}>
          <button type="button" onClick={() => onOpenFormula({ noteId: use.noteId, formulaId: use.blockId })}>
            <strong><FileText size={14} aria-hidden="true" />{use.noteTitle || t("未命名笔记")}</strong>
            <span>{researchFormulaTitle(use.formula, use.note)}</span>
          </button>
        </li>)}</ol> : <p className="research-outline-empty">{t("暂无公式使用此符号。")}<span>{t("在笔记公式中引用此符号后，会在这里显示。")}</span></p>}
      </nav>
    </div>
    {!recipeActive && <footer>{definitions.length}  {t("个定义结果 ·")} {appearances.length}  {t("个引用公式")}</footer>}
  </aside>;
}

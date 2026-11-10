import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useMemo, useRef, useState } from "react";
import ResearchSelectionField from './ResearchSelectionField.tsx';
import { researchFormulaChoices } from './researchFormulaChoices.ts';
import { ArrowUpRight, ChevronRight, GitBranch, ListFilter, X } from "lucide-react";
import { Formula } from "./Formula.tsx";
import ResearchMathText from "./ResearchMathText.tsx";
import { resolveSymbolEntry, type FormulaOutput } from "../domain/researchDictionary.ts";
import { renderedFormulaTex, type ResearchFormulaBlock, type ResearchNotebookState } from "../domain/researchNotebook.ts";
import { findResearchFormula, formulaSourceKey, listFormulaConsumers, researchFormulaTitle, sourceIndexMapping, type FormulaAddress, type FormulaResult, type SymbolPart } from "../domain/researchFormulaLinks.ts";
import { recipeInputRoles, recipeKinds, type FormulaRecipe, type RecipeInputRole, type RecipeKind } from "../domain/researchRecipeMetadata.ts";
import { inspectFormulaRecipe, inspectVariableRecipe, listVariableRecipes, recipeInputKey, recipeOccurrenceKey, summarizeVariableInputs, variableRecipeCandidates, variableRecipeSignature, variableRoleInFormula } from "../domain/researchVariableRecipes.ts";
import ResearchRecipeTree from "./ResearchRecipeTree.tsx";
import { buildRecipeTree, recipeTreePath, selectRecipe, type BrowsingSelections, type RecipeStep } from "./researchRecipeTreeModel.ts";
import "./ResearchVariableRecipe.css";

const variableName = (state: ResearchNotebookState, part: Pick<SymbolPart, "entryId">) => state.symbols.find(entry => entry.id === part.entryId)?.name || t("缺少符号词条");
const isBasic = (role: RecipeInputRole) => !["derived", "index", "excluded"].includes(role);
const recipeKindHelp: () => Partial<Record<RecipeKind, string>> = () => ({
  implicit: t("结合适用条件求解方程；输入列出参与求解的其他变量。"),
  joint: t("此量需要与同式的其他结果一起求解。"),
  related: t("这些变量与目标量共同出现，输入方向尚待确认。可在公式设置中标明。"),
});
const formulaContext = (state: ResearchNotebookState, owner: FormulaAddress) => {
  const found = findResearchFormula(state, owner);
  return found ? `${found.note.title} · ${researchFormulaTitle(found.formula, found.note)}` : t("原公式不存在");
};

function VariableLabel({ state, part, showName = true }: { state: ResearchNotebookState; part: Pick<SymbolPart, "entryId" | "bindings">; showName?: boolean }) {
  useLocale();
  const entry = state.symbols.find(entry => entry.id === part.entryId);
  return <span className="recipe-variable-label">
    <span className="recipe-variable-math" aria-hidden="true"><Formula tex={entry ? resolveSymbolEntry(entry, part.bindings).tex : "?"} /></span>
    {showName && <span>{variableName(state, part)}</span>}
  </span>;
}

export function VariableRecipePreview({ state, owner, part, onOpen }: {
  state: ResearchNotebookState; owner: FormulaAddress; part: SymbolPart; onOpen: () => void;
}) {
  useLocale();
  const source = listVariableRecipes(state, owner, part);
  const role = variableRoleInFormula(state, owner, part);
  const recipe = source.selected && inspectVariableRecipe(state, source.selected.reference);
  return <section className="recipe-direct-preview" aria-label={t("直接依赖")}>
    <div className="recipe-section-heading">
      <strong>{t("直接依赖")}</strong>{recipe && role === "derived" && <span className="recipe-badge">{t(recipeKinds[recipe.kind])}</span>}
      <button type="button" className="research-formula-preview-button" aria-label={t("逐层查看变量配方")} title={t("逐层查看变量配方")} onClick={onOpen}><GitBranch size={14} />{t("查看配方")}<ChevronRight size={14} /></button>
    </div>
    {role !== "derived" ? <p className="recipe-hint">{isBasic(role) ? t("此变量已标明为") : t("此变量在当前公式中标为")}{t(recipeInputRoles[role])}。</p>
      : recipe ? <>
        {recipe.warning && <p className="recipe-notice">{localizeError(recipe.warning)}</p>}
        {recipe.kind === "related" && <p className="recipe-hint">{t("以下为共同涉及的变量，输入关系尚待确认。")}</p>}
        <div className="recipe-direct-chips">{recipe.inputs.map(input => <span key={recipeInputKey(input.part)} role="img" aria-label={variableName(state, input.part)} title={variableName(state, input.part)}><VariableLabel state={state} part={input.part} showName={false} /></span>)}</div>
        {!recipe.inputs.length && <p className="recipe-hint">{recipe.warning ? t("可打开原文查看。") : t("当前配方没有可继续追溯的输入项。")}</p>}
      </> : <p className={source.error ? "recipe-notice" : "recipe-hint"}>{localizeError(source.error) || (source.candidates.length ? t`尚未关联来源，有 ${source.candidates.length} 个可选配方。` : t("尚未关联来源，也未标明基础输入类型。"))}</p>}
  </section>;
}

function RecipeSummary({ state, root, selections }: { state: ResearchNotebookState; root: RecipeStep; selections: BrowsingSelections }) {
  useLocale();
  const source = selectRecipe(state, root, selections);
  const summary = useMemo(() => root.role === "derived" && source.selected ? summarizeVariableInputs(state, source.selected.reference, { selections }) : undefined,
    [state, source.selected, selections, root.role]);
  const basic = isBasic(root.role) ? [{ ...root, reason: "" }] : summary?.basic ?? [];
  const complete = isBasic(root.role) || !!summary?.complete;
  if (root.role === "index" || root.role === "excluded") return <section className="recipe-summary" aria-label={t("基础输入汇总")}><h3>{t("基础输入汇总")}</h3><p className="recipe-hint">{t("此项标为")}{t(recipeInputRoles[root.role])}{t("，不计入基础输入。")}</p></section>;
  return <section className="recipe-summary" aria-label={t("基础输入汇总")}>
    <h3 title={t("相同笔记中的同类输入按具体角标合并，输入沿用来源公式的角标。")}>{t("基础输入汇总 ·")} {variableName(state, root.part)}</h3>
    <p className={complete ? "recipe-summary-complete" : "recipe-hint"} role="status">{complete ? t("已追溯至标明类型的基础输入") : t("仍有来源或输入类型需要补充")}</p>
    {summary && <p className="recipe-hint">{t("已查看")} {summary.recipes}  {t("个配方。")}</p>}
    {Object.entries(recipeInputRoles).filter(([role]) => isBasic(role as RecipeInputRole)).map(([role, label]) => {
      const group = basic.filter(input => input.role === role);
      return group.length > 0 && <div className="recipe-summary-group" key={role}><strong>{t(label)} · {group.length}</strong><ul>{group.map((item, index) => <li key={index}><VariableLabel state={state} part={item.part} /><small>{formulaContext(state, item.owner)}</small></li>)}</ul></div>;
    })}
    {complete && !basic.length && <p className="recipe-hint">{t("当前配方不含需另行提供的变量输入。")}</p>}
    {!summary && !isBasic(root.role) && <p className="recipe-notice">{localizeError(source.error) || t("请先为当前变量选择配方。")}</p>}
    {!!summary?.unresolved.length && <div className="recipe-summary-group recipe-summary-unresolved"><strong>{t("尚待补充 ·")} {summary.unresolved.length}</strong><ul>{summary.unresolved.map((item, index) => <li key={index}><VariableLabel state={state} part={item.part} /><small>{formulaContext(state, item.owner)}<br />{item.reason.includes("可选配方") ? t("待选择配方 · ") : ""}{localizeError(item.reason)}</small></li>)}</ul></div>}
    {summary?.errors.map(error => <p className="recipe-notice" key={error}>{localizeError(error)}</p>)}
    {summary?.truncated && <p className="recipe-notice">{t("本次汇总已达回溯上限；可沿路径逐层继续查看。")}</p>}
  </section>;
}

function RecipeSource({ state, result, part, onOpenFormula }: {
  state: ResearchNotebookState; result: FormulaResult; part: SymbolPart; onOpenFormula: (address: FormulaAddress) => void;
}) {
  useLocale();
  const entry = state.symbols.find(entry => entry.id === part.entryId);
  const mapping = entry ? sourceIndexMapping(entry, result.output, part) : [];
  const changed = mapping.some(item => item.from !== item.to);
  return <section className="recipe-source" aria-label={t("配方来源")}>
    <div className="recipe-source-heading"><strong>{result.note.title} · {researchFormulaTitle(result.formula, result.note)}</strong><button type="button" onClick={() => onOpenFormula(result.reference)} aria-label={t("打开来源原文")} title={t("打开来源原文")}><ArrowUpRight size={15} /></button></div>
    {result.formula.conditions?.trim() && <div className="recipe-conditions"><strong>{t("适用条件")}</strong><ResearchMathText text={result.formula.conditions} /></div>}
    {changed && <div className="recipe-mapping"><strong title={t("输入沿用来源公式的角标，不自动代入。")}>{t("角标对应：来源 → 此处")}</strong><dl>{mapping.map(item => <div key={item.key}><dt>{t(item.label)}</dt><dd><Formula tex={item.from} /> → <Formula tex={item.to} /></dd></div>)}</dl></div>}
    <details className="recipe-equation"><summary>{t("查看来源公式")}</summary><div><Formula tex={renderedFormulaTex(result.formula, state.symbols).tex} block /></div></details>
  </section>;
}

export function VariableRecipePanel({ state, owner, part, onOpenFormula }: {
  state: ResearchNotebookState; owner: FormulaAddress; part: SymbolPart;
  onOpenFormula: (address: FormulaAddress) => void;
}) {
  useLocale();
  const [root] = useState<RecipeStep>(() => ({ owner, part, role: variableRoleInFormula(state, owner, part) }));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(["root"]));
  const [selectedId, setSelectedId] = useState("root");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selections, setSelections] = useState<BrowsingSelections>({});
  const [showSummary, setShowSummary] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildRecipeTree(state, root, expanded, selections), [state, root, expanded, selections]);
  const visibleSelectedId = tree.nodes.some(node => node.id === selectedId) ? selectedId : "root";
  const path = recipeTreePath(tree, visibleSelectedId);
  const current = path[path.length - 1];
  const source = current.source;
  const selected = source.selected;
  const recipe = current.recipe;
  const cycle = current.cycle;
  const consumers = selected ? listFormulaConsumers(state, selected.reference, selected.output.id) : [];
  const uses = consumers.filter((use, index) => consumers.findIndex(other => other.noteId === use.noteId && other.formulaId === use.formulaId) === index);
  const selectNode = (id: string) => {
    setSelectedId(id); setDetailsOpen(true);
    setExpanded(previous => previous.has(id) ? previous : new Set([...previous, id]));
    content.current?.scrollTo({ top: 0 });
  };
  return <section className="research-variable-recipe" aria-label={t("变量配方")}>
    <ResearchRecipeTree tree={tree} selectedId={visibleSelectedId} name={part => variableName(state, part)} renderVariable={part => <VariableLabel state={state} part={part} showName={false} />}
      onSelect={selectNode} onCollapse={id => setExpanded(previous => { const next = new Set(previous); next.delete(id); return next; })} />
    <div className="recipe-panel-body" ref={content} role="region" aria-label={t("配方详情与汇总")} tabIndex={0}>
      {detailsOpen && <section className="recipe-variable-details" aria-label={t("所选变量配方")}>
      <div className="recipe-details-toolbar"><strong>{t("变量配方详情")}</strong><button type="button" aria-label={t("收起变量详情")} title={t("收起变量详情")} onClick={() => setDetailsOpen(false)}><X size={14} /></button></div>
      <nav className="recipe-breadcrumbs" aria-label={t("变量回溯路径")}>{path.map((step, index) => <span key={step.id}>{index > 0 && <ChevronRight size={12} />}<button type="button" aria-current={index === path.length - 1 ? "step" : undefined} onClick={() => selectNode(step.id)}>{variableName(state, step.part)}</button></span>)}</nav>
      <div className="recipe-current-heading"><h2 aria-label={variableName(state, current.part)}><VariableLabel state={state} part={current.part} /></h2><span className="recipe-badge" title={current.role === "derived" && recipe ? recipeKindHelp()[recipe.kind] : undefined}>{current.role === "derived" ? recipe ? t(recipeKinds[recipe.kind]) : t("来源待确定") : t(recipeInputRoles[current.role])}</span></div>
      {current.role !== "derived" ? <section className="recipe-terminal">
        <strong>{isBasic(current.role) ? t("已到达基础输入") : t("此项不计入配方输入")}</strong><p>{t("此变量在当前公式中标明为")}{t(recipeInputRoles[current.role])}。</p>
        <button type="button" className="recipe-text-button" onClick={() => onOpenFormula(current.owner)}>{t("查看标注所在公式")}<ArrowUpRight size={13} /></button>
      </section> : <>
        {source.candidates.length > 0 && <label className="recipe-source-select">{t("选择变量配方")}<ResearchSelectionField storageKey="mewiki:selection-folds:选择变量配方" label={t("选择变量配方")} title={t("切换仅用于本次浏览，保留原有来源关联。")} value={selected ? formulaSourceKey(selected.reference) : ""} emptyLabel={t("选择一个可用配方")} choices={researchFormulaChoices(source.candidates)} onChange={id => {
          const candidate = source.candidates.find(item => formulaSourceKey(item.reference) === id);
          if (candidate) setSelections(previous => ({ ...previous, [recipeOccurrenceKey(current.owner, current.part)]: candidate.reference }));
        }} /></label>}
        {!selected && <p className="recipe-notice">{localizeError(source.error) || (source.candidates.length ? t("尚未关联来源，请选择适用的变量配方。") : t("尚未关联来源，也未标明基础输入类型。可在原公式设置中补充。"))}</p>}
        {recipe?.warning && <p className="recipe-notice" role="status">{localizeError(recipe.warning)}</p>}
        {cycle && <p className="recipe-notice" role="status">{t("此配方已在当前路径中出现，发现循环来源，已停止回溯。可以返回上一层或选择其他配方。")}</p>}
        {recipe && !cycle && <section className="recipe-inputs" aria-label={recipe.kind === "related" ? t("共同涉及的变量") : t("配方输入")}>
          <div className="recipe-section-heading"><h3 title={t("在上方关系图中点击输入符号，可继续查看下一层配方。")}>{recipe.kind === "related" ? t("共同涉及的变量") : t("需要哪些变量")}</h3><span>{recipe.inputs.length}  {t("项")}</span></div>
          {!recipe.inputs.length && !recipe.warning && <p className="recipe-hint">{t("此配方未列出其他变量输入。")}</p>}
          {path.length >= 64 && <p className="recipe-notice">{t("当前路径已达 64 层，请返回前层继续浏览。")}</p>}
          {recipe.peers.length > 0 && <div className="recipe-joint-results"><strong>{t("同式的其他结果")}</strong>{recipe.peers.map(output => <VariableLabel key={output.id} state={state} part={output} />)}</div>}
        </section>}
        {selected && <RecipeSource state={state} result={selected} part={current.part} onOpenFormula={onOpenFormula} />}
        {uses.length > 0 && <details className="recipe-consumers"><summary>{t("使用此结果的公式 ·")} {uses.length}</summary>{uses.map(use => <button type="button" key={JSON.stringify([use.noteId, use.formulaId])} onClick={() => onOpenFormula(use)}>{use.noteTitle} · {researchFormulaTitle(use.formula, state.notes.find(note => note.id === use.noteId)!)}<ArrowUpRight size={13} /></button>)}</details>}
      </>}
      </section>}
      <button type="button" className="recipe-summary-toggle" aria-pressed={showSummary} onClick={() => setShowSummary(previous => !previous)}><ListFilter size={15} />{t("汇总基础输入")}</button>
      {showSummary && <RecipeSummary state={state} root={root} selections={selections} />}
    </div>
  </section>;
}

export function VariableRecipeSettings({ state, owner, block, output, index, onChange }: {
  state: ResearchNotebookState; owner: FormulaAddress; block: ResearchFormulaBlock; output: FormulaOutput; index: number;
  onChange: (output: FormulaOutput) => void;
}) {
  useLocale();
  const note = findResearchFormula(state, owner)?.note;
  if (!note) return null;
  const candidates = variableRecipeCandidates(state, block, output);
  const auto = inspectFormulaRecipe(state, { note, formula: block, output: { ...output, recipe: undefined }, reference: { ...owner, outputId: output.id } });
  const valid = output.recipe?.signature === variableRecipeSignature(block);
  const roles = new Map(candidates.map(candidate => {
    const key = recipeInputKey(candidate.part);
    const saved = valid && output.recipe?.inputs.find(input => recipeInputKey(input) === key);
    return [key, saved ? saved.role : auto.inputs.some(input => recipeInputKey(input.part) === key) ? "derived" as const : candidate.role === "index" ? "index" as const : "excluded" as const];
  }));
  const confirm = (overrides: Partial<Pick<FormulaRecipe, "kind">> = {}, changedRole?: { key: string; role: RecipeInputRole }) => {
    const inputs = candidates.map(({ part }) => ({ entryId: part.entryId, bindings: { ...part.bindings }, ...(part.source ? { source: { ...part.source } } : {}), role: changedRole?.key === recipeInputKey(part) ? changedRole.role : roles.get(recipeInputKey(part))! }));
    onChange({ ...output, recipe: { signature: variableRecipeSignature(block), inputs, ...(valid && output.recipe?.kind ? { kind: output.recipe.kind } : {}), ...overrides } });
  };
  return <details className="recipe-settings"><summary>{t("变量配方设置")}</summary>
    {!block.parts ? <p className="recipe-hint">{t("此公式尚未记录可识别的变量项。整理为词典公式后可设置配方输入。")}</p> : <>
      <p className="recipe-hint">{t("自动识别结果为")}{t(recipeKinds[auto.kind])}{t("。可标明输入的获取方式；索引和不作为输入的项不会进入汇总。")}</p>
      {output.recipe && !valid && <p className="recipe-notice">{t("公式内容已变更，请复核并确认当前输入。")}</p>}
      <label>{t("求解方式")}<select aria-label={t`结果 ${index + 1} 的求解方式`} value={valid ? output.recipe?.kind ?? "" : ""} onChange={event => confirm({ kind: event.target.value as RecipeKind || undefined })}><option value="">{t("自动识别（")}{t(recipeKinds[auto.kind])}）</option>{Object.entries(recipeKinds).map(([kind, label]) => <option key={kind} value={kind}>{t(label)}</option>)}</select></label>
      <div className="recipe-settings-inputs">{candidates.map(candidate => <label key={recipeInputKey(candidate.part)}><VariableLabel state={state} part={candidate.part} /><select aria-label={t`结果 ${index + 1} ${variableName(state, candidate.part)}的输入角色`} value={roles.get(recipeInputKey(candidate.part))} onChange={event => confirm({}, { key: recipeInputKey(candidate.part), role: event.target.value as RecipeInputRole })}>{Object.entries(recipeInputRoles).map(([role, label]) => <option key={role} value={role}>{t(label)}</option>)}</select></label>)}</div>
      {!candidates.length && <p className="recipe-hint">{t("当前公式没有其他变量项。")}</p>}
      <div className="recipe-settings-actions"><button type="button" onClick={() => confirm()}>{t("确认当前输入")}</button>{output.recipe && <button type="button" onClick={() => onChange({ ...output, recipe: undefined })}>{t("恢复自动识别")}</button>}</div>
      <p className="recipe-hint">{valid ? t("已确认的输入会随本次公式设置一起保存。") : t("改动或确认后，点击“保存设置”生效。")}</p>
    </>}
  </details>;
}

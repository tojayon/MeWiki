import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Formula } from "./Formula.tsx";
import ResearchClassifiedList from './ResearchClassifiedList.tsx';
import { researchSymbolChoice } from './researchChoices.ts';
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import { InlineSymbolDetailsContext } from "./ResearchInlineSymbolContext.ts";
import { FormulaSymbolPopover } from "./ResearchFormulaRelations.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import { findInlineResearchSymbols, type InlineResearchSymbol } from "../domain/researchInlineSymbols.ts";
import { inlineResearchSymbolTargets, markInlineResearchSymbols } from "./researchInlineSymbolTargets.ts";
import type { ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import "./ResearchInlineFormula.css";

interface HitBox { index: number; left: number; top: number; width: number; height: number }

function SymbolChoices({ match, target, onChoose, onCancel }: {
  match: InlineResearchSymbol; target: HTMLElement;
  onChoose: (entry: ResearchSymbolEntry) => void; onCancel: (restore?: boolean) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null), triggerRef = useRef(target);
  useFormulaPopover({ ref, triggerRef, getAnchor: () => target.getBoundingClientRect(), onCancel });
  useLayoutEffect(() => {
    const options = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[data-research-choice]') ?? [])];
    (options.find(option => option.getClientRects().length > 0) ?? ref.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
  }, []);
  return <div ref={ref} className="research-formula-inline-editor research-inline-symbol-choices" popover="manual" role="dialog" aria-label={t("选择符号含义")}>
    <strong>{t("此记号有多个含义")}</strong>
    <ResearchClassifiedList choices={match.candidates.map(researchSymbolChoice)} label={t("选择符号含义")} storageKey="mewiki:inline-symbol-choice-folds" onSelect={choice => onChoose(choice.symbol!)} />
  </div>;
}

export default function ResearchInlineFormula({ tex }: { tex: string }) {
  useLocale();
  const context = useContext(ResearchNoteLinkContext);
  const enabled = useContext(InlineSymbolDetailsContext);
  const symbols = context?.symbols;
  const matches = useMemo(() => enabled && symbols ? findInlineResearchSymbols(tex, symbols) : [], [tex, symbols, enabled]);
  const root = useRef<HTMLSpanElement>(null);
  const [boxes, setBoxes] = useState<HitBox[]>([]);
  const [inspection, setInspection] = useState<{ match: InlineResearchSymbol; target: HTMLElement; sourceNoteId?: string; entry?: ResearchSymbolEntry } | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !matches.length) return;
    const targets = inlineResearchSymbolTargets(element, markInlineResearchSymbols(tex, matches), matches.length);
    let frame = 0, disposed = false;
    const measure = () => {
      const origin = element.getBoundingClientRect();
      const next = targets.flatMap((ranges, index): HitBox[] => {
        const rects = ranges.map(range => range.getBoundingClientRect()).filter(box => box.width > 0 && box.height > 0);
        if (!rects.length) return [];
        const left = Math.min(...rects.map(box => box.left)), top = Math.min(...rects.map(box => box.top));
        return [{ index, left: left - origin.left, top: top - origin.top, width: Math.max(...rects.map(box => box.right)) - left, height: Math.max(...rects.map(box => box.bottom)) - top }];
      });
      setBoxes(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { if (!disposed) { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); } };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    measure();
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.fonts.removeEventListener("loadingdone", schedule); };
  }, [tex, matches]);
  const reading = context?.state.open && (context.state.view === "notes" || context.state.view === "foundations");
  const current = inspection && reading && inspection.sourceNoteId === context?.sourceNoteId && matches.includes(inspection.match) ? inspection : null;
  if (inspection && !current) setInspection(null);
  useEffect(() => {
    if (!current) return;
    const dismissOther = (event: Event) => { if ((event as CustomEvent).detail !== root.current) setInspection(null); };
    window.addEventListener("research-inline-symbol-inspect", dismissOther);
    return () => window.removeEventListener("research-inline-symbol-inspect", dismissOther);
  }, [current]);
  const close = (restore = false) => { if (restore) current?.target.focus({ preventScroll: true }); setInspection(null); };
  const entry = current?.entry && context?.symbols.find(entry => entry.id === current.entry!.id);
  const state = context?.state;
  return <span ref={root} className="research-inline-formula">
    <Formula tex={tex} />
    {matches.length > 0 && boxes.map(box => {
      const match = matches[box.index];
      if (!match) return null;
      return <button type="button" key={box.index} className="research-inline-symbol-hit" data-inline-symbol-index={box.index}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        aria-label={match.candidates.length === 1 ? t`查看符号 ${match.candidates[0].name}` : t("查看符号的多个含义")} title={t("查看含义与推导来源")} aria-haspopup="dialog" aria-expanded={current?.match === match}
        onPointerDown={event => event.stopPropagation()} onClick={event => {
          event.preventDefault(); event.stopPropagation();
          const target = event.currentTarget;
          window.dispatchEvent(new CustomEvent("research-inline-symbol-inspect", { detail: root.current }));
          setInspection(previous => current && previous?.match === match ? null : { match, target, sourceNoteId: context?.sourceNoteId, entry: match.candidates.length === 1 ? match.candidates[0] : undefined });
        }} onKeyDown={event => event.stopPropagation()} />;
    })}
    {current && state && createPortal(<InlineSymbolDetailsContext.Provider value={false}>
      {entry ? <FormulaSymbolPopover key={entry.id} state={state} part={{ type: "symbol", entryId: entry.id, bindings: current.match.bindingsByEntryId?.[entry.id] ?? current.match.bindings }} instanceTex={tex.slice(current.match.start, current.match.end)} target={current.target} onCancel={close}
        onOpenFormula={address => { const target = current.target; close(); context.openNote(address.noteId, address.formulaId, target); }} />
        : <SymbolChoices match={current.match} target={current.target} onCancel={close} onChoose={entry => setInspection({ ...current, entry })} />}
    </InlineSymbolDetailsContext.Provider>, current.target.closest("dialog") ?? document.body)}
  </span>;
}

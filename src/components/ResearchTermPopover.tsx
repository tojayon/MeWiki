import { useLayoutEffect, useRef } from "react";
import { BookOpen } from "lucide-react";
import type { ResearchTermEntry } from "../domain/researchTerms.ts";
import { researchTermAtoms } from "../domain/researchTerms.ts";
import { t } from "../i18n/locale.ts";
import { useLocale } from "../i18n/react.ts";
import ResearchMathText from "./ResearchMathText.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import "./ResearchNotebook.css";

export default function ResearchTermPopover({ entry, target, onCancel }: {
  entry: ResearchTermEntry;
  target: HTMLElement;
  onCancel: (restoreFocus?: boolean, nextTarget?: EventTarget | null) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef(target);
  const atoms = researchTermAtoms(entry);
  useFormulaPopover({ ref, triggerRef, getAnchor: () => target.getBoundingClientRect(), onCancel });
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, []);
  return <div ref={ref} className="research-formula-inline-editor research-term-popover" popover="manual" role="dialog" tabIndex={-1} aria-label={t("术语解释")}>
    <header className="research-formula-symbol-heading research-term-popover-heading">
      <h2 className="research-term-popover-title">{entry.name}</h2>
      <button data-ui="icon-action" className="research-formula-dictionary-button" aria-label={t("打开词典词条")} title={t("打开词典词条")}
        onClick={() => { onCancel(); window.dispatchEvent(new CustomEvent("research-dictionary-open", { detail: { kind: "term", id: entry.id } })); }}><BookOpen size={14} /></button>
    </header>
    <p className="research-term-popover-meaning"><ResearchMathText text={entry.meaning} /></p>
    <section className="research-term-popover-atoms" aria-label={t("原子词汇解释")}>
      <h3>{t("原子词汇解释")}</h3>
      {atoms.map(atom => <article className="research-term-popover-atom" key={atom.id}>
        <h4>{atom.text}</h4>
        <p>{atom.meaning}</p>
      </article>)}
    </section>
    {(entry.englishName || entry.englishAbbreviation || entry.chineseAbbreviation || entry.aliases.length > 0 || entry.scope) && <dl className="research-term-popover-meta">
      {entry.englishName && <><dt>{t("英文名称")}</dt><dd>{entry.englishName}</dd></>}
      {entry.englishAbbreviation && <><dt>{t("英文缩写")}</dt><dd>{entry.englishAbbreviation}</dd></>}
      {entry.chineseAbbreviation && <><dt>{t("中文缩写")}</dt><dd>{entry.chineseAbbreviation}</dd></>}
      {entry.aliases.length > 0 && <><dt>{t("别名")}</dt><dd>{entry.aliases.join("、")}</dd></>}
      {entry.scope && <><dt>{t("适用范围")}</dt><dd className="research-term-scope">{entry.scope}</dd></>}
    </dl>}
  </div>;
}

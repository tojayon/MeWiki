import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { ArrowUpRight } from "lucide-react";
import type { ResearchNote, ResearchNotebookState } from "../domain/researchNotebook.ts";
import { getNoteLibrary, noteBasisIds } from "../domain/researchNoteLibraries.ts";
import { flattenResearchBlocks } from "../domain/researchBlockTree.ts";

export default function ResearchNoteReferences({ state, note, onOpenNote }: {
  state: ResearchNotebookState;
  note: ResearchNote;
  onOpenNote: (id: string) => void;
}) {
  useLocale();
  const basis = noteBasisIds(note);
  const consumers = state.notes.filter(item => item.id !== note.id && noteBasisIds(item).includes(note.id));
  return <div className="research-metadata-relations">
    <section className="research-library-links" aria-label={t("理论依据")}>
      <strong>{t("理论依据")}<small>basisNoteIds</small></strong>
      <div className="research-library-link-list">
        {basis.map(id => {
          const source = state.notes.find(item => item.id === id);
          const formulaUse = flattenResearchBlocks(note.blocks).some(block => block.type === "formula" && block.parts?.some(part => part.type === "symbol" && part.source?.noteId === id));
          return <span className="research-library-link" key={id}>
            <button type="button" disabled={!source} onClick={() => onOpenNote(id)}>
              <span>{source?.title || t("来源笔记已移除")}</span><ArrowUpRight size={12} />
            </button>
            {formulaUse && <small>{t("公式来源")}</small>}
          </span>;
        })}
        {!basis.length && <span className="research-library-empty">{t("尚未关联")}</span>}
      </div>
    </section>
    {getNoteLibrary(note) === "foundation" && <section className="research-library-links" aria-label={t("被哪些笔记使用")}>
      <strong>{t("被哪些笔记使用")}<small>{t("自动关联")}</small></strong>
      <div className="research-library-link-list">
        {consumers.map(item => <span className="research-library-link" key={item.id}>
          <button type="button" onClick={() => onOpenNote(item.id)}>
            <span>{item.title || t("未命名笔记")}</span><ArrowUpRight size={12} />
          </button>
          <small>{getNoteLibrary(item) === "foundation" ? t("基础理论") : t("研究记录")}</small>
        </span>)}
        {!consumers.length && <span className="research-library-empty">{t("尚无引用笔记")}</span>}
      </div>
    </section>}
  </div>;
}

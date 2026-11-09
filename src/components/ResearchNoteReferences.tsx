import { ArrowUpRight } from "lucide-react";
import type { ResearchNote, ResearchNotebookState } from "../domain/researchNotebook.ts";
import { getNoteLibrary, noteBasisIds } from "../domain/researchNoteLibraries.ts";
import { flattenResearchBlocks } from "../domain/researchBlockTree.ts";

export default function ResearchNoteReferences({ state, note, onOpenNote }: {
  state: ResearchNotebookState;
  note: ResearchNote;
  onOpenNote: (id: string) => void;
}) {
  const basis = noteBasisIds(note);
  const consumers = state.notes.filter(item => item.id !== note.id && noteBasisIds(item).includes(note.id));
  return <div className="research-metadata-relations">
    <section className="research-library-links" aria-label="理论依据">
      <strong>理论依据<small>basisNoteIds</small></strong>
      <div className="research-library-link-list">
        {basis.map(id => {
          const source = state.notes.find(item => item.id === id);
          const formulaUse = flattenResearchBlocks(note.blocks).some(block => block.type === "formula" && block.parts?.some(part => part.type === "symbol" && part.source?.noteId === id));
          return <span className="research-library-link" key={id}>
            <button type="button" disabled={!source} onClick={() => onOpenNote(id)}>
              <span>{source?.title || "来源笔记已移除"}</span><ArrowUpRight size={12} />
            </button>
            {formulaUse && <small>公式来源</small>}
          </span>;
        })}
        {!basis.length && <span className="research-library-empty">尚未关联</span>}
      </div>
    </section>
    {getNoteLibrary(note) === "foundation" && <section className="research-library-links" aria-label="被哪些笔记使用">
      <strong>被哪些笔记使用<small>自动关联</small></strong>
      <div className="research-library-link-list">
        {consumers.map(item => <span className="research-library-link" key={item.id}>
          <button type="button" onClick={() => onOpenNote(item.id)}>
            <span>{item.title || "未命名笔记"}</span><ArrowUpRight size={12} />
          </button>
          <small>{getNoteLibrary(item) === "foundation" ? "基础理论" : "研究记录"}</small>
        </span>)}
        {!consumers.length && <span className="research-library-empty">尚无引用笔记</span>}
      </div>
    </section>}
  </div>;
}

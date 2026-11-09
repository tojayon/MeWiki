import { useContext, useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import type { ResearchNoteEmbedBlock } from '../domain/researchNoteEmbed.ts';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import { ResearchNoteEmbedContent } from './ResearchReadOnlyContent.tsx';
import ResearchNoteEmbedPicker from './ResearchNoteEmbedPicker.tsx';

export default function ResearchNoteEmbed({ block, ownerNoteId, state, readOnly, onPatch }: {
  block: ResearchNoteEmbedBlock; ownerNoteId: string; state: ResearchNotebookState; readOnly: boolean;
  onPatch: (patch: Partial<ResearchNoteEmbedBlock>) => void;
}) {
  const links = useContext(ResearchNoteLinkContext);
  const [editing, setEditing] = useState(false);
  return <>
    <ResearchNoteEmbedContent block={block} ownerNoteId={ownerNoteId} state={state} onOpenNote={(...args) => links?.openNote(...args)} actions={!readOnly && <button type="button" data-ui="icon-action" aria-label="修改引用范围" title="修改来源笔记或引用范围" onClick={() => setEditing(true)}><Settings2 size={15} /></button>} />
    {!readOnly && editing && <ResearchNoteEmbedPicker state={state} ownerNoteId={ownerNoteId} blockId={block.id} initial={block} onClose={() => setEditing(false)} onSelect={selection => { onPatch({ sourceNoteId: selection.sourceNoteId, blockIds: selection.blockIds, sourceTitle: selection.sourceTitle }); setEditing(false); }} />}
  </>;
}

import type { AiProposal, AiProposalPreview } from '../ai/proposals.ts';
import { aiProposalTarget } from '../ai/proposalGroup.ts';
import { nativeEntity, type AiNativeEntity } from '../ai/nativeEdits.ts';
import { findResearchBlock } from '../domain/researchBlockTree.ts';
import { getResearchNoteMetadata } from '../domain/researchFrontmatter.ts';
import type { ResearchNote, ResearchNotebookState } from '../domain/researchNotebook.ts';
import { t } from '../i18n/locale.ts';
import ResearchReadOnlyContent from './ResearchReadOnlyContent.tsx';
import ResearchMarkdown from './ResearchMarkdown.tsx';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';

/** Conflicts stay read-only; the three snapshots explain why approval is blocked. */
export default function AiProposalConflict({ proposal, preview, state, onOpenNote }: {
  proposal: AiProposal; preview: AiProposalPreview | null; state: ResearchNotebookState; onOpenNote: (id: string, blockId?: string) => void;
}) {
  const current = nativeEntity(state, aiProposalTarget(proposal), proposal.targetId);
  const display = (value: AiNativeEntity | null) => {
    if (!value) return <p>{t('来源内容已移除')}</p>;
    if ('blocks' in value) {
      const note = value as ResearchNote, blockId = proposal.kind === 'native' ? proposal.edit.blockId : 'blockId' in proposal ? proposal.blockId : undefined;
      const block = blockId && findResearchBlock(note.blocks, blockId)?.block;
      if (blockId) return block ? <ResearchReadOnlyContent block={block} note={note} state={state} onOpenNote={onOpenNote} staticView /> : <p>{t('来源内容已移除')}</p>;
      if (proposal.kind === 'native' && proposal.edit.action === 'note-update') {
        const metadata: Record<string, unknown> = { ...getResearchNoteMetadata(note), frontmatter: note.frontmatter };
        return Object.keys(proposal.edit.fields).map(field => <ResearchMarkdown key={field} text={typeof metadata[field] === 'string' ? metadata[field] as string : JSON.stringify(metadata[field] ?? null)} />);
      }
      return <><h2>{note.title}</h2>{note.blocks.map(block => <ResearchReadOnlyContent key={block.id} block={block} note={note} state={state} onOpenNote={onOpenNote} staticView />)}</>;
    }
    return <ResearchMarkdown text={'meaning' in value ? `${value.name}\n\n${value.meaning}` : value.title} />;
  };
  return <details open className="mewiki-ai-review-conflict" data-conflict-proposal-id={proposal.id}>
    <summary>{t('内容冲突')}</summary>
    <ResearchNoteLinkContext.Provider value={{ notes: state.notes, symbols: state.symbols, terms: state.terms ?? [], state, sourceNoteId: proposal.targetId, openNote: onOpenNote }}>
      <div className="mewiki-ai-conflict-versions">{[[t('原文'), proposal.before], [t('当前内容'), current], [t('AI 建议'), preview?.after ?? null]].map(([label, value], index) => <section key={index}><h3>{label as string}</h3>{display(value as AiNativeEntity | null)}</section>)}</div>
    </ResearchNoteLinkContext.Provider>
  </details>;
}

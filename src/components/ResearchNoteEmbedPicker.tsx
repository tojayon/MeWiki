import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { insertResearchBlock, type ResearchNotebookBlock, type ResearchNotebookState } from '../domain/researchNotebook.ts';
import { findResearchBlock, flattenResearchBlocks, type ResearchExampleContainer } from '../domain/researchBlockTree.ts';
import { NOTE_EMBED_MAX_SELECTION, noteEmbedSelectionError, orderedNoteEmbedIds, type ResearchNoteEmbedBlock } from '../domain/researchNoteEmbed.ts';
import { buildResearchOutline } from '../domain/researchOutline.ts';
import ResearchClassifiedList from './ResearchClassifiedList.tsx';
import { filterResearchChoices, researchNoteChoice } from './researchChoices.ts';
import DeviceInspectorModal from './DeviceInspectorModal.tsx';
import ResearchReadOnlyContent from './ResearchReadOnlyContent.tsx';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import './ResearchNoteEmbed.css';

export default function ResearchNoteEmbedPicker({ state, ownerNoteId, blockId, initial, targetContainer, onSelect, onClose }: {
  state: ResearchNotebookState; ownerNoteId: string; blockId: string; initial?: ResearchNoteEmbedBlock;
  targetContainer?: ResearchExampleContainer;
  onSelect: (block: ResearchNoteEmbedBlock) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState(initial?.sourceNoteId ?? '');
  const [selected, setSelected] = useState(initial?.blockIds ?? []);
  const [error, setError] = useState('');
  const source = state.notes.find(note => note.id === sourceId);
  const choices = filterResearchChoices(state.notes.map(note => researchNoteChoice(note)), query);
  const rows = useMemo(() => source ? flattenResearchBlocks(source.blocks) : [], [source]);
  const numbers = useMemo(() => new Map(rows.map((block, index) => [block.id, index + 1])), [rows]);
  const outline = useMemo(() => source ? buildResearchOutline(source.blocks) : [], [source]);
  const selection: ResearchNoteEmbedBlock = { id: blockId, type: 'noteEmbed', sourceNoteId: sourceId, blockIds: source ? orderedNoteEmbedIds(source, selected) : selected, ...(source ? { sourceTitle: source.title } : {}) };
  const validate = (ids: string[]) => {
    const candidate = { ...selection, blockIds: ids };
    const notes = initial ? state.notes : insertResearchBlock(state, ownerNoteId, candidate, undefined, targetContainer).notes;
    return noteEmbedSelectionError(notes, { noteId: ownerNoteId, blockId }, candidate);
  };
  const issue = validate(selected);
  const toggle = (id: string) => {
    setError('');
    if (selected.includes(id)) { setSelected(selected.filter(item => item !== id)); return; }
    if (selected.length >= NOTE_EMBED_MAX_SELECTION) { setError(`最多选择 ${NOTE_EMBED_MAX_SELECTION} 个内容块。`); return; }
    const problem = validate([id]);
    if (problem) { setError(problem); return; }
    setSelected(source ? orderedNoteEmbedIds(source, [...selected, id]) : [...selected, id]);
  };
  const render = (block: ResearchNotebookBlock): ReactNode => {
    if (!source) return null;
    const ancestors = findResearchBlock(source.blocks, block.id)!.path;
    const included = ancestors.some(owner => selected.includes(owner.exampleBlockId));
    const checked = selected.includes(block.id) || included;
    const problem = validate([block.id]);
    return <div key={block.id} data-selection-block-id={block.id} className={`research-note-embed-choice${checked ? ' is-selected' : ''}`}>
      <label className="research-note-embed-toggle" title={problem || (included ? '已包含在选中的标签页中' : '勾选此内容块，正文可直接阅读和查验')}>
        <input type="checkbox" aria-label={`选择内容 ${numbers.get(block.id)}`} checked={checked} disabled={included || (!!problem && !selected.includes(block.id))} onChange={() => toggle(block.id)} />
        <span className="research-note-embed-choice-number" aria-hidden="true">{numbers.get(block.id)}</span>
      </label>
      <div className={`research-note-block is-${block.type} research-note-embed-choice-content`}>
        <ResearchReadOnlyContent block={block} note={source} state={state} onOpenNote={() => {}} headings={outline.filter(heading => heading.blockId === block.id)} renderBlocks={renderBlocks} />
        {problem && <small className="research-note-embed-choice-issue">{problem}</small>}
      </div>
    </div>;
  };
  const renderBlocks = (blocks: ResearchNotebookBlock[]) => <div className="research-note-blocks research-note-embed-document">{blocks.map(render)}</div>;
  return <DeviceInspectorModal open hideHeader title={initial ? '调整引用内容' : '引用笔记内容'} testId="research-note-embed-picker" className="research-note-embed-picker" onClose={onClose}>
    <div className="research-note-embed-picker-toolbar" role="toolbar" aria-label="引用内容操作">
      <label className="research-note-embed-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索来源笔记" placeholder="搜索笔记标题或标签…" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></label>
      <span className="research-note-embed-count" role="status" title="勾选的内容会随来源更新；新增的其他内容不会自动加入">已选择 {selection.blockIds.length} 项</span>
      <button type="button" onClick={onClose}>取消</button>
      <button type="button" disabled={!selected.length || !!issue} onClick={() => { if (issue) { setError(issue); return; } onSelect(selection); }}>{initial ? '保存引用范围' : '插入引用'}</button>
    </div>
    <div className="research-note-embed-picker-body">
      <ResearchClassifiedList className="research-note-embed-notes" choices={choices} selectedId={sourceId} activeTags={source?.tags} query={query} label="来源笔记" storageKey="mewiki:note-embed-source-folds"
        onSelect={note => { if (sourceId !== note.id) { setSourceId(note.id); setSelected([]); setError(''); } }} empty="没有匹配的笔记。" />
      <div className="research-note-embed-choices is-readonly" role="group" aria-label="来源内容" key={sourceId}>
        {source ? <ResearchNoteLinkContext.Provider value={{ notes: state.notes, symbols: state.symbols, state, sourceNoteId: source.id, openNote: () => {} }}>
          <h2 className="research-note-embed-selection-title">{source.title || '未命名笔记'}</h2>
          {renderBlocks(source.blocks)}
          {selected.filter(id => !findResearchBlock(source.blocks, id)).map(id => <label key={id} className="research-note-embed-missing"><input type="checkbox" checked aria-label={`移除失效内容 ${id}`} onChange={() => toggle(id)} /><span>所选内容已删除，取消勾选后可保存新范围。</span></label>)}
          {!rows.length && <p className="research-note-embed-empty">这篇笔记暂无可引用内容。</p>}
        </ResearchNoteLinkContext.Provider> : <p className="research-note-embed-empty">先选择来源笔记，再勾选需要显示的内容。</p>}
      </div>
    </div>
    {(error || (selected.length > 0 && issue)) && <p role="alert" className="research-note-embed-error">{error || issue}</p>}
  </DeviceInspectorModal>;
}

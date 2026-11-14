import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { AiProposal } from '../ai/proposals.ts';
import { canAdjustAiProposal, type AiProposalAdjustment } from '../ai/reviewDecisions.ts';
import { aiBlockFields, aiMapFields, aiNoteFields, aiRelationFields, aiSymbolFields, aiTermFields } from '../ai/nativeSchema.ts';
import { findResearchBlock } from '../domain/researchBlockTree.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { localizeError, t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import ResearchMarkdown from './ResearchMarkdown.tsx';
import ResearchReferenceEditor, { type ResearchReferenceEditorHandle } from './ResearchReferenceEditor.tsx';
import { Formula } from './Formula.tsx';
import { aiReviewFieldLabel } from './aiReviewFieldLabels.ts';
import { AiReviewPair, RenderedChange, type AiReviewPresentation } from './AiReviewChanges.tsx';
import './AiInlineSuggestion.css';

type Schema = { type?: string; enum?: readonly unknown[]; const?: unknown; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: Schema | boolean; items?: Schema; anyOf?: Schema[]; minimum?: number; maximum?: number; maxLength?: number; maxItems?: number; minItems?: number };
type Path = (string | number)[];
type Readers = Map<string, { path: Path; read: () => string }>;
const initialValue = (schema: Schema): unknown => schema.anyOf ? initialValue(schema.anyOf[0]) : schema.const ?? schema.enum?.[0] ?? (schema.type === 'object' ? Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key, field]) => key === 'id' || field.const !== undefined || !schema.required || schema.required.includes(key)).map(([key, field]) => [key, key === 'id' ? crypto.randomUUID() : initialValue(field)])) : schema.type === 'array' ? [] : schema.type === 'boolean' ? false : schema.type === 'number' || schema.type === 'integer' ? schema.minimum ?? 0 : '');
const sourceOf = (proposal: AiProposal): AiProposalAdjustment => proposal.kind === 'native'
  ? { fields: structuredClone(proposal.edit.fields), ...(proposal.edit.action === 'tab-update' || proposal.edit.action === 'tab-insert' ? { title: proposal.edit.title ?? '' } : {}) }
  : proposal.kind === 'term' ? { fields: { name: proposal.term.name, ...(proposal.term.englishName ? { englishName: proposal.term.englishName } : {}), meaning: proposal.term.meaning } }
    : { content: proposal.content, ...(proposal.kind === 'create' ? { title: proposal.title } : {}) };
function fieldsOf(proposal: AiProposal): Record<string, Schema> {
  if (proposal.kind !== 'native') return (proposal.kind === 'term' ? aiTermFields : {}) as Record<string, Schema>;
  const edit = proposal.edit;
  const block = edit.action === 'block-insert' ? edit.block : proposal.before && 'blocks' in proposal.before ? findResearchBlock(proposal.before.blocks, edit.blockId ?? '')?.block : undefined;
  if (edit.action.startsWith('block-') && block) return aiBlockFields[block.type] as Record<string, Schema>;
  return (edit.action === 'note-update' ? aiNoteFields : edit.action === 'symbol-save' ? aiSymbolFields : edit.action === 'term-save' ? aiTermFields : edit.action.startsWith('map-') ? aiMapFields : edit.action === 'relation-save' ? aiRelationFields : {}) as Record<string, Schema>;
}

/** Uses the normal reference editor while retaining a rendered surface between edits. */
function ReviewTextField({ value, label, path, readers, onChange }: { value: string; label: string; path: Path; readers: Readers; onChange: (value: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const editor = useRef<ResearchReferenceEditorHandle>(null), latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; }, [value]);
  const key = JSON.stringify(path);
  useLayoutEffect(() => {
    readers.set(key, { path: JSON.parse(key), read: () => editor.current?.value ?? latest.current });
    return () => { readers.delete(key); };
  }, [key, readers]);
  useLayoutEffect(() => { if (editing) editor.current?.focus({ preventScroll: true }); }, [editing]);
  return <div className="mewiki-ai-adjust-text research-markdown">{editing ? <ResearchReferenceEditor ref={editor} defaultValue={value} aria-label={label}
    onBlur={input => { latest.current = input.value; onChange(input.value); setEditing(false); }} /> : <div role="textbox" aria-label={label} aria-multiline="true" tabIndex={0} className="mewiki-ai-adjust-rendered-text" onFocus={() => setEditing(true)}
      onPointerDown={event => { if (!(event.target instanceof Element) || !event.target.closest('button, a')) { event.preventDefault(); setEditing(true); } }}>
      {value ? <ResearchMarkdown text={value} /> : <span>—</span>}
    </div>}</div>;
}

function AdjustmentField({ name, value, schema, path, readers, onChange }: { name: string; value: unknown; schema: Schema; path: Path; readers: Readers; onChange: (value: unknown) => void }): ReactNode {
  const field = schema.anyOf?.find(option => option.properties?.type?.const === (value as { type?: string })?.type) ?? schema.anyOf?.[0] ?? schema;
  const label = aiReviewFieldLabel(name);
  if (name === 'id' || field.const !== undefined) return null;
  if (Array.isArray(value) || field.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    return <fieldset className="mewiki-ai-adjust-list"><legend>{label}</legend>{items.map((item, index) => <div key={index} className="mewiki-ai-adjust-list-item">
      <AdjustmentField name={typeof item === 'object' ? name : String(index + 1)} value={item} schema={field.items ?? {}} path={[...path, index]} readers={readers} onChange={next => onChange(items.map((entry, at) => at === index ? next : entry))} />
      <button type="button" data-ui="icon-action" aria-label={t('移除此项')} title={t('移除此项')} disabled={items.length <= (field.minItems ?? 0)} onClick={() => onChange(items.filter((_, at) => at !== index))}><Trash2 size={14} /></button>
    </div>)}<button type="button" data-ui="icon-action" aria-label={t('添加一项')} title={t('添加一项')} disabled={items.length >= (field.maxItems ?? 250)} onClick={() => onChange([...items, initialValue(field.items ?? {})])}><Plus size={15} /></button></fieldset>;
  }
  if (field.type === 'object' || value && typeof value === 'object') {
    const object = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return <fieldset><legend>{label}</legend>{Object.keys(object).filter(key => key !== 'id').map(key => <AdjustmentField key={key} name={key} value={object[key]} schema={field.properties?.[key] ?? (typeof field.additionalProperties === 'object' ? field.additionalProperties : {})} path={[...path, key]} readers={readers} onChange={next => onChange({ ...object, [key]: next })} />)}</fieldset>;
  }
  if (field.enum) return <label>{label}<select aria-label={label} value={String(value ?? '')} onChange={event => onChange(event.target.value)}>{field.enum.map(item => <option key={String(item)} value={String(item)}>{aiReviewFieldLabel(String(item))}</option>)}</select></label>;
  if (field.type === 'boolean' || typeof value === 'boolean') return <label className="mewiki-ai-adjust-checkbox"><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked)} />{label}</label>;
  if (field.type === 'number' || field.type === 'integer' || typeof value === 'number') return <label>{label}<input aria-label={label} type="number" min={field.minimum} max={field.maximum} step={field.type === 'integer' ? 1 : 'any'} value={String(value ?? '')} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} /></label>;
  const rich = ['content', 'text', 'meaning', 'notes', 'description', 'conditions', 'caption', 'scope', 'note'].includes(name);
  return <div className="mewiki-ai-adjust-field"><span>{label}</span>{rich ? <ReviewTextField value={String(value ?? '')} label={label} path={path} readers={readers} onChange={onChange} />
    : <input aria-label={label} type="text" value={String(value ?? '')} maxLength={field.maxLength} onChange={event => onChange(event.target.value)} />}
    {name === 'tex' && <Formula tex={String(value ?? '')} block />}
  </div>;
}

function SuggestionEditor({ id, proposal, state, disabled, onSave, onCancel, onSavingChange }: { id: string; proposal: AiProposal; state: ResearchNotebookState; disabled: boolean; onSave: (adjustment: AiProposalAdjustment) => Promise<boolean>; onCancel: () => void; onSavingChange: (saving: boolean) => void }) {
  const [draft, setDraft] = useState(() => sourceOf(proposal)), current = useRef(draft);
  const [readers] = useState<Readers>(() => new Map()), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const fields = fieldsOf(proposal);
  const root = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => { root.current?.querySelector<HTMLElement>('input, select, [role=textbox]')?.focus({ preventScroll: true }); }, []);
  const update = (next: AiProposalAdjustment) => { current.current = next; setDraft(next); setError(''); };
  const save = async () => {
    if (saving || disabled) return;
    setSaving(true); onSavingChange(true); setError('');
    const value = structuredClone(current.current);
    for (const { path, read } of readers.values()) {
      let parent = value as unknown as Record<string | number, unknown>;
      for (const key of path.slice(0, -1)) parent = parent[key] as typeof parent;
      parent[path.at(-1)!] = read();
    }
    try { if (await onSave(value)) onCancel(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'AI 修改预览不可用。'); }
    finally { setSaving(false); onSavingChange(false); }
  };
  return <form ref={root} id={id} role="region" className="mewiki-ai-adjustment" aria-label={t('调整建议')} onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && !saving) { event.preventDefault(); event.stopPropagation(); onCancel(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); void save(); }
  }}><ResearchNoteLinkContext.Provider value={{ notes: state.notes, symbols: state.symbols, terms: state.terms ?? [], state, sourceNoteId: proposal.kind !== 'term' && (proposal.kind !== 'native' || proposal.target === 'note') ? proposal.targetId : '', openNote: () => {} }}>
      <fieldset disabled={disabled || saving} inert={disabled || saving} className="mewiki-ai-adjustment-fields">
        {draft.title !== undefined && <AdjustmentField name="title" value={draft.title} schema={{ type: 'string', maxLength: 1000 }} path={['title']} readers={readers} onChange={title => update({ ...current.current, title: String(title) })} />}
        {draft.content !== undefined && <AdjustmentField name="content" value={draft.content} schema={{ type: 'string', maxLength: 40000 }} path={['content']} readers={readers} onChange={content => update({ ...current.current, content: String(content) })} />}
        {Object.entries(draft.fields ?? {}).map(([key, value]) => <AdjustmentField key={key} name={key} value={value} schema={fields[key] ?? {}} path={['fields', key]} readers={readers}
          onChange={next => update({ ...current.current, fields: { ...current.current.fields, [key]: next } })} />)}
      </fieldset>
    </ResearchNoteLinkContext.Provider>{error && <p role="alert">{localizeError(error)}</p>}
  </form>;
}

export default function AiInlineSuggestion({ proposals, before, after, presentation, state, disabled, errors, directEdit = true, onApprove, onReject, onRevise, onEditingChange }: {
  proposals: AiProposal[]; before?: ReactNode; after?: ReactNode; state: ResearchNotebookState; disabled: boolean; errors: Record<string, string>; directEdit?: boolean;
  presentation?: AiReviewPresentation;
  onApprove: (proposal: AiProposal) => void; onReject: (proposal: AiProposal) => void;
  onRevise: (proposal: AiProposal, adjustment: AiProposalAdjustment) => Promise<boolean>;
  onEditingChange?: (id: string, editing: boolean) => void;
}) {
  useLocale();
  const [editingId, setEditingId] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>()), formId = useId();
  const editing = proposals.find(proposal => proposal.id === editingId);
  const editable = proposals.filter(proposal => canAdjustAiProposal(proposal) && !errors[proposal.id]);
  useEffect(() => {
    if (!editingId) return;
    onEditingChange?.(editingId, true);
    return () => onEditingChange?.(editingId, false);
  }, [editingId, onEditingChange]);
  const cancel = () => {
    setEditingId(null);
    if (editingId) requestAnimationFrame(() => buttons.current.get(editingId)?.focus({ preventScroll: true }));
  };
  const canDirectEdit = directEdit && !disabled && editable.length === 1 && !editing;
  const editableContent = (content: ReactNode) => canDirectEdit && !!content && (!Array.isArray(content) || !!content.length) ? <div className="mewiki-ai-review-editable" role="textbox" aria-label={t('编辑建议内容')} aria-multiline="true" aria-readonly="true" tabIndex={0}
      onClick={event => { if (!(event.target instanceof Element) || !event.target.closest('a, button, input, select, textarea, [contenteditable=true]')) {
        if (window.getSelection()?.isCollapsed !== false) setEditingId(editable[0].id);
      } }} onKeyDown={event => { if (['Enter', 'F2'].includes(event.key) && event.target === event.currentTarget && !event.nativeEvent.isComposing) { event.preventDefault(); setEditingId(editable[0].id); } }}>{content}</div> : content;
  const content = editing ? <RenderedChange kind="add"><SuggestionEditor key={editing.id} id={formId} proposal={editing} state={state} disabled={disabled}
    onSave={adjustment => onRevise(editing, adjustment)} onCancel={cancel} onSavingChange={setSaving} /></RenderedChange> : editableContent(after);
  const decisions = <div className="mewiki-ai-review-decisions">{proposals.map(proposal => <div key={proposal.id} data-ai-review-proposal-id={proposals.length > 1 ? proposal.id : undefined} className="mewiki-ai-inline-actions" role="group" aria-label={t('此处修改操作')}>
      {editing?.id === proposal.id ? <>
        <button type="submit" form={formId} data-ui="icon-action" aria-label={t('保留调整')} title={t('保留调整')} disabled={disabled || saving}><Save size={15} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('取消调整')} title={t('取消调整')} disabled={saving} onClick={cancel}><RotateCcw size={15} /></button>
      </> : <>
        <button type="button" data-ui="icon-action" aria-label={t('同意此修改')} title={errors[proposal.id] ? localizeError(errors[proposal.id]) : t('同意此修改')} disabled={disabled || !!errors[proposal.id] || !!editing} onClick={() => onApprove(proposal)}><Check size={15} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('拒绝此修改')} title={t('拒绝此修改')} disabled={disabled || !!editing} onClick={() => onReject(proposal)}><X size={15} /></button>
        {canAdjustAiProposal(proposal) && <button ref={button => { if (button) buttons.current.set(proposal.id, button); else buttons.current.delete(proposal.id); }} type="button" data-ui="icon-action" aria-label={t('调整此修改')} title={t('调整此修改')} disabled={disabled || !!errors[proposal.id] || !!editing} onClick={() => setEditingId(proposal.id)}><Pencil size={14} /></button>}
      </>}
    </div>)}</div>;
  return <div className="mewiki-ai-inline-suggestion" data-ai-review-proposal-id={proposals.length === 1 ? proposals[0].id : undefined} data-editing={!!editing || undefined}
    onKeyDown={event => { if (editing && event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!saving) cancel(); } }}>
    {presentation && !editing ? presentation.render(decisions, editableContent) : <AiReviewPair before={before} after={content} between={decisions} />}
  </div>;
}

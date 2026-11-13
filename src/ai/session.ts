import { AI_MAX_CONTENT, type AiChange, type AiProposal } from './proposals.ts';
import type { AiMessage, AiProvider } from './types.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import type { AiRunProgress } from './runner.ts';
import { normalizeResearchBlock } from '../domain/researchNotebook.ts';
import { termEntryError, type ResearchTermEntry } from '../domain/researchTerms.ts';
import { symbolEntryError, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { aiBlockFields, aiMapFields, aiNoteFields, aiNoteSnapshotFields, aiObject, aiRelationFields, aiSymbolFields, aiSymbolSnapshotFields, aiTermFields, validateAiFields, validateAiNativeInput } from './nativeSchema.ts';
import { findResearchBlock } from '../domain/researchBlockTree.ts';
import { nativeEditTarget, nativeFingerprint, type AiNativeEffect, type AiNativeTarget } from './nativeEdits.ts';
import type { AiNativeProposal } from './nativeProposals.ts';
import { restoreAiUsageHistory, type AiUsageRecord } from './usage.ts';
import { normalizeFormulaRecipe } from '../domain/researchRecipeMetadata.ts';

export interface AiReplyActivity { tools: string[]; proposalIds: string[] }
export type AiConversationMessage = AiMessage & { providerName?: string; model?: string; contextKey?: string; activity?: AiReplyActivity };
export interface AiSession extends AiRunProgress {
  version: 1; libraryId: string; status: 'idle' | 'running' | 'interrupted' | 'cancelled' | 'complete' | 'error';
  contextKey?: string;
  draft?: string;
  usageHistory?: AiUsageRecord[];
  mergedIds?: string[];
  rejectedIds?: string[];
  history: AiConversationMessage[]; changes: AiChange[]; appliedIds: string[]; error: string; providerName: string; model: string;
}
/** Reuse natural-language history only within the same configured destination and scope. */
export function aiHistoryContextKey(provider: Pick<AiProvider, 'id' | 'baseUrl' | 'protocol'>, model: string, noteIds: string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify([provider.id, provider.baseUrl, provider.protocol, model, [...new Set(noteIds)].sort()]));
  return [...sha256(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createAiSession(libraryId: string): AiSession {
  return { version: 1, libraryId, status: 'idle', output: '', tools: [], sourceIds: [], proposals: [], changes: [], appliedIds: [], history: [], usageHistory: [], usage: { inputTokens: 0, outputTokens: 0 }, error: '', providerName: '', model: '' };
}
const key = (libraryId: string) => `mewiki:library:${encodeURIComponent(libraryId)}:ai-session:v1`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const contextKey = (value: unknown) => value === undefined || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
const strings = (value: unknown, max: number, length = 1000): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => text(item, length));
function restoredReplyActivity(message: AiConversationMessage, available: Set<string>, claimed: Set<string>): AiReplyActivity | undefined {
  const activity = message.activity;
  if (message.role !== 'assistant' || !record(activity) || !strings(activity.tools, 40) || !strings(activity.proposalIds, 40)) return undefined;
  return { tools: [...activity.tools], proposalIds: activity.proposalIds.filter(id => {
    if (!available.has(id) || claimed.has(id)) return false;
    claimed.add(id); return true;
  }) };
}
const snapshotId = (value: unknown): value is string => text(value, 1000) && !!value.trim();
const snapshotList = (items: unknown) => ({ type: 'array', items, maxItems: 10000 });
const snapshotString = { type: 'string', maxLength: 1000000 };
const snapshotKnowledge = {
  annotations: aiMapFields.annotations,
  relations: snapshotList(aiObject({ id: { type: 'string', minLength: 1, maxLength: 1000 }, ...aiRelationFields }, ['id', 'source', 'target', 'kind', 'description'])),
};
const snapshotView = aiObject(aiMapFields.view.properties, ['expandedNoteIds', 'showAllBlocks', 'layout']);
function snapshotFields(value: unknown, properties: Record<string, unknown>, required: string[] = []): boolean {
  // Snapshots retain complete existing content, including blocks larger than one proposed edit.
  const wider = (item: unknown): unknown => Array.isArray(item) ? item.map(wider) : record(item)
    ? Object.fromEntries(Object.entries(item).map(([key, value]) => [key, key === 'maxLength' ? 1000000 : key === 'maxItems' ? 10000 : wider(value)])) : item;
  try { validateAiFields(value, wider(properties) as Record<string, unknown>, required); return true; } catch { return false; }
}
function nativeBlockSnapshot(value: unknown, ids: Set<string>, depth = 0): boolean {
  if (!record(value) || !snapshotId(value.id) || typeof value.type !== 'string' || !(value.type in aiBlockFields) || ids.has(value.id) || ids.size >= 10000 || depth > 20) return false;
  ids.add(value.id);
  const normalized = normalizeResearchBlock(value);
  if (!normalized || normalized.type !== value.type) return false;
  if (value.type === 'external' || value.type === 'evidence') return true;
  const { id: _id, type, ...fields } = value;
  const properties: Record<string, unknown> = { ...aiBlockFields[type as keyof typeof aiBlockFields] };
  if (type === 'examples') {
    properties.tabs = snapshotList(aiObject({ id: snapshotString, title: snapshotString, blocks: snapshotList({ type: 'object' }) }, ['id', 'title', 'blocks']));
    if (!Array.isArray(value.tabs) || !value.tabs.length) return false;
    const tabs = new Set<string>();
    for (const tab of value.tabs) {
      if (!record(tab) || !snapshotId(tab.id) || tabs.has(tab.id) || !Array.isArray(tab.blocks) || !tab.blocks.every(block => nativeBlockSnapshot(block, ids, depth + 1))) return false;
      tabs.add(tab.id);
    }
  }
  if (type === 'media') properties.legacySource = snapshotString;
  if (type === 'formula' && Array.isArray(fields.outputs)) {
    const outputs = new Set<string>();
    fields.outputs = fields.outputs.map(output => {
      if (!record(output) || !snapshotId(output.id) || outputs.has(output.id)) throw new Error('invalid output');
      outputs.add(output.id);
      const { recipe, ...rest } = output;
      if (recipe !== undefined && !normalizeFormulaRecipe(recipe)) throw new Error('invalid recipe');
      return rest;
    });
  }
  const required = type === 'heading' ? ['text', 'level'] : ['paragraph', 'markdown', 'callout'].includes(String(type)) ? ['text']
    : type === 'list' ? ['items'] : type === 'formula' ? ['tex'] : type === 'examples' ? ['tabs'] : [];
  return snapshotFields(fields, properties, required);
}
function termSnapshot(value: unknown, id: string, native = false): boolean {
  const limit = native ? 1000000 : AI_MAX_CONTENT, shortLimit = native ? limit : 1000, countLimit = native ? 10000 : 250;
  if (!record(value) || value.id !== id || !text(value.name, shortLimit) || !text(value.meaning, limit) || !strings(value.aliases, countLimit, shortLimit)) return false;
  for (const field of ['englishName', 'englishAbbreviation', 'chineseAbbreviation', 'scope']) if (value[field] !== undefined && !text(value[field], field === 'scope' ? limit : shortLimit)) return false;
  if (value.tags !== undefined && !strings(value.tags, countLimit, shortLimit)) return false;
  if (value.aliasEntries !== undefined && (!Array.isArray(value.aliasEntries) || value.aliasEntries.some(alias => !record(alias) || !text(alias.id, 1000) || !text(alias.name, shortLimit)))) return false;
  try {
    const { id: _id, ...fields } = value;
    if (!snapshotFields(fields, aiTermFields, ['name', 'meaning', 'aliases'])) return false;
    if (value.aliasEntries !== undefined && (value.aliasEntries as Record<string, unknown>[]).some(item => !snapshotId(item.id))) return false;
    if (value.atoms !== undefined && ((value.atoms as Record<string, unknown>[]).some(item => !snapshotId(item.id)) || new Set((value.atoms as Record<string, unknown>[]).map(item => item.id)).size !== (value.atoms as unknown[]).length)) return false;
    return !termEntryError(value as unknown as ResearchTermEntry, []);
  } catch { return false; }
}
function noteSnapshot(value: unknown, id: string, requireStamp = true): boolean {
  if (!record(value) || value.id !== id || !text(value.title, 10000) || !Array.isArray(value.blocks) || value.blocks.length > 10000) return false;
  if (requireStamp && (!text(value.createdAt, 100) || !text(value.updatedAt, 100))) return false;
  try { return value.blocks.every(block => record(block) && !!normalizeResearchBlock(block)); } catch { return false; }
}
function nativeSnapshot(value: unknown, target: AiNativeTarget, id: string, requireStamp = true): boolean {
  if (!record(value) || value.id !== id) return false;
  if (target === 'note') {
    if (!noteSnapshot(value, id, requireStamp)) return false;
    const { id: _id, blocks, theory, ...fields } = value;
    const ids = new Set<string>();
    return snapshotFields(fields, aiNoteSnapshotFields, ['title', 'createdAt', ...(requireStamp ? ['updatedAt'] : [])]) &&
      (theory === undefined || snapshotFields(theory, snapshotKnowledge, ['annotations', 'relations'])) &&
      (blocks as unknown[]).every(block => nativeBlockSnapshot(block, ids));
  }
  if (target === 'term') return termSnapshot(value, id, true);
  try {
    if (target === 'symbol') {
      const { id: _id, ...fields } = value;
      if (!snapshotFields(fields, aiSymbolSnapshotFields, ['name', 'meaning', 'notation', 'category', 'slots'])) return false;
      return !symbolEntryError(value as unknown as ResearchSymbolEntry, []);
    }
    const { id: _id, ...fields } = value;
    return snapshotFields(fields, { ...aiMapFields, ...snapshotKnowledge, kind: { enum: ['topic', 'global'] }, createdAt: snapshotString, updatedAt: snapshotString, view: snapshotView }, ['title', 'kind', 'noteIds', 'annotations', 'relations', 'view', 'createdAt', ...(requireStamp ? ['updatedAt'] : [])]);
  } catch { return false; }
}
function storedNativeProposal(value: Record<string, unknown>): boolean {
  if (!record(value.edit) || !['note', 'symbol', 'term', 'map'].includes(value.target as string) || typeof value.targetId !== 'string') return false;
  const edit = value.edit;
  if (!text(edit.generatedId, 1000) || !edit.generatedId || !record(edit.fields)) return false;
  try {
    const { generatedId: _id, generatedAt, block, ...input } = edit;
    if (generatedAt !== undefined && (!text(generatedAt, 100) || !Number.isFinite(Date.parse(generatedAt)))) return false;
    validateAiNativeInput(input);
    const target = nativeEditTarget(edit as unknown as AiNativeProposal['edit']);
    if (target.target !== value.target || target.id !== value.targetId || (value.before !== null && !nativeSnapshot(value.before, target.target, target.id))) return false;
    const action = String(edit.action);
    const creates = action === 'map-create' || (action === 'symbol-save' || action === 'term-save') && !edit.entryId;
    if (creates !== (value.before === null)) return false;
    if (action === 'block-insert' || action === 'block-update') {
      const original = action === 'block-update' && record(value.before) && Array.isArray(value.before.blocks) ? findResearchBlock(value.before.blocks as Parameters<typeof findResearchBlock>[0], String(edit.blockId))?.block : null;
      const type = action === 'block-insert' ? edit.blockType : original?.type;
      if (typeof type !== 'string' || !(type in aiBlockFields)) return false;
      validateAiFields(edit.fields, aiBlockFields[type as keyof typeof aiBlockFields]);
      if (action === 'block-insert' && (!record(block) || block.id !== edit.generatedId || block.type !== type || ['external', 'evidence'].includes(type) || !nativeBlockSnapshot(block, new Set<string>()))) return false;
    } else if (block !== undefined) return false;
    if (action === 'symbol-save') validateAiFields(edit.fields, aiSymbolFields);
    if (action === 'term-save') validateAiFields(edit.fields, aiTermFields);
    if (action === 'note-update') validateAiFields(edit.fields, aiNoteFields);
    if (action === 'map-create' || action === 'map-update') validateAiFields(edit.fields, aiMapFields);
    if (action === 'relation-save') validateAiFields(edit.fields, aiRelationFields, ['source', 'target', 'kind', 'description']);
    return true;
  } catch { return false; }
}
function mapWorkspaceSnapshot(value: unknown, legacy = false): boolean {
  if (!record(value)) return false;
  if (legacy) return snapshotFields(value, { version: { const: 1 }, open: { type: 'boolean' }, scope: { enum: ['local', 'topic', 'global'] }, topicId: snapshotString, depth: { type: 'number' },
    expandedNoteIds: snapshotList(snapshotString), showAllBlocks: { type: 'boolean' }, selectedNodeId: snapshotString, ...snapshotKnowledge,
    topics: snapshotList(aiObject({ id: snapshotString, title: snapshotString, noteIds: snapshotList(snapshotString) }, ['id', 'title', 'noteIds'])),
    layouts: { type: 'object', additionalProperties: aiMapFields.view.properties.layout },
  }, ['version', 'open', 'scope', 'topicId', 'depth', 'expandedNoteIds', 'showAllBlocks', 'annotations', 'relations', 'topics', 'layouts']);
  if (!snapshotFields(value, { version: { const: 1 }, activeMapId: snapshotString, documents: snapshotList({ type: 'object' }), deletedMapIds: snapshotList(snapshotString),
    unresolvedKnowledge: aiObject(snapshotKnowledge, ['annotations', 'relations']), noteViewOpen: { type: 'boolean' },
    noteViews: { type: 'object', additionalProperties: aiObject({ ...aiMapFields.view.properties, depth: { type: 'number' } }, ['expandedNoteIds', 'showAllBlocks', 'layout', 'depth']) },
  }, ['version', 'activeMapId', 'documents', 'deletedMapIds', 'noteViewOpen', 'noteViews'])) return false;
  const docs = value.documents as Record<string, unknown>[];
  return docs.length > 0 && new Set(docs.map(doc => doc.id)).size === docs.length && docs.every(doc => snapshotId(doc.id) && nativeSnapshot(doc, 'map', doc.id)) && docs.some(doc => doc.id === value.activeMapId);
}
function storedEffects(value: unknown, target: AiNativeTarget, targetId: string, before: unknown, after: unknown): value is AiNativeEffect[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000) return false;
  const keys = new Set<string>();
  let primary = false;
  const valid = value.every(effect => {
    if (!record(effect)) return false;
    const key = `${effect.collection}:${effect.id ?? ''}`;
    if (keys.has(key) || nativeFingerprint(effect.before) === nativeFingerprint(effect.after)) return false;
    keys.add(key);
    if (effect.collection === 'theoryMaps' || effect.collection === 'theoryMap') {
      if (!['note', 'map'].includes(target) || Object.keys(effect).some(key => !['collection', 'before', 'after'].includes(key))) return false;
      if (!(effect.before === null || mapWorkspaceSnapshot(effect.before, effect.collection === 'theoryMap')) || !(effect.after === null || mapWorkspaceSnapshot(effect.after, effect.collection === 'theoryMap'))) return false;
      if (target === 'map' && effect.collection === 'theoryMaps') {
        const document = (workspace: unknown) => record(workspace) && Array.isArray(workspace.documents) ? workspace.documents.find(doc => record(doc) && doc.id === targetId) ?? null : null;
        primary = nativeFingerprint(document(effect.before)) === nativeFingerprint(before) && nativeFingerprint(document(effect.after)) === nativeFingerprint(after);
      }
      return true;
    }
    const entityTarget = effect.collection === 'notes' ? 'note' : effect.collection === 'symbols' ? 'symbol' : effect.collection === 'terms' ? 'term' : null;
    if (!entityTarget || Object.keys(effect).some(key => !['collection', 'id', 'before', 'after', 'index'].includes(key)) || !snapshotId(effect.id) || !Number.isSafeInteger(effect.index) || (effect.index as number) < 0 || (effect.index as number) > 10000 ||
      !(effect.before === null || nativeSnapshot(effect.before, entityTarget, effect.id)) || !(effect.after === null || nativeSnapshot(effect.after, entityTarget, effect.id))) return false;
    if (entityTarget === target && effect.id === targetId) {
      primary = nativeFingerprint(effect.before) === nativeFingerprint(before) && nativeFingerprint(effect.after) === nativeFingerprint(after);
      return primary;
    }
    if (entityTarget !== 'note' || !record(effect.before) || !record(effect.after)) return false;
    if (effect.before.reviewStatus !== effect.after.reviewStatus && !(effect.before.reviewStatus === 'reviewed' && effect.after.reviewStatus === 'pending')) return false;
    const migrated = ['note', 'map'].includes(target) && effect.before.theory === undefined;
    const sideEffect = (note: Record<string, unknown>) => ({ ...note, reviewStatus: undefined, ...(migrated ? { theory: undefined } : {}) });
    return nativeFingerprint(sideEffect(effect.before)) === nativeFingerprint(sideEffect(effect.after));
  });
  return valid && primary;
}
function storedProposal(value: unknown, libraryId: string): value is AiProposal {
  if (!record(value) || value.libraryId !== libraryId || !text(value.id, 1000) || !text(value.targetId, 1000) || !text(value.title, 300) || !text(value.content, AI_MAX_CONTENT) || (value.kind === 'delete-text' ? value.content !== '' : !value.content.trim())) return false;
  if (value.kind === 'native') return storedNativeProposal(value);
  if (value.kind === 'term') return termSnapshot(value.term, value.targetId) && (value.before === null || termSnapshot(value.before, value.targetId));
  if (!['create', 'append', 'replace-text', 'delete-text'].includes(value.kind as string)) return false;
  if (value.kind === 'create') return value.before === null;
  return noteSnapshot(value.before, value.targetId) && (!['replace-text', 'delete-text'].includes(value.kind as string) || text(value.blockId, 1000));
}
function storedChange(value: unknown, libraryId: string): value is AiChange {
  if (!record(value) || value.libraryId !== libraryId || !text(value.proposalId, 1000) || !text(value.targetId, 1000) || !text(value.after, 1000000) || (value.baseline !== undefined && !text(value.baseline, 1000000))) return false;
  try {
    const after = JSON.parse(value.after);
    if (value.effects !== undefined) {
      const target = value.target as AiNativeTarget;
      if (!['note', 'symbol', 'term', 'map'].includes(target) || !(value.before === null || nativeSnapshot(value.before, target, value.targetId)) ||
        !(after === null || nativeSnapshot(after, target, value.targetId, false))) return false;
      if (value.baseline !== undefined) {
        const baseline = JSON.parse(value.baseline as string);
        if (!(baseline === null || nativeSnapshot(baseline, target, value.targetId, false))) return false;
      }
      return storedEffects(value.effects, target, value.targetId, value.before, after);
    }
    if (value.target === 'term') return termSnapshot(after, value.targetId) && (value.before === null || termSnapshot(value.before, value.targetId));
    return value.target === 'note' && noteSnapshot(after, value.targetId, false) && (value.before === null || noteSnapshot(value.before, value.targetId));
  } catch { return false; }
}
export function readAiSession(libraryId: string, storage: Pick<Storage, 'getItem'>): AiSession {
  try {
    const value = storage.getItem(key(libraryId));
    if (!value || value.length > 2 * 1024 * 1024) return createAiSession(libraryId);
    const session = JSON.parse(value) as AiSession;
    if (session.version !== 1 || session.libraryId !== libraryId || typeof session.output !== 'string' || session.output.length > 100000 ||
      !['idle', 'running', 'interrupted', 'cancelled', 'complete', 'error'].includes(session.status) ||
      !contextKey(session.contextKey) || !Array.isArray(session.history) || session.history.length > 20 || session.history.some(message => !record(message) || !['user', 'assistant'].includes(message.role) || !text(message.content, 100000) || !contextKey(message.contextKey) || (message.providerName !== undefined && !text(message.providerName, 300)) || (message.model !== undefined && !text(message.model, 300))) ||
      !Array.isArray(session.proposals) || session.proposals.length > 40 || session.proposals.some(proposal => !storedProposal(proposal, libraryId)) ||
      !Array.isArray(session.changes) || session.changes.length > 40 || session.changes.some(change => !storedChange(change, libraryId)) ||
      !strings(session.appliedIds, 40) || !strings(session.tools, 40) || !strings(session.sourceIds, 1000) ||
      !text(session.error, 1000) || !text(session.providerName, 300) || !text(session.model, 300) ||
      !Number.isFinite(session.usage?.inputTokens) || session.usage.inputTokens < 0 || !Number.isFinite(session.usage?.outputTokens) || session.usage.outputTokens < 0) return createAiSession(libraryId);
    if (session.changes.some(change => {
      const proposal = session.proposals.find(item => item.id === change.proposalId);
      return proposal?.kind === 'native' && (change.target !== proposal.target || change.targetId !== proposal.targetId ||
        (change.baseline !== undefined && change.baseline !== nativeFingerprint(proposal.before)));
    })) return createAiSession(libraryId);
    const available = new Set(session.proposals.map(proposal => proposal.id)), claimed = new Set<string>();
    const history = session.history.map(message => {
      const activity = restoredReplyActivity(message, available, claimed);
      return { role: message.role, content: message.content, ...(message.contextKey ? { contextKey: message.contextKey } : {}), ...(message.providerName ? { providerName: message.providerName } : {}), ...(message.model ? { model: message.model } : {}), ...(activity ? { activity } : {}) };
    });
    return { version: 1, libraryId, status: session.status === 'running' ? 'interrupted' : session.status,
      ...(session.contextKey ? { contextKey: session.contextKey } : {}),
      ...(text(session.draft, 12000) ? { draft: session.draft } : {}),
      output: session.output, history,
      tools: session.tools, sourceIds: session.sourceIds, proposals: session.proposals, changes: session.changes, appliedIds: session.appliedIds,
      ...(session.mergedIds !== undefined ? { mergedIds: strings(session.mergedIds, 40) ? [...new Set(session.mergedIds)].filter(id => available.has(id) && session.appliedIds.includes(id) && !session.changes.some(change => change.proposalId === id)) : [] } : {}),
      ...(session.rejectedIds !== undefined ? { rejectedIds: strings(session.rejectedIds, 40) ? [...new Set(session.rejectedIds)].filter(id => available.has(id) && !session.appliedIds.includes(id)) : [] } : {}),
      error: session.error, providerName: session.providerName, model: session.model,
      usageHistory: restoreAiUsageHistory(session),
      usage: { inputTokens: session.usage.inputTokens, outputTokens: session.usage.outputTokens } };
  } catch { return createAiSession(libraryId); }
}
export function writeAiSession(session: AiSession, storage: Pick<Storage, 'setItem'>): void {
  try {
    const text = JSON.stringify(session);
    if (text.length > 2 * 1024 * 1024) throw new Error('limit');
    storage.setItem(key(session.libraryId), text);
  } catch { throw new Error('AI 会话未能保存，请保持窗口打开。'); }
}

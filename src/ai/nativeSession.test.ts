import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createNativeProposal, applyNativeProposal } from './nativeProposals.ts';
import { nativeFingerprint } from './nativeEdits.ts';
import { createAiSession, readAiSession, type AiSession } from './session.ts';
import { createTermEntry } from '../domain/researchTerms.ts';
import { restoreNativeEffects } from './nativeEdits.ts';

const restore = (session: unknown) => readAiSession('a', { getItem: () => JSON.stringify(session) });
function appliedSession() {
  const state = createNotebookFixture();
  const proposal = createNativeProposal(state, 'a', { action: 'symbol-save', entryId: 'example-matrix', fields: { meaning: '新含义' } });
  const applied = applyNativeProposal(state, proposal, 'a');
  return { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] } satisfies AiSession;
}

describe('native AI session recovery boundaries', () => {
  it('restores valid reviewed edits and frozen map creations', () => {
    const session = appliedSession();
    expect(restore(session)).toEqual(session);
    const state = createNotebookFixture(), proposal = createNativeProposal(state, 'a', { action: 'map-create', fields: { title: '可恢复地图' } });
    const applied = applyNativeProposal(state, proposal, 'a');
    const mapSession = { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] };
    expect(restore(mapSession)).toEqual(mapSession);
  });

  it('retains long existing term meanings and scopes while keeping new edit input bounded', () => {
    const state = createNotebookFixture();
    state.terms = [createTermEntry({ name: '旧术语', meaning: '释'.repeat(45000), scope: '域'.repeat(45000), aliases: [] }, 'long-existing')];
    const proposal = createNativeProposal(state, 'a', { action: 'term-save', entryId: 'long-existing', fields: { tags: ['已核对'] } });
    const applied = applyNativeProposal(state, proposal, 'a');
    const session = { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] };
    const recovered = restore(session);
    expect(recovered.proposals).toHaveLength(1); expect(recovered.changes).toHaveLength(1);
    expect(nativeFingerprint(recovered) === nativeFingerprint(session)).toBe(true);
    expect(() => createNativeProposal(state, 'a', { action: 'term-save', entryId: 'long-existing', fields: { meaning: '新'.repeat(45000) } })).toThrow(/长度|字段/);
  });

  it('recovers a legacy full map effect and still undoes it after pure navigation', () => {
    const state = createNotebookFixture(), added = createNativeProposal(state, 'a', { action: 'map-create', fields: { title: '地图' } });
    const baseline = applyNativeProposal(state, added, 'a').state;
    const proposal = createNativeProposal(baseline, 'a', { action: 'map-update', mapId: added.targetId, fields: { title: '修改后' } });
    const applied = applyNativeProposal(baseline, proposal, 'a');
    const session = { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] };
    const recovered = restore(session); expect(recovered.changes).toHaveLength(1);
    applied.state.theoryMaps!.activeMapId = 'global'; applied.state.theoryMaps!.noteViewOpen = true;
    const restored = restoreNativeEffects(applied.state, recovered.changes[0].effects!);
    expect(restored.theoryMaps).toMatchObject({ activeMapId: 'global', noteViewOpen: true });
    expect(restored.theoryMaps!.documents.find(map => map.id === added.targetId)!.title).toBe('地图');
  });

  it('recovers an applied update to a lazily initialized global map without weakening primary bindings', () => {
    const state = createNotebookFixture(); delete state.theoryMaps; delete state.theoryMap;
    const proposal = createNativeProposal(state, 'a', { action: 'map-update', mapId: 'global', fields: { title: '全局知识地图' } });
    const applied = applyNativeProposal(state, proposal, 'a');
    const session = { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] };
    const recovered = restore(session); expect(recovered.changes).toHaveLength(1);
    expect(nativeFingerprint(recovered) === nativeFingerprint(session)).toBe(true);
    const invalid = structuredClone(session), before = invalid.changes[0].before;
    if (before && 'title' in before) before.title = '与初始化快照不符';
    expect(restore(invalid)).toEqual(createAiSession('a'));
  });

  it('keeps older null-before map-creation effects recoverable and preserves navigation on undo', () => {
    const state = createNotebookFixture(); delete state.theoryMaps; delete state.theoryMap;
    const proposal = createNativeProposal(state, 'a', { action: 'map-create', fields: { title: '旧会话创建的地图' } });
    const applied = applyNativeProposal(state, proposal, 'a');
    const effect = applied.change.effects.find(effect => effect.collection === 'theoryMaps')!; effect.before = null;
    const session = { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] };
    const recovered = restore(session); expect(recovered.changes).toHaveLength(1);
    applied.state.theoryMaps!.activeMapId = proposal.targetId; applied.state.theoryMaps!.noteViewOpen = true;
    applied.state.theoryMaps!.noteViews['fixture-definition'] = { expandedNoteIds: ['fixture-definition'], showAllBlocks: true, depth: 3, layout: { positions: {} } };
    const restored = restoreNativeEffects(applied.state, recovered.changes[0].effects!);
    expect(restored.theoryMaps).toMatchObject({ activeMapId: 'global', noteViewOpen: true, noteViews: applied.state.theoryMaps!.noteViews });
    expect(restored.theoryMaps!.documents.some(doc => doc.id === proposal.targetId)).toBe(false);
  });

  it.each([
    { action: 'note-update', noteId: 'fixture-definition', fields: { title: '新名称' } },
    { action: 'block-update', noteId: 'fixture-application', blockId: 'fixture-application:formula', fields: { tex: 'E=mc^2' } },
    { action: 'block-insert', noteId: 'fixture-definition', blockType: 'examples', fields: { title: '新标签页' } },
    { action: 'term-save', fields: { name: '反馈', meaning: '一种机制', scope: '适用范围'.repeat(400) } },
    { action: 'map-update', mapId: 'existing-map', fields: { title: '新地图名称' } },
    { action: 'map-delete', mapId: 'existing-map' },
    { action: 'relation-save', noteId: 'fixture-summary', fields: { source: { noteId: 'fixture-definition' }, target: { noteId: 'fixture-summary' }, kind: 'derivation', description: '依赖关系' } },
  ])('keeps a valid $action proposal and its native side effects recoverable', input => {
    let state = createNotebookFixture();
    const initial = createNativeProposal(state, 'a', { action: 'map-create', fields: { title: '已有地图' } });
    state = applyNativeProposal(state, initial, 'a').state;
    state.theoryMaps!.documents.find(map => map.id === initial.targetId)!.id = 'existing-map';
    state.theoryMaps!.activeMapId = 'global';
    const proposal = createNativeProposal(state, 'a', input), applied = applyNativeProposal(state, proposal, 'a');
    const session = { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] };
    expect(restore(session)).toEqual(session);
  });

  it('rejects effects with mismatched targets, primary snapshots, duplicates or unrelated collections', () => {
    const original = appliedSession();
    const mutations = [
      (session: typeof original) => { const change = session.changes[0]; change.targetId = 'unrelated'; change.before = { ...change.before!, id: 'unrelated' }; change.after = nativeFingerprint({ ...JSON.parse(change.after), id: 'unrelated' }); },
      (session: typeof original) => {
        const change = session.changes[0]; change.targetId = 'unrelated'; change.before = { ...change.before!, id: 'unrelated' };
        change.after = nativeFingerprint({ ...JSON.parse(change.after), id: 'unrelated' });
        change.baseline = nativeFingerprint(change.before);
        const effect = change.effects[0]; if ('id' in effect) { effect.id = 'unrelated'; effect.before = change.before; effect.after = JSON.parse(change.after); }
      },
      (session: typeof original) => { session.changes[0].after = nativeFingerprint({ ...JSON.parse(session.changes[0].after), meaning: '与效果不符' }); },
      (session: typeof original) => { session.changes[0].effects.push(structuredClone(session.changes[0].effects[0])); },
      (session: typeof original) => { session.changes[0].effects.push({ collection: 'theoryMaps', before: { anything: true } as never, after: {} as never }); },
      (session: typeof original) => { const effect = session.changes[0].effects[0]; if ('id' in effect) effect.after = structuredClone(effect.before); },
      (session: typeof original) => {
        const note = createNotebookFixture().notes[0];
        session.changes[0].effects.push({ collection: 'notes', id: note.id, index: 0, before: note, after: { ...note, reviewStatus: 'reviewed' } });
      },
    ];
    for (const mutate of mutations) {
      const session = structuredClone(original); mutate(session);
      expect(restore(session)).toEqual(createAiSession('a'));
    }
  });

  it('rejects malformed native snapshots and action fields that point outside their target', () => {
    const state = createNotebookFixture(), proposal = createNativeProposal(state, 'a', { action: 'note-update', noteId: 'fixture-definition', fields: { title: '新标题' } });
    const session = { ...createAiSession('a'), proposals: [proposal] };
    const mutations = [
      (value: typeof proposal) => { (value.before as { tags: unknown }).tags = { bad: true }; },
      (value: typeof proposal) => { (value.before as { blocks: unknown[] }).blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 't', title: '标题', blocks: [{ id: 'bad', type: 'paragraph', text: 42 }] }] }]; },
      (value: typeof proposal) => { value.before = null; },
      (value: typeof proposal) => { value.edit.blockId = 'unrelated'; },
      (value: typeof proposal) => { value.edit.action = 'note-delete'; value.content = 'note-delete'; },
      (value: typeof proposal) => { (value.before as { blocks: unknown[] }).blocks = [{ id: 'invalid-recipe', type: 'formula', tex: 'x', outputs: [{ id: 'result', entryId: 'example-x', bindings: {}, recipe: { inputs: 'invalid' } }] }]; },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(session); mutate(value.proposals[0]);
      expect(restore(value)).toEqual(createAiSession('a'));
    }
  });
});

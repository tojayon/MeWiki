import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { defaultPublicationOptions } from '../domain/publicationTypes.ts';
import { readPublicationDraft, savePublicationDraft, reconcilePublicationDraft, type PublicationDraft, type PublicationDraftScope } from './publicationDrafts.ts';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createResearchNote } from '../domain/researchNotebook.ts';

const scope = (): PublicationDraftScope => ({ libraryId: crypto.randomUUID(), pluginId: 'example.export', exporterId: 'pictures', noteId: 'note', entry: 'note' });
function draft(author = '作者'): PublicationDraft {
  return {
    options: { ...defaultPublicationOptions(), author, fontSize: 0 }, title: '待续的标题', templateId: 'native', profileId: '', profileName: '',
    selected: ['block'], breaks: ['block'], allTabs: true, selectedTabs: { tabs: 'tab-2' }, pdfPages: { pdf: 3 }, view: 'content',
    pagedCanvas: { width: 1080, height: 1440, fontSize: 32, margin: 72 }, modeOptions: {},
    images: { includeCandidates: true, sources: [], selectedIds: [], crops: {}, currentId: '' },
    editor: { items: {}, scope: 'all', selectedId: '$subject' },
    design: { designId: '', name: '尚未保存的作品名', lastSignature: '', updatedAt: '', autoSavePaused: false },
  };
}

it('keeps incomplete configuration, content choices and binary originals across a new store read', async () => {
  const key = scope(), value = draft();
  value.images.sources = [{ id: 'upload', name: '原件.png', blob: new Blob(['original'], { type: 'image/png' }) }];
  value.images.selectedIds = ['upload']; value.images.currentId = 'upload';
  value.editor.items = { upload: { title: '单图标题', crop: { zoom: 150, x: 20, y: 80 } } };
  await savePublicationDraft(key, 'tab-a', value);
  const recovered = await readPublicationDraft(key, 'tab-a');
  expect(recovered?.options.fontSize).toBe(0);
  expect(recovered?.selectedTabs).toEqual(value.selectedTabs);
  expect(recovered?.editor).toEqual(value.editor);
  expect(recovered?.design).toEqual(value.design);
  expect(await recovered?.images.sources[0].blob?.text()).toBe('original');
  expect(recovered?.images.sources[0].name).toBe('原件.png');
});

it('restores each tab independently and reopens the most recently edited draft', async () => {
  const key = scope();
  await savePublicationDraft(key, 'tab-a', draft('甲'));
  await savePublicationDraft(key, 'tab-b', draft('乙'));
  expect((await readPublicationDraft(key, 'tab-a'))?.options.author).toBe('甲');
  expect((await readPublicationDraft(key, 'tab-b'))?.options.author).toBe('乙');
  expect((await readPublicationDraft(key, 'new-tab'))?.options.author).toBe('乙');
});

it('does not promote an unchanged refreshed tab ahead of another tab edited later', async () => {
  const key = scope();
  await savePublicationDraft(key, 'tab-a', draft('旧配置'));
  await savePublicationDraft(key, 'tab-b', draft('最后编辑的配置'));
  await savePublicationDraft(key, 'tab-a', draft('旧配置'), true);
  expect((await readPublicationDraft(key, 'new-tab'))?.options.author).toBe('最后编辑的配置');
});

it('does not promote a stale inherited value if another tab edits before initialization finishes', async () => {
  const key = scope();
  await savePublicationDraft(key, 'tab-z', draft('之前的配置'));
  const inherited = (await readPublicationDraft(key, 'tab-a'))!;
  await savePublicationDraft(key, 'tab-z', draft('最后编辑的配置'));
  await savePublicationDraft(key, 'tab-a', inherited, true);
  expect((await readPublicationDraft(key, 'tab-a'))?.options.author).toBe('之前的配置');
  expect((await readPublicationDraft(key, 'tab-new'))?.options.author).toBe('最后编辑的配置');
});

it('never mixes libraries, notes, plugins, exporters or entry modes', async () => {
  const key = scope(); await savePublicationDraft(key, 'tab', draft());
  for (const field of ['libraryId', 'noteId', 'pluginId', 'exporterId', 'entry'] as const) {
    expect(await readPublicationDraft({ ...key, [field]: field === 'entry' ? 'images' : 'other' }, 'tab')).toBeUndefined();
  }
});

it('bounds the number of retained tab drafts for one note without touching other notes', async () => {
  const key = scope(), other = { ...key, noteId: 'other' };
  await savePublicationDraft(other, 'other-tab', draft('其他笔记'));
  for (let index = 0; index < 10; index++) await savePublicationDraft(key, `tab-${index}`, draft(String(index)));
  expect((await readPublicationDraft(key, 'tab-2'))?.options.author).toBe('2');
  expect((await readPublicationDraft(key, 'tab-0'))?.options.author).toBe('9');
  expect((await readPublicationDraft(other, 'other-tab'))?.options.author).toBe('其他笔记');
});

it('does not revive deleted blocks, tabs or image edits for a replaced candidate', () => {
  const state = createNotebookFixture(), note = { ...createResearchNote('新的笔记快照'), id: 'note', blocks: [{ id: 'block', type: 'paragraph' as const, text: '新正文' }] };
  state.notes = [note];
  const value = draft(); value.selected = ['block', 'deleted']; value.breaks = ['deleted'];
  value.images.candidates = { 'note-image-0': 'a'.repeat(64) }; value.images.selectedIds = ['note-image-0'];
  value.editor.items = { 'note-image-0': { title: '旧图片' } };
  const restored = reconcilePublicationDraft(value, state, 'note');
  expect(restored.selected).toEqual(['block']); expect(restored.breaks).toEqual([]);
  expect(restored.selectedTabs).toEqual({}); expect(restored.pdfPages).toEqual({});
  expect(restored.images.selectedIds).toEqual([]); expect(restored.editor.items).toEqual({});
});

it('rejects unsupported shapes and oversized originals without replacing the saved draft', async () => {
  const key = scope(), value = draft('保留原设置'); await savePublicationDraft(key, 'tab', value);
  await expect(savePublicationDraft(key, 'tab', { ...value, images: { ...value.images, sources: [{ id: 'huge', name: 'too-large.png', blob: new Blob([new Uint8Array(9 * 1024 * 1024)]) }] } })).rejects.toThrow('草稿无法读取');
  expect((await readPublicationDraft(key, 'tab'))?.options.author).toBe('保留原设置');
});

it('keeps independently saved design sources when their original notebook candidates were deleted', () => {
  const state = createNotebookFixture(), note = { ...createResearchNote('已删除原图的笔记'), id: 'note', blocks: [] };
  state.notes = [note];
  const value = draft(); value.images.includeCandidates = false;
  value.images.candidates = { 'note-image-0': 'a'.repeat(64) };
  value.images.sources = [{ id: 'note-image-0', name: '作品主图.png', assetId: 'a'.repeat(64) }];
  value.images.selectedIds = ['note-image-0']; value.editor.items = { 'note-image-0': { title: '作品文案' } };
  const restored = reconcilePublicationDraft(value, state, 'note');
  expect(restored.images.selectedIds).toEqual(['note-image-0']); expect(restored.editor.items).toEqual(value.editor.items);
});

it('pauses named design autosave when notebook snapshot reconciliation removes selected image content', () => {
  const state = createNotebookFixture(); state.notes = [{ ...createResearchNote('原图已替换'), id: 'note', blocks: [] }];
  const value = draft(); value.design.designId = 'saved-design'; value.design.updatedAt = '2026-11-12';
  value.images.candidates = { 'note-image-0': 'a'.repeat(64) }; value.images.selectedIds = ['note-image-0'];
  value.editor.items = { 'note-image-0': { title: '旧图文案' } };
  expect(reconcilePublicationDraft(value, state, 'note').design.autoSavePaused).toBe(true);
});

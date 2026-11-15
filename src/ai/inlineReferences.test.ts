import { describe, expect, it } from 'vitest';
import type { AiReferenceItem } from './references.ts';
import {
  insertAiInlineReference, reconcileAiInlineReferences, restoreAiInlineReferences, type AiInlineReference,
} from './inlineReferences.ts';

const symbol: AiReferenceItem = { kind: 'module', id: 'symbols', label: '符号词典' };
const note: AiReferenceItem = { kind: 'note', id: 'fixture-note', label: '节点定义' };
const occurrence = (text: string, token: string, reference: AiReferenceItem = symbol, from = 0): AiInlineReference => {
  const start = text.indexOf(token, from);
  return { start, end: start + token.length, text: token, reference: { kind: reference.kind, id: reference.id } };
};
function repeated(count: number, unique = false) {
  const text = Array.from({ length: count }, (_, index) => `@对象${index} `).join('');
  return { text, refs: Array.from({ length: count }, (_, index) => occurrence(text, `@对象${index}`, { kind: 'note', id: unique ? `note-${index}` : 'same-note', label: `对象${index}` })) };
}

describe('restore inline object references', () => {
  const text = '阅读@符号词典，然后修改@节点定义。';
  const first = occurrence(text, '@符号词典'), second = occurrence(text, '@节点定义', note);

  it('restores sorted independent allowlisted ranges and retains unresolved identities', () => {
    const source = [{ ...second, privatePath: 'DO_NOT_KEEP', reference: { ...second.reference, label: 'DO_NOT_KEEP' } }, first];
    const restored = restoreAiInlineReferences(source, text)!;
    expect(restored).toEqual([first, second]);
    expect(JSON.stringify(restored)).not.toContain('DO_NOT_KEEP');
    restored[0].reference.id = 'different';
    expect(first.reference.id).toBe('symbols');
    expect(restoreAiInlineReferences([{ ...second, reference: { kind: 'note', id: 'removed-note' } }], text)?.[0].reference.id).toBe('removed-note');
    expect(restoreAiInlineReferences([], text)).toEqual([]);
  });

  it.each([
    undefined, null, {}, [null], [{ ...first, start: -1 }], [{ ...first, start: 2.5 }],
    [{ ...first, start: Number.NaN }], [{ ...first, end: Number.POSITIVE_INFINITY }],
    [{ ...first, end: text.length + 1 }], [{ ...first, start: first.end }],
    [{ ...first, text: '@别的名称' }], [{ ...first, text: '符号词典', start: first.start + 1 }],
    [{ ...first, reference: { kind: 'script', id: 'symbols' } }], [{ ...first, reference: { kind: 'module', id: '' } }],
    [first, { ...first }], [first, { ...first, start: first.start + 1, text: first.text.slice(1) }],
  ].map(value => ({ value })))('rejects the whole malformed or overlapping value', ({ value }) => {
    expect(restoreAiInlineReferences(value, text)).toBeUndefined();
  });

  it('requires a nonblank name after the at sign', () => {
    for (const token of ['@', '@  ', '@\n']) expect(restoreAiInlineReferences([{ start: 0, end: token.length, text: token, reference: first.reference }], token)).toBeUndefined();
  });

  it('limits occurrences independently from the number of unique objects', () => {
    const allowed = repeated(24), excessive = repeated(25), unique = repeated(13, true);
    expect(restoreAiInlineReferences(allowed.refs, allowed.text)).toHaveLength(24);
    expect(restoreAiInlineReferences(excessive.refs, excessive.text)).toBeUndefined();
    expect(restoreAiInlineReferences(unique.refs, unique.text)).toBeUndefined();
  });
});

describe('reconcile inline references after natural text edits', () => {
  const before = '阅读@符号词典，然后修改@节点定义。';
  const refs = [occurrence(before, '@符号词典'), occurrence(before, '@节点定义', note)];

  it('moves ranges after an edit before them and leaves the caller unchanged', () => {
    const after = '现在请' + before;
    const result = reconcileAiInlineReferences(before, after, refs);
    expect(result).toEqual(refs.map(ref => ({ ...ref, start: ref.start + 3, end: ref.end + 3 })));
    expect(refs[0].start).toBe(2);
    result[0].reference.id = 'changed'; expect(refs[0].reference.id).toBe('symbols');
  });

  it('preserves references on unrelated trailing edits', () => {
    expect(reconcileAiInlineReferences(before, before + '请保留引用。', refs)).toEqual(refs);
    expect(reconcileAiInlineReferences(before, before, refs)).toEqual(refs);
  });

  it('removes only the occurrence touched internally and keeps later stable identities', () => {
    const after = before.replace('@符号词典', '@术语词典');
    expect(reconcileAiInlineReferences(before, after, refs)).toEqual([refs[1]]);
    const inserted = before.slice(0, refs[0].start + 2) + '新' + before.slice(refs[0].start + 2);
    expect(reconcileAiInlineReferences(before, inserted, refs)).toEqual([{ ...refs[1], start: refs[1].start + 1, end: refs[1].end + 1 }]);
  });

  it('treats insertion exactly before or after a token as an external edit', () => {
    const { start, end } = refs[0];
    const atStart = before.slice(0, start) + '先' + before.slice(start), atEnd = before.slice(0, end) + '核对' + before.slice(end);
    expect(reconcileAiInlineReferences(before, atStart, refs)[0]).toEqual({ ...refs[0], start: start + 1, end: end + 1 });
    expect(reconcileAiInlineReferences(before, atEnd, refs)[0]).toEqual(refs[0]);
  });

  it('drops deleted bindings without assigning another object with the same name', () => {
    const duplicateText = '@同名笔记，比较@同名笔记。';
    const first = occurrence(duplicateText, '@同名笔记', { ...note, id: 'a' }), second = occurrence(duplicateText, '@同名笔记', { ...note, id: 'b' }, first.end);
    const after = duplicateText.slice(0, second.start) + '同名笔记。';
    expect(reconcileAiInlineReferences(duplicateText, after, [first, second])).toEqual([first]);
    expect(reconcileAiInlineReferences('阅读资料。', '阅读@符号词典和资料。', [])).toEqual([]);
  });

  it('uses the actual selection when either of two identical names is deleted', () => {
    const duplicateText = '@同名笔记 @同名笔记', after = '@同名笔记';
    const first = occurrence(duplicateText, after, { ...note, id: 'a' }), second = occurrence(duplicateText, after, { ...note, id: 'b' }, first.end);
    expect(reconcileAiInlineReferences(duplicateText, after, [first, second], { start: 0, end: second.start })).toEqual([{ ...second, start: 0, end: after.length }]);
    expect(reconcileAiInlineReferences(duplicateText, after, [first, second], { start: first.end, end: duplicateText.length })).toEqual([first]);
  });

  it('releases ambiguous identical names without a valid edit selection', () => {
    const duplicateText = '@同名笔记 @同名笔记', after = '@同名笔记';
    const first = occurrence(duplicateText, after, { ...note, id: 'a' }), second = occurrence(duplicateText, after, { ...note, id: 'b' }, first.end);
    expect(reconcileAiInlineReferences(duplicateText, after, [first, second])).toEqual([]);
    for (const hint of [{ start: -1, end: 5 }, { start: 0.5, end: 6 }, { start: 0, end: 50 }, { start: 0, end: 0, inputType: 'insertText' }]) {
      expect(reconcileAiInlineReferences(duplicateText, after, [first, second], hint)).toEqual([]);
    }
  });

  it('keeps bindings outside the ambiguous deletion envelope', () => {
    const before = '@符号词典，@同名笔记 @同名笔记；@节点定义。', after = '@符号词典，@同名笔记；@节点定义。';
    const first = occurrence(before, '@同名笔记', { ...note, id: 'a' }), second = occurrence(before, '@同名笔记', { ...note, id: 'b' }, first.end);
    const leading = occurrence(before, '@符号词典'), trailing = occurrence(before, '@节点定义', note);
    expect(reconcileAiInlineReferences(before, after, [leading, first, second, trailing])).toEqual([leading, { ...trailing, start: trailing.start - 6, end: trailing.end - 6 }]);
  });

  it('infers collapsed backward and forward word deletion ranges before validating the result', () => {
    const duplicateText = '@同名笔记 @同名笔记', after = '@同名笔记';
    const first = occurrence(duplicateText, after, { ...note, id: 'a' }), second = occurrence(duplicateText, after, { ...note, id: 'b' }, first.end);
    expect(reconcileAiInlineReferences(duplicateText, after, [first, second], { start: second.start, end: second.start, inputType: 'deleteWordBackward' })).toEqual([{ ...second, start: 0, end: after.length }]);
    expect(reconcileAiInlineReferences(duplicateText, after, [first, second], { start: first.end, end: first.end, inputType: 'deleteWordForward' })).toEqual([first]);
    expect(reconcileAiInlineReferences(duplicateText, after, [first, second], { start: 0, end: 0, inputType: 'deleteContentBackward' })).toEqual([]);
  });

  it('distinguishes repeated insertion before and after an existing occurrence', () => {
    const before = '@同名笔记', after = '@同名笔记 @同名笔记', ref = occurrence(before, before, note);
    expect(reconcileAiInlineReferences(before, after, [ref], { start: 0, end: 0, inputType: 'insertFromPaste' })).toEqual([{ ...ref, start: 6, end: 11 }]);
    expect(reconcileAiInlineReferences(before, after, [ref], { start: before.length, end: before.length, inputType: 'insertText' })).toEqual([ref]);
    expect(reconcileAiInlineReferences(before, after, [ref])).toEqual([]);
  });

  it('uses the actual boundary for insertion into a repeated character run', () => {
    const before = '@aaaa', after = '@aaaaa', ref = occurrence(before, before, note);
    expect(reconcileAiInlineReferences(before, after, [ref], { start: 5, end: 5, inputType: 'insertText' })).toEqual([ref]);
    expect(reconcileAiInlineReferences(before, after, [ref], { start: 2, end: 2, inputType: 'insertText' })).toEqual([]);
    expect(reconcileAiInlineReferences(before, after, [ref])).toEqual([]);
  });

  it('releases the exact replaced occurrence even when its visible text is unchanged', () => {
    const before = '@同名笔记 @同名笔记', first = occurrence(before, '@同名笔记', { ...note, id: 'a' }), second = occurrence(before, '@同名笔记', { ...note, id: 'b' }, first.end);
    expect(reconcileAiInlineReferences(before, before, [first, second], { start: 1, end: first.end, inputType: 'insertFromPaste' })).toEqual([second]);
    expect(reconcileAiInlineReferences(before, before, [first, second], { start: 2, end: 2, inputType: 'insertText' })).toEqual([first, second]);
  });

  it('falls back to the verified text difference when a native selection is stale', () => {
    const after = '现在请' + before;
    expect(reconcileAiInlineReferences(before, after, refs, { start: 10, end: 10, inputType: 'insertText' })).toEqual(refs.map(ref => ({ ...ref, start: ref.start + 3, end: ref.end + 3 })));
  });

  it('uses UTF-16 offsets when emoji are inserted before a reference', () => {
    const after = '🧭' + before;
    expect(reconcileAiInlineReferences(before, after, refs)).toEqual(refs.map(ref => ({ ...ref, start: ref.start + 2, end: ref.end + 2 })));
  });

  it('releases bindings inside a single replacement spanning multiple edits', () => {
    const after = before.replace('阅读', '先阅读').replace('。', '，请确认。');
    expect(reconcileAiInlineReferences(before, after, refs)).toEqual([]);
  });
});

describe('insert selected references into the sentence', () => {
  it('replaces the mention query without discarding the rest of the sentence', () => {
    const before = '阅读@符，然后修改这篇笔记。';
    const result = insertAiInlineReference(before, [], symbol, 2, 4);
    expect(result.text).toBe('阅读@符号词典，然后修改这篇笔记。');
    expect(result.references).toEqual([occurrence(result.text, '@符号词典')]);
    expect(result.caret).toBe(7);
  });

  it('adds one separator before existing ordinary text and places the caret after it', () => {
    const result = insertAiInlineReference('阅读现有正文', [], symbol, 2, 2);
    expect(result.text).toBe('阅读@符号词典 现有正文');
    expect(result.references[0].text).toBe('@符号词典'); expect(result.references[0].end).toBe(7); expect(result.caret).toBe(8);
    expect(insertAiInlineReference('阅读 existing', [], symbol, 2, 2).text).toBe('阅读@符号词典 existing');
  });

  it('shifts existing occurrences and supports repeating the same object', () => {
    const before = '先修改@节点定义。', old = occurrence(before, '@节点定义', note);
    const first = insertAiInlineReference(before, [old], note, 0, 0);
    expect(first.text).toBe('@节点定义 先修改@节点定义。');
    expect(first.references.map(ref => ref.reference.id)).toEqual(['fixture-note', 'fixture-note']);
    expect(first.references[1].start).toBe(old.start + first.caret);
    expect(restoreAiInlineReferences(first.references, first.text)).toEqual(first.references);
  });

  it('replaces a same-name target by its newly selected stable ID', () => {
    const before = '修改@节点定义。', old = occurrence(before, '@节点定义', note);
    const result = insertAiInlineReference(before, [old], { ...note, id: 'another-same-name-note' }, old.start, old.end);
    expect(result.text).toBe(before);
    expect(result.references).toEqual([{ ...old, reference: { kind: 'note', id: 'another-same-name-note' } }]);
    expect(old.reference.id).toBe('fixture-note');
  });

  it('removes overlapping old bindings and retains names containing spaces', () => {
    const before = '阅读@符号词典。', old = occurrence(before, '@符号词典');
    const result = insertAiInlineReference(before, [old], { kind: 'term', id: 'state-space', label: 'State space' }, old.start + 1, old.end);
    expect(result.references).toHaveLength(1); expect(result.references[0].text).toBe('@State space');
    expect(result.references[0].reference).toEqual({ kind: 'term', id: 'state-space' });
  });

  it('rejects prompt overflow instead of trimming the sentence or the name', () => {
    expect(() => insertAiInlineReference('x'.repeat(11999), [], { ...note, label: 'A' }, 11999, 11999)).toThrow(/12000/);
    expect(insertAiInlineReference('x'.repeat(11998), [], { ...note, label: 'A' }, 11998, 11998).text).toHaveLength(12000);
  });

  it('rejects occurrence and unique-object overflow after accounting for replaced bindings', () => {
    const full = repeated(24), unique = repeated(12, true);
    expect(() => insertAiInlineReference(full.text, full.refs, note, full.text.length, full.text.length)).toThrow(/24/);
    expect(() => insertAiInlineReference(unique.text, unique.refs, note, unique.text.length, unique.text.length)).toThrow(/12/);
    const first = unique.refs[0];
    expect(insertAiInlineReference(unique.text, unique.refs, note, first.start, first.end).references).toHaveLength(12);
  });

  it.each([[-1, 0], [0.5, 1], [2, 1], [0, 4], [Number.NaN, 1]])('rejects an invalid insertion range %s–%s', (start, end) => {
    expect(() => insertAiInlineReference('正文。', [], note, start, end)).toThrow(/位置/);
  });

  it('rejects invalid identities and blank display names', () => {
    expect(() => insertAiInlineReference('', [], { ...note, id: '' }, 0, 0)).toThrow(/引用/);
    expect(() => insertAiInlineReference('', [], { ...note, label: '  ' }, 0, 0)).toThrow(/引用/);
  });
});

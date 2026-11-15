import { restoreAiReferences, type AiObjectReference, type AiReferenceItem } from './references.ts';

/** UTF-16 offsets use the textarea's [start, end) convention; text never stands in for object identity. */
export interface AiInlineReference {
  start: number;
  end: number;
  text: string;
  reference: AiObjectReference;
}

/** The textarea selection captured before the browser applies its native input. */
export interface AiInlineReferenceEditRange {
  start: number;
  end: number;
  inputType?: string;
}

export const AI_INLINE_REFERENCES_MAX = 24;
export const AI_INLINE_REFERENCE_OBJECTS_MAX = 12;
export const AI_INLINE_REFERENCE_PROMPT_MAX = 12000;
const formatError = '句内引用格式无效，请重新选择对象。';
const identity = (reference: AiObjectReference) => JSON.stringify([reference.kind, reference.id]);
const uniqueObjects = (references: AiInlineReference[]) => new Set(references.map(item => identity(item.reference))).size;
const copy = (value: AiInlineReference): AiInlineReference => ({ start: value.start, end: value.end, text: value.text, reference: { kind: value.reference.kind, id: value.reference.id } });

/** A damaged occurrence invalidates the whole set; do not silently change a restored task's targets. */
export function restoreAiInlineReferences(value: unknown, text: string): AiInlineReference[] | undefined {
  if (!Array.isArray(value) || value.length > AI_INLINE_REFERENCES_MAX || typeof text !== 'string') return undefined;
  const restored: AiInlineReference[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const input = item as Record<string, unknown>;
    if (typeof input.start !== 'number' || !Number.isSafeInteger(input.start) || input.start < 0
      || typeof input.end !== 'number' || !Number.isSafeInteger(input.end) || input.end <= input.start || input.end > text.length
      || typeof input.text !== 'string' || !input.text.startsWith('@') || !input.text.slice(1).trim()
      || input.text !== text.slice(input.start, input.end)) return undefined;
    const reference = restoreAiReferences([input.reference]);
    if (!reference?.length) return undefined;
    restored.push({ start: input.start, end: input.end, text: input.text, reference: reference[0] });
  }
  restored.sort((a, b) => a.start - b.start);
  if (restored.some((item, index) => index > 0 && item.start < restored[index - 1].end) || uniqueObjects(restored) > AI_INLINE_REFERENCE_OBJECTS_MAX) return undefined;
  return restored;
}

function editRanges(references: AiInlineReference[], start: number, end: number, insertedLength: number): AiInlineReference[] {
  const delta = insertedLength - (end - start);
  return references.flatMap(reference => {
    if (reference.end <= start) return [copy(reference)];
    if (reference.start >= end) return [{ ...copy(reference), start: reference.start + delta, end: reference.end + delta }];
    return [];
  });
}

function verifiedNativeEdit(before: string, after: string, hint?: AiInlineReferenceEditRange): { start: number; end: number; insertedLength: number } | undefined {
  if (!hint || !Number.isSafeInteger(hint.start) || !Number.isSafeInteger(hint.end) || hint.start < 0 || hint.end < hint.start || hint.end > before.length) return undefined;
  let { start, end } = hint;
  const removedLength = before.length - after.length;
  if (start === end && removedLength > 0 && typeof hint.inputType === 'string') {
    if (/^delete.*Backward$/.test(hint.inputType)) start -= removedLength;
    else if (/^delete.*Forward$/.test(hint.inputType)) end += removedLength;
  }
  const insertedLength = after.length - before.length + end - start;
  if (start < 0 || end > before.length || insertedLength < 0 || start + insertedLength > after.length
    || before.slice(0, start) !== after.slice(0, start) || before.slice(end) !== after.slice(start + insertedLength)) return undefined;
  return { start, end, insertedLength };
}

/** Prefer verified native ranges; release ambiguous identities instead of guessing from repeated names. */
export function reconcileAiInlineReferences(before: string, after: string, refs: AiInlineReference[], hint?: AiInlineReferenceEditRange): AiInlineReference[] {
  const restored = restoreAiInlineReferences(refs, before);
  if (!restored) throw new Error(formatError);
  const nativeEdit = verifiedNativeEdit(before, after, hint);
  if (nativeEdit && (nativeEdit.start !== nativeEdit.end || nativeEdit.insertedLength > 0)) return editRanges(restored, nativeEdit.start, nativeEdit.end, nativeEdit.insertedLength);
  if (before === after) return restored;
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length && suffix < after.length && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  // Overlapping unchanged prefixes/suffixes expose equally valid edit positions in repeated text.
  const overlap = Math.max(0, prefix + suffix - Math.min(before.length, after.length));
  const start = prefix - overlap, end = before.length - suffix + overlap;
  return editRanges(restored, start, end, after.length - before.length + end - start);
}

/** Selecting an object is explicit, even when its label matches the text or identity it replaces. */
export function insertAiInlineReference(text: string, refs: AiInlineReference[], reference: AiReferenceItem, start: number, end: number): { text: string; references: AiInlineReference[]; caret: number } {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length) throw new Error('句内引用位置无效，请重新选择插入位置。');
  const restored = restoreAiInlineReferences(refs, text), target = restoreAiReferences([reference]);
  if (!restored || !target?.length || typeof reference.label !== 'string' || !reference.label.trim()) throw new Error(formatError);
  const token = `@${reference.label.trim()}`;
  const separator = /^[\p{Letter}\p{Number}_]/u.test(text.slice(end)) ? ' ' : '';
  const inserted = token + separator, nextText = text.slice(0, start) + inserted + text.slice(end);
  if (nextText.length > AI_INLINE_REFERENCE_PROMPT_MAX) throw new Error('任务要求最多 12000 字符，请缩短后发送。');
  const references = [...editRanges(restored, start, end, inserted.length), { start, end: start + token.length, text: token, reference: target[0] }].sort((a, b) => a.start - b.start);
  if (references.length > AI_INLINE_REFERENCES_MAX) throw new Error('一次最多添加 24 处句内引用。');
  if (uniqueObjects(references) > AI_INLINE_REFERENCE_OBJECTS_MAX) throw new Error('一次最多引用 12 个对象。');
  return { text: nextText, references, caret: start + inserted.length };
}

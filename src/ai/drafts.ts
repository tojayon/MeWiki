import { createNoteProposal, createTermProposal, type AiProposal } from './proposals.ts';
import type { AiToolContext } from './tools.ts';
import { createNativeProposal } from './nativeProposals.ts';
import { assertNativeEditAccess } from './nativeTools.ts';
import { aiSelectionRanges, assertAiSelectionEdit } from './textSelection.ts';
import { completeAiSelectedDraft } from './selectionRanges.ts';
import { findResearchBlock } from '../domain/researchBlockTree.ts';

interface StringObject { values: Record<string, string>; closed: Set<string>; fields?: StringObject }

/** Only a top-level object of strings is accepted; an unfinished final string is display-only. */
function partialStrings(source: string, nativeFields = false): StringObject | null {
  if (source.length > 45000) return null;
  let at = 0;
  const values: Record<string, string> = Object.create(null);
  const closed = new Set<string>(), keys = new Set<string>();
  const result: StringObject = { values, closed };
  const skip = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  const string = (): { text: string; closed: boolean } | null => {
    if (source[at++] !== '"') return null;
    let text = '';
    while (at < source.length) {
      const character = source[at++];
      if (character === '"') return { text, closed: true };
      if (character.charCodeAt(0) < 32) return null;
      if (character !== '\\') { text += character; continue; }
      if (at === source.length) break;
      const escaped = source[at++];
      if (escaped === 'u') {
        const hex = source.slice(at, at + 4);
        if (!/^[\da-f]*$/i.test(hex)) return null;
        if (hex.length < 4) break;
        text += String.fromCharCode(parseInt(hex, 16)); at += 4;
      } else {
        const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!(escaped in escapes)) return null;
        text += escapes[escaped];
      }
    }
    return { text: text.replace(/[\uD800-\uDBFF]$/, ''), closed: false };
  };
  skip(); if (source[at++] !== '{') return null;
  skip();
  if (source[at] === '}') { at++; skip(); return at === source.length ? result : null; }
  while (at < source.length) {
    const key = string();
    if (!key) return null;
    if (!key.closed) return result;
    if (keys.has(key.text) || keys.size >= 12) return null;
    keys.add(key.text); skip();
    if (at === source.length) return result;
    if (source[at++] !== ':') return null;
    skip(); if (at === source.length) return result;
    if (nativeFields && key.text === 'fields' && source[at] === '{') {
      const start = at;
      let depth = 0, quoted = false, escaped = false, complete = false;
      for (; at < source.length; at++) {
        const character = source[at];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) { at++; complete = true; break; }
      }
      const fields = partialStrings(source.slice(start, at));
      if (!fields) return null;
      result.fields = fields;
      if (!complete) return result;
    } else {
      const value = string(); if (!value) return null;
      values[key.text] = value.text;
      if (!value.closed) return result;
    }
    closed.add(key.text); skip();
    if (at === source.length) return result;
    if (source[at] === '}') { at++; skip(); return at === source.length ? result : null; }
    if (source[at++] !== ',') return null;
    skip();
    if (source[at] === '}') return null;
  }
  return result;
}

/** This projection never calls executeAiTool or changes any source/read/proposal state. */
export function createAiDraft(context: AiToolContext, call: { name: string; arguments: string }, id: string): AiProposal | null {
  if (!['propose_note', 'propose_term', 'propose_edit'].includes(call.name) || context.proposals.length >= 20) return null;
  const parsed = partialStrings(call.arguments, call.name === 'propose_edit');
  if (!parsed) return null;
  const { values, closed } = parsed;
  try {
    // A partial JSON string has not generated its protected suffix yet. Keep that
    // suffix visible, and switch to strict validation as soon as the string closes.
    if (context.selection && context.selection.kind !== 'block' && values.blockId) {
      const note = context.state.notes.find(note => note.id === context.selection!.noteId);
      const block = note && findResearchBlock(note.blocks, values.blockId)?.block;
      const range = aiSelectionRanges(context.state, context.selection, values.blockId).find(range => range.field === 'text');
      if (block && 'text' in block && typeof block.text === 'string' && range) {
        if (call.name === 'propose_note' && 'content' in values && !closed.has('content')) values.content = completeAiSelectedDraft(block.text, values.content, range);
        if (call.name === 'propose_edit' && parsed.fields && 'text' in parsed.fields.values && !parsed.fields.closed.has('text')) {
          parsed.fields.values.text = completeAiSelectedDraft(block.text, parsed.fields.values.text, range);
        }
      }
    }
    assertAiSelectionEdit(context.state, context.selection, call.name, { ...values, fields: parsed.fields?.values });
    if (call.name === 'propose_edit') {
      if (!['block-update', 'note-update', 'symbol-save', 'term-save'].includes(values.action) || !parsed.fields ||
        Object.keys(values).some(key => !['action', 'noteId', 'blockId', 'entryId'].includes(key) || !closed.has(key))) return null;
      if (values.action.startsWith('block-') && (!closed.has('noteId') || !closed.has('blockId'))) return null;
      if (values.action === 'note-update' && !closed.has('noteId')) return null;
      if (['symbol-save', 'term-save'].includes(values.action) && !closed.has('entryId')) return null;
      const args = { ...values, fields: parsed.fields.values };
      assertNativeEditAccess(context, args);
      return { ...createNativeProposal(context.state, context.libraryId, args), id };
    }
    if (call.name === 'propose_note') {
      if (Object.keys(values).some(key => !['operation', 'noteId', 'blockId', 'title', 'content'].includes(key)) || !closed.has('operation')) return null;
      if (values.operation === 'create') { if (!closed.has('title')) return null; }
      else {
        if (!closed.has('noteId') || !context.noteIds.has(values.noteId) || !context.readNoteIds.has(values.noteId)) return null;
        if (['replace-text', 'delete-text'].includes(values.operation) && !closed.has('blockId')) return null;
      }
      const proposal = createNoteProposal(context.state, context.libraryId, {
        operation: values.operation, noteId: values.noteId, blockId: values.blockId, title: values.title, content: values.content,
      });
      return { ...proposal, id, ...(proposal.kind === 'create' ? { targetId: `${id}:note` } : {}) };
    }
    if (Object.keys(values).some(key => !['termId', 'name', 'meaning', 'englishName'].includes(key)) || !closed.has('name') ||
      ('termId' in values && !closed.has('termId'))) return null;
    const proposal = createTermProposal(context.state, context.libraryId, {
      termId: values.termId, name: values.name, meaning: values.meaning,
      ...(closed.has('englishName') ? { englishName: values.englishName } : {}),
    });
    if (proposal.kind !== 'term') return null;
    return { ...proposal, id, ...(!proposal.before ? { targetId: `${id}:term`, term: { ...proposal.term, id: `${id}:term` } } : {}) };
  } catch { return null; }
}

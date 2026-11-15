import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { aiCurrentReference, aiReferenceContext, aiReferenceError, restoreAiReferences, type AiObjectReference } from './references.ts';
import { restoreAiGuidanceSnapshot, type AiGuidanceSnapshot } from './skills.ts';
import { isMeWikiManualNote } from '../domain/meWikiManual.ts';

/** Frozen at send time. Retrying must never substitute newly edited library rules. */
export type AiReadingScope = 'references' | 'library';
export interface AiTaskSupport {
  references: AiObjectReference[];
  guidance: AiGuidanceSnapshot;
  scope?: AiReadingScope;
}
export function aiTaskNoteIds(state: ResearchNotebookState, scope: 'current' | 'library'): string[] {
  if (scope === 'library') return state.notes.filter(note => !isMeWikiManualNote(note)).map(note => note.id);
  const current = aiCurrentReference(state);
  return current?.kind === 'note' ? [current.id] : [];
}
export function restoreAiSkillIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 6 || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 1000)) return undefined;
  return [...new Set(value as string[])];
}
export function restoreAiTaskSupport(value: unknown): AiTaskSupport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const references = restoreAiReferences(input.references), guidance = restoreAiGuidanceSnapshot(input.guidance);
  if (input.scope !== undefined && input.scope !== 'references' && input.scope !== 'library') return undefined;
  return references && guidance ? { references, guidance, ...(input.scope ? { scope: input.scope as AiReadingScope } : {}) } : undefined;
}
export function hasAiTaskSupport(value?: AiTaskSupport): boolean {
  return !!value && !!(value.scope || value.references.length || value.guidance.instructions || value.guidance.skills.length);
}
export function freezeAiTaskSupport(state: ResearchNotebookState, value?: AiTaskSupport): AiTaskSupport | undefined {
  if (value === undefined) return undefined;
  const restored = restoreAiTaskSupport(value);
  if (!restored) throw new Error('本次引用或技能规则无效，请检查后重新发送。');
  const reason = aiReferenceError(state, restored.references);
  if (reason) throw new Error(reason);
  return hasAiTaskSupport(restored) ? structuredClone(restored) : undefined;
}
export function aiTaskSupportPrompt(state: ResearchNotebookState, value?: AiTaskSupport): string {
  if (!hasAiTaskSupport(value)) return '';
  return '以下为用户本次明确附加的对象标识、资料库规范和启用技能。对象仅用于定位，不代表已读取原文，也不增加读取或修改权限；模块引用不授权整库。readingScope 为 library 时用户明确开启了整库检索，否则仅使用本次引用的笔记；实际授权仍以工具范围为准。技能仅为文字工作流程，不执行脚本、不跟随电脑路径、不增加工具能力。所有修改仍须用户审阅。遵循本次明确要求，其次本对话固定要求、启用技能、资料库规范；冲突时简要说明。引用对象已固定，不得用同名对象替代。\n' + JSON.stringify({ references: aiReferenceContext(state, value!.references), ...(value!.scope ? { readingScope: value!.scope } : {}), libraryInstructions: value!.guidance.instructions, skills: value!.guidance.skills });
}

import type { AiToolContext } from './tools.ts';
import { findResearchBlock } from '../domain/researchBlockTree.ts';

export type AiExecutionPhase = 'thinking' | 'tool' | 'responding' | 'review' | 'complete' | 'partial';
export interface AiExecutionStep {
  tool: string; status: 'running' | 'complete' | 'reused' | 'error' | 'interrupted';
  noteId?: string; blockId?: string; title?: string; detail?: string;
}
export interface AiRunMetrics { modelCalls: number; toolCalls: number; reusedCalls: number; repeatedCalls: number; failedCalls: number; durationMs: number }
const text = (value: unknown, length: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= length;
export function aiExecutionTarget(context: AiToolContext, args: unknown): Pick<AiExecutionStep, 'noteId' | 'blockId' | 'title'> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const fields = args as Record<string, unknown>;
  const note = context.state.notes.find(note => note.id === fields.noteId && context.noteIds.has(note.id));
  if (!note) return {};
  const blockId = typeof fields.blockId === 'string' && findResearchBlock(note.blocks, fields.blockId) ? fields.blockId : undefined;
  return { noteId: note.id, title: note.title.slice(0, 200), ...(blockId ? { blockId } : {}) };
}
export function restoreAiExecutionSteps(value: unknown): AiExecutionStep[] | undefined {
  if (!Array.isArray(value) || value.length > 40) return;
  const steps: AiExecutionStep[] = [];
  for (const step of value) {
    if (!step || typeof step !== 'object' || !text(step.tool, 128) || !/^[a-zA-Z0-9_-]+$/.test(step.tool) || !['running', 'complete', 'reused', 'error', 'interrupted'].includes(step.status)) continue;
    steps.push({ tool: step.tool, status: step.status === 'running' ? 'interrupted' : step.status,
      ...(text(step.noteId, 1000) ? { noteId: step.noteId, ...(text(step.blockId, 1000) ? { blockId: step.blockId } : {}), ...(text(step.title, 200) ? { title: step.title } : {}) } : {}),
      ...(text(step.detail, 500) ? { detail: step.detail } : {}) });
  }
  return steps;
}
export function restoreAiRunMetrics(value: unknown): AiRunMetrics | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as AiRunMetrics;
  const repeatedCalls = item.repeatedCalls ?? 0;
  if (![item.modelCalls, item.toolCalls, item.reusedCalls, repeatedCalls, item.failedCalls, item.durationMs].every(number => Number.isFinite(number) && number >= 0) || item.modelCalls > 33 || item.toolCalls > 40 || item.reusedCalls + item.failedCalls > item.toolCalls || repeatedCalls > item.toolCalls) return;
  return { modelCalls: item.modelCalls, toolCalls: item.toolCalls, reusedCalls: item.reusedCalls, repeatedCalls, failedCalls: item.failedCalls, durationMs: item.durationMs };
}

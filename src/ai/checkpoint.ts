export interface AiTaskCheckpoint {
  version: 1; libraryId: string; requestId: string; scopeKey: string;
  reads: { name: string; arguments: Record<string, unknown> }[];
  proposalIds: string[]; summary: string;
}
export const checkpointReadTools = new Set(['read_note', 'read_block', 'read_dictionary_entry', 'read_theory_maps', 'read_material']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

/** Optional recovery data is bounded and cannot grant new scope or execute edits. */
export function restoreAiTaskCheckpoint(value: unknown, libraryId: string, request?: { messageId: string; scopeKey: string }, proposalIds?: string[]): AiTaskCheckpoint | undefined {
  if (!record(value) || value.version !== 1 || value.libraryId !== libraryId || !text(value.requestId, 100) || !value.requestId ||
    !text(value.scopeKey, 64) || !/^[a-f0-9]{64}$/.test(value.scopeKey) || !text(value.summary, 6000) ||
    !Array.isArray(value.reads) || value.reads.length > 80 || !Array.isArray(value.proposalIds) || value.proposalIds.length > 40 ||
    value.proposalIds.some(id => !text(id, 1000)) || new Set(value.proposalIds).size !== value.proposalIds.length ||
    request && (value.requestId !== request.messageId || value.scopeKey !== request.scopeKey)) return;
  if (JSON.stringify(value).length > 40000 || proposalIds && value.proposalIds.some(id => !proposalIds.includes(id))) return;
  if (value.reads.some(call => !record(call) || !text(call.name, 100) || !checkpointReadTools.has(call.name) || !record(call.arguments) ||
    JSON.stringify(call.arguments).length > 4000 || Object.values(call.arguments).some(item => typeof item !== 'string' && typeof item !== 'number'))) return;
  return structuredClone({ version: 1, libraryId, requestId: value.requestId, scopeKey: value.scopeKey, reads: value.reads, proposalIds: value.proposalIds, summary: value.summary }) as AiTaskCheckpoint;
}

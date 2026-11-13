export type PublicationDiagnosticCode = 'horizontal-overflow' | 'vertical-overflow' | 'page-overflow';
export interface PublicationContentDiagnostic { blockId: string; code: PublicationDiagnosticCode }

/** Diagnostics cross a browser/service boundary. Accept only this request's static items. */
export function readPublicationDiagnostics(value: unknown, blockIds: ReadonlySet<string>): PublicationContentDiagnostic[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 3000).flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.blockId !== 'string' || !blockIds.has(item.blockId) || !['horizontal-overflow', 'vertical-overflow', 'page-overflow'].includes(item.code)) return [];
    const key = JSON.stringify([item.blockId, item.code]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ blockId: item.blockId, code: item.code as PublicationDiagnosticCode }];
  });
}

export class PublicationContentError extends Error {
  readonly diagnostics: PublicationContentDiagnostic[];
  constructor(message: string, diagnostics: PublicationContentDiagnostic[]) {
    super(message); this.name = 'PublicationContentError'; this.diagnostics = diagnostics;
  }
}

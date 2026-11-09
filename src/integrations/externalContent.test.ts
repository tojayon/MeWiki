import { describe, expect, it } from 'vitest';
import { normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown } from '../domain/researchNotebook.ts';
import { createMeWikiNotebook } from '../domain/meWikiWorkspace.ts';
import { createResearchLibraryFile, parseResearchLibraryFile } from '../state/researchLibraryFile.ts';

const block = { id: 'external-1', type: 'external' as const, provider: 'org.example.results', contentType: 'measurement', schemaVersion: 1,
  title: '真实实验记录', summary: 't = 12.5 s', data: { runId: 'run-1', time: 12.5, values: [1, 2, 3] }, note: '观察备注' };
function fixture() { const state = createMeWikiNotebook(); state.notes[0].blocks = [block as never]; return state; }

describe('portable external content', () => {
  it('retains unknown providers and their JSON payload without an installed plugin', () => {
    expect(normalizeResearchNotebook(fixture()).notes[0].blocks).toEqual([block]);
  });
  it('round trips external content through the verified library archive', async () => {
    const file = await createResearchLibraryFile(fixture());
    expect((await parseResearchLibraryFile(JSON.stringify(file))).notebook.notes[0].blocks).toEqual([block]);
  });
  it('round trips external cards through Markdown with readable fallback text', () => {
    const state = fixture();
    const markdown = serializeResearchMarkdown(state.notes[0]);
    expect(markdown).toContain('真实实验记录');
    expect(markdown).toContain('观察备注');
    expect(parseResearchMarkdown(markdown).blocks).toEqual([block]);
  });
  it('keeps malformed external payload readable instead of silently dropping it', () => {
    const state = fixture(); (state.notes[0].blocks[0] as unknown as Record<string, unknown>).schemaVersion = -1;
    const restored = normalizeResearchNotebook(state).notes[0].blocks;
    expect(restored).toHaveLength(1);
    expect(restored[0].type).toBe('paragraph');
  });
});

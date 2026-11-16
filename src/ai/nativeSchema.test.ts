import { afterEach, expect, it, vi } from 'vitest';
import { aiBlockFields, aiMapFields, aiNativeEditSchema, aiNoteFields, aiObject, aiRelationFields, aiSymbolFields, aiTermFields, validateAiFields } from './nativeSchema.ts';
import { aiTools, createAiToolContext, executeAiTool } from './tools.ts';
import { createResearchNotebook } from '../domain/researchNotebook.ts';

afterEach(() => vi.unstubAllGlobals());

it('validates a fresh tool call with dynamic JavaScript evaluation disabled', () => {
  vi.stubGlobal('Function', function () { throw new Error('CSP blocks dynamic evaluation'); });
  const state = createResearchNotebook();
  const context = createAiToolContext(state, 'csp-library', []);
  expect(() => executeAiTool(context, 'get_capabilities', {})).not.toThrow();
  expect(() => executeAiTool(context, 'get_capabilities', { unexpected: true })).toThrow('AI 操作字段无效');
  expect(() => validateAiFields({ text: '有效字段', level: 2 }, aiBlockFields.heading)).not.toThrow();
});

it('retains nested limits, Unicode lengths and strict object boundaries under CSP', () => {
  const fields = { list: { type: 'array', minItems: 1, maxItems: 2, items: aiObject({ text: { type: 'string', minLength: 1, maxLength: 2 }, level: { type: 'integer', minimum: 1, maximum: 6 } }, ['text']) } };
  expect(() => validateAiFields({ list: [{ text: '😀😀', level: 2 }] }, fields, ['list'])).not.toThrow();
  for (const value of [{}, { list: [] }, { list: [{ text: '😀😀😀' }] }, { list: [{ text: '', level: 2 }] }, { list: [{ text: '好', level: 1.5 }] }, { list: [{ text: '好', level: 7 }] }, { list: [{ text: '好', extra: true }] }, { list: [null] }]) {
    expect(() => validateAiFields(value, fields, ['list'])).toThrow('AI 操作字段无效');
  }
});

it('preserves the established AI schema acceptance rules against Ajv', async () => {
  const { default: Ajv } = await import('ajv');
  const ajv = new Ajv({ allErrors: false, strict: false });
  const schemas = [aiNativeEditSchema, ...Object.values(aiBlockFields).map(fields => aiObject(fields)), ...[aiMapFields, aiNoteFields, aiRelationFields, aiSymbolFields, aiTermFields].map(fields => aiObject(fields)), ...aiTools.map(tool => tool.parameters)] as ReturnType<typeof aiObject>[];
  const samples: unknown[] = [null, false, 0, '', [], {}, { action: 'note-update', noteId: 'a', fields: { title: '测试' } }, { text: '文本' }, { text: '文本', level: 2 }, { text: '文本', level: 7 }, { unknown: true }, { source: { type: 'asset', assetId: 'abc' } }, { source: { type: 'url', url: 'https://example.invalid', extra: true } }, { appearance: { borderColor: '#f0A', borderWidth: 0.5 } }, { appearance: { borderColor: 'red' } }, { frontmatter: { custom: ['保留'] } }, { view: { layout: { positions: { one: { x: 1, y: 2 } } } } }, { rows: [['文字', '😀']] }, { rows: [[1]] }, { slots: [{ key: 'x1', defaultValue: '' }] }];
  for (const schema of schemas) {
    const reference = ajv.compile(schema);
    for (const sample of samples) {
      let accepted = true;
      try { validateAiFields(sample, schema.properties, schema.required); } catch { accepted = false; }
      expect(accepted, JSON.stringify({ schema, sample })).toBe(reference(sample));
    }
  }
});

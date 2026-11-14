import { sha256 } from '@noble/hashes/sha2.js';

export type AiMaterialKind = 'txt' | 'md' | 'text' | 'pdf' | 'docx' | 'csv' | 'tsv' | 'xlsx';
export interface AiMaterialSection { label: string; text: string }
export interface AiMaterial { id: string; libraryId: string; name: string; kind: AiMaterialKind; size: number; sections: AiMaterialSection[] }
const fileKinds = new Map<string, AiMaterialKind>([
  ['txt', 'txt'], ['md', 'md'], ['markdown', 'md'], ['pdf', 'pdf'], ['docx', 'docx'], ['csv', 'csv'], ['tsv', 'tsv'], ['xlsx', 'xlsx'],
  ...[
    'text', 'mdx', 'rst', 'adoc', 'org',
    'json', 'jsonc', 'jsonl', 'ndjson', 'geojson', 'ipynb',
    'tex', 'latex', 'ltx', 'bib', 'sty', 'cls', 'bst', 'typ',
    'yaml', 'yml', 'toml', 'xml', 'xsd', 'xsl', 'xslt', 'svg', 'ini', 'cfg', 'conf', 'config', 'properties', 'env', 'log',
    'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyi', 'r', 'rmd', 'jl', 'lua', 'rb', 'go', 'rs',
    'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'swift', 'kt', 'kts', 'sql', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
    'mmd', 'mermaid', 'dot', 'srt', 'vtt',
  ].map(extension => [extension, 'text'] as const),
]);
export const AI_MATERIAL_ACCEPT = [...fileKinds.keys()].map(extension => `.${extension}`).join(',');
export function aiMaterialKindForName(name: string): AiMaterialKind | undefined {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? undefined : fileKinds.get(name.slice(dot + 1).toLowerCase());
}
export const AI_MATERIAL_MAX_BYTES = 20_000_000;
export const AI_MATERIAL_MAX_TEXT = 100000;
export const AI_MATERIAL_TOTAL_TEXT = 200000;
export const AI_MATERIAL_MAX_ACTIVE = 6;
export const AI_MATERIAL_MAX_SAVED = 12;
const kinds: AiMaterialKind[] = ['txt', 'md', 'text', 'pdf', 'docx', 'csv', 'tsv', 'xlsx'];
export const aiMaterialCharacters = (material: AiMaterial) => material.sections.reduce((total, section) => total + section.text.length, 0);
const digest = (value: unknown) => [...sha256(new TextEncoder().encode(JSON.stringify(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export function createAiMaterial(libraryId: string, name: string, kind: AiMaterialKind, size: number, sections: AiMaterialSection[]): AiMaterial {
  if (typeof libraryId !== 'string' || !libraryId.trim() || typeof name !== 'string' || !name.trim() || name.length > 300 || /[/\\]/.test(name) || [...name].some(character => character.charCodeAt(0) < 32) || !kinds.includes(kind) || !Number.isSafeInteger(size) || size < 1 || size > AI_MATERIAL_MAX_BYTES ||
    !Array.isArray(sections) || !sections.length || sections.length > 400 || sections.some(section => !section || typeof section.label !== 'string' || section.label.length > 300 || typeof section.text !== 'string' || section.text.includes('\0'))) throw new Error('辅助材料格式无效，请重新添加文件。');
  if (!sections.some(section => section.text.trim())) throw new Error('文件没有可读取文字；扫描件请先识别文字。');
  if (sections.reduce((total, section) => total + section.text.length, 0) > AI_MATERIAL_MAX_TEXT) throw new Error('辅助材料文字超过 100000 字符，请拆分后添加。');
  const value = { libraryId, name, kind, size, sections: sections.map(section => ({ label: section.label, text: section.text })) };
  return { id: digest(value), ...value };
}
export function addAiMaterial(materials: AiMaterial[], material: AiMaterial): AiMaterial[] {
  if (materials.some(item => item.id === material.id)) return materials;
  if (materials.length >= AI_MATERIAL_MAX_SAVED) throw new Error('每段对话最多保留 12 份辅助材料，请新建对话后继续。');
  if (materials.some(item => item.libraryId !== material.libraryId)) throw new Error('辅助材料不属于当前资料库。');
  if ([...materials, material].reduce((sum, item) => sum + aiMaterialCharacters(item), 0) > AI_MATERIAL_TOTAL_TEXT) throw new Error('本对话辅助材料合计超过 200000 字符，请新建对话或缩小材料。');
  return [...materials, material];
}
export function restoreAiMaterials(value: unknown, libraryId: string): AiMaterial[] {
  if (!Array.isArray(value) || value.length > AI_MATERIAL_MAX_SAVED) return [];
  let restored: AiMaterial[] = [];
  for (const entry of value) {
    try {
      if (!entry || entry.libraryId !== libraryId || !Array.isArray(entry.sections)) continue;
      const material = createAiMaterial(libraryId, entry.name, entry.kind, entry.size, entry.sections);
      if (material.id !== entry.id) continue;
      restored = addAiMaterial(restored, material);
    } catch { /* Keep valid chat; unresolved IDs remain visible and block reuse. */ }
  }
  return restored;
}
export function restoreAiMaterialIds(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length <= AI_MATERIAL_MAX_ACTIVE && value.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) ? [...new Set(value)] : undefined;
}
export function selectAiMaterials(materials: AiMaterial[], ids: string[]): AiMaterial[] {
  if (ids.length > AI_MATERIAL_MAX_ACTIVE) throw new Error('一次最多使用 6 份辅助材料。');
  return [...new Set(ids)].map(id => {
    const source = materials.find(item => item.id === id);
    if (!source) throw new Error('辅助材料不可用，请重新添加文件或移除后发送。');
    return source;
  });
}
export const aiMaterialContext = (materials: AiMaterial[]) => materials.map(({ id, name }) => [id, name]).sort((a, b) => a[0].localeCompare(b[0]));

import { parseDocument, stringify } from 'yaml';

export interface AiSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  keywords: string[];
  modules: string[];
  enabled: boolean;
  defaultEnabled: boolean;
}
export interface AiLibraryGuidance { version: 1; libraryId: string; instructions: string; skills: AiSkill[] }
export interface AiGuidanceSnapshot { instructions: string; skills: Pick<AiSkill, 'id' | 'name' | 'description' | 'instructions'>[] }

export const AI_LIBRARY_INSTRUCTIONS_MAX = 4000;
export const AI_SKILL_INSTRUCTIONS_MAX = 12000;
export const AI_SKILLS_MAX_SAVED = 40;
export const AI_SKILLS_MAX_ACTIVE = 6;
export const AI_SKILLS_ACTIVE_TEXT_MAX = 24000;
export const AI_SKILLS_TOTAL_TEXT_MAX = 160000;
export const AI_SKILL_MARKDOWN_MAX = 20000;
export const AI_SKILL_MODULES = ['symbols', 'terms', 'foundations', 'notes', 'maps', 'library', 'manual'] as const;
const maxStoredSize = 256000;
const readError = '资料库规范未能读取，请保持窗口打开，勿覆盖原配置。';
const formatError = '资料库规范格式无效，请检查后重试。';
const storageKey = (libraryId: string) => `mewiki:library:${encodeURIComponent(libraryId)}:ai-guidance:v1`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, limit: number, required = false): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0') && (!required || !!value.trim());
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id);

function assertLibraryId(libraryId: unknown): asserts libraryId is string {
  if (!boundedText(libraryId, 300, true) || [...libraryId].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error(formatError);
}
function list(value: unknown, limit: number, textLimit: number): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some(item => !boundedText(item, textLimit, true))) throw new Error(formatError);
  return [...new Set(value as string[])];
}
function readSkillText(value: unknown): AiGuidanceSnapshot['skills'][number] {
  if (!record(value) || !validId(value.id) || !boundedText(value.name, 100, true) || !boundedText(value.description, 600, true) || !boundedText(value.instructions, Infinity, true)) throw new Error(formatError);
  if (value.instructions.length > AI_SKILL_INSTRUCTIONS_MAX) throw new Error('每个技能的说明正文最多 12000 字符。');
  return { id: value.id, name: value.name, description: value.description, instructions: value.instructions };
}
function readSkill(value: unknown): AiSkill {
  const text = readSkillText(value);
  if (!record(value) || typeof value.enabled !== 'boolean' || typeof value.defaultEnabled !== 'boolean') throw new Error(formatError);
  const modules = list(value.modules, AI_SKILL_MODULES.length, 40);
  if (modules.some(module => !AI_SKILL_MODULES.some(id => id === module))) throw new Error(formatError);
  return { ...text, keywords: list(value.keywords, 12, 80), modules, enabled: value.enabled, defaultEnabled: value.defaultEnabled };
}
function assertActiveLimit(skills: AiGuidanceSnapshot['skills']) {
  if (skills.length > AI_SKILLS_MAX_ACTIVE) throw new Error('一次最多启用 6 个技能，请减少默认或本次技能。');
  if (skills.reduce((sum, skill) => sum + skill.instructions.length, 0) > AI_SKILLS_ACTIVE_TEXT_MAX) throw new Error('本次启用的技能正文合计超过 24000 字符，请缩短或减少技能。');
}
function validateGuidance(value: unknown, libraryId?: string): AiLibraryGuidance {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.skills) || !boundedText(value.instructions, Infinity)) throw new Error(formatError);
  assertLibraryId(value.libraryId);
  if (libraryId !== undefined && value.libraryId !== libraryId) throw new Error(formatError);
  if (value.instructions.length > AI_LIBRARY_INSTRUCTIONS_MAX) throw new Error('资料库默认规范最多 4000 字符。');
  if (value.skills.length > AI_SKILLS_MAX_SAVED) throw new Error('每个资料库最多保存 40 个技能。');
  const skills = value.skills.map(readSkill);
  if (new Set(skills.map(skill => skill.id)).size !== skills.length) throw new Error(formatError);
  if (skills.reduce((sum, skill) => sum + skill.instructions.length, 0) > AI_SKILLS_TOTAL_TEXT_MAX) throw new Error('资料库技能正文合计超过 160000 字符，请精简后保存。');
  assertActiveLimit(skills.filter(skill => skill.enabled && skill.defaultEnabled));
  const result: AiLibraryGuidance = { version: 1, libraryId: value.libraryId, instructions: value.instructions, skills };
  if (JSON.stringify(result).length > maxStoredSize) throw new Error('资料库规范配置过大，请精简后保存。');
  return result;
}

export function createAiLibraryGuidance(libraryId: string): AiLibraryGuidance {
  assertLibraryId(libraryId);
  return { version: 1, libraryId, instructions: '', skills: [] };
}
export function readAiLibraryGuidance(libraryId: string, storage: Pick<Storage, 'getItem'>): AiLibraryGuidance {
  assertLibraryId(libraryId);
  try {
    const text = storage.getItem(storageKey(libraryId));
    if (text === null) return createAiLibraryGuidance(libraryId);
    if (text.length > maxStoredSize) throw new Error(readError);
    return validateGuidance(JSON.parse(text), libraryId);
  } catch { throw new Error(readError); }
}
export function writeAiLibraryGuidance(value: AiLibraryGuidance, storage: Pick<Storage, 'setItem'>): void {
  const verified = validateGuidance(value);
  try { storage.setItem(storageKey(verified.libraryId), JSON.stringify(verified)); }
  catch { throw new Error('资料库规范未能保存，请保持窗口打开并重试。'); }
}
/** Defaults are always active; explicit IDs add skills for this task without changing saved configuration. */
export function resolveAiGuidance(value: AiLibraryGuidance, selectedIds: string[] = []): AiGuidanceSnapshot {
  const verified = validateGuidance(value);
  if (!Array.isArray(selectedIds) || selectedIds.some(id => !validId(id))) throw new Error(formatError);
  const selected = new Set(selectedIds);
  for (const id of selected) {
    const skill = verified.skills.find(item => item.id === id);
    if (!skill) throw new Error('所选技能已不可用，请重新选择或移除后发送。');
    if (!skill.enabled) throw new Error('所选技能已停用，请先启用或移除后发送。');
  }
  const skills = verified.skills.filter(skill => skill.enabled && (skill.defaultEnabled || selected.has(skill.id))).map(({ id, name, description, instructions }) => ({ id, name, description, instructions }));
  assertActiveLimit(skills);
  return { instructions: verified.instructions, skills };
}
/** Recover only the bounded task payload; imported scripts, paths and config flags never become executable state. */
export function restoreAiGuidanceSnapshot(value: unknown): AiGuidanceSnapshot | undefined {
  try {
    if (!record(value) || !boundedText(value.instructions, AI_LIBRARY_INSTRUCTIONS_MAX) || !Array.isArray(value.skills) || value.skills.length > AI_SKILLS_MAX_ACTIVE) return undefined;
    const skills = value.skills.map(readSkillText);
    if (new Set(skills.map(skill => skill.id)).size !== skills.length) return undefined;
    assertActiveLimit(skills);
    return { instructions: value.instructions, skills };
  } catch { return undefined; }
}
export function suggestAiSkills(value: AiLibraryGuidance, prompt: string, moduleId?: string): AiSkill[] {
  const normalized = prompt.normalize('NFKC').toLocaleLowerCase();
  return value.skills.filter(skill => skill.enabled && !skill.defaultEnabled).map((skill, index) => ({ skill, index,
    score: (moduleId && skill.modules.includes(moduleId) ? 2 : 0) + skill.keywords.filter(keyword => normalized.includes(keyword.normalize('NFKC').toLocaleLowerCase())).length,
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, AI_SKILLS_MAX_ACTIVE).map(({ skill }) => ({ ...skill, keywords: [...skill.keywords], modules: [...skill.modules] }));
}
export function importAiSkillMarkdown(text: string): AiSkill {
  if (typeof text !== 'string' || text.length > AI_SKILL_MARKDOWN_MAX || text.includes('\0')) throw new Error('技能 Markdown 无效或超过 20000 字符。');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
  if (!match) throw new Error('技能 Markdown 需要包含 name、description 的 YAML 头和说明正文。');
  let metadata: unknown;
  try {
    const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true });
    if (document.errors.length || document.warnings.length) throw new Error('invalid YAML');
    metadata = document.toJS({ maxAliasCount: 0 });
  } catch { throw new Error('技能 YAML 头无效，请检查字段、重复键和引用。'); }
  if (!record(metadata)) throw new Error('技能 Markdown 需要包含 name、description 的 YAML 头和说明正文。');
  return readSkill({ id: crypto.randomUUID(), name: metadata.name, description: metadata.description, instructions: match[2].trim(), keywords: metadata.keywords ?? [], modules: metadata.modules ?? [], enabled: false, defaultEnabled: false });
}
export function exportAiSkillMarkdown(skill: AiSkill): string {
  const verified = readSkill(skill);
  const metadata = { name: verified.name, description: verified.description,
    ...(verified.keywords.length ? { keywords: verified.keywords } : {}), ...(verified.modules.length ? { modules: verified.modules } : {}),
  };
  return `---\n${stringify(metadata, { lineWidth: 0 })}---\n${verified.instructions}\n`;
}

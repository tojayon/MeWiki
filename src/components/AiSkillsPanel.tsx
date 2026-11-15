import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BookOpenCheck, Download, Pencil, Plus, Save, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { aiProductModules } from '../ai/productCatalog.ts';
import {
  AI_LIBRARY_INSTRUCTIONS_MAX, AI_SKILL_INSTRUCTIONS_MAX, AI_SKILL_MARKDOWN_MAX,
  exportAiSkillMarkdown, importAiSkillMarkdown, resolveAiGuidance, suggestAiSkills,
  type AiLibraryGuidance, type AiSkill,
} from '../ai/skills.ts';
import { localizeError, t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import AiMaterialNotice from './AiMaterialNotice.tsx';
import './AiSkillsPanel.css';

export interface AiSkillsPanelProps {
  guidance: AiLibraryGuidance;
  selectedIds: string[];
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: AiLibraryGuidance) => void;
  onSelectionChange: (ids: string[]) => void;
  prompt?: string;
  moduleId?: string;
}
interface SkillDraft { skill: AiSkill; keywords: string }
const draft = (skill: AiSkill): SkillDraft => ({ skill: { ...skill, keywords: [...skill.keywords], modules: [...skill.modules] }, keywords: skill.keywords.join(', ') });
const emptySkill = (): AiSkill => ({ id: crypto.randomUUID(), name: '', description: '', instructions: '', keywords: [], modules: [], enabled: true, defaultEnabled: false });

export default function AiSkillsPanel(props: AiSkillsPanelProps) {
  return <AiSkillsPanelContent key={props.guidance.libraryId} {...props} />;
}

function AiSkillsPanelContent({ guidance, selectedIds, disabled, open, onOpenChange, onSave, onSelectionChange, prompt = '', moduleId }: AiSkillsPanelProps) {
  useLocale();
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), importInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const editorName = useRef<HTMLInputElement>(null), templateButton = useRef<HTMLButtonElement>(null), importGeneration = useRef(0);
  const [rulesDraft, setRulesDraft] = useState({ source: guidance.instructions, value: guidance.instructions });
  if (rulesDraft.source !== guidance.instructions) {
    setRulesDraft({ source: guidance.instructions, value: rulesDraft.value === rulesDraft.source ? guidance.instructions : rulesDraft.value });
  }
  const instructions = rulesDraft.value;
  const setInstructions = (value: string) => setRulesDraft(current => ({ ...current, value }));
  const [editor, setEditor] = useState<SkillDraft | null>(null);
  const [error, setError] = useState(''), [templatesOpen, setTemplatesOpen] = useState(false);
  const dismissError = useCallback(() => setError(''), []);
  useEffect(() => { const generation = importGeneration; return () => { generation.current++; }; }, []);
  const editorId = editor?.skill.id;
  useEffect(() => { if (open && editorId) editorName.current?.focus({ preventScroll: true }); }, [open, editorId]);
  const close = () => { onOpenChange(false); trigger.current?.focus({ preventScroll: true }); };
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : '技能操作未能完成，请重试。');
  function save(value: AiLibraryGuidance): boolean {
    if (disabled) return false;
    const retainedIds = selectedIds.filter(selectedId => value.skills.some(skill => skill.id === selectedId && skill.enabled));
    try { resolveAiGuidance(value, retainedIds); onSave(value); setError(''); return true; }
    catch (cause) { reportError(cause); return false; }
  }
  function saveSkill() {
    if (!editor || disabled) return;
    const skill = { ...editor.skill, name: editor.skill.name.trim(), description: editor.skill.description.trim(), keywords: editor.keywords.split(/[,，\n]+/).map(value => value.trim()).filter(Boolean) };
    const exists = guidance.skills.some(item => item.id === skill.id);
    const skills = exists ? guidance.skills.map(item => item.id === skill.id ? skill : item) : [...guidance.skills, skill];
    if (!save({ ...guidance, skills })) return;
    if (!skill.enabled || skill.defaultEnabled) onSelectionChange(selectedIds.filter(value => value !== skill.id));
    setEditor(null);
  }
  function select(skillId: string, checked: boolean) {
    if (disabled) return;
    const next = checked ? [...new Set([...selectedIds, skillId])] : selectedIds.filter(value => value !== skillId);
    try { if (checked) resolveAiGuidance(guidance, next); onSelectionChange(next); setError(''); }
    catch (cause) { reportError(cause); }
  }
  function remove(skillId: string) {
    if (!save({ ...guidance, skills: guidance.skills.filter(skill => skill.id !== skillId) })) return;
    onSelectionChange(selectedIds.filter(value => value !== skillId));
    if (editor?.skill.id === skillId) setEditor(null);
  }
  async function importFile(file: File | undefined) {
    if (!file || disabled) return;
    const generation = ++importGeneration.current;
    try {
      if (file.size > AI_SKILL_MARKDOWN_MAX * 4) throw new Error('技能 Markdown 无效或超过 20000 字符。');
      const skill = importAiSkillMarkdown(await file.text());
      if (generation !== importGeneration.current) return;
      setEditor(draft(skill)); setTemplatesOpen(false); setError('');
    } catch (cause) { if (generation === importGeneration.current) reportError(cause); }
  }
  function exportSkill(skill: AiSkill) {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([exportAiSkillMarkdown(skill)], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${[...skill.name].map(character => character.charCodeAt(0) < 32 ? '-' : character).join('').replace(/[<>:"/\\|?*]/g, '-').slice(0, 80) || 'SKILL'}.md`; anchor.click();
      setError('');
    } catch (cause) { reportError(cause); }
    finally { if (url) { const usedUrl = url; window.setTimeout(() => URL.revokeObjectURL(usedUrl), 1000); } }
  }
  function fromTemplate(index: number) {
    const skill = index === 0 ? {
      ...emptySkill(), name: t('符号一致性检查'), description: t('检查笔记中的符号写法是否符合词典。'),
      instructions: t('先查询相关符号与术语，再读取目标笔记。严格沿用符号词典提供的 TeX、正体与角标，不擅自简写。保留稳定引用，遇到重名或歧义先确认；所有笔记修改通过建议交由用户审阅。'),
      keywords: [t('符号'), t('公式')], modules: ['symbols', 'terms', 'notes', 'foundations'],
    } : {
      ...emptySkill(), name: t('学术文字润色'), description: t('保留论证和公式，改进笔记表述。'),
      instructions: t('先读取目标内容。保留事实、公式、符号引用、术语和引用来源，只改进措辞与结构。不补写未经材料支持的事实；将修改整理为可逐项审阅的建议。'),
      keywords: [t('润色'), t('改写')], modules: ['notes', 'foundations'],
    };
    setEditor(draft(skill)); setTemplatesOpen(false); setError('');
  }
  const suggestions = suggestAiSkills(guidance, prompt, moduleId).filter(skill => !selectedIds.includes(skill.id));
  const activeCount = guidance.skills.filter(skill => skill.enabled && (skill.defaultEnabled || selectedIds.includes(skill.id))).length;
  const missingIds = [...new Set(selectedIds)].filter(selectedId => !guidance.skills.some(skill => skill.id === selectedId));
  return <div ref={root} className="mewiki-ai-skills-control" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation();
    if (templatesOpen) { setTemplatesOpen(false); templateButton.current?.focus({ preventScroll: true }); }
    else close();
  }}>
    <button ref={trigger} type="button" data-ui="icon-action" aria-label={t('资料库规范与技能')} title={t('资料库规范与技能')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => onOpenChange(!open)}><BookOpenCheck size={14} /></button>
    {open && <div id={id} role="dialog" aria-label={t('资料库规范与技能')} className="mewiki-ai-skills-panel">
      <header><strong>{t('资料库规范与技能')}</strong><button type="button" data-ui="icon-action" aria-label={t('关闭')} title={t('关闭')} onClick={close}><X size={14} /></button></header>
      <div className="mewiki-ai-skills-content">
        <section className="mewiki-ai-skills-rules">
          <div className="mewiki-ai-skills-section-title"><label htmlFor={`${id}-rules`}>{t('资料库默认规范')}</label><button type="button" data-ui="icon-action" aria-label={t('保存资料库默认规范')} title={t('保存资料库默认规范')} disabled={disabled || instructions === guidance.instructions} onClick={() => save({ ...guidance, instructions })}><Save size={14} /></button></div>
          <textarea id={`${id}-rules`} rows={3} maxLength={AI_LIBRARY_INSTRUCTIONS_MAX} disabled={disabled} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder={t('例如：使用简体中文，严格沿用符号词典，修改前先核对来源。')} />
          <p>{t('仅在当前资料库生效，新对话也沿用。')}</p>
        </section>
        <section className="mewiki-ai-skills-list-section">
          <div className="mewiki-ai-skills-section-title"><span>{t`本次启用 ${activeCount} / 6`}</span><div role="toolbar" aria-label={t('管理技能')}>
            <button type="button" data-ui="icon-action" aria-label={t('新建技能')} title={t('新建技能')} disabled={disabled} onClick={() => { setEditor(draft(emptySkill())); setTemplatesOpen(false); setError(''); }}><Plus size={14} /></button>
            <button ref={templateButton} type="button" data-ui="icon-action" aria-label={t('从模板创建技能')} title={t('从模板创建技能')} aria-expanded={templatesOpen} disabled={disabled} onClick={() => setTemplatesOpen(!templatesOpen)}><Sparkles size={14} /></button>
            <button type="button" data-ui="icon-action" aria-label={t('导入技能 Markdown')} title={t('导入技能 Markdown')} disabled={disabled} onClick={() => importInput.current?.click()}><Upload size={14} /></button>
          </div></div>
          <input ref={importInput} hidden type="file" accept=".md,.markdown,text/markdown" aria-label={t('选择技能 Markdown')} disabled={disabled} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importFile(file); }} />
          {templatesOpen && <div className="mewiki-ai-skills-templates" role="group" aria-label={t('技能模板')}>
            <button type="button" disabled={disabled} onClick={() => fromTemplate(0)}><BookOpenCheck size={14} /><span>{t('符号一致性检查')}</span></button>
            <button type="button" disabled={disabled} onClick={() => fromTemplate(1)}><Pencil size={14} /><span>{t('学术文字润色')}</span></button>
          </div>}
          {!!suggestions.length && <div className="mewiki-ai-skills-suggestions" aria-label={t('推荐技能')}><span>{t('推荐')}</span>{suggestions.map(skill => <button key={skill.id} type="button" title={skill.description} disabled={disabled} onClick={() => select(skill.id, true)}><Plus size={12} /><span>{skill.name}</span></button>)}</div>}
          {!guidance.skills.length && !editor && <p>{t('尚无技能。创建或导入后，可手动启用或设为默认。')}</p>}
          <div className="mewiki-ai-skills-list">{guidance.skills.map(skill => {
            const defaultActive = skill.enabled && skill.defaultEnabled, selected = selectedIds.includes(skill.id);
            return <div key={skill.id} className="mewiki-ai-skill-row" data-disabled={!skill.enabled}>
              <label title={defaultActive ? t('默认技能会自动用于新任务；可在编辑中取消默认。') : skill.description}><input type="checkbox" checked={defaultActive || selected} aria-label={t`本次启用技能：${skill.name}`} disabled={disabled || defaultActive || (!skill.enabled && !selected)} onChange={event => select(skill.id, event.target.checked)} /><span>{skill.name}</span></label>
              {defaultActive && <small>{t('默认')}</small>}{!skill.enabled && <small>{t('已停用')}</small>}
              <div className="mewiki-ai-skill-actions">
                <button type="button" data-ui="icon-action" aria-label={t`编辑技能：${skill.name}`} title={t('编辑技能')} disabled={disabled} onClick={() => { setEditor(draft(skill)); setTemplatesOpen(false); setError(''); }}><Pencil size={13} /></button>
                <button type="button" data-ui="icon-action" aria-label={t`导出技能：${skill.name}`} title={t('导出技能')} onClick={() => exportSkill(skill)}><Download size={13} /></button>
                <button type="button" data-ui="icon-action" aria-label={t`删除技能配置：${skill.name}`} title={t('删除技能配置')} disabled={disabled} onClick={() => remove(skill.id)}><Trash2 size={13} /></button>
              </div>
            </div>;
          })}{missingIds.map(selectedId => <div key={selectedId} className="mewiki-ai-skill-row" data-disabled="true"><span>{t('不可用技能')}</span><button type="button" data-ui="icon-action" aria-label={t('移除不可用技能')} title={t('移除不可用技能')} disabled={disabled} onClick={() => select(selectedId, false)}><X size={13} /></button></div>)}</div>
        </section>
        {editor && <section className="mewiki-ai-skill-editor" aria-label={guidance.skills.some(skill => skill.id === editor.skill.id) ? t('编辑技能') : t('新建技能')}>
          <label htmlFor={`${id}-name`}>{t('技能名称')}<input ref={editorName} id={`${id}-name`} value={editor.skill.name} maxLength={100} disabled={disabled} onChange={event => setEditor({ ...editor, skill: { ...editor.skill, name: event.target.value } })} /></label>
          <label htmlFor={`${id}-description`}>{t('适用描述')}<input id={`${id}-description`} value={editor.skill.description} maxLength={600} disabled={disabled} onChange={event => setEditor({ ...editor, skill: { ...editor.skill, description: event.target.value } })} /></label>
          <label htmlFor={`${id}-body`}>{t('说明正文')}<textarea id={`${id}-body`} rows={6} value={editor.skill.instructions} maxLength={AI_SKILL_INSTRUCTIONS_MAX} disabled={disabled} onChange={event => setEditor({ ...editor, skill: { ...editor.skill, instructions: event.target.value } })} /></label>
          <label htmlFor={`${id}-keywords`}>{t('推荐关键词')}<input id={`${id}-keywords`} value={editor.keywords} disabled={disabled} placeholder={t('用逗号分隔')} onChange={event => setEditor({ ...editor, keywords: event.target.value })} /></label>
          <fieldset><legend>{t('适用模块')}</legend><div className="mewiki-ai-skill-modules">{aiProductModules.map(module => <label key={module.id}><input type="checkbox" checked={editor.skill.modules.includes(module.id)} disabled={disabled} onChange={event => setEditor({ ...editor, skill: { ...editor.skill, modules: event.target.checked ? [...editor.skill.modules, module.id] : editor.skill.modules.filter(value => value !== module.id) } })} /><span>{t(module.name)}</span></label>)}</div></fieldset>
          <div className="mewiki-ai-skill-options"><label><input type="checkbox" checked={editor.skill.enabled} disabled={disabled} onChange={event => setEditor({ ...editor, skill: { ...editor.skill, enabled: event.target.checked, defaultEnabled: event.target.checked && editor.skill.defaultEnabled } })} /><span>{t('启用技能')}</span></label><label><input type="checkbox" checked={editor.skill.defaultEnabled} disabled={disabled || !editor.skill.enabled} onChange={event => setEditor({ ...editor, skill: { ...editor.skill, defaultEnabled: event.target.checked } })} /><span>{t('默认启用')}</span></label></div>
          <div className="mewiki-ai-skill-editor-actions"><button type="button" disabled={disabled} onClick={saveSkill}>{t('保存技能')}</button><button type="button" onClick={() => { setEditor(null); setError(''); }}>{t('取消')}</button></div>
        </section>}
      </div>
    </div>}
    {open && error && <AiMaterialNotice messages={[localizeError(error)]} triggerRef={trigger} onClose={dismissError} />}
  </div>;
}

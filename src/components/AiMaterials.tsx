import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FileText, LoaderCircle, Paperclip, X } from 'lucide-react';
import { AI_MATERIAL_ACCEPT, AI_MATERIAL_MAX_ACTIVE, type AiMaterial } from '../ai/materials.ts';
import { t, localizeError } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import DeviceInspectorModal from './DeviceInspectorModal.tsx';
import AiMaterialNotice from './AiMaterialNotice.tsx';
import './AiMaterials.css';

export function AiMaterialPreview({ material, onClose }: { material: AiMaterial | null; onClose: () => void }) {
  useLocale();
  const [section, setSection] = useState({ id: '', index: 0 });
  const selected = section.id === material?.id ? Math.min(section.index, material.sections.length - 1) : 0;
  return createPortal(<div onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}><DeviceInspectorModal open={!!material} title={material?.name ?? t('辅助材料')} testId="mewiki-ai-material-preview" onClose={onClose} className="mewiki-ai-material-preview">
    {material && <>
      {material.sections.length > 1 && <label className="mewiki-ai-material-section"><span>{t('材料分段')}</span><select aria-label={t('材料分段')} value={selected} onChange={event => setSection({ id: material.id, index: Number(event.target.value) })}>{material.sections.map((item, index) => <option key={index} value={index}>{item.label}</option>)}</select></label>}
      <pre>{material.sections[selected]?.text || t('此段没有可读取文字。')}</pre>
    </>}
  </DeviceInspectorModal></div>, document.body);
}

export default function AiMaterials({ libraryId, materials, activeIds, disabled, onAdd, onRemove, onPreview, onBusyChange, scopeControl, children }: {
  libraryId: string; materials: AiMaterial[]; activeIds: string[]; disabled: boolean;
  scopeControl?: ReactNode; children?: ReactNode;
  onAdd: (material: AiMaterial) => void; onRemove: (id: string) => void; onPreview: (material: AiMaterial) => void; onBusyChange: (busy: boolean) => void;
}) {
  useLocale();
  const input = useRef<HTMLInputElement>(null), abort = useRef<AbortController | null>(null), alive = useRef(true), depth = useRef(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<{ name: string; completed: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false), [errors, setErrors] = useState<string[]>([]);
  const dismissErrors = useCallback(() => setErrors([]), []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); onBusyChange(false); }; }, [onBusyChange]);
  async function add(files: File[]) {
    if (disabled || abort.current || !files.length || !libraryId) return;
    if (files.length + activeIds.length > AI_MATERIAL_MAX_ACTIVE) { setErrors([t('一次最多使用 6 份辅助材料。')]); return; }
    const controller = new AbortController(); abort.current = controller; onBusyChange(true); setErrors([]);
    try {
      for (const file of files) {
        if (controller.signal.aborted || !alive.current) return;
        setPending({ name: file.name, completed: 0, total: 0 });
        try {
          if (!file.size || file.size > 20_000_000) throw new Error('辅助文件需大于 0 字节且不超过 20 MB。');
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
          const buffer = await file.arrayBuffer(); signal.throwIfAborted();
          const { parseAiMaterial } = await import('../ai/materialImport.ts');
          const material = await parseAiMaterial(libraryId, file.name, buffer, { signal, onProgress: (completed, total) => { if (alive.current && !signal.aborted) setPending({ name: file.name, completed, total }); } });
          signal.throwIfAborted();
          if (alive.current) onAdd(material);
        } catch (cause) {
          if (controller.signal.aborted || !alive.current) return;
          const error = cause instanceof Error && cause.name === 'TimeoutError' ? t('文件解析超时，请拆分后重新添加。') : localizeError(cause instanceof Error ? cause.message : '文件无法解析，请重新添加。');
          setErrors(previous => [...previous, `${file.name} · ${error}`]);
        }
      }
    } finally {
      abort.current = null;
      if (alive.current) { setPending(null); onBusyChange(false); }
    }
  }
  function fileDrag(event: DragEvent) { return event.dataTransfer.types.includes('Files'); }
  return <section className="mewiki-ai-materials" aria-label={t('辅助材料')} data-dragging={dragging}
    onDragEnter={event => { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); if (disabled || pending) return; depth.current++; setDragging(true); }}
    onDragOver={event => { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = disabled || pending ? 'none' : 'copy'; }}
    onDragLeave={event => { if (!fileDrag(event)) return; event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={event => { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); void add([...event.dataTransfer.files]); }}>
    <div className="mewiki-ai-material-list">
      {scopeControl}
      <button ref={addButton} type="button" className="mewiki-ai-material-add" aria-label={t('添加辅助文件')} title={t('支持 TXT、Markdown、JSON、TeX 等文本、代码和配置文件，以及 PDF、DOCX、CSV、TSV 和 XLSX。')} disabled={disabled || !!pending || activeIds.length >= 6} onClick={() => input.current?.click()}><Paperclip size={14} /><span>{t('添加文件')}</span></button>
      <input ref={input} hidden type="file" multiple accept={AI_MATERIAL_ACCEPT} aria-label={t('选择辅助文件')} disabled={disabled || !!pending} onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void add(files); }} />
      {activeIds.map(id => {
        const material = materials.find(item => item.id === id);
        return <div key={id} className="mewiki-ai-material-chip" data-missing={!material}>
          <button type="button" title={material?.name} aria-label={material ? t`查看材料：${material.name}` : t('辅助材料不可用')} disabled={!material} onClick={() => onPreview(material!)}><FileText size={13} /><span>{material?.name ?? t('辅助材料不可用')}</span></button>
          <button type="button" aria-label={material ? t`移除材料：${material.name}` : t('移除不可用材料')} title={t('移除材料')} disabled={disabled || !!pending} onClick={() => onRemove(id)}><X size={12} /></button>
        </div>;
      })}
    </div>
    {dragging && <p className="mewiki-ai-material-drop">{t('松开添加辅助材料')}</p>}
    {pending && <div className="mewiki-ai-material-progress" role="status"><LoaderCircle size={13} /><span>{t`正在解析：${pending.name}`}{pending.total > 1 ? ` · ${pending.completed}/${pending.total}` : ''}</span><button type="button" data-ui="icon-action" aria-label={t('取消文件解析')} title={t('取消文件解析')} onClick={() => abort.current?.abort()}><X size={13} /></button></div>}
    {!!activeIds.length && <p className="mewiki-ai-material-disclosure">{t('材料会随任务提供给所选 AI 服务。')}</p>}
    {!!errors.length && <AiMaterialNotice messages={errors} triggerRef={addButton} onClose={dismissErrors} />}
    {children}
  </section>;
}

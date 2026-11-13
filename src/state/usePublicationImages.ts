import { useMemo, useState } from 'react';
import { collectPublicationImages, type PublicationNoteImage } from '../domain/publicationImages.ts';
import { PUBLICATION_MAX_IMAGE_COUNT, type PublicationImageCrop } from '../domain/publicationTypes.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { publicationImageFromBlob, resolvePublicationImage } from './publicationSource.ts';
import type { PublicationImageInput } from './publicationImageBatch.ts';
import type { PublicationDraftImages } from './publicationDrafts.ts';
import { imageWorkspaceClient } from './imageWorkspaceClient.ts';

export interface PublicationWorkspaceImage extends PublicationImageInput { file?: File; noteImage?: PublicationNoteImage; assetId?: string }

/** Work drafts retain originals separately from explicitly named image designs. */
export function usePublicationImages(state: ResearchNotebookState, noteId: string, directory: string | null, onChange: () => void, initial?: PublicationDraftImages, libraryId = 'default', pluginId = '') {
  const candidates = useMemo(() => collectPublicationImages(state, noteId), [state, noteId]);
  const [initialSources] = useState<PublicationWorkspaceImage[]>(() => initial?.sources.map(source => {
    const file = source.blob ? new File([source.blob], source.name, { type: source.blob.type }) : undefined;
    return { id: source.id, name: source.name, ...(file ? { file } : { assetId: source.assetId }), load: (signal: AbortSignal) => file ? publicationImageFromBlob(file, signal) : imageWorkspaceClient(libraryId, pluginId).asset(source.assetId!, signal) };
  }) ?? []);
  const [uploads, setUploads] = useState<{ id: string; file: File }[]>(() => initial?.includeCandidates ? initialSources.filter(source => source.file).map(source => ({ id: source.id, file: source.file! })) : []);
  const [restored, setRestored] = useState<PublicationWorkspaceImage[] | null>(() => initial && !initial.includeCandidates ? initialSources : null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set(initial?.selectedIds ?? []));
  const [crops, setCrops] = useState<Record<string, PublicationImageCrop>>(initial?.crops ?? {});
  const [currentId, setCurrentId] = useState(initial?.currentId ?? '');
  const items = useMemo<PublicationWorkspaceImage[]>(() => [
    ...(restored ?? candidates.map(noteImage => ({ id: noteImage.id, name: noteImage.name, noteImage, load: (signal: AbortSignal) => resolvePublicationImage(noteImage.source, directory, signal) }))),
    ...uploads.map(({ id, file }) => ({ id, name: file.name, file, load: (signal: AbortSignal) => publicationImageFromBlob(file, signal) })),
  ], [candidates, uploads, directory, restored]);
  const selected = useMemo(() => items.filter(item => selectedIds.has(item.id)).map(item => ({ ...item, ...(crops[item.id] ? { crop: crops[item.id] } : {}) })), [items, selectedIds, crops]);
  const current = selected.find(item => item.id === currentId) ?? selected[0];
  const draft = useMemo<PublicationDraftImages>(() => ({
    includeCandidates: restored === null,
    sources: [...(restored ?? []), ...uploads.map(item => ({ ...item, name: item.file.name, assetId: undefined }))].map(item => ({ id: item.id, name: item.name, ...(item.file ? { blob: item.file } : { assetId: item.assetId }) })),
    selectedIds: [...selectedIds], crops, currentId,
    candidates: Object.fromEntries(candidates.map(item => [item.id, item.source.assetId])),
  }), [restored, uploads, selectedIds, crops, currentId, candidates]);
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    if (selectedIds.size + files.length > PUBLICATION_MAX_IMAGE_COUNT || uploads.length + files.length > PUBLICATION_MAX_IMAGE_COUNT) throw new Error('每批最多选择 50 张图片，请减少选择或分次导出。');
    files.forEach((file, index) => {
      if (!file.size || file.size > 8 * 1024 * 1024) throw new Error(`内容 → 图片导出 → 第 ${index + 1} 项：导出图片原件不能超过 8 MiB，请先缩小图片。`);
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error(`内容 → 图片导出 → 第 ${index + 1} 项：请选择 PNG、JPEG 或 WebP 图片。`);
    });
    const added = files.map(file => ({ id: crypto.randomUUID(), file }));
    setUploads(value => [...value, ...added]); setSelectedIds(value => new Set([...value, ...added.map(item => item.id)]));
    setCurrentId(added[0].id); onChange();
  };
  const select = (id: string, checked: boolean) => {
    if (checked && !selectedIds.has(id) && selectedIds.size >= PUBLICATION_MAX_IMAGE_COUNT) throw new Error('每批最多选择 50 张图片，请减少选择或分次导出。');
    setSelectedIds(value => { const next = new Set(value); if (checked) next.add(id); else next.delete(id); return next; });
    if (checked) setCurrentId(id); onChange();
  };
  const all = (checked: boolean) => {
    if (checked && items.length > PUBLICATION_MAX_IMAGE_COUNT) throw new Error('每批最多选择 50 张图片，请减少选择或分次导出。');
    setSelectedIds(new Set(checked ? items.map(item => item.id) : [])); onChange();
  };
  const remove = (id: string) => {
    setUploads(value => value.filter(item => item.id !== id));
    setRestored(value => value?.filter(item => item.id !== id) ?? null);
    setSelectedIds(value => { const next = new Set(value); next.delete(id); return next; });
    setCrops(value => { const next = { ...value }; delete next[id]; return next; }); onChange();
  };
  const crop = (id: string, value: PublicationImageCrop) => { setCrops(current => ({ ...current, [id]: value })); onChange(); };
  const restore = (values: PublicationWorkspaceImage[]) => { setRestored(values); setUploads([]); setSelectedIds(new Set(values.map(item => item.id))); setCrops(Object.fromEntries(values.flatMap(item => item.crop ? [[item.id, item.crop]] : []))); setCurrentId(values[0]?.id ?? ''); onChange(); };
  const addBlank = async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('空白画布创建失败。')), 'image/png'));
    addFiles([new File([blob], 'canvas.png', { type: 'image/png' })]);
  };
  return { items, selected, selectedIds, current, addFiles, select, all, remove, crop, setCurrentId, restore, addBlank, draft };
}
export type PublicationImagesWorkspace = ReturnType<typeof usePublicationImages>;

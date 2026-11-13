import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultComposition, type PublicationImageData } from '../domain/publicationComposition.ts';
import { parsePublicationOptions, type PublicationOptions } from '../domain/publicationTypes.ts';
import type { ImageDesign, ImageWorkspaceCollection } from '../domain/imageWorkspace.ts';
import { imageWorkspaceClient } from './imageWorkspaceClient.ts';
import type { CompositionEditor } from './useCompositionEditor.ts';
import type { PublicationImagesWorkspace } from './usePublicationImages.ts';
import type { CompositionItemEdits } from './compositionEdits.ts';
import { createImageDesignPackage, readImageDesignPackage } from './imageDesignPackage.ts';
import { importUserFont, readUserFont, userFontFile } from './userFonts.ts';
import type { PublicationDraft } from './publicationDrafts.ts';

export function compositionBatchInputs(images: PublicationImagesWorkspace, editor: CompositionEditor) {
  return images.selected.map((item, index) => {
    const edit = editor.items[item.id];
    const imageData: PublicationImageData = { title: edit?.title ?? item.name.replace(/\.[^.]+$/, ''), subtitle: edit?.subtitle ?? '', name: item.name, index: index + 1, total: images.selected.length, ...(edit?.overrides ? { overrides: edit.overrides } : {}) };
    return { ...item, crop: edit?.crop ?? item.crop, imageData };
  });
}
export function useCompositionLibrary(libraryId: string, pluginId: string, options: PublicationOptions, images: PublicationImagesWorkspace, editor: CompositionEditor, onError: (error: string) => void, initial?: PublicationDraft['design']) {
  const client = useMemo(() => imageWorkspaceClient(libraryId, pluginId), [libraryId, pluginId]);
  const [collection, setCollection] = useState<ImageWorkspaceCollection | null>(null), [designId, setDesignId] = useState(initial?.designId ?? ''), [name, setName] = useState(initial?.name ?? ''), [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const ref = useRef({ options, images, editor });
  useLayoutEffect(() => { ref.current = { options, images, editor }; }, [options, images, editor]);
  const assets = useRef(new Map<string, { load: unknown; assetId: string }>()), alive = useRef(true), pending = useRef(false);
  const [lastSignature, setLastSignature] = useState(initial?.lastSignature ?? '');
  const [autoSavePaused, setAutoSavePaused] = useState(initial?.autoSavePaused ?? false);
  const [updatedAt, setUpdatedAt] = useState(initial?.updatedAt ?? '');
  const restoredBaseline = useRef(initial?.designId ? initial : undefined);
  const signature = JSON.stringify({ options, items: editor.items, images: images.selected.map(image => [image.id, image.name, image.crop]) });
  const signatureLatest = useRef(signature);
  useLayoutEffect(() => { signatureLatest.current = signature; }, [signature]);
  useEffect(() => {
    alive.current = true; const abort = new AbortController();
    void client.read(abort.signal).then(value => {
      if (abort.signal.aborted) return;
      const baseline = restoredBaseline.current;
      if (baseline) {
        restoredBaseline.current = undefined;
        const current = value.designs.find(item => item.id === baseline.designId);
        if (!current || current.updatedAt !== baseline.updatedAt) {
          setAutoSavePaused(true);
          onError('原图片设计已在其他页面更新或删除。当前草稿已保留，请重新打开设计或另存为，避免覆盖其他修改。');
        } else if (baseline.autoSavePaused) onError('图片设计自动保存已暂停。请检查当前草稿后手动保存或另存为。');
      }
      setCollection(value);
    }).catch(cause => { if (!abort.signal.aborted) onError(cause.message); });
    return () => { alive.current = false; abort.abort(); };
  }, [client, onError]);
  const refresh = async () => { const value = await client.read(); if (alive.current) setCollection(value); return value; };
  const save = useCallback(async (requestedName?: string, manual = true, asNew = false) => {
    if (pending.current || !alive.current) return;
    if (!collection) throw new Error('图片设计列表尚未读取完成，请稍后重试。');
    if (designId && !asNew && collection.designs.find(item => item.id === designId)?.updatedAt !== updatedAt) throw new Error('原图片设计已在其他页面更新或删除。当前草稿已保留，请重新打开设计或另存为，避免覆盖其他修改。');
    const designName = (requestedName ?? name).trim(); if (!designName) throw new Error('请填写设计名称。');
    pending.current = true; setSaving(true); setNotice('');
    const frozen = ref.current, capturedSignature = signatureLatest.current;
    try {
      const settings = parsePublicationOptions({ ...structuredClone(frozen.options), composition: structuredClone(frozen.options.composition ?? defaultComposition()) });
      const inputs = compositionBatchInputs(frozen.images, frozen.editor).map(item => ({ ...item, imageData: structuredClone(item.imageData) }));
      const items: ImageDesign['items'] = [];
      for (const item of inputs) {
        const cached = assets.current.get(item.id);
        const assetId = cached?.load === item.load ? cached.assetId : await client.putAsset(await item.load(new AbortController().signal));
        assets.current.set(item.id, { load: item.load, assetId });
        items.push({ id: item.id, name: item.name, assetId, ...(item.crop ? { crop: { ...item.crop } } : {}), imageData: item.imageData });
      }
      const design: ImageDesign = { id: !asNew && designId || crypto.randomUUID(), name: designName.slice(0, 100), updatedAt: new Date().toISOString(), options: settings, items };
      const next = await client.save({ ...collection, designs: [...collection.designs.filter(item => item.id !== design.id), design] });
      if (alive.current) { setLastSignature(capturedSignature); setUpdatedAt(design.updatedAt); setCollection(next); setDesignId(design.id); setName(design.name); setAutoSavePaused(false); setNotice(manual ? '图片设计已保存。' : '图片设计已自动保存。'); }
      return design;
    } catch (cause) { if (!manual && alive.current) setAutoSavePaused(true); throw cause; }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }, [client, collection, designId, name, updatedAt]);
  useEffect(() => {
    if (!designId || !options.imageMode || !collection || signature === lastSignature || saving || autoSavePaused) return;
    const timer = window.setTimeout(() => { void save(undefined, false).catch(cause => onError(cause.message)); }, 1800);
    return () => clearTimeout(timer);
  }, [signature, lastSignature, designId, collection, saving, autoSavePaused, options.imageMode, save, onError]);
  const load = (design: ImageDesign) => {
    const items: CompositionItemEdits = {};
    const sources = design.items.map(item => {
      if (item.imageData || item.crop) items[item.id] = { ...(item.imageData ? { title: item.imageData.title, subtitle: item.imageData.subtitle, overrides: item.imageData.overrides } : {}), ...(item.crop ? { crop: item.crop } : {}) };
      const load = (signal: AbortSignal) => client.asset(item.assetId, signal);
      assets.current.set(item.id, { load, assetId: item.assetId });
      return { id: item.id, name: item.name, crop: item.crop, load, assetId: item.assetId };
    });
    ref.current.editor.replace(structuredClone(design.options), items, true); ref.current.images.restore(sources);
    setDesignId(design.id); setUpdatedAt(design.updatedAt); setName(design.name); setAutoSavePaused(false); setNotice('图片设计已打开。');
    setLastSignature(JSON.stringify({ options: design.options, items, images: sources.map(item => [item.id, item.name, item.crop]) }));
  };
  const addSticker = async (name: string, image: string) => {
    if (!collection) throw new Error('图片设计列表尚未读取完成，请稍后重试。');
    if (pending.current || !alive.current) return;
    pending.current = true; setSaving(true);
    try {
      const assetId = await client.putAsset(image);
      const stickers = collection.stickers.some(sticker => sticker.assetId === assetId) ? collection.stickers : [...collection.stickers, { id: crypto.randomUUID(), name: name.slice(0, 100), assetId }];
      const next = await client.save({ ...collection, stickers });
      if (alive.current) { setCollection(next); setNotice('贴纸已保存到当前资料库。'); }
    } finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  const removeDesign = async () => {
    if (!collection || !designId || pending.current) return;
    pending.current = true; setSaving(true);
    try {
      const next = await client.save({ ...collection, designs: collection.designs.filter(design => design.id !== designId) });
      if (alive.current) { setCollection(next); setDesignId(''); setName(''); setNotice('图片设计已删除，原图素材仍保留。'); }
    } finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  const backup = async () => {
    const design = await save(); if (!design) return;
    pending.current = true; setSaving(true);
    try { return { blob: await createImageDesignPackage(design, id => client.asset(id), id => readUserFont(libraryId, id)), name: design.name }; }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  const restore = async (file: File) => {
    if (!collection || pending.current) return;
    pending.current = true; setSaving(true); setNotice('');
    try {
      const archive = await readImageDesignPackage(file);
      try {
        for (const id of new Set(archive.design.items.map(item => item.assetId))) if (await client.putAsset(await archive.asset(id)) !== id) throw new Error('作品备份中的素材校验失败。');
        for (const descriptor of archive.fonts) await importUserFont(libraryId, userFontFile(await archive.font(descriptor)));
        const design = { ...archive.design, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
        const next = await client.save({ ...collection, designs: [...collection.designs, design] });
        if (alive.current) { setCollection(next); load(design); setNotice('作品备份已导入为新的图片设计。'); }
      } finally { await archive.close(); }
    } finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  const removeSticker = async (id: string) => {
    if (!collection || pending.current) return;
    pending.current = true; setSaving(true);
    try { const next = await client.save({ ...collection, stickers: collection.stickers.filter(item => item.id !== id) }); if (alive.current) setCollection(next); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  const draft = useMemo(() => ({ designId, name, lastSignature, updatedAt, autoSavePaused }), [designId, name, lastSignature, updatedAt, autoSavePaused]);
  return { collection, designId, name, setName, saving, notice, save, load, refresh, addSticker, removeSticker, removeDesign, backup, restore, client, dirty: !!designId && signature !== lastSignature,
    draft };
}
export type CompositionLibrary = ReturnType<typeof useCompositionLibrary>;

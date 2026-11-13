import { useEffect, useState } from "react";
import type { ResearchMediaAsset, ResearchMediaSource } from "../domain/researchMedia.ts";
import { researchMediaClient } from "../state/researchMediaClient.ts";
import { browserMediaStore } from "../state/researchMediaStorage.ts";
import { useResearchContentLibrary } from "../state/ResearchContentLibraryContext.ts";
import type { LibrarySaveStatus } from "../state/researchLibraryController.ts";

interface MediaView { key: string; asset?: ResearchMediaAsset; previewUrl?: string; originalUrl?: string; playbackUrl?: string; error?: string; loading?: boolean }
const mediaSavedEvent = "webbench:research-media-saved";
export function refreshResearchMediaAsset(directory: string | null, assetId: string) {
  window.dispatchEvent(new CustomEvent(mediaSavedEvent, { detail: { directory, assetId } }));
}
export function useResearchMediaSource(source: ResearchMediaSource | undefined): Omit<MediaView, "key"> & { directory: string | null; busy: boolean; status: LibrarySaveStatus } {
  const { directory, busy, status } = useResearchContentLibrary();
  const assetId = source?.type === "asset" ? source.assetId : undefined;
  const [revision, setRevision] = useState(0);
  const key = `${directory ?? "browser"}:${source?.type === "asset" ? source.assetId : source?.url ?? ""}:${revision}`;
  const [view, setView] = useState<MediaView>({ key: "" });
  useEffect(() => {
    const saved = (event: Event) => {
      const detail = (event as CustomEvent<{ directory: string | null; assetId: string }>).detail;
      if (detail?.directory === directory && detail.assetId === assetId) setRevision(value => value + 1);
    };
    window.addEventListener(mediaSavedEvent, saved);
    return () => window.removeEventListener(mediaSavedEvent, saved);
  }, [assetId, directory]);
  useEffect(() => {
    if (!assetId) return;
    const abort = new AbortController();
    const urls: string[] = [];
    const createUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
    void (async () => {
      try {
        if (directory) {
          const asset = await researchMediaClient.metadata(directory, assetId, abort.signal);
          if (!abort.signal.aborted) setView({ key, asset, originalUrl: researchMediaClient.contentUrl(directory, assetId), playbackUrl: researchMediaClient.contentUrl(directory, assetId, false, true) + `&refresh=${revision}`, ...(asset.preview ? { previewUrl: researchMediaClient.contentUrl(directory, assetId, true) + `&refresh=${revision}` } : {}) });
        } else {
          const stored = await browserMediaStore.get(assetId);
          if (abort.signal.aborted) return;
          if (!stored) throw new Error("媒体原件未找到，请恢复含附件备份或重新选择文件。");
          const originalUrl = createUrl(stored.blob);
          setView({ key, asset: stored.asset, originalUrl, playbackUrl: originalUrl, ...(stored.previewBlob ? { previewUrl: createUrl(stored.previewBlob) } : {}) });
        }
      } catch (cause) {
        if (!abort.signal.aborted) setView({ key, error: cause instanceof Error ? cause.message : "媒体读取失败。" });
      }
    })();
    return () => { abort.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [directory, assetId, key, revision]);
  if (source?.type === "url") return { directory, busy, status, previewUrl: source.url, originalUrl: source.url, playbackUrl: source.url };
  return { directory, busy, status, ...(view.key === key ? view : { loading: source?.type === "asset" }) };
}

import { sha256 } from "@noble/hashes/sha2.js";
import manifest from "../../docs/wiki/assets/manifest.json" with { type: "json" };
import { IMAGE_PREVIEW_PIXELS, type ResearchMediaAsset } from "./researchMedia.ts";

const urls: Record<string, string> = {
  "showcase-image.png": new URL("../../docs/wiki/assets/showcase-image.png", import.meta.url).href,
  "showcase-audio.wav": new URL("../../docs/wiki/assets/showcase-audio.wav", import.meta.url).href,
  "showcase-video.webm": new URL("../../docs/wiki/assets/showcase-video.webm", import.meta.url).href,
  "showcase-document.pdf": new URL("../../docs/wiki/assets/showcase-document.pdf", import.meta.url).href,
  "showcase-data.csv": new URL("../../docs/wiki/assets/showcase-data.csv", import.meta.url).href,
};

/** The handbook ships ordinary, hash-addressed originals, without external URLs. */
export function meWikiManualAsset(id: string): { asset: ResearchMediaAsset; url: string } | undefined {
  const entry = Object.entries(manifest).find(([, asset]) => asset.id === id);
  if (!entry) return;
  const [name, asset] = entry;
  return { asset: { ...asset }, url: urls[name] };
}

export function meWikiManualAssetId(name: string): string {
  const asset = manifest[name as keyof typeof manifest];
  if (!asset) throw new Error(`手册示例附件不存在：${name}`);
  return asset.id;
}

export async function readMeWikiManualAsset(id: string, fetcher: typeof fetch = globalThis.fetch, signal?: AbortSignal) {
  const bundled = meWikiManualAsset(id);
  if (!bundled) return;
  const response = await fetcher(bundled.url, { signal });
  if (!response.ok) throw new Error("无法读取随手册提供的演示附件。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== id || bytes.byteLength !== bundled.asset.size) throw new Error("手册演示附件校验失败，请重新构建应用。");
  const blob = new Blob([bytes], { type: bundled.asset.mimeType });
  const preview = bundled.asset.mimeType === "image/png" && bundled.asset.width && bundled.asset.height && bundled.asset.width * bundled.asset.height <= IMAGE_PREVIEW_PIXELS;
  return { asset: bundled.asset, blob, ...(preview ? { previewBlob: blob } : {}) };
}

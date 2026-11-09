import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { serializeResearchMarkdown, type ResearchNotebookState } from "../domain/researchNotebook.ts";
import { researchMediaAssetIds, mediaMimeExtensions } from "../domain/researchMedia.ts";
import { browserMediaStore } from "./researchMediaStorage.ts";
import { createResearchLibraryFile } from "./researchLibraryFile.ts";
import { expandNoteEmbedBlocks } from '../domain/researchNoteEmbed.ts';

const BLOB_ARCHIVE_LIMIT = 32 * 1024 * 1024;
const archiveReleases = new WeakMap<Blob, () => Promise<void>>();

function ext(mime: string) {
  return mediaMimeExtensions[mime.toLowerCase()] ?? "bin";
}

function archivePart(value: string) {
  // IDs are application data and can contain slashes or traversal-looking text.
  // Keep the original ID in the notebook while making the ZIP member a safe name.
  return encodeURIComponent(value).replaceAll("%", "_").replace(/[^a-zA-Z0-9._-]/g, "_") || "note";
}

interface ArchiveSink {
  writable: WritableStream;
  file: () => Promise<File>;
  release: () => Promise<void>;
}

async function opfsArchiveSink(): Promise<ArchiveSink | undefined> {
  const getDirectory = globalThis.navigator?.storage?.getDirectory;
  if (typeof getDirectory !== "function") return undefined;
  let folder: FileSystemDirectoryHandle | undefined;
  let name: string | undefined;
  try {
    const root = await getDirectory.call(globalThis.navigator.storage);
    folder = await root.getDirectoryHandle("mewiki-research-exports", { create: true });
    name = `archive-${crypto.randomUUID()}.zip`;
    const exportFolder = folder;
    const exportName = name;
    const handle = await folder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let released = false;
    return {
      writable,
      file: () => handle.getFile(),
      release: async () => {
        if (released) return;
        released = true;
        await exportFolder.removeEntry(exportName);
      },
    };
  } catch {
    if (folder && name) await folder.removeEntry(name).catch(() => {});
    // A browser may expose OPFS but deny it in a private or quota-restricted context.
    // The caller can still use the small in-memory fallback below.
    return undefined;
  }
}

type StoredMedia = NonNullable<Awaited<ReturnType<typeof browserMediaStore.get>>>;

export async function createBrowserMediaArchive(state: ResearchNotebookState, format: "library" | "markdown", noteId?: string, sourceStore: Pick<typeof browserMediaStore, 'get'> = browserMediaStore): Promise<Blob> {
  const notes = format === "markdown" && noteId ? state.notes.filter(note => note.id === noteId) : state.notes;
  const ids = researchMediaAssetIds(notes.flatMap(note => format === 'markdown' ? expandNoteEmbedBlocks(state.notes, note.blocks, note.id) : note.blocks));
  const resources = new Map<string, StoredMedia>();
  let totalBytes = 0;
  for (const id of ids) {
    const stored = await sourceStore.get(id);
    if (!stored) throw new Error("部分媒体原件缺失，未生成不完整的附件备份。请先重新关联文件。");
    resources.set(id, stored);
    totalBytes += stored.blob.size;
  }

  const opfs = await opfsArchiveSink();
  if (!opfs && totalBytes > BLOB_ARCHIVE_LIMIT)
    throw new Error("浏览器导出暂存空间不足以安全生成此备份，请先连接本地资料库后再导出含附件备份。");

  let writer: ZipWriter<unknown>;
  let blobWriter: BlobWriter | undefined;
  if (opfs) writer = new ZipWriter(opfs.writable, { useWebWorkers: false, level: 0, zip64: true });
  else {
    blobWriter = new BlobWriter("application/zip");
    const sink = blobWriter.writable.getWriter();
    let written = 0;
    const limited = new WritableStream<Uint8Array>({
      write: async chunk => {
        written += chunk.byteLength;
        if (written > BLOB_ARCHIVE_LIMIT) throw new Error("此备份需要更多导出暂存空间，请连接本地资料库后导出。");
        await sink.write(chunk);
      },
      close: () => sink.close(),
      abort: reason => sink.abort(reason),
    });
    writer = new ZipWriter(limited, { useWebWorkers: false, level: 0, zip64: true });
  }
  try {
    if (format === "library") await writer.add("research-library.webbench.json", new TextReader(JSON.stringify(await createResearchLibraryFile(state), null, 2) + "\n"));
    for (const [index, note] of (format === "markdown" ? notes : []).entries()) {
      const markdown = serializeResearchMarkdown(note, state.symbols, state.notes).replaceAll(/webbench-asset:([a-f0-9]{64})/g, (_match, id: string) => `../assets/${id}.${ext(resources.get(id)!.asset.mimeType)}`);
      await writer.add(`notes/${index + 1}-${archivePart(note.id)}.md`, new TextReader(markdown));
    }
    for (const id of ids) {
      const stored = resources.get(id)!;
      await writer.add(`assets/${id}.${ext(stored.asset.mimeType)}`, stored.blob.stream(), { level: 0 });
      await writer.add(`assets/${id}.json`, new TextReader(JSON.stringify(stored.asset)));
    }
    await writer.close();
    const archive = opfs ? await opfs.file() : await blobWriter!.getData();
    if (opfs) archiveReleases.set(archive, opfs.release);
    return archive;
  } catch (cause) {
    if (opfs) {
      await opfs.writable.abort(cause).catch(() => {});
      await opfs.release().catch(() => {});
    }
    throw cause;
  }
}

/** Releases the exact OPFS temporary file used for a browser export. */
export async function releaseBrowserMediaArchive(archive: Blob) {
  const release = archiveReleases.get(archive);
  if (!release) return;
  archiveReleases.delete(archive);
  await release();
}

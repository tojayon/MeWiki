import Ajv from "ajv";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import {
  ensureTheoryMaps,
  normalizeTheoryMapDocument,
  type TheoryMapDocument,
} from "../domain/researchTheoryMap.ts";

const ref = {
  type: "object",
  required: ["noteId"],
  additionalProperties: false,
  properties: {
    noteId: { type: "string", minLength: 1 },
    blockId: { type: "string", minLength: 1 },
  },
};
const point = {
  type: "object",
  required: ["x", "y"],
  additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" } },
};
const schema = {
  type: "object",
  required: ["format", "version", "document"],
  additionalProperties: false,
  properties: {
    format: { const: "webbench-theory-map" },
    version: { const: 1 },
    document: {
      type: "object",
      required: [
        "id",
        "title",
        "kind",
        "createdAt",
        "updatedAt",
        "noteIds",
        "annotations",
        "relations",
        "view",
      ],
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1, maxLength: 128 },
        title: { type: "string", minLength: 1 },
        kind: { enum: ["topic", "global"] },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        noteIds: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", minLength: 1 },
        },
        annotations: {
          type: "array",
          items: {
            type: "object",
            required: ["ref", "role"],
            additionalProperties: false,
            properties: {
              ref,
              role: {
                enum: ["foundation", "assumption", "model", "unclassified"],
              },
            },
          },
        },
        relations: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "source", "target", "kind", "description"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              source: ref,
              target: ref,
              kind: { enum: ["derivation", "assumption", "adaptation"] },
              description: { type: "string" },
            },
          },
        },
        view: {
          type: "object",
          required: ["expandedNoteIds", "showAllBlocks", "layout"],
          additionalProperties: false,
          properties: {
            expandedNoteIds: {
              type: "array",
              uniqueItems: true,
              items: { type: "string" },
            },
            showAllBlocks: { type: "boolean" },
            selectedNodeId: { type: "string" },
            layout: {
              type: "object",
              required: ["positions"],
              additionalProperties: false,
              properties: {
                positions: { type: "object", additionalProperties: point },
                viewport: {
                  type: "object",
                  required: ["x", "y", "zoom"],
                  additionalProperties: false,
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    zoom: { type: "number", minimum: 0.1, maximum: 3 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
const validate = new Ajv({ allErrors: true }).compile(schema);

export function serializeTheoryMapFile(document: TheoryMapDocument): string {
  return (
    JSON.stringify(
      {
        format: "webbench-theory-map",
        version: 1,
        document: normalizeTheoryMapDocument(document),
      },
      null,
      2,
    ) + "\n"
  );
}
export function parseTheoryMapFile(content: string): TheoryMapDocument {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("地图文件不是有效的 JSON。");
  }
  const file = value as {
    format?: string;
    version?: number;
    document?: unknown;
  } | null;
  if (!file || file.format !== "webbench-theory-map")
    throw new Error("请选择 MeWiki .theorymap.json 地图文件。");
  if (file.version !== 1)
    throw new Error("不支持此地图文件版本，请使用当前版本导出。");
  if (!validate(value))
    throw new Error(
      "地图文件格式错误：" +
        (validate.errors?.[0]?.instancePath || "文档") +
        " " +
        (validate.errors?.[0]?.message ?? ""),
    );
  const doc = normalizeTheoryMapDocument(file.document);
  if (!doc) throw new Error("地图文件格式错误：缺少名称或引用信息。");
  return doc;
}
export function theoryMapFilename(
  doc: Pick<TheoryMapDocument, "id"> & { title?: string },
): string {
  let hash = 2166136261;
  for (const letter of doc.id)
    hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return `map-${encodeURIComponent(doc.id).replaceAll("%", "_").slice(0, 100)}-${(hash >>> 0).toString(16)}.theorymap.json`;
}
export function importTheoryMapFile(
  state: ResearchNotebookState,
  content: string,
): ResearchNotebookState {
  const next = ensureTheoryMaps(state);
  const imported = parseTheoryMapFile(content);
  const workspace = next.theoryMaps!;
  const conflict =
    workspace.documents.some((doc) => doc.id === imported.id) ||
    workspace.deletedMapIds.includes(imported.id) ||
    imported.kind === "global";
  const doc: TheoryMapDocument = {
    ...imported,
    ...(conflict
      ? { id: crypto.randomUUID(), title: imported.title + "（导入副本）" }
      : {}),
    kind: "topic",
    noteIds:
      imported.kind === "global"
        ? next.notes.map((note) => note.id)
        : imported.noteIds,
  };
  return {
    ...next,
    view: "maps",
    theoryMaps: {
      ...workspace,
      activeMapId: doc.id,
      documents: [...workspace.documents, doc],
    },
  };
}

export interface TheoryFileHandle {
  createWritable(): Promise<{
    write(content: string): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
  getFile?(): Promise<File>;
}
export interface TheoryDirectory {
  name: string;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<TheoryFileHandle>;
  removeEntry?(name: string): Promise<void>;
  isSameEntry?(other: TheoryDirectory): Promise<boolean>;
  values?(): AsyncIterableIterator<{
    kind: string;
    name: string;
    getFile?(): Promise<File>;
  }>;
}
export class TheoryMapDirectoryWriter {
  private pending: Promise<void> = Promise.resolve();
  private saved = new Map<string, string>();
  private retired = new Set<string>();
  private removed = new Set<string>();
  readonly directory: TheoryDirectory;
  constructor(directory: TheoryDirectory) {
    this.directory = directory;
  }
  drain(): Promise<void> {
    return this.pending.catch(() => {});
  }
  hasSavedFile(document: TheoryMapDocument): boolean {
    return (
      this.saved.get(theoryMapFilename(document)) ===
      serializeTheoryMapFile(document)
    );
  }
  save(
    documents: TheoryMapDocument[],
    deletedMapIds: string[] = [],
  ): Promise<void> {
    for (const id of deletedMapIds)
      if (id !== "global") this.retired.add(theoryMapFilename({ id }));
    const snapshots = documents.map((doc) => ({
      name: theoryMapFilename(doc),
      content: serializeTheoryMapFile(doc),
    }));
    const task = this.pending
      .catch(() => {})
      .then(async () => {
        if (
          (await this.directory.queryPermission({ mode: "readwrite" })) !==
          "granted"
        )
          throw new Error("需要点击目录按钮重新授权，当前仅保存在浏览器中。");
        for (const name of this.retired) {
          if (this.removed.has(name)) continue;
          if (!this.directory.removeEntry)
            throw new Error("此浏览器无法移除保存目录中的地图文件。");
          try {
            await this.directory.removeEntry(name);
          } catch (reason) {
            if (!(
              reason instanceof DOMException && reason.name === "NotFoundError"
            ))
              throw reason;
          }
          this.removed.add(name);
          this.saved.delete(name);
        }
        for (const { name, content } of snapshots) {
          if (this.retired.has(name)) continue;
          if (this.saved.get(name) === content) continue;
          const handle = await this.directory.getFileHandle(name, {
            create: true,
          });
          const stream = await handle.createWritable();
          try {
            await stream.write(content);
            await stream.close();
            this.saved.set(name, content);
          } catch (error) {
            try {
              await stream.abort?.();
            } catch {
              /* Preserve the original write error. */
            }
            throw error;
          }
        }
      });
    this.pending = task;
    return task;
  }
}

export async function rememberTheoryDirectory(
  handle?: TheoryDirectory,
): Promise<TheoryDirectory | undefined> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("mewiki-theory-map-files", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("handles");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(
        "handles",
        handle ? "readwrite" : "readonly",
      );
      const request = handle
        ? transaction.objectStore("handles").put(handle, "directory")
        : transaction.objectStore("handles").get("directory");
      transaction.oncomplete = () => {
        database.close();
        resolve(handle ?? (request.result as TheoryDirectory | undefined));
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

import { createNotebookFixture as createResearchNotebook } from "../domain/testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import {
  activeTheoryMapDocument,
  addTheoryMapDocument, ensureTheoryMaps, } from "../domain/researchTheoryMap.ts";

import {
  importTheoryMapFile,
  parseTheoryMapFile,
  serializeTheoryMapFile,
  TheoryMapDirectoryWriter,
  theoryMapFilename,
  type TheoryDirectory,
} from "./theoryMapFiles.ts";

describe("theory map file contract", () => {
  it("drains outstanding disk writes before a directory reconnect can start", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const directory: TheoryDirectory = {
      name: "maps",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFileHandle: async () => ({
        createWritable: async () => ({
          write: async () => {
            await gate;
          },
          close: async () => {},
        }),
      }),
    };
    const writer = new TheoryMapDirectoryWriter(directory);
    const saving = writer.save([
      addTheoryMapDocument(ensureTheoryMaps(createResearchNotebook()), "示例地图", ["fixture-definition"]).theoryMaps!.documents[1],
    ]);
    let drained = false;
    const waiting = writer.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await saving;
    await waiting;
    expect(drained).toBe(true);
  });
  it("roundtrips references, layout and metadata without copying note content", () => {
    const state = addTheoryMapDocument(ensureTheoryMaps(createResearchNotebook()), "示例地图", ["fixture-definition"]);
    const doc = {
      ...activeTheoryMapDocument(state),
      id: "custom",
      kind: "topic" as const,
      title: "状态模型",
      noteIds: ["deleted-source"],
      relations: [
        {
          id: "missing",
          source: { noteId: "deleted-source" },
          target: { noteId: "fixture-definition" },
          kind: "assumption" as const,
          description: "保留来源",
        },
      ],
    };
    expect(parseTheoryMapFile(serializeTheoryMapFile(doc))).toEqual(doc);
    expect(
      serializeTheoryMapFile(parseTheoryMapFile(serializeTheoryMapFile(doc))),
    ).toBe(serializeTheoryMapFile(doc));
    expect(theoryMapFilename({ ...doc, title: "改名" })).toBe(
      theoryMapFilename(doc),
    );
    expect(serializeTheoryMapFile(doc)).not.toContain("blocks");
    expect(() => parseTheoryMapFile('{"format":"other","version":1}')).toThrow(
      /地图文件/,
    );
    expect(() =>
      parseTheoryMapFile('{"format":"webbench-theory-map","version":99}'),
    ).toThrow(/版本/);
    expect(() =>
      parseTheoryMapFile(
        JSON.stringify({
          format: "webbench-theory-map",
          version: 1,
          document: {
            ...doc,
            view: { layout: { positions: { bad: { x: "oops", y: 1 } } } },
          },
        }),
      ),
    ).toThrow(/格式/);
  });

  it("imports conflicting IDs as copies and never overwrites the system map", () => {
    const state = addTheoryMapDocument(ensureTheoryMaps(createResearchNotebook()), "示例地图", ["fixture-definition"]);
    const source = state.theoryMaps!.documents[1];
    const imported = importTheoryMapFile(
      state,
      serializeTheoryMapFile({ ...source, title: "外部版本" }),
    );
    expect(
      imported.theoryMaps!.documents.find((doc) => doc.id === source.id)?.title,
    ).toBe(source.title);
    expect(imported.theoryMaps!.documents).toHaveLength(
      state.theoryMaps!.documents.length + 1,
    );
    expect(imported.theoryMaps!.activeMapId).not.toBe(source.id);
    const globalCopy = importTheoryMapFile(
      state,
      serializeTheoryMapFile(activeTheoryMapDocument(state)),
    );
    expect(
      globalCopy.theoryMaps!.documents.filter((doc) => doc.kind === "global"),
    ).toHaveLength(1);
  });

  it("serializes writes and reports permission failures without claiming success", async () => {
    const writes: string[] = [];
    let active = 0;
    const directory: TheoryDirectory = {
      name: "maps",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFileHandle: async () => ({
        createWritable: async () => ({
          write: async (content) => {
            expect(active++).toBe(0);
            writes.push(content);
            await Promise.resolve();
            active--;
          },
          close: async () => {},
        }),
      }),
    };
    const writer = new TheoryMapDirectoryWriter(directory);
    const doc = addTheoryMapDocument(ensureTheoryMaps(createResearchNotebook()), "示例地图", ["fixture-definition"]).theoryMaps!
      .documents[1];
    await Promise.all([
      writer.save([doc]),
      writer.save([{ ...doc, title: "新版" }]),
    ]);
    expect(parseTheoryMapFile(writes.at(-1)!).title).toBe("新版");
    const denied = new TheoryMapDirectoryWriter({
      ...directory,
      queryPermission: async () => "prompt",
    });
    await expect(denied.save([doc])).rejects.toThrow(/授权/);
    let fail = true;
    const failing = new TheoryMapDirectoryWriter({
      ...directory,
      getFileHandle: async () => {
        if (fail) {
          fail = false;
          throw new Error("磁盘写入失败");
        }
        return directory.getFileHandle("file", { create: true });
      },
    });
    await expect(failing.save([doc])).rejects.toThrow(/磁盘/);
    await expect(failing.save([doc])).resolves.toBeUndefined();
  });
  it("removes deleted map files and prevents a queued older snapshot from recreating them", async () => {
    const removed: string[] = [];
    const written: string[] = [];
    const directory: TheoryDirectory = {
      name: "maps",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      removeEntry: async (name) => {
        removed.push(name);
      },
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async () => {
            written.push(name);
          },
          close: async () => {},
        }),
      }),
    };
    const writer = new TheoryMapDirectoryWriter(directory);
    const doc = addTheoryMapDocument(ensureTheoryMaps(createResearchNotebook()), "示例地图", ["fixture-definition"]).theoryMaps!
      .documents[1];
    await Promise.all([writer.save([doc]), writer.save([], [doc.id])]);
    expect(removed).toEqual([theoryMapFilename(doc)]);
    expect(written).toEqual([]);
  });
});

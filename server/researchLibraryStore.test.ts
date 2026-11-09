import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createResearchNotebook } from "../src/domain/researchNotebook.ts";
import {
  parseResearchLibraryFile,
  RESEARCH_LIBRARY_FILENAME,
} from "../src/state/researchLibraryFile.ts";
import { ResearchLibraryStore } from "./researchLibraryStore.ts";

const roots: string[] = [];
async function fixture(limit = 30) {
  const root = await mkdtemp(path.join(tmpdir(), "webbench-library-test-"));
  roots.push(root);
  return {
    root,
    directory: path.join(root, "用户 资料库"),
    store: new ResearchLibraryStore({
      settingsFile: path.join(root, "settings.json"),
      historyLimit: limit,
    }),
  };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("webbench-library-test-")
    )
      throw new Error("Invalid test cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});

describe("local research library storage", () => {
  it("backs up original browser data before switching to a read-back verified local library", async () => {
    const { directory, store } = await fixture();
    const notebook = createResearchNotebook();
    expect(await store.read()).toEqual({ directory: null, file: null });
    expect((await store.inspect(directory)).exists).toBe(false);
    const result = await store.connect({
      directory,
      mode: "create",
      notebook,
      browserBackup: {
        current: JSON.stringify(notebook),
        legacy: "原始旧数据",
      },
    });
    expect(result.file!.notebook).toEqual(notebook);
    expect(
      (
        await parseResearchLibraryFile(
          await readFile(
            path.join(directory, RESEARCH_LIBRARY_FILENAME),
            "utf8",
          ),
        )
      ).notebook,
    ).toEqual(notebook);
    const migrations = await readdir(path.join(directory, "migration-backups"));
    const original = JSON.parse(
      await readFile(
        path.join(directory, "migration-backups", migrations[0]),
        "utf8",
      ),
    );
    expect(original.browser.legacy).toBe("原始旧数据");
    expect(
      (await parseResearchLibraryFile(JSON.stringify(original.snapshot)))
        .notebook,
    ).toEqual(notebook);
    expect((await store.read()).file!.revision).toBe(result.file!.revision);
  });

  it("does not overwrite an existing target and remembers the directory across service restarts", async () => {
    const { root, directory, store } = await fixture();
    const notebook = createResearchNotebook();
    const saved = await store.connect({ directory, mode: "create", notebook });
    await expect(
      store.connect({ directory, mode: "create", notebook }),
    ).rejects.toThrow("已有");
    const restarted = new ResearchLibraryStore({
      settingsFile: path.join(root, "settings.json"),
    });
    expect((await restarted.read()).file!.revision).toBe(saved.file!.revision);
    await expect(store.inspect("relative/path")).rejects.toThrow("完整");
  });

  it("serializes competing writes, rejects stale revisions and retains a recoverable previous version", async () => {
    const { directory, store } = await fixture();
    const notebook = createResearchNotebook();
    const original = (
      await store.connect({ directory, mode: "create", notebook })
    ).file!;
    const edited = structuredClone(notebook);
    edited.notes[0].title = "成功的第一份修改";
    const request = {
      directory,
      baseRevision: original.revision,
      notebook: edited,
    };
    const results = await Promise.allSettled([
      store.save(request),
      store.save(request),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const history = await store.history();
    expect(history).toHaveLength(1);
    const current = (await store.read()).file!;
    const restored = await store.restore({
      directory,
      baseRevision: current.revision,
      filename: history[0].filename,
    });
    expect(restored.file!.notebook).toEqual(notebook);
    expect((await store.history()).length).toBe(2);
  });

  it("rejects writes to a previous binding after another page switches directories", async () => {
    const { root, directory, store } = await fixture();
    const notebook = createResearchNotebook();
    const first = (await store.connect({ directory, mode: "create", notebook }))
      .file!;
    const other = path.join(root, "另一目录");
    await store.connect({ directory: other, mode: "create", notebook });
    await expect(
      store.save({ directory, baseRevision: first.revision, notebook }),
    ).rejects.toThrow("目录已更改");
    expect((await store.read()).directory).toBe(other);
  });

  it("keeps bounded history and preserves current files when an import is invalid", async () => {
    const { directory, store } = await fixture(3);
    const notebook = createResearchNotebook();
    let current = (await store.connect({ directory, mode: "create", notebook }))
      .file!;
    for (let i = 0; i < 5; i++) {
      const next = structuredClone(notebook);
      next.notes[0].title = `历史 ${i}`;
      current = (
        await store.save({
          directory,
          baseRevision: current.revision,
          notebook: next,
        })
      ).file!;
    }
    expect(await store.history()).toHaveLength(3);
    await expect(
      store.importBackup({
        directory,
        baseRevision: current.revision,
        content: "{}",
      }),
    ).rejects.toThrow("备份");
    expect((await store.read()).file!.revision).toBe(current.revision);
    await expect(
      store.restore({
        directory,
        baseRevision: current.revision,
        filename: "../settings.json",
      }),
    ).rejects.toThrow("历史");
  });
  it("preserves the unsaved editor snapshot before restoring a history entry", async () => {
    const { directory, store } = await fixture();
    const notebook = createResearchNotebook();
    const original = (
      await store.connect({ directory, mode: "create", notebook })
    ).file!;
    const current = (
      await store.save({
        directory,
        baseRevision: original.revision,
        notebook: { ...notebook, view: "maps" },
      })
    ).file!;
    const draft = structuredClone(notebook);
    draft.notes[0].title = "未保存的编辑也须保留";
    const history = await store.history();
    await store.restore({
      directory,
      baseRevision: current.revision,
      filename: history[0].filename,
      draft: { notebook: draft, browserBackup: { current: "原始草稿" } },
    });
    const files = await readdir(path.join(directory, "migration-backups"));
    const copies = await Promise.all(
      files.map(async (file) =>
        JSON.parse(
          await readFile(
            path.join(directory, "migration-backups", file),
            "utf8",
          ),
        ),
      ),
    );
    expect(
      copies.some(
        (file) =>
          file.snapshot.notebook.notes[0].title === "未保存的编辑也须保留",
      ),
    ).toBe(true);
  });

  it("pauses on a damaged main file and can explicitly recover history while preserving the damaged bytes", async () => {
    const { directory, store } = await fixture();
    const notebook = createResearchNotebook();
    const original = (
      await store.connect({ directory, mode: "create", notebook })
    ).file!;
    await store.save({
      directory,
      baseRevision: original.revision,
      notebook: { ...notebook, view: "maps" },
    });
    await writeFile(
      path.join(directory, RESEARCH_LIBRARY_FILENAME),
      "损坏原文",
      "utf8",
    );
    expect(await store.read()).toMatchObject({
      directory,
      file: null,
      error: expect.stringContaining("JSON"),
    });
    await expect(
      store.save({ directory, baseRevision: original.revision, notebook }),
    ).rejects.toThrow();
    const history = await store.history();
    const restored = await store.restore({
      directory,
      baseRevision: null,
      filename: history[0].filename,
    });
    expect(restored.file!.notebook).toEqual(notebook);
    const recovery = (
      await readdir(path.join(directory, "migration-backups"))
    ).find((filename) => filename.startsWith("damaged-"))!;
    expect(
      await readFile(
        path.join(directory, "migration-backups", recovery),
        "utf8",
      ),
    ).toBe("损坏原文");
  });
});

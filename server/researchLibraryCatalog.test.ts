import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ResearchLibraryStore } from "./researchLibraryStore.ts";
import { ResearchMediaStore } from "./researchMediaStore.ts";
import { createResearchNotebook } from "../src/domain/researchNotebook.ts";
import { RESEARCH_LIBRARY_FILENAME } from "../src/state/researchLibraryFile.ts";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mewiki-catalog-test-"));
  roots.push(root);
  const settingsFile = path.join(root, "settings.json");
  return {
    root,
    settingsFile,
    store: new ResearchLibraryStore({ settingsFile }),
  };
}
const notebook = (title: string) => {
  const state = createResearchNotebook();
  state.notes[0].title = title;
  return state;
};
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("mewiki-catalog-test-")
    )
      throw new Error("Invalid cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});

describe("independent MeWiki library catalog", () => {
  it("preserves the old default library and adds an independently seeded personal library", async () => {
    const { root, store, settingsFile } = await fixture();
    const old = path.join(root, "Cislunar");
    const original = await store.connect({
      directory: old,
      mode: "create",
      notebook: notebook("Cislunar 原始研究"),
    });
    const before = await readFile(path.join(old, RESEARCH_LIBRARY_FILENAME));
    const personal = await store.registerLibrary({
      name: "个人 Wiki",
      directory: path.join(root, "个人"),
      mode: "create",
      notebook: notebook("个人笔记"),
    });
    expect(personal.id).not.toBe("default");
    expect((await store.read(personal.id)).file!.notebook.notes[0].title).toBe(
      "个人笔记",
    );
    expect((await store.read()).file!.revision).toBe(original.file!.revision);
    expect(await readFile(path.join(old, RESEARCH_LIBRARY_FILENAME))).toEqual(
      before,
    );
    const restarted = new ResearchLibraryStore({ settingsFile });
    expect((await restarted.catalog()).libraries).toHaveLength(2);
    expect((await restarted.read(personal.id)).directory).toBe(
      personal.directory,
    );
  });
  it("pins simultaneous reads, writes, histories and attachments to their requested libraries", async () => {
    const { root, store } = await fixture();
    const a = await store.registerLibrary({
      name: "Cislunar",
      directory: path.join(root, "A"),
      mode: "create",
      notebook: notebook("A"),
    });
    const b = await store.registerLibrary({
      name: "个人",
      directory: path.join(root, "B"),
      mode: "create",
      notebook: notebook("B"),
    });
    const [first, second] = await Promise.all([
      store.read(a.id),
      store.read(b.id),
    ]);
    await Promise.all([
      store.save(
        {
          directory: a.directory!,
          baseRevision: first.file!.revision,
          notebook: notebook("A 的修改"),
        },
        a.id,
      ),
      store.save(
        {
          directory: b.directory!,
          baseRevision: second.file!.revision,
          notebook: notebook("B 的修改"),
        },
        b.id,
      ),
    ]);
    expect((await store.read(a.id)).file!.notebook.notes[0].title).toBe(
      "A 的修改",
    );
    expect((await store.read(b.id)).file!.notebook.notes[0].title).toBe(
      "B 的修改",
    );
    expect(await store.history(a.id)).toHaveLength(1);
    expect(await store.history(b.id)).toHaveLength(1);
    expect(await store.attachmentDirectory(a.directory!)).toBe(a.directory);
    expect(await store.attachmentDirectory(b.directory!)).toBe(b.directory);
    await expect(
      store.save(
        {
          directory: a.directory!,
          baseRevision: first.file!.revision,
          notebook: notebook("不能串写"),
        },
        b.id,
      ),
    ).rejects.toThrow(/目录/);
    await expect(store.read("missing")).rejects.toThrow(/不存在/);
  });
  it("renames and remembers entry defaults while removing only registration, never files", async () => {
    const { root, store } = await fixture();
    const a = await store.registerLibrary({
      name: "实验",
      directory: path.join(root, "A"),
      mode: "create",
      notebook: notebook("A"),
    });
    await store.updateLibrary(a.id, {
      name: "Cislunar",
      context: "org.mewiki.webbench",
      useAsDefault: true,
    });
    expect((await store.catalog()).contextDefaults["org.mewiki.webbench"]).toBe(
      a.id,
    );
    expect(
      (await store.catalog()).libraries.find((item) => item.id === a.id)!.name,
    ).toBe("Cislunar");
    const filename = path.join(a.directory!, RESEARCH_LIBRARY_FILENAME);
    const before = await readFile(filename);
    await store.removeLibrary(a.id);
    expect(await readFile(filename)).toEqual(before);
    expect(
      (await store.catalog()).contextDefaults["org.mewiki.webbench"],
    ).toBeUndefined();
    await expect(store.attachmentDirectory(a.directory!)).rejects.toThrow();
    await expect(store.read(a.id)).rejects.toThrow(/不存在/);
  });
  it("rejects duplicate directories, unknown IDs and opening missing libraries without changing content", async () => {
    const { root, store } = await fixture();
    const request = {
      name: "A",
      directory: path.join(root, "A"),
      mode: "create" as const,
      notebook: notebook("A"),
    };
    const a = await store.registerLibrary(request);
    await expect(
      store.registerLibrary({ ...request, mode: "open", name: "重复" }),
    ).rejects.toThrow(/已.*资料库|重复/);
    await expect(
      store.registerLibrary({
        ...request,
        name: "空目录",
        directory: path.join(root, "missing"),
        mode: "open",
      }),
    ).rejects.toThrow(/没有|不存在/);
    await expect(
      store.updateLibrary("unknown", { name: "不能误改" }),
    ).rejects.toThrow(/不存在/);
    await expect(store.removeLibrary("default")).rejects.toThrow();
    expect((await store.read(a.id)).file!.notebook.notes[0].title).toBe("A");
  });
  it("reads v1 settings without rewriting them or reading a different library", async () => {
    const { root, settingsFile, store } = await fixture();
    const existing = await store.connect({
      directory: path.join(root, "old"),
      mode: "create",
      notebook: notebook("旧资料"),
    });
    const oldSettings = JSON.stringify({
      version: 1,
      directory: existing.directory,
    });
    await writeFile(settingsFile, oldSettings);
    expect((await store.catalog()).libraries[0]).toMatchObject({
      id: "default",
      directory: existing.directory,
    });
    expect(await readFile(settingsFile, "utf8")).toBe(oldSettings);
    expect((await store.read("default")).file!.notebook.notes[0].title).toBe(
      "旧资料",
    );
  });
  it("rejects a registered destination before preparing or copying any attachments", async () => {
    const { root, store } = await fixture();
    const a = await store.registerLibrary({
      name: "A",
      directory: path.join(root, "A"),
      mode: "create",
      notebook: notebook("A"),
    });
    const b = await store.registerLibrary({
      name: "B",
      directory: path.join(root, "B"),
      mode: "create",
      notebook: notebook("B"),
    });
    const media = new ResearchMediaStore(store);
    try {
      await expect(
        media.prepareConnect(
          { directory: b.directory!, mode: "open", notebook: notebook("A") },
          a.id,
        ),
      ).rejects.toThrow(/已属于/);
      expect(
        await stat(path.join(b.directory!, "assets")).catch(() => null),
      ).toBeNull();
      expect(
        await stat(path.join(a.directory!, "assets")).catch(() => null),
      ).toBeNull();
    } finally {
      await media.dispose();
    }
  });
  it("reserves a migration destination against concurrent library registration", async () => {
    const { root, store, settingsFile } = await fixture();
    const a = await store.registerLibrary({
      name: "A",
      directory: path.join(root, "A"),
      mode: "create",
      notebook: notebook("A"),
    });
    const destination = path.join(root, "destination");
    const otherSettings = path.join(root, "other-settings.json");
    await new ResearchLibraryStore({ settingsFile: otherSettings }).connect({
      directory: destination,
      mode: "create",
      notebook: notebook("原目录"),
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let preparing!: () => void;
    const prepared = new Promise<void>((resolve) => {
      preparing = resolve;
    });
    const moving = store.connect(
      { directory: destination, mode: "open", notebook: notebook("A") },
      a.id,
      async (source) => {
        expect(source).toBe(a.directory);
        preparing();
        await gate;
      },
    );
    await prepared;
    try {
      const otherProcess = new ResearchLibraryStore({ settingsFile });
      await expect(
        otherProcess.registerLibrary({
          name: "不能占用迁移目标",
          directory: destination,
          mode: "open",
          notebook: notebook("B"),
        }),
      ).rejects.toThrow(/正在保存/);
    } finally {
      release();
    }
    await moving;
    await expect(
      store.registerLibrary({
        name: "不能重复登记",
        directory: destination,
        mode: "open",
        notebook: notebook("B"),
      }),
    ).rejects.toThrow(/已属于/);
    expect((await store.read(a.id)).directory).toBe(destination);
  });
});

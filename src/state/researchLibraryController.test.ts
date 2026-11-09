import { createNotebookFixture as createResearchNotebook } from "../domain/testUtils/notebook.ts";
import { describe, expect, it } from "vitest";

import {
  createResearchLibraryFile,
  type ResearchLibraryFile,
} from "./researchLibraryFile.ts";
import { ResearchLibraryController } from "./researchLibraryController.ts";
import {
  ResearchLibraryHttpError,
  type ResearchLibraryTransport,
  type LibraryLocation,
} from "./researchLibraryClient.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
async function fixture() {
  let file = await createResearchLibraryFile(createResearchNotebook());
  let saveGate: ReturnType<typeof deferred<void>> | undefined;
  let readGate: ReturnType<typeof deferred<LibraryLocation>> | undefined;
  let error: Error | undefined;
  const writes: string[] = [];
  const client: ResearchLibraryTransport = {
    read: async () =>
      readGate ? await readGate.promise : { directory: "D:/library", file },
    inspect: async (directory) => ({ directory, exists: false, summary: null }),
    connect: async (request) => ({
      directory: request.directory,
      file: await createResearchLibraryFile(request.notebook),
    }),
    save: async (request) => {
      const base = file.revision;
      if (saveGate) await saveGate.promise;
      if (error) throw error;
      if (request.baseRevision !== base)
        throw new ResearchLibraryHttpError("已有新版本", 409);
      file = await createResearchLibraryFile(request.notebook);
      writes.push(file.notebook.notes[0].title);
      return { directory: "D:/library", file };
    },
    history: async () => [],
    restore: async () => ({ directory: "D:/library", file }),
    importBackup: async () => ({ directory: "D:/library", file }),
  };
  const cached: string[] = [];
  const controller = new ResearchLibraryController({
    client,
    state: createResearchNotebook(),
    delay: 60_000,
    cache: {
      write: (state) => {
        cached.push(state.notes[0].title);
      },
      original: () => ({ current: "原始浏览器数据" }),
    },
  });
  const edit = (title: string) =>
    controller.setState((state) => ({
      ...state,
      notes: state.notes.map((note, index) =>
        index ? note : { ...note, title },
      ),
    }));
  return {
    controller,
    edit,
    writes,
    cached,
    file: () => file,
    setFile: (next: ResearchLibraryFile) => {
      file = next;
    },
    blockSave: () => (saveGate = deferred<void>()),
    blockRead: () => (readGate = deferred<LibraryLocation>()),
    fail: (next?: Error) => {
      error = next;
    },
  };
}

describe("research library autosave coordination", () => {
  it("loads the authoritative local file before permitting writes", async () => {
    const f = await fixture();
    const file = await createResearchLibraryFile({
      ...createResearchNotebook(),
      view: "foundations",
    });
    f.setFile(file);
    await f.controller.initialize();
    expect(f.controller.getSnapshot().notebook.view).toBe("foundations");
    expect(f.writes).toEqual([]);
    expect(f.controller.getSnapshot().status).toBe("saved");
    f.controller.dispose();
  });
  it("preserves edits made during a slow initial read and reports the conflict", async () => {
    const f = await fixture();
    const gate = f.blockRead();
    const loading = f.controller.initialize();
    f.edit("启动期间的修改");
    gate.resolve({ directory: "D:/library", file: f.file() });
    await loading;
    expect(f.controller.getSnapshot().notebook.notes[0].title).toBe(
      "启动期间的修改",
    );
    expect(f.controller.getSnapshot().status).toBe("conflict");
    expect(f.writes).toEqual([]);
    f.controller.dispose();
  });
  it("serializes slow autosaves and drains the latest edit instead of losing it", async () => {
    const f = await fixture();
    await f.controller.initialize();
    const gate = f.blockSave();
    f.edit("第一笔修改");
    const saving = f.controller.flush();
    f.edit("写入期间的最新修改");
    gate.resolve();
    await saving;
    expect(f.writes).toEqual(["第一笔修改", "写入期间的最新修改"]);
    expect(f.file().notebook.notes[0].title).toBe("写入期间的最新修改");
    expect(f.controller.getSnapshot().status).toBe("saved");
    f.controller.dispose();
  });
  it("never labels a failed write as saved and can retry after service recovery", async () => {
    const f = await fixture();
    await f.controller.initialize();
    f.fail(new Error("目录无法写入"));
    f.edit("仍在浏览器中的修改");
    await expect(f.controller.flush()).rejects.toThrow("目录无法写入");
    expect(f.controller.getSnapshot().status).toBe("error");
    expect(f.cached).toContain("仍在浏览器中的修改");
    f.fail();
    await f.controller.retry();
    expect(f.file().notebook.notes[0].title).toBe("仍在浏览器中的修改");
    expect(f.controller.getSnapshot().status).toBe("saved");
    f.controller.dispose();
  });
  it("keeps current drafts when another page commits a different version", async () => {
    const f = await fixture();
    await f.controller.initialize();
    f.edit("当前页面未保存");
    const next = createResearchNotebook();
    next.notes[0].title = "其他页面的新版本";
    f.setFile(await createResearchLibraryFile(next));
    await f.controller.synchronize();
    expect(f.controller.getSnapshot().status).toBe("conflict");
    expect(f.controller.getSnapshot().notebook.notes[0].title).toBe(
      "当前页面未保存",
    );
    expect(f.writes).toEqual([]);
    f.controller.dispose();
  });
  it("recognizes a committed write after a lost response and safely saves later edits", async () => {
    const f = await fixture();
    await f.controller.initialize();
    f.edit("已写入但回执丢失");
    const committed = await createResearchLibraryFile(
      f.controller.getSnapshot().notebook,
    );
    f.fail(new Error("连接断开"));
    await expect(f.controller.flush()).rejects.toThrow();
    f.setFile(committed);
    f.edit("后续编辑");
    f.fail();
    await f.controller.retry();
    expect(f.controller.getSnapshot().status).toBe("saved");
    expect(f.file().notebook.notes[0].title).toBe("后续编辑");
    f.controller.dispose();
  });
  it("reports saved after all pending changes are reverted", async () => {
    const f = await fixture();
    await f.controller.initialize();
    const original = f.controller.getSnapshot().notebook.notes[0].title;
    f.edit("临时修改");
    f.edit(original);
    await f.controller.flush();
    expect(f.controller.getSnapshot().status).toBe("saved");
    expect(f.writes).toEqual([]);
    f.controller.dispose();
  });
  it("resumes an interrupted cached save only when its original disk revision still matches", async () => {
    const f = await fixture();
    const draft = structuredClone(f.file().notebook);
    draft.notes[0].title = "页面关闭前的待保存修改";
    const controller = new ResearchLibraryController({
      state: draft,
      client: f.controller.client,
      delay: 60_000,
      recovery: {
        directory: "D:/library",
        baseRevision: f.file().revision,
        notebook: draft,
      },
      cache: { write: () => {}, original: () => null },
    });
    await controller.initialize();
    expect(controller.getSnapshot().status).toBe("pending");
    await controller.flush();
    expect(f.file().notebook.notes[0].title).toBe("页面关闭前的待保存修改");
    controller.dispose();
    f.controller.dispose();
  });
  it("preserves a pending recovery through an initial service failure and saves it on retry", async () => {
    const f = await fixture();
    const draft = structuredClone(f.file().notebook);
    draft.notes[0].title = "服务恢复后仍应保留的草稿";
    const transport = f.controller.client;
    let offline = true;
    const controller = new ResearchLibraryController({
      state: draft,
      client: {
        ...transport,
        read: async () => {
          if (offline) throw new Error("暂时离线");
          return transport.read();
        },
      },
      recovery: {
        directory: "D:/library",
        baseRevision: f.file().revision,
        notebook: draft,
      },
      delay: 60_000,
      cache: { write: () => {}, original: () => null },
    });
    await controller.initialize();
    expect(controller.getSnapshot().status).toBe("error");
    offline = false;
    await controller.retry();
    expect(controller.getSnapshot().notebook.notes[0].title).toBe(
      draft.notes[0].title,
    );
    await controller.flush();
    expect(f.file().notebook.notes[0].title).toBe(draft.notes[0].title);
    controller.dispose();
    f.controller.dispose();
  });
  it("keeps the original recovery baseline when another window has saved a newer disk revision", async () => {
    const f = await fixture();
    const base = f.file();
    const draft = structuredClone(base.notebook);
    draft.notes[0].title = "不能覆盖新版本的旧草稿";
    const newer = structuredClone(base.notebook);
    newer.notes[0].title = "另一窗口的新版本";
    f.setFile(await createResearchLibraryFile(newer));
    const controller = new ResearchLibraryController({
      state: draft,
      client: f.controller.client,
      recovery: {
        directory: "D:/library",
        baseRevision: base.revision,
        notebook: draft,
      },
      cache: { write: () => {}, original: () => null },
    });
    await controller.initialize();
    expect(controller.getSnapshot().status).toBe("conflict");
    await expect(controller.retry()).rejects.toThrow(/新版本/);
    expect(controller.getSnapshot().notebook.notes[0].title).toBe(
      draft.notes[0].title,
    );
    expect(f.file().notebook.notes[0].title).toBe(newer.notes[0].title);
    expect(f.writes).toEqual([]);
    controller.dispose();
    f.controller.dispose();
  });
  it("rejects disk-cache storage events while a recovery is waiting for its initial read", async () => {
    const f = await fixture();
    const draft = structuredClone(f.file().notebook);
    draft.notes[0].title = "等待恢复的独立草稿";
    const transport = f.controller.client;
    let offline = true;
    const controller = new ResearchLibraryController({
      state: draft,
      client: {
        ...transport,
        read: async () => {
          if (offline) throw new Error("暂时离线");
          return transport.read();
        },
      },
      recovery: {
        directory: "D:/library",
        baseRevision: f.file().revision,
        notebook: draft,
      },
      cache: { write: () => {}, original: () => null },
    });
    await controller.initialize();
    controller.acceptBrowserState(f.file().notebook);
    offline = false;
    await controller.retry();
    expect(controller.getSnapshot().notebook.notes[0].title).toBe(
      draft.notes[0].title,
    );
    expect(f.file().notebook.notes[0].title).toBe(draft.notes[0].title);
    controller.dispose();
    f.controller.dispose();
  });
  it("ignores a slow synchronization response after newer editing has already saved", async () => {
    const f = await fixture();
    await f.controller.initialize();
    const old = f.file();
    const gate = f.blockRead();
    const reading = f.controller.synchronize();
    f.edit("读取期间已成功保存的新内容");
    await f.controller.flush();
    gate.resolve({ directory: "D:/library", file: old });
    await reading;
    expect(f.controller.getSnapshot().notebook.notes[0].title).toBe(
      "读取期间已成功保存的新内容",
    );
    expect(f.controller.getSnapshot().status).toBe("saved");
    f.controller.dispose();
  });
  it("ignores an initial response that belongs to a directory selected before a completed connection", async () => {
    const f = await fixture();
    const old = f.file();
    const gate = f.blockRead();
    const loading = f.controller.initialize();
    await f.controller.connect("D:/new-library", "create");
    gate.resolve({ directory: "D:/library", file: old });
    await loading;
    expect(f.controller.getSnapshot().directory).toBe("D:/new-library");
    f.controller.dispose();
  });
  it("retains a browser update arriving while an unconfigured local service is still being read", async () => {
    const f = await fixture();
    const gate = f.blockRead();
    const loading = f.controller.initialize();
    const otherPage = createResearchNotebook();
    otherPage.notes[0].title = "另一页面刚保存的浏览器内容";
    f.controller.acceptBrowserState(otherPage);
    gate.resolve({ directory: null, file: null });
    await loading;
    expect(f.controller.getSnapshot().notebook.notes[0].title).toBe(
      "另一页面刚保存的浏览器内容",
    );
    f.controller.dispose();
  });
});

import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { ResearchNotebookState } from "../src/domain/researchNotebook.ts";
import type {
  LibraryCatalog,
  LibraryProfile,
} from "../src/state/researchLibraryCatalog.ts";
interface LibrarySettings {
  version: 2;
  directory: string | null;
  name: string;
  libraries: LibraryProfile[];
  contextDefaults: Record<string, string>;
}
import {
  createResearchLibraryFile,
  parseResearchLibraryFile,
  RESEARCH_LIBRARY_FILENAME,
  researchLibrarySummary,
  type ResearchLibraryFile,
  type ResearchLibrarySummary,
} from "../src/state/researchLibraryFile.ts";

export class ResearchLibraryError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export interface LibraryLocation {
  directory: string | null;
  file: ResearchLibraryFile | null;
  error?: string;
}
export interface LibraryHistoryEntry extends ResearchLibrarySummary {
  filename: string;
}
interface SaveRequest {
  directory: string;
  baseRevision: string | null;
  notebook: ResearchNotebookState;
}
interface DraftBackup {
  notebook: ResearchNotebookState;
  browserBackup?: unknown;
}

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "无法读取本地资料库。";
const serialize = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** The temporary file and final file share a directory, so replacement is atomic. */
async function atomicWrite(filename: string, content: string) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class ResearchLibraryStore {
  private readonly settingsFile: string;
  private readonly historyLimit: number;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(options: { settingsFile: string; historyLimit?: number }) {
    this.settingsFile = path.resolve(options.settingsFile);
    this.historyLimit = options.historyLimit ?? 30;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  /** Also prevents two running WebBench services from racing over the same setting. */
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(path.dirname(this.settingsFile), { recursive: true });
    const lockname = this.settingsFile + ".lock";
    const acquire = async () => {
      try {
        return await open(lockname, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let stale = false;
        try {
          const lock = JSON.parse(await readFile(lockname, "utf8")) as {
            pid: number;
          };
          if (Number.isInteger(lock.pid) && lock.pid > 0) {
            try {
              process.kill(lock.pid, 0);
            } catch (cause) {
              stale = (cause as NodeJS.ErrnoException).code === "ESRCH";
            }
          }
        } catch {
          /* Another process may still be creating its lock. */
        }
        if (stale) {
          await rm(lockname, { force: true });
          return await open(lockname, "wx");
        }
        throw new ResearchLibraryError(
          "另一个工作台服务正在保存资料库，请稍后重试。",
          409,
        );
      }
    };
    const lock = await acquire();
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }), "utf8");
      return await operation();
    } finally {
      await lock.close();
      await rm(lockname, { force: true });
    }
  }
  private mutate<T>(operation: () => Promise<T>) {
    return this.serial(() => this.exclusive(operation));
  }
  private directory(value: string): string {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      !path.isAbsolute(value.trim())
    )
      throw new ResearchLibraryError("请输入本机文件夹的完整绝对路径。");
    return path.resolve(value.trim());
  }
  private async settings(): Promise<LibrarySettings> {
    let content: string;
    try {
      content = await readFile(this.settingsFile, "utf8");
    } catch (error) {
      if (isMissing(error))
        return {
          version: 2,
          directory: null,
          name: "浏览器资料库",
          libraries: [],
          contextDefaults: {},
        };
      throw error;
    }
    const value = JSON.parse(content) as LibrarySettings;
    if (Number(value.version) === 1)
      return {
        version: 2,
        directory: this.directory(value.directory!),
        name: "原资料库",
        libraries: [],
        contextDefaults: {},
      };
    if (
      value.version !== 2 ||
      !Array.isArray(value.libraries) ||
      !value.contextDefaults ||
      typeof value.contextDefaults !== "object" ||
      Array.isArray(value.contextDefaults)
    )
      throw new ResearchLibraryError("本地保存设置版本不受支持。");
    const ids = new Set(["default"]);
    const libraries = value.libraries.map((item) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) ||
        ids.has(item.id)
      )
        throw new ResearchLibraryError("资料库标识无效或重复。");
      ids.add(item.id);
      return {
        id: item.id,
        name: this.libraryName(item.name),
        directory: this.directory(item.directory!),
      };
    });
    for (const [context, id] of Object.entries(value.contextDefaults)) {
      if (!/^[a-zA-Z0-9._-]{1,128}$/.test(context) || !ids.has(id))
        throw new ResearchLibraryError("资料库入口设置无效。");
    }
    return {
      version: 2,
      name: this.libraryName(value.name),
      directory:
        value.directory === null ? null : this.directory(value.directory),
      libraries,
      contextDefaults: value.contextDefaults,
    };
  }
  private libraryName(value: string): string {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
      throw new ResearchLibraryError("资料库名称应为 1 至 100 个字符。");
    return value.trim();
  }
  private profile(settings: LibrarySettings, id = "default"): LibraryProfile {
    if (id === "default")
      return { id, name: settings.name, directory: settings.directory };
    const profile = settings.libraries.find((item) => item.id === id);
    if (!profile)
      throw new ResearchLibraryError("资料库不存在或已从列表移除。", 404);
    return profile;
  }
  private async configured(id = "default"): Promise<string | null> {
    return this.profile(await this.settings(), id).directory;
  }
  catalog(): Promise<LibraryCatalog> {
    return this.serial(async () => {
      const settings = await this.settings();
      return {
        libraries: [this.profile(settings), ...settings.libraries],
        contextDefaults: settings.contextDefaults,
      };
    });
  }
  private async assertUniqueDirectory(
    settings: LibrarySettings,
    directory: string,
    exceptId?: string,
  ) {
    const key = async (value: string) => {
      let resolved = value;
      try {
        resolved = await realpath(value);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    const target = await key(directory);
    for (const item of [this.profile(settings), ...settings.libraries]) {
      if (
        item.id !== exceptId &&
        item.directory &&
        (await key(item.directory)) === target
      )
        throw new ResearchLibraryError(
          "此目录已属于另一个资料库，请从列表中选择，或修改该资料库的名称。",
          409,
        );
    }
  }
  registerLibrary(request: {
    name: string;
    directory: string;
    mode: "create" | "open";
    notebook: ResearchNotebookState;
  }): Promise<LibraryProfile> {
    return this.mutate(async () => {
      const settings = await this.settings();
      const name = this.libraryName(request.name);
      const directory = this.directory(request.directory);
      await this.assertUniqueDirectory(settings, directory);
      const target = await this.inspect(directory);
      if (request.mode !== "create" && request.mode !== "open")
        throw new ResearchLibraryError("请选择新建或添加已有资料库。");
      if (request.mode === "create" && target.exists)
        throw new ResearchLibraryError(
          "此目录已有资料库，请选择添加已有资料库。",
          409,
        );
      if (request.mode === "open" && !target.exists)
        throw new ResearchLibraryError("此目录没有资料库。", 409);
      if (request.mode === "create")
        await atomicWrite(
          path.join(directory, RESEARCH_LIBRARY_FILENAME),
          serialize(await createResearchLibraryFile(request.notebook)),
        );
      await this.file(directory);
      const profile = { id: crypto.randomUUID(), name, directory };
      settings.libraries.push(profile);
      await atomicWrite(this.settingsFile, serialize(settings));
      return profile;
    });
  }
  async validateConnection(directory: string, libraryId = "default") {
    const settings = await this.settings();
    this.profile(settings, libraryId);
    await this.assertUniqueDirectory(
      settings,
      this.directory(directory),
      libraryId,
    );
  }
  updateLibrary(
    id: string,
    patch: { name?: string; context?: string; useAsDefault?: boolean },
  ): Promise<LibraryCatalog> {
    return this.mutate(async () => {
      const settings = await this.settings();
      const profile = this.profile(settings, id);
      if (patch.name !== undefined) profile.name = this.libraryName(patch.name);
      if (id === "default") settings.name = profile.name;
      if (patch.context !== undefined) {
        if (
          !/^[a-zA-Z0-9._-]{1,128}$/.test(patch.context) ||
          typeof patch.useAsDefault !== "boolean"
        )
          throw new ResearchLibraryError("资料库入口设置无效。");
        if (patch.useAsDefault) settings.contextDefaults[patch.context] = id;
        else if (settings.contextDefaults[patch.context] === id)
          delete settings.contextDefaults[patch.context];
      }
      await atomicWrite(this.settingsFile, serialize(settings));
      return {
        libraries: [this.profile(settings), ...settings.libraries],
        contextDefaults: settings.contextDefaults,
      };
    });
  }
  removeLibrary(id: string): Promise<LibraryCatalog> {
    return this.mutate(async () => {
      const settings = await this.settings();
      this.profile(settings, id);
      if (id === "default")
        throw new ResearchLibraryError(
          "原资料库不能从列表移除，可修改名称或连接保存目录。",
        );
      settings.libraries = settings.libraries.filter((item) => item.id !== id);
      settings.contextDefaults = Object.fromEntries(
        Object.entries(settings.contextDefaults).filter(
          ([, value]) => value !== id,
        ),
      );
      await atomicWrite(this.settingsFile, serialize(settings));
      return {
        libraries: [this.profile(settings), ...settings.libraries],
        contextDefaults: settings.contextDefaults,
      };
    });
  }
  private async binding(
    expected: string,
    libraryId = "default",
  ): Promise<string> {
    const directory = await this.configured(libraryId);
    if (!directory || directory !== this.directory(expected))
      throw new ResearchLibraryError(
        "保存目录已更改，请重新读取本地资料库后继续。",
        409,
      );
    return directory;
  }
  /** Attachments share the configured library binding, but never enter notebook JSON. */
  async attachmentDirectory(expected: string): Promise<string> {
    const settings = await this.settings();
    const directory = this.directory(expected);
    const profile = [this.profile(settings), ...settings.libraries].find(
      (item) => item.directory === directory,
    );
    if (!profile?.directory)
      throw new ResearchLibraryError(
        "附件目录已更改或资料库已从列表移除。",
        409,
      );
    return profile.directory;
  }
  private async file(directory: string) {
    try {
      return await parseResearchLibraryFile(
        await readFile(path.join(directory, RESEARCH_LIBRARY_FILENAME), "utf8"),
      );
    } catch (error) {
      if (isMissing(error))
        throw new ResearchLibraryError(
          "本地资料库文件不存在，已暂停自动保存。可从历史版本或完整备份恢复。",
        );
      throw error;
    }
  }
  read(libraryId = "default"): Promise<LibraryLocation> {
    return this.serial(async () => {
      const directory = await this.configured(libraryId);
      if (!directory) return { directory: null, file: null };
      try {
        return { directory, file: await this.file(directory) };
      } catch (error) {
        return { directory, file: null, error: message(error) };
      }
    });
  }
  async inspect(input: string) {
    const directory = this.directory(input);
    try {
      await stat(path.join(directory, RESEARCH_LIBRARY_FILENAME));
      const file = await this.file(directory);
      return { directory, exists: true, summary: researchLibrarySummary(file) };
    } catch (error) {
      if (isMissing(error)) return { directory, exists: false, summary: null };
      throw error;
    }
  }
  private async migrationBackup(
    directory: string,
    notebook: ResearchNotebookState,
    browser: unknown,
  ) {
    const snapshot = await createResearchLibraryFile(notebook);
    // Raw strings preserve older formats and any fields that migration does not understand.
    const content = serialize({
      format: "webbench-browser-migration",
      version: 1,
      createdAt: new Date().toISOString(),
      browser: browser ?? null,
      snapshot,
    });
    const filename = path.join(
      directory,
      "migration-backups",
      `browser-${Date.now()}-${crypto.randomUUID()}.json`,
    );
    await atomicWrite(filename, content);
    const verified = JSON.parse(await readFile(filename, "utf8")) as {
      snapshot: ResearchLibraryFile;
    };
    await parseResearchLibraryFile(JSON.stringify(verified.snapshot));
  }
  connect(
    request: {
      directory: string;
      mode: "create" | "open";
      notebook: ResearchNotebookState;
      browserBackup?: unknown;
    },
    libraryId = "default",
    prepare?: (sourceDirectory: string | null) => Promise<void>,
  ): Promise<LibraryLocation> {
    return this.mutate(async () => {
      const settings = await this.settings();
      const profile = this.profile(settings, libraryId);
      const directory = this.directory(request.directory);
      await this.assertUniqueDirectory(settings, directory, libraryId);
      const target = await this.inspect(directory);
      if (request.mode !== "create" && request.mode !== "open")
        throw new ResearchLibraryError("请选择创建或打开资料库。");
      if (request.mode === "create" && target.exists)
        throw new ResearchLibraryError(
          "该目录已有资料库，请选择打开，已停止覆盖。",
          409,
        );
      if (request.mode === "open" && !target.exists)
        throw new ResearchLibraryError("该目录没有资料库，请先检查路径。", 409);
      // Keep directory registration and attachment preparation under the same cross-process lock.
      // Pass the source directly so the preparer does not re-enter this store's serial read queue.
      await prepare?.(profile.directory);
      await this.migrationBackup(
        directory,
        request.notebook,
        request.browserBackup,
      );
      if (!target.exists) {
        const file = await createResearchLibraryFile(request.notebook);
        await atomicWrite(
          path.join(directory, RESEARCH_LIBRARY_FILENAME),
          serialize(file),
        );
      }
      const file = await this.file(directory);
      // The binding changes only after both the browser backup and the main file can be read back.
      if (libraryId === "default") settings.directory = directory;
      else profile.directory = directory;
      await atomicWrite(this.settingsFile, serialize(settings));
      return { directory, file };
    });
  }
  private async archive(directory: string, file: ResearchLibraryFile) {
    const filename = `${file.savedAt.replaceAll(":", "-")}-${file.revision}.webbench.json`;
    await atomicWrite(
      path.join(directory, "history", filename),
      serialize(file),
    );
  }
  private async prune(directory: string) {
    const history = (await this.listHistory(directory)).sort(
      (a, b) =>
        b.savedAt.localeCompare(a.savedAt) ||
        b.filename.localeCompare(a.filename),
    );
    for (const entry of history.slice(this.historyLimit))
      await rm(path.join(directory, "history", entry.filename));
  }
  private async replace(
    request: SaveRequest,
    recovery = false,
    libraryId = "default",
  ): Promise<LibraryLocation> {
    const directory = await this.binding(request.directory, libraryId);
    let current: ResearchLibraryFile | null = null;
    try {
      current = await this.file(directory);
    } catch (error) {
      if (!recovery || request.baseRevision !== null) throw error;
      try {
        const damaged = await readFile(
          path.join(directory, RESEARCH_LIBRARY_FILENAME),
          "utf8",
        );
        await atomicWrite(
          path.join(
            directory,
            "migration-backups",
            `damaged-${Date.now()}-${crypto.randomUUID()}.json`,
          ),
          damaged,
        );
      } catch (cause) {
        if (!isMissing(cause)) throw cause;
      }
    }
    if ((current?.revision ?? null) !== request.baseRevision)
      throw new ResearchLibraryError(
        "本地资料库已有新版本，当前修改尚未写入。请先导出当前修改，再读取本地版本。",
        409,
      );
    const next = await createResearchLibraryFile(request.notebook);
    if (current) await this.archive(directory, current);
    await atomicWrite(
      path.join(directory, RESEARCH_LIBRARY_FILENAME),
      serialize(next),
    );
    const verified = await this.file(directory);
    if (verified.revision !== next.revision)
      throw new ResearchLibraryError("保存后回读校验失败，请检查目录。", 500);
    await this.prune(directory);
    return { directory, file: verified };
  }
  save(request: SaveRequest, libraryId = "default"): Promise<LibraryLocation> {
    if (!request.baseRevision)
      return Promise.reject(
        new ResearchLibraryError("缺少本地修订号，已停止自动覆盖。", 409),
      );
    return this.mutate(() => this.replace(request, false, libraryId));
  }
  private historyName(filename: string) {
    if (
      typeof filename !== "string" ||
      !/^[\w.-]+\.webbench\.json$/.test(filename) ||
      filename.includes("..")
    )
      throw new ResearchLibraryError("历史版本名称无效。");
    return filename;
  }
  private async listHistory(directory: string): Promise<LibraryHistoryEntry[]> {
    let filenames: string[];
    try {
      filenames = await readdir(path.join(directory, "history"));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const entries: LibraryHistoryEntry[] = [];
    for (const filename of filenames) {
      if (!filename.endsWith(".webbench.json")) continue;
      // A damaged history file stays on disk but is never offered as a valid recovery point.
      try {
        this.historyName(filename);
        const file = await parseResearchLibraryFile(
          await readFile(path.join(directory, "history", filename), "utf8"),
        );
        entries.push({ filename, ...researchLibrarySummary(file) });
      } catch {
        /* Leave the invalid file for diagnosis. */
      }
    }
    return entries.sort(
      (a, b) =>
        b.savedAt.localeCompare(a.savedAt) ||
        b.filename.localeCompare(a.filename),
    );
  }
  history(libraryId = "default"): Promise<LibraryHistoryEntry[]> {
    return this.serial(async () => {
      const directory = await this.configured(libraryId);
      return directory ? await this.listHistory(directory) : [];
    });
  }
  restore(
    request: {
      directory: string;
      baseRevision: string | null;
      filename: string;
      draft?: DraftBackup;
    },
    libraryId = "default",
  ): Promise<LibraryLocation> {
    return this.mutate(async () => {
      const directory = await this.binding(request.directory, libraryId);
      const file = await parseResearchLibraryFile(
        await readFile(
          path.join(directory, "history", this.historyName(request.filename)),
          "utf8",
        ),
      );
      if (request.draft)
        await this.migrationBackup(
          directory,
          request.draft.notebook,
          request.draft.browserBackup,
        );
      return await this.replace(
        { ...request, notebook: file.notebook },
        true,
        libraryId,
      );
    });
  }
  importBackup(
    request: {
      directory: string;
      baseRevision: string | null;
      content: string;
      draft?: DraftBackup;
    },
    libraryId = "default",
  ): Promise<LibraryLocation> {
    return this.mutate(async () => {
      const file = await parseResearchLibraryFile(request.content);
      if (request.draft)
        await this.migrationBackup(
          await this.binding(request.directory, libraryId),
          request.draft.notebook,
          request.draft.browserBackup,
        );
      return await this.replace(
        { ...request, notebook: file.notebook },
        true,
        libraryId,
      );
    });
  }
}

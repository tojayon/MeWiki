import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import { createResearchLibraryFile } from "./researchLibraryFile.ts";
import {
  ResearchLibraryHttpError,
  type ResearchLibraryTransport,
  type LibraryLocation,
} from "./researchLibraryClient.ts";

export type LibrarySaveStatus =
  "loading" | "browser" | "saved" | "pending" | "saving" | "error" | "conflict";
export interface ResearchLibrarySnapshot {
  notebook: ResearchNotebookState;
  directory: string | null;
  status: LibrarySaveStatus;
  savedAt: string | null;
  error: string;
  cacheError: string;
  busy: boolean;
}
interface Options {
  state: ResearchNotebookState;
  client: ResearchLibraryTransport;
  cache: {
    write(state: ResearchNotebookState): void;
    read?(): ResearchNotebookState;
    original(): unknown;
    preserve?(state: ResearchNotebookState): void;
    pending?(recovery: LibraryPendingRecovery | null): void;
  };
  recovery?: LibraryPendingRecovery;
  delay?: number;
  notify?(location: LibraryLocation): void;
  prepareMedia?(
    directory: string,
    notebook: ResearchNotebookState,
    sourceDirectory: string | null,
  ): Promise<string | undefined>;
}
export interface LibraryPendingRecovery {
  directory: string;
  baseRevision: string;
  notebook: ResearchNotebookState;
}
const key = (state: ResearchNotebookState) =>
  JSON.stringify({ ...state, open: false });
const reason = (error: unknown) =>
  error instanceof Error ? error.message : "本地资料库操作失败。";

/** Coordinates editing and durable writes independently of React rendering. */
export class ResearchLibraryController {
  readonly client: ResearchLibraryTransport;
  private readonly options: Options;
  private value: ResearchLibrarySnapshot;
  private readonly listeners = new Set<() => void>();
  private revision: string | null = null;
  private savedKey = "";
  private attemptedKey = "";
  private dirty = false;
  private initialized = false;
  private initialReadFailed = false;
  private initialization: Promise<void> | null = null;
  private blocked = false;
  private generation = 0;
  private connectionGeneration = 0;
  private incomingBrowserState: ResearchNotebookState | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  constructor(options: Options) {
    this.options = options;
    this.dirty = Boolean(options.recovery);
    this.client = options.client;
    this.value = {
      notebook: options.state,
      directory: null,
      status: "loading",
      savedAt: null,
      error: "",
      cacheError: "",
      busy: false,
    };
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(patch: Partial<ResearchLibrarySnapshot>) {
    this.value = { ...this.value, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private cache(state: ResearchNotebookState) {
    try {
      this.options.cache.write(state);
      if (this.value.cacheError) this.patch({ cacheError: "" });
    } catch {
      this.patch({
        cacheError: "浏览器缓存写入失败，请保持页面打开并导出完整备份。",
      });
    }
  }
  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private rememberPending() {
    try {
      this.options.cache.pending?.(
        this.dirty && this.value.directory && this.revision
          ? {
              directory: this.value.directory,
              baseRevision: this.revision,
              notebook: this.value.notebook,
            }
          : null,
      );
    } catch {
      this.patch({
        cacheError:
          "待保存修改未能写入浏览器缓存，请保持页面打开并导出完整备份。",
      });
    }
  }
  private schedule() {
    this.cancelTimer();
    if (
      !this.initialized ||
      !this.value.directory ||
      !this.dirty ||
      this.blocked ||
      this.value.busy
    )
      return;
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, this.options.delay ?? 600);
  }
  setState = (
    update:
      | ResearchNotebookState
      | ((previous: ResearchNotebookState) => ResearchNotebookState),
  ) => {
    const previous = this.value.notebook;
    const next = typeof update === "function" ? update(previous) : update;
    if (next === previous) return;
    const changed = key(previous) !== key(next);
    this.patch({ notebook: next });
    this.cache(next);
    if (!changed) return;
    this.generation++;
    this.dirty = key(next) !== this.savedKey;
    if (
      this.initialized &&
      this.value.directory &&
      !this.blocked &&
      !this.value.busy
    )
      this.patch({
        status: this.inFlight ? "saving" : this.dirty ? "pending" : "saved",
      });
    this.rememberPending();
    this.schedule();
  };
  /** Browser storage synchronizes unbound notebooks; bound libraries sync from disk. */
  acceptBrowserState(state: ResearchNotebookState) {
    // An unresolved local recovery is not an unbound browser notebook.
    if (this.options.recovery && this.dirty) return;
    if (!this.initialized) {
      this.incomingBrowserState = state;
      return;
    }
    if (this.value.directory) return;
    this.patch({ notebook: state });
  }
  initialize(): Promise<void> {
    return (this.initialization ??= this.loadInitial());
  }
  private async loadInitial() {
    const generation = this.generation;
    const connection = this.connectionGeneration;
    try {
      const location = await this.client.read();
      if (connection !== this.connectionGeneration) return;
      this.initialized = true;
      this.initialReadFailed = Boolean(location.error);
      if (location.error) {
        this.blocked = true;
        this.patch({
          directory: location.directory,
          status: "error",
          error: location.error,
        });
      } else if (location.file) {
        this.revision = location.file.revision;
        this.savedKey = key(location.file.notebook);
        const recovery = this.options.recovery;
        if (
          recovery &&
          key(this.value.notebook) !== this.savedKey &&
          location.directory === recovery.directory &&
          location.file.revision === recovery.baseRevision &&
          this.generation === generation
        ) {
          this.dirty = true;
          this.blocked = false;
          this.patch({
            directory: location.directory,
            savedAt: location.file.savedAt,
            status: "pending",
            error: "",
          });
          this.schedule();
        } else if (
          (this.generation !== generation || recovery || this.dirty) &&
          key(this.value.notebook) !== this.savedKey
        ) {
          this.dirty = true;
          this.blocked = true;
          // Keep the draft's actual baseline; the new disk revision is not permission to overwrite it.
          this.revision = recovery?.baseRevision ?? null;
          this.savedKey = "";
          this.patch({
            directory: recovery?.directory ?? location.directory,
            savedAt: location.file.savedAt,
            status: "conflict",
            error:
              "读取本地资料库期间发生了编辑，当前修改已保留。请先导出当前修改，再读取本地版本。",
          });
        } else this.adopt(location);
      } else if (this.options.recovery) {
        this.blocked = true;
        this.patch({
          directory: this.options.recovery.directory,
          status: "conflict",
          error:
            "原资料库连接已更改，待保存修改已保留。请先导出当前修改，再重新检查保存位置。",
        });
      } else {
        const latest = this.options.cache.read?.() ?? this.incomingBrowserState;
        if (latest && this.generation === generation)
          this.patch({ notebook: latest });
        this.incomingBrowserState = undefined;
        this.blocked = false;
        this.patch({ status: "browser", directory: null, error: "" });
        this.cache(this.value.notebook);
      }
    } catch (error) {
      if (connection !== this.connectionGeneration) return;
      this.initialized = true;
      this.initialReadFailed = true;
      this.blocked = true;
      this.patch({ status: "error", error: reason(error) });
    }
  }
  private adopt(location: LibraryLocation) {
    if (!location.file)
      throw new Error(location.error ?? "本地资料库未能读取。");
    const notebook = {
      ...location.file.notebook,
      open: this.value.notebook.open,
    };
    if (this.dirty) this.options.cache.preserve?.(this.value.notebook);
    this.revision = location.file.revision;
    this.savedKey = key(notebook);
    this.attemptedKey = "";
    this.dirty = false;
    this.blocked = false;
    this.initialReadFailed = false;
    this.patch({
      notebook,
      directory: location.directory,
      status: "saved",
      savedAt: location.file.savedAt,
      error: "",
    });
    this.cache(notebook);
    this.rememberPending();
  }
  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.inFlight) {
      await this.inFlight;
      return await this.flush();
    }
    if (
      !this.initialized ||
      !this.value.directory ||
      !this.dirty ||
      this.value.busy
    )
      return;
    if (this.blocked || !this.revision)
      throw new Error(
        this.value.error || "自动保存已暂停，请先读取本地资料库。",
      );
    const notebook = structuredClone(this.value.notebook);
    const directory = this.value.directory;
    const baseRevision = this.revision;
    const submittedKey = key(notebook);
    this.attemptedKey = submittedKey;
    this.patch({ status: "saving", error: "" });
    const saving = (async () => {
      try {
        const location = await this.client.save({
          directory,
          baseRevision,
          notebook,
        });
        if (!location.file) throw new Error("保存后未能回读资料库。");
        this.revision = location.file.revision;
        this.savedKey = submittedKey;
        this.attemptedKey = "";
        this.dirty = key(this.value.notebook) !== submittedKey;
        this.patch({
          savedAt: location.file.savedAt,
          status: this.dirty ? "pending" : "saved",
          error: "",
        });
        this.options.notify?.(location);
        this.rememberPending();
      } catch (error) {
        this.blocked = true;
        this.patch({
          status:
            error instanceof ResearchLibraryHttpError && error.status === 409
              ? "conflict"
              : "error",
          error: reason(error),
        });
        throw error;
      }
    })();
    this.inFlight = saving;
    try {
      await saving;
    } finally {
      if (this.inFlight === saving) this.inFlight = null;
    }
    if (this.dirty && !this.blocked) await this.flush();
  }
  async synchronize() {
    if (!this.initialized || this.inFlight || this.value.busy) return;
    const generation = this.generation;
    const revision = this.revision;
    const connection = this.connectionGeneration;
    const current = () =>
      generation === this.generation &&
      revision === this.revision &&
      connection === this.connectionGeneration &&
      !this.inFlight &&
      !this.value.busy;
    try {
      const location = await this.client.read();
      if (!current()) return;
      if (location.error) {
        this.revision = null;
        this.blocked = true;
        this.patch({
          directory: location.directory,
          status: "error",
          error: location.error,
        });
        return;
      }
      if (!location.file) {
        if (!this.value.directory) return;
        this.blocked = true;
        this.patch({
          status: "conflict",
          error: "本地保存设置已更改，当前修改已保留，请重新设置保存路径。",
        });
        return;
      }
      if (
        location.file.revision === this.revision &&
        location.directory === this.value.directory
      )
        return;
      if (this.dirty) {
        this.blocked = true;
        this.cancelTimer();
        this.patch({
          status: "conflict",
          error:
            "其他页面已保存新版本，当前页面的修改已保留。请先导出当前修改，再读取本地版本。",
        });
      } else this.adopt(location);
    } catch (error) {
      if (current()) {
        this.blocked = true;
        this.patch({ status: "error", error: reason(error) });
      }
    }
  }
  async retry() {
    this.cancelTimer();
    if (this.inFlight) await this.inFlight.catch(() => {});
    if (this.initialReadFailed) {
      if (this.value.busy) throw new Error("资料库操作尚未完成，请稍后重试。");
      await this.loadInitial();
      if (this.value.status === "error" || this.value.status === "conflict")
        throw new Error(this.value.error);
      if (this.dirty && !this.blocked) await this.flush();
      return;
    }
    const generation = this.generation;
    const revision = this.revision;
    const connection = this.connectionGeneration;
    const location = await this.client.read();
    if (
      generation !== this.generation ||
      revision !== this.revision ||
      connection !== this.connectionGeneration ||
      this.inFlight ||
      this.value.busy
    )
      throw new Error(
        "读取期间内容或保存位置已更新，旧结果已忽略；如仍需重试，请再次点击。",
      );
    if (location.error) {
      this.revision = null;
      this.blocked = true;
      this.patch({
        status: "error",
        directory: location.directory,
        error: location.error,
      });
      throw new Error(location.error);
    }
    if (!location.file) {
      if (this.value.directory)
        throw new Error("本地保存设置已更改，请重新检查保存路径。");
      this.blocked = false;
      this.patch({ status: "browser", error: "" });
      return;
    }
    const remoteKey = key(location.file.notebook);
    if (
      this.dirty &&
      (location.directory !== this.value.directory ||
        (location.file.revision !== this.revision &&
          remoteKey !== this.attemptedKey &&
          remoteKey !== this.savedKey))
    ) {
      this.blocked = true;
      this.patch({
        status: "conflict",
        error:
          "本地资料库已有不同的新版本。当前修改已保留，请先导出，再读取本地版本。",
      });
      throw new Error(this.value.error);
    }
    if (!this.dirty) this.adopt(location);
    else {
      this.revision = location.file.revision;
      this.savedKey = remoteKey;
      this.blocked = false;
      this.dirty = key(this.value.notebook) !== remoteKey;
      this.patch({
        status: this.dirty ? "pending" : "saved",
        directory: location.directory,
        savedAt: location.file.savedAt,
        error: "",
      });
      await this.flush();
    }
  }
  private async replace(operation: () => Promise<LibraryLocation>) {
    if (this.value.busy) throw new Error("资料库操作尚未完成，请稍后重试。");
    this.cancelTimer();
    this.connectionGeneration++;
    this.patch({ busy: true });
    try {
      if (this.inFlight) await this.inFlight.catch(() => {});
      const generation = this.generation;
      const location = await operation();
      if (generation !== this.generation) {
        this.revision = location.file?.revision ?? null;
        this.savedKey = location.file ? key(location.file.notebook) : "";
        this.blocked = true;
        this.patch({
          directory: location.directory,
          status: "conflict",
          savedAt: location.file?.savedAt ?? null,
          error:
            "资料库操作期间发生了编辑，当前修改已保留。请导出当前修改后读取本地版本。",
        });
      } else this.adopt(location);
      this.initialized = true;
      this.options.notify?.(location);
    } catch (error) {
      if (!this.initialized) {
        this.initialized = true;
        this.blocked = true;
        this.patch({ status: "error" });
      }
      this.patch({ error: reason(error) });
      throw error;
    } finally {
      this.patch({ busy: false });
      this.schedule();
    }
  }
  connect(directory: string, mode: "create" | "open") {
    return this.replace(async () => {
      const notebook = this.value.notebook;
      const mediaStagingId = await this.options.prepareMedia?.(
        directory,
        notebook,
        this.value.directory,
      );
      return this.client.connect({
        directory,
        mode,
        notebook,
        ...(mediaStagingId ? { mediaStagingId } : {}),
        browserBackup: this.options.cache.original(),
      });
    });
  }
  reloadLocal() {
    if (!this.value.directory) return this.retry();
    return this.connect(this.value.directory, "open");
  }
  async restore(filename: string) {
    if (!this.value.directory) throw new Error("请先设置本地保存路径。");
    if (this.dirty && !this.blocked) await this.flush();
    return await this.replace(async () => {
      const location = await this.client.read();
      const baseRevision =
        location.directory === this.value.directory &&
        location.error &&
        !location.file
          ? null
          : this.revision;
      return await this.client.restore({
        directory: this.value.directory!,
        baseRevision,
        filename,
        draft: {
          notebook: this.value.notebook,
          browserBackup: this.options.cache.original(),
        },
      });
    });
  }
  async importBackup(content: string) {
    if (!this.value.directory)
      throw new Error("请先设置本地保存路径，再恢复完整备份。");
    if (this.dirty && !this.blocked) await this.flush();
    return await this.replace(async () => {
      const location = await this.client.read();
      const baseRevision =
        location.directory === this.value.directory &&
        location.error &&
        !location.file
          ? null
          : this.revision;
      return await this.client.importBackup({
        directory: this.value.directory!,
        baseRevision,
        content,
        draft: {
          notebook: this.value.notebook,
          browserBackup: this.options.cache.original(),
        },
      });
    });
  }
  async exportBackup() {
    return (
      JSON.stringify(
        await createResearchLibraryFile(this.value.notebook),
        null,
        2,
      ) + "\n"
    );
  }
  hasUnsavedChanges() {
    return (
      this.dirty &&
      Boolean(
        this.value.directory ||
        this.value.status === "error" ||
        this.value.cacheError,
      )
    );
  }
  dispose() {
    this.cancelTimer();
    this.listeners.clear();
  }
}

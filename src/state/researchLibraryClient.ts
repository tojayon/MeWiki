import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import type {
  LibraryCatalog,
  LibraryProfile,
} from "./researchLibraryCatalog.ts";
import {
  parseResearchLibraryFile,
  type ResearchLibraryFile,
  type ResearchLibrarySummary,
} from "./researchLibraryFile.ts";

export interface LibraryLocation {
  directory: string | null;
  file: ResearchLibraryFile | null;
  error?: string;
}
export interface LibraryInspection {
  directory: string;
  exists: boolean;
  summary: ResearchLibrarySummary | null;
}
export interface LibraryHistoryEntry extends ResearchLibrarySummary {
  filename: string;
}
export interface LibraryWrite {
  directory: string;
  baseRevision: string | null;
  notebook: ResearchNotebookState;
}
interface DraftBackup {
  notebook: ResearchNotebookState;
  browserBackup?: unknown;
}
export interface ResearchLibraryTransport {
  read(): Promise<LibraryLocation>;
  inspect(directory: string): Promise<LibraryInspection>;
  connect(request: {
    directory: string;
    mode: "create" | "open";
    notebook: ResearchNotebookState;
    browserBackup?: unknown;
    mediaStagingId?: string;
  }): Promise<LibraryLocation>;
  save(request: LibraryWrite): Promise<LibraryLocation>;
  history(): Promise<LibraryHistoryEntry[]>;
  restore(request: {
    directory: string;
    baseRevision: string | null;
    filename: string;
    draft?: DraftBackup;
  }): Promise<LibraryLocation>;
  importBackup(request: {
    directory: string;
    baseRevision: string | null;
    content: string;
    draft?: DraftBackup;
  }): Promise<LibraryLocation>;
}
export class ResearchLibraryHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export class ResearchLibraryClient implements ResearchLibraryTransport {
  private readonly fetcher: typeof fetch;
  readonly libraryId: string;
  constructor(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    libraryId = "default",
  ) {
    this.fetcher = fetcher;
    this.libraryId = libraryId;
  }
  private async request<T>(
    route = "",
    method = "GET",
    value?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(
        "/api/research-library" +
          route +
          (this.libraryId === "default"
            ? ""
            : `?library=${encodeURIComponent(this.libraryId)}`),
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-WebBench-Request": "research-library",
          },
          ...(value === undefined ? {} : { body: JSON.stringify(value) }),
          cache: "no-store",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        },
      );
    } catch {
      signal?.throwIfAborted();
      throw new ResearchLibraryHttpError(
        "无法连接本地资料库服务。修改尚未写入本地文件，请启动或重启 MeWiki 本地服务后重试。",
        0,
      );
    }
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new ResearchLibraryHttpError(
        "当前服务尚未加载资料库保存接口，请重启 MeWiki 本地服务后重试。",
        response.status,
      );
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new ResearchLibraryHttpError(
        result.error ?? "本地资料库请求失败。",
        response.status,
      );
    return result;
  }
  private async location(promise: Promise<LibraryLocation>) {
    const result = await promise;
    if (result.file)
      result.file = await parseResearchLibraryFile(JSON.stringify(result.file));
    return result;
  }
  read() {
    return this.location(this.request<LibraryLocation>());
  }
  catalog(signal?: AbortSignal) {
    return this.request<LibraryCatalog>("/catalog", "GET", undefined, signal);
  }
  registerLibrary(request: {
    name: string;
    directory: string;
    mode: "create" | "open";
    notebook: ResearchNotebookState;
  }) {
    return this.request<LibraryProfile>("/catalog", "POST", request);
  }
  updateLibrary(
    id: string,
    patch: { name?: string; context?: string; useAsDefault?: boolean },
  ) {
    return this.request<LibraryCatalog>("/catalog", "PATCH", { id, ...patch });
  }
  removeLibrary(id: string) {
    return this.request<LibraryCatalog>("/catalog", "DELETE", { id });
  }
  inspect(directory: string) {
    return this.request<LibraryInspection>("/inspect", "POST", { directory });
  }
  connect(request: Parameters<ResearchLibraryTransport["connect"]>[0]) {
    return this.location(
      this.request<LibraryLocation>("/connect", "POST", request),
    );
  }
  save(request: LibraryWrite) {
    return this.location(this.request<LibraryLocation>("", "PUT", request));
  }
  history() {
    return this.request<LibraryHistoryEntry[]>("/history");
  }
  restore(request: Parameters<ResearchLibraryTransport["restore"]>[0]) {
    return this.location(
      this.request<LibraryLocation>("/restore", "POST", request),
    );
  }
  importBackup(
    request: Parameters<ResearchLibraryTransport["importBackup"]>[0],
  ) {
    return this.location(
      this.request<LibraryLocation>("/import", "POST", request),
    );
  }
}

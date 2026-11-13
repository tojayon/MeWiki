import { assertResearchLibraryNotebook } from "./researchLibraryFile.ts";
import { ResearchLibraryClient } from "./researchLibraryClient.ts";
import {
  ResearchLibraryController,
  type LibraryPendingRecovery,
} from "./researchLibraryController.ts";
import {
  LEGACY_RESEARCH_NOTEBOOK_STORAGE_KEY,
  loadResearchNotebook,
} from "./researchNotebookStorage.ts";
import { prepareBrowserMediaMigration } from "./researchMediaStorage.ts";
import { libraryCacheKey } from "./researchLibraryCatalog.ts";

export function createLibrarySession(libraryId: string) {
  let browserStorage: Storage | undefined;
  try {
    browserStorage = localStorage;
  } catch {
    /* Durable libraries remain available without browser storage. */
  }
  const cacheKey = libraryCacheKey(libraryId);
  const notificationKey =
    libraryId === "default"
      ? "mewiki:research-library-commit"
      : `mewiki:library:${libraryId}:commit`;
  const recoveryKey =
    libraryId === "default"
      ? "mewiki:research-library-pending"
      : `mewiki:library:${libraryId}:pending`;

  function rawBrowserData() {
    return {
      current: localStorage.getItem(cacheKey),
      legacy:
        libraryId === "default"
          ? localStorage.getItem(LEGACY_RESEARCH_NOTEBOOK_STORAGE_KEY)
          : null,
      pending: sessionStorage.getItem(recoveryKey),
    };
  }
  function pendingRecovery(): LibraryPendingRecovery | undefined {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(recoveryKey) ?? "null",
      ) as LibraryPendingRecovery | null;
      if (
        !value ||
        typeof value.directory !== "string" ||
        typeof value.baseRevision !== "string"
      )
        return;
      assertResearchLibraryNotebook(value.notebook);
      return value;
    } catch {
      return;
    }
  }

  const recovery = pendingRecovery();
  let original: unknown;
  try {
    original = rawBrowserData();
  } catch {
    original = null;
  }
  const controller = new ResearchLibraryController({
    state: recovery?.notebook ?? loadResearchNotebook(browserStorage, cacheKey),
    recovery,
    client: new ResearchLibraryClient(undefined, libraryId),
    prepareMedia: (directory, notebook, sourceDirectory) => prepareBrowserMediaMigration(directory, notebook, sourceDirectory, libraryId),
    cache: {
      read: () => loadResearchNotebook(browserStorage, cacheKey),
      write(state) {
        localStorage.setItem(cacheKey, JSON.stringify(state));
      },
      original: () => ({ initial: original, current: rawBrowserData() }),
      preserve(state) {
        sessionStorage.setItem(
          `mewiki:library:${libraryId}:before-reload`,
          JSON.stringify(state),
        );
      },
      pending(value) {
        if (value) sessionStorage.setItem(recoveryKey, JSON.stringify(value));
        else sessionStorage.removeItem(recoveryKey);
      },
    },
    notify(location) {
      try {
        localStorage.setItem(
          notificationKey,
          JSON.stringify({
            directory: location.directory,
            revision: location.file?.revision,
            at: Date.now(),
          }),
        );
      } catch {
        /* Durable files remain saved when a browser notification is unavailable. */
      }
    },
  });
  const storage = (event: StorageEvent) => {
    if (event.key === notificationKey) {
      commitActiveText();
      void controller.synchronize();
    } else if (event.key === cacheKey && !controller.getSnapshot().directory)
      controller.acceptBrowserState(
        loadResearchNotebook(browserStorage, cacheKey),
      );
  };
  const focus = () => {
    commitActiveText();
    void controller.synchronize();
  };
  const commitActiveText = () => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.isContentEditable ||
        active instanceof HTMLTextAreaElement ||
        active.hasAttribute("data-research-text-picker-search")) &&
      active.closest('[data-testid="research-notebook"]')
    )
      active.blur();
  };
  const visibility = () => {
    if (document.hidden) {
      commitActiveText();
      void controller.flush().catch(() => {});
    } else {
      commitActiveText();
      void controller.synchronize();
    }
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    commitActiveText();
    if (controller.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  let listening = false;
  let watchingBrowser = false;
  const watchBrowser = () => {
    if (watchingBrowser) return;
    watchingBrowser = true;
    window.addEventListener("storage", storage);
  };
  const start = () => {
    if (listening) return;
    listening = true;
    watchBrowser();
    window.addEventListener("focus", focus);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
  };
  const stop = () => {
    listening = false;
    watchingBrowser = false;
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", focus);
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("visibilitychange", visibility);
  };
  const refreshBrowser = () => {
    if (!controller.getSnapshot().directory)
      controller.acceptBrowserState(
        loadResearchNotebook(browserStorage, cacheKey),
      );
  };
  return {
    controller,
    start,
    stop,
    watchBrowser,
    refreshBrowser,
    dispose() {
      stop();
      controller.dispose();
    },
  };
}
export type LibrarySession = ReturnType<typeof createLibrarySession>;

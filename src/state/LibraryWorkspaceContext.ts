import { createContext, useContext } from "react";
import type {
  LibraryCatalog,
  LibraryProfile,
} from "./researchLibraryCatalog.ts";
import type { LibrarySession } from "./researchLibrarySession.ts";
export interface LibraryWorkspace {
  catalog: LibraryCatalog;
  profile: LibraryProfile;
  context: string;
  session: LibrarySession;
  switching: boolean;
  showManager: () => void;
  switchLibrary: (id: string) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  exportRemovedNotebook: () => Promise<void>;
}
export const LibraryWorkspaceContext = createContext<LibraryWorkspace | null>(
  null,
);
export function useLibraryWorkspace() {
  const value = useContext(LibraryWorkspaceContext);
  if (!value) throw new Error("资料库工作区尚未准备好。");
  return value;
}

import { useSyncExternalStore } from "react";
import { useLibraryWorkspace } from "./LibraryWorkspaceContext.ts";
export function useResearchLibrary() {
  const { session } = useLibraryWorkspace();
  const controller = session.controller;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return { ...snapshot, controller };
}
export default function useResearchNotebook() {
  const { notebook, controller } = useResearchLibrary();
  return [notebook, controller.setState] as const;
}

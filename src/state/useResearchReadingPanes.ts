import { useCallback, useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createReadingPanes, synchronizeReadingPanes, type ResearchReadingPanes } from "./researchReadingPanes.ts";
import { loadReadingPanes, saveReadingPanes } from "./researchReadingPanesStorage.ts";

export function useResearchReadingPanes(noteId: string, validIds: ReadonlySet<string>, scope: string | null) {
  const [session, setSession] = useState(() => ({ scope, reading: scope === null ? createReadingPanes(noteId) : loadReadingPanes(noteId, scope) }));
  // A null scope means the library is still loading; do not prune or overwrite its saved layout.
  const restored = scope !== null && scope !== session.scope ? loadReadingPanes(noteId, scope) : session.reading;
  const reading = scope === null ? restored : synchronizeReadingPanes(restored, noteId, validIds);
  if (scope !== null && (scope !== session.scope || reading !== session.reading)) setSession({ scope, reading });

  useLayoutEffect(() => {
    if (scope !== null) saveReadingPanes(reading, scope);
  }, [reading, scope]);

  const setReading: Dispatch<SetStateAction<ResearchReadingPanes>> = useCallback(update => {
    setSession(current => {
      const reading = typeof update === "function" ? update(current.reading) : update;
      return reading === current.reading ? current : { ...current, reading };
    });
  }, []);
  return [reading, setReading] as const;
}

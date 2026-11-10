import { useLocale } from "../i18n/react.ts";
import ResearchNotebook from "./ResearchNotebook.tsx";
import useResearchNotebook from "../state/useResearchNotebook.ts";
import "./ResearchNotebook.css";
import { openMeWikiManual } from "../domain/meWikiWorkspace.ts";
import { useLibraryWorkspace } from "../state/LibraryWorkspaceContext.ts";

export default function ResearchNotebookPage() {
  useLocale();
  const workspace = useLibraryWorkspace();
  return <NotebookWorkspace key={workspace.profile.id} />;
}
function NotebookWorkspace() {
  useLocale();
  const [state, setState] = useResearchNotebook();

  return (
    <main className="research-notebook-standalone-page">
      <ResearchNotebook
        state={{ ...state, open: true }}
        onChange={(next) => setState({ ...next, open: true })}
        standalonePage
        onOpenHelp={() => setState(openMeWikiManual(state))}
      />
    </main>
  );
}

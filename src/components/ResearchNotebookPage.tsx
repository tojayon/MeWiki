import { useLocale } from "../i18n/react.ts";
import ResearchNotebook from "./ResearchNotebook.tsx";
import useResearchNotebook from "../state/useResearchNotebook.ts";
import "./ResearchNotebook.css";
import { useLibraryWorkspace } from "../state/LibraryWorkspaceContext.ts";
import InterfaceFontProvider from './InterfaceFontProvider.tsx';

export default function ResearchNotebookPage() {
  useLocale();
  const workspace = useLibraryWorkspace();
  return <InterfaceFontProvider key={workspace.profile.id}><NotebookWorkspace /></InterfaceFontProvider>;
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
      />
    </main>
  );
}

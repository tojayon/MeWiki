import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ResearchNotebookPage from "./components/ResearchNotebookPage.tsx";
import { DeleteConfirmationProvider } from "./components/DeleteConfirmation.tsx";
import IntegrationProvider from "./integrations/IntegrationProvider.tsx";
import LibraryWorkspaceProvider from "./components/LibraryWorkspaceProvider.tsx";
import "./index.css";
import "./components/WorkspaceModal.css";
import "./ui-controls.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeleteConfirmationProvider>
      <IntegrationProvider>
        <LibraryWorkspaceProvider>
          <ResearchNotebookPage />
        </LibraryWorkspaceProvider>
      </IntegrationProvider>
    </DeleteConfirmationProvider>
  </StrictMode>,
);

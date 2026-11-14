import { initializeLocale, setLocale, getLocale, t, LOCALE_STORAGE_KEY } from "./i18n/locale.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ResearchNotebookPage from "./components/ResearchNotebookPage.tsx";
import PublicationPage from './components/PublicationPage.tsx';
import { DeleteConfirmationProvider } from "./components/DeleteConfirmation.tsx";
import IntegrationProvider from "./integrations/IntegrationProvider.tsx";
import LibraryWorkspaceProvider from "./components/LibraryWorkspaceProvider.tsx";
import "./index.css";
import "./components/WorkspaceModal.css";
import "./ui-controls.css";
import './ui-surfaces.css';
import { documentContentCss } from './styles/documentTheme.ts';

const documentStyle = document.createElement('style');
documentStyle.id = 'mewiki-document-theme';
documentStyle.textContent = documentContentCss;
document.head.prepend(documentStyle);

const browserLanguages = navigator.languages;
try { initializeLocale(localStorage, browserLanguages); } catch { initializeLocale(undefined, browserLanguages); }
const updateDocumentLanguage = () => {
  document.documentElement.lang = getLocale();
  if (/^(MeWiki|觅维)$/.test(document.title)) document.title = t('觅维');
  for (const name of ['application-name', 'apple-mobile-web-app-title']) document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', t('觅维'));
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('觅维：本地优先的 Wiki 文档编辑与知识管理工具'));
};
updateDocumentLanguage();
window.addEventListener("storage", event => {
  if (event.key !== LOCALE_STORAGE_KEY && event.key !== null) return;
  if (event.newValue === "en" || event.newValue === "zh-CN") setLocale(event.newValue);
  else { try { initializeLocale(localStorage, browserLanguages); } catch { initializeLocale(undefined, browserLanguages); } }
  updateDocumentLanguage();
});
import { subscribeLocale } from "./i18n/locale.ts";
subscribeLocale(updateDocumentLanguage);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeleteConfirmationProvider>
      <IntegrationProvider>
        {new URLSearchParams(location.search).has('publication') ? <PublicationPage /> : <LibraryWorkspaceProvider>
          <ResearchNotebookPage />
        </LibraryWorkspaceProvider>}
      </IntegrationProvider>
    </DeleteConfirmationProvider>
  </StrictMode>,
);

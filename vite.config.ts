import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { researchLibraryPlugin } from "./server/researchLibraryPlugin.ts";
import { pdfResourcesPlugin } from "./server/pdfResourcesPlugin.ts";
import { integrationPlugin } from './server/integrationPlugin.ts';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), researchLibraryPlugin(), pdfResourcesPlugin(), integrationPlugin()],
  server: { host: "127.0.0.1", port: 5280, strictPort: true },
  preview: { host: "127.0.0.1", port: 5280, strictPort: true },
  optimizeDeps: { include: ["ajv/dist/2020", "fflate", "read-excel-file/browser"] },
  build: { rolldownOptions: {
    preserveEntrySignatures: 'strict',
    input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), legacyExport: fileURLToPath(new URL('./src/integrations/legacyBrowserExport.ts', import.meta.url)) },
    output: { entryFileNames: chunk => chunk.name === 'legacyExport' ? 'integration/legacy-export.js' : 'assets/[name]-[hash].js' },
  } },
});

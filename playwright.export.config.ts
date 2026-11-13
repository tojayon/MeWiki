import { defineConfig } from '@playwright/test';
import path from 'node:path';
const settings = path.resolve('.mewiki/export-e2e-settings.json');
process.env.MEWIKI_EXPORT_E2E_SETTINGS = settings;
process.env.MEWIKI_PUBLICATION_BUILD = path.resolve('.mewiki/publication-build');
export default defineConfig({
  testDir: './e2e', testMatch: 'social-export.spec.ts', timeout: 120000, workers: 1,
  outputDir: './test-results/export',
  use: { baseURL: 'http://127.0.0.1:5284', channel: 'msedge', headless: true, locale: 'zh-CN', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --outDir .mewiki/publication-build --host 127.0.0.1 --port 5284 --strictPort', url: 'http://127.0.0.1:5284', reuseExistingServer: false, env: { MEWIKI_RESEARCH_SETTINGS: settings } },
});

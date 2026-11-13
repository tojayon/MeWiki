import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e', testMatch: ['ai-workspace.spec.ts', 'ai-inline-review.spec.ts', 'ai-usage.spec.ts', 'ai-conversation.spec.ts'], timeout: 60000, workers: 1,
  outputDir: '.mewiki/ai-e2e-results',
  use: { baseURL: 'http://127.0.0.1:5441', channel: 'msedge', headless: true, locale: 'zh-CN', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5441 --strictPort', url: 'http://127.0.0.1:5441', reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve('.mewiki/ai-e2e-settings.json') } },
});

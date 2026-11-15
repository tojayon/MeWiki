import { defineConfig } from '@playwright/test';
import path from 'node:path';
import aiConfig from './playwright.ai.config.ts';

export default defineConfig({
  ...aiConfig,
  testMatch: [...aiConfig.testMatch as string[], 'ai-docking.spec.ts', 'ai-popovers.spec.ts'],
  outputDir: '.mewiki/ai-unified-context-checks/results',
  use: { ...aiConfig.use, baseURL: 'http://127.0.0.1:5602' },
  webServer: {
    cwd: path.resolve('.'),
    command: 'node node_modules/vite/bin/vite.js preview --outDir .mewiki/ai-unified-context-checks/dist --host 127.0.0.1 --port 5602 --strictPort',
    url: 'http://127.0.0.1:5602',
    reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve('.mewiki/ai-unified-context-checks/settings.json') },
  },
});

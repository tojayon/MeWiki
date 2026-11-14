import { defineConfig } from '@playwright/test';
import path from 'node:path';
import aiConfig from './playwright.ai.config.ts';

export default defineConfig({ ...aiConfig, outputDir: '.mewiki/ai-notation-checks/results',
  use: { ...aiConfig.use, baseURL: 'http://127.0.0.1:5595' },
  webServer: { cwd: path.resolve('.'), command: 'node node_modules/vite/bin/vite.js preview --outDir .mewiki/ai-notation-checks/dist --host 127.0.0.1 --port 5595 --strictPort', url: 'http://127.0.0.1:5595', reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve('.mewiki/ai-notation-checks/settings.json') } },
});

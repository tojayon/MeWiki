import { defineConfig } from '@playwright/test';
import path from 'node:path';
import aiConfig from './playwright.ai.config.ts';

export default defineConfig({ ...aiConfig, testMatch: 'ai-reliability.spec.ts', outputDir: '.mewiki/ai-reliability-checks/results',
  use: { ...aiConfig.use, baseURL: 'http://127.0.0.1:5566' },
  webServer: { cwd: path.resolve('.'), command: 'node node_modules/vite/bin/vite.js preview --outDir .mewiki/ai-reliability-checks/dist --host 127.0.0.1 --port 5566 --strictPort', url: 'http://127.0.0.1:5566', reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve('.mewiki/ai-reliability-checks/settings.json') } },
});

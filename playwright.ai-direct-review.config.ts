import { defineConfig } from '@playwright/test';
import path from 'node:path';
import aiConfig from './playwright.ai.config.ts';

export default defineConfig({ ...aiConfig, testMatch: 'ai-direct-review.spec.ts', outputDir: '.mewiki/ai-direct-review-results',
  use: { ...aiConfig.use, baseURL: 'http://127.0.0.1:5565' },
  webServer: { cwd: path.resolve('.'), command: 'node node_modules/vite/bin/vite.js preview --outDir .mewiki/ai-direct-review-checks/dist --host 127.0.0.1 --port 5565 --strictPort', url: 'http://127.0.0.1:5565', reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve('.mewiki/ai-direct-review-settings.json') } },
});

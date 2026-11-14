import { defineConfig } from '@playwright/test';
import path from 'node:path';
import aiConfig from './playwright.ai.config.ts';

export default defineConfig({ ...aiConfig,
  testMatch: 'ai-block-menu.spec.ts', outputDir: '.mewiki/ai-block-menu-results',
  use: { ...aiConfig.use, baseURL: 'http://127.0.0.1:5561' },
  webServer: { cwd: path.resolve('.'), command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5561 --strictPort', url: 'http://127.0.0.1:5561', reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve('.mewiki/ai-block-menu-settings.json') } },
});

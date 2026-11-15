import { defineConfig } from '@playwright/test';
import path from 'node:path';
import aiConfig from './playwright.ai.config.ts';

export default defineConfig({
  ...aiConfig,
  testMatch: ['ai-product-context-skills.spec.ts'],
  outputDir: '.mewiki/ai-product-context-skills-checks/results',
  use: { ...aiConfig.use, baseURL: 'http://127.0.0.1:5601' },
  webServer: {
    cwd: path.resolve('.'),
    command: 'node node_modules/vite/bin/vite.js preview --outDir .mewiki/ai-product-context-skills-checks/dist --host 127.0.0.1 --port 5601 --strictPort',
    url: 'http://127.0.0.1:5601',
    reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve('.mewiki/ai-product-context-skills-checks/settings.json') },
  },
});

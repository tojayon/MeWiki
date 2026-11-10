import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./e2e", timeout: 60000, workers: 1,
  use: { baseURL: process.env.MEWIKI_BASE_URL || "http://127.0.0.1:5282", channel: "msedge", headless: true, locale: "zh-CN", viewport: { width: 1440, height: 960 }, trace: "retain-on-failure" },
  webServer: process.env.MEWIKI_BASE_URL ? undefined : {
    command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5282 --strictPort", url: "http://127.0.0.1:5282", reuseExistingServer: false,
    env: { MEWIKI_RESEARCH_SETTINGS: path.resolve(".mewiki/media-e2e-settings.json") },
  },
});

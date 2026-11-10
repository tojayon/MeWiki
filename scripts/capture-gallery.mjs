import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', 'e2e/showcase.spec.ts', '--reporter=line'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, MEWIKI_UPDATE_GALLERY: '1', MEWIKI_BASE_URL: '' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

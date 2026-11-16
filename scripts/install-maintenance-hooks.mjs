import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const content = '#!/bin/sh\n# MeWiki managed publication guard v1\nroot=$(git rev-parse --show-toplevel) || exit 1\nexec node "$root/scripts/check-public-source.mjs" --pre-push "$@"\n';
export async function installMaintenanceHook(root) {
  let configured = '';
  try { configured = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }); }
  catch (error) { if (error.status !== 1) throw error; }
  if (configured.trim()) throw new Error('已有自定义 hooksPath；请将维护检查接入原有 hook。');
  return install(root);
}
async function install(root) {
  const directory = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const hook = path.resolve(root, directory, 'pre-push');
  const existing = await fs.readFile(hook, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing !== null && existing !== content) throw new Error('已有 pre-push hook，未覆盖；请手动接入维护检查。');
  if (existing === null) { await fs.mkdir(path.dirname(hook), { recursive: true }); await fs.writeFile(hook, content, { mode: 0o755, flag: 'wx' }); }
  console.log('MeWiki 推送方向与公开内容检查已安装。');
  return hook;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  installMaintenanceHook(process.cwd()).catch(error => { console.error(error.message); process.exitCode = 1; });
}

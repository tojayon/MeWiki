import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const publicRepository = 'tojayon/MeWiki';
const serverRepository = 'tojayon/MeWiki-Server';
const privatePrefixes = ['deploy/', 'server/hosted/', 'src/state/server/', 'src/components/Hosted', '.mewiki/', '.local/', '.cache/', '.worktrees/', '.archive/', 'node_modules/', 'dist/', 'test-results/', 'playwright-report/'];
const sensitiveText = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|AGE-SECRET-KEY-1[0-9A-Z]{20,}/;
const zero = '0'.repeat(40);
const hasControl = value => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
function git(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
}
function forbiddenFile(file) {
  return privatePrefixes.some(prefix => file.startsWith(prefix)) ||
    /(?:^|\/)(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)$/.test(file) ||
    /(?:^|\/)\.env(?:$|\.)/.test(file) && !file.endsWith('.env.example') ||
    /\.(?:pem|key|pfx|p12|db|sqlite3?)$/i.test(file) ||
    /^\.github\/workflows\/(?:deploy-hk|verify-build)\.ya?ml$/.test(file) ||
    /^scripts\/(?:check-hosted|prepare-hosted|hosted-development|test-hosted|github-release)/.test(file);
}
function inspect(file, bytes) {
  if (hasControl(file)) throw new Error(`公开路径包含不支持的控制字符：${JSON.stringify(file)}`);
  if (forbiddenFile(file)) throw new Error(`公开边界拒绝私有或运行文件：${file}`);
  const value = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le') : bytes.toString('utf8');
  if (sensitiveText.test(value)) throw new Error(`公开边界发现疑似敏感凭据：${file}（值已隐藏）`);
}
function revision(root, ref) {
  if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error('提交必须是完整的 40 位 SHA。');
  return git(root, ['rev-parse', '--verify', ref + '^{commit}']).trim();
}
async function edition(root) {
  const value = JSON.parse(await fs.readFile(path.join(root, 'config/edition.json'), 'utf8'));
  if (value.schemaVersion !== 1 || !['community', 'server'].includes(value.edition)) throw new Error('缺少有效的版本维护配置。');
  return value.edition;
}
function repository(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^?#]+?)(?:\.git)?\/?$/.exec(url);
  return match?.[1];
}

/** Read Git objects in one process, preserving binary framing and filenames. */
function readBlobs(root, files, ref) {
  const tree = git(root, ['ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean);
  const entries = new Map(tree.map(line => { const index = line.indexOf('\t'); return [line.slice(index + 1), line.slice(0,index).split(' ')]; }));
  if (files.some(file => !entries.has(file))) throw new Error('公开提交存在无法完整读取的文件路径。');
  const requested = files;
  for (const file of requested) {
    if (hasControl(file)) inspect(file, Buffer.alloc(0));
    const [mode, type] = entries.get(file);
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`公开边界不接受链接或嵌套仓库：${file}`);
    if (forbiddenFile(file)) inspect(file, Buffer.alloc(0));
  }
  const text = requested;
  if (!text.length) return requested.length;
  const data = git(root, ['cat-file', '--batch'], { input: text.map(file => entries.get(file)[2]).join('\n') + '\n', encoding: null });
  let offset = 0;
  for (const file of text) {
    const end = data.indexOf(10, offset);
    const header = data.subarray(offset, end).toString('utf8').split(' ');
    const size = Number(header[2]);
    if (end < 0 || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0 || end + 1 + size >= data.length) throw new Error('无法完整读取公开 Git 对象。');
    inspect(file, data.subarray(end + 1, end + 1 + size)); offset = end + size + 2;
  }
  return requested.length;
}

export async function auditPublicSource(root, { ref } = {}) {
  if (ref) {
    revision(root, ref);
    const files = git(root, ['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean);
    return { files: readBlobs(root, files, ref) };
  }
  const files = [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  for (const file of files) {
    const target = path.join(root, file);
    const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`公开边界不接受链接或嵌套仓库：${file}`);
    inspect(file, await fs.readFile(target));
  }
  return { files: files.length };
}

export async function auditPush(root, remoteUrl, input) {
  const kind = await edition(root);
  const expected = kind === 'community' ? publicRepository : serverRepository;
  if (repository(remoteUrl) !== expected) throw new Error(`推送目标与 ${kind} 版本不符。只允许 ${expected}。`);
  if (kind === 'server') return { edition: kind, commits: 0 };
  const commits = new Set();
  for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
    const fields = line.split(/\s+/);
    if (fields.length !== 4) throw new Error('无法解析 Git 推送范围。');
    const [, local, , remote] = fields;
    if (local === zero) continue;
    revision(root, local);
    if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error('无法解析远端提交。');
    if (remote !== zero) revision(root, remote);
    const outgoing = git(root, ['rev-list', ...(remote === zero ? [local] : [`${remote}..${local}`])]).trim().split('\n').filter(Boolean);
    for (const commit of outgoing) commits.add(commit);
    await auditPublicSource(root, { ref: local });
  }
  for (const commit of commits) {
    const files = [...new Set(git(root, ['diff-tree', '-m', '--root', '-r', '--no-renames', '--no-commit-id', '--name-only', '--diff-filter=ACMRT', '-z', commit]).split('\0').filter(Boolean))];
    readBlobs(root, files, commit);
  }
  return { edition: kind, commits: commits.size };
}

async function main() {
  const args = process.argv.slice(2), root = process.cwd();
  if (args[0] === '--pre-push' && args.length === 3) {
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    console.log(JSON.stringify(await auditPush(root, args[2], Buffer.concat(chunks).toString('utf8'))));
  } else if (args[0] === '--history' && args.length === 3) {
    if (await edition(root) !== 'community') throw new Error('公共历史检查只用于公共交付。');
    console.log(JSON.stringify(await auditPush(root, 'https://github.com/tojayon/MeWiki.git', `refs/heads/main ${args[2]} refs/heads/main ${args[1]}\n`)));
  } else if (args.length === 0 || args[0] === '--tree' && args.length === 2) {
    if (await edition(root) !== 'community') throw new Error('服务版请使用 community:check；公开检查只用于公共交付。');
    console.log(JSON.stringify(await auditPublicSource(root, { ref: args[1] })));
  } else throw new Error('用法：node scripts/check-public-source.mjs [--tree <完整提交SHA> | --history <旧SHA或40个0> <新SHA>]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

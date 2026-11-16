import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditPublicSource, auditPush } from './check-public-source.mjs';
import { installMaintenanceHook } from './install-maintenance-hooks.mjs';

const boundary = path.resolve('.mewiki/maintenance-tests');
async function fixture(t, edition = 'community') {
  await fs.mkdir(boundary, { recursive: true });
  const root = await fs.mkdtemp(path.join(boundary, 'public-'));
  t.after(async () => {
    assert.equal(path.dirname(root), boundary);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fictional maintainer'); git('config', 'user.email', 'fixture@example.invalid');
  async function write(file, value) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, value); }
  await write('config/edition.json', JSON.stringify({ schemaVersion: 1, edition }));
  await write('README.md', 'Fictional public project.');
  git('add', '.'); git('commit', '-qm', 'initial public content');
  return { root, git, write, initial: git('rev-parse', 'HEAD') };
}
const publicUrl = 'https://github.com/tojayon/MeWiki.git';
const privateUrl = 'git@github.com:tojayon/MeWiki-Server.git';

test('accepts a clean public working tree and declared environment examples', async t => {
  const f = await fixture(t); await f.write('.env.example', 'EXAMPLE_VALUE=replace-me');
  assert.ok((await auditPublicSource(f.root)).files >= 3);
});
test('rejects untracked service code and configuration without printing their contents', async t => {
  const f = await fixture(t); await f.write('server/hosted/app.ts', 'private implementation');
  await assert.rejects(auditPublicSource(f.root), /server\/hosted\/app.ts/);
  await fs.rm(path.join(f.root, 'server'), { recursive: true });
  await f.write('.env.production', 'PRIVATE_VALUE=not-for-publication');
  await assert.rejects(auditPublicSource(f.root), /\.env.production/);
});
test('rejects real token-shaped text while keeping the value out of errors', async t => {
  const f = await fixture(t); const token = ['ghp', 'x'.repeat(36)].join('_');
  await f.write('src/settings.ts', 'export const sample = "' + token + '"');
  await assert.rejects(auditPublicSource(f.root), error => error.message.includes('src/settings.ts') && !error.message.includes(token));
});
test('checks extensionless files and encoded text for private keys', async t => {
  const f = await fixture(t);
  const key = ['-----BEGIN OPENSSH', 'PRIVATE KEY-----'].join(' ');
  const ageKey = ['AGE', 'SECRET', 'KEY', '1' + 'A'.repeat(58)].join('-');
  for (const [file, bytes] of [['Dockerfile', key], ['id_ed25519', key], ['notes.custom', Buffer.from('\ufeff' + key, 'utf16le')], ['recovery.txt', ageKey]]) {
    await f.write(file, bytes); await assert.rejects(auditPublicSource(f.root), /凭据|敏感|私有/); await fs.rm(path.join(f.root,file));
  }
});
test('rejects control characters in Git object paths rather than silently skipping them', async t => {
  const f = await fixture(t);
  const oid = execFileSync('git',['hash-object','-w','--stdin'],{cwd:f.root,input:'private material',encoding:'utf8'}).trim();
  const tree = execFileSync('git',['mktree','-z'],{cwd:f.root,input:`100644 blob ${oid}\todd\tprivate.txt\0`,encoding:'utf8'}).trim();
  const commit = f.git('commit-tree',tree,'-p',f.initial,'-m','invalid object path');
  await assert.rejects(auditPublicSource(f.root,{ref:commit}), /路径|文件名/);
});
test('checks every outgoing commit even when private code was later deleted', async t => {
  const f = await fixture(t); await f.write('deploy/private.mjs', 'private'); f.git('add', '.'); f.git('commit', '-qm', 'private code');
  f.git('rm', '-q', 'deploy/private.mjs'); f.git('commit', '-qm', 'remove private code');
  const input = `refs/heads/topic ${f.git('rev-parse','HEAD')} refs/heads/topic ${f.initial}\n`;
  await assert.rejects(auditPush(f.root, publicUrl, input), /deploy\/private.mjs/);
});
test('checks token-shaped text in old commits even after a clean replacement', async t => {
  const f = await fixture(t); const token = ['github', 'pat', 'y'.repeat(40)].join('_');
  await f.write('src/example.ts', token); f.git('add', '.'); f.git('commit', '-qm', 'unsafe example');
  await f.write('src/example.ts', 'clean example'); f.git('add', '.'); f.git('commit', '-qm', 'replace example');
  await assert.rejects(auditPush(f.root, publicUrl, `refs/heads/topic ${f.git('rev-parse','HEAD')} refs/heads/topic ${f.initial}\n`), /凭据|敏感/);
});
test('allows a clean outgoing update and refuses the wrong repository', async t => {
  const f = await fixture(t); await f.write('src/core.ts', 'export const value=1;'); f.git('add','.'); f.git('commit','-qm','public feature');
  const input = `refs/heads/main ${f.git('rev-parse','HEAD')} refs/heads/main ${f.initial}\n`;
  assert.equal((await auditPush(f.root, publicUrl, input)).commits, 1);
  await assert.rejects(auditPush(f.root, privateUrl, input), /目标/);
});
test('server edition refuses any push to the public repository', async t => {
  const f = await fixture(t, 'server');
  await assert.rejects(auditPush(f.root, publicUrl, ''), /目标/);
  assert.equal((await auditPush(f.root, privateUrl, '')).edition, 'server');
});
test('hook installation is repeatable and never overwrites an existing hook', async t => {
  const f = await fixture(t); const hook = path.join(f.root, '.git/hooks/pre-push');
  await fs.writeFile(hook, '#!/bin/sh\n# existing user hook\n');
  await assert.rejects(installMaintenanceHook(f.root), /已有/);
  assert.match(await fs.readFile(hook, 'utf8'), /existing user hook/);
  await fs.rm(hook); await installMaintenanceHook(f.root); await installMaintenanceHook(f.root);
  assert.match(await fs.readFile(hook,'utf8'), /check-public-source\.mjs/);
});

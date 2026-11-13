import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDirectory, validateFile } from '../scripts/plugin-tools.mjs';
import { inspectPluginPackage } from './pluginPackageArchive.ts';

const runNode = promisify(execFile);
const command = fileURLToPath(new URL('../scripts/plugin-tools.mjs', import.meta.url));
const sample = fileURLToPath(new URL('../examples/plugins/measurement/manifest.json', import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('mewiki-plugin-tools-')) throw new Error('Unsafe cleanup path');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-plugin-tools-')); roots.push(root);
  const directory = path.join(root, 'measurement'); await mkdir(directory);
  await writeFile(path.join(directory, 'manifest.json'), await readFile(sample));
  return { root, directory, output: path.join(root, 'measurement.mewiki-plugin') };
}

describe('independent plugin author tools', () => {
  it('validates the independent example through the production package validator', async () => {
    const result = await validateFile(sample);
    expect(result.manifest.id).toBe('org.example.measurement'); expect(result.manifest.version).toBe('1.0.0');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('packages only declarative files and produces an installable archive', async () => {
    const { directory, output } = await fixture(); await writeFile(path.join(directory, 'README.md'), '插件使用说明');
    const result = await packDirectory(directory, output);
    expect(result.output).toBe(path.resolve(output));
    const validated = await inspectPluginPackage(await readFile(output));
    expect(validated.manifest.id).toBe('org.example.measurement'); expect(result.sha256).toBe(validated.sha256);
  });
  it('refuses to overwrite existing output or delete it on failure', async () => {
    const { directory, output, root } = await fixture(); await writeFile(output, '已有文件');
    await expect(packDirectory(directory, output)).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('已有文件'); expect((await readdir(root)).sort()).toEqual(['measurement', 'measurement.mewiki-plugin']);
  });
  it('rejects scripts, unrecognized resources and nested directories without creating output', async () => {
    const { directory, output, root } = await fixture();
    for (const name of ['main.js', 'index.html', 'resources']) {
      const file = path.join(directory, name);
      if (name === 'resources') await mkdir(file); else await writeFile(file, 'throw 0');
      await expect(packDirectory(directory, output)).rejects.toThrow();
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
      await rm(file, { recursive: true });
    }
    expect(await readdir(root)).toEqual(['measurement']);
  });
  it('rejects symbolic-link plugin roots', async () => {
    const { root, directory, output } = await fixture(); const alias = path.join(root, 'linked');
    await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(packDirectory(alias, output)).rejects.toThrow(/链接/);
  });
  it('rejects malformed manifests and oversized documentation before output creation', async () => {
    const { directory, output } = await fixture(); await writeFile(path.join(directory, 'manifest.json'), '{');
    await expect(packDirectory(directory, output)).rejects.toThrow();
    await writeFile(path.join(directory, 'manifest.json'), await readFile(sample)); await writeFile(path.join(directory, 'README.md'), Buffer.alloc(64 * 1024 + 1));
    await expect(packDirectory(directory, output)).rejects.toThrow();
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('shows help, validates a file and reports wrong arguments using the CLI', async () => {
    const options = { cwd: path.dirname(command), timeout: 15000 };
    const help = await runNode(process.execPath, ['--experimental-strip-types', command, '--help'], options);
    expect(help.stdout).toContain('validate'); expect(help.stdout).toContain('pack');
    const validated = await runNode(process.execPath, ['--experimental-strip-types', command, 'validate', sample], options);
    expect(validated.stdout).toContain('org.example.measurement'); expect(validated.stdout).toContain('1.0.0'); expect(validated.stdout).toMatch(/[a-f0-9]{64}/);
    const { directory, output } = await fixture();
    const packaged = await runNode(process.execPath, ['--experimental-strip-types', command, 'pack', directory, output], options);
    expect(packaged.stdout).toContain(output); expect(packaged.stdout).toContain('org.example.measurement');
    const existing = await readFile(output);
    await expect(runNode(process.execPath, ['--experimental-strip-types', command, 'pack', directory, output], options)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(output)).toEqual(existing);
    for (const args of [[], ['missing'], ['pack', sample], ['validate', sample, 'extra']]) {
      await expect(runNode(process.execPath, ['--experimental-strip-types', command, ...args], options)).rejects.toMatchObject({ code: 1 });
    }
  });
});

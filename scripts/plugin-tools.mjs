import { lstat, open, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipFile } from 'yazl';
import { inspectPluginPackage } from '../server/pluginPackageArchive.ts';

const allowedFiles = new Map([['manifest.json', 256 * 1024], ['README.md', 64 * 1024], ['LICENSE', 64 * 1024], ['LICENSE.txt', 64 * 1024]]);

async function regularFile(filename, limit) {
  const entry = await lstat(filename);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('插件源文件必须是普通文件，不能使用链接或目录。');
  if (entry.size > limit) throw new Error(`插件文件超过大小限制：${path.basename(filename)}`);
  const bytes = await readFile(filename);
  if (bytes.length > limit) throw new Error(`插件文件超过大小限制：${path.basename(filename)}`);
  return bytes;
}

export async function validateFile(filename) {
  const absolute = path.resolve(filename);
  const bytes = await regularFile(absolute, 1024 * 1024);
  return { ...await inspectPluginPackage(bytes), file: absolute };
}

export async function packDirectory(directory, output) {
  const source = path.resolve(directory);
  const target = path.resolve(output);
  const entry = await lstat(source);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('插件源目录必须是普通目录，不能使用链接。');
  const entries = await readdir(source, { withFileTypes: true });
  if (!entries.some(file => file.name === 'manifest.json')) throw new Error('插件目录缺少 manifest.json。');
  if (entries.some(file => !allowedFiles.has(file.name) || file.isSymbolicLink() || !file.isFile())) throw new Error('插件目录只能包含 manifest.json、README.md、LICENSE 和 LICENSE.txt 普通文件。');
  const files = [];
  for (const file of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    files.push({ name: file.name, bytes: await regularFile(path.join(source, file.name), allowedFiles.get(file.name)) });
  }

  const archive = new ZipFile();
  const chunks = [];
  const packed = new Promise((resolve, reject) => {
    archive.outputStream.on('data', chunk => chunks.push(chunk));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on('error', reject);
    archive.on('error', reject);
  });
  for (const file of files) archive.addBuffer(file.bytes, file.name, { compress: false, mode: 0o100644, mtime: new Date('2000-01-01T00:00:00Z') });
  archive.end();
  const bytes = await packed;
  const validated = await inspectPluginPackage(bytes);

  // Validation finishes before the destination is exclusively created. Existing
  // files are never opened for modification or removed by this invocation.
  const handle = await open(target, 'wx');
  let complete = false;
  try { await handle.writeFile(bytes); await handle.sync(); complete = true; }
  finally {
    await handle.close();
    if (!complete) await rm(target, { force: true });
  }
  return { ...validated, output: target };
}

const help = `MeWiki 插件作者工具

用法：
  node --experimental-strip-types scripts/plugin-tools.mjs validate <manifest.json>
  node --experimental-strip-types scripts/plugin-tools.mjs pack <插件目录> <输出.mewiki-plugin>

仅校验和打包声明式插件，不安装、不执行插件代码，不覆盖已有输出。
`;
async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(help); return; }
  if (args[0] === 'validate' && args.length === 2) {
    const result = await validateFile(args[1]);
    process.stdout.write(`${result.manifest.id} ${result.manifest.version}\nSHA-256 ${result.sha256}\n${result.file}\n`);
    return;
  }
  if (args[0] === 'pack' && args.length === 3) {
    const result = await packDirectory(args[1], args[2]);
    process.stdout.write(`${result.manifest.id} ${result.manifest.version}\nSHA-256 ${result.sha256}\n${result.output}\n`);
    return;
  }
  throw new Error('命令或参数无效。使用 --help 查看用法。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : '插件工具执行失败。'}\n`);
    process.exitCode = 1;
  });
}

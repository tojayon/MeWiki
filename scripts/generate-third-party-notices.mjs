import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('支持的参数：--check');
const check = process.argv.includes('--check');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const noticeName = /^(?:licen[sc]e|copying|notice|copyright)(?:$|[._-])/i;
const directRuntime = new Set(Object.keys(manifest.dependencies ?? {}));
const directDevelopment = new Set(Object.keys(manifest.devDependencies ?? {}));
const sortText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

async function optionalRead(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function noticeFiles(directory, relative = '') {
  let entries;
  try { entries = await readdir(path.join(directory, relative), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return entries.filter(entry => entry.isFile() && noticeName.test(entry.name))
    .map(entry => path.posix.join(relative, entry.name)).sort(sortText);
}
function licenseText(value) {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) return value.map(licenseText).join(' OR ');
  if (value && typeof value === 'object') return value.type ?? 'UNKNOWN';
  return 'UNKNOWN';
}
function projectUrl(pkg) {
  const candidate = pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url);
  if (typeof candidate !== 'string') return '';
  const value = candidate.replace(/^git\+/, '').replace(/\.git$/, '');
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
const entries = [];
const archived = [];
for (const [location, metadata] of Object.entries(lock.packages).sort(([a], [b]) => sortText(a, b))) {
  if (!location.startsWith('node_modules/')) continue;
  const directory = path.join(root, location);
  const raw = await optionalRead(path.join(directory, 'package.json'));
  const installed = raw ? JSON.parse(raw) : null;
  if (installed && installed.version !== metadata.version) throw new Error(`安装版本与锁文件不同：${location}`);
  const name = installed?.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const direct = location === `node_modules/${name}`;
  const scope = direct && directRuntime.has(name) ? 'runtime-direct'
    : direct && directDevelopment.has(name) ? 'development-direct'
    : metadata.dev ? 'development-transitive' : 'runtime-transitive';
  let files = installed ? await noticeFiles(directory) : [];
  if (name === 'pdfjs-dist' && installed) {
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) files.push(...await noticeFiles(directory, folder));
  }
  files = [...new Set(files)].sort(sortText);
  for (const file of files) {
    const text = await readFile(path.join(directory, file), 'utf8');
    archived.push(`===== ${name}@${metadata.version} — ${location}/${file} =====\n\n${text.replace(/\r\n?/g, '\n').trimEnd()}\n`);
  }
  const license = licenseText(metadata.license ?? installed?.license ?? installed?.licenses);
  entries.push({ name, version: metadata.version, location, scope, license, installed: !!installed,
    noticeFiles: files, homepage: projectUrl(installed ?? {}), optional: !!metadata.optional });
}
const directEntries = entries.filter(entry => entry.scope.endsWith('-direct'));
const pending = entries.filter(entry => entry.license === 'UNKNOWN' || /SEE LICEN[SC]E/i.test(entry.license));
const uninstalled = entries.filter(entry => !entry.installed);
const noTexts = entries.filter(entry => entry.installed && !entry.noticeFiles.length);
const escaped = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const tick = String.fromCharCode(96);
const table = directEntries.map(entry => `| ${escaped(entry.name)} | ${escaped(entry.version)} | ${entry.scope === 'runtime-direct' ? '运行' : '开发'} | ${escaped(entry.license)} |`).join('\n');
const document = `# 第三方声明

MeWiki 自有源码和文档采用 [MIT](LICENSE)。依赖、字体、原生库与解码组件保留各自的版权和许可证，不能统一改称 MIT。

此清单由当前 ${tick}package-lock.json${tick} 和已安装依赖生成。再生成：${tick}node scripts/generate-third-party-notices.mjs${tick}；核对生成结果：${tick}node scripts/generate-third-party-notices.mjs --check${tick}。不同系统安装的可选二进制包不同；在拟分发的平台重新收集并审阅声明。

## 范围

- 锁定依赖安装位置：**${entries.length}**；直接运行依赖：**${directEntries.filter(entry => entry.scope === 'runtime-direct').length}**；直接开发依赖：**${directEntries.filter(entry => entry.scope === 'development-direct').length}**。
- 本机已安装位置：**${entries.length - uninstalled.length}**；归档声明文件：**${archived.length}**。
- 锁定但本机未安装的位置：**${uninstalled.length}**，这些位置未收集声明原文。
- 许可证字段需人工核对：**${pending.length}**；已安装但未找到根目录声明文件的位置：**${noTexts.length}**，均详见完整清单。

[完整依赖清单](docs/open-source/dependency-licenses.json)记录精确版本、依赖位置、运行/开发范围、安装情况和声明文件名；[已收集的声明原文](docs/licenses/THIRD_PARTY_LICENSES.txt)逐份保留当前安装包的文本。这是发布审阅材料，尚未构成完整的二进制分发许可核验。

## 直接依赖

| 包 | 锁定版本 | 用途范围 | 许可证字段 |
| --- | --- | --- | --- |
${table}

## 随界面打包的资源

- **KaTeX**：数学排版、字体与样式来自对应安装包，保留其 MIT 声明。
- **PDF.js**：脚本使用其包许可证；字形映射、标准字体、色彩配置及 WASM 解码器另有声明。构建插件复制各资源目录时会保留目录内的许可证文件。
- **Liberation 标准字体**：当前安装包的 ${tick}standard_fonts/LICENSE_LIBERATION${tick} 包含 GPL-2.0 及字体例外条款，不能仅凭 PDF.js 包的 Apache-2.0 标签判断全部资源。若分发构建产物，需按该原文核对字体原件及对应来源的要求。
- **PDF WASM 组件**：归档包含 JBIG2、OpenJPEG、QCMS、QuickJS 及 PDF.js 包装组件各自的声明，需按拟发布资源逐项核对。
- **sharp / libvips**：sharp 的包许可证与其预构建二进制中的底层组件不同。当前清单记录锁定包与可见声明；随安装器、${tick}node_modules${tick} 或二进制归档分发时，还需核对 libvips 及其组件许可、版权和所需来源材料。

当前公共图标为本仓库中的 ${tick}public/mewiki.svg${tick}；宣传截图仅使用通用示例。用户自己导入的图片、论文、媒体与引用内容不由 MeWiki 的 MIT 许可重新授权。

## 发布时保留什么

源码发布保留本文件、项目 LICENSE、锁文件与已整理的第三方声明。构建包或安装器还需携带实际包含组件的许可证与版权声明；不要从 ${tick}dist/pdfjs/${tick} 中删除 LICENSE 文件。发布前步骤见[发布清单](docs/open-source/RELEASE_CHECKLIST.md)。
`;
const inventory = JSON.stringify({ schemaVersion: 1, packageVersion: manifest.version, source: 'package-lock.json',
  collectedOnPlatform: process.platform, collectionScope: 'lockfile metadata and locally installed notice texts',
  counts: { packages: entries.length, noticeFiles: archived.length, pendingLicenseFields: pending.length, uninstalled: uninstalled.length, installedWithoutNoticeFiles: noTexts.length },
  entries }, null, 2) + '\n';
const texts = 'MeWiki — third-party license and copyright texts\n\n'
  + 'Collected from locally installed packages. Package-specific terms are preserved below.\n\n'
  + archived.join('\n');
const outputs = new Map([
  ['THIRD_PARTY_NOTICES.md', document],
  ['docs/open-source/dependency-licenses.json', inventory],
  ['docs/licenses/THIRD_PARTY_LICENSES.txt', texts],
]);
let differences = 0;
for (const [relative, contents] of outputs) {
  const file = path.join(root, relative);
  if (await optionalRead(file) === contents) continue;
  differences++;
  if (check) console.error(`需重新生成：${relative}`);
  else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents, 'utf8'); console.log(relative); }
}
console.log(`依赖 ${entries.length}；声明 ${archived.length}；待核对字段 ${pending.length}；未安装 ${uninstalled.length}。`);
if (check && differences) process.exitCode = 1;

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Generated from every application CSS asset, so new content styles join automatically. */
export const publicationStylesFilename = 'mewiki-publication.css';
export function collectPublicationStyles(assets: { name: string; css: string }[]): string {
  return assets.sort((a, b) => Number(!/^assets\/main-/.test(a.name)) - Number(!/^assets\/main-/.test(b.name)) || a.name.localeCompare(b.name)).map(asset => asset.css
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/@import\s+[^;]+;/gi, '')).join('\n');
}
export async function publicationStyles(root = process.cwd(), outDir = 'dist'): Promise<string> {
  try { return await readFile(path.resolve(root, outDir, publicationStylesFilename), 'utf8'); }
  catch { throw new Error('原生导出样式尚未生成，请重新构建 MeWiki 后重试。'); }
}

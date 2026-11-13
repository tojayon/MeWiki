import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const brand = path.join(root, 'public/brand');
const checking = process.argv.includes('--check');
const icon = await readFile(path.join(brand, 'mewiki-app-icon.svg'));
const mark = await readFile(path.join(brand, 'mewiki-mark.svg'), 'utf8');
// Remove the presentation margin so the circular mark stays legible in browser tabs.
const favicon = Buffer.from(mark.replace('viewBox="0 0 192 192"', 'viewBox="17.5 17.5 157 157"'));
const generated = new Map();
const monogram = /<g id="monogram"[\s\S]*<\/g>/.exec(icon.toString('utf8'))?.[0];
if (!monogram) throw new Error('方形图标原件缺少 monogram 笔画。');
const appSvg = (title, description, body) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title description">
<title id="title">${title}</title>
<desc id="description">${description}</desc>
${body}
</svg>
`);
const background = '<rect id="background" width="1024" height="1024" fill="#080a0d"/>';
const rounded = appSvg('MeWiki App 圆角图标', '笔画沿方形延展的蓝白 M，统一裁切为圆角方形，圆角之外透明。', `<defs><clipPath id="app-shape"><rect width="1024" height="1024" rx="224"/></clipPath></defs>
<g clip-path="url(#app-shape)">${background}${monogram}</g>`);
const light = appSvg('MeWiki App 白底图标', '与黑底版使用相同延展轮廓的蓝黑 M，白色满版方形背景。', `<rect id="background" width="1024" height="1024" fill="#fff"/>${monogram.replace('fill="#fff"', 'fill="#080a0d"')}`);
const foreground = appSvg('MeWiki App 前景标志', '为方形画幅延展的蓝白 M，背景透明。', monogram);
for (const [name, svg] of [['rounded', rounded], ['light', light], ['foreground', foreground]]) {
  generated.set(`public/brand/mewiki-app-icon-${name}.svg`, svg);
  const image = sharp(svg).resize(1024, 1024);
  generated.set(`public/brand/mewiki-app-icon-${name}-1024.png`, await (name === 'light' ? image.removeAlpha() : image).png().toBuffer());
}

for (const size of [16, 32, 48, 180, 192, 512, 1024]) {
  const png = await sharp(icon).resize(size, size).removeAlpha().png().toBuffer();
  generated.set(`public/brand/mewiki-icon-${size}.png`, png);
}
generated.set('public/apple-touch-icon.png', generated.get('public/brand/mewiki-icon-180.png'));
generated.set('public/mewiki.svg', favicon);
for (const size of [16, 32, 48]) {
  generated.set(`public/brand/mewiki-favicon-${size}.png`, await sharp(favicon).resize(size, size).png().toBuffer());
}

// ICO directories point to PNG frames, supported by current browsers and Windows.
const frames = [16, 32, 48].map(size => ({ size, data: generated.get(`public/brand/mewiki-favicon-${size}.png`) }));
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = frame.size;
  directory[entry + 1] = frame.size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.data.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.data.length;
}
generated.set('public/favicon.ico', Buffer.concat([directory, ...frames.map(frame => frame.data)]));

const template = await readFile(path.join(root, 'scripts/branding/hero-template.svg'), 'utf8');
const token = '{{MEWIKI_CIRCULAR_MARK}}';
if (template.split(token).length !== 2) throw new Error('README 横幅模板必须包含一个图标占位。');
const markBody = mark.replace(/^[\s\S]*?<desc\b[^>]*>[\s\S]*?<\/desc>\s*/, '').replace(/<\/svg>\s*$/, '');
const hero = template.replace(token, `<svg width="80" height="80" viewBox="17.5 17.5 157 157">${markBody}</svg>`);
generated.set('docs/assets/hero.svg', Buffer.from(hero));

for (const [relative, data] of generated) {
  const target = path.join(root, relative);
  if (checking) {
    const current = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!current?.equals(data)) throw new Error(`${relative} 需要更新，请运行 npm run brand:generate。`);
  } else {
    await writeFile(target, data);
  }
}

console.log(`${checking ? '已核对' : '已生成'} ${generated.size} 份 MeWiki 品牌资源。`);

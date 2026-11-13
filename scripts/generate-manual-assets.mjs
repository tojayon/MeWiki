// Regenerate the small, original, offline examples shipped with the manual.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { chromium } from "playwright-core";

const folder = new URL("../docs/wiki/assets/", import.meta.url);
await mkdir(folder, { recursive: true });
const manifest = {};
async function save(name, mimeType, bytes, dimensions = {}) {
  await writeFile(new URL(name, folder), bytes);
  const id = createHash("sha256").update(bytes).digest("hex");
  manifest[name] = { id, sha256: id, name, mimeType, size: bytes.length, createdAt: "2026-11-11T00:00:00.000Z", ...dimensions };
}

const image = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">
<rect width="960" height="360" rx="4" fill="#f4f7fb"/>
<text x="56" y="72" font-family="sans-serif" font-size="30" font-weight="700" fill="#153b6d">MeWiki</text>
<text x="56" y="110" font-family="sans-serif" font-size="16" fill="#526477">One note. Many ways to explain.</text>
<path d="M72 263L72 157M72 263H402" fill="none" stroke="#c5d0dd" stroke-width="2"/>
<path d="M84 243L144 219L204 196L264 173L324 148L384 125" fill="none" stroke="#3271b8" stroke-width="4"/>
${[[84,243],[144,219],[204,196],[264,173],[324,148],[384,125]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#3271b8"/>`).join("")}
${[[490,"TEXT", "#3271b8"],[632,"MATH", "#c46a2b"],[774,"DATA", "#b54f59"]].map(([x,label,color]) => `<rect x="${x}" y="150" width="118" height="96" rx="4" fill="white" stroke="#d3dde8"/><rect x="${x}" y="150" width="118" height="4" fill="${color}"/><text x="${x+59}" y="207" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="700" fill="${color}">${label}</text>`).join("")}
<text x="56" y="320" font-family="sans-serif" font-size="14" fill="#526477">LOCAL IMAGE SAMPLE / 960 × 360</text></svg>`;
await save("showcase-image.png", "image/png", await sharp(Buffer.from(image)).png().toBuffer(), { width: 960, height: 360 });

const sampleRate = 16000, seconds = 2;
const wav = Buffer.alloc(44 + sampleRate * seconds * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let sample = 0; sample < sampleRate * seconds; sample++) {
  const time = sample / sampleRate;
  const envelope = Math.min(1, time * 12, (seconds - time) * 8);
  wav.writeInt16LE(Math.round((Math.sin(time * Math.PI * 2 * 440) + Math.sin(time * Math.PI * 2 * 660)) * 900 * envelope), 44 + sample * 2);
}
await save("showcase-audio.wav", "audio/wav", wav);

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 270;
    const ctx = canvas.getContext("2d");
    const draw = frame => {
      ctx.fillStyle = "#f4f7fb"; ctx.fillRect(0, 0, 480, 270);
      ctx.fillStyle = "#153b6d"; ctx.font = "bold 28px sans-serif"; ctx.fillText("MeWiki", 32, 48);
      ctx.fillStyle = "#526477"; ctx.font = "14px sans-serif"; ctx.fillText("Local video sample", 32, 76);
      ["#3271b8", "#c46a2b", "#b54f59"].forEach((color, index) => {
        const height = 58 + Math.sin(frame / 5 + index) * 24;
        ctx.fillStyle = color; ctx.fillRect(62 + index * 122, 206 - height, 82, height);
      });
      ctx.fillStyle = "#d3dde8"; ctx.fillRect(32, 236, 416, 4);
      ctx.fillStyle = "#3271b8"; ctx.fillRect(32, 236, 416 * frame / 24, 4);
    };
    draw(0);
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 140000 });
    const chunks = [];
    const result = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks)); });
    recorder.start();
    for (let frame = 0; frame <= 24; frame++) { draw(frame); await new Promise(resolve => setTimeout(resolve, 84)); }
    recorder.stop();
    const blob = await result; stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await save("showcase-video.webm", "video/webm", Buffer.from(bytes), { width: 480, height: 270 });
} finally { await browser.close(); }

const pages = [
  ["MeWiki content showcase", "A small, searchable PDF included with the manual.", "Page 1 / 2", "Linear relationship: y = 2x + 1", "x: 0, 1, 2, 3, 4", "y: 1, 3, 5, 7, 9"],
  ["Reading a PDF in MeWiki", "Try changing the page, zooming, and searching for MeWiki.", "Page 2 / 2", "This file is an original demonstration, not a research paper.", "All examples are local. No external connection is needed."],
];
const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>", "", "", "", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
pages.forEach((lines, index) => {
  objects[2 + index * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 400] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + index * 2} 0 R >>`;
  const stream = `0.95 0.97 0.99 rg 0 0 640 400 re f\n0.08 0.23 0.43 rg\nBT /F1 24 Tf 36 344 Td (${lines[0]}) Tj /F1 13 Tf\n${lines.slice(1).map(line => `0 -42 Td (${line}) Tj`).join("\n")}\nET\n`;
  objects[3 + index * 2] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
});
let pdf = "%PDF-1.7\n"; const offsets = [0];
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index+1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await save("showcase-document.pdf", "application/pdf", Buffer.from(pdf));
await save("showcase-data.csv", "text/csv", Buffer.from("输入 x,观测值 y,参考值\r\n0,1,1\r\n1,3.2,3\r\n2,4.8,5\r\n3,7.1,7\r\n4,9,9\r\n"));
await writeFile(new URL("manifest.json", folder), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(`Generated ${Object.keys(manifest).length} local manual assets.\n`);

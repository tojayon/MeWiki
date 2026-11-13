import { openSettingsSection, closeSettingsPage } from "./helpers/settings.ts";
import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { enableNotebookEditing, runNotebookAction } from "./helpers/researchNotebook.ts";

const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || ".mewiki/media-e2e-settings.json");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAN0lEQVRIie2WsQ0AAAjC+JqfeLKe4dKB3QSEpoNPxQOqBTOE+IZYRLWK5xjhHCOQVCSbUMpLDg7V2l2IkGDTEwAAAABJRU5ErkJggg==", "base64");
const wav = Buffer.alloc(44 + 16000 * 4 * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let sample = 0; sample < 16000 * 4; sample++) wav.writeInt16LE(Math.round(Math.sin(sample * Math.PI * 2 * 220 / 16000) * 1200), 44 + sample * 2);
let root: string;

test.beforeEach(async ({ page }) => {
  await rm(settings, { force: true });
  root = await mkdtemp(path.join(tmpdir(), "webbench-av-e2e-"));
  const note = { ...createResearchNote("音视频笔记"), id: "av-note", library: "research" as const };
  const state = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id, view: "notes" as const };
  await page.addInitScript(state => { if (!localStorage.getItem("av-test-seeded")) { localStorage.setItem("mewiki:research-notebook", JSON.stringify(state)); localStorage.setItem("av-test-seeded", "1"); } }, state);
  await page.goto("/?page=research-notebook");
  await enableNotebookEditing(page.getByTestId("research-notebook"));
});
test.afterEach(async () => {
  await rm(settings, { force: true });
  if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("webbench-av-e2e-")) await rm(root, { recursive: true, force: true });
});
async function insert(page: Page, label: "音频" | "视频") {
  await page.getByRole("button", { name: "在笔记末尾插入", exact: true }).click();
  await page.getByRole("dialog", { name: "插入笔记内容" }).getByRole("button", { name: label, exact: true }).click();
  return page.locator(`.research-media-block[data-media-kind="${label === "音频" ? "audio" : "video"}"]`).last();
}
async function connect(page: Page, directory = path.join(root, "资料库")) {
  await openSettingsSection(page, "storage");
  const dialog = page.getByTestId("research-library-storage");
  await dialog.getByRole("textbox", { name: "本地保存路径", exact: true }).fill(directory);
  await dialog.getByRole("button", { name: "检查路径", exact: true }).click();
  await dialog.getByRole("button", { name: "迁移到此目录", exact: true }).click();
  await expect(dialog.getByText("本地自动保存已启用", { exact: true })).toBeVisible();
  await closeSettingsPage(page);
}
async function videoBytes(page: Page, mimeType = "video/webm;codecs=vp8") {
  const bytes = await page.evaluate(async mimeType => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext("2d")!;
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    const result = new Promise<Blob>(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType })); });
    recorder.start();
    for (let frame = 0; frame < 15; frame++) { context.fillStyle = frame % 2 ? "#3672b5" : "#df8d3e"; context.fillRect(0, 0, 160, 90); await new Promise(resolve => setTimeout(resolve, 80)); }
    recorder.stop();
    const blob = await result;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, mimeType);
  return Buffer.from(bytes);
}

test("plays and seeks browser audio, preserves playback settings and caption after reload", async ({ page }) => {
  const block = await insert(page, "音频");
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "观测记录.wav", mimeType: "audio/wav", buffer: wav });
  const player = block.locator("audio");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("preload", "metadata");
  await expect.poll(() => player.evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  expect(await player.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  await player.evaluate(async element => { const media = element as HTMLAudioElement; media.volume = 0.2; await media.play(); });
  await expect.poll(() => player.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await player.evaluate(element => { const media = element as HTMLAudioElement; media.pause(); media.currentTime = 2; });
  await expect.poll(() => player.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeCloseTo(2, 1);
  await block.getByRole("combobox", { name: "音频播放速度", exact: true }).selectOption("1.5");
  await block.getByRole("button", { name: "循环播放音频", exact: true }).click();
  await block.getByRole("textbox", { name: "音频说明", exact: true }).fill("原始观测音频");
  await page.reload();
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate(element => (element as HTMLAudioElement).playbackRate)).toBe(1.5);
  await expect(player).toHaveAttribute("loop", "");
  await expect(block.getByRole("textbox", { name: "音频说明", exact: true })).toHaveValue("原始观测音频");
  await page.screenshot({ path: "docs/evidence/research-audio-desktop.png", fullPage: true });
});

test("plays an MP3 recording from browser storage", async ({ page }) => {
  const bytes = Buffer.alloc(417 * 80);
  for (let index = 0; index < 80; index++) bytes.set([0xff, 0xfb, 0x90, 0x64], index * 417);
  const block = await insert(page, "音频");
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "静音记录.mp3", mimeType: "audio/mpeg", buffer: bytes });
  const audio = block.locator("audio");
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await audio.evaluate(async element => { await (element as HTMLAudioElement).play(); });
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await audio.evaluate(element => (element as HTMLAudioElement).pause());
  await expect(block.getByRole("alert")).toHaveCount(0);
});

test("plays a local video, sets a portable poster and restores both from an attachment backup", async ({ page }) => {
  await connect(page);
  const block = await insert(page, "视频");
  await block.getByLabel("选择视频文件", { exact: true }).setInputFiles({ name: "演示.webm", mimeType: "video/webm", buffer: await videoBytes(page) });
  const player = block.locator("video");
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  await player.evaluate(async element => { const media = element as HTMLVideoElement; media.muted = true; await media.play(); });
  await expect.poll(() => player.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await player.evaluate(element => (element as HTMLVideoElement).pause());
  await block.getByRole("button", { name: "视频设置", exact: true }).click();
  await block.getByLabel("选择视频封面文件", { exact: true }).setInputFiles({ name: "封面.png", mimeType: "image/png", buffer: png });
  await expect(player).toHaveAttribute("poster", /preview=1/);
  await block.getByRole("textbox", { name: "视频名称", exact: true }).fill("试验演示");
  await block.getByRole("textbox", { name: "视频说明", exact: true }).fill("试验视频说明");
  await page.reload();
  await expect(player).toHaveAttribute("poster", /preview=1/);
  await expect(block.getByText("试验演示", { exact: true })).toBeVisible();
  const partial = await page.request.get((await player.getAttribute("src"))!, { headers: { Range: "bytes=0-15" } });
  expect(partial.status()).toBe(206);
  expect(partial.headers()["content-disposition"]).toMatch(/^inline;/);
  await openSettingsSection(page, "storage");
  const dialog = page.getByTestId("research-library-storage");
  const downloading = page.waitForEvent("download");
  await openSettingsSection(page, "backup");
  await dialog.getByRole("button", { name: "导出含附件备份", exact: true }).click();
  const download = await downloading;
  await openSettingsSection(page, "backup");
  await dialog.getByLabel("选择完整资料库备份").setInputFiles((await download.path())!);
  await expect(dialog.getByLabel("恢复预览")).toBeVisible();
  await dialog.getByRole("button", { name: "确认恢复此版本", exact: true }).click();
  await expect(dialog.getByText("已恢复资料库，原版本已保留。", { exact: true })).toBeVisible();
  await closeSettingsPage(page);
  await expect(player).toHaveAttribute("poster", /preview=1/);
  await expect.poll(() => player.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  expect((await readdir(path.join(root, "资料库", "assets")))).toEqual(expect.arrayContaining([expect.stringMatching(/\.webm$/), expect.stringMatching(/\.png$/)]));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["收起文章大纲", "收起笔记左侧面板"]) { const toggle = page.getByRole("button", { name, exact: true }); if (await toggle.isVisible()) await toggle.click(); }
  await expect(player).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/evidence/research-video-mobile.png", fullPage: true });
});

test("references network audio directly and reports unsupported media without discarding its source", async ({ page }) => {
  await page.route("https://media.example.test/recording.wav", route => route.fulfill({ contentType: "audio/wav", body: wav }));
  const block = await insert(page, "音频");
  await block.getByRole("textbox", { name: "音频网址", exact: true }).fill("https://media.example.test/recording.wav");
  await block.getByRole("button", { name: "使用链接", exact: true }).click();
  await expect(block.locator("audio")).toHaveAttribute("src", "https://media.example.test/recording.wav");
  await expect.poll(() => block.locator("audio").evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await block.getByRole("button", { name: "替换音频", exact: true }).click();
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "wrong.png", mimeType: "image/png", buffer: png });
  await expect(block.getByRole("alert")).toContainText("音频");
  await expect(block.locator("audio")).toHaveAttribute("src", "https://media.example.test/recording.wav");
  await page.route("https://media.example.test/broken.mp3", route => route.fulfill({ contentType: "audio/mpeg", body: Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]) }));
  await block.getByRole("textbox", { name: "音频网址", exact: true }).fill("https://media.example.test/broken.mp3");
  await block.getByRole("button", { name: "使用链接", exact: true }).click();
  await expect(block.getByRole("alert")).toContainText("无法播放");
  await expect(block.getByRole("link", { name: "打开来源音频", exact: true })).toHaveAttribute("href", "https://media.example.test/broken.mp3");
});

test("pastes audio into an empty tab, drops mixed media in order and plays without editing in reading mode", async ({ page }) => {
  await page.getByRole("button", { name: "在笔记末尾插入", exact: true }).click();
  await page.getByRole("dialog", { name: "插入笔记内容" }).getByRole("button", { name: "标签页", exact: true }).click();
  const tabs = page.getByRole("group", { name: "标签页", exact: true });
  await tabs.getByRole("button", { name: "添加标签", exact: true }).click();
  const prevented = await tabs.locator(".research-example-body").evaluate((element, bytes) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], "粘贴.wav", { type: "audio/wav" }));
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }); element.dispatchEvent(event); return event.defaultPrevented;
  }, [...wav]);
  expect(prevented).toBe(true);
  await expect(tabs.locator("audio")).toHaveCount(1);
  const video = await videoBytes(page);
  await tabs.locator(".research-example-body").evaluate((element, files) => {
    const data = new DataTransfer();
    for (const file of files) data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    element.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, [{ name: "图片.png", type: "image/png", bytes: [...png] }, { name: "音频.wav", type: "audio/wav", bytes: [...wav] }, { name: "视频.webm", type: "video/webm", bytes: [...video] }]);
  await expect(tabs.locator(".research-media-block")).toHaveCount(4);
  expect(await tabs.locator(".research-media-block").evaluateAll(elements => elements.map(element => element.getAttribute("data-media-kind")))).toEqual(["audio", "image", "audio", "video"]);
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  await expect(tabs.getByRole("textbox", { name: "音频说明", exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"));
  await tabs.getByRole("combobox", { name: "音频播放速度", exact: true }).first().selectOption("2");
  await tabs.locator("audio").first().evaluate(async element => { const media = element as HTMLAudioElement; await media.play(); media.pause(); });
  expect(await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"))).toBe(saved);
  await page.reload();
  await expect(tabs.locator(".research-media-block")).toHaveCount(4);
});

test("cancels empty media insertion and retains the existing audio after an invalid replacement", async ({ page }) => {
  const empty = await insert(page, "视频");
  await empty.getByLabel("选择视频文件", { exact: true }).dispatchEvent("cancel");
  await expect(page.locator(".research-media-block")).toHaveCount(0);
  const block = await insert(page, "音频");
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "original.wav", mimeType: "audio/wav", buffer: wav });
  await expect(block.locator("audio")).toBeVisible();
  const original = await block.locator("audio").getAttribute("src");
  await block.getByRole("button", { name: "替换音频", exact: true }).click();
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "not-audio.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("<html>login</html>") });
  await expect(block.getByRole("alert")).toContainText("文件内容");
  await expect(block.locator("audio")).toHaveAttribute("src", original!);
});

test("plays MP4 and M4A, preserves them through browser-to-library migration and supports video fullscreen", async ({ page }) => {
  const videoBlock = await insert(page, "视频");
  const mp4 = await videoBytes(page, "video/mp4;codecs=avc1.42001E");
  await videoBlock.getByLabel("选择视频文件", { exact: true }).setInputFiles({ name: "演示.mp4", mimeType: "video/mp4", buffer: mp4 });
  const video = videoBlock.locator("video");
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  await videoBlock.getByRole("button", { name: "全屏播放视频", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe("VIDEO");
  await page.evaluate(() => document.exitFullscreen());
  await video.evaluate(async element => { const media = element as HTMLVideoElement; media.muted = true; await media.play(); media.pause(); media.currentTime = 0.4; });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(0.4, 1);
  const audioBlock = await insert(page, "音频");
  const m4a = Buffer.from(await page.evaluate(async () => {
    const context = new AudioContext(); await context.resume();
    const oscillator = context.createOscillator(); const gain = context.createGain(); gain.gain.value = 0.05;
    const destination = context.createMediaStreamDestination(); oscillator.connect(gain); gain.connect(destination); oscillator.start();
    const recorder = new MediaRecorder(destination.stream, { mimeType: "audio/mp4" });
    const parts: BlobPart[] = [];
    const result = new Promise<Blob>(resolve => { recorder.ondataavailable = event => parts.push(event.data); recorder.onstop = () => resolve(new Blob(parts)); });
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 1200)); recorder.stop();
    const bytes = [...new Uint8Array(await (await result).arrayBuffer())]; oscillator.stop(); destination.stream.getTracks().forEach(track => track.stop()); await context.close();
    return bytes;
  }));
  await audioBlock.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "观测.m4a", mimeType: "audio/mp4", buffer: m4a });
  const audio = audioBlock.locator("audio");
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await audio.evaluate(async element => { const media = element as HTMLAudioElement; await media.play(); media.pause(); });
  await connect(page);
  await page.reload();
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  const files = await readdir(path.join(root, "资料库", "assets"));
  expect(files.some(file => file.endsWith(".mp4"))).toBe(true);
  expect(files.some(file => file.endsWith(".m4a"))).toBe(true);
  await video.evaluate(async element => { const media = element as HTMLVideoElement; media.muted = true; await media.play(); });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.25);
  await video.evaluate(element => (element as HTMLVideoElement).pause());
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/evidence/research-audio-video-desktop.png", fullPage: true });
});

for (const newName of ["导入中修改的名称", ""]) test(`keeps a name edited during a delayed audio replacement (${newName || "cleared"})`, async ({ page }) => {
  await connect(page);
  const block = await insert(page, "音频");
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "original.wav", mimeType: "audio/wav", buffer: wav });
  await expect(block.locator("audio")).toBeVisible();
  await block.getByRole("button", { name: "音频设置", exact: true }).click();
  await block.getByRole("textbox", { name: "音频名称", exact: true }).fill("原名称");
  let release!: () => void, reached!: () => void, finished!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await page.route("**/api/research-library/media/uploads/*/complete", async route => {
    try { const response = await route.fetch(); reached(); await gate; await route.fulfill({ response }).catch(() => {}); }
    finally { finished(); }
  });
  await block.getByRole("button", { name: "替换音频", exact: true }).click();
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "replacement.wav", mimeType: "audio/wav", buffer: Buffer.concat([wav, Buffer.from("replacement")]) });
  await ready;
  try { await block.getByRole("textbox", { name: "音频名称", exact: true }).fill(newName); }
  finally { release(); }
  await done;
  await expect(block.getByRole("progressbar")).toHaveCount(0);
  await expect(block.getByRole("textbox", { name: "音频名称", exact: true })).toHaveValue(newName);
});

test("clears cancelled transfer progress when switching to reading mode during a replacement", async ({ page }) => {
  await connect(page);
  const block = await insert(page, "音频");
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "original.wav", mimeType: "audio/wav", buffer: wav });
  await expect(block.locator("audio")).toBeVisible();
  let release!: () => void, reached!: () => void, finished!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await page.route("**/api/research-library/media/uploads/*/complete", async route => {
    try { const response = await route.fetch(); reached(); await gate; await route.fulfill({ response }).catch(() => {}); }
    finally { finished(); }
  });
  await block.getByRole("button", { name: "替换音频", exact: true }).click();
  await block.getByLabel("选择音频文件", { exact: true }).setInputFiles({ name: "replacement.wav", mimeType: "audio/wav", buffer: Buffer.concat([wav, Buffer.from("replacement")]) });
  await ready;
  try { await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式"); }
  finally { release(); }
  await done;
  await expect(block.getByRole("progressbar")).toHaveCount(0);
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为编辑模式");
  await expect(block.getByLabel("选择音频文件", { exact: true })).toBeEnabled();
});

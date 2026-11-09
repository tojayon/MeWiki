import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { enableNotebookEditing } from "./helpers/researchNotebook.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAN0lEQVRIie2WsQ0AAAjC+JqfeLKe4dKB3QSEpoNPxQOqBTOE+IZYRLWK5xjhHCOQVCSbUMpLDg7V2l2IkGDTEwAAAABJRU5ErkJggg==", "base64");
const settings = path.resolve(".mewiki/media-e2e-settings.json");
let root: string;
test.beforeEach(async ({ page }) => {
  await rm(settings, { force: true });
  root = await mkdtemp(path.join(tmpdir(), "webbench-media-e2e-"));
  const note = { ...createResearchNote("图片笔记"), id: "media-note", library: "research" as const };
  const state = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id, view: "notes" as const };
  await page.addInitScript(state => { if (!localStorage.getItem("media-test-seeded")) { localStorage.setItem("mewiki:research-notebook", JSON.stringify(state)); localStorage.setItem("media-test-seeded", "1"); } }, state);
  await page.goto("/?page=research-notebook");
  await enableNotebookEditing(page.getByTestId("research-notebook"));
});
test.afterEach(async () => {
  await rm(settings, { force: true });
  if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("webbench-media-e2e-")) await rm(root, { recursive: true, force: true });
});
async function insertImage(page: Page) {
  await page.getByRole("button", { name: "在笔记末尾插入", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "插入笔记内容" });
  await expect(picker.getByRole("group", { name: "媒体", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "图片", exact: true }).click();
  return page.locator(".research-media-block").last();
}
async function storage(page: Page) {
  await page.getByRole("button", { name: "研究笔记设置", exact: true }).click();
  return page.getByRole("dialog", { name: "研究笔记设置", exact: true });
}
async function pasteImage(page: Page, selector: string, bytes = png) {
  return page.evaluate(({ selector, bytes }) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], "clipboard.png", { type: "image/png" }));
    const event = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
    document.querySelector(selector)!.dispatchEvent(event);
    return event.defaultPrevented;
  }, { selector, bytes: [...bytes] });
}
async function migrate(page: Page, directory: string) {
  const dialog = await storage(page);
  await dialog.getByRole("textbox", { name: "本地保存路径", exact: true }).fill(directory);
  await dialog.getByRole("button", { name: "检查路径", exact: true }).click();
  await dialog.getByRole("button", { name: "迁移到此目录", exact: true }).click();
  await expect(dialog.getByText("本地自动保存已启用", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭研究笔记设置", exact: true }).click();
}
async function connect(page: Page, directory = path.join(root, "资料库")) {
  const dialog = await storage(page);
  await dialog.getByRole("textbox", { name: "本地保存路径", exact: true }).fill(directory);
  await dialog.getByRole("button", { name: "检查路径", exact: true }).click();
  await dialog.getByRole("button", { name: "迁移到此目录", exact: true }).click();
  await expect(dialog.getByText("本地自动保存已启用", { exact: true })).toBeVisible();
  return dialog;
}
test("saves selected images independently, renders them after reload, and keeps controls usable on a narrow screen", async ({ page }) => {
  const block = await insertImage(page);
  await block.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "moon.png", mimeType: "image/png", buffer: png });
  await expect(block.getByRole("img")).toBeVisible();
  await block.getByRole("textbox", { name: "图片图注", exact: true }).fill("月面观测");
  await block.getByRole("button", { name: "图片设置", exact: true }).click();
  await block.getByRole("textbox", { name: "图片替代说明", exact: true }).fill("月面示意图");
  await block.getByRole("combobox", { name: "图片显示宽度", exact: true }).selectOption("75");
  await block.getByRole("button", { name: "图片右对齐", exact: true }).click();
  await page.reload();
  await expect(page.locator(".research-media-block").getByRole("img")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "图片图注", exact: true })).toHaveValue("月面观测");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["收起文章大纲", "收起笔记左侧面板"]) {
    const toggle = page.getByRole("button", { name, exact: true });
    if (await toggle.isVisible()) await toggle.click();
  }
  await expect(page.locator(".research-media-block").getByRole("img")).toBeVisible();
  await expect(page.locator(".research-media-block").getByRole("img")).toHaveAttribute("alt", "月面示意图");
  await expect(page.getByRole("button", { name: "图片右对齐", exact: true })).toHaveAttribute("aria-pressed", "true");
  const bounds = (await page.locator(".research-media-block img").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/evidence/research-media-mobile.png", fullPage: true });
});
test("migrates browser originals before binding the local library and exports a backup with attachments", async ({ page }) => {
  const block = await insertImage(page);
  await block.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "moon.png", mimeType: "image/png", buffer: png });
  await expect(block.getByRole("img")).toBeVisible();
  const dialog = await storage(page);
  const directory = path.join(root, "资料库");
  await dialog.getByRole("textbox", { name: "本地保存路径", exact: true }).fill(directory);
  await dialog.getByRole("button", { name: "检查路径", exact: true }).click();
  await dialog.getByRole("button", { name: "迁移到此目录", exact: true }).click();
  await expect(dialog.getByText("本地自动保存已启用", { exact: true })).toBeVisible();
  expect((await readdir(path.join(directory, "assets"))).some(name => name.endsWith(".png"))).toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出含附件备份", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await dialog.getByLabel("选择完整资料库备份").setInputFiles((await download.path())!);
  await expect(dialog.getByLabel("恢复预览")).toBeVisible();
  await dialog.getByRole("button", { name: "确认恢复此版本", exact: true }).click();
  await expect(dialog.getByText("已恢复资料库，原版本已保留。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭研究笔记设置", exact: true }).click();
  await page.evaluate(async () => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase("mewiki-research-media"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => resolve(); }); });
  await page.reload();
  await expect(page.locator(".research-media-block").getByRole("img")).toBeVisible();
  await page.screenshot({ path: "docs/evidence/research-media-desktop.png", fullPage: true });
  await migrate(page, path.join(root, "新目录"));
  await page.reload();
  await expect(page.locator(".research-media-block").getByRole("img")).toBeVisible();
});
test("accepts an online image reference without reading its bytes through browser fetch", async ({ page }) => {
  await page.route("https://media.example.test/moon.png", route => route.fulfill({ contentType: "image/png", body: png }));
  const block = await insertImage(page);
  await block.getByRole("textbox", { name: "图片网址", exact: true }).fill("https://media.example.test/moon.png");
  await block.getByRole("button", { name: "使用链接", exact: true }).click();
  await expect(block.getByRole("img")).toBeVisible();
  await expect(block.getByRole("img")).toHaveAttribute("src", "https://media.example.test/moon.png");
});
test("accepts pasted images in the note while leaving text input paste behavior alone", async ({ page }) => {
  await pasteImage(page, ".research-note-page");
  await expect(page.locator(".research-media-block")).toHaveCount(1);
  await expect(page.locator(".research-media-block").getByRole("img")).toBeVisible();
  await pasteImage(page, 'textarea[aria-label="图片图注"]');
  await expect(page.locator(".research-media-block")).toHaveCount(1);
});
test("accepts image paste from the media controls and keeps replacement local to that block", async ({ page }) => {
  const block = await insertImage(page);
  await pasteImage(page, ".research-media-file");
  await expect(block.getByRole("img")).toBeVisible();
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks.at(-1).source.assetId);
  await pasteImage(page, ".research-media-open", Buffer.concat([png, Buffer.from([1])]));
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks.at(-1).source.assetId)).not.toBe(original);
  await expect(block.getByRole("img")).toBeVisible();
  await expect(page.locator(".research-media-block")).toHaveCount(1);
});
test("inserts multiple selected images in order while sharing identical originals", async ({ page }) => {
  const block = await insertImage(page);
  await block.getByLabel("选择图片文件", { exact: true }).setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: png },
    { name: "second.png", mimeType: "image/png", buffer: png },
    { name: "third.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.locator(".research-media-block")).toHaveCount(3);
  await expect(page.locator(".research-media-block img").nth(0)).toHaveAttribute("alt", "first.png");
  await expect(page.locator(".research-media-block img").nth(1)).toHaveAttribute("alt", "second.png");
  await expect(page.locator(".research-media-block img").nth(2)).toHaveAttribute("alt", "third.png");
  expect(await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("mewiki-research-media", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return await new Promise<number>(resolve => { const request = database.transaction("assets").objectStore("assets").count(); request.onsuccess = () => { const count = request.result; database.close(); resolve(count); }; });
  })).toBe(1);
});
test("does not attach a delayed upload to a note selected after import started", async ({ page }) => {
  await migrate(page, path.join(root, "资料库"));
  const block = await insertImage(page);
  let release!: () => void;
  let reached!: () => void;
  let finished!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  await page.route("**/api/research-library/media/uploads/*/complete", async route => {
    try {
      const response = await route.fetch();
      reached();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    } finally { finished(); }
  });
  await block.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "delayed.png", mimeType: "image/png", buffer: png });
  await ready;
  try {
    await page.getByRole("button", { name: "新建笔记", exact: true }).click();
    await page.getByLabel("笔记标题", { exact: true }).fill("导入期间切换的笔记");
  } finally { release(); }
  await done;
  await expect(page.locator(".research-media-block")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.find((note: { id: string }) => note.id === "media-note").blocks.some((item: { source?: unknown }) => item.source))).toBe(false);
});
test("exports browser originals through a temporary file and restores them into an independent local library", async ({ page, browser }) => {
  const block = await insertImage(page);
  await block.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "portable.png", mimeType: "image/png", buffer: png });
  await expect(block.getByRole("img")).toBeVisible();
  const dialog = await storage(page);
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出含附件备份", exact: true }).click();
  const download = await downloading;
  const backup = (await download.path())!;
  expect(await page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("mewiki-research-exports");
    for await (const name of (directory as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }).keys()) if (name.startsWith("archive-")) return true;
    return false;
  })).toBe(true);
  const clean = await browser.newContext();
  try {
    const target = await clean.newPage();
    await target.goto(page.url());
    await migrate(target, path.join(root, "独立资料库"));
    const restore = await storage(target);
    await restore.getByLabel("选择完整资料库备份").setInputFiles(backup);
    await expect(restore.getByLabel("恢复预览")).toBeVisible();
    await restore.getByRole("button", { name: "确认恢复此版本", exact: true }).click();
    await expect(restore.getByText("已恢复资料库，原版本已保留。", { exact: true })).toBeVisible();
    await restore.getByRole("button", { name: "关闭研究笔记设置", exact: true }).click();
    await expect(target.locator(".research-media-block").getByRole("img")).toBeVisible();
  } finally { await clean.close(); }
});

test("exports browser originals through a temporary file and restores that ZIP into a local library", async ({ page }) => {
  const block = await insertImage(page);
  await block.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "wrong-extension.jpeg", mimeType: "image/png", buffer: png });
  await expect(block.getByRole("img")).toBeVisible();
  await block.getByRole("textbox", { name: "图片图注", exact: true }).fill("浏览器附件备份");
  const dialog = await storage(page);
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出含附件备份", exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  expect(await page.evaluate(async () => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("mewiki-research-exports");
    const names: string[] = [];
    for await (const name of folder.keys()) names.push(name);
    return names.some(name => /^archive-[a-f0-9-]+\.zip$/.test(name));
  })).toBe(true);
  const directory = path.join(root, "browser-restore");
  await dialog.getByRole("textbox", { name: "本地保存路径", exact: true }).fill(directory);
  await dialog.getByRole("button", { name: "检查路径", exact: true }).click();
  await dialog.getByRole("button", { name: "迁移到此目录", exact: true }).click();
  await expect(dialog.getByText("本地自动保存已启用", { exact: true })).toBeVisible();
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].source.assetId as string);
  const assetPath = `/api/research-library/media/assets/${id}?${new URLSearchParams({ directory })}`;
  const migratedAsset = await (await page.request.get(assetPath)).json();
  expect(migratedAsset.preview, `preview after browser migration: ${JSON.stringify(migratedAsset)}`).toBeTruthy();
  await dialog.getByLabel("选择完整资料库备份").setInputFiles((await download.path())!);
  await expect(dialog.getByLabel("恢复预览")).toBeVisible();
  expect((await (await page.request.get(assetPath)).json()).preview, "preview after ZIP import").toBeTruthy();
  await dialog.getByRole("button", { name: "确认恢复此版本", exact: true }).click();
  await expect(dialog.getByText("已恢复资料库，原版本已保留。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭研究笔记设置", exact: true }).click();
  await expect(block.getByRole("img")).toBeVisible();
  await expect(block.getByRole("textbox", { name: "图片图注", exact: true })).toHaveValue("浏览器附件备份");
});

test("keeps reused originals intact when replacement fails or succeeds and removes cancelled empty insertions", async ({ page }) => {
  const inserted = await insertImage(page);
  await inserted.getByLabel("选择图片文件", { exact: true }).setInputFiles([
    { name: "shared.png", mimeType: "image/png", buffer: png },
    { name: "shared-copy.png", mimeType: "image/png", buffer: png },
  ]);
  const blocks = page.locator(".research-media-block"), first = blocks.nth(0), second = blocks.nth(1);
  await expect(blocks).toHaveCount(2);
  await expect(first.getByRole("img")).toBeVisible(); await expect(second.getByRole("img")).toBeVisible();
  const oldSrc = await first.getByRole("img").getAttribute("src");
  const sharedSrc = await second.getByRole("img").getAttribute("src");
  await first.getByRole("button", { name: "替换图片", exact: true }).click();
  await first.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(first.getByRole("alert")).toContainText("文件内容不是受支持的图片");
  await expect(first.getByRole("img")).toHaveAttribute("src", oldSrc!);
  await first.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "new.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from("replacement")]) });
  await expect(first.getByRole("img")).not.toHaveAttribute("src", oldSrc!);
  await expect(second.getByRole("img")).toHaveAttribute("src", sharedSrc!);
  const empty = await insertImage(page);
  await empty.getByLabel("选择图片文件", { exact: true }).dispatchEvent("cancel");
  await expect(blocks).toHaveCount(2);
  await page.reload();
  await expect(blocks.locator("img")).toHaveCount(2);
  await expect(second.getByRole("img")).toBeVisible();
});

test("routes image paste from media controls and body editors while leaving formula paste alone", async ({ page }) => {
  const block = await insertImage(page);
  await block.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "start.png", mimeType: "image/png", buffer: png });
  await expect(block.getByRole("img")).toBeVisible();
  expect(await pasteImage(page, '.research-media-open')).toBe(true);
  await expect(page.locator(".research-media-block")).toHaveCount(1);
  await page.getByRole("button", { name: "在笔记末尾插入", exact: true }).click();
  await page.getByRole("dialog", { name: "插入笔记内容" }).getByRole("button", { name: "段落", exact: true }).click();
  const paragraph = page.getByRole("textbox", { name: "笔记段落", exact: true });
  await paragraph.click();
  expect(await pasteImage(page, "textarea.research-text-source")).toBe(true);
  await expect(page.locator(".research-media-block")).toHaveCount(2);
  await page.getByRole("button", { name: "在笔记末尾插入", exact: true }).click();
  await page.getByRole("dialog", { name: "插入笔记内容" }).getByRole("button", { name: "公式", exact: true }).click();
  const formula = page.locator(".research-formula-composer");
  await expect(formula).toBeVisible();
  expect(await pasteImage(page, ".research-formula-composer")).toBe(false);
  await expect(page.locator(".research-media-block")).toHaveCount(2);
});

test("pastes into an empty nested tab, accepts file drop, and renders the image in reading mode", async ({ page }) => {
  await page.getByRole("button", { name: "在笔记末尾插入", exact: true }).click();
  await page.getByRole("dialog", { name: "插入笔记内容" }).getByRole("button", { name: "标签页", exact: true }).click();
  const tabs = page.getByRole("group", { name: "标签页", exact: true });
  await tabs.getByRole("button", { name: "添加标签", exact: true }).click();
  expect(await pasteImage(page, ".research-example-body")).toBe(true);
  await expect(tabs.locator(".research-media-block img")).toHaveCount(1);
  const body = tabs.locator(".research-example-body");
  await body.evaluate((element, bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, [...png]);
  await expect(tabs.locator(".research-media-block img")).toHaveCount(2);
  await page.getByRole("button", { name: "切换为只读模式", exact: true }).click();
  await expect(tabs.locator(".research-media-block img")).toHaveCount(2);
  await expect(tabs.getByRole("textbox", { name: "图片图注", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(tabs.locator(".research-media-block img")).toHaveCount(2);
});

test("pauses a remote download, resumes it, and keeps the saved image available offline", async ({ page }) => {
  const dialog = await connect(page);
  await dialog.getByRole("button", { name: "关闭研究笔记设置", exact: true }).click();
  const local = await insertImage(page);
  await local.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "offline.png", mimeType: "image/png", buffer: png });
  await expect(local.getByRole("img")).toBeVisible();
  const assetId = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].source.assetId as string);
  const directory = path.join(root, "资料库");
  const metadata = await page.request.get(`/api/research-library/media/assets/${assetId}?${new URLSearchParams({ directory })}`);
  const asset: unknown = await metadata.json();
  let attempts = 0, paused = false;
  await page.route("**/api/research-library/media/remote", async route => {
    attempts++;
    await route.fulfill({ json: { id: "remote-ui-test", status: attempts === 1 ? "downloading" : "complete", bytes: png.length, total: png.length, ...(attempts > 1 ? { asset } : {}) } });
  });
  await page.route("**/api/research-library/media/remote/remote-ui-test?**", route => route.fulfill({ json: { id: "remote-ui-test", status: "downloading", bytes: 32, total: png.length } }));
  await page.route("**/api/research-library/media/remote/remote-ui-test/pause", route => { paused = true; return route.fulfill({ json: { id: "remote-ui-test", status: "paused", bytes: 32 } }); });
  await page.route("https://media.example.test/remote.png", route => route.fulfill({ contentType: "image/png", body: png }));
  const remote = await insertImage(page);
  await remote.getByRole("textbox", { name: "图片网址", exact: true }).fill("https://media.example.test/remote.png");
  await remote.getByRole("button", { name: "使用链接", exact: true }).click();
  await remote.getByRole("button", { name: "下载并保存图片", exact: true }).click();
  await expect(remote.getByRole("progressbar")).toBeVisible();
  await remote.getByRole("button", { name: "暂停图片导入", exact: true }).click();
  await expect.poll(() => paused).toBe(true);
  await expect(remote).toHaveAttribute("data-media-source", "url");
  await expect(remote.getByRole("alert")).toContainText("暂停");
  await remote.getByRole("button", { name: "下载并保存图片", exact: true }).click();
  await expect(remote).toHaveAttribute("data-media-source", "asset");
  await page.unroute("https://media.example.test/remote.png");
  await page.route("https://media.example.test/remote.png", route => route.abort());
  await page.reload();
  await expect(page.locator(".research-media-block img")).toHaveCount(2);
  await expect(page.locator(".research-media-block img").last()).toBeVisible();
});

test("reassociates a missing original and refreshes all blocks sharing it without reloading", async ({ page }) => {
  await migrate(page, path.join(root, "资料库"));
  const initial = await insertImage(page);
  await initial.getByLabel("选择图片文件", { exact: true }).setInputFiles([
    { name: "recover.png", mimeType: "image/png", buffer: png },
    { name: "shared.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.locator(".research-media-block img")).toHaveCount(2);
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].source.assetId as string);
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  await rm(path.join(root, "资料库", "assets", id + ".png"));
  await rm(path.join(root, "资料库", "assets", id + ".preview.webp"), { force: true });
  await page.reload();
  const first = page.locator(".research-media-block").first();
  await expect(first.getByRole("button", { name: "重新关联", exact: true })).toBeVisible();
  await first.getByRole("button", { name: "重新关联", exact: true }).click();
  await first.getByLabel("选择图片文件", { exact: true }).setInputFiles({ name: "recover.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".research-media-block img")).toHaveCount(2);
  await expect.poll(async () => page.locator(".research-media-block img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks.map((block: { source: { assetId: string } }) => block.source.assetId))).toEqual([id, id]);
});

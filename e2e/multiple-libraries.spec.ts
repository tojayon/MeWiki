import { closeSettingsPage } from "./helpers/settings.ts";
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  runNotebookAction,
  enableNotebookEditing,
} from "./helpers/researchNotebook.ts";
const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || ".mewiki/media-e2e-settings.json");
let root = "";
test.beforeEach(async () => {
  await rm(settings, { force: true });
  root = await mkdtemp(path.join(tmpdir(), "mewiki-multilib-e2e-"));
});
test.afterEach(async () => {
  await rm(settings, { force: true });
  if (
    path.dirname(root) === path.resolve(tmpdir()) &&
    path.basename(root).startsWith("mewiki-multilib-e2e-")
  )
    await rm(root, { recursive: true, force: true });
});
async function manager(page: Page) {
  const dialog = page.getByTestId("mewiki-library-manager");
  if (!(await dialog.isVisible()))
    await runNotebookAction(
      page.getByTestId("research-notebook"),
      "切换资料库",
    );
  return dialog;
}
async function create(page: Page, name: string, directory: string) {
  const dialog = await manager(page);
  await dialog.getByRole("button", { name: "新建资料库", exact: true }).click();
  await dialog.getByLabel("资料库名称", { exact: true }).fill(name);
  await dialog.getByLabel("资料库文件夹", { exact: true }).fill(directory);
  await dialog.getByRole("button", { name: "创建并打开", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `当前资料库：${name}，切换资料库`,
      exact: true,
    }),
  ).toBeVisible();
  return new URL(page.url()).searchParams.get("library")!;
}
async function note(page: Page, title: string) {
  const panel = page.getByTestId("research-notebook");
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.getByRole("button", { name: "新建笔记", exact: true }).click();
  await enableNotebookEditing(panel);
  await panel.getByLabel("笔记标题", { exact: true }).fill(title);
  await panel.getByLabel("笔记标题", { exact: true }).press("Tab");
}
test("creates separate libraries, flushes before switching and remembers each entry independently", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const research = path.join(root, "Cislunar");
  const personal = path.join(root, "Personal");
  const researchId = await create(page, "Cislunar", research);
  await expect(page.getByRole("tab", { name: "使用手册", exact: true })).toBeVisible();
  await runNotebookAction(page.getByTestId("research-notebook"), "使用手册");
  await expect(page.getByRole("tab", { name: "使用手册", exact: true })).toHaveCount(0);
  await note(page, "Cislunar 的专属研究");
  let dialog = await manager(page);
  const row = dialog.locator(`[data-library-id="${researchId}"]`);
  await row
    .getByRole("button", { name: "设为 WebBench 默认", exact: true })
    .click();
  await expect(row).toContainText("WebBench 默认");
  await expect(dialog.getByRole("status")).not.toContainText("正在保存");
  await closeSettingsPage(page);
  const personalId = await create(page, "个人 Wiki", personal);
  await expect(page.getByRole("tab", { name: "使用手册", exact: true })).toBeVisible();
  await expect(page.getByTestId("research-notebook")).not.toContainText(
    "Cislunar 的专属研究",
  );
  await note(page, "个人 Wiki 的专属笔记");
  dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到Cislunar", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "Cislunar 的专属研究",
  );
  await expect(page.getByRole("tab", { name: "使用手册", exact: true })).toHaveCount(0);
  expect(
    await readFile(
      path.join(personal, "research-library.webbench.json"),
      "utf8",
    ),
  ).not.toContain("Cislunar 的专属研究");
  const host = await context.newPage();
  await host.goto("/?workspace=org.mewiki.webbench");
  await expect(host.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "Cislunar 的专属研究",
  );
  dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到个人 Wiki", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "个人 Wiki 的专属笔记",
  );
  await expect(host.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "Cislunar 的专属研究",
  );
  await page.reload();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "个人 Wiki 的专属笔记",
  );
  await page.goto("/");
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "个人 Wiki 的专属笔记",
  );
  expect(new URL(page.url()).searchParams.get("library")).toBe(personalId);
  expect(new URL(host.url()).searchParams.get("library")).toBe(researchId);
  await page.setViewportSize({ width: 390, height: 844 });
  dialog = await manager(page);
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/multiple-libraries-mobile.png" });
  await closeSettingsPage(page);
  await host.close();
});
test("failed saves and missing target libraries retain the current notebook", async ({
  page,
}) => {
  await page.goto("/");
  const id = await create(page, "Cislunar", path.join(root, "Cislunar"));
  await create(page, "个人 Wiki", path.join(root, "Personal"));
  await page.route("**/api/research-library?library=*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, json: { error: "TEST_SAVE_FAILURE" } })
      : route.continue(),
  );
  await note(page, "保存失败时保留的正文");
  const dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到Cislunar", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("TEST_SAVE_FAILURE");
  expect(new URL(page.url()).searchParams.get("library")).not.toBe(id);
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "保存失败时保留的正文",
  );
});

test("configures a default library for a generic external entry without switching open windows", async ({ page, context }) => {
  await page.goto("/");
  const projectId = await create(page, "项目资料", path.join(root, "Project"));
  await note(page, "项目资料的笔记");
  const personalId = await create(page, "个人资料", path.join(root, "Personal"));
  await note(page, "个人资料的笔记");

  const external = await context.newPage();
  await external.goto(`/?workspace=org.example.instrument&library=${projectId}`);
  await expect(external.getByLabel("笔记标题", { exact: true })).toHaveValue("项目资料的笔记");
  const dialog = await manager(external);
  const entry = dialog.getByLabel("默认资料库入口", { exact: true });
  await entry.selectOption("org.example.instrument");
  const row = dialog.locator(`[data-library-id="${personalId}"]`);
  await row.getByRole("button", { name: "设为 org.example.instrument 默认", exact: true }).click();
  await expect(row).toContainText("org.example.instrument 默认");
  await closeSettingsPage(external);
  await expect(external.getByLabel("笔记标题", { exact: true })).toHaveValue("项目资料的笔记");
  expect(await external.evaluate(() => localStorage.getItem("mewiki:workspace:org.example.instrument:library"))).toBe(personalId);
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("个人资料的笔记");

  const next = await context.newPage();
  await next.goto("/?workspace=org.example.instrument");
  await expect(next.getByLabel("笔记标题", { exact: true })).toHaveValue("个人资料的笔记");
  expect(new URL(next.url()).searchParams.get("library")).toBe(personalId);
  expect(new URL(external.url()).searchParams.get("library")).toBe(projectId);
  await next.close();
  await external.close();
});

test("keeps original attachments and browser caches with their owning library", async ({
  page,
}) => {
  await page.goto("/");
  const a = path.join(root, "Research");
  const b = path.join(root, "Personal");
  const aId = await create(page, "Cislunar", a);
  await note(page, "带图片的研究");
  await page
    .getByRole("button", { name: "在笔记末尾插入", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "插入笔记内容", exact: true })
    .getByRole("button", { name: "图片", exact: true })
    .click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAN0lEQVRIie2WsQ0AAAjC+JqfeLKe4dKB3QSEpoNPxQOqBTOE+IZYRLWK5xjhHCOQVCSbUMpLDg7V2l2IkGDTEwAAAABJRU5ErkJggg==",
    "base64",
  );
  await page
    .getByLabel("选择图片文件", { exact: true })
    .setInputFiles({
      name: "research.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(page.locator(".research-media-block img")).toBeVisible();
  const bId = await create(page, "个人 Wiki", b);
  await expect(page.locator(".research-media-block img")).toHaveCount(0);
  expect(await stat(path.join(b, "assets")).catch(() => null)).toBeNull();
  const cache = await page.evaluate(
    ({ aId, bId }) => ({
      a: localStorage.getItem(`mewiki:library:${aId}:notebook`),
      b: localStorage.getItem(`mewiki:library:${bId}:notebook`),
    }),
    { aId, bId },
  );
  expect(cache.a).toContain("带图片的研究");
  expect(cache.b).not.toContain("带图片的研究");
  const dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到Cislunar", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".research-media-block img")).toBeVisible();
  await page.reload();
  await expect(page.locator(".research-media-block img")).toBeVisible();
});

test("reloads an inactive browser library after another window edits it", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await note(page, "原来的浏览器笔记");
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "原来的浏览器笔记",
  );
  await create(page, "个人 Wiki", path.join(root, "Personal"));
  await enableNotebookEditing(other.getByTestId("research-notebook"));
  await other.getByLabel("笔记标题", { exact: true }).fill("另一窗口的新修改");
  await other.getByLabel("笔记标题", { exact: true }).press("Tab");
  const dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到浏览器资料库", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "另一窗口的新修改",
  );
  await expect(other.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "另一窗口的新修改",
  );
  await other.close();
});
test("retries a temporarily unavailable target without reloading the current page", async ({
  page,
}) => {
  await page.goto("/");
  const a = await create(page, "Cislunar", path.join(root, "Research"));
  await create(page, "个人 Wiki", path.join(root, "Personal"));
  let failed = true;
  await page.route(`**/api/research-library?library=${a}`, (route) =>
    failed
      ? route.fulfill({
          status: 503,
          json: { error: "TARGET_TEMPORARILY_OFFLINE" },
        })
      : route.continue(),
  );
  const dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到Cislunar", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "TARGET_TEMPORARILY_OFFLINE",
  );
  failed = false;
  await dialog
    .getByRole("button", { name: "切换到Cislunar", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(new URL(page.url()).searchParams.get("library")).toBe(a);
});
test("observes browser edits made while switching back is waiting for its response", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await note(page, "切换前的浏览器内容");
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "切换前的浏览器内容",
  );
  await create(page, "个人 Wiki", path.join(root, "Personal"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/api/research-library", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  const dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到浏览器资料库", exact: true })
    .click();
  await pending;
  await enableNotebookEditing(other.getByTestId("research-notebook"));
  await other
    .getByLabel("笔记标题", { exact: true })
    .fill("等待切换期间的新修改");
  await other.getByLabel("笔记标题", { exact: true }).press("Tab");
  release();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "等待切换期间的新修改",
  );
  await other.close();
});
test("reads the latest browser contents when initial library loading is delayed", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await note(page, "首次打开前的内容");
  const other = await context.newPage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await other.route("**/api/research-library", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  await other.goto("/");
  await pending;
  await page
    .getByLabel("笔记标题", { exact: true })
    .fill("加载等待期间的新内容");
  await page.getByLabel("笔记标题", { exact: true }).press("Tab");
  release();
  await expect(other.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "加载等待期间的新内容",
  );
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "加载等待期间的新内容",
  );
  await other.close();
});
test("keeps a readable workspace when another window removes its registration", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const a = await create(page, "Cislunar", path.join(root, "Research"));
  const b = await create(page, "个人 Wiki", path.join(root, "Personal"));
  const other = await context.newPage();
  await other.goto(`/?library=${a}`);
  await expect(other.getByTestId("research-notebook")).toBeVisible();
  await other.route(`**/api/research-library?library=${a}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          json: { error: "UNSAVED_BEFORE_REMOVAL" },
        })
      : route.continue(),
  );
  await note(other, "移除前尚未保存的修改");
  const dialog = await manager(page);
  await dialog
    .locator(`[data-library-id="${a}"]`)
    .getByRole("button", { name: "从列表移除", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  const removed = await manager(other);
  const personal = removed.locator(`[data-library-id="${b}"]`);
  await personal
    .getByRole("button", { name: "设为 WebBench 默认", exact: true })
    .click();
  await expect(removed.getByRole("alert")).toContainText(
    "已在其他窗口从列表移除",
  );
  await expect(other.getByTestId("research-notebook")).toBeVisible();
  await personal
    .getByRole("button", { name: "切换到个人 Wiki", exact: true })
    .click();
  await expect(removed.getByRole("alert").last()).toContainText(
    "请先导出当前修改",
  );
  const downloadEvent = other.waitForEvent("download");
  await removed
    .getByRole("button", { name: "导出当前修改", exact: true })
    .click();
  const download = await downloadEvent;
  const downloadedPath = await download.path();
  expect(await readFile(downloadedPath!, "utf8")).toContain(
    "移除前尚未保存的修改",
  );
  await personal
    .getByRole("button", { name: "切换到个人 Wiki", exact: true })
    .click();
  await expect(removed).not.toBeVisible();
  expect(new URL(other.url()).searchParams.get("library")).toBe(b);
  expect(errors).toEqual([]);
  await other.close();
});

test("keeps a conflicting recovered draft separate from a newer disk version", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const directory = path.join(root, "Research");
  const a = await create(page, "Cislunar", directory);
  await note(page, "原来保存的研究");
  await create(page, "个人 Wiki", path.join(root, "Personal"));
  const original = JSON.parse(
    await readFile(
      path.join(directory, "research-library.webbench.json"),
      "utf8",
    ),
  );
  const draft = structuredClone(original.notebook);
  draft.notes.find(
    (item: { title: string }) => item.title === "原来保存的研究",
  ).title = "待恢复的旧草稿";
  await page.evaluate(
    ({ a, directory, original, draft }) => {
      sessionStorage.setItem(
        `mewiki:library:${a}:pending`,
        JSON.stringify({
          directory,
          baseRevision: original.revision,
          notebook: draft,
        }),
      );
    },
    { a, directory, original, draft },
  );
  const newer = structuredClone(original.notebook);
  newer.notes.find(
    (item: { title: string }) => item.title === "原来保存的研究",
  ).title = "其他窗口的新版本";
  const saved = await request.put(`/api/research-library?library=${a}`, {
    headers: { "X-WebBench-Request": "research-library" },
    data: { directory, baseRevision: original.revision, notebook: newer },
  });
  expect(saved.ok()).toBe(true);
  await page.reload();
  const dialog = await manager(page);
  await dialog
    .getByRole("button", { name: "切换到Cislunar", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("修改已保留");
  expect(
    await readFile(
      path.join(directory, "research-library.webbench.json"),
      "utf8",
    ),
  ).toContain("其他窗口的新版本");
  expect(
    await page.evaluate(
      (a) => sessionStorage.getItem(`mewiki:library:${a}:pending`),
      a,
    ),
  ).toContain("待恢复的旧草稿");
});

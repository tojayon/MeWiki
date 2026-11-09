import { expect, type Locator } from "@playwright/test";

/** Editing tests opt in through the same switch a reader uses. */
export async function enableNotebookEditing(panel: Locator) {
  await expect(panel.getByRole("toolbar", { name: "笔记管理", exact: true })).toBeVisible();
  const title = panel.getByLabel("笔记标题", { exact: true });
  if (await title.getAttribute("readonly") !== null) await runNotebookAction(panel, "切换为编辑模式");
  await expect(title).toBeEditable();
}

/** Narrow reading panes expose the same action in the shared function menu. */
export async function runNotebookAction(panel: Locator, name: string) {
  await expect(panel.getByRole("toolbar", { name: "笔记管理", exact: true })).toBeVisible();
  const direct = panel.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    try {
      await direct.click({ timeout: 1500 });
      return;
    } catch (error) {
      // A responsive header can collect the action between observation and click.
      if (await direct.isVisible()) throw error;
    }
  }
  const menu = await openNotebookMoreMenu(panel);
  await menu.getByRole("menuitem", { name, exact: true }).click();
}

export async function expectNotebookAction(panel: Locator, name: string) {
  await expect(panel.getByRole("toolbar", { name: "笔记管理", exact: true })).toBeVisible();
  const direct = panel.getByRole("button", { name, exact: true });
  if (!await direct.isVisible()) await openNotebookMoreMenu(panel);
  await expect(direct.or(panel.getByRole("menuitem", { name, exact: true }))).toBeVisible();
  const menu = panel.getByRole("menu", { name: "更多笔记功能", exact: true });
  if (await menu.isVisible()) await menu.press("Escape");
}

export async function openNotebookMetadata(panel: Locator) {
  const metadata = panel.getByRole("dialog", { name: "笔记元数据", exact: true });
  if (!await metadata.isVisible()) await runNotebookAction(panel, "笔记元数据");
  await expect(metadata).toBeVisible();
  return metadata;
}

export async function openNotebookMoreMenu(panel: Locator) {
  const menu = panel.getByRole("menu", { name: "更多笔记功能", exact: true });
  if (!await menu.isVisible()) await panel.getByRole("button", { name: "更多笔记功能", exact: true }).click();
  await expect(menu).toBeVisible();
  return menu;
}

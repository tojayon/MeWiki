import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Page } from "@playwright/test";
import { type ResearchNotebookBlock } from "../src/domain/researchNotebook.ts";
import { enableNotebookEditing } from "./helpers/researchNotebook.ts";

const rawTex =
  "\\begin{aligned}\n\\boldsymbol{u}(t)&=-\\boldsymbol{K}\\boldsymbol{x}(t)\\\\\nx_{k+1}&=Ax_k+Bu_k\n\\end{aligned}";

async function openCopyNote(page: Page) {
  const state = createResearchNotebook();
  const blocks: ResearchNotebookBlock[] = [
    {
      id: "copy-structured",
      type: "formula",
      tex: "\\text{outdated}",
      layout: "aligned",
      caption: "结构化公式",
      parts: [
        {
          type: "symbol",
          entryId: "example-vector",
          bindings: { x1: "(p)", x2: "k", x3: "(t)" },
        },
        { type: "alignmentPoint" },
        { type: "operator", operator: "equals" },
        { type: "operator", operator: "zero" },
        { type: "lineBreak" },
        {
          type: "symbol",
          entryId: "example-input",
          bindings: { x1: "", x2: "", x3: "(t)" },
        },
        { type: "alignmentPoint" },
        { type: "operator", operator: "equals" },
        { type: "operator", operator: "one" },
      ],
    },
    { id: "copy-raw", type: "formula", tex: rawTex, caption: "原始 LaTeX" },
  ];
  const note = {
    ...state.notes[0],
    library: "research" as const,
    id: "formula-copy-note",
    title: "公式复制检查",
    blocks,
  };
  const snapshot = {
    ...state,
    open: true,
    view: "notes",
    activeNoteId: note.id,
    notes: [note],
  };
  await page.addInitScript((initial) => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(initial));
  }, snapshot);
  await page.goto("/?page=research-notebook");
  const panel = page.getByTestId("research-notebook");
  // The copy baseline starts after the local library has finished loading.
  await expect(panel.getByTestId("research-library-save-status")).toBeVisible();
  return panel;
}

test("copies the displayed structured LaTeX in reading mode without changing the note", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openCopyNote(page);
  const formula = panel.locator('[data-formula-id="copy-structured"]');
  const before = await page.evaluate(() =>
    localStorage.getItem("mewiki:research-notebook"),
  );
  const source = await formula
    .locator('annotation[encoding="application/x-tex"]')
    .textContent();
  expect(source).toContain("\\begin{aligned}");
  expect(source).toContain("^{(p)}");
  expect(source).not.toContain("outdated");
  await formula.hover();
  const copy = formula.getByRole("button", {
    name: "复制公式 LaTeX",
    exact: true,
  });
  await expect(copy).toHaveCSS("opacity", "1");
  await copy.click();
  await expect(
    formula.getByRole("button", { name: "公式 LaTeX 已复制", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    source,
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("mewiki:research-notebook"),
    ),
  ).toBe(before);
  await expect(copy).toBeVisible();
});

test("copies raw multiline LaTeX unchanged on a narrow screen", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openCopyNote(page);
  await panel
    .getByRole("button", { name: "收起笔记左侧面板", exact: true })
    .click();
  const formula = panel.locator('[data-formula-id="copy-raw"]');
  await formula
    .getByRole("button", { name: "复制公式 LaTeX", exact: true })
    .click();
  await expect(
    formula.getByRole("button", { name: "公式 LaTeX 已复制", exact: true }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // Windows clipboard text uses CRLF; line endings do not change the LaTeX.
  expect(copied.replace(/\r\n/g, "\n")).toBe(rawTex);
});

test("uses the same unframed icon style without overlapping the other formula actions", async ({
  page,
}) => {
  const panel = await openCopyNote(page);
  await enableNotebookEditing(panel);
  const formula = panel.locator('[data-formula-id="copy-structured"]');
  await formula.hover();
  const actions = [
    "复制公式 LaTeX",
    "编辑公式",
    "公式设置",
    "删除笔记内容块",
  ].map((name) => formula.getByRole("button", { name, exact: true }));
  const measure = (element: Element) => {
    const style = getComputedStyle(element);
    const icon = element.querySelector("svg")!.getBoundingClientRect();
    return {
      width: style.width,
      height: style.height,
      border: style.borderWidth,
      background: style.backgroundColor,
      iconWidth: icon.width,
      iconHeight: icon.height,
    };
  };
  const expected = await actions[1].evaluate(measure);
  expect(expected.background).toBe("rgba(0, 0, 0, 0)");
  expect(expected.border).toBe("0px");
  const boxes = [];
  for (const action of actions) {
    expect(await action.evaluate(measure)).toEqual(expected);
    boxes.push((await action.boundingBox())!);
  }
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].x).toBe(boxes[0].x);
    expect(boxes[i].y).toBeGreaterThanOrEqual(
      boxes[i - 1].y + boxes[i - 1].height,
    );
  }
  const formulaBox = (await formula.boundingBox())!;
  expect(boxes.at(-1)!.y + boxes.at(-1)!.height).toBeLessThanOrEqual(
    formulaBox.y + formulaBox.height,
  );
  await actions[0].hover();
  await expect(actions[0]).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(actions[0]).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("reports clipboard rejection without showing a successful copy", async ({
  page,
}) => {
  const panel = await openCopyNote(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
    });
  });
  const formula = panel.locator('[data-formula-id="copy-structured"]');
  await formula
    .getByRole("button", { name: "复制公式 LaTeX", exact: true })
    .click();
  await expect(formula.getByRole("status")).toHaveText(
    "复制失败，请允许浏览器访问剪贴板后重试。",
  );
  await expect(
    formula.getByRole("button", { name: "公式 LaTeX 已复制", exact: true }),
  ).toHaveCount(0);
});

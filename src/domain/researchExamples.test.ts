import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { commitResearchTextBlock, convertResearchBlockType, createResearchContentBlock, createResearchNote, insertResearchBlock, normalizeResearchNotebook, parseResearchMarkdown, removeResearchBlock, serializeResearchMarkdown, updateResearchNote, type ResearchNote, type ResearchNotebookBlock } from "./researchNotebook.ts";
import {
  defaultResearchNoteFilters,
  filterResearchNotes,
} from "./researchNoteOrganization.ts";
import {
  createResearchLibraryFile,
  parseResearchLibraryFile,
} from "../state/researchLibraryFile.ts";
import type { ResearchExamplesBlock } from "./researchExamples.ts";
import {
  findResearchBlock,
  flattenResearchBlocks,
  getResearchBlockContainer,
  mapResearchBlocks,
  replaceResearchBlockContainer,
  updateResearchBlockTree,
} from "./researchBlockTree.ts";

const examples = {
  id: "examples",
  type: "examples",
  section: "given",
  tabs: [
    {
      id: "scalar",
      title: "标量系统",
      blocks: [
        {
          id: "scalar-text",
          type: "paragraph",
          text: "**状态反馈**：$x(t)$。",
        },
        { id: "scalar-list", type: "list", items: ["测量", "执行"] },
        {
          id: "scalar-formula",
          type: "formula",
          tex: "x_{k+1}=a x_k+b u_k",
          outputs: [{ id: "state-result", entryId: "state", bindings: {} }],
        },
      ],
    },
    {
      id: "matrix",
      title: "矩阵 <--> 例子",
      blocks: [
        {
          id: "matrix-quote",
          type: "markdown",
          kind: "quote",
          text: "> 嵌套引用",
        },
        {
          id: "matrix-code",
          type: "markdown",
          kind: "code",
          text: '```md\n<!-- webbench-example: {"id":"fake","title":"代码"} -->\n<!-- webbench-section: conclusion -->\n```',
        },
        {
          id: "matrix-formula",
          type: "formula",
          tex: "x",
          parts: [
            {
              type: "symbol",
              entryId: "state",
              bindings: {},
              source: {
                noteId: "example-note",
                formulaId: "scalar-formula",
                outputId: "state-result",
              },
            },
          ],
        },
      ],
    },
    { id: "empty", title: "待补充", blocks: [] },
  ],
} satisfies ResearchNotebookBlock;
const notebook = () => {
  const note = {
    ...createResearchNote("举例笔记"),
    id: "example-note",
    reviewStatus: "reviewed" as const,
    blocks: [examples] as ResearchNotebookBlock[],
  };
  return { ...createResearchNotebook(), notes: [note], activeNoteId: note.id };
};
const remappedMarkdownBlocks = (note: ResearchNote, newNoteId: string) =>
  mapResearchBlocks(note.blocks, (block) =>
    block.type === "formula" && block.parts
      ? {
          ...block,
          parts: block.parts.map((part) =>
            part.type === "symbol" && part.source?.noteId === note.id
              ? { ...part, source: { ...part.source, noteId: newNoteId } }
              : part,
          ),
        }
      : block,
  );

describe("tabbed examples in research notes", () => {
  it("creates two independent examples and preserves all text when converting types", () => {
    const created = createResearchContentBlock("examples");
    expect(created).toMatchObject({
      type: "examples",
      tabs: [
        { title: "标签 1", blocks: [] },
        { title: "标签 2", blocks: [] },
      ],
    });
    const tabs = (created as ResearchExamplesBlock).tabs;
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(2);
    const converted = convertResearchBlockType(
      { id: "p", type: "paragraph", text: "原文 $x$", section: "given" },
      "examples",
    );
    expect(converted).toMatchObject({
      id: "p",
      type: "examples",
      section: "given",
      tabs: [
        { blocks: [{ type: "paragraph", text: "原文 $x$" }] },
        { blocks: [] },
      ],
    });
    const firstChild = (converted as ResearchExamplesBlock).tabs[0].blocks[0];
    expect(firstChild.id).not.toBe("p");
    const plain = convertResearchBlockType(examples, "paragraph");
    expect(plain).toMatchObject({
      id: "examples",
      section: "given",
      type: "paragraph",
    });
    expect((plain as { text: string }).text).toContain(
      "标量系统\n**状态反馈**",
    );
    expect((plain as { text: string }).text).toContain(
      "矩阵 <--> 例子\n> 嵌套引用",
    );
  });

  it("retains empty examples, their order and stable identities through browser storage", () => {
    const state = notebook();
    expect(
      normalizeResearchNotebook(JSON.parse(JSON.stringify(state))).notes[0]
        .blocks,
    ).toEqual([examples]);
  });

  it("repairs duplicate or missing tab identities without discarding their content", () => {
    const state = notebook();
    state.notes[0].blocks = [
      {
        id: "repair",
        type: "examples",
        tabs: [
          { id: "same", title: "一", text: "保留一" },
          { id: "same", title: "二", text: "保留二" },
          { text: "保留三" },
        ],
      } as unknown as ResearchNotebookBlock,
    ];
    const block = normalizeResearchNotebook(state).notes[0]
      .blocks[0] as ResearchExamplesBlock;
    expect(block.tabs.map((tab) => tab.blocks)).toEqual([
      [expect.objectContaining({ type: "paragraph", text: "保留一" })],
      [expect.objectContaining({ type: "paragraph", text: "保留二" })],
      [expect.objectContaining({ type: "paragraph", text: "保留三" })],
    ]);
    expect(new Set(block.tabs.map((tab) => tab.id)).size).toBe(3);
  });

  it("includes every example in search and invalidates review when its content changes", () => {
    const state = notebook();
    expect(
      filterResearchNotes(state.notes, {
        ...defaultResearchNoteFilters,
        query: "嵌套引用",
      }),
    ).toHaveLength(1);
    expect(
      filterResearchNotes(state.notes, {
        ...defaultResearchNoteFilters,
        query: "待补充",
      }),
    ).toHaveLength(1);
    const next = updateResearchNote(state, state.activeNoteId, {
      blocks: [convertResearchBlockType(examples, "paragraph")!],
    });
    expect(next.notes[0].reviewStatus).toBe("pending");
  });

  it("round trips readable Markdown, empty bodies, sections and adjacent content", () => {
    const note = {
      ...createResearchNote("交换"),
      blocks: [
        { id: "before", type: "paragraph", text: "开始" },
        examples,
        { id: "after", type: "paragraph", text: "结束" },
        {
          id: "quote-after",
          type: "markdown",
          kind: "quote",
          text: "> 普通引用",
        },
      ] as ResearchNotebookBlock[],
    };
    const markdown = serializeResearchMarkdown(note);
    expect(markdown).toContain("webbench-examples");
    expect(markdown).toContain("> **状态反馈**");
    const imported = parseResearchMarkdown(markdown, note.title);
    const content = (blocks: ResearchNotebookBlock[]) =>
      blocks.map(({ id: _id, ...block }) => block);
    expect(content(imported.blocks)).toEqual(content(note.blocks));
  });

  it("does not interpret markers in code or consume malformed example groups", () => {
    const note = parseResearchMarkdown(
      "```md\n<!-- webbench-examples -->\n```\n\n<!-- webbench-examples -->\n\n> **举例**\n>\n> <!-- webbench-example: broken -->\n>\n> 原样保留\n\n尾部",
    );
    expect(note.blocks.map((block) => block.type)).not.toContain("examples");
    expect(note.blocks[0]).toMatchObject({ type: "markdown", kind: "code" });
    expect(
      note.blocks.some(
        (block) => "text" in block && block.text.includes("原样保留"),
      ),
    ).toBe(true);
    expect(note.blocks.at(-1)).toMatchObject({
      type: "paragraph",
      text: "尾部",
    });
  });

  it("keeps all tab content in complete library backups and rejects incomplete tabs", async () => {
    const state = notebook();
    const file = await createResearchLibraryFile(state);
    expect(
      (await parseResearchLibraryFile(JSON.stringify(file))).notebook.notes[0]
        .blocks,
    ).toEqual([examples]);
    state.notes[0].blocks = [
      {
        id: "bad",
        type: "examples",
        tabs: [
          {
            id: "x",
            title: "坏数据",
            blocks: [{ id: "p", type: "paragraph", text: 9 }],
          },
        ],
      } as unknown as ResearchNotebookBlock,
    ];
    await expect(createResearchLibraryFile(state)).rejects.toThrow("格式");
  });

  it("rejects duplicate tab IDs before saving a backup", async () => {
    const state = notebook();
    state.notes[0].blocks = [
      {
        id: "dup",
        type: "examples",
        tabs: [
          { id: "same", title: "一", blocks: [] },
          { id: "same", title: "二", blocks: [] },
        ],
      } as unknown as ResearchNotebookBlock,
    ];
    await expect(createResearchLibraryFile(state)).rejects.toThrow("重复");
  });

  it("inserts, edits and removes child blocks inside the requested example", () => {
    const state = notebook();
    const child: ResearchNotebookBlock = {
      id: "new-child",
      type: "paragraph",
      text: "新内容",
    };
    const next = insertResearchBlock(
      state,
      state.activeNoteId,
      child,
      "scalar-list",
      { exampleBlockId: "examples", tabId: "scalar" },
    );
    expect(
      (next.notes[0].blocks[0] as ResearchExamplesBlock).tabs[0].blocks.map(
        (block) => block.id,
      ),
    ).toEqual(["scalar-text", "new-child", "scalar-list", "scalar-formula"]);
    expect(next.notes[0].reviewStatus).toBe("pending");
    const edited = commitResearchTextBlock(
      next,
      state.activeNoteId,
      "new-child",
      "修改后的内容",
    );
    expect(
      (edited.notes[0].blocks[0] as ResearchExamplesBlock).tabs[0].blocks[1],
    ).toMatchObject({ text: "修改后的内容" });
    const removed = removeResearchBlock(
      edited,
      state.activeNoteId,
      "new-child",
    );
    expect(
      (removed.notes[0].blocks[0] as ResearchExamplesBlock).tabs[0].blocks.map(
        (block) => block.id,
      ),
    ).not.toContain("new-child");
    expect(removeResearchBlock(removed, state.activeNoteId, "missing")).toBe(
      removed,
    );
    expect(
      insertResearchBlock(removed, state.activeNoteId, child, undefined, {
        exampleBlockId: "missing",
        tabId: "scalar",
      }),
    ).toBe(removed);
  });

  it("rejects inserting a duplicate block identity anywhere in the note tree", () => {
    const state = notebook();
    expect(
      insertResearchBlock(state, state.activeNoteId, {
        id: "scalar-text",
        type: "paragraph",
        text: "重复",
      }),
    ).toBe(state);
    const duplicateGroup: ResearchNotebookBlock = {
      id: "other-group",
      type: "examples",
      tabs: [
        {
          id: "other-tab",
          title: "例",
          blocks: [{ id: "scalar-text", type: "paragraph", text: "重复" }],
        },
      ],
    };
    expect(insertResearchBlock(state, state.activeNoteId, duplicateGroup)).toBe(
      state,
    );
  });

  it.each([
    "```js\nconst x = 1;",
    "$$\nx=1",
    '<!-- webbench-example: {"id":"fake","title":"伪标签"} -->\n\n### 伪标签\n\n正文',
    '<!-- webbench-examples: {"version":1} -->\n\n> 原始标记',
    "前文\u2028后文\u2029末尾",
  ])(
    "round trips literal tab content without using Markdown boundaries: %s",
    (source) => {
      const block: ResearchNotebookBlock = {
        id: "robust",
        type: "examples",
        tabs: [
          {
            id: "first",
            title: "一 --> <script>",
            blocks: [
              {
                id: "literal",
                type: "markdown",
                kind: "markdown",
                text: source,
              },
            ],
          },
          {
            id: "second",
            title: "二",
            blocks: [
              { id: "second-paragraph", type: "paragraph", text: "仍然独立" },
            ],
          },
        ],
      };
      const note = {
        ...createResearchNote("边界"),
        blocks: [
          block,
          { id: "tail", type: "paragraph", text: "后续正文" },
        ] as ResearchNotebookBlock[],
      };
      const markdown = serializeResearchMarkdown(note);
      const imported = parseResearchMarkdown(markdown, note.title);
      expect(imported.blocks[0]).toEqual(block);
      expect(imported.blocks[1]).toMatchObject({
        type: "paragraph",
        text: "后续正文",
      });
      const withoutNoteSnapshot = parseResearchMarkdown(
        markdown.replace(/^<!-- webbench-blocks: .+ -->\r?\n?/m, ""),
        note.title,
      );
      expect(withoutNoteSnapshot.blocks[0]).toEqual(block);
      expect(withoutNoteSnapshot.blocks[1]).toMatchObject({
        type: "paragraph",
        text: "后续正文",
      });
    },
  );

  it("retains nested example groups and their formula identities through Markdown and backup", async () => {
    const nested: ResearchNotebookBlock = {
      id: "nested-outer",
      type: "examples",
      tabs: [{ id: "outer-tab", title: "外层", blocks: [examples] }],
    };
    const state = notebook();
    state.notes[0].blocks = [nested];
    expect(normalizeResearchNotebook(state).notes[0].blocks).toEqual([nested]);
    const imported = parseResearchMarkdown(
      serializeResearchMarkdown(state.notes[0]),
    );
    expect(imported.blocks).toEqual(
      remappedMarkdownBlocks(state.notes[0], imported.id),
    );
    expect(
      (
        await parseResearchLibraryFile(
          JSON.stringify(await createResearchLibraryFile(state)),
        )
      ).notebook.notes[0].blocks,
    ).toEqual([nested]);
  });

  it("validates duplicate descendant block and formula output identities before backup", async () => {
    const duplicate = notebook();
    duplicate.notes[0].blocks.push({
      id: "scalar-text",
      type: "paragraph",
      text: "重复根内容",
    });
    await expect(createResearchLibraryFile(duplicate)).rejects.toThrow("重复");
    const outputs = notebook();
    outputs.notes[0].blocks = structuredClone(outputs.notes[0].blocks);
    const formula = (outputs.notes[0].blocks[0] as ResearchExamplesBlock)
      .tabs[0].blocks[2];
    if (formula.type === "formula")
      formula.outputs!.push({ ...formula.outputs![0] });
    await expect(createResearchLibraryFile(outputs)).rejects.toThrow("重复");
  });

  it("protects a group whose descendant formula is still consumed elsewhere", () => {
    const state = notebook();
    state.notes[0].blocks.push({
      id: "external-consumer",
      type: "formula",
      tex: "x",
      parts: [
        {
          type: "symbol",
          entryId: "state",
          bindings: {},
          source: {
            noteId: state.activeNoteId,
            formulaId: "scalar-formula",
            outputId: "state-result",
          },
        },
      ],
    });
    expect(removeResearchBlock(state, state.activeNoteId, "examples")).toBe(
      state,
    );
    expect(
      removeResearchBlock(state, state.activeNoteId, "scalar-formula"),
    ).toBe(state);
  });

  it("allows deleting a whole group when all of its formula consumers are inside it", () => {
    const state = notebook();
    expect(
      removeResearchBlock(state, state.activeNoteId, "examples").notes[0]
        .blocks,
    ).toEqual([]);
  });

  it("finds nested sibling containers and preserves untouched references when changing children", () => {
    const outer: ResearchNotebookBlock = {
      id: "outer",
      type: "examples",
      tabs: [{ id: "outer-tab", title: "外层", blocks: [examples] }],
    };
    const blocks: ResearchNotebookBlock[] = [outer];
    const path = [
      { exampleBlockId: "outer", tabId: "outer-tab" },
      { exampleBlockId: "examples", tabId: "matrix" },
    ];
    const found = findResearchBlock(blocks, "matrix-formula")!;
    expect(found).toMatchObject({
      index: 2,
      block: { id: "matrix-formula" },
      path,
      container: path[1],
    });
    expect(found.siblings).toBe(examples.tabs[1].blocks);
    expect(getResearchBlockContainer(blocks, path[1])).toBe(found.siblings);
    expect(findResearchBlock(blocks, "outer")).toMatchObject({ path: [] });
    expect(getResearchBlockContainer(blocks)).toBe(blocks);
    expect(mapResearchBlocks(blocks, (block) => block)).toBe(blocks);
    expect(updateResearchBlockTree(blocks, "absent", () => null)).toBe(blocks);
    const changed = updateResearchBlockTree(blocks, "matrix-code", () => null);
    const changedGroup = (changed[0] as ResearchExamplesBlock).tabs[0]
      .blocks[0] as ResearchExamplesBlock;
    expect(changedGroup.tabs[0]).toBe(examples.tabs[0]);
    expect(changedGroup.tabs[1].blocks.map((block) => block.id)).toEqual([
      "matrix-quote",
      "matrix-formula",
    ]);
    const emptied = replaceResearchBlockContainer(blocks, path[1], []);
    expect(getResearchBlockContainer(emptied, path[1])).toEqual([]);
    expect(
      replaceResearchBlockContainer(
        blocks,
        { exampleBlockId: "missing", tabId: "tab" },
        [],
      ),
    ).toBe(blocks);
    expect(flattenResearchBlocks(blocks).map((block) => block.id)).toEqual([
      "outer",
      "examples",
      "scalar-text",
      "scalar-list",
      "scalar-formula",
      "matrix-quote",
      "matrix-code",
      "matrix-formula",
    ]);
  });

  it("retains formula references between the note root and hidden examples during Markdown round trip", () => {
    const note = notebook().notes[0];
    note.blocks.push({
      id: "root-consumer",
      type: "formula",
      tex: "x",
      parts: [
        {
          type: "symbol",
          entryId: "state",
          bindings: {},
          source: {
            noteId: note.id,
            formulaId: "scalar-formula",
            outputId: "state-result",
          },
        },
      ],
    });
    const imported = parseResearchMarkdown(serializeResearchMarkdown(note));
    expect(imported.id).not.toBe(note.id);
    expect(imported.blocks).toEqual(remappedMarkdownBlocks(note, imported.id));
  });

  it("migrates a complete legacy text-tab backup after checking its original checksum", async () => {
    const file = await createResearchLibraryFile(notebook());
    file.notebook.notes[0].blocks = [
      {
        id: "old-group",
        type: "examples",
        tabs: [{ id: "old-tab", title: "原例", text: "原有 **正文**" }],
      } as unknown as ResearchNotebookBlock,
    ];
    const { checksum: _checksum, ...original } = file;
    const bytes = new TextEncoder().encode(JSON.stringify(original));
    file.checksum = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const content = JSON.stringify(file);
    const restored = await parseResearchLibraryFile(content);
    expect(restored.notebook.notes[0].blocks).toMatchObject([
      {
        id: "old-group",
        tabs: [
          {
            id: "old-tab",
            blocks: [{ type: "paragraph", text: "原有 **正文**" }],
          },
        ],
      },
    ]);
    expect(await parseResearchLibraryFile(JSON.stringify(restored))).toEqual(
      restored,
    );
    expect(
      (await parseResearchLibraryFile(content)).notebook.notes[0].blocks,
    ).toEqual(restored.notebook.notes[0].blocks);
    file.notebook.notes[0].title = "被篡改";
    await expect(
      parseResearchLibraryFile(JSON.stringify(file)),
    ).rejects.toThrow("完整性");
  });

  it("keeps a formula's identity when upgrading an old note with the formula inside an example", () => {
    const state = createResearchNotebook();
    const source = state.notes
      .flatMap((note) => flattenResearchBlocks(note.blocks))
      .find(
        (block) =>
          block.type === "formula" &&
          block.caption === "线性关系",
      )!;
    const legacy = {
      ...createResearchNote("关系示例"),
      id: "legacy-equations",
      blocks: [
        {
          id: "legacy-example",
          type: "examples",
          tabs: [
            {
              id: "legacy-tab",
              title: "原例",
              blocks: [
                {
                  id: "legacy-heading",
                  type: "heading",
                  level: 2,
                  text: "线性关系",
                },
                source,
              ],
            },
          ],
        },
      ] as ResearchNotebookBlock[],
    };
    const migrated = normalizeResearchNotebook({
      ...state,
      version: 3,
      modelLibraryVersion: undefined,
      notes: [legacy],
    });
    const formulas = migrated.notes
      .flatMap((note) => flattenResearchBlocks(note.blocks))
      .filter(
        (block) =>
          block.type === "formula" &&
          block.caption === "线性关系",
      );
    expect(formulas).toHaveLength(1);
    expect(formulas[0].id).toBe(source.id);
  });
});

describe("external Markdown edits to exported examples", () => {
  const externalEditNote = (): ResearchNote => ({
    ...createResearchNote("外部修改检查"),
    id: "external-edit-note",
    blocks: [
      { id: "external-root", type: "paragraph", text: "外改前的根正文" },
      {
        id: "external-examples",
        type: "examples",
        tabs: [
          {
            id: "external-tab",
            title: "例一",
            blocks: [
              {
                id: "external-child",
                type: "paragraph",
                text: "外改前的标签正文",
              },
            ],
          },
        ],
      },
    ],
  });

  it("uses externally edited root prose instead of the stale whole-note snapshot", () => {
    const note = externalEditNote();
    const exported = serializeResearchMarkdown(note);
    const changed = exported.replace(
      "\n\n外改前的根正文\n\n",
      "\n\n外改后的根正文\n\n",
    );
    expect(changed).not.toBe(exported);
    const imported = parseResearchMarkdown(changed);
    expect(
      imported.blocks.some(
        (block) =>
          block.type === "paragraph" && block.text === "外改后的根正文",
      ),
    ).toBe(true);
    expect(
      imported.blocks.some(
        (block) =>
          block.type === "paragraph" && block.text === "外改前的根正文",
      ),
    ).toBe(false);
    expect(imported.blocks.some((block) => block.type === "examples")).toBe(
      false,
    );
  });

  it("keeps externally edited example prose as a readable quote instead of restoring stale child blocks", () => {
    const note = externalEditNote();
    const exported = serializeResearchMarkdown(note);
    const changed = exported.replace(
      "> 外改前的标签正文",
      "> 外改后的标签正文",
    );
    expect(changed).not.toBe(exported);
    const imported = parseResearchMarkdown(changed);
    expect(
      imported.blocks.some(
        (block) =>
          block.type === "markdown" &&
          block.kind === "quote" &&
          block.text.includes("外改后的标签正文"),
      ),
    ).toBe(true);
    expect(imported.blocks.some((block) => block.type === "examples")).toBe(
      false,
    );
  });

  it("also respects external edits when only the example group's snapshot is present", () => {
    const note = externalEditNote();
    const exported = serializeResearchMarkdown(note).replace(
      /^<!-- webbench-blocks: .+ -->\r?\n?/m,
      "",
    );
    expect(exported).not.toContain("<!-- webbench-blocks:");
    const changed = exported.replace(
      "> 外改前的标签正文",
      "> 外改后的独立标签正文",
    );
    expect(changed).not.toBe(exported);
    const imported = parseResearchMarkdown(changed);
    expect(
      imported.blocks.some(
        (block) =>
          block.type === "markdown" &&
          block.kind === "quote" &&
          block.text.includes("外改后的独立标签正文"),
      ),
    ).toBe(true);
    expect(imported.blocks.some((block) => block.type === "examples")).toBe(
      false,
    );
  });

  it("reads visible prose conservatively from old whole-note and group snapshots without readable metadata", () => {
    const exported = serializeResearchMarkdown(externalEditNote()).replace(
      /^<!-- webbench-(blocks|examples): (.+) -->$/gm,
      (_marker, kind: string, metadata: string) => {
        const value = JSON.parse(metadata);
        delete value.readable;
        const encoded = JSON.stringify(value)
          .replaceAll("<", "\\u003c")
          .replaceAll(">", "\\u003e");
        return `<!-- webbench-${kind}: ${encoded} -->`;
      },
    );
    const unchanged = parseResearchMarkdown(exported);
    expect(unchanged.blocks.some((block) => block.type === "examples")).toBe(
      false,
    );
    expect(
      unchanged.blocks.some(
        (block) =>
          block.type === "markdown" &&
          block.kind === "quote" &&
          block.text.includes("外改前的标签正文"),
      ),
    ).toBe(true);
    const changed = exported
      .replace("\n\n外改前的根正文\n\n", "\n\n旧格式外改后的根正文\n\n")
      .replace("> 外改前的标签正文", "> 旧格式外改后的标签正文");
    const imported = parseResearchMarkdown(changed);
    expect(
      imported.blocks.some(
        (block) =>
          block.type === "paragraph" && block.text === "旧格式外改后的根正文",
      ),
    ).toBe(true);
    expect(
      imported.blocks.some(
        (block) =>
          block.type === "markdown" &&
          block.kind === "quote" &&
          block.text.includes("旧格式外改后的标签正文"),
      ),
    ).toBe(true);
    const groupOnly = parseResearchMarkdown(
      changed.replace(/^<!-- webbench-blocks: .+ -->\r?\n?/m, ""),
    );
    expect(groupOnly.blocks.some((block) => block.type === "examples")).toBe(
      false,
    );
    expect(
      groupOnly.blocks.some(
        (block) =>
          block.type === "markdown" &&
          block.kind === "quote" &&
          block.text.includes("旧格式外改后的标签正文"),
      ),
    ).toBe(true);
  });

  it("preserves untouched structure and self references across platform line endings", () => {
    const note = notebook().notes[0];
    const exported = serializeResearchMarkdown(note).replace(/\n/g, "\r\n");
    const imported = parseResearchMarkdown(exported);
    expect(imported.blocks).toEqual(remappedMarkdownBlocks(note, imported.id));
    const standaloneNote = externalEditNote();
    const standalone = serializeResearchMarkdown(standaloneNote)
      .replace(/^<!-- webbench-blocks: .+ -->\r?\n?/m, "")
      .replace(/\n/g, "\r\n");
    const standaloneImported = parseResearchMarkdown(standalone);
    expect(
      standaloneImported.blocks.find((block) => block.type === "examples"),
    ).toEqual(standaloneNote.blocks[1]);
  });
});

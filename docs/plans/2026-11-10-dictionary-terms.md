# 符号与术语统一词典实现计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the plan task-by-task.

**Goal:** 将当前符号词典升级为兼容旧资料的“符号与术语词典”，让新插入的术语和正文符号通过稳定 ID 引用，在词典改名或改记号后所有引用自动显示最新定义。

**Architecture:** 保留现有 `symbols` 数组和版本 8 资料格式，新增可选 `terms` 数组并在规范化、备份校验和摘要中往返保存。正文引用采用 Markdown 自定义链接 `mewiki-term:` / `mewiki-symbol:`，渲染器按当前词典 ID 解析显示文本或公式；旧的普通文本只进入安全的一致性扫描，不做隐式全文替换。结构化公式继续沿用已有 `entryId` 引用。

**Tech Stack:** React 19、TypeScript、Vitest、Playwright、react-markdown、现有 MeWiki 本地资料库保存链路与 i18n。

---

### Task 1: 锁定术语模型和稳定引用行为

**Files:**
- Modify: `src/domain/researchDictionary.ts`
- Modify: `src/domain/researchNotebook.ts`
- Create: `src/domain/researchTerms.ts`
- Test: `src/domain/researchTerms.test.ts`
- Test: `src/domain/researchDictionary.test.ts`

**Step 1: Write the failing tests**

- 术语规范化保留稳定 `id`、名称、别名、含义、标签、范围和状态，并过滤非法重复 ID。
- `mewiki-term:` 和 `mewiki-symbol:` 链接能解析 ID，名称含特殊字符时仍能安全编码。
- 稳定引用的显示解析始终使用当前词典名称；缺失条目返回旧链接文本和失效标记。
- 扫描普通正文时跳过代码块、链接、数学公式和 URL，只报告名称、别名命中及上下文。

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/domain/researchTerms.test.ts`

Expected: FAIL because the term model, reference helpers, and scanner do not exist.

**Step 3: Write minimal domain implementation**

- Add `ResearchTermEntry`, `createTermEntry`, `termEntryError`, `normalizeTermEntries`, stable URL/Markdown helpers, and `scanResearchDictionaryText`.
- Add optional `terms?: ResearchTermEntry[]` to `ResearchNotebookState` and normalize it without changing the version number or old `symbols` data.
- Add optional aliases/status fields to symbols only where normalization remains backwards compatible.

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/domain/researchTerms.test.ts src/domain/researchDictionary.test.ts src/domain/researchNotebook.test.ts`

Expected: PASS.

### Task 2: Extend Markdown and text insertion with stable dictionary links

**Files:**
- Modify: `src/components/ResearchNoteLinkContext.ts`
- Modify: `src/components/ResearchMarkdown.tsx`
- Modify: `src/domain/researchSymbolMentions.ts`
- Modify: `src/domain/researchNoteLinks.ts`
- Modify: `src/components/ResearchMentionTextarea.tsx`
- Modify: all `ResearchNoteLinkContext.Provider` call sites
- Test: `src/domain/researchTerms.test.ts`
- Test: `src/domain/researchSymbolMentions.test.ts`
- Test: `src/domain/researchNoteLinks.test.ts`

**Step 1: Write the failing tests**

- Selecting a term from an `@` mention inserts `[名称](mewiki-term:id)`.
- Selecting a symbol from a `$` mention inserts a stable `mewiki-symbol` link while preserving default slot bindings.
- Rendering a stable link uses the current term name or symbol notation after the dictionary entry is renamed.
- Missing entries keep readable fallback text and expose an unavailable state.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/domain/researchTerms.test.ts src/domain/researchSymbolMentions.test.ts src/domain/researchNoteLinks.test.ts`

Expected: FAIL because insertion and renderers only understand note links and raw inline formulas.

**Step 3: Write minimal implementation**

- Add `terms` to the link context and pass it through editor, reading pane, embeds, and read-only content.
- Add `TermAnchor` / `SymbolAnchor` handling in `ResearchMarkdown` while preserving external links, note links, assets, code and math behavior.
- Extend the mention picker with term choices under `@`; keep note choices and symbol `$` behavior intact.
- Encode symbol bindings in the custom URL so custom indices survive a rename; fall back to current defaults for older stable links.

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/domain/researchTerms.test.ts src/domain/researchSymbolMentions.test.ts src/domain/researchNoteLinks.test.ts src/domain/researchMarkdown.test.ts`

Expected: PASS.

### Task 3: Add term dictionary CRUD and unified dictionary navigation

**Files:**
- Modify: `src/components/ResearchDictionary.tsx`
- Modify: `src/components/ResearchDictionary.css`
- Modify: `src/components/researchChoices.ts`
- Modify: `src/components/ResearchClassifiedList.tsx`
- Modify: `src/domain/researchDictionary.ts`
- Modify: `src/i18n/en.ts`
- Test: `e2e/research-dictionary-terms.spec.ts`

**Step 1: Write the failing browser checks**

- The dictionary has `全部 / 符号 / 术语` filters.
- A user can create, edit, search and delete an unused term.
- A term with references cannot be deleted without first removing its references.
- Editing a term name updates the displayed name in all linked notes without changing the link ID.
- Editing a symbol name or notation updates stable inline references and structured formula references.

**Step 2: Run the focused browser check to verify it fails**

Run: `npm run test:e2e -- e2e/research-dictionary-terms.spec.ts`

Expected: FAIL because the unified dictionary UI and term CRUD are absent.

**Step 3: Implement the UI**

- Use one filtered choice model for symbols and terms, with kind-specific editors and usage counts.
- Validate name/alias conflicts within the same kind and show an impact count before saving a rename.
- Keep existing symbol slot editor and formula backlinks intact.
- Add a lightweight “一致性检查” panel for legacy plain-text hits with per-hit bind/replace actions; never replace code, links, math or URLs automatically.

**Step 4: Run the focused browser check to verify it passes**

Run: `npm run test:e2e -- e2e/research-dictionary-terms.spec.ts`

Expected: PASS.

### Task 4: Preserve storage and backup compatibility

**Files:**
- Modify: `src/state/researchLibraryFile.ts`
- Modify: `src/state/researchNotebookStorage.ts`
- Modify: `src/domain/researchNotebook.ts`
- Modify: `docs/wiki/05-symbol-dictionary.md`
- Modify: `docs/wiki/02-workspace.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/VERIFICATION.md`
- Test: `src/state/researchLibraryFile.test.ts`
- Test: `src/state/researchNotebookStorage.test.ts`

**Step 1: Write the failing compatibility tests**

- Old version 8 notebooks without `terms` load unchanged and round-trip with no synthetic terms.
- New notebooks preserve terms, aliases and stable links through save/parse/checksum.
- Duplicate term/symbol IDs are rejected by the same existing integrity path.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/state/researchLibraryFile.test.ts src/state/researchNotebookStorage.test.ts`

Expected: FAIL on term round-trip and schema validation.

**Step 3: Implement schema and documentation updates**

- Add optional `terms` schema and uniqueness checks without changing the external `webbench-research-library` format name or file version.
- Update summaries and docs to describe the unified dictionary, stable references, rename behavior and legacy scan.

**Step 4: Run the compatibility tests**

Run: `npm test -- src/state/researchLibraryFile.test.ts src/state/researchNotebookStorage.test.ts src/domain/researchNotebook.test.ts`

Expected: PASS.

### Task 5: Full verification and service refresh

**Files:**
- Modify: `docs/VERIFICATION.md`

**Step 1: Run focused domain and UI checks**

Run: `npm test -- src/domain/researchTerms.test.ts src/domain/researchDictionary.test.ts src/domain/researchSymbolMentions.test.ts src/domain/researchNoteLinks.test.ts`

Run: `npm run test:e2e -- e2e/research-dictionary-terms.spec.ts e2e/research-inline-symbols.spec.ts e2e/sidebar-interactions.spec.ts`

**Step 2: Run the required project checks**

Run: `npm run check`

Expected: i18n validation, lint, all unit tests and production build succeed.

**Step 3: Rebuild and restart the local service**

- Rebuild through the normal project script.
- Restart only the MeWiki service for this workspace and confirm `http://127.0.0.1:5280/` responds.

**Step 4: Record actual evidence**

- Update `docs/VERIFICATION.md` with the commands, pass counts, any skipped checks and the service health result.
- Do not commit automatically; leave all existing user changes and this implementation visible for review.

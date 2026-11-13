/**
 * MeWiki README gallery. Run npm run docs:screenshots to refresh the images.
 * Use the existing isolated Playwright server on 127.0.0.1:5282.
 * All content below is fictional. Library requests are intercepted before navigation.
 * No real libraries, settings, files, credentials, or external resources are read.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FormulaPart, ResearchSymbolEntry } from '../src/domain/researchDictionary.ts';
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from '../src/domain/researchNotebook.ts';

test.skip(process.env.MEWIKI_UPDATE_GALLERY !== '1', 'Run npm run docs:screenshots to refresh the public gallery.');

test.use({
  viewport: { width: 1600, height: 1040 },
  locale: 'en-US',
  colorScheme: 'light',
  reducedMotion: 'reduce',
  storageState: { cookies: [], origins: [] },
});

const assetDirectory = process.env.MEWIKI_SHOWCASE_OUTPUT || path.resolve('docs/assets');
const timestamp = '2026-11-01T09:30:00.000Z';
const emptyBindings = { x1: '', x2: '', x3: '' };
const calloutStyle = { labelBackground: '#153b6d', labelColor: '#ffffff', borderColor: '#537baa', borderStyle: 'solid' as const, borderWidth: 1 };
const noteLink = (id: string) => `#research-note/${id}`;

function symbol(id: string, name: string, notation: string, meaning: string, tag: string, description: string[] = []): ResearchSymbolEntry {
  return {
    id: `studio-${id}`, name, notation: `${notation}^{[x1]}_{[x2]}[x3]`, meaning,
    category: 'custom', tags: [tag], unit: 'dimensionless', scope: 'Learning studio',
    slots: [
      { key: 'x1', label: 'Upper-right script x1', domain: 'generic', optional: true, defaultValue: id === 'y' ? '(m)' : '', description: description[0] || 'Optional model or scenario identifier.' },
      { key: 'x2', label: 'Lower-right script x2', domain: 'generic', optional: true, defaultValue: id === 'y' ? 'i' : '', description: description[1] || 'Optional sample or item index.' },
      { key: 'x3', label: 'Right-side variable x3', domain: 'generic', optional: true, defaultValue: id === 'y' ? '(t)' : '', description: description[2] || 'Optional independent variable, written with its parentheses.' },
    ],
  };
}
const symbols: ResearchSymbolEntry[] = [
  symbol('y', 'Predicted value', 'y', 'The output predicted by a linear model: $y = ax + b$.\nKeep the meaning with the symbol, wherever it appears.', 'Variables/Outputs', [
    'Model identifier $m$. Compare different model variants without changing the underlying definition.',
    'Sample index $i$. Identify the observation or item being evaluated.',
    'Time argument $(t)$. Parentheses are part of the value and remain explicit.',
  ]),
  symbol('x', 'Input value', 'x', 'The independent variable supplied to the model.', 'Variables/Inputs'),
  symbol('a', 'Slope', 'a', 'The rate at which the output changes when the input increases by one unit.', 'Parameters'),
  symbol('b', 'Intercept', 'b', 'The output when the input is zero; an offset in the linear relationship.', 'Parameters'),
  symbol('n', 'Sample count', 'n', 'The number of illustrative observations in a dataset.', 'Variables/Indices'),
  symbol('t', 'Time', 't', 'The independent time coordinate used in the example.', 'Variables/Inputs'),
];

const term = (id: string, bindings = emptyBindings): FormulaPart => ({ type: 'symbol', entryId: `studio-${id}`, bindings: { ...bindings } });
const op = (operator: 'equals' | 'plus'): FormulaPart => ({ type: 'operator', operator });
const linearParts: FormulaPart[] = [term('y'), op('equals'), term('a'), term('x'), op('plus'), term('b')];
const heroParts: FormulaPart[] = [
  { ...term('y', { x1: '(m)', x2: 'i', x3: '(t)' }), source: { noteId: 'studio-linear', formulaId: 'linear:formula', outputId: 'linear:result' } } as FormulaPart,
  op('equals'), term('a'), term('x', { x1: '', x2: 'i', x3: '(t)' }), op('plus'), term('b'),
];

function note(id: string, title: string, blocks: ResearchNotebookBlock[], tag: string, library: 'research' | 'foundation' = 'research', basisNoteIds: string[] = []): ResearchNote {
  return { id, title, blocks, tags: [tag], library, basisNoteIds, reviewStatus: 'pending', createdAt: timestamp, updatedAt: timestamp };
}

function showcaseState(activeNoteId = 'studio-home', view: ResearchNotebookState['view'] = 'notes'): ResearchNotebookState {
  const handbook = note('studio-handbook', 'Project handbook', [
    { id: 'handbook:heading', type: 'heading', level: 2, text: 'A repeatable learning loop' },
    { id: 'handbook:principle', type: 'paragraph', text: '**Capture → connect → explain → revisit.** Keep one clear source for each idea, then reuse the part you need in the context where it matters.' },
    { id: 'handbook:formula', type: 'formula', tex: 'y = ax + b', caption: 'A small model, with every symbol defined', parts: linearParts },
    { id: 'handbook:table', type: 'markdown', kind: 'table', text: '| Practice | Where it belongs | What stays connected |\n| :--- | :--- | :--- |\n| Define a concept | Foundation note | Symbols and assumptions |\n| Apply the idea | Research note | Formula sources and evidence |\n| Reuse a paragraph | Live reference | The original content |' },
    { id: 'handbook:tabs', type: 'examples', title: 'Two ways to explore', tabs: [
      { id: 'handbook:tab-reading', title: 'Read and connect', blocks: [{ id: 'handbook:reading', type: 'paragraph', text: 'Open related notes side by side. Follow backlinks to see where an idea is used.' }] },
      { id: 'handbook:tab-review', title: 'Review and refine', blocks: [{ id: 'handbook:review', type: 'paragraph', text: 'Check assumptions, update the source, and let connected pages follow the change.' }] },
    ] },
  ], 'Studio/Handbook', 'research', ['studio-linear']);

  const home = note('studio-home', 'Knowledge that stays connected', [
    { id: 'home:heading', type: 'heading', level: 1, text: 'One idea. Many connections.' },
    { id: 'home:intro', type: 'paragraph', text: 'A quiet home for **connected notes, meaningful mathematics, and the materials behind your ideas**. Start with the [project handbook](' + noteLink('studio-handbook') + ') or explore the [research dashboard](' + noteLink('studio-dashboard') + ').' },
    { id: 'home:callout', type: 'callout', title: 'WRITE ONCE · REUSE ANYWHERE', text: 'Keep definitions in one place. Build explanations around them. Live references follow the source, while your own writing stays yours.', appearance: calloutStyle },
    { id: 'home:model-heading', type: 'heading', level: 2, text: 'Make the notation part of the story' },
    { id: 'home:formula', type: 'formula', tex: 'y^{(m)}_i(t) = a x_i(t) + b', parts: heroParts, caption: 'A linear relationship, linked to its source definition', conditions: 'Illustrative model; all values in this workspace are fictional.' },
    { id: 'home:explanation', type: 'paragraph', text: 'The variable $x_i(t)$ is an input, $a$ is the slope, and $b$ is the intercept. Click a symbol to read its meaning without leaving the page.' },
    { id: 'home:reuse-heading', type: 'heading', level: 2, text: 'Build a library that works together' },
    { id: 'home:table', type: 'markdown', kind: 'table', text: '| Capture | Connect | Create |\n| :--- | :--- | :--- |\n| Notes, PDFs, images, and citations | Links, backlinks, and live references | Formulas, charts, and diagrams |\n| Keep your original materials | Follow a stable source | Explain the idea in context |' },
    { id: 'home:tabs', type: 'examples', title: 'Your next step', tabs: [
      { id: 'home:tab-one', title: 'Explore the library', blocks: [{ id: 'home:explore', type: 'paragraph', text: 'Browse the hierarchical tags on the left. Use the outline on the right to move through a long page.' }] },
      { id: 'home:tab-two', title: 'Follow the sources', blocks: [{ id: 'home:sources', type: 'paragraph', text: 'Open the knowledge map to trace how foundations, formulas, and research notes relate.' }] },
    ] },
  ], 'Studio/Start here', 'research', ['studio-linear']);

  const linear = note('studio-linear', 'Linear models', [
    { id: 'linear:heading', type: 'heading', level: 1, text: 'A simple relationship, clearly explained' },
    { id: 'linear:intro', type: 'paragraph', text: 'A linear model separates the input, the rate of change, and the offset. Define these symbols once and reuse them in every explanation.' },
    { id: 'linear:conditions', type: 'callout', title: 'Conditions', text: 'The coefficients $a$ and $b$ are constants. The example illustrates notation and source relationships; it is not a fitted research result.', appearance: calloutStyle, section: 'given' },
    { id: 'linear:formula', type: 'formula', tex: 'y = ax + b', parts: linearParts, caption: 'Linear relationship', outputs: [{ id: 'linear:result', entryId: 'studio-y', bindings: { ...emptyBindings } }], section: 'conclusion' },
    { id: 'linear:paragraph', type: 'paragraph', text: 'Changing $a$ changes the slope. Changing $b$ shifts the output. The input $x$ and predicted value $y$ remain linked to their dictionary definitions.' },
    { id: 'linear:worked', type: 'formula', tex: '\\text{If } a=2,\\ b=1,\\ x=3,\\quad y=2\\cdot3+1=7', caption: 'A small worked example' },
  ], 'Mathematics/Models', 'foundation', ['studio-notation']);

  const notation = note('studio-notation', 'Symbols and assumptions', [
    { id: 'notation:heading', type: 'heading', level: 1, text: 'Give every symbol a meaning' },
    { id: 'notation:intro', type: 'paragraph', text: 'Use a dictionary entry for the body, upper-right script, lower-right script, and right-side variable. Descriptions are independent of example values.' },
    { id: 'notation:table', type: 'markdown', kind: 'table', text: '| Symbol | Meaning |\n| :--- | :--- |\n| $x$ | Model input |\n| $y$ | Predicted value |\n| $a$ | Slope |\n| $b$ | Intercept |' },
  ], 'Mathematics/Notation', 'foundation');

  const dashboard = note('studio-dashboard', 'Research dashboard', [
    { id: 'dashboard:heading', type: 'heading', level: 1, text: 'From observations to an explanation' },
    { id: 'dashboard:intro', type: 'paragraph', text: '**Illustrative sample data.** Bring tables, plots, and a repeatable workflow into the same page. These values are fictional and demonstrate the editor.' },
    { id: 'dashboard:diagram', type: 'diagram', title: 'A connected research workflow', mode: 'mermaid', code: 'flowchart LR\n  A[Capture sources] --> B[Define concepts]\n  B --> C[Build a model]\n  C --> D[Plot observations]\n  D --> E[Review and reuse]', strokes: [] },
    { id: 'dashboard:dataset', type: 'dataset', title: 'Illustrative observations and a simple model', columns: ['Input', 'Observation', 'Linear model'], rows: [['0', '1.2', '1'], ['1', '2.7', '3'], ['2', '5.3', '5'], ['3', '6.8', '7'], ['4', '9.2', '9']], chart: { kind: 'line', x: 0, ys: [1, 2] } },
  ], 'Studio/Research', 'research', ['studio-linear']);

  const review = note('studio-review', 'Review and reuse', [
    { id: 'review:heading', type: 'heading', level: 1, text: 'A source that stays alive' },
    { id: 'review:intro', type: 'paragraph', text: 'The excerpt below comes directly from the project handbook. Edit the source once; connected references display its current content.' },
    { id: 'review:embed', type: 'noteEmbed', sourceNoteId: 'studio-handbook', sourceTitle: 'Project handbook', blockIds: ['handbook:principle', 'handbook:formula', 'handbook:table'] },
    { id: 'review:callout', type: 'callout', title: 'YOUR WORDS STAY YOURS', text: 'Only the selected blocks are referenced. Your commentary remains independent, and newly added source blocks are not included automatically.', appearance: calloutStyle },
  ], 'Studio/Research', 'research', ['studio-linear']);

  const reading = note('studio-reading', 'Reading room', [
    { id: 'reading:heading', type: 'heading', level: 1, text: 'Keep the context behind an idea' },
    { id: 'reading:intro', type: 'paragraph', text: 'Collect source material beside your own notes. Add a PDF, attach original files, or save citation details with a DOI.' },
    { id: 'reading:citation', type: 'citation', title: 'A practical guide to connected learning', authors: 'Example Research Group', year: '2026', venue: 'Learning studio notes', url: 'https://example.com/learning', notes: 'Fictional reference used only to demonstrate the citation card.' },
    { id: 'reading:list', type: 'list', items: ['Keep original files with a local library.', 'Use a backup with attachments when moving to another computer.', 'Separate projects and personal notes with independent libraries.'] },
  ], 'Studio/Library', 'research', ['studio-notation']);

  const notes = [home, handbook, dashboard, review, reading, linear, notation];
  const ref = (noteId: string) => ({ noteId });
  const relations = [
    ['notation-to-linear', 'studio-notation', 'studio-linear', 'assumption', 'Define the notation'],
    ['linear-to-home', 'studio-linear', 'studio-home', 'derivation', 'Explain in context'],
    ['linear-to-dashboard', 'studio-linear', 'studio-dashboard', 'adaptation', 'Explore illustrative data'],
    ['handbook-to-review', 'studio-handbook', 'studio-review', 'derivation', 'Reuse a living source'],
    ['reading-to-handbook', 'studio-reading', 'studio-handbook', 'assumption', 'Keep the source material'],
  ].map(([id, source, target, kind, description]) => ({ id, source: ref(source), target: ref(target), kind: kind as 'assumption' | 'derivation' | 'adaptation', description }));
  return {
    version: 8, open: true, view, activeNoteId, activeSymbolId: 'studio-y', symbols, notes, noteLibraryVersion: 1,
    noteFilters: { query: '', status: 'all', tag: '' }, foundationFilters: { query: '', status: 'all', tag: '' }, symbolFilters: { query: '', tag: '' },
    librarySelections: { research: notes.find(item => item.id === activeNoteId && item.library === 'research')?.id || 'studio-home', foundation: 'studio-linear' },
    theoryMaps: {
      version: 1, activeMapId: 'studio-map', deletedMapIds: [], noteViewOpen: false, noteViews: {},
      documents: [{
        id: 'studio-map', title: 'Learning studio · connections', kind: 'topic', createdAt: timestamp, updatedAt: timestamp,
        noteIds: notes.map(item => item.id), relations,
        annotations: notes.map(item => ({ ref: ref(item.id), role: item.library === 'foundation' ? 'foundation' as const : 'model' as const })),
        view: { expandedNoteIds: [], showAllBlocks: false, layout: { positions: {} } },
      }],
    },
  };
}

// Authored Chinese demo content; interface switching never translates saved notes.
function localizedShowcase(activeNoteId: string, view: ResearchNotebookState['view'], language: 'en' | 'zh-CN') {
  const state = showcaseState(activeNoteId, view);
  if (language !== 'zh-CN') return state;
  const names: Record<string, string> = {
    'Knowledge that stays connected': '让知识彼此连接', 'Project handbook': '项目手册',
    'Research dashboard': '数据与流程', 'Review and reuse': '阅读与复用', 'Reading room': '阅读室',
    'Linear models': '线性模型', 'Symbols and assumptions': '符号与假设',
  };
  const tags: Record<string, string> = { 'Studio/Start here': '知识库/从这里开始', 'Studio/Handbook': '知识库/手册', 'Studio/Research': '知识库/研究', 'Studio/Library': '知识库/资料', 'Mathematics/Models': '数学/模型', 'Mathematics/Notation': '数学/记号' };
  const authored: Record<string, string> = {
    'home:heading': '一个想法，连接更多知识。',
    'home:intro': '为**相互关联的笔记、含义清晰的数学公式和参考资料**，提供安静的写作空间。从[项目手册](#research-note/studio-handbook)开始，或者查看[数据与流程](#research-note/studio-dashboard)。',
    'home:callout': '在一处维护定义，在不同页面复用。内容引用随来源更新，自己的思考保留在当前上下文中。',
    'home:model-heading': '让每一个符号都有清晰的含义',
    'home:explanation': '变量 $x_i(t)$ 表示输入，$a$ 是斜率，$b$ 是截距。点击符号，无需离开页面即可查看它的含义与来源。',
    'home:reuse-heading': '建立能彼此连接的知识库',
    'home:table': '| 收集 | 连接 | 创作 |\n| :--- | :--- | :--- |\n| 笔记、PDF、图片与文献 | 页面链接、反向链接与内容引用 | 公式、图表与流程图 |\n| 保留原始资料 | 跟随稳定来源 | 在上下文中解释想法 |',
  };
  state.notes = state.notes.map(note => ({ ...note, title: names[note.title] ?? note.title, tags: note.tags?.map(tag => tags[tag] ?? tag), blocks: note.blocks.map(block => {
    if (block.type === 'callout' && block.id === 'home:callout') return { ...block, title: '写一次，在更多地方复用', text: authored[block.id] };
    if ('text' in block && authored[block.id]) return { ...block, text: authored[block.id] };
    if (block.type === 'formula' && block.id === 'home:formula') return { ...block, caption: '线性关系，与来源定义保持连接' };
    if (block.type === 'examples' && block.id === 'home:tabs') return { ...block, title: '开始探索', tabs: block.tabs.map((tab, index) => ({ ...tab, title: index ? '沿着来源阅读' : '浏览知识库', blocks: [{ id: tab.id + ':zh', type: 'paragraph' as const, text: index ? '通过理论地图追溯基础、公式与研究记录之间的关系。' : '在左侧按层级标签浏览，在右侧使用大纲定位长篇内容。' }] })) };
    return block;
  }) }));
  return state;
}

async function seed(page: Page, activeNoteId = 'studio-home', view: ResearchNotebookState['view'] = 'notes', language: 'en' | 'zh-CN' = 'en') {
  // Prevent the showcase from reaching any library registered by a real user.
  await page.route('**/api/research-library**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'The gallery uses an isolated, read-only mock library service.' } });
    if (url.pathname === '/api/research-library/catalog') return route.fulfill({ json: {
      libraries: [
        { id: 'default', name: 'Learning studio', directory: null },
        { id: 'reading-room', name: 'Reading room', directory: null },
        { id: 'personal-notebook', name: 'Personal notebook', directory: null },
      ], contextDefaults: { standalone: 'default' },
    } });
    if (url.pathname === '/api/research-library') return route.fulfill({ json: { directory: null, file: null } });
    return route.fulfill({ status: 404, json: { error: 'This gallery does not access saved library data.' } });
  });
  await page.addInitScript(({ serializedState, language }) => {
    if (sessionStorage.getItem('mewiki:showcase-seeded')) return;
    localStorage.setItem('mewiki:locale', language);
    localStorage.setItem('mewiki:research-notebook', serializedState);
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'false');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'false');
    sessionStorage.setItem('mewiki:showcase-seeded', '1');
  }, { serializedState: JSON.stringify(localizedShowcase(activeNoteId, view, language)), language });
  await page.goto('/');
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  expect(new URL(page.url()).port).toBe('5282');
  await expect(page.getByTestId('research-notebook')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await page.evaluate(() => document.fonts.ready);
}

async function noteAction(page: Page, label: string) {
  const panel = page.getByTestId('research-notebook');
  const direct = panel.getByRole('button', { name: label, exact: true });
  if (await direct.isVisible()) return direct.click();
  await panel.getByRole('button', { name: 'More note actions', exact: true }).click();
  await panel.getByRole('menu', { name: 'More note actions', exact: true }).getByRole('menuitem', { name: label, exact: true }).click();
}

async function capture(page: Page, filename: string) {
  await mkdir(assetDirectory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })));
  });
  await expect(page.locator('.research-library-initializing')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement && document.activeElement.matches('[role="tab"]')) document.activeElement.blur(); });
  await page.mouse.move(1590, 1030);
  await page.screenshot({ path: path.join(assetDirectory, filename), fullPage: false, animations: 'disabled', caret: 'hide' });
}

async function openFormulaEditor(page: Page): Promise<Locator> {
  await noteAction(page, 'Switch to edit mode');
  const formula = page.locator('[data-formula-id="home:formula"]');
  await formula.hover();
  await formula.getByRole('button', { name: 'Edit formula', exact: true }).click();
  await formula.locator('[data-formula-index="0"]').dblclick();
  const editor = formula.locator('.research-formula-item-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Symbol preview', { exact: true }).locator('.katex')).toBeVisible();
  await expect(editor.getByRole('group', { name: 'Operator keyboard', exact: true })).toBeVisible();
  return editor;
}

test('gallery · English workspace', async ({ page }) => {
  await seed(page);
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('Knowledge that stays connected');
  await expect(page.getByRole('heading', { name: /One idea\. Many connections\./ })).toBeVisible();
  await expect(page.locator('[data-formula-id="home:formula"] .katex').first()).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await capture(page, 'workspace-en.png');
});

test('gallery · Chinese workspace', async ({ page }) => {
  await seed(page, 'studio-home', 'notes', 'zh-CN');
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('让知识彼此连接');
  await expect(page.getByRole('tab', { name: '符号', exact: true })).toBeVisible();
  await capture(page, 'workspace-zh.png');
});

test('gallery · visual formula editing and operator keyboard', async ({ page }) => {
  await seed(page);
  const editor = await openFormulaEditor(page);
  await expect(editor.getByRole('searchbox', { name: 'Search formula symbols', exact: true })).toBeVisible();
  await expect(editor.getByText('Predicted value', { exact: true }).last()).toBeVisible();
  await capture(page, 'formula-editor.png');
});

test('gallery · symbol dictionary with positional descriptions', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1040 });
  await seed(page, 'studio-home', 'dictionary');
  const diagram = page.getByRole('region', { name: 'Symbol structure diagram', exact: true });
  await expect(diagram).toBeVisible();
  await expect(diagram.locator('[data-symbol-callout="body"]')).toContainText('The output predicted by a linear model');
  await expect(diagram.locator('[data-symbol-callout="x1"]')).toContainText('Model identifier');
  await expect(diagram.locator('[data-symbol-callout="x2"]')).toContainText('Sample index');
  await expect(diagram.locator('[data-symbol-callout="x3"]')).toContainText('Time argument');
  await expect(diagram.locator('.research-symbol-hero .katex')).toBeVisible();
  await expect(diagram.locator('.symbol-diagram-connections path')).toHaveCount(4);
  let previousSize = '', stable = 0;
  await expect.poll(async () => {
    const size = await diagram.locator('.symbol-diagram-formula').getAttribute('style') || '';
    stable = size === previousSize ? stable + 1 : 0;
    previousSize = size;
    return stable;
  }, { intervals: [100, 100, 100, 100] }).toBeGreaterThanOrEqual(3);
  await expect.poll(() => diagram.locator('.research-symbol-hero').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await capture(page, 'symbol-dictionary.png');
});

test('gallery · rendered live-reference source selector', async ({ page }) => {
  await seed(page, 'studio-review');
  await noteAction(page, 'Switch to edit mode');
  await page.getByRole('button', { name: 'Edit reference range', exact: true }).click();
  const dialog = page.getByTestId('research-note-embed-picker');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Source content', exact: true })).toContainText('A repeatable learning loop');
  await expect(dialog.getByLabel('Select content 2', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('Select content 3', { exact: true })).toBeChecked();
  await expect(dialog.locator('.katex').first()).toBeVisible();
  await expect(dialog.getByRole('table')).toBeVisible();
  await capture(page, 'live-reference.png');
});

test('gallery · data chart and Mermaid diagram', async ({ page }) => {
  await seed(page, 'studio-dashboard');
  await expect(page.getByLabel('Data chart', { exact: true })).toBeVisible();
  await expect(page.locator('.research-diagram-preview svg')).toBeVisible();
  await expect(page.locator('[data-dataset-series]')).toHaveCount(2);
  await expect(page.locator('.research-diagram-preview')).toContainText(/Capture\s*sources/);
  await capture(page, 'rich-content.png');
});

test('gallery · knowledge map and connected notes', async ({ page }) => {
  await seed(page, 'studio-home', 'maps');
  const map = page.getByTestId('research-theory-map');
  await expect(map).toBeVisible();
  await expect.poll(() => map.locator('.react-flow__node').count()).toBeGreaterThanOrEqual(7);
  await expect.poll(() => map.locator('.react-flow__edge').count()).toBeGreaterThanOrEqual(5);
  await map.getByRole('button', { name: 'Fit knowledge map to canvas', exact: true }).click();
  await expect(map.getByText('Linear models', { exact: true }).first()).toBeVisible();
  let previousTransform = '';
  let stable = 0;
  await expect.poll(async () => {
    const transform = await map.locator('.react-flow__viewport').getAttribute('style') || '';
    stable = transform === previousTransform ? stable + 1 : 0;
    previousTransform = transform;
    return stable;
  }, { intervals: [100, 100, 100, 100] }).toBeGreaterThanOrEqual(3);
  await capture(page, 'knowledge-map.png');
});

test('gallery · separate libraries', async ({ page }) => {
  await seed(page);
  await noteAction(page, 'Switch library');
  const dialog = page.getByTestId('mewiki-library-manager');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(dialog.getByText('Learning studio', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Reading room', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Personal notebook', { exact: true })).toBeVisible();
  // All three entries are isolated browser-mode examples: no real paths are shown.
  await expect(dialog).not.toContainText(/(?:[A-Z]:\\|\\Users\\|\\Projects\\)/);
  await capture(page, 'libraries.png');
});

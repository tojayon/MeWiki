/** One trusted source for reading and exporting document typography. */
export const documentTheme = {
  background: '#FFFFFF', textColor: '#25364D', headingColor: '#173454', accentColor: '#1547C0',
  fontSize: 15, lineHeight: 1.72,
  fontFamily: '"Noto Sans SC Variable", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
} as const;

/** Opaque table headers share their palette across reading and every export path. */
export const documentTableTheme = {
  header: '#173454', text: '#f8fbff', link: '#c5dcff', border: '#173454',
} as const;
export const documentTableHeaderCss = `
.research-dataset-table-scroll { --mewiki-table-border: ${documentTableTheme.border}; }
.research-markdown th, .research-dataset-table-scroll thead th, table.document-table thead th { background: ${documentTableTheme.header}; color: ${documentTableTheme.text}; border-color: ${documentTableTheme.border}; font-weight: 700; --mewiki-document-accent: ${documentTableTheme.link}; --research-tabs-link: ${documentTableTheme.link}; }
.research-markdown th :is(strong, b), table.document-table thead th :is(strong, b) { color: inherit; }
.research-markdown th a:is(:hover, :focus-visible) { color: ${documentTableTheme.link}; }
table.document-table thead th .document-link { color: ${documentTableTheme.link}; }
`;

/** Shared by the website, native captures and parameter-based export templates. */
export const documentCodeTheme = {
  background: '#0d1117', text: '#e6edf3', header: '#161b22', border: '#30363d', muted: '#9da7b3',
} as const;
export const documentCodeCss = `
.research-markdown-code, pre.document-code, .research-markdown[data-kind="code"] > .research-text-source { background: ${documentCodeTheme.background}; color: ${documentCodeTheme.text}; border-color: ${documentCodeTheme.border}; color-scheme: dark; }
.research-markdown pre, pre.document-code { background: ${documentCodeTheme.background}; color: ${documentCodeTheme.text}; }
.research-markdown pre > code, pre.document-code > code { display: block; padding: 0; background: transparent; color: inherit; }
.research-markdown :not(pre) > code, .document-inline-code { background: ${documentCodeTheme.header}; color: ${documentCodeTheme.text}; }
.research-code-toolbar { background: ${documentCodeTheme.header}; color: ${documentCodeTheme.muted}; border-bottom-color: ${documentCodeTheme.border}; }
`;

const unit = (value: number) => `calc(var(--mewiki-document-unit, 1px) * ${value})`;
export const documentContentCss = `
.research-markdown { min-width: 0; color: var(--mewiki-document-text, ${documentTheme.textColor}); font-family: var(--mewiki-document-font-family, ${documentTheme.fontFamily}); font-size: var(--mewiki-document-font-size, ${documentTheme.fontSize}px); line-height: var(--mewiki-document-line-height, ${documentTheme.lineHeight}); white-space: normal; overflow-wrap: anywhere; }
.research-note-title, .research-markdown .document-title { font: inherit; color: #172033; font-size: ${unit(20)}; line-height: ${unit(28)}; font-weight: 800; font-synthesis: weight; text-align: center; }
.research-markdown > :first-child { margin-top: 0; }
.research-markdown > :last-child { margin-bottom: 0; }
.research-markdown p { margin: ${unit(6)} 0; white-space: normal; }
.research-markdown :is(h1, h2, h3, h4, h5, h6) { margin: ${unit(14)} 0 ${unit(6)}; color: var(--mewiki-document-heading, ${documentTheme.headingColor}); font-weight: 700; line-height: 1.45; }
.research-markdown h1 { font-size: ${unit(24)}; }
.research-markdown h2 { font-size: ${unit(20)}; }
.research-markdown h3 { font-size: ${unit(18)}; }
.research-markdown h4 { font-size: ${unit(16)}; }
.research-markdown h5 { font-size: ${unit(15)}; }
.research-markdown h6 { font-size: ${unit(14)}; color: #45566e; }
.research-markdown :is(strong, b) { color: #172033; font-weight: 750; }
.research-markdown em { font-style: italic; }
.research-markdown del { color: #607088; text-decoration-thickness: 1px; }
.research-markdown :is(a, .document-link) { color: var(--mewiki-document-accent, ${documentTheme.accentColor}); text-decoration: underline; text-underline-offset: ${unit(3)}; }
.research-markdown blockquote { margin: ${unit(8)} 0; border-left: ${unit(3)} solid #9aaec8; padding: ${unit(3)} ${unit(12)}; background: #f8fafc; color: #45566e; --mewiki-document-accent: ${documentTheme.accentColor}; }
.research-markdown blockquote > :first-child { margin-top: 0; }
.research-markdown blockquote > :last-child { margin-bottom: 0; }
.research-markdown blockquote blockquote { margin-block: ${unit(5)}; border-left-color: #c3cfdf; }
.research-markdown blockquote :is(h1, h2, h3, h4, h5, h6) { color: inherit; }
.research-markdown :is(ul, ol) { margin: ${unit(6)} 0; padding-left: ${unit(24)}; }
.research-markdown li { padding-left: ${unit(2)}; }
.research-markdown > .research-note-read-list { color: inherit; }
.research-markdown li + li { margin-top: ${unit(3)}; }
.research-markdown li > p { margin: ${unit(3)} 0; }
.research-markdown li > :is(ul, ol) { margin-block: ${unit(2)}; }
.research-markdown .task-list-item { list-style-type: none; }
.research-markdown .task-list-item > input { width: ${unit(14)}; height: ${unit(14)}; margin: 0 ${unit(6)} 0 ${unit(-20)}; accent-color: var(--mewiki-document-accent, ${documentTheme.accentColor}); vertical-align: ${unit(-1)}; opacity: 1; }
.research-markdown :not(pre) > code { border-radius: ${unit(4)}; padding: ${unit(1)} ${unit(4)}; font-family: var(--mewiki-document-font-family, ${documentTheme.fontFamily}); font-size: .88em; overflow-wrap: anywhere; }
.research-markdown-code, .research-markdown .document-code { min-width: 0; margin: ${unit(8)} 0; overflow: hidden; border: ${unit(1)} solid ${documentCodeTheme.border}; border-radius: ${unit(4)}; }
.research-markdown pre { max-width: 100%; margin: 0; overflow: auto; padding: ${unit(10)} ${unit(12)}; font: ${unit(13)}/1.65 Consolas, "Cascadia Code", monospace; white-space: pre; overflow-wrap: normal; tab-size: 4; }
.research-markdown pre > code.hljs, .research-markdown pre > code { display: block; overflow: visible; padding: 0; background: transparent; font: inherit; white-space: inherit; }
.research-markdown-table { max-width: 100%; margin: ${unit(8)} 0; overflow: auto; border: ${unit(1)} solid ${documentTableTheme.border}; border-radius: ${unit(4)}; background: #fff; }
.research-markdown table { width: max-content; min-width: 100%; border-collapse: collapse; background: #fff; color: ${documentTheme.textColor}; font-size: ${unit(14)}; line-height: 1.6; --mewiki-document-accent: ${documentTheme.accentColor}; --research-tabs-link: ${documentTheme.accentColor}; }
.research-markdown td { background: #fff; }
.research-markdown :is(th, td) { border-bottom: ${unit(1)} solid ${documentTableTheme.border}; padding: ${unit(6)} ${unit(10)}; text-align: left; }
.research-markdown :is(th, td) + :is(th, td) { border-left: ${unit(1)} solid ${documentTableTheme.border}; }
.research-markdown tbody tr:last-child td { border-bottom: 0; }
.research-markdown img { display: block; max-width: 100%; height: auto; margin: ${unit(8)} 0; border-radius: ${unit(4)}; }
.research-markdown hr { width: 100%; margin: ${unit(12)} 0; border: 0; border-top: ${unit(1)} solid #bdcadd; }
.research-markdown [data-footnotes] { margin-top: ${unit(12)}; border-top: ${unit(1)} dashed #cbd6e4; padding-top: ${unit(6)}; color: #45566e; font-size: ${unit(13)}; }
.research-markdown [data-footnotes] h2 { margin-top: 0; font-size: ${unit(14)}; }
.research-markdown .katex-display { max-width: 100%; overflow-x: auto; overflow-y: hidden; margin: ${unit(8)} 0; padding-block: ${unit(2)}; }
${documentCodeCss}
${documentTableHeaderCss}
`;

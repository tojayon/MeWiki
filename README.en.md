# MeWiki

[GitHub repository](https://github.com/tojayon/MeWiki)

**A local-first wiki for connected pages, mathematical notation, and source-linked content.**

[中文说明](README.md) · [User manual (Chinese)](docs/wiki/README.md) · [Contributing](CONTRIBUTING.md)

MeWiki combines a block-based document editor with hierarchical tags, a symbol dictionary, visual formula editing, backlinks, and side-by-side reading. Embed selected blocks from another page and keep them connected to the current source. Add media, PDFs, DOI citations, datasets, charts, and diagrams to the same notebook.

![MeWiki workspace](docs/assets/workspace.png)

## Features

- Pages, hierarchical multi-tags, metadata, outlines, and review status.
- Live references to multiple blocks, including formulas, images, and tabbed content.
- A symbol dictionary with per-position descriptions, visual formula composition, LaTeX preview, copy/paste, and drag to reorder.
- Images, audio, video, PDFs, attachments, web cards, and DOI metadata lookup.
- CSV/Excel datasets, charts, Mermaid diagrams, freehand drawing, and SVG export.
- Separate local libraries, version history, and backups that include attachments.
- A versioned host integration API and optional bundled plugins, including WebBench replay references.

The application interface and full manual are currently in Simplified Chinese. The primary validation environment is Windows with Microsoft Edge; other platforms still need additional validation.

## Run locally

Install Node.js 22.13 or a newer supported release, then run inside the project directory:

```sh
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:5280](http://127.0.0.1:5280) and keep the service running. Windows users can also run `Start-MeWiki.bat`; `node scripts/start-mewiki.mjs` installs dependencies, builds, and opens the browser. Development mode: `npm run dev`.

The first installation requires network access. Local content can be edited offline after installation; remote media and metadata lookup need network access.

## Storage and scope

Try the browser storage mode or configure a local library directory for regular use. Importing a file copies it into the library and keeps the original file intact. Local originals support up to 1 GB each; browser storage supports up to 100 MB per file. Preview limits depend on format and browser support.

Use a backup that includes attachments when moving libraries. JSON and plain Markdown exports do not contain original attachment bytes. Libraries remain separate while sharing the same application code.

New workspaces contain the manual and general examples. Loading saved data does not add research models, rewrite user content, or recreate deleted examples. Existing file formats and saved symbol positions remain supported.

MeWiki currently runs as a local single-user application. Cloud sync, user accounts, and real-time collaboration are not included. A static GitHub Pages deployment cannot replace the local Node service.

## Development and licensing

```sh
npm run check
npm run test:e2e
```

Browser checks use Microsoft Edge. See the [development guide](docs/DEVELOPMENT.md), [integration API](docs/integrations/README.md), and [open-source preparation materials](docs/open-source/README.md).

MeWiki-owned code and documentation use the [MIT License](LICENSE). Dependencies, fonts, and codecs retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). This license does not change ownership of users' notes or attachments.

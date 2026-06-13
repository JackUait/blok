<p align="center">
  <a href="https://blokeditor.com" target="_blank" rel="noopener noreferrer">
    <img width="40%" alt="Blok logotype" src="./static/blok.png">
  </a>
</p>

## It's Blok!

Blok is a headless, block-based rich text editor for the web. If you've used Notion, you know the feel: every paragraph, heading, image, or list is its own block that you can drag around, nest, and convert into something else.

The difference from a normal `contenteditable` setup is the data. A `contenteditable` field hands you one HTML blob and leaves you to parse it. Blok stores content as typed JSON blocks instead, so the output is the same whether you save it to a database, diff it, or render it on a server that never touches the DOM.

It's headless on purpose. Blok ships the editing engine and a set of tools; it does not impose a chrome or a theme. You wire it into your own UI.

## What's in the box

**Block tools.** Paragraph, heading, list, quote, callout, code, image, divider, table, toggle, and a column layout. There's also a Notion-style database block (with rows as child blocks), plus embed and bookmark blocks for pasted links.

**Inline formatting.** Bold, italic, underline, strikethrough, inline code, link, and a highlight marker.

**Slash menu and markdown shortcuts.** Type `/` in an empty block to search and insert. Or type markdown — `#`, `-`, `1.`, `[]`, `>` — and it converts on space.

**Drag and drop.** Pointer-based reordering (not the flaky HTML5 drag API). Grab multiple blocks at once, hold Alt to duplicate while dragging, and it auto-scrolls near the edges. Keyboard works too.

**Undo/redo on Yjs.** History is backed by a CRDT, so undo restores the caret where you left it, groups small edits sensibly, and you can batch changes atomically with `blocks.transact()`.

**68 locales, RTL included.** Blok reads the browser language, lazy-loads the matching locale, and lays out right-to-left scripts correctly.

**Plugin system.** Three extension points — block tools, inline tools, and block tunes — each with lifecycle hooks, paste handling, and conversion rules. Tools talk to the editor through 18 API namespaces (`blocks`, `caret`, `selection`, `history`, and so on).

**Paste that doesn't mangle things.** A handler chain keeps block structure intact when you paste from Blok itself, strips the noise out of Google Docs HTML, and lets tools claim specific file types or patterns.

**Block conversion.** Turn one block type into another from the inline toolbar or in code, one block or a whole selection at a time.

**Read-only mode.** Call `readOnly.set(true)` and the editor re-renders without any editing affordances.

**Accessibility.** ARIA live announcements for drag and block operations, Notion-style vertical caret movement, and semantic data attributes you can hook tests onto.

## Installation

With a bundler (Vite, webpack, Rollup, etc.):

```bash
npm install @jackuait/blok
# or: yarn add @jackuait/blok / pnpm add @jackuait/blok
```

```js
// ESM
import Blok from '@jackuait/blok';

// CommonJS
const { Blok } = require('@jackuait/blok');
```

The core package ships the engine but no tools, so you choose what to load. Import individual tools from `@jackuait/blok/tools`, or grab the batteries-included bundle:

```js
import { Blok, defaultTools, defaultInlineTools } from '@jackuait/blok/full';

new Blok({
  holder: 'editor',
  tools: defaultTools,
  inlineTools: defaultInlineTools,
});
```

### Other entry points

- `@jackuait/blok/react` — a `useBlok` hook and a `BlokContent` component for React 18/19.
- `@jackuait/blok/markdown` — `markdownToBlocks(md)` to import Markdown (GFM, with optional math) as Blok data.
- `@jackuait/blok/locales` — locale data, if you'd rather load it yourself.

### CDN (no bundler)

```html
<script src="https://unpkg.com/@jackuait/blok/dist/blok.iife.js"></script>
<!-- or jsDelivr: https://cdn.jsdelivr.net/npm/@jackuait/blok/dist/blok.iife.js -->

<script>
  const editor = new BlokEditor.Blok({ holder: 'editor' });
</script>
```

The IIFE build puts everything under the `BlokEditor` global.

## Documentation

Full docs live at [blokeditor.com](https://blokeditor.com): API reference, an interactive demo, usage guides, and a migration guide if you're coming from Editor.js.

## Community

There's a Telegram channel at [t.me/that_ai_guy](https://t.me/that_ai_guy) for updates and questions about Blok and related projects.

## License & Attribution

Blok is licensed under the [Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE) for attribution.

Blok was forked from [Editor.js](https://github.com/codex-team/editor.js) by [CodeX](https://codex.so/) in November 2025 and reworked heavily since. The original Editor.js code remains © CodeX under Apache-2.0; Blok-specific changes are © JackUait, also under Apache-2.0.

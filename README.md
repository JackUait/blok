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

| Feature | What you get |
| --- | --- |
| **Block tools** | Paragraph, heading, list, quote, callout, code, image, divider, table, toggle, and a column layout. Plus a Notion-style database block (rows are child blocks) and embed/bookmark blocks for pasted links. |
| **Inline formatting** | Bold, italic, underline, strikethrough, inline code, link, and a highlight marker. |
| **Slash menu & markdown** | Type `/` in an empty block to search and insert, or type markdown (`#`, `-`, `1.`, `[]`, `>`) and it converts on space. |
| **Drag and drop** | Pointer-based reordering (not the flaky HTML5 drag API). Grab multiple blocks, hold Alt to duplicate while dragging, auto-scrolls near edges. Keyboard works too. |
| **Undo/redo on Yjs** | History is CRDT-backed: undo restores the caret, groups small edits, and batches atomically via `blocks.transact()`. |
| **69 locales, RTL** | Reads the browser language, lazy-loads the matching locale, and lays out right-to-left scripts correctly. |
| **Plugin system** | Three extension points — block tools, inline tools, block tunes — with lifecycle hooks, paste handling, and conversion rules. Tools reach the editor through 18 API namespaces (`blocks`, `caret`, `selection`, …). |
| **Smart paste** | A handler chain keeps block structure intact on internal paste, strips Google Docs HTML noise, and lets tools claim specific file types or patterns. |
| **Block conversion** | Turn one block type into another from the inline toolbar or in code, one block or a whole selection at a time. |
| **Read-only mode** | Call `readOnly.set(true)` and the editor re-renders without editing affordances. |
| **Accessibility** | ARIA live announcements for drag and block ops, Notion-style vertical caret movement, semantic data attributes for tests. |

## Installation

With a bundler (Vite, webpack, Rollup, etc.):

```bash
npm install @bloklabs/core
# or: yarn add @bloklabs/core / pnpm add @bloklabs/core
```

Using a framework? Add the adapter package alongside the core:

```bash
npm install @bloklabs/core @bloklabs/react    # or @bloklabs/vue / @bloklabs/angular
```

```js
// ESM
import Blok from '@bloklabs/core';

// CommonJS
const { Blok } = require('@bloklabs/core');
```

The core package ships the engine but no tools, so you choose what to load. Import individual tools from `@bloklabs/core/tools`, or grab the batteries-included bundle:

```js
import { Blok, defaultTools, defaultInlineTools } from '@bloklabs/core/full';

new Blok({
  holder: 'editor',
  tools: defaultTools,
  inlineTools: defaultInlineTools,
});
```

### Framework adapters & other entry points

The adapters are separate packages that peer on `@bloklabs/core`, so versions stay in lockstep and the editor engine is never bundled twice.

- `@bloklabs/react` — React 18/19 adapter. The recommended entry point is `<BlokEditor>`, an all-in-one component that forwards a ref to the live `Blok` instance:

  ```tsx
  const [data, setData] = useState(initialData);
  <BlokEditor tools={tools} data={data} onSave={setData} theme={theme} />;
  ```

  `data` + `onSave` make `<BlokEditor>` a true **controlled component**. `data` is reactive: passing new content re-renders the editor in place (deep-equal–deduped, so identical content never clobbers the caret). `onSave` is the output half: it fires — debounced — with the full serialized `OutputData` on every content change, so you no longer poll `ref.current.save()` by hand. Wiring `onSave={setData}` is safe and caret-stable: the adapter records the editor's own emitted output as the content baseline, so echoing it back deep-equal–dedupes to a no-op (no re-render) while genuine external `data` changes still render. (You can still forward a ref and call `ref.current.render(newData)` for ad-hoc reloads, or use the lower-level `onChange(api, event)` for mutation events.)

  Reactive props (`readOnly`, `theme`, `width`, `autofocus`) sync without remounting. When structural config like `tools` needs to change, pass a `deps` array — the editor is destroyed and recreated whenever any dep value changes. Keep each value inside `deps` referentially stable: pass primitives or `useMemo`-stable objects, since a dep value whose identity changes every render recreates the editor each time. (The individual values are compared, not the array wrapper, so a fresh `[a, b]` literal each render is fine when `a` and `b` are stable; omitting `deps` creates the editor once.)

  Don't wrap `<BlokEditor>` in `styled()` or any HOC that reserves the `theme` prop — styled-components claims `theme` for its own `ThemeProvider`, so it never reaches the editor and theme sync silently breaks. Render `<BlokEditor>` directly and style it through `className`.

  For advanced control (e.g., rendering outside a single container), use `useBlok` + `BlokContent` directly.
- `@bloklabs/vue` — Vue 3 adapter: `<BlokEditor>` component plus `useBlok`/`useBlocks` composables and `createVueBlock` for authoring block tools as Vue components.
- `@bloklabs/angular` — Angular adapter (APF partial-Ivy bundle): `BlokEditorComponent`, `injectBlocks`, and `createAngularBlock` for component-based block tools.
- `@bloklabs/core/markdown` — `markdownToBlocks(md)` to import Markdown (GFM, with optional math) as Blok data.
- `@bloklabs/core/locales` — locale data, if you'd rather load it yourself.

### CDN (no bundler)

```html
<script src="https://unpkg.com/@bloklabs/core/dist/blok.iife.js"></script>
<!-- or jsDelivr: https://cdn.jsdelivr.net/npm/@bloklabs/core/dist/blok.iife.js -->

<script>
  const editor = new BlokEditor.Blok({ holder: 'editor' });
</script>
```

The IIFE build puts everything under the `BlokEditor` global.

## Styling & theming

Blok's chrome is customizable through public `--blok-*` CSS custom properties. Pass them as `style.tokens` in the constructor config (or swap them at runtime with `editor.tokens.set()`) to recolor popovers, surfaces, selection, headings, lists, and block rhythm — the full token list is in the [API reference](https://blokeditor.com).

Layout hooks are CSS-only. The most commonly overridden one is the **editor gutter**: Blok reserves `--blok-editor-gutter-start: 56px` in edit mode for the floating +/⠿ block controls and collapses it automatically in read-only mode, so don't hand-roll wrapper padding for those controls. To change or remove it, declare the token on the wrapper element itself:

```css
[data-blok-interface] {
  --blok-editor-gutter-start: 0px; /* or any width; --blok-editor-gutter-end also exists */
}
```

Blok declares its defaults at zero specificity via `:where()`, so any host declaration wins. The gutter tokens are state-dependent and therefore rejected by `style.tokens` / `tokens.set()` — set them in CSS as above.

## Documentation

Full docs live at [blokeditor.com](https://blokeditor.com): API reference, an interactive demo, usage guides, and a migration guide if you're coming from Editor.js.

## Community

There's a Telegram channel at [t.me/that_ai_guy](https://t.me/that_ai_guy) for updates and questions about Blok and related projects.

## License & Attribution

Blok is licensed under the [Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE) for attribution.

Blok was forked from [Editor.js](https://github.com/codex-team/editor.js) by [CodeX](https://codex.so/) in November 2025 and reworked heavily since. The original Editor.js code remains © CodeX under Apache-2.0; Blok-specific changes are © JackUait, also under Apache-2.0.

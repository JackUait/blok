<p align="center">
  <a href="https://blokeditor.com" target="_blank" rel="noopener noreferrer">
    <img width="40%" alt="Blok logotype" src="./static/blok.png">
  </a>
</p>

## It's Blok!

**Blok** is a headless, highly extensible rich text editor built for developers who need to implement a block-based editing experience (similar to Notion) without building it from scratch.

Unlike traditional `contenteditable` solutions that treat text as a single HTML blob, Blok treats every piece of content—paragraphs, headings, images, lists—as an individual Block. This architecture allows for drag-and-drop reordering, complex nesting, and a strictly typed data structure.

**Key Features:**

**🧱 Block Architecture** — Content is structured as JSON blocks, not HTML, making it easy to store, transform, and render on any platform.

**🛠️ Built-in Tools** — Ships with paragraph, header, list, table, and toggle blocks, plus inline formatting (bold, italic, link, marker) — all configurable.

**⚡ Slash Commands & Markdown Shortcuts** — Type `/` to search and insert blocks, or use markdown syntax (`#`, `-`, `1.`, `[]`, `>`) that auto-converts on space.

**🖱️ Drag & Drop** — Pointer-based block reordering with multi-block drag, Alt+drag to duplicate, auto-scroll near edges, and full keyboard accessibility.

**🔄 CRDT-Powered History** — Undo/redo built on Yjs with caret restoration, smart edit grouping, and atomic transactions via `blocks.transact()`.

**🌍 68 Locales & RTL** — Auto-detects browser language, lazy-loads locale data, and supports right-to-left languages out of the box.

**🔌 Extensible Plugin System** — Three tool types (BlockTool, InlineTool, BlockTune) with lifecycle hooks, paste configs, conversion configs, and access to 17 public API modules.

**📦 Pre-configured Bundles** — Import `@jackuait/blok/full` for batteries-included setup with `defaultTools` or `allTools`, or import individual tools for full control.

**📋 Smart Paste** — Priority-based handler chain that preserves block structure on internal paste, cleans Google Docs HTML, and supports tool-specific file/pattern matching.

**🔀 Block Conversion** — Convert between block types from the inline toolbar or programmatically, with multi-block batch conversion support.

**👁️ Read-Only Mode** — Toggle at runtime with `readOnly.set()` — re-renders all blocks with editing UI hidden.

**♿ Accessible** — ARIA live announcements for drag and block operations, full keyboard navigation (Notion-style vertical caret movement), and semantic data attributes throughout.

## Installation

**npm / yarn / pnpm (bundler):**

```bash
npm install @jackuait/blok
# or
yarn add @jackuait/blok
# or
pnpm add @jackuait/blok
```

```js
// ESM (Vite, webpack, Rollup, …)
import Blok from '@jackuait/blok';

// CommonJS (Node.js, Jest, …)
const { Blok } = require('@jackuait/blok');
```

**CDN (no bundler, `<script>` tag):**

```html
<!-- unpkg -->
<script src="https://unpkg.com/@jackuait/blok/dist/blok.iife.js"></script>

<!-- jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/@jackuait/blok/dist/blok.iife.js"></script>

<script>
  const editor = new BlokEditor.Blok({ holder: 'editor' });
</script>
```

The IIFE bundle exposes everything under the `BlokEditor` global.

## Documentation

📚 **Full documentation is available at [blokeditor.com](https://blokeditor.com)**

Visit the documentation site for:
- Complete API reference
- Interactive demo
- Usage guides and examples
- Migration guide from Editor.js

## Community

💬 **Join the Telegram channel**: [t.me/that_ai_guy](https://t.me/that_ai_guy)

Follow for updates, discussions, and insights about Blok and other projects.
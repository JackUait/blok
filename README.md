<p align="center">
  <img width="40%" alt="Blok logotype" src="./static/blok.webp">
</p>

## Introducing Blok

**Blok** is a headless, highly extensible rich text editor built for developers who need to implement a block-based editing experience (similar to Notion) without building it from scratch.

Unlike traditional `contenteditable` solutions that treat text as a single HTML blob, Blok treats every piece of content—paragraphs, headings, images, lists—as an individual Block. This architecture allows for drag-and-drop reordering, complex nesting, and a strictly typed data structure.

**Key Features:**

**🧱 Block Architecture**: Content is structured as JSON data, not raw HTML, making it easy to parse, store, and render anywhere.

**⚡ Slash Commands**: Includes a built-in, customizable "Slash Menu" (/) for quick formatting and inserting media.

**🎨 Headless & Stylable**: Blok gives you the logic; you bring the UI. Fully compatible with Tailwind, Styled Components, or raw CSS.

**🖱️ Drag & Drop**: Native support for rearranging blocks with intuitive handles.

**🔌 Extensible Plugin System**: Easily create custom blocks (e.g., Kanbans, Embeds, Code Blocks) to fit your specific use case.

## Installation

Install the package via NPM or Yarn:

```bash
npm install @jackuait/blok
```

or

```bash
yarn add @jackuait/blok
```

## Migrating from EditorJS

If you're migrating from EditorJS, Blok provides a seamless transition path:

### Automated Migration

Run the codemod to automatically update your codebase:

```bash
# Preview changes (recommended first)
npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run

# Apply changes
npx -p @jackuait/blok migrate-from-editorjs ./src

# Process the entire project
npx -p @jackuait/blok migrate-from-editorjs .
```

The codemod handles:
- Import updates (`@editorjs/editorjs` → `@jackuait/blok`)
- Type renames (`EditorConfig` → `BlokConfig`)
- CSS selector updates (`.ce-*` → `[data-blok-*]`)
- Data attribute updates (`data-id` → `data-blok-id`)
- Bundled tool migrations (Header & Paragraph are now included)

### Migration Guide

For a complete list of breaking changes and manual migration steps, see [MIGRATION.md](./MIGRATION.md).

## Documentation

📚 **Documentation is coming soon!** We're working hard to provide comprehensive guides, API references, and examples. Stay tuned for updates.

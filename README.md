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

## Quick Start

Blok uses a modular architecture for optimal bundle size. Import tools separately from the core:

```typescript
import { Blok } from '@jackuait/blok';
import { Header, Paragraph, List, Bold, Italic, Link } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Block tools - inlineToolbar is enabled by default
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
    // Inline tools
    bold: Bold,
    italic: Italic,
    link: Link,
  },
});

// Save content as JSON
const data = await editor.save();
```

Tool configuration is flat—no need for nested `config: {}`. Blok automatically extracts known settings (`class`, `inlineToolbar`, `shortcut`, etc.) and passes the rest to the tool.

### Entry Points

| Entry Point | Description |
|-------------|-------------|
| `@jackuait/blok` | Core editor (no tools included) |
| `@jackuait/blok/tools` | Built-in tools: Header, Paragraph, List, Bold, Italic, Link, Convert |
| `@jackuait/blok/locales` | Locale loading utilities |

This modular approach means you only bundle the tools you use, resulting in smaller bundles for your users.

## Migrating from EditorJS

Blok is designed as a drop-in replacement for EditorJS. The included codemod automatically transforms your imports, selectors, and configuration—so you can switch over in minutes, not hours.

### Quick Start

```bash
# 1. Preview what will change (recommended first)
npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run

# 2. Apply the changes
npx -p @jackuait/blok migrate-from-editorjs ./src
```

### Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview changes without modifying files |
| `--verbose` | Show detailed output for each file processed |
| `--use-library-i18n` | Use Blok's built-in translations (36 languages) instead of custom i18n |

### Supported Files

The codemod processes: `.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.html`, `.css`, `.scss`, `.less`

### What Gets Transformed

- **Imports** — `@editorjs/editorjs` → `@jackuait/blok`
- **Tool imports** — `@editorjs/header` → `@jackuait/blok/tools`
- **Types** — `EditorConfig` → `BlokConfig`
- **CSS selectors** — `.ce-block`, `.ce-toolbar` → `[data-blok-*]` attributes
- **Data attributes** — `data-id` → `data-blok-id`
- **Default holder** — `#editorjs` → `#blok`

The codemod also handles **existing Blok users** upgrading to the modular architecture:
- Splits combined imports: `{ Blok, Header }` from `@jackuait/blok` → separate imports
- Updates static property access: `Blok.Header` → `Header`

### Limitations

Some patterns require manual attention:
- Dynamic imports with variable paths
- Complex nested CSS selectors
- Custom EditorJS plugins (need API adaptation)

### Learn More

- [MIGRATION.md](./MIGRATION.md) — Full list of breaking changes and manual steps
- [codemod/README.md](./codemod/README.md) — Programmatic usage and detailed examples

## Localization

Blok supports 68 languages with lazy loading—only English is bundled by default (~3KB). Additional locales are loaded on-demand, keeping your initial bundle small.

### Default Behavior

Out of the box, Blok uses English and auto-detects the user's browser language:

```typescript
import { Blok } from '@jackuait/blok';

new Blok({
  holder: 'editor',
  // Uses English by default, auto-detects browser language
});
```


### Preloading Locales

By default, locales are loaded on-demand. If you need to ensure locales are available before initializing the editor—for example, to avoid any loading delay or to support offline usage—you can preload them:

```typescript
import { Blok } from '@jackuait/blok';
import { preloadLocales, buildRegistry } from '@jackuait/blok/locales';

// Preload during app startup (triggers network requests and caches the locales)
await preloadLocales(['en', 'fr', 'de']);

// Build registry from preloaded locales (instant, no network request)
const locales = await buildRegistry(['en', 'fr', 'de']);

new Blok({
  holder: 'editor',
  i18n: {
    locales,
    locale: 'auto',
  }
});
```

**When to preload:**
- Offline support (preload all needed locales before going offline)
- Eliminating any loading delay during editor initialization
- Progressive web apps that cache resources upfront

**When not to preload:**
- Most apps—just use `buildRegistry()` directly and accept the ~50-100ms loading time
- The on-demand loading is usually imperceptible

### Setting a Specific Locale

```typescript
new Blok({
  holder: 'editor',
  i18n: {
    locale: 'fr',         // Use French
    defaultLocale: 'en',  // Fallback if 'fr' unavailable
  }
});
```

## Documentation

📚 **Complete Documentation is coming soon!** We're working hard to provide comprehensive guides, API references, and examples. Stay tuned for updates.

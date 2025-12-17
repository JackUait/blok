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
- **Types** — `EditorConfig` → `BlokConfig`
- **CSS selectors** — `.ce-block`, `.ce-toolbar` → `[data-blok-*]` attributes
- **Data attributes** — `data-id` → `data-blok-id`
- **Bundled tools** — Header & Paragraph imports removed (now included in Blok)
- **Default holder** — `#editorjs` → `#blok`

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
import Blok from '@jackuait/blok';

new Blok({
  holder: 'editor',
  // Uses English by default, auto-detects browser language
});
```

### Loading Additional Languages

Use the async loader functions to load locales on-demand:

```typescript
import Blok from '@jackuait/blok';
import { loadBasicLocales } from '@jackuait/blok/locales';

// Load the Basic preset (14 languages) during app initialization
const locales = await loadBasicLocales();

new Blok({
  holder: 'editor',
  i18n: {
    locales,
    locale: 'auto',
  }
});
```

| Loader Function | Languages | Bundle Impact |
|-----------------|-----------|---------------|
| (none) | English only | ~3KB |
| `loadBasicLocales()` | en, zh, es, fr, de, pt, ja, ko, ar, it, ru, hi, hy, id | ~45KB on-demand |
| `loadExtendedLocales()` | Basic + tr, vi, pl, nl, th, ms, sv, no, da, fi, el, cs | ~80KB on-demand |
| `loadAllLocales()` | All 68 languages | ~200KB on-demand |

### Loading Individual Locales

For maximum control, load only the languages you need:

```typescript
import Blok from '@jackuait/blok';
import { loadLocale, buildRegistry } from '@jackuait/blok/locales';

// Option 1: Load a single locale
const frConfig = await loadLocale('fr');

// Option 2: Build a custom registry
const locales = await buildRegistry(['en', 'fr', 'de', 'es']);

new Blok({
  holder: 'editor',
  i18n: {
    locales,
    locale: 'auto',
  }
});
```

### Preloading Locales

By default, switching locales requires an async call (`setLocaleAsync`) to fetch the locale chunk. If you need **instant, synchronous** locale switching—for example, in a language dropdown where you can't await—you can preload locales during app initialization:

```typescript
import { preloadLocales, getLocaleSync } from '@jackuait/blok/locales';

// Preload during app startup (triggers network requests)
await preloadLocales(['en', 'fr', 'de']);

// Later, access synchronously (no await needed, already cached)
const frConfig = getLocaleSync('fr');
I18n.setLocale('fr'); // Instant, no network request
```

**When to preload:**
- Language switcher UI that can't handle async operations
- Offline support (preload before going offline)
- Performance-critical paths where you can't await

**When not to preload:**
- Most apps—just use `setLocaleAsync()` and show a brief loading state
- The ~50-100ms delay on language switch is usually imperceptible

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

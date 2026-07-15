# Migrating from EditorJS to Blok

This guide covers the breaking changes when migrating from EditorJS to Blok.

## Table of Contents

- [Supported Editor.js Versions](#supported-editorjs-versions)
- [Core Changes](#core-changes)
- [Data Attributes](#data-attributes)
- [CSS Classes](#css-classes)
- [Bundled Tools](#bundled-tools)
  - [Tool Configuration](#tool-configuration)
  - [Lifecycle Hooks](#lifecycle-hooks)
  - [Delimiter → Divider](#delimiter--divider)
- [Migrating Custom Tools](#migrating-custom-tools)
  - [Custom Block Tools (port unchanged)](#custom-block-tools-port-unchanged)
  - [Custom Inline Tools (breaking rewrite)](#custom-inline-tools-breaking-rewrite)
- [Saved Content / Data Migration](#saved-content--data-migration)
  - [Auto-Migrated on Load](#auto-migrated-on-load)
  - [Dropped Fields](#dropped-fields)
- [Configuration Defaults](#configuration-defaults)
- [New API Methods](#new-api-methods)
- [DOM Selectors](#dom-selectors)
- [E2E Test Selectors](#e2e-test-selectors)

---

## Supported Editor.js Versions

Blok targets the **Editor.js 2.x** line. The [codemod](./codemod) is built against the package versions a typical Editor.js 2.x project ships — `@editorjs/editorjs@^2.28.x`, `@editorjs/header@^2.8.x`, `@editorjs/paragraph@^2.11.x`, `@editorjs/list@^1.9.x` — and the runtime auto-migration reads the saved-data shapes those versions produce. Older 2.x data formats are still recognized; the matrix below describes coverage per block/tool, not per Editor.js point release.

There is no pinned single source version: Blok is API-compatible with the Editor.js 2.x `BlockTool` / `InlineTool` contracts, so what matters is **which tools your content uses**, covered below.

### Compatibility Matrix

How each Editor.js block/tool is handled. "Auto-migrated at runtime" means the conversion happens on `render()` with no script needed; "Codemod" means the [codemod](./codemod) rewrites saved JSON; "Drop-in unchanged" means the data passes through as-is; "Not bundled" means Blok ships no equivalent tool, so you must register your own (a ported Editor.js block tool works unchanged — see [Migrating Custom Tools](#migrating-custom-tools)) or the block renders as a preserved stub with a `console.warn` and round-trips untouched on save.

| Editor.js block / tool | Migration status | Notes |
|------------------------|------------------|-------|
| `paragraph` | Drop-in unchanged | Bundled as `Blok.Paragraph` (the default block). |
| `header` | Drop-in unchanged | Bundled as `Blok.Header`. |
| `list` (nested **and** string-array items) | Auto-migrated at runtime **+** codemod | Each item expands to a flat `list` block. |
| `checklist` (standalone tool) | Auto-migrated at runtime **+** codemod | Becomes `list` blocks with checklist style. |
| `toggleList` | Auto-migrated at runtime **+** codemod → `toggle` | Becomes a `toggle` block (or a toggle `header` when `titleVariant` is set); body blocks flatten into parented children. |
| `callout` (legacy `body`/`variant` shape) | Auto-migrated at runtime **+** codemod | Legacy `{ body, variant, emoji }` → flat `{ emoji, textColor, backgroundColor }`; body blocks flatten into parented children. |
| `image`, `simple-image` | Auto-migrated at runtime **+** codemod | `file.url` (or `simple-image`'s flat `url`) → `url`; `withBorder` → `frame`, `stretched: true` → `size: full`. `withBackground` is dropped (warns). |
| `linkTool` | Auto-migrated at runtime **+** codemod → `bookmark` | `meta` flattens onto the bookmark shape; `meta.site_name` is dropped (warns). |
| `delimiter` | Codemod renames type → `divider` | Data format is identical (`{}`). Also recognized at render, so existing data works without the rename. |
| `quote` | Auto-migrated at runtime **+** codemod | `caption` becomes a trailing `paragraph` sibling; `alignment` is dropped (warns). The quote text/size render unchanged. |
| `code` | Drop-in unchanged | Passes through to Blok's bundled `code` tool. |
| `table` (HTML-string cells) | Auto-migrated at runtime **+** codemod | Each non-empty cell becomes a `{ blocks: [id] }` cell-ref plus a child `paragraph` (`parent` = table id); empty cells become `{ blocks: [] }`. `withHeadings` is preserved. Cells already in block-ref shape pass through. |
| `embed` | Drop-in unchanged | Bundled as `Blok.Embed`. `{ service, source, embed, width, height, caption }` map 1:1; iframe providers render correctly (Blok-only fields default). |
| `raw` | Auto-migrated at runtime **+** codemod → `code` | Blok has no raw tool; `{ html }` becomes a `code` block showing the markup as source verbatim. |
| `warning` | Auto-migrated at runtime **+** codemod → `callout` | Becomes a ⚠️ orange `callout`; `title` and `message` become child `paragraph` blocks. |
| `attaches` | Auto-migrated at runtime **+** codemod → `bookmark` | `file.url` + `title` map to a `bookmark`; file metadata (`name`/`size`/`extension`) is dropped (warns). |
| `marker`, `inlineCode` (inline) | Not bundled | Register your own (port unchanged or wrap with `wrapLegacyInlineTool`). See [Custom Inline Tools](#custom-inline-tools). |
| Other third-party block tools (`personality`, `button`, audio, …) | Not bundled | No built-in equivalent. Register a tool to render them; otherwise the block is preserved as a stub (warns) and survives a save/load round-trip. |

> **Heads-up:** any block type Blok doesn't recognize and has no registered tool for renders as a stub and logs `Tool «<name>» is not found`. Its data is preserved, so registering the tool later restores the block.

---

## Core Changes

### Class Name

```diff
- import EditorJS from '@editorjs/editorjs';
+ import Blok from '@bloklabs/core';

- const editor = new EditorJS({ ... });
+ const editor = new Blok({ ... });
```

`Blok` is also exported as the **default export** and under an `EditorJS` alias, so you can keep your existing variable name and only change the import path — a minimal-diff, drop-in migration:

```diff
- import EditorJS from '@editorjs/editorjs';
+ import { EditorJS } from '@bloklabs/core';

  const editor = new EditorJS({ ... }); // unchanged
```

`import Blok`, `import { Blok }`, and `import { EditorJS }` all resolve to the same class.

### Default Holder

The default holder ID changed from `editorjs` to `blok`:

```diff
- <div id="editorjs"></div>
+ <div id="blok"></div>
```

Or specify explicitly:

```javascript
const editor = new Blok({
  holder: 'my-editor', // works the same as before
});
```

### TypeScript Types

```diff
- import type { EditorConfig, OutputData } from '@editorjs/editorjs';
+ import type { BlokConfig, OutputData } from '@bloklabs/core';
```

---

## Data Attributes

Blok uses `data-blok-*` attributes instead of EditorJS's mixed naming conventions.

| EditorJS | Blok |
|----------|------|
| `data-id` | `data-blok-id` |
| `data-item-name` | `data-blok-item-name` |
| `data-empty` | `data-blok-empty` |
| `.ce-block--selected` (class) | `data-blok-selected="true"` |
| — | `data-blok-component` (tool name) |
| — | `data-blok-interface` (element type) |
| — | `data-blok-testid` (testing) |
| — | `data-blok-opened` (toolbar state) |
| — | `data-blok-placeholder` |
| — | `data-blok-stretched` |
| — | `data-blok-focused` |
| — | `data-blok-popover-opened` |
| — | `data-blok-tool` (tool name on rendered element) |
| — | `data-blok-dragging` (block being dragged) |
| — | `data-blok-hidden` (hidden state) |
| — | `data-blok-rtl` (RTL mode) |
| — | `data-blok-drag-handle` (drag handle element) |
| — | `data-blok-overlay` (selection overlay) |
| — | `data-blok-overlay-rectangle` (selection rectangle) |

### Querying Blocks

```diff
- document.querySelector('[data-id="abc123"]');
+ document.querySelector('[data-blok-id="abc123"]');

- document.querySelector('[data-item-name="bold"]');
+ document.querySelector('[data-blok-item-name="bold"]');
```

---

## CSS Classes

Blok replaces BEM class names with data attributes for selection.

### Editor Wrapper

| EditorJS | Blok |
|----------|------|
| `.codex-editor` | `[data-blok-editor]` |
| `.codex-editor__redactor` | `[data-blok-redactor]` |
| `.codex-editor--rtl` | `[data-blok-rtl="true"]` |

### Block Elements

| EditorJS | Blok |
|----------|------|
| `.ce-block` | `[data-blok-element]` |
| `.ce-block--selected` | `[data-blok-selected="true"]` |
| `.ce-block--stretched` | `[data-blok-stretched="true"]` |
| `.ce-block--focused` | `[data-blok-focused="true"]` |
| `.ce-block__content` | `[data-blok-element-content]` |

### Toolbar

| EditorJS | Blok |
|----------|------|
| `.ce-toolbar` | `[data-blok-toolbar]` |
| `.ce-toolbar__plus` | `[data-blok-testid="plus-button"]` |
| `.ce-toolbar__settings-btn` | `[data-blok-settings-toggler]` |
| `.ce-toolbar__actions` | `[data-blok-testid="toolbar-actions"]` |
| `.ce-toolbox` | `[data-blok-toolbox]` |
| `.ce-toolbox--opened` | `[data-blok-toolbox][data-blok-opened="true"]` |

### Inline Toolbar

| EditorJS | Blok |
|----------|------|
| `.ce-inline-toolbar` | `[data-blok-testid="inline-toolbar"]` |
| `.ce-inline-tool` | `[data-blok-testid="inline-tool"]` |
| `.ce-inline-tool--link` | `[data-blok-testid="inline-tool-link"]` |
| `.ce-inline-tool--bold` | `[data-blok-testid="inline-tool-bold"]` |
| `.ce-inline-tool--italic` | `[data-blok-testid="inline-tool-italic"]` |

### Popover

| EditorJS | Blok |
|----------|------|
| `.ce-popover` | `[data-blok-popover]` |
| `.ce-popover--opened` | `[data-blok-popover][data-blok-opened="true"]` |
| `.ce-popover__container` | `[data-blok-popover-container]` |
| `.ce-popover-item` | `[data-blok-testid="popover-item"]` |
| `.ce-popover-item--focused` | `[data-blok-focused="true"]` |
| `.ce-popover-item--confirmation` | `[data-blok-confirmation="true"]` |
| `.ce-popover-item__icon` | `[data-blok-testid="popover-item-icon"]` |
| `.ce-popover-item__icon--tool` | `[data-blok-testid="popover-item-icon-tool"]` |

### Tool-Specific Classes

| EditorJS | Blok |
|----------|------|
| `.ce-paragraph` | `[data-blok-tool="paragraph"]` |
| `.ce-header` | `[data-blok-tool="header"]` |

### Conversion Toolbar & Settings

| EditorJS | Blok |
|----------|------|
| `.ce-conversion-toolbar` | `[data-blok-testid="conversion-toolbar"]` |
| `.ce-conversion-tool` | `[data-blok-testid="conversion-tool"]` |
| `.ce-settings` | `[data-blok-testid="block-settings"]` |
| `.ce-tune` | `[data-blok-testid="block-tune"]` |

### Other Elements

| EditorJS | Blok |
|----------|------|
| `.ce-stub` | `[data-blok-stub]` |
| `.ce-drag-handle` | `[data-blok-drag-handle]` |
| `.ce-ragged-right` | `[data-blok-ragged-right="true"]` |

### CDX List Classes

| EditorJS | Blok |
|----------|------|
| `.cdx-list` | `[data-blok-list]` |
| `.cdx-list__item` | `[data-blok-list-item]` |
| `.cdx-list--ordered` | `[data-blok-list="ordered"]` |
| `.cdx-list--unordered` | `[data-blok-list="unordered"]` |

### CDX Utility Classes

| EditorJS | Blok |
|----------|------|
| `.cdx-button` | `[data-blok-button]` |
| `.cdx-input` | `[data-blok-input]` |
| `.cdx-loader` | `[data-blok-loader]` |
| `.cdx-search-field` | `[data-blok-search-field]` |

---

## Bundled Tools

Blok includes Header and Paragraph tools. No external packages needed:

```diff
- import Header from '@editorjs/header';
- import Paragraph from '@editorjs/paragraph';

+ import Blok from '@bloklabs/core';

const editor = new Blok({
  tools: {
-   header: Header,
-   paragraph: Paragraph,
+   header: Blok.Header,
+   paragraph: Blok.Paragraph, // optional, it's the default
  },
});
```

### Tool Configuration

Both bundled tools accept configuration options:

#### HeaderConfig

```typescript
import type { HeaderConfig } from '@bloklabs/core';

const editor = new Blok({
  tools: {
    header: {
      class: Blok.Header,
      config: {
        placeholder: 'Enter a heading',
        levels: [2, 3, 4],      // Restrict to H2-H4 only
        defaultLevel: 2,        // Default to H2
      } as HeaderConfig,
    },
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `placeholder` | `string` | `''` | Placeholder text for empty header |
| `levels` | `number[]` | `[1,2,3,4,5,6]` | Available heading levels (1-6) |
| `defaultLevel` | `number` | `2` | Default heading level |

#### ParagraphConfig

```typescript
import type { ParagraphConfig } from '@bloklabs/core';

const editor = new Blok({
  tools: {
    paragraph: {
      class: Blok.Paragraph,
      config: {
        placeholder: 'Start typing...',
        preserveBlank: true,
      } as ParagraphConfig,
    },
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `placeholder` | `string` | `''` | Placeholder text for empty paragraph |
| `preserveBlank` | `boolean` | `false` | Keep empty paragraphs when saving |

### Delimiter → Divider

Editor.js's `@editorjs/delimiter` is replaced by Blok's built-in `divider` tool:

```diff
- import Delimiter from '@editorjs/delimiter';

const editor = new Blok({
  tools: {
-   delimiter: Delimiter,
+   divider: Blok.Divider,
  },
});
```

**Saved data migration:** The block type name changed from `"delimiter"` to `"divider"`. The data format is identical (empty `{}`):

```diff
  {
-   "type": "delimiter",
+   "type": "divider",
    "data": {}
  }
```

> **Note:** Blok automatically recognizes `"delimiter"` blocks and renders them as dividers, so existing articles work without data migration. However, renaming the type in your database is recommended for consistency.

---

## Migrating Custom Tools

If your project ships its own tools, here's what changes and what doesn't.

### Custom Block Tools (port unchanged)

**Custom block tools work as-is.** Blok's `BlockTool` interface keeps the same shape as EditorJS, read by the **same keys**:

- Methods: `render()`, `save()`, `validate()`, `renderSettings()`, `merge()`, `onPaste()`, and the lifecycle hooks `rendered()`, `updated()`, `removed()`, `moved()`.
- Statics: `toolbox`, `conversionConfig`, `pasteConfig`, `isReadOnlySupported`, `enableLineBreaks`.

In most cases you can drop your existing block tool into Blok without touching its code.

#### New optional `setReadOnly(state)` method

Blok adds an **optional** `setReadOnly(state: boolean)` method. It is not a breaking change:

- **If you omit it**, read-only toggling still works — Blok falls back to a full re-render of the block (graceful degradation).
- **If you implement it**, Blok performs a cheaper in-place toggle instead of re-rendering.

```typescript
class MyTool {
  // ...render / save / validate as before...

  // Optional: enables the cheaper in-place read-only toggle
  setReadOnly(state: boolean): void {
    this.input.contentEditable = state ? 'false' : 'true';
  }
}
```

#### New optional statics

Two new **optional** statics exist for advanced cases; existing tools never need them:

- `titleKey` — a translation key for the tool's toolbox title (i18n).
- `provides` — lets one class register multiple block types.

### Custom Inline Tools

**This is the one API difference for custom tools.** EditorJS inline tools built a DOM button and used imperative `surround` / `checkState` / `renderActions` / `clear` methods. Blok's `InlineTool` (`types/tools/inline-tool.d.ts`) instead expects `render()` to return a declarative `MenuConfig` object with `onActivate` / `isActive` callbacks.

You have two paths:

#### Fast path — wrap with `wrapLegacyInlineTool`

To keep an existing EditorJS inline tool working without a rewrite, wrap its class:

```typescript
import { wrapLegacyInlineTool } from '@bloklabs/core';
import MarkerTool from './marker-tool'; // your existing EditorJS inline tool

const editor = new Blok({
  tools: {
    marker: wrapLegacyInlineTool(MarkerTool),
  },
});
```

The shim adapts the legacy contract automatically: it calls your tool's `render()` for the icon, routes `onActivate` → `surround(range)` and `isActive` → `checkState(selection)`, and forwards the static `title` / `shortcut` / `sanitize`. Without wrapping, Blok silently skips a legacy `render()` that returns an `HTMLElement`, so the tool would vanish from the inline toolbar. `renderActions()` / `clear()` are not bridged.

#### Native path — rewrite to `MenuConfig` (recommended)

For full access to Blok features (nested items, confirmation), port to the native shape:

#### Before (EditorJS)

```typescript
class MarkerTool {
  static get isInline() { return true; }
  static get title() { return 'Marker'; }

  private button: HTMLButtonElement;

  render(): HTMLElement {
    this.button = document.createElement('button');
    this.button.innerHTML = '<svg>...</svg>';
    return this.button;
  }

  // Apply / remove formatting on the current range
  surround(range: Range): void {
    document.execCommand('backColor', false, '#ffd700');
  }

  // Reflect active state by inspecting the selection
  checkState(selection: Selection): boolean {
    const isActive = /* ...inspect selection... */;
    this.button.classList.toggle('active', isActive);
    return isActive;
  }

  renderActions(): HTMLElement { /* extra UI */ }
  clear(): void { /* reset extra UI */ }
}
```

#### After (Blok)

```typescript
import type { InlineTool, MenuConfig } from '@bloklabs/core';

class MarkerTool implements InlineTool {
  static isInline = true;
  static title = 'Marker';
  static titleKey = 'marker'; // optional i18n key

  // render() now returns a MenuConfig object, not an HTMLElement
  render(): MenuConfig {
    return {
      icon: '<svg>...</svg>',
      name: 'marker',
      // surround(range) logic moves here
      onActivate: () => {
        document.execCommand('backColor', false, '#ffd700');
      },
      // checkState(selection) logic moves here
      isActive: () => {
        const selection = window.getSelection();
        return selection ? /* ...inspect selection... */ false : false;
      },
    };
  }
}
```

> See `src/components/inline-tools/inline-tool-bold.ts` for Blok's canonical inline tool. Its `render()` returns a `MenuConfig` with `onActivate` (apply/remove bold) and `isActive` (read the selection).

#### Mapping reference

| EditorJS | Blok |
|----------|------|
| `render()` returns an `HTMLElement` button | `render()` returns a `MenuConfig` `{ icon, name, onActivate, isActive }` |
| `surround(range)` | logic moves into `onActivate()` |
| `checkState(selection)` | logic moves into `isActive()` |
| `renderActions()` / `clear()` | **removed** — no direct equivalent; use `MenuConfig` `children` for nested items |
| `static get isInline()` / `static get title()` | still apply (plus optional `titleKey` for i18n) |

---

## Saved Content / Data Migration

Existing EditorJS output data keeps working. Blok converts legacy block shapes to its own format **automatically when the block renders** — no migration script needed.

### Auto-Migrated on Load

These EditorJS block types and data shapes are recognized and converted on `render()`:

| EditorJS block / shape | Becomes in Blok |
|------------------------|-----------------|
| `list` (nested items **and** string-array items) | Blok `list` |
| `checklist` (standalone tool) | Blok `list` (checklist style) |
| `image` `{ file: { url }, withBorder, stretched }` | Blok `image` |
| `table` (HTML-string cells) | Blok `table` |
| `header` | Blok `header` |
| `code` | Blok `code` |
| `delimiter` | Blok `divider` |
| `linkTool` | Blok `bookmark` |

No action is required — load your existing data and it renders correctly.

### Dropped Fields

A few EditorJS fields have no Blok equivalent and are **dropped** on load. The block still renders; only these specific fields are lost:

| Block | Dropped field(s) |
|-------|------------------|
| `quote` | `caption`, `alignment` |
| `image` | `withBackground` |
| `linkTool` | `meta.site_name` |
| `list` item | `meta` |

When migration drops one of these, Blok emits a `console.warn` (prefixed `[Blok migration]`) naming the block type and field, so the loss is visible in the console rather than silent. If you depend on any of these, capture them before migrating.

---

## Configuration Defaults

| Option | EditorJS | Blok |
|--------|----------|------|
| `holder` | `"editorjs"` | `"blok"` |
| `defaultBlock` | `"paragraph"` | `"paragraph"` |

---

## New API Methods

Blok exposes shorthand methods directly on the instance:

```javascript
const editor = new Blok({ ... });

// Shorthand methods
await editor.save();      // Same as editor.saver.save()
editor.clear();           // Same as editor.blocks.clear()
await editor.render(data);// Same as editor.blocks.render(data)
editor.focus();           // Same as editor.caret.focus()

// Event methods
editor.on('change', handler);   // Same as editor.events.on()
editor.off('change', handler);  // Same as editor.events.off()
editor.emit('custom', data);    // Same as editor.events.emit()
```

---

## DOM Selectors

Blok uses consistent `data-blok-interface` attributes for major UI components:

```javascript
// Find the editor wrapper
const editorWrapper = document.querySelector('[data-blok-interface="blok"]');

// Find inline toolbar
const inlineToolbar = document.querySelector('[data-blok-interface="inline-toolbar"]');

// Find tooltip
const tooltip = document.querySelector('[data-blok-interface="tooltip"]');
```

These selectors are stable and recommended for programmatic access to Blok's UI components.

### Key Changes

1. **Prefix custom classes** with `blok-` instead of `ce-` or `cdx-`
2. **Use `data-blok-*`** attributes instead of `data-*`

---

## E2E Test Selectors

Update your test selectors to use Blok's `data-blok-testid` attributes:

| EditorJS | Blok |
|----------|------|
| `[data-cy=editorjs]` | `[data-blok-testid="blok-editor"]` |
| `.ce-block` | `[data-blok-element]` |
| `.ce-block__content` | `[data-blok-element-content]` |
| `.ce-toolbar` | `[data-blok-toolbar]` |
| `.ce-toolbar__plus` | `[data-blok-testid="plus-button"]` |
| `.ce-toolbar__settings-btn` | `[data-blok-settings-toggler]` |
| `.ce-toolbar__actions` | `[data-blok-testid="toolbar-actions"]` |
| `.ce-toolbox` | `[data-blok-toolbox]` |
| `.ce-inline-toolbar` | `[data-blok-testid="inline-toolbar"]` |
| `.ce-popover` | `[data-blok-popover]` |
| `.ce-popover-item` | `[data-blok-testid="popover-item"]` |
| `[data-item-name="..."]` | `[data-blok-item-name="..."]` |

### Playwright Example

```diff
// EditorJS
- await page.locator('[data-cy=editorjs] .ce-block').click();
- await page.locator('.ce-toolbar__settings-btn').click();
- await page.locator('[data-item-name="delete"]').click();

// Blok
+ await page.locator('[data-blok-element]').click();
+ await page.locator('[data-blok-settings-toggler]').click();
+ await page.locator('[data-blok-item-name="delete"]').click();
```

### Additional Test Selectors

| Element | Selector |
|---------|----------|
| Block tunes popover | `[data-blok-testid="block-tunes-popover"]` |
| Popover search input | `[data-blok-testid="popover-search-input"]` |
| Popover item title | `[data-blok-testid="popover-item-title"]` |
| Popover overlay | `[data-blok-testid="popover-overlay"]` |
| Inline tool input | `[data-blok-testid="inline-tool-input"]` |
| Tooltip | `[data-blok-testid="tooltip"]` |
| Redactor | `[data-blok-testid="redactor"]` |
| Toolbox | `[data-blok-testid="toolbox"]` |
| Toolbox popover | `[data-blok-testid="toolbox-popover"]` |
| Selection overlay | `[data-blok-testid="overlay"]` |
| Selection rectangle | `[data-blok-testid="overlay-rectangle"]` |

---

### State Selectors

| State | Selector |
|-------|----------|
| Toolbar opened | `[data-blok-opened="true"]` |
| Block selected | `[data-blok-selected="true"]` |
| Popover opened | `[data-blok-popover-opened="true"]` |
| Item focused | `[data-blok-focused="true"]` |
| Item disabled | `[data-blok-disabled="true"]` |
| Nested popover | `[data-blok-nested="true"]` |
| Toolbox opened | `[data-blok-toolbox-opened="true"]` |
| Block dragging | `[data-blok-dragging="true"]` |
| Element hidden | `[data-blok-hidden="true"]` |
| RTL mode | `[data-blok-rtl="true"]` |

---

## Quick Checklist

- [ ] Replace `new EditorJS` with `new Blok`
- [ ] Update imports from `@editorjs/*` to `@bloklabs/core`
- [ ] Change holder from `editorjs` to `blok` (or specify explicitly)
- [ ] Use bundled tools: `Blok.Header`, `Blok.Paragraph`
- [ ] Replace `@editorjs/delimiter` with built-in `Blok.Divider`
- [ ] Update `EditorConfig` type to `BlokConfig`
- [ ] Replace `data-id` with `data-blok-id` in queries
- [ ] Replace `data-item-name` with `data-blok-item-name`
- [ ] Replace `.ce-*` selectors with `[data-blok-*]` attributes
- [ ] Replace `.cdx-*` selectors with `[data-blok-*]` attributes
- [ ] Update E2E test selectors

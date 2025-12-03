# Migrating from EditorJS to Blok

This guide covers the breaking changes when migrating from EditorJS to Blok.

## Table of Contents

- [Core Changes](#core-changes)
- [Data Attributes](#data-attributes)
- [CSS Classes](#css-classes)
- [Bundled Tools](#bundled-tools)
  - [Tool Configuration](#tool-configuration)
  - [Lifecycle Hooks](#lifecycle-hooks)
- [Configuration Defaults](#configuration-defaults)
- [New API Methods](#new-api-methods)
- [DOM Selectors](#dom-selectors)
- [E2E Test Selectors](#e2e-test-selectors)

---

## Core Changes

### Class Name

```diff
- import EditorJS from '@editorjs/editorjs';
+ import Blok from '@jackuait/blok';

- const editor = new EditorJS({ ... });
+ const editor = new Blok({ ... });
```

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
+ import type { BlokConfig, OutputData } from '@jackuait/blok';
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
| — | `data-blok-narrow` (narrow mode) |
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
| `.codex-editor--narrow` | `[data-blok-narrow="true"]` |
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

+ import Blok from '@jackuait/blok';

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
import type { HeaderConfig } from '@jackuait/blok';

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
import type { ParagraphConfig } from '@jackuait/blok';

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
| Narrow mode | `[data-blok-narrow="true"]` |
| RTL mode | `[data-blok-rtl="true"]` |

---

## Quick Checklist

- [ ] Replace `new EditorJS` with `new Blok`
- [ ] Update imports from `@editorjs/*` to `@jackuait/blok`
- [ ] Change holder from `editorjs` to `blok` (or specify explicitly)
- [ ] Use bundled tools: `Blok.Header`, `Blok.Paragraph`
- [ ] Update `EditorConfig` type to `BlokConfig`
- [ ] Replace `data-id` with `data-blok-id` in queries
- [ ] Replace `data-item-name` with `data-blok-item-name`
- [ ] Replace `.ce-*` selectors with `[data-blok-*]` attributes
- [ ] Replace `.cdx-*` selectors with `[data-blok-*]` attributes
- [ ] Update E2E test selectors

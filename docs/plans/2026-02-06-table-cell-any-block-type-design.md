# Table Cells: Any Block Type

## Summary

Open table cells to accept any block type, not just paragraphs. The cell content model (`{ blocks: string[] }`) is already type-agnostic — cells store block IDs, not block types. The work is about removing restrictions that currently limit cells to paragraphs, and verifying the three entry points work correctly.

## Decisions

- **Any block type except table**: Cells accept headers, images, code blocks, lists, embeds — whatever tools the consumer registers. Nested tables are explicitly blocked.
- **No toolbar in cells**: Block toolbar (`+` and `☰`) stays hidden. Blocks enter cells through keyboard-driven or paste-driven flows only.
- **No drag between cells**: Blocks stay in the cell where they were created. Drag handle stays hidden.
- **Cell data model unchanged**: `{ blocks: string[] }` — the cell doesn't know or care about block types.

## Entry Points

Three equally important ways blocks enter cells:

### 1. Slash menu

User types `/` in an empty paragraph inside a cell. Toolbox popover appears. User picks a tool. BlockManager creates the new block, fires `block-added`, cell claims it.

**Restriction**: Table tool is filtered from the toolbox when the caret is inside a table cell (prevents nested tables).

### 2. Paste

Three paste paths, all creating blocks through BlockManager:

- **File paste** (e.g., image) — `FilesHandler` routes file to matching tool, tool creates block
- **HTML paste** (e.g., header copied from another editor) — `HtmlHandler` creates blocks from parsed HTML
- **Pattern paste** (e.g., URL matching an embed tool's pattern) — `PatternHandler` creates block

All three go through `block-added` → cell claiming. The table's sanitizer config must not strip HTML that non-paragraph tools need.

### 3. Block conversion / markdown shortcuts

User types a trigger in an empty paragraph:
- `# ` → header
- `- ` or `* ` → list
- `` ``` `` → code block
- etc.

This is a block replace: old block removed, new block added. The cell's `block-removed` and `block-added` handlers must handle this atomically — the cell must not insert a spurious empty paragraph between the remove and the add.

## What Already Works

The always-blocks architecture is type-agnostic by design:

- **Block claiming** — `block-added` listener in `table-cell-blocks.ts` claims blocks based on DOM adjacency, not block type
- **Block mounting** — Moves block holders into `[data-blok-table-cell-blocks]`, works for any block's holder
- **Save/restore** — Cell data is `{ blocks: string[] }`, block type lives on the block itself
- **Empty cell guarantee** — Inserts paragraph when last block is removed, independent of what type was removed

## What Needs Work

### 1. Verify slash menu insertion is claimed by cells

When a toolbox selection creates a new block, confirm the `block-added` event fires and the cell's claiming logic mounts the block into the correct cell container.

### 2. Verify block conversion doesn't trigger spurious paragraphs

Block conversion removes the old block and adds a new one. The cell's `block-removed` handler checks if the cell is empty and inserts a paragraph. With the deferred check (`queueMicrotask`), the `block-added` should fire first — but this needs verification for all conversion paths.

### 3. Broaden sanitizer config

The table tool's `sanitizerConfig` currently allows only paragraph-level tags. For paste to work with non-paragraph tools, the sanitizer must either:
- **Broaden** to include tags needed by common tools (`h1`-`h6`, `pre`, `code`, `img`, `ul`, `ol`, `li`, etc.)
- **Delegate** to the target tool's own sanitizer config

Delegating is the cleaner approach — let each tool declare what it needs, and the table tool passes through whatever the block tool allows.

### 4. Filter table tool from toolbox inside cells

When the caret is inside a table cell, the table tool must not appear in the slash menu or toolbox. This prevents nested tables.

### 5. CSS constraints on cell content

Non-paragraph blocks may have natural dimensions that exceed the column width:
- `max-width: 100%` on images and embeds
- `overflow: hidden` or `overflow-x: auto` on code blocks
- Standard table row height stretching for tall content (no special handling needed)

## Layout Behavior

- **Wide content** (images, embeds, code) — constrained to column width via CSS
- **Tall content** (many blocks, large images) — row height stretches, other cells in the row get the same height (standard table behavior)
- **Mixed content** — paragraph + image + paragraph in one cell works the same as multiple paragraphs

## Unchanged

- Cell data model (`{ blocks: string[] }`)
- Block claiming logic
- Block mounting into cell DOM
- Save/restore flow
- Tab/Shift+Tab cell navigation
- Empty cell guarantee
- Inline toolbar (bold/italic/link)
- `table-controls.ts`, `table-resize.ts`

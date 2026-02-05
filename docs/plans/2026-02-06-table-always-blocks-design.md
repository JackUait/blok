# Table Cells: Always Blocks

## Summary

Unify table cell content into a single model: every cell always contains blocks. No more dual mode (plain text vs block-based). Cells behave like Notion — you can type text, add lists, have multiple blocks, all seamlessly.

## Decisions

- **Always blocks**: Every cell stores `{ blocks: string[] }`, never a raw string
- **Block references**: Cell blocks are real editor blocks managed by BlockManager, with DOM mounted into cells
- **Enter = new block in cell**: Notion behavior, not spreadsheet behavior
- **Tab = navigate between cells**: Primary cell-to-cell navigation
- **Empty cell guarantee**: Always at least one empty paragraph block per cell
- **Migrate on load**: Legacy string cells converted to paragraph blocks automatically

## Data Format

```typescript
// Before (dual mode)
type CellContent = string | { blocks: string[] };

// After (single mode)
type CellContent = { blocks: string[] };
```

Example table data:
```json
{
  "type": "table",
  "data": {
    "content": [
      [{ "blocks": ["p1"] }, { "blocks": ["p2"] }],
      [{ "blocks": ["p3"] }, { "blocks": ["p4"] }]
    ]
  }
}
```

A cell with a list and text:
```json
{ "blocks": ["list1", "p5"] }
```

## Cell Rendering

Every cell renders the same way:
1. Cell `<div data-blok-table-cell>` — never contenteditable itself
2. Inside: `<div data-blok-table-cell-blocks>` container
3. Inside: one or more block holders (paragraph, list, etc.)

```html
<div data-blok-table-cell>
  <div data-blok-table-cell-blocks>
    <div class="blok-block">
      <div contenteditable="true">Hello world</div>
    </div>
  </div>
</div>
```

### Initialization

- **New table**: Each cell gets one empty paragraph block via `api.blocks.insert()`
- **Load existing data**: `{ blocks: ["id1"] }` — render and mount each block
- **Legacy migration**: `"Hello world"` — create a paragraph block, replace string with `{ blocks: ["newId"] }`

## Keyboard Behavior

### Inside a cell (normal block editing)
- All standard block behavior works (typing, selection, inline formatting)
- Enter in paragraph → new paragraph block in the same cell
- Enter in list item → new list item (normal list behavior)
- Backspace at start of empty paragraph → deletes it (unless last block in cell)
- `- ` in empty paragraph → converts to list (normal editor markdown shortcut)

### Cell-to-cell navigation
- **Tab** → first block of next cell (left to right, wrapping rows)
- **Shift+Tab** → last block of previous cell (wrapping rows)
- **Arrow up at top of first block** → cell above
- **Arrow down at bottom of last block** → cell below

### Empty cell guarantee
- Last block in a cell cannot be deleted via Backspace
- If last block is removed by other means, insert empty paragraph immediately

## User Experience

A cell with just text looks and feels identical to today's plain-text cells. No visible difference.

A cell with mixed content:
```
┌──────────────────┐
│ Shopping list     │  ← paragraph
│ • Milk            │  ← list
│ • Eggs            │
│ Due by Friday     │  ← paragraph
└──────────────────┘
```

No toolbar (+/☰) for blocks inside cells. Inline toolbar (bold/italic/link) works normally.

## Hard Problems & Solutions

### Block DOM mounting
BlockManager's flat list doesn't know about cells. When `api.blocks.insert()` or `api.blocks.convert()` is called, the new block's DOM lands in the main editor. The table must intercept block lifecycle events and re-mount blocks into the correct cell container.

This is the single pattern that solves:
- New block creation (Enter → new paragraph)
- Block conversion (typing `- ` → paragraph becomes list)
- Block insertion via API

### Block conversion escaping cells
The reverted commit (d372db6e) showed this problem. When a paragraph converts to a list, `api.blocks.convert()` creates the new block in the main editor. The table listens for this and re-mounts the new block into the cell.

### Save flow
Cell blocks are real blocks — Saver extracts their data into the top-level blocks array. The table's `save()` stores `{ blocks: ["id1", "id2"] }` references. On load, Renderer creates the blocks, table mounts them.

## Code Changes

### Significant changes
- **`table-cell-blocks.ts`** — Becomes the core. Remove: markdown detection, `convertCellToBlocks()`, `revertCellToPlainText()`, MutationObserver. Add: cell initialization, migration, empty cell guarantee, unified keyboard handling.
- **`table-core.ts`** — No more string vs blocks branching. Every cell delegates to `TableCellBlocks`.
- **`table-keyboard.ts`** — Merges into `TableCellBlocks` or becomes block-aware only.
- **`types.ts`** — `CellContent` becomes `{ blocks: string[] }` only. Legacy input type for migration.
- **`index.ts`** — Remove dual-mode input handling. Cleanup methods stay.

### Deleted code
- `detectMarkdownListTrigger()` and `MARKDOWN_PATTERNS`
- Grid `input` event listener for markdown triggers
- `revertCellToPlainText()` and its MutationObserver
- `contenteditable` manipulation on cells
- String branch in `getData()`

### Unchanged
- `table-controls.ts`, `table-resize.ts` — don't deal with cell content
- List tool, paragraph tool — just blocks that happen to live in cells

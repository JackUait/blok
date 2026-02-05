# Table Cell Lists Design

One-level deep lists inside table cells using block-based architecture.

## Data Model

```typescript
interface TableData {
  withHeadings: boolean;
  content: CellContent[][];
  colWidths?: number[];
}

type CellContent =
  | string                    // Plain text/HTML (backwards compatible)
  | { blocks: string[] };     // Array of block IDs
```

Example saved output:
```json
{
  "id": "table-1",
  "type": "table",
  "data": {
    "content": [
      ["Header 1", { "blocks": ["li-1", "li-2"] }],
      ["Row 1", "Plain text"]
    ]
  },
  "content": ["li-1", "li-2"]
}
```

## DOM Structure

Plain text cell (unchanged):
```html
<div data-blok-table-cell contenteditable="true">
  Plain text or <b>formatted</b> content
</div>
```

Block-based cell:
```html
<div data-blok-table-cell>
  <div data-blok-table-cell-blocks>
    <div data-blok-block="li-1" data-blok-tool="listItem">
      <div contenteditable="true">First item</div>
    </div>
    <div data-blok-block="li-2" data-blok-tool="listItem">
      <div contenteditable="true">Second item</div>
    </div>
  </div>
</div>
```

## List Creation

Markdown shortcuts only (no toolbox):

| Input | Result |
|-------|--------|
| `- ` + space | Unordered list item |
| `1. ` + space | Ordered list item |
| `[] ` + space | Checklist item |

All three styles supported: unordered, ordered, checklist.

## Keyboard Behavior

| Key | Context | Action |
|-----|---------|--------|
| Enter | In list item with content | Create new list item below |
| Enter | In empty list item | Delete empty item, move to cell below |
| Shift+Enter | Anywhere in list | Exit list, move to cell below |
| Tab | Anywhere in list | Move to next cell (right) |
| Shift+Tab | Anywhere in list | Move to previous cell (left) |
| Backspace | Empty list item | Delete item, focus previous item |
| Backspace | First item, empty | Convert back to plain text cell |

Edge cases:
- Last row + exit list: stay in cell, cursor positioned after list
- Single item + Backspace when empty: revert to plain text cell
- Arrow keys: navigate within/between list items normally
- No nesting: Tab always navigates cells, never indents

## Implementation

### New File

`src/tools/table/table-cell-blocks.ts`

Responsibilities:
1. Markdown detection: listen for `- `, `1. `, `[] ` and trigger conversion
2. Block lifecycle: create/delete list items, update cell's `blocks` array
3. Focus management: route focus between cells and nested blocks
4. Exit handling: detect double-Enter or Shift+Enter, trigger cell navigation

### Integration Points

| Module | Change |
|--------|--------|
| `table-core.ts` | Render block-based cells, save block references |
| `table-keyboard.ts` | Delegate to cell-blocks when focus is in nested block |
| `ListItem` tool | No changes (reused as-is) |
| `BlockManager` | No changes (uses existing `composeBlock()` API) |

### Focus Tracking

Table maintains `activeCellWithBlocks: { row, col } | null` to know which cell owns the currently focused nested block.

## Backwards Compatibility

- Existing tables with `string[][]` work unchanged
- Type check `typeof cell === 'string'` distinguishes formats
- No migration needed: cells convert on-demand when user creates a list

## Row/Column Operations

- Delete row/column: also delete associated list item blocks
- Duplicate row: clone list item blocks with new IDs
- Drag reorder: block references move with cell data

## Copy/Paste

- Copy cell with list: copies as HTML list markup
- Paste list into plain cell: creates block-based cell with list items
- Paste across apps: falls back to plain text or HTML

## Sanitizer Update

```typescript
sanitize: {
  content: {
    br: true, b: true, i: true, a: { href: true },
    ul: true, ol: true, li: true,
    input: { type: true, checked: true }
  }
}
```

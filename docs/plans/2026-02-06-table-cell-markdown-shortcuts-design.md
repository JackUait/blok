# Table Cell Markdown Shortcuts Design

Convert markdown shortcuts (`- `, `* `, `1. `, `1) `, `[] `, `[x] `) into list blocks inside table cells. First-level only — no nested lists in table cells.

## Scope

- Markdown shortcuts only (no slash menu, no paste)
- All existing list shortcut patterns supported
- Tab/Shift+Tab navigates cells (not indent/outdent) when inside a table cell
- Enter on empty list item converts back to paragraph in same cell
- List items in cells always stay at depth 0

## Problem

The markdown shortcut system already fires for blocks inside table cells — `MarkdownShortcuts.handleListShortcut()` calls `BlockManager.replace()` successfully. But the newly created list block isn't re-mounted into the cell.

`TableCellBlocks.handleBlockMutation` listens for `block-added` events and has `findCellForNewBlock()` + `claimBlockForCell()` logic. However, the `block-removed` event that fires first during `replace()` triggers `ensureCellHasBlock()`, which inserts a spurious empty paragraph before the list block can be claimed.

## Design

### 1. Fix Re-mounting (Deferred Mutation Handling)

**File**: `src/tools/table/table-cell-blocks.ts`

Change `handleBlockMutation` to defer the `ensureCellHasBlock` check on `block-removed`:

- On `block-removed`, schedule `ensureCellHasBlock` via `queueMicrotask` instead of running immediately. Track which cells need checking.
- On `block-added`, if a block is claimed for a cell, cancel the pending check for that cell.
- If the microtask runs without cancellation (standalone removal, not part of a replace), `ensureCellHasBlock` executes normally.

This avoids creating a spurious paragraph during `BlockManager.replace()`, keeping undo history and Yjs collaborative state clean.

### 2. Tab Navigation Override

**File**: `src/tools/list/index.ts`

In `ListItem.handleKeyDown`, before handling Tab:

```typescript
if (event.key === 'Tab') {
  if (this._element?.closest('[data-blok-table-cell-blocks]')) {
    return; // Let table handle Tab navigation
  }
  // ... existing indent/outdent logic
}
```

When a list item is inside a table cell (`[data-blok-table-cell-blocks]`), skip Tab handling entirely. The event bubbles up to the table grid's keydown listener, which calls `TableCellBlocks.handleKeyDown` for cell navigation.

This also enforces "first level only" — since Tab never triggers indent in table cells, list items stay at depth 0.

### 3. No Changes Needed

- `MarkdownShortcuts` — already works for blocks in table cells (paragraph blocks are `isDefault`)
- `TableCellBlocks.handleKeyDown` — already handles Tab/Shift+Tab navigation
- Enter on empty list item — existing list behavior converts to paragraph; `handleBlockMutation` re-mounts it into the cell via the same deferred mechanism

## Testing

### E2E (table-cell-lists.spec.ts)

1. Enable 3 existing `test.fixme()` tests (unordered, ordered, text preservation)
2. Checklist shortcut (`[] `, `[x] `) converts to checklist in cell
3. Tab in list item navigates to next cell
4. Shift+Tab in list item navigates to previous cell
5. Enter on empty list item converts back to paragraph in cell
6. List items in cells have no indentation (depth 0)
7. Save/restore roundtrip preserves list items in cells

### Unit (table-cell-blocks)

1. Deferred mutation: `block-removed` + `block-added` doesn't create spurious paragraph
2. Solo `block-removed`: standalone removal still creates placeholder after microtask

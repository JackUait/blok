# Table Row & Column Controls Design

Date: 2026-02-04

## Goal

Add interactive grip handles to each row and column of the table tool. Each grip:
- **Click** → opens a popover menu with actions (insert, delete, move, heading toggle)
- **Drag** → reorders the row/column via pointer-based drag

## Current State

The table tool (`src/tools/table/`) has:
- `table-add-controls.ts` — hover-to-reveal `+` buttons for appending rows/columns
- `table-resize.ts` — pointer-based column resize handles
- `table-core.ts` — grid DOM management (createGrid, addRow, addColumn, deleteRow, deleteColumn)
- `table-keyboard.ts` — Tab/Enter navigation
- `index.ts` — main Table class orchestrating everything

There are **no** existing row/column grip handles. The screenshots in this task show the desired design.

## Design

### New File: `table-row-col-controls.ts`

New class `TableRowColControls` manages grip buttons and their popover menus.

#### Grip Appearance

**Column grips** — positioned along the top edge of the grid:
- One per column, centered horizontally on each column
- Default state: small capsule (~20px wide × 6px tall), `rounded-full`, `bg-gray-300`, `opacity: 0`
- Hover state: expands to ~28px square button showing 6-dot `IconMenu` SVG, `rounded-lg`, `bg-white`, `border border-gray-200`, `shadow-sm`
- Position: `absolute`, `top: -16px` (above grid top border)

**Row grips** — positioned along the left edge of the grid:
- One per row, centered vertically on each row
- Default state: small capsule (~6px wide × 20px tall), `rounded-full`, `bg-gray-300`, `opacity: 0`
- Hover state: expands to ~28px square button showing 6-dot `IconMenu` SVG (rotated 90° for horizontal orientation)
- Position: `absolute`, `left: -32px` (left of grid left border)

#### Hover Detection

Grips appear when the cursor enters within ~20px of the relevant edge:
- **Column grips**: cursor within 20px of the grid's top border → show the grip for the hovered column
- **Row grips**: cursor within 20px of the grid's left border → show the grip for the hovered row
- Hide with 150ms delay (matching existing `table-add-controls.ts` pattern)
- Only one column grip and one row grip visible at a time

Column detection: calculate which column the cursor is over based on cumulative cell widths from left.
Row detection: calculate which row the cursor is over based on row element positions.

#### Click → Popover Menu

Uses the existing `PopoverDesktop` component from `src/components/utils/popover/`.

**Click detection**: Reuse the `ClickDragHandler` pattern from `src/components/modules/toolbar/click-handler.ts` with 10px threshold — if pointer moves less than 10px between down/up, it's a click.

**Column Menu** (appears below the column grip):
1. Insert Column Left — `grid.addColumn(gridEl, colIndex, colWidths)`
2. Insert Column Right — `grid.addColumn(gridEl, colIndex + 1, colWidths)`
3. *Separator*
4. Move Column Left — `grid.moveColumn(colIndex, colIndex - 1)` (disabled if first)
5. Move Column Right — `grid.moveColumn(colIndex, colIndex + 1)` (disabled if last)
6. *Separator*
7. Delete Column — confirmation mode ("Click again"), `grid.deleteColumn(gridEl, colIndex)`

**Row Menu** (appears to the right of the row grip):
1. Insert Row Above — `grid.addRow(gridEl, rowIndex)`
2. Insert Row Below — `grid.addRow(gridEl, rowIndex + 1)`
3. *Separator*
4. Move Row Up — `grid.moveRow(gridEl, rowIndex, rowIndex - 1)` (disabled if first)
5. Move Row Down — `grid.moveRow(gridEl, rowIndex, rowIndex + 1)` (disabled if last)
6. *Separator*
7. Set as Heading — toggle `withHeadings` (only shown for row index 0)
8. *Separator* (only if heading item shown)
9. Delete Row — confirmation mode, `grid.deleteRow(gridEl, rowIndex)`

Each menu item uses a small inline SVG icon (arrows for insert/move, trash for delete, heading icon for headings).

#### Drag → Reorder

When pointer moves >10px from mousedown position on a grip, drag begins.

**Column drag**:
- Source column cells get `bg-blue-50` overlay
- A 2px vertical blue line (`bg-blue-500`) appears as drop indicator between columns
- Drop position calculated from cursor X relative to cumulative column widths
- On drop: `grid.moveColumn(fromIndex, toIndex)` + update `colWidths` array
- Pointer capture via `setPointerCapture` (same as table-resize)

**Row drag**:
- Source row gets `bg-blue-50` overlay
- A 2px horizontal blue line appears as drop indicator between rows
- Drop position calculated from cursor Y relative to row element positions
- On drop: `grid.moveRow(fromIndex, toIndex)`

**After any drag/menu action**: call `refresh()` to update grip positions, then notify parent to reinit resize handles and sync add-controls.

### Changes to Existing Files

#### `table-core.ts` (TableGrid) — New Methods

```typescript
/**
 * Move a row from one index to another
 */
public moveRow(table: HTMLElement, fromIndex: number, toIndex: number): void

/**
 * Move a column from one index to another (reorder cells across all rows)
 */
public moveColumn(table: HTMLElement, fromIndex: number, toIndex: number): void
```

`moveRow`: Remove the row element at `fromIndex`, insert before the element at `toIndex`.
`moveColumn`: For each row, remove the cell at `fromIndex` and insert before cell at `toIndex`.

#### `index.ts` (Table) — Wire Up

- Import `TableRowColControls`
- Add `private rowColControls: TableRowColControls | null = null`
- In `rendered()`: instantiate `TableRowColControls` with:
  - `wrapper`, `grid` elements
  - Callbacks for all menu actions (insert/delete/move row/column, toggle heading)
  - `onChange` callback to trigger data update and reinit resize + add-controls
- In `destroy()`: call `rowColControls?.destroy()`
- In `onPaste()`: reinit `rowColControls` after re-render

#### `src/components/icons/index.ts` — New Icons

Add small SVG icons for menu items:
- `IconInsertAbove` / `IconInsertBelow` / `IconInsertLeft` / `IconInsertRight`
- `IconMoveUp` / `IconMoveDown` / `IconMoveLeft` / `IconMoveRight`
- `IconTrash` (for delete)

### Data Flow

After any structural change (insert/delete/move):
1. Grid DOM is updated via `TableGrid` methods
2. `colWidths` array is updated (for column operations)
3. Resize handles are re-initialized (`initResize`)
4. Add controls width is synced (`addControls.syncRowButtonWidth`)
5. Row/col controls refresh grip positions (`rowColControls.refresh`)
6. Heading styles are re-applied if needed

### Not In Scope

- Heading columns (only heading rows, via existing `withHeadings` flag)
- Multi-row/column selection
- Undo/redo integration for row/column operations (future work)
- Mobile/touch support for grips (edit mode is desktop-focused)

## Files Changed

| File | Change |
|------|--------|
| `src/tools/table/table-row-col-controls.ts` | **NEW** — grip handles, popover menus, drag reorder |
| `src/tools/table/table-core.ts` | Add `moveRow()`, `moveColumn()` methods |
| `src/tools/table/index.ts` | Wire up `TableRowColControls`, add callbacks |
| `src/components/icons/index.ts` | Add insert/move/trash SVG icons |
| `test/unit/tools/table/table-row-col-controls.test.ts` | **NEW** — unit tests |
| `test/unit/tools/table/table-core.test.ts` | Tests for moveRow, moveColumn |

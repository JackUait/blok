# Table Row & Column Controls — Implementation Plan

Date: 2026-02-04
Design: `docs/plans/2026-02-04-table-row-col-controls-design.md`

## Steps

### Step 1: Add new icons to `src/components/icons/index.ts`

Add inline SVG icon constants needed by the popover menu items:
- `IconInsertAbove`, `IconInsertBelow`, `IconInsertLeft`, `IconInsertRight` (arrows with line)
- `IconMoveUp`, `IconMoveDown`, `IconMoveLeft`, `IconMoveRight` (arrows)
- `IconTrash` (trash can)

Keep icons consistent with existing style (20×20 viewBox, `stroke="currentColor"`, 1.25 stroke-width).

### Step 2: Add `moveRow` and `moveColumn` to `TableGrid`

In `src/tools/table/table-core.ts`:

**`moveRow(table, fromIndex, toIndex)`**:
- Get all `[data-blok-table-row]` elements
- Remove the row at `fromIndex`
- Insert before the row at `toIndex` (or append if toIndex >= length)
- Handle heading attribute if first row changes

**`moveColumn(table, fromIndex, toIndex)`**:
- For each row, get cells, remove cell at `fromIndex`, insert before cell at `toIndex`
- No width changes needed — cells carry their own widths

**Tests**: Write unit tests in `test/unit/tools/table/table-core.test.ts` (create if needed):
- moveRow: verify DOM order changes correctly
- moveRow: boundary cases (first to last, last to first)
- moveColumn: verify cells reorder across all rows
- moveColumn: boundary cases

### Step 3: Create `TableRowColControls` — grip rendering and hover

In `src/tools/table/table-row-col-controls.ts`:

**Constructor** takes:
```typescript
interface TableRowColControlsOptions {
  wrapper: HTMLElement;
  grid: HTMLElement;
  getColumnCount: () => number;
  getRowCount: () => number;
  onAction: (action: RowColAction) => void;
}
```

**Create grip elements**:
- `createColumnGrips(count)` — creates one absolutely-positioned grip per column
- `createRowGrips(count)` — creates one absolutely-positioned grip per row
- Each grip: small capsule by default, expands on hover to show `IconMenu`

**Hover detection**:
- Listen to `mousemove` on the grid element
- Check if cursor is within 20px of top edge → show column grip for hovered column
- Check if cursor is within 20px of left edge → show row grip for hovered row
- `mouseleave` on grid → hide grips with 150ms delay

**Position calculation**:
- Column grip X: sum of cell widths up to column center
- Row grip Y: row element offsetTop + row height / 2

**Tests**: Unit tests for grip creation and positioning.

### Step 4: Add popover menus to grips (click handling)

In `table-row-col-controls.ts`:

**Click detection**: On `pointerdown` on a grip, track start position. On `pointerup`, if movement < 10px, it's a click → open popover.

**`buildColumnMenu(colIndex)`** → returns `PopoverItemParams[]`:
- Insert Left, Insert Right, separator, Move Left (disabled if 0), Move Right (disabled if last), separator, Delete (confirmation)

**`buildRowMenu(rowIndex)`** → returns `PopoverItemParams[]`:
- Insert Above, Insert Below, separator, Move Up (disabled if 0), Move Down (disabled if last), separator, Set as Heading (only if row 0), separator (if row 0), Delete (confirmation)

**Popover lifecycle**:
- Create `PopoverDesktop` on click, position relative to the grip element
- On item activate → call `onAction` callback with action type and index
- On popover close → destroy popover instance

**Tests**: Unit tests for menu construction and action callbacks.

### Step 5: Wire up actions in `Table` class

In `src/tools/table/index.ts`:

**In `rendered()`**: create `TableRowColControls` with callbacks:
- `onAction` handler that dispatches to:
  - `insertRowAbove(index)`, `insertRowBelow(index)`
  - `insertColumnLeft(index)`, `insertColumnRight(index)`
  - `moveRow(from, to)`, `moveColumn(from, to)`
  - `deleteRow(index)`, `deleteColumn(index)`
  - `toggleHeading()`

**Each action handler**:
1. Calls the appropriate `TableGrid` method
2. Updates `this.data.colWidths` if needed (column insert/delete/move)
3. Re-inits resize handles (`this.initResize(gridEl)`)
4. Syncs add-controls width (`this.addControls?.syncRowButtonWidth()`)
5. Refreshes grip positions (`this.rowColControls?.refresh()`)

**In `destroy()`**: add `this.rowColControls?.destroy()`
**In `onPaste()`**: reinit `rowColControls` after re-render

**Tests**: Integration tests verifying action flow.

### Step 6: Add drag-to-reorder

In `table-row-col-controls.ts`:

**Drag initiation**: If pointer moves >10px from mousedown on a grip, start drag mode.

**During drag**:
- Add `bg-blue-50` class to source row/column cells
- Create a drop indicator element (2px blue line)
- On `pointermove`: calculate drop position, move indicator
- Use `setPointerCapture` for reliable tracking

**On drop**:
- Call `onAction` with move action (fromIndex, toIndex)
- Remove overlay and indicator
- Release pointer capture

**Column drop position**: Calculate from cursor X vs cumulative column widths
**Row drop position**: Calculate from cursor Y vs row element top positions

**Tests**: Unit tests for drag threshold, drop position calculation.

### Step 7: E2E tests

In `test/e2e/table-row-col-controls.spec.ts`:

- Hover near top edge → column grip appears
- Hover near left edge → row grip appears
- Click column grip → menu opens with correct items
- Click row grip → menu opens with correct items
- Insert row above/below → row count increases
- Insert column left/right → column count increases
- Delete row → row count decreases
- Delete column → column count decreases
- Move row up/down → content reorders
- Move column left/right → content reorders
- Drag row to new position → content reorders
- Drag column to new position → content reorders

### Step 8: Refactor and final verification

- Run `/refactor`
- Run `/final-verification`
- Push

## Dependencies

Steps 1-2 are independent and can be done in parallel.
Step 3 depends on Step 1 (icons).
Step 4 depends on Step 3.
Step 5 depends on Steps 2 and 4.
Step 6 depends on Step 5.
Step 7 depends on Step 6.
Step 8 depends on Step 7.

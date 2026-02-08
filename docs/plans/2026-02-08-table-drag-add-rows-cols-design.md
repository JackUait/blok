# Table Drag-to-Add Multiple Rows/Columns Design

## Problem

Currently, the table's `+` buttons only add a single row or column per click. For larger tables, users need to click repeatedly. A drag gesture would let users add multiple rows/columns in a single interaction.

## Interaction Model

**Trigger:** User presses and holds (pointerdown) on either `+` button, then drags.

**Add Row (bottom button):**
- Drag downward from the `+` button
- Reference unit = height of the last row at drag start
- Each full unit of downward drag live-inserts one row at the bottom
- Dragging back up removes the most recently added rows
- Dragging back to or past the starting Y = cancel (all added rows removed)

**Add Column (right button):**
- Drag rightward from the `+` button
- Reference unit = width of the last column at drag start
- Each full unit of rightward drag live-inserts one column at the right
- Dragging back left removes the most recently added columns
- Dragging back to or past the starting X = cancel

**Release (pointerup):**
- If rows/columns were added, do final refresh (resize handles, grips, button sync)
- If addedCount is 0 (cancelled or no movement), nothing changes

**Click (< 5px movement):**
- Existing behavior preserved: a click still adds exactly 1 row/column

## Implementation

### Changes to `TableAddControls`

New drag state tracked during interaction:
- `dragAxis: 'row' | 'col'` - which button is being dragged
- `dragStartPos: number` - starting clientY (row) or clientX (col)
- `unitSize: number` - row height or column width measured at drag start
- `addedCount: number` - how many rows/columns currently added

Replace click handlers with pointer event handlers (pointerdown/pointermove/pointerup) to distinguish click from drag.

Use `setPointerCapture()` so drag continues even if cursor leaves the button.

Keep button visible during drag (override proximity-based hide).

Set cursor to `row-resize` (row) or `col-resize` (col) during drag.

### Changes to `Table.initAddControls()`

New callbacks for lightweight intermediate operations during drag:
- `onDragAddRow` - adds row to DOM + populates blocks (no resize/grip refresh)
- `onDragRemoveRow` - removes last row + cleans up blocks
- `onDragAddCol` - adds column + populates blocks (no resize/grip refresh)
- `onDragRemoveCol` - removes last column + cleans up blocks
- `onDragEnd` - full refresh (resize handles, grips, button sync)

Existing `onAddRow`/`onAddColumn` callbacks unchanged (used for click).

### Edge Cases

- **Pointer capture:** Prevents drag from breaking if cursor leaves the button
- **Min 5px threshold:** Below that, pointerup triggers a click
- **Button visibility:** Locked visible during drag, reverts to proximity-based on end
- **No artificial max:** Users can add as many rows/columns as they drag for
- **Original rows protected:** Cannot drag-remove rows that existed before the drag started

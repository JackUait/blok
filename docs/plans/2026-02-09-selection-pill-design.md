# Selection Pill Control

## Summary

When a user selects multiple table cells, display a horizontal grip pill on the right border of the selection (vertically centered). Clicking it opens a popover menu with a single "Clear" action that empties the content of all selected cells.

## Design

### Appearance
- Identical to existing column grip pills: 24x16px element, idle at scaleY(0.25) = 4px tall
- Always shown in active (blue) state since it only appears during selection
- Horizontal 3x2 dot grid SVG (reuses `createGripDotsSvg('horizontal')`)
- Positioned centered on the right edge of the selection overlay

### Position
- `left`: `overlayRight - pillWidth/2` (centered on right border)
- `top`: `overlayCenterY - pillHeight/2` (vertically centered)
- Sibling of overlay in the grid, not a child (needs its own `pointer-events: auto`)

### Behavior
- Created/repositioned in `paintSelection()`, removed in `restoreModifiedCells()`
- Pointerdown calls `stopPropagation()` to prevent click-away clearing
- Click opens `PopoverDesktop` with single item: "Clear" (`IconCross`)
- On activate: fires `onClearContent(cells)` callback, then clears selection
- Popover close without action: selection remains

### Integration
- `onClearContent` callback added to `CellSelectionOptions`
- Wired in `Table.initCellSelection()` using `cellBlocks.getBlockIdsFromCells()` + `cellBlocks.deleteBlocks()`

## Files Modified

1. `src/tools/table/table-cell-selection.ts` — pill element, popover, positioning
2. `src/tools/table/index.ts` — wire `onClearContent` callback

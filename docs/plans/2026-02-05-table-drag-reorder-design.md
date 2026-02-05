# Table Drag-to-Reorder Enhancement

## Goal

Remove redundant Move Left/Right/Up/Down menu items from table row/column popovers and enhance the existing drag-to-reorder UX with ghost previews and better visual feedback.

## Changes

### 1. Remove Move Menu Items

**`table-row-col-controls.ts`:**
- Remove "Move Column Left" and "Move Column Right" from `buildColumnMenu()`
- Remove "Move Row Up" and "Move Row Down" from `buildRowMenu()`
- Remove associated separators
- Remove unused imports: `IconMoveLeft`, `IconMoveRight`, `IconMoveUp`, `IconMoveDown`
- Keep `move-row`/`move-col` in `RowColAction` type (used by drag system)

### 2. Ghost Preview

**`table-row-col-drag.ts` — on `startDrag()`:**
- Clone source cells into a fixed-position container
- Row drag: ghost = horizontal layout of cloned cells, width = grid width, height = row height
- Column drag: ghost = vertical layout of cloned cells, width = column width, height = grid height
- Ghost styling: `position: fixed`, `pointer-events: none`, `opacity: 0.5`, `z-index: 50`
- Polish: `border-radius: 4px`, `overflow: hidden`, `box-shadow: 0 4px 12px rgba(0,0,0,0.15)`

**On `handleDocPointerMove()`:**
- Update ghost position centered on cursor (with offset from grab point)

**On cleanup:**
- Remove ghost from DOM

### 3. Visual Feedback Enhancements

**Source cell highlight:**
- Background: `#dbeafe` (Tailwind blue-100, stronger than current `#eff6ff`)
- Opacity: `0.6` on source cells

**Drop indicator:**
- Width: 3px (up from 2px), `border-radius: 1.5px`
- Small 8px circles at each end of the indicator line
- Position transition: `transition: top 100ms ease` / `transition: left 100ms ease`

**Cursor:**
- `document.body.style.cursor = 'grabbing'` during drag
- Restored on cleanup

### 4. Post-drop confirmation (optional)
- Brief flash on destination cells: `#dbeafe` fading to transparent over 300ms

## Files

| File | Change |
|------|--------|
| `src/tools/table/table-row-col-controls.ts` | Remove move items, unused imports |
| `src/tools/table/table-row-col-drag.ts` | Ghost preview, enhanced highlights, cursor |
| `test/playwright/tests/tools/table.spec.ts` | Update tests for new behavior |

# Page-Wide Rubber Band Selection

## Overview

Enable rubber band (marquee) selection to start from anywhere on the page, not just within the editor bounds. This solves the problem where narrow/centered editors leave no space to initiate drag selection.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event scope | Document-level pointer events | Allows drag to start outside editor bounds |
| Editor ownership | Vertical alignment | If pointer Y is within editor's top-to-bottom range, that editor owns the selection |
| Multi-editor support | Not supported | Single editor assumption simplifies implementation |
| Empty selection | Clears existing selection | Matches standard OS behavior (Finder, Figma) |
| Pointer types | Mouse + trackpad only | Touch conflicts with scrolling; rubber band feels awkward on touch |
| Modifier keys | Shift for additive selection | Standard pattern; no modifier required for basic selection |
| Visual style | Editor's accent color with transparency | Consistent with existing selection highlighting |
| Auto-scroll | Near viewport edges | ~40px trigger zones, progressive speed |

## Architecture

**No new module.** Modify the existing `RectangleSelection` module in `src/components/modules/rectangleSelection.ts`.

### Current Limitation

The module currently requires drag to start inside the editor ([lines 147-155](../src/components/modules/rectangleSelection.ts#L147-L155)):

```typescript
const startsInsideBlok = elemWhereSelectionStart.closest(createSelector(DATA_ATTR.editor));
if (!startsInsideBlok || startsInSelectorToAvoid) {
  return;
}
```

### Changes Required

#### 1. Move `mousedown` listener to document level

**File:** `src/components/modules/rectangleSelection.ts`
**Method:** `enableModuleBindings()` (lines 196-229)

Currently attaches to editor container. Move to `document.body` like `mousemove` and `mouseup`.

#### 2. Update ownership check in `startSelection()`

**File:** `src/components/modules/rectangleSelection.ts`
**Method:** `startSelection()` (lines 120-165)

Replace the `startsInsideBlok` check with vertical alignment:

```typescript
const editorRect = this.Blok.UI.nodes.redactor.getBoundingClientRect();
const pointerY = pageY - this.getScrollTop();
const withinEditorVertically = pointerY >= editorRect.top && pointerY <= editorRect.bottom;

if (!withinEditorVertically) {
  return;
}
```

Keep the `selectorsToAvoid` check to prevent selection from starting on toolbars, inline toolbar, or block content.

#### 3. Add Shift-key support for additive selection

**File:** `src/components/modules/rectangleSelection.ts`
**Methods:** `processMouseDown()`, `startSelection()`

- Pass `shiftKey` boolean from the mouse event
- If Shift is held, skip clearing `stackOfSelected` and existing selection
- Selected blocks accumulate instead of replacing

#### 4. Clear selection on empty drag

Already handled by existing logic — when `rectCrossesBlocks` is false at drag end, the `inverseSelection()` method deselects blocks in `stackOfSelected`.

### Existing Features (No Changes Needed)

- **Auto-scroll:** `scrollByZones()` already handles viewport edge detection with 40px zones
- **Rubber band visual:** `genHTML()` creates overlay with `bg-selection-highlight` class
- **Block intersection:** `genInfoForMouseSelection()` and `trySelectNextBlock()` handle detection
- **Selection state:** Uses `BlockSelection.selectBlockByIndex()` and `unSelectBlockByIndex()`
- **Toolbar integration:** Closes toolbar on drag start, reopens for multi-block selection on drag end

## Interaction Flow

```
1. User presses mouse button anywhere on page
2. processMouseDown() fires on document.body
3. startSelection() checks:
   - Is it the primary mouse button? (not right-click)
   - Is pointer type mouse/trackpad? (not touch)
   - Is pointer Y within editor's vertical bounds?
   - Did drag start on a selector to avoid? (toolbar, block content, etc.)
4. If checks pass, begin tracking:
   - Record start position
   - If Shift not held, clear existing selection
5. As mouse moves:
   - Update rubber band rectangle size/position
   - Calculate which blocks intersect
   - Update pending selection state on blocks in real-time
   - Trigger auto-scroll if near viewport edges
6. On mouse up:
   - Finalize selection via BlockSelection module
   - If no blocks selected, existing selection is cleared
   - If multiple blocks selected, open toolbar for multi-block actions
   - Clean up rubber band overlay
```

## Testing Considerations

- Drag starting in left/right page margins selects blocks at same Y position
- Drag in empty space above/below editor does nothing
- Shift+drag adds to existing selection
- Touch/stylus does not trigger rubber band
- Auto-scroll works when dragging near viewport top/bottom
- Existing in-editor selection still works as before

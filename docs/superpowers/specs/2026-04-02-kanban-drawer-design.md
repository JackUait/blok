# Kanban Card Drawer — Design Spec

**Date:** 2026-04-02
**Scope:** Replace the absolutely-positioned peek panel with a flex-sibling drawer that takes layout space.

## Problem

The current `DatabaseCardPeek` panel opens as an absolute-positioned overlay on the right side of the board. It overlaps board content, obscuring columns underneath. Users cannot see the board and card details simultaneously without one blocking the other.

## Solution

A right-side drawer (`DatabaseCardDrawer`) that sits beside the board as a flex sibling. When a card is clicked, the board area shrinks and the drawer slides in, giving both the board and card details their own dedicated space.

## Layout

### Current structure

```
wrapper (data-blok-tool="database") — display:flex, overflow-x:auto
  column
  column
  add-column-btn
  peek (position:absolute, right:0)
```

### New structure

```
wrapper (data-blok-tool="database") — display:flex
  boardArea (data-blok-database-board) — flex:1, min-width:0, display:flex, overflow-x:auto
    column
    column
    add-column-btn
  drawer (data-blok-database-drawer) — width:400px, flex-shrink:0, overflow:hidden
    close button
    title input
    hr divider
    editor holder
```

The outer wrapper is a flex row container. The board area holds columns with horizontal scroll and takes remaining space via `flex: 1; min-width: 0`. The drawer is a fixed-width flex item.

### Wrapper styles

The outer wrapper (`data-blok-tool="database"`) gets:
- `display: flex`

The board area (`data-blok-database-board`) inherits the column-layout styles that currently live on the wrapper:
- `display: flex`
- `overflow-x: auto`
- `align-items: flex-start`
- `gap: 12px`
- `padding: 6px 4px`
- `flex: 1`
- `min-width: 0`

## Drawer component

`DatabaseCardDrawer` replaces `DatabaseCardPeek` with the same public API:

```typescript
interface CardDrawerOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  onTitleChange: (cardId: string, title: string) => void;
  onDescriptionChange: (cardId: string, description: OutputData) => void;
  onClose: () => void;
}

class DatabaseCardDrawer {
  get isOpen(): boolean;
  open(card: KanbanCardData): void;
  close(): void;
  destroy(): void;
}
```

### Drawer DOM

```html
<div data-blok-database-drawer
     role="complementary"
     aria-label="Card details"
     style="flex-shrink: 0; width: 0; overflow: hidden; ...">
  <button data-blok-database-drawer-close aria-label="Close">x</button>
  <input data-blok-database-drawer-title type="text" aria-label="Card title" />
  <hr />
  <div data-blok-database-drawer-editor></div>
</div>
```

### Animation

- Initial state: `width: 0; overflow: hidden`
- After `requestAnimationFrame`: `width: 400px`
- CSS: `transition: width 200ms ease` on `[data-blok-database-drawer]`
- The board area has `transition: flex 200ms ease` so it smoothly compresses

### Content

Same as current peek panel:
- Title input (editable, or readonly in read-only mode)
- Divider (`<hr>`)
- Nested Blok editor for card description (dynamic import)
- Close button (x character)

### Behavior

- `open(card)`: Closes any existing drawer, creates DOM, appends to wrapper, animates in, focuses title input, initializes nested editor
- `close()`: Saves editor content, removes escape listener, removes DOM, calls `onClose`
- `destroy()`: Calls `close()`
- Escape key closes drawer (unless focus is inside the nested editor)

## Files changed

| Action | File | Changes |
|--------|------|---------|
| New | `src/tools/database/database-card-drawer.ts` | Drawer component |
| New | `test/unit/tools/database/database-card-drawer.test.ts` | Drawer tests |
| Modify | `src/tools/database/database-view.ts` | Add board area wrapper in `createBoard()`; update `appendColumn()` to find board area |
| Modify | `test/unit/tools/database/database-view.test.ts` | Update layout assertions to check board area; add board area existence test |
| Modify | `src/tools/database/index.ts` | Replace `DatabaseCardPeek` with `DatabaseCardDrawer`; update all references |
| Modify | `test/unit/tools/database/database.test.ts` | Replace peek imports/spies with drawer |
| Modify | `src/styles/main.css` | Rename `peek` selectors to `drawer`; add board area styles; add width transition |
| Delete | `src/tools/database/database-card-peek.ts` | Replaced by drawer |
| Delete | `test/unit/tools/database/database-card-peek.test.ts` | Replaced by drawer tests |

## Subsystem impact

- **Card/Column drag:** Query `wrapper.querySelectorAll('[data-blok-database-column]')`. Columns remain descendants of wrapper — no changes needed.
- **Column controls:** Operates on header elements inside columns — unaffected.
- **Keyboard:** `cardPeek.isOpen` becomes `cardDrawer.isOpen` — trivial rename.
- **`appendColumn()`:** Needs to find the board area container before inserting. Changed from `wrapper.insertBefore` to `boardArea.insertBefore`.
- **Model, backend sync:** No changes.

## CSS changes

### New selectors

```css
/* Board area — scrollable column container */
[data-blok-database-board] {
  transition: flex 200ms ease;
}

/* Drawer — width animation */
[data-blok-database-drawer] {
  transition: width 200ms ease;
}
```

### Renamed selectors

All `[data-blok-database-peek*]` selectors become `[data-blok-database-drawer*]`:
- `[data-blok-database-peek] hr` → `[data-blok-database-drawer] hr`
- `[data-blok-database-peek-title]::placeholder` → `[data-blok-database-drawer-title]::placeholder`
- `[data-blok-database-peek]` transition → `[data-blok-database-drawer]` width transition

### Removed

The `--blok-database-peek-border` CSS variable is renamed to `--blok-database-drawer-border` in all three theme blocks (light, dark, forced-dark).

## Testing approach

TDD: write tests first, watch them fail, then implement.

1. Write `database-card-drawer.test.ts` with all drawer behavior tests
2. Implement `database-card-drawer.ts` until tests pass
3. Update `database-view.test.ts` for board area structure
4. Update `database-view.ts` until tests pass
5. Update `database.test.ts` for drawer references
6. Update `index.ts` until tests pass
7. Update CSS
8. Delete old peek files
9. Run full test suite

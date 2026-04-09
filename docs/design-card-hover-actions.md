# Design: Card Hover Actions (Edit Title + More Menu)

**Date:** 2026-04-10  
**Branch:** database-kanban

---

## Overview

When a user hovers over a kanban board card, a two-button action group appears in the top-right corner of the card. The buttons allow:

1. **Pencil icon** — inline rename of the card title
2. **"..." icon** — open a context menu with a "Delete" option

This replaces the existing single hidden `×` delete button with the new action group.

---

## DOM Structure

```html
<div data-blok-database-card data-row-id="{id}" role="listitem">
  <div data-blok-database-card-title>
    {title}
  </div>
  <div data-blok-database-card-actions>
    <button data-blok-database-edit-card aria-label="Edit title">
      {pencilIcon}
    </button>
    <button data-blok-database-card-menu aria-label="More options">
      {dotsHorizontalIcon}
    </button>
  </div>
</div>
```

The `[data-blok-database-delete-card]` button is removed. The action group is the replacement.

---

## CSS

- `[data-blok-database-card-actions]`: `position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity 120ms ease; display: flex; gap: 2px; background: <dark>; border-radius: 8px; padding: 2px`
- `[data-blok-database-card]:hover [data-blok-database-card-actions]`: `opacity: 1`
- `[data-blok-database-card][data-popover-open] [data-blok-database-card-actions]`: `opacity: 1` (keep visible while popover open)
- Each button inside: icon-only, `width: 30px; height: 30px; border-radius: 6px; display: flex; align-items: center; justify-content: center`

---

## Pencil — Inline Title Edit

Implemented in `DatabaseBoardView` via event delegation in `DatabaseTool.attachViewListeners()`.

**Flow:**
1. Click on `[data-blok-database-edit-card]` → stop propagation (prevent card-open-drawer)
2. Find the sibling `[data-blok-database-card-title]` element
3. Replace its content with a full-width `<input>` pre-filled with current title, auto-focused, text selected
4. On `blur` or `Enter`: persist via existing `updateRowTitle()` → dispatch `rowUpdated`; restore `<div>`
5. On `Escape`: restore original title without saving

Pattern mirrors `database-column-controls.ts:63–138`.

---

## "..." — More Menu

Implemented in `DatabaseBoardView` / event delegation.

**Flow:**
1. Click on `[data-blok-database-card-menu]` → stop propagation
2. Instantiate `PopoverDesktop` anchored to the menu button
3. Items: `[{ type: Default, title: 'Delete', icon: trashIcon, onActivate: deleteHandler }]`
4. On open: add `data-popover-open` attribute to the card element
5. On popover close: remove `data-popover-open`

---

## Event Delegation Changes

In `src/tools/database/index.ts` `attachViewListeners()`:

- Remove existing `[data-blok-database-delete-card]` click handler
- Add `[data-blok-database-edit-card]` click handler → triggers inline edit
- Add `[data-blok-database-card-menu]` click handler → opens delete popover

The `[data-blok-database-edit-card]` handler needs access to `DatabaseBoardView` to call a new public method `startCardTitleEdit(cardEl)`. Alternatively, the logic lives entirely in the delegated handler in `index.ts`.

---

## Files Changed

| File | Change |
|---|---|
| `src/tools/database/database-board-view.ts` | Replace delete button with two-button action group in `createCardElement()` |
| `src/tools/database/index.ts` | Update `attachViewListeners()` — remove old delete handler, add edit and menu handlers |
| `src/styles/main.css` | Add hover-reveal CSS for `[data-blok-database-card-actions]` |
| `test/unit/tools/database/database-board-view.test.ts` | New unit tests for card element structure and action handlers |
| `test/playwright/tests/ui/database-card-hover-actions.spec.ts` | New E2E tests |

---

## Testing Strategy (TDD)

Tests are written first, watched to fail, then implementation follows.

### Unit Tests (parallel subagent 1)

File: `test/unit/tools/database/database-board-view.test.ts`

- `createCardElement()` renders `[data-blok-database-card-actions]` with both buttons
- `createCardElement()` does NOT render `[data-blok-database-delete-card]`
- Click `[data-blok-database-edit-card]`: title div replaced by input with current title
- Input `Enter`: calls title update callback with new value; restores div
- Input `blur`: same as Enter
- Input `Escape`: restores original title, no callback
- Click `[data-blok-database-card-menu]`: opens PopoverDesktop (mocked); card gets `data-popover-open`
- Popover close: removes `data-popover-open`

### E2E Tests (parallel subagent 2)

File: `test/playwright/tests/ui/database-card-hover-actions.spec.ts`

- Hover card → action group becomes visible
- Click pencil → input appears pre-filled with title
- Type new title + Enter → card title updated
- Click pencil → Escape → original title unchanged
- Click `...` → popover with "Delete" appears
- Click "Delete" → card removed from board

### Parallel Subagent Split

Unit tests and E2E tests have no shared state and can be authored and debugged independently:

- **Subagent A**: writes failing unit tests → implements `createCardElement()` changes + `attachViewListeners()` changes → makes unit tests pass
- **Subagent B**: writes failing E2E tests → makes E2E tests pass (depends on build output from Subagent A completing first, OR runs after implementation)

Given the E2E tests depend on the built artifact, the recommended execution order is:  
1. Run both subagents for test authoring in parallel  
2. Run Subagent A implementation first  
3. Run E2E after unit + implementation land

---

## Accessibility

- Both buttons have `aria-label`
- Keyboard: buttons are reachable via Tab; action group visible on `:focus-within` as well as hover
- No aria changes needed on the card itself

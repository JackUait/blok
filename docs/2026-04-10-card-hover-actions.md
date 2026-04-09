# Card Hover Actions (Edit Title + More Menu) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When hovering a kanban board card, show a two-button action group in the top-right: a pencil icon for inline title editing and a "..." icon for a delete menu.

**Architecture:** Replace the existing hidden `×` delete button in `DatabaseBoardView.createCardElement()` with a `[data-blok-database-card-actions]` group containing two buttons. CSS `:hover` reveals the group. Inline edit uses the input-swap pattern. The menu uses `PopoverDesktop`. Event delegation in `DatabaseTool.attachViewListeners()` handles both buttons.

**Tech Stack:** TypeScript, JSDOM (unit tests via Vitest), Playwright (E2E), `PopoverDesktop` / `PopoverItemType` / `PopoverEvent` from existing popover infrastructure.

---

## Task 1: Add `IconDotsHorizontal` to the icons module

**Files:**
- Modify: `src/components/icons/index.ts` (append after line 423)
- Modify: `index.html` (add `IconDotsHorizontal` to the icons gallery `iconGroups`)

**Step 1: Append the icon export after `IconTrash`**

Open `src/components/icons/index.ts`. After the closing backtick of `IconTrash` (line 423), add:

```typescript
// Horizontal dots / more options icon
export const IconDotsHorizontal = `
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="5" cy="10" r="1.25" fill="currentColor"/>
  <circle cx="10" cy="10" r="1.25" fill="currentColor"/>
  <circle cx="15" cy="10" r="1.25" fill="currentColor"/>
</svg>
`;
```

**Step 2: Register in the icons gallery**

In `index.html`, find the `iconGroups` object (around line 909). Add `'IconDotsHorizontal'` to the `"Actions"` group (or `"UI"` group if "Actions" doesn't exist — pick the most fitting category).

**Step 3: Verify TypeScript compiles**

```bash
yarn lint
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/components/icons/index.ts index.html
git commit -m "feat(icons): add IconDotsHorizontal"
```

---

## Task 2: Write failing unit tests for card action group structure

**Files:**
- Modify: `test/unit/tools/database/database-board-view.test.ts`

**Context:** The test file already has a `describe('createView')` block. The tests below go inside a new `describe('card action buttons', ...)` block nested inside the outer `describe('DatabaseBoardView', ...)`.

**Step 1: Add the failing tests**

Find the end of the `describe('createView', ...)` block (around line 237 in the test file — look for the closing `});` after all the `createView` tests). Add a new describe block after it:

```typescript
describe('card action buttons', () => {
  it('renders [data-blok-database-card-actions] on each card when NOT read-only', () => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1' })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();

    const actionGroups = board.querySelectorAll('[data-blok-database-card-actions]');
    expect(actionGroups).toHaveLength(1);
  });

  it('does not render [data-blok-database-card-actions] in read-only mode', () => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1' })];
    const view = new DatabaseBoardView({ readOnly: true, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();

    const actionGroups = board.querySelectorAll('[data-blok-database-card-actions]');
    expect(actionGroups).toHaveLength(0);
  });

  it('renders [data-blok-database-edit-card] button inside the action group', () => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1' })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();

    const editBtn = board.querySelector('[data-blok-database-edit-card]');
    expect(editBtn).not.toBeNull();
    expect(editBtn?.closest('[data-blok-database-card-actions]')).not.toBeNull();
  });

  it('renders [data-blok-database-card-menu] button inside the action group', () => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1' })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();

    const menuBtn = board.querySelector('[data-blok-database-card-menu]');
    expect(menuBtn).not.toBeNull();
    expect(menuBtn?.closest('[data-blok-database-card-actions]')).not.toBeNull();
  });

  it('does NOT render the old [data-blok-database-delete-card] button', () => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1' })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();

    const deleteBtn = board.querySelector('[data-blok-database-delete-card]');
    expect(deleteBtn).toBeNull();
  });

  it('sets aria-label on edit button', () => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1' })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();

    const editBtn = board.querySelector('[data-blok-database-edit-card]');
    expect(editBtn?.getAttribute('aria-label')).toBeTruthy();
  });

  it('sets aria-label on menu button', () => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1' })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();

    const menuBtn = board.querySelector('[data-blok-database-card-menu]');
    expect(menuBtn?.getAttribute('aria-label')).toBeTruthy();
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
yarn test test/unit/tools/database/database-board-view.test.ts
```

Expected: 6 new tests FAIL (action group and buttons don't exist yet). The existing tests for `[data-blok-database-delete-card]` still pass (old code still in place).

**Step 3: Commit the failing tests**

```bash
git add test/unit/tools/database/database-board-view.test.ts
git commit -m "test(database): add failing tests for card action group structure"
```

---

## Task 3: Write failing unit tests for inline title editing

**Files:**
- Modify: `test/unit/tools/database/database-board-view.test.ts`

These tests go inside a new `describe('card inline title edit', ...)` block after the previous describe.

**Step 1: Add the failing tests**

```typescript
describe('card inline title edit', () => {
  const createViewWithCard = (title = 'Fix bug'): { board: HTMLDivElement; cardEl: HTMLElement } => {
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1', properties: { title } })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
    const board = view.createView();
    const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
    return { board, cardEl };
  };

  it('replaces title div with input when edit button is clicked', () => {
    const { cardEl } = createViewWithCard('Fix bug');
    const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

    editBtn.click();

    const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('Fix bug');
  });

  it('restores title div on Enter and calls onTitleEdit with new value', () => {
    const onTitleEdit = vi.fn();
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1', properties: { title: 'Fix bug' } })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', onTitleEdit });
    const board = view.createView();
    const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
    const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

    editBtn.click();

    const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]')!;
    input.value = 'New Title';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const titleDiv = cardEl.querySelector('[data-blok-database-card-title]');
    expect(titleDiv).not.toBeNull();
    expect(cardEl.querySelector('[data-blok-database-card-title-input]')).toBeNull();
    expect(onTitleEdit).toHaveBeenCalledWith('row-1', 'New Title');
  });

  it('restores title div on blur and calls onTitleEdit with new value', () => {
    const onTitleEdit = vi.fn();
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1', properties: { title: 'Fix bug' } })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', onTitleEdit });
    const board = view.createView();
    const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
    const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

    editBtn.click();

    const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]')!;
    input.value = 'Blurred Title';
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    expect(cardEl.querySelector('[data-blok-database-card-title]')).not.toBeNull();
    expect(onTitleEdit).toHaveBeenCalledWith('row-1', 'Blurred Title');
  });

  it('restores original title on Escape without calling onTitleEdit', () => {
    const onTitleEdit = vi.fn();
    const options = [makeOption({ id: 'opt-1' })];
    const rows = [makeRow({ id: 'row-1', properties: { title: 'Fix bug' } })];
    const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', onTitleEdit });
    const board = view.createView();
    const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
    const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

    editBtn.click();

    const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]')!;
    input.value = 'Changed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    const titleDiv = cardEl.querySelector('[data-blok-database-card-title]');
    expect(titleDiv?.textContent).toBe('Fix bug');
    expect(onTitleEdit).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
yarn test test/unit/tools/database/database-board-view.test.ts -t "card inline title edit"
```

Expected: all 4 tests FAIL — `onTitleEdit` option doesn't exist yet.

**Step 3: Commit**

```bash
git add test/unit/tools/database/database-board-view.test.ts
git commit -m "test(database): add failing tests for card inline title edit"
```

---

## Task 4: Update `DatabaseBoardView` — replace delete button with action group

**Files:**
- Modify: `src/tools/database/database-board-view.ts`

**Step 1: Add `onTitleEdit` callback to the options interface**

At the top of the file, change:

```typescript
interface DatabaseBoardViewOptions {
  readOnly: boolean;
  i18n: I18n;
  options: SelectOption[];
  getRows: (optionId: string) => DatabaseRow[];
  titlePropertyId: string;
}
```

to:

```typescript
interface DatabaseBoardViewOptions {
  readOnly: boolean;
  i18n: I18n;
  options: SelectOption[];
  getRows: (optionId: string) => DatabaseRow[];
  titlePropertyId: string;
  onTitleEdit?: (rowId: string, newTitle: string) => void;
}
```

**Step 2: Store the callback in the class**

In the class body after `private readonly titlePropertyId: string;`, add:

```typescript
private readonly onTitleEdit: ((rowId: string, newTitle: string) => void) | undefined;
```

**Step 3: Assign in constructor**

In the constructor body, add:

```typescript
this.onTitleEdit = onTitleEdit;
```

(Update the destructuring: `{ readOnly, i18n, options, getRows, titlePropertyId, onTitleEdit }`)

**Step 4: Add icon imports**

At the top of the file, change:

```typescript
import { IconPlus } from '../../components/icons';
```

to:

```typescript
import { IconPlus, IconPencil, IconDotsHorizontal } from '../../components/icons';
```

**Step 5: Replace `createCardElement` implementation**

Find the `createCardElement` method (lines 263–303). Replace the entire method body with:

```typescript
private createCardElement(row: DatabaseRow, titlePropertyId: string): HTMLDivElement {
  const cardEl = document.createElement('div');
  const title = (row.properties[titlePropertyId] as string) ?? '';

  cardEl.setAttribute('data-blok-database-card', '');
  cardEl.setAttribute('data-row-id', row.id);
  cardEl.setAttribute('role', 'listitem');
  cardEl.style.padding = '10px 12px';
  cardEl.style.borderRadius = '12px';
  cardEl.style.cursor = 'pointer';
  cardEl.style.position = 'relative';

  const titleEl = document.createElement('div');

  titleEl.setAttribute('data-blok-database-card-title', '');

  if (title) {
    titleEl.textContent = title;
  } else {
    titleEl.textContent = this.i18n.t('tools.database.cardTitlePlaceholder');
    titleEl.setAttribute('data-placeholder', '');
    cardEl.setAttribute('data-empty', '');
  }

  cardEl.appendChild(titleEl);

  if (!this.readOnly) {
    const actionsEl = document.createElement('div');

    actionsEl.setAttribute('data-blok-database-card-actions', '');

    const editBtn = document.createElement('button');

    editBtn.setAttribute('data-blok-database-edit-card', '');
    editBtn.setAttribute('data-row-id', row.id);
    editBtn.setAttribute('aria-label', this.i18n.t('tools.database.editCardTitle'));
    editBtn.innerHTML = IconPencil;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startCardTitleEdit(cardEl, row.id, titlePropertyId);
    });

    const menuBtn = document.createElement('button');

    menuBtn.setAttribute('data-blok-database-card-menu', '');
    menuBtn.setAttribute('data-row-id', row.id);
    menuBtn.setAttribute('aria-label', this.i18n.t('tools.database.cardMenuLabel'));
    menuBtn.innerHTML = IconDotsHorizontal;

    actionsEl.appendChild(editBtn);
    actionsEl.appendChild(menuBtn);
    cardEl.appendChild(actionsEl);
  }

  return cardEl;
}
```

**Step 6: Add the `startCardTitleEdit` private method**

After the `createCardElement` method, add:

```typescript
/**
 * Replaces the card title div with an inline input for editing.
 * Mirrors the input-swap pattern in DatabaseColumnControls.
 */
private startCardTitleEdit(cardEl: HTMLElement, rowId: string, titlePropertyId: string): void {
  const titleEl = cardEl.querySelector<HTMLElement>('[data-blok-database-card-title]');

  if (titleEl === null) {
    return;
  }

  const originalTitle = titleEl.textContent ?? '';
  const input = document.createElement('input');

  input.type = 'text';
  input.value = originalTitle;
  input.setAttribute('data-blok-database-card-title-input', '');
  input.setAttribute('aria-label', this.i18n.t('tools.database.editCardTitle'));
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';

  let committed = false;

  const commit = (): void => {
    if (committed) return;
    committed = true;
    const newTitle = input.value.trim() || originalTitle;
    const restoredDiv = document.createElement('div');

    restoredDiv.setAttribute('data-blok-database-card-title', '');
    restoredDiv.textContent = newTitle;
    input.replaceWith(restoredDiv);

    if (newTitle !== originalTitle) {
      this.onTitleEdit?.(rowId, newTitle);
    }

    // Update empty state
    if (newTitle) {
      cardEl.removeAttribute('data-empty');
      restoredDiv.removeAttribute('data-placeholder');
    }
  };

  const cancel = (): void => {
    if (committed) return;
    committed = true;
    const restoredDiv = document.createElement('div');

    restoredDiv.setAttribute('data-blok-database-card-title', '');
    restoredDiv.textContent = originalTitle;
    input.replaceWith(restoredDiv);
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (ke) => {
    ke.stopPropagation();
    if (ke.key === 'Enter') {
      input.removeEventListener('blur', commit);
      commit();
    } else if (ke.key === 'Escape') {
      input.removeEventListener('blur', commit);
      cancel();
    }
  });

  titleEl.replaceWith(input);
  input.focus();
  input.select();
}
```

**Step 7: Run the unit tests**

```bash
yarn test test/unit/tools/database/database-board-view.test.ts
```

Expected: all new tests in `card action buttons` and `card inline title edit` pass. The old `renders delete-card button on each card when NOT read-only` test now FAILS — that's expected; you'll update it next.

**Step 8: Update the now-stale delete-card tests**

In `test/unit/tools/database/database-board-view.test.ts`, find the two existing tests about `[data-blok-database-delete-card]` (around lines 158–179) and update them:

- `'renders delete-card button on each card when NOT read-only'` → remove this test (the new `card action buttons` describe covers the replacement)
- `'does not render delete-card button in read-only mode'` → keep this test as-is (the `does NOT render the old [data-blok-database-delete-card] button` test in the new describe already covers this for non-read-only; but for clarity keep the read-only test and change it to verify `[data-blok-database-card-actions]` is absent in read-only instead)

Replace those two tests with:

```typescript
it('does not render action buttons in read-only mode', () => {
  const options = [makeOption({ id: 'opt-1' })];
  const rows = [makeRow({ id: 'row-1' })];
  const view = new DatabaseBoardView({ readOnly: true, i18n, options, getRows: () => rows, titlePropertyId: 'title' });
  const board = view.createView();

  expect(board.querySelector('[data-blok-database-card-actions]')).toBeNull();
  expect(board.querySelector('[data-blok-database-delete-card]')).toBeNull();
  expect(board.querySelector('[data-blok-database-edit-card]')).toBeNull();
  expect(board.querySelector('[data-blok-database-card-menu]')).toBeNull();
});
```

**Step 9: Run all tests to confirm green**

```bash
yarn test test/unit/tools/database/database-board-view.test.ts
```

Expected: all tests pass.

**Step 10: Commit**

```bash
git add src/tools/database/database-board-view.ts test/unit/tools/database/database-board-view.test.ts
git commit -m "feat(database): replace delete button with edit+menu action group on cards"
```

---

## Task 5: Wire `onTitleEdit` and card-menu delete in `DatabaseTool`

**Files:**
- Modify: `src/tools/database/index.ts`

**Step 1: Pass `onTitleEdit` when constructing `DatabaseBoardView`**

Search for where `new DatabaseBoardView(` is instantiated (around line 527). Find the options object passed to it. Add `onTitleEdit` to that object:

```typescript
onTitleEdit: (rowId, newTitle) => {
  const titleProp = this.model.getSchema().find((p) => p.type === 'title');
  const titlePropId = titleProp?.id ?? '';
  this.updateRowBlock(rowId, { [titlePropId]: newTitle });
  this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: newTitle } });
},
```

**Step 2: Add PopoverDesktop import**

At the top of `index.ts`, add:

```typescript
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { IconTrash } from '../../components/icons';
```

**Step 3: Update `attachViewListeners` — remove old delete handler, add menu handler**

In `attachViewListeners()`, find the `deleteCardBtn` block (lines 604–617):

```typescript
const deleteCardBtn = target.closest('[data-blok-database-delete-card]');

if (deleteCardBtn !== null) {
  const rowId = deleteCardBtn.getAttribute('data-row-id');

  if (rowId !== null) {
    event.stopPropagation();
    this.deleteRowBlock(rowId);
    this.view.removeRow(boardEl, rowId);
    void this.sync.syncDeleteRow({ rowId });
  }

  return;
}
```

Replace it with a handler for the new menu button:

```typescript
const cardMenuBtn = target.closest('[data-blok-database-card-menu]');

if (cardMenuBtn instanceof HTMLElement) {
  const rowId = cardMenuBtn.getAttribute('data-row-id');
  const cardEl = cardMenuBtn.closest('[data-blok-database-card]');

  if (rowId !== null && cardEl instanceof HTMLElement) {
    event.stopPropagation();
    this.openCardMenu(cardMenuBtn, cardEl, rowId, boardEl);
  }

  return;
}
```

**Step 4: Add the `openCardMenu` private method**

After `attachViewListeners`, add:

```typescript
private openCardMenu(anchor: HTMLElement, cardEl: HTMLElement, rowId: string, boardEl: HTMLElement): void {
  let popover: PopoverDesktop | null = null;

  cardEl.setAttribute('data-popover-open', '');

  popover = new PopoverDesktop({
    trigger: anchor,
    width: 'auto',
    minWidth: '140px',
    autoFocusFirstItem: false,
    items: [
      {
        type: PopoverItemType.Default,
        title: this.api.i18n.t('tools.database.deleteCard'),
        icon: IconTrash,
        onActivate: () => {
          this.deleteRowBlock(rowId);
          this.view.removeRow(boardEl, rowId);
          void this.sync.syncDeleteRow({ rowId });
        },
      },
    ],
  });

  popover.on(PopoverEvent.Closed, () => {
    cardEl.removeAttribute('data-popover-open');
    if (popover !== null) {
      const p = popover;
      popover = null;
      p.destroy();
    }
  });

  popover.show();
}
```

**Step 5: Run lint + unit tests**

```bash
yarn lint && yarn test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/tools/database/index.ts
git commit -m "feat(database): wire card edit title and menu delete to DatabaseTool"
```

---

## Task 6: Add CSS for the card action group

**Files:**
- Modify: `src/styles/main.css`

**Step 1: Remove the old delete-card CSS**

Find and remove these three blocks (lines 1685–1703):

```css
[data-blok-database-delete-card] { ... }
[data-blok-database-card]:hover [data-blok-database-delete-card] { ... }
[data-blok-database-delete-card]:hover { ... }
```

**Step 2: Add the new action group CSS**

In their place, add:

```css
/**
 * Card action group — edit + menu buttons revealed on hover.
 */
[data-blok-database-card-actions] {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  background: var(--blok-database-card-actions-bg, #1e2533);
  border-radius: 8px;
  padding: 2px;
}

[data-blok-database-card]:hover [data-blok-database-card-actions],
[data-blok-database-card][data-popover-open] [data-blok-database-card-actions],
[data-blok-database-card-actions]:focus-within {
  opacity: 1;
  pointer-events: auto;
}

[data-blok-database-edit-card],
[data-blok-database-card-menu] {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--blok-database-card-actions-icon, rgba(255,255,255,0.75));
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 120ms ease, color 120ms ease;
  padding: 0;
  flex-shrink: 0;
}

[data-blok-database-edit-card]:hover,
[data-blok-database-card-menu]:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

/**
 * Inline title edit input inside a card.
 */
[data-blok-database-card-title-input] {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
  background: none;
  border: none;
  border-bottom: 1px solid var(--blok-database-card-actions-icon, rgba(255,255,255,0.4));
  color: inherit;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  padding: 0;
}
```

**Step 3: Run lint**

```bash
yarn lint
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/styles/main.css
git commit -m "feat(database): add CSS for card hover action group and inline edit input"
```

---

## Task 7: Add `editCardTitle` and `cardMenuLabel` i18n keys

**Files:**
- Search for the i18n translations directory: `grep -r "deleteCard" src/ --include="*.ts" -l`
- The keys are referenced as `this.i18n.t('tools.database.editCardTitle')` and `this.i18n.t('tools.database.cardMenuLabel')`

**Step 1: Find translations files**

```bash
grep -r "cardTitlePlaceholder" src/ --include="*.ts" -l
```

This will show you which file(s) define the i18n strings. Open that file.

**Step 2: Add the missing keys**

Find `deleteCard` key in the translations object and add alongside it:

```
editCardTitle: 'Edit title',
cardMenuLabel: 'Card options',
```

(Use the exact format/indentation matching existing keys in the file.)

**Step 3: Run lint**

```bash
yarn lint
```

**Step 4: Commit**

```bash
git add <translations-file>
git commit -m "feat(database): add i18n keys for card edit title and menu label"
```

---

## Task 8: Write E2E tests (write failing, then let build make them pass)

**Files:**
- Create: `test/playwright/tests/ui/database-card-hover-actions.spec.ts`

**Step 1: Copy the setup pattern from `database-pill-title-edit.spec.ts`**

The new file should start with the same imports, `declare global` block, `HOLDER_ID`, `resetAndCreate` helper, and `DATABASE_BLOCKS` fixture from `database-pill-title-edit.spec.ts` — with one difference: add a row block to the data so there's a card to test.

```typescript
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const HOLDER_ID = 'blok';

const resetAndCreate = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
        tools: {
          database: { class: window.BlokDatabase },
          'database-row': { class: window.BlokDatabaseRow },
        },
      });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const DATABASE_WITH_CARD: OutputData['blocks'] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' },
            ],
          },
        },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: [
      {
        id: 'row-1',
        type: 'database-row',
        data: {
          properties: { 'prop-title': 'My Card', 'prop-status': 'opt-todo' },
          position: 'a0',
        },
        content: [],
      },
    ],
  },
];
```

**Step 2: Add the test cases**

```typescript
test.describe('Database board — card hover actions', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForSelector(BLOK_INTERFACE_SELECTOR);
    await resetAndCreate(page, DATABASE_WITH_CARD);
  });

  test('action group becomes visible on card hover', async ({ page }) => {
    const card = page.locator('[data-blok-database-card]').first();
    const actions = card.locator('[data-blok-database-card-actions]');

    await expect(actions).toBeHidden();
    await card.hover();
    await expect(actions).toBeVisible();
  });

  test('pencil click replaces title with input pre-filled with current title', async ({ page }) => {
    const card = page.locator('[data-blok-database-card]').first();

    await card.hover();
    await card.locator('[data-blok-database-edit-card]').click();

    const input = card.locator('[data-blok-database-card-title-input]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('My Card');
  });

  test('Enter saves new title to the card', async ({ page }) => {
    const card = page.locator('[data-blok-database-card]').first();

    await card.hover();
    await card.locator('[data-blok-database-edit-card]').click();

    const input = card.locator('[data-blok-database-card-title-input]');
    await input.fill('Updated Title');
    await input.press('Enter');

    await expect(card.locator('[data-blok-database-card-title]')).toHaveText('Updated Title');
    await expect(card.locator('[data-blok-database-card-title-input]')).toBeHidden();
  });

  test('Escape restores original title without saving', async ({ page }) => {
    const card = page.locator('[data-blok-database-card]').first();

    await card.hover();
    await card.locator('[data-blok-database-edit-card]').click();

    const input = card.locator('[data-blok-database-card-title-input]');
    await input.fill('Temporary');
    await input.press('Escape');

    await expect(card.locator('[data-blok-database-card-title]')).toHaveText('My Card');
  });

  test('dots button opens a menu with Delete option', async ({ page }) => {
    const card = page.locator('[data-blok-database-card]').first();

    await card.hover();
    await card.locator('[data-blok-database-card-menu]').click();

    const deleteOption = page.getByRole('button', { name: /delete/i });
    await expect(deleteOption).toBeVisible();
  });

  test('clicking Delete in the menu removes the card', async ({ page }) => {
    const card = page.locator('[data-blok-database-card]').first();

    await card.hover();
    await card.locator('[data-blok-database-card-menu]').click();

    await page.getByRole('button', { name: /delete/i }).click();

    await expect(page.locator('[data-blok-database-card]')).toHaveCount(0);
  });
});
```

**Step 3: Run the E2E tests to confirm they fail**

```bash
yarn e2e test/playwright/tests/ui/database-card-hover-actions.spec.ts
```

Expected: tests fail because the action group doesn't exist in the built bundle yet (build reflects old code until Task 4–5 are shipped).

**Step 4: Build and re-run E2E**

After Tasks 4, 5, 6, 7 are committed:

```bash
yarn build:test && yarn e2e test/playwright/tests/ui/database-card-hover-actions.spec.ts
```

Expected: all 6 E2E tests pass.

**Step 5: Commit**

```bash
git add test/playwright/tests/ui/database-card-hover-actions.spec.ts
git commit -m "test(e2e): add card hover actions E2E tests"
```

---

## Task 9: Final verification

**Step 1: Run full test suite**

```bash
yarn lint && yarn test && yarn build:test && yarn e2e
```

Expected: all pass, no regressions.

**Step 2: Commit if any loose files remain**

```bash
git status
```

If clean, nothing to do.

**Step 3: Push**

```bash
git push
```

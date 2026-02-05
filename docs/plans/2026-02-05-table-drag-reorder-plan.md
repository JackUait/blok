# Table Drag-to-Reorder Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove redundant Move menu items from table row/column popovers and enhance the drag-to-reorder UX with ghost previews and better visual feedback.

**Architecture:** The table tool has two files for row/column interaction: `table-row-col-controls.ts` (grip pills + popover menus) and `table-row-col-drag.ts` (pointer-based drag reorder). We remove move items from the menus and enhance the drag module with ghost clones, improved highlights, and a polished drop indicator.

**Tech Stack:** TypeScript, DOM APIs (pointer events, cloneNode, fixed positioning), Playwright E2E tests

---

### Task 1: Write E2E test — column popover no longer shows move items

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts` (inside `row/column controls` describe block, ~line 689)

**Step 1: Write the failing test**

Add this test inside the existing `test.describe('row/column controls', ...)` block (after `'clicking column grip opens popover menu'` test at ~line 759):

```typescript
test('column popover does not show move options', async ({ page }) => {
  await createTable2x2(page);

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
  const firstCell = page.locator(CELL_SELECTOR).first();

  await firstCell.click();

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
  const colGrip = page.locator(COL_GRIP_SELECTOR).first();

  await expect(colGrip).toBeVisible();
  await colGrip.click();

  // Popover should be open
  await expect(page.getByText('Insert Column Left')).toBeVisible();

  // Move options should NOT exist
  await expect(page.getByText('Move Column Left')).toHaveCount(0);
  await expect(page.getByText('Move Column Right')).toHaveCount(0);
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "column popover does not show move options"`
Expected: FAIL — "Move Column Left" text exists in the popover

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test asserting move items removed from column popover"
```

---

### Task 2: Write E2E test — row popover no longer shows move items

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add this test after the previous one:

```typescript
test('row popover does not show move options', async ({ page }) => {
  await createTable2x2(page);

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
  const firstCell = page.locator(CELL_SELECTOR).first();

  await firstCell.click();

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
  const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

  await expect(rowGrip).toBeVisible();
  await rowGrip.click();

  // Popover should be open
  await expect(page.getByText('Insert Row Above')).toBeVisible();

  // Move options should NOT exist
  await expect(page.getByText('Move Row Up')).toHaveCount(0);
  await expect(page.getByText('Move Row Down')).toHaveCount(0);
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "row popover does not show move options"`
Expected: FAIL — "Move Row Up" text exists in the popover

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test asserting move items removed from row popover"
```

---

### Task 3: Remove move menu items from popovers

**Files:**
- Modify: `src/tools/table/table-row-col-controls.ts`

**Step 1: Remove unused icon imports**

In `table-row-col-controls.ts` line 1-11, change the import to remove `IconMoveDown`, `IconMoveLeft`, `IconMoveRight`, `IconMoveUp`:

```typescript
import {
  IconInsertAbove,
  IconInsertBelow,
  IconInsertLeft,
  IconInsertRight,
  IconTrash,
  IconHeading,
} from '../../components/icons';
```

**Step 2: Remove move items from `buildColumnMenu()`**

In `buildColumnMenu()` (lines 471-523), remove the separator + two move items (lines 491-509). The method should go directly from "Insert Column Right" to the separator before "Delete Column":

```typescript
private buildColumnMenu(colIndex: number): PopoverItemParams[] {
  return [
    {
      icon: IconInsertLeft,
      title: 'Insert Column Left',
      closeOnActivate: true,
      onActivate: (): void => {
        this.onAction({ type: 'insert-col-left', index: colIndex });
      },
    },
    {
      icon: IconInsertRight,
      title: 'Insert Column Right',
      closeOnActivate: true,
      onActivate: (): void => {
        this.onAction({ type: 'insert-col-right', index: colIndex });
      },
    },
    { type: PopoverItemType.Separator },
    {
      icon: IconTrash,
      title: 'Delete Column',
      confirmation: {
        title: 'Click to confirm',
        icon: IconTrash,
        onActivate: (): void => {
          this.onAction({ type: 'delete-col', index: colIndex });
        },
      },
    },
  ];
}
```

**Step 3: Remove move items from `buildRowMenu()`**

In `buildRowMenu()` (lines 525-597), remove the separator + two move items (lines 544-562). The `baseItems` array should go from "Insert Row Below" directly to an empty array (the heading + delete sections are appended separately):

```typescript
private buildRowMenu(rowIndex: number): PopoverItemParams[] {
  const baseItems: PopoverItemParams[] = [
    {
      icon: IconInsertAbove,
      title: 'Insert Row Above',
      closeOnActivate: true,
      onActivate: (): void => {
        this.onAction({ type: 'insert-row-above', index: rowIndex });
      },
    },
    {
      icon: IconInsertBelow,
      title: 'Insert Row Below',
      closeOnActivate: true,
      onActivate: (): void => {
        this.onAction({ type: 'insert-row-below', index: rowIndex });
      },
    },
  ];

  // ... headingItems and deleteItems remain unchanged
```

**Step 4: Run both new E2E tests to verify they pass**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "popover does not show move options"`
Expected: PASS

**Step 5: Run full E2E table suite to catch regressions**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/tools/table/table-row-col-controls.ts
git commit -m "feat(table): remove move menu items from row/column popovers"
```

---

### Task 4: Write E2E test — drag row shows ghost preview

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add a new describe block after `row/column controls`:

```typescript
test.describe('drag reorder', () => {
  const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';
  const COL_GRIP_SELECTOR = '[data-blok-table-grip-col]';

  const createTable3x3 = async (page: Page): Promise<void> => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A1', 'A2', 'A3'],
                ['B1', 'B2', 'B3'],
                ['C1', 'C2', 'C3'],
              ],
            },
          },
        ],
      },
    });
  };

  test('dragging row grip shows ghost preview element', async ({ page }) => {
    await createTable3x3(page);

    // Click cell to show grip
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    await page.locator(CELL_SELECTOR).first().click();

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGrip).toBeVisible();

    const gripBox = await rowGrip.boundingBox();

    if (!gripBox) {
      throw new Error('Grip not visible');
    }

    const startX = gripBox.x + gripBox.width / 2;
    const startY = gripBox.y + gripBox.height / 2;

    // Start drag — move beyond threshold (10px)
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 50, { steps: 5 });

    // Ghost element should appear
    const ghost = page.locator('[data-blok-table-drag-ghost]');

    await expect(ghost).toBeVisible();

    // Clean up
    await page.mouse.up();

    // Ghost should be removed after drop
    await expect(ghost).toHaveCount(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "dragging row grip shows ghost preview"`
Expected: FAIL — no element with `data-blok-table-drag-ghost` exists

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test for row drag ghost preview"
```

---

### Task 5: Write E2E test — drag column reorders and shows ghost

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add inside the `drag reorder` describe block:

```typescript
test('dragging column grip reorders column and shows ghost', async ({ page }) => {
  await createTable3x3(page);

  // Click cell in second column to show its grip
  // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell
  await page.locator(CELL_SELECTOR).nth(1).click();

  // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second column grip
  const colGrip = page.locator(COL_GRIP_SELECTOR).nth(1);

  await expect(colGrip).toBeVisible();

  const gripBox = await colGrip.boundingBox();

  if (!gripBox) {
    throw new Error('Grip not visible');
  }

  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;

  // Drag column 1 to the left (past column 0)
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 200, startY, { steps: 10 });

  // Ghost should be visible during drag
  const ghost = page.locator('[data-blok-table-drag-ghost]');

  await expect(ghost).toBeVisible();

  await page.mouse.up();

  // Ghost removed
  await expect(ghost).toHaveCount(0);

  // Column should have been reordered: A2 is now in first column
  const savedData = await page.evaluate(async () => {
    return window.blokInstance?.save();
  });

  const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  expect(tableBlock?.data.content[0][0]).toBe('A2');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  expect(tableBlock?.data.content[0][1]).toBe('A1');
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "dragging column grip reorders"`
Expected: FAIL — no ghost element

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test for column drag reorder with ghost"
```

---

### Task 6: Write E2E test — drag row reorders data

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add inside the `drag reorder` describe block:

```typescript
test('dragging row grip reorders row data', async ({ page }) => {
  await createTable3x3(page);

  // Click cell in first row to show its grip
  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
  await page.locator(CELL_SELECTOR).first().click();

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
  const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

  await expect(rowGrip).toBeVisible();

  const gripBox = await rowGrip.boundingBox();

  if (!gripBox) {
    throw new Error('Grip not visible');
  }

  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;

  // Drag row 0 down past row 1
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 100, { steps: 10 });
  await page.mouse.up();

  const savedData = await page.evaluate(async () => {
    return window.blokInstance?.save();
  });

  const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

  // Row A should have moved down — B1 is now first row
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  expect(tableBlock?.data.content[0][0]).toBe('B1');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  expect(tableBlock?.data.content[1][0]).toBe('A1');
});
```

**Step 2: Run test to verify it fails or passes**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "dragging row grip reorders row data"`
Note: This test may pass already since row drag reorder works. If it passes, that's fine — it's a regression test.

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test for row drag data reorder"
```

---

### Task 7: Write E2E test — cursor changes to grabbing during drag

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add inside the `drag reorder` describe block:

```typescript
test('cursor changes to grabbing during drag', async ({ page }) => {
  await createTable3x3(page);

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
  await page.locator(CELL_SELECTOR).first().click();

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
  const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

  await expect(rowGrip).toBeVisible();

  const gripBox = await rowGrip.boundingBox();

  if (!gripBox) {
    throw new Error('Grip not visible');
  }

  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 50, { steps: 5 });

  // Body cursor should be 'grabbing' during drag
  const cursor = await page.evaluate(() => document.body.style.cursor);

  expect(cursor).toBe('grabbing');

  await page.mouse.up();

  // Cursor should be restored
  const cursorAfter = await page.evaluate(() => document.body.style.cursor);

  expect(cursorAfter).toBe('');
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "cursor changes to grabbing"`
Expected: FAIL — cursor is not 'grabbing'

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test for grabbing cursor during drag"
```

---

### Task 8: Implement ghost preview in TableRowColDrag

**Files:**
- Modify: `src/tools/table/table-row-col-drag.ts`

**Context:** `TableRowColDrag` class at `src/tools/table/table-row-col-drag.ts`. It uses `CELL_ATTR` and `ROW_ATTR` from `./table-core`. The `startDrag()` method (line 139) is called after the 10px drag threshold. `handleDocPointerMove()` (line 111) runs on every move. `cleanup()` (line 89) runs on pointer up.

**Step 1: Add ghost element properties and constants**

Add a `data-blok-table-drag-ghost` attribute constant at the top of the file (after `DRAG_THRESHOLD`):

```typescript
const GHOST_ATTR = 'data-blok-table-drag-ghost';
```

Add new private fields to the class (after `dragOverlayCells` on line 49):

```typescript
private ghostEl: HTMLElement | null = null;
private ghostOffsetX = 0;
private ghostOffsetY = 0;
```

**Step 2: Create the ghost in `startDrag()`**

After `this.highlightSourceCells()` and `this.createDropIndicator()` in `startDrag()`, add:

```typescript
this.createGhost();
```

Add a new private method `createGhost()`:

```typescript
private createGhost(): void {
  const ghost = document.createElement('div');

  ghost.setAttribute(GHOST_ATTR, '');
  ghost.setAttribute('contenteditable', 'false');

  const style = ghost.style;

  style.position = 'fixed';
  style.pointerEvents = 'none';
  style.opacity = '0.5';
  style.zIndex = '50';
  style.borderRadius = '4px';
  style.overflow = 'hidden';
  style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';

  if (this.dragType === 'row') {
    this.buildRowGhost(ghost);
  } else if (this.dragType === 'col') {
    this.buildColumnGhost(ghost);
  }

  document.body.appendChild(ghost);
  this.ghostEl = ghost;

  // Center ghost on the drag start point
  const rect = ghost.getBoundingClientRect();

  this.ghostOffsetX = rect.width / 2;
  this.ghostOffsetY = rect.height / 2;

  style.left = `${this.dragStartX - this.ghostOffsetX}px`;
  style.top = `${this.dragStartY - this.ghostOffsetY}px`;
}
```

Add `buildRowGhost()`:

```typescript
private buildRowGhost(ghost: HTMLElement): void {
  const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
  const sourceRow = rows[this.dragFromIndex] as HTMLElement | undefined;

  if (!sourceRow) {
    return;
  }

  const style = ghost.style;

  style.display = 'flex';
  style.height = `${sourceRow.offsetHeight}px`;

  const cells = sourceRow.querySelectorAll(`[${CELL_ATTR}]`);

  cells.forEach(cell => {
    const cellEl = cell as HTMLElement;
    const clone = cellEl.cloneNode(true) as HTMLElement;

    clone.style.width = `${cellEl.offsetWidth}px`;
    clone.style.flexShrink = '0';
    clone.removeAttribute('contenteditable');
    ghost.appendChild(clone);
  });
}
```

Add `buildColumnGhost()`:

```typescript
private buildColumnGhost(ghost: HTMLElement): void {
  const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

  const style = ghost.style;

  style.display = 'flex';
  style.flexDirection = 'column';

  rows.forEach(row => {
    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

    if (this.dragFromIndex >= cells.length) {
      return;
    }

    const cellEl = cells[this.dragFromIndex] as HTMLElement;
    const clone = cellEl.cloneNode(true) as HTMLElement;

    clone.style.width = `${cellEl.offsetWidth}px`;
    clone.style.height = `${cellEl.offsetHeight}px`;
    clone.removeAttribute('contenteditable');
    ghost.appendChild(clone);
  });
}
```

**Step 3: Update ghost position in `handleDocPointerMove()`**

In `handleDocPointerMove()`, after `this.updateDragIndicator(e)` (line 122), add:

```typescript
this.updateGhostPosition(e);
```

Add the method:

```typescript
private updateGhostPosition(e: PointerEvent): void {
  if (!this.ghostEl) {
    return;
  }

  const style = this.ghostEl.style;

  style.left = `${e.clientX - this.ghostOffsetX}px`;
  style.top = `${e.clientY - this.ghostOffsetY}px`;
}
```

**Step 4: Clean up ghost in `cleanup()`**

In `cleanup()`, after removing the drop indicator (line 99-100), add:

```typescript
this.ghostEl?.remove();
this.ghostEl = null;
```

**Step 5: Run the ghost E2E tests**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "ghost preview"`
Expected: PASS

**Step 6: Commit**

```bash
git add src/tools/table/table-row-col-drag.ts
git commit -m "feat(table): add ghost preview during row/column drag"
```

---

### Task 9: Implement enhanced visual feedback

**Files:**
- Modify: `src/tools/table/table-row-col-drag.ts`

**Step 1: Enhance source cell highlighting**

In `highlightRowCells()` and `highlightColumnCells()`, change the highlight from `#eff6ff` to `#dbeafe` and add `opacity: 0.6`:

In `highlightRowCells()` (line 172-173), change:
```typescript
cellEl.style.backgroundColor = '#dbeafe';
cellEl.style.opacity = '0.6';
```

In `highlightColumnCells()` (line 187-188), change:
```typescript
cellEl.style.backgroundColor = '#dbeafe';
cellEl.style.opacity = '0.6';
```

**Step 2: Restore opacity in cleanup**

In `cleanup()`, update the cell reset loop (lines 92-96) to also clear opacity:

```typescript
this.dragOverlayCells.forEach(overlayCell => {
  const el: HTMLElement = overlayCell;

  el.style.backgroundColor = '';
  el.style.opacity = '';
});
```

**Step 3: Enhance drop indicator**

In `createDropIndicator()`, change the thickness from 2px to 3px, add border-radius, and add transition.

For row indicator (line 201):
```typescript
this.dropIndicator.style.height = '3px';
```

For column indicator (line 205):
```typescript
this.dropIndicator.style.width = '3px';
```

Add after the type check:
```typescript
this.dropIndicator.style.borderRadius = '1.5px';
```

Add transition based on type:
```typescript
if (this.dragType === 'row') {
  this.dropIndicator.style.transition = 'top 100ms ease';
} else {
  this.dropIndicator.style.transition = 'left 100ms ease';
}
```

**Step 4: Add indicator end dots**

After creating the indicator, add two small circle elements at each end. Add a new method called after `this.grid.appendChild(this.dropIndicator)`:

```typescript
this.addIndicatorDots();
```

```typescript
private addIndicatorDots(): void {
  if (!this.dropIndicator) {
    return;
  }

  const dotSize = 8;

  const createDot = (): HTMLElement => {
    const dot = document.createElement('div');
    const style = dot.style;

    style.position = 'absolute';
    style.width = `${dotSize}px`;
    style.height = `${dotSize}px`;
    style.borderRadius = '50%';
    style.backgroundColor = '#3b82f6';

    return dot;
  };

  const dotStart = createDot();
  const dotEnd = createDot();

  if (this.dragType === 'row') {
    // Horizontal line: dots at left and right ends
    dotStart.style.left = `${-dotSize / 2}px`;
    dotStart.style.top = `${-dotSize / 2 + 1.5}px`;
    dotEnd.style.right = `${-dotSize / 2}px`;
    dotEnd.style.top = `${-dotSize / 2 + 1.5}px`;
  } else {
    // Vertical line: dots at top and bottom ends
    dotStart.style.top = `${-dotSize / 2}px`;
    dotStart.style.left = `${-dotSize / 2 + 1.5}px`;
    dotEnd.style.bottom = `${-dotSize / 2}px`;
    dotEnd.style.left = `${-dotSize / 2 + 1.5}px`;
  }

  this.dropIndicator.appendChild(dotStart);
  this.dropIndicator.appendChild(dotEnd);
}
```

**Step 5: Add cursor management**

In `startDrag()`, after the existing code, add:

```typescript
document.body.style.cursor = 'grabbing';
```

In `cleanup()`, add (before removing event listeners):

```typescript
document.body.style.cursor = '';
```

**Step 6: Run the cursor and visual feedback tests**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "cursor changes to grabbing"`
Expected: PASS

**Step 7: Run all E2E table tests for regressions**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add src/tools/table/table-row-col-drag.ts
git commit -m "feat(table): enhance drag visual feedback with highlights, indicator dots, and cursor"
```

---

### Task 10: Run full test suite and lint

**Step 1: Run lint**

Run: `yarn lint`
Expected: PASS (no new lint errors)

**Step 2: Run unit tests**

Run: `yarn test`
Expected: All PASS

**Step 3: Run full E2E suite**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts`
Expected: All PASS

**Step 4: Commit any fixes if needed**

---

### Task 11: Run /refactor

Use the `refactor:refactor` skill to review all changes made in this session.

---

### Task 12: Final verification against master

Use the `verification:final-verification` skill to verify nothing is broken compared to master.

---

### Task 13: Push

```bash
git pull --rebase
bd sync
git push
git status  # Must show "up to date with origin"
```

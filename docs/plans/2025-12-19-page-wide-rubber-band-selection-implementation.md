# Page-Wide Rubber Band Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable rubber band selection to start from anywhere on the page (not just inside the editor), while preserving existing selection behavior.

**Architecture:** Modify the existing `RectangleSelection` module to attach `mousedown` listener at document level and use vertical alignment to determine editor ownership. Add Shift-key support for additive selection.

**Tech Stack:** TypeScript, Vitest (unit tests), Playwright (E2E tests)

---

## Task 1: Move mousedown listener to document level

**Files:**
- Modify: `src/components/modules/rectangleSelection.ts:196-201`
- Test: `test/unit/components/modules/rectangleSelection.test.ts`

**Step 1: Write the failing test for document-level mousedown**

Add this test to `test/unit/components/modules/rectangleSelection.test.ts`:

```typescript
it('attaches mousedown listener to document.body instead of container', () => {
  const {
    rectangleSelection,
  } = createRectangleSelection();

  const documentAddListenerSpy = vi.spyOn(document.body, 'addEventListener');

  rectangleSelection.prepare();

  const mousedownCalls = documentAddListenerSpy.mock.calls.filter(
    (call) => call[0] === 'mousedown'
  );

  expect(mousedownCalls.length).toBeGreaterThan(0);

  documentAddListenerSpy.mockRestore();
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts -t "attaches mousedown listener to document.body"`

Expected: FAIL - mousedown is currently attached to container, not document.body

**Step 3: Update enableModuleBindings to attach mousedown to document.body**

In `src/components/modules/rectangleSelection.ts`, change `enableModuleBindings()`:

```typescript
private enableModuleBindings(): void {
  this.genHTML();

  this.listeners.on(document.body, 'mousedown', (event: Event) => {
    this.processMouseDown(event as MouseEvent);
  }, false);

  const throttledMouseMove = throttle((event: unknown) => {
    if (event instanceof MouseEvent) {
      this.processMouseMove(event);
    }
  }, 10) as EventListener;

  this.listeners.on(document.body, 'mousemove', throttledMouseMove, {
    passive: true,
  });

  this.listeners.on(document.body, 'mouseleave', () => {
    this.processMouseLeave();
  });

  const throttledScroll = throttle((event: unknown) => {
    this.processScroll(event as MouseEvent);
  }, 10) as EventListener;

  this.listeners.on(window, 'scroll', throttledScroll, {
    passive: true,
  });

  this.listeners.on(document.body, 'mouseup', () => {
    this.processMouseUp();
  }, false);
}
```

Note: We no longer destructure `container` from `genHTML()` since we don't need it for the listener.

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts -t "attaches mousedown listener to document.body"`

Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/rectangleSelection.ts test/unit/components/modules/rectangleSelection.test.ts
git commit -m "refactor: move mousedown listener to document.body for page-wide selection"
```

---

## Task 2: Replace "inside editor" check with vertical alignment

**Files:**
- Modify: `src/components/modules/rectangleSelection.ts:120-165`
- Test: `test/unit/components/modules/rectangleSelection.test.ts`

**Step 1: Write the failing test for vertical alignment check**

Add these tests to `test/unit/components/modules/rectangleSelection.test.ts`:

```typescript
it('starts selection when pointer Y is within editor vertical bounds', () => {
  const {
    rectangleSelection,
    blokWrapper,
  } = createRectangleSelection();

  rectangleSelection.prepare();

  // Mock editor bounds: top=100, bottom=500
  vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 500,
    left: 200,
    right: 600,
    width: 400,
    height: 400,
    x: 200,
    y: 100,
    toJSON: () => ({}),
  });

  // Point outside editor horizontally (x=50) but within vertical range (y=300)
  const outsideElement = document.createElement('div');
  document.body.appendChild(outsideElement);
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(outsideElement);

  const internal = rectangleSelection as unknown as { mousedown: boolean };

  // pageY=300 is within editor's vertical range (100-500)
  rectangleSelection.startSelection(50, 300);

  expect(internal.mousedown).toBe(true);
});

it('ignores selection when pointer Y is outside editor vertical bounds', () => {
  const {
    rectangleSelection,
    blokWrapper,
  } = createRectangleSelection();

  rectangleSelection.prepare();

  // Mock editor bounds: top=100, bottom=500
  vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 500,
    left: 200,
    right: 600,
    width: 400,
    height: 400,
    x: 200,
    y: 100,
    toJSON: () => ({}),
  });

  const outsideElement = document.createElement('div');
  document.body.appendChild(outsideElement);
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(outsideElement);

  const internal = rectangleSelection as unknown as { mousedown: boolean };

  // pageY=50 is above editor's vertical range (100-500)
  rectangleSelection.startSelection(50, 50);

  expect(internal.mousedown).toBe(false);

  // pageY=600 is below editor's vertical range
  rectangleSelection.startSelection(50, 600);

  expect(internal.mousedown).toBe(false);
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts -t "pointer Y"`

Expected: FAIL - current code requires selection to start inside editor element

**Step 3: Update startSelection to use vertical alignment**

In `src/components/modules/rectangleSelection.ts`, replace the `startSelection` method:

```typescript
public startSelection(pageX: number, pageY: number): void {
  const { UI } = this.Blok;
  const redactor = UI.nodes.redactor;

  if (!redactor) {
    return;
  }

  const editorRect = redactor.getBoundingClientRect();
  const scrollTop = this.getScrollTop();
  const pointerY = pageY - scrollTop;

  // Check if pointer is within editor's vertical bounds
  const withinEditorVertically = pointerY >= editorRect.top && pointerY <= editorRect.bottom;

  if (!withinEditorVertically) {
    return;
  }

  const scrollLeft = this.getScrollLeft();
  const elemWhereSelectionStart = document.elementFromPoint(pageX - scrollLeft, pointerY);

  if (!elemWhereSelectionStart) {
    return;
  }

  /**
   * Don't clear selected block by clicks on the Block settings
   * because we need to keep highlighting working block
   */
  const startsInsideToolbar = elemWhereSelectionStart.closest(createSelector(DATA_ATTR.toolbar));

  if (!startsInsideToolbar) {
    this.Blok.BlockSelection.allBlocksSelected = false;
    this.clearSelection();
    this.stackOfSelected = [];
  }

  const selectorsToAvoid = [
    createSelector(DATA_ATTR.elementContent),
    createSelector(DATA_ATTR.toolbar),
    INLINE_TOOLBAR_INTERFACE_SELECTOR,
  ];

  const startsInSelectorToAvoid = selectorsToAvoid.some((selector) => !!elemWhereSelectionStart.closest(selector));

  /**
   * If selection starts inside the blocks content or on Blok UI elements, do not handle it
   */
  if (startsInSelectorToAvoid) {
    return;
  }

  /**
   * Hide the toolbar immediately so it does not obstruct drag selection.
   */
  this.Blok.Toolbar.close();

  this.mousedown = true;
  this.startX = pageX;
  this.startY = pageY;
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts -t "pointer Y"`

Expected: PASS

**Step 5: Update existing test that expects "outside" to fail**

The test `'ignores selection attempts outside of selectable area'` needs updating. It currently tests both outside-editor and inside-content-element cases. Update it:

```typescript
it('ignores selection attempts on block content or selectors to avoid', () => {
  const {
    rectangleSelection,
    blokWrapper,
  } = createRectangleSelection();

  rectangleSelection.prepare();

  // Mock editor to have valid vertical bounds
  vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 1000,
    left: 0,
    right: 800,
    width: 800,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  const internal = rectangleSelection as unknown as { mousedown: boolean };

  const blockContent = document.createElement('div');

  blockContent.setAttribute('data-blok-testid', 'block-content');
  blockContent.setAttribute('data-blok-element-content', '');
  blokWrapper.appendChild(blockContent);

  const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(blockContent);

  rectangleSelection.startSelection(20, 25);

  expect(internal.mousedown).toBe(false);

  elementFromPointSpy.mockRestore();
});
```

**Step 6: Run all rectangleSelection tests**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts`

Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/components/modules/rectangleSelection.ts test/unit/components/modules/rectangleSelection.test.ts
git commit -m "feat: use vertical alignment for page-wide rubber band selection"
```

---

## Task 3: Add Shift-key support for additive selection

**Files:**
- Modify: `src/components/modules/rectangleSelection.ts:120-165, 236-250`
- Test: `test/unit/components/modules/rectangleSelection.test.ts`

**Step 1: Write the failing test for Shift-key additive selection**

Add these tests to `test/unit/components/modules/rectangleSelection.test.ts`:

```typescript
it('preserves existing selection when Shift key is held during selection start', () => {
  const {
    rectangleSelection,
    blockSelection,
    blokWrapper,
  } = createRectangleSelection();

  rectangleSelection.prepare();

  // Mock editor bounds
  vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 1000,
    left: 0,
    right: 800,
    width: 800,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  const internal = rectangleSelection as unknown as {
    stackOfSelected: number[];
    mousedown: boolean;
  };

  // Pre-populate selection stack
  internal.stackOfSelected = [0, 1];
  blockSelection.allBlocksSelected = true;

  const startTarget = document.createElement('div');
  blokWrapper.appendChild(startTarget);
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

  // Start selection with Shift key
  rectangleSelection.startSelection(120, 240, true);

  // stackOfSelected should NOT be cleared
  expect(internal.stackOfSelected).toEqual([0, 1]);
  // allBlocksSelected should NOT be reset
  expect(blockSelection.allBlocksSelected).toBe(true);
  expect(internal.mousedown).toBe(true);
});

it('clears existing selection when Shift key is not held', () => {
  const {
    rectangleSelection,
    blockSelection,
    blokWrapper,
  } = createRectangleSelection();

  rectangleSelection.prepare();

  // Mock editor bounds
  vi.spyOn(blokWrapper, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 1000,
    left: 0,
    right: 800,
    width: 800,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  const internal = rectangleSelection as unknown as {
    stackOfSelected: number[];
    mousedown: boolean;
  };

  // Pre-populate selection stack
  internal.stackOfSelected = [0, 1];
  blockSelection.allBlocksSelected = true;

  const startTarget = document.createElement('div');
  blokWrapper.appendChild(startTarget);
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(startTarget);

  // Start selection without Shift key
  rectangleSelection.startSelection(120, 240, false);

  // stackOfSelected should be cleared
  expect(internal.stackOfSelected).toEqual([]);
  // allBlocksSelected should be reset
  expect(blockSelection.allBlocksSelected).toBe(false);
  expect(internal.mousedown).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts -t "Shift key"`

Expected: FAIL - startSelection doesn't accept shiftKey parameter

**Step 3: Add shiftKey parameter to startSelection**

In `src/components/modules/rectangleSelection.ts`, update `startSelection`:

```typescript
/**
 * Init rect params
 * @param {number} pageX - X coord of mouse
 * @param {number} pageY - Y coord of mouse
 * @param {boolean} shiftKey - whether Shift key is held for additive selection
 */
public startSelection(pageX: number, pageY: number, shiftKey = false): void {
  const { UI } = this.Blok;
  const redactor = UI.nodes.redactor;

  if (!redactor) {
    return;
  }

  const editorRect = redactor.getBoundingClientRect();
  const scrollTop = this.getScrollTop();
  const pointerY = pageY - scrollTop;

  // Check if pointer is within editor's vertical bounds
  const withinEditorVertically = pointerY >= editorRect.top && pointerY <= editorRect.bottom;

  if (!withinEditorVertically) {
    return;
  }

  const scrollLeft = this.getScrollLeft();
  const elemWhereSelectionStart = document.elementFromPoint(pageX - scrollLeft, pointerY);

  if (!elemWhereSelectionStart) {
    return;
  }

  /**
   * Don't clear selected block by clicks on the Block settings
   * because we need to keep highlighting working block
   */
  const startsInsideToolbar = elemWhereSelectionStart.closest(createSelector(DATA_ATTR.toolbar));

  /**
   * When Shift is held, preserve existing selection for additive behavior.
   * Otherwise, clear selection state.
   */
  if (!startsInsideToolbar && !shiftKey) {
    this.Blok.BlockSelection.allBlocksSelected = false;
    this.clearSelection();
    this.stackOfSelected = [];
  }

  const selectorsToAvoid = [
    createSelector(DATA_ATTR.elementContent),
    createSelector(DATA_ATTR.toolbar),
    INLINE_TOOLBAR_INTERFACE_SELECTOR,
  ];

  const startsInSelectorToAvoid = selectorsToAvoid.some((selector) => !!elemWhereSelectionStart.closest(selector));

  /**
   * If selection starts inside the blocks content or on Blok UI elements, do not handle it
   */
  if (startsInSelectorToAvoid) {
    return;
  }

  /**
   * Hide the toolbar immediately so it does not obstruct drag selection.
   */
  this.Blok.Toolbar.close();

  this.mousedown = true;
  this.startX = pageX;
  this.startY = pageY;
}
```

**Step 4: Update processMouseDown to pass shiftKey**

In `src/components/modules/rectangleSelection.ts`, update `processMouseDown`:

```typescript
/**
 * Handle mouse down events
 * @param {MouseEvent} mouseEvent - mouse event payload
 */
private processMouseDown(mouseEvent: MouseEvent): void {
  if (mouseEvent.button !== this.MAIN_MOUSE_BUTTON) {
    return;
  }

  /**
   * Do not enable the Rectangle Selection when mouse dragging started some editable input
   * Used to prevent Rectangle Selection on Block Tune wrappers' inputs that also can be inside the Block
   */
  const startedFromContentEditable = (mouseEvent.target as Element).closest($.allInputsSelector) !== null;

  if (!startedFromContentEditable) {
    this.startSelection(mouseEvent.pageX, mouseEvent.pageY, mouseEvent.shiftKey);
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts -t "Shift key"`

Expected: PASS

**Step 6: Run all unit tests**

Run: `yarn test test/unit/components/modules/rectangleSelection.test.ts`

Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/components/modules/rectangleSelection.ts test/unit/components/modules/rectangleSelection.test.ts
git commit -m "feat: add Shift-key support for additive rubber band selection"
```

---

## Task 4: Add E2E test for page-wide rubber band selection

**Files:**
- Modify: `test/playwright/tests/modules/selection.spec.ts`

**Step 1: Build the test bundle**

Run: `yarn build:test`

Expected: Build completes successfully

**Step 2: Write E2E test for page-wide selection**

Add this test to `test/playwright/tests/modules/selection.spec.ts`:

```typescript
test('rubber band selection works when starting from page margin outside editor', async ({ page }) => {
  await createBlokWithBlocks(page, [
    {
      type: 'paragraph',
      data: {
        text: 'First block',
      },
    },
    {
      type: 'paragraph',
      data: {
        text: 'Second block',
      },
    },
    {
      type: 'paragraph',
      data: {
        text: 'Third block',
      },
    },
  ]);

  const firstBlock = getBlockByIndex(page, 0);
  const secondBlock = getBlockByIndex(page, 1);

  const firstBox = await getRequiredBoundingBox(firstBlock);
  const secondBox = await getRequiredBoundingBox(secondBlock);

  // Start drag from left margin (x=10), at the Y position of first block
  const startX = 10;
  const startY = firstBox.y + firstBox.height / 2;

  // End drag still in margin, but at Y position of second block
  const endX = 10;
  const endY = secondBox.y + secondBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 2)).not.toHaveAttribute('data-blok-selected', 'true');
});

test('rubber band selection clears when dragging in empty space without touching blocks', async ({ page }) => {
  await createBlokWithBlocks(page, [
    {
      type: 'paragraph',
      data: {
        text: 'First block',
      },
    },
    {
      type: 'paragraph',
      data: {
        text: 'Second block',
      },
    },
  ]);

  // First, select a block
  const firstBlock = getBlockByIndex(page, 0);
  await firstBlock.click();
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
  await page.keyboard.press(SELECT_ALL_SHORTCUT);

  await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');

  const firstBox = await getRequiredBoundingBox(firstBlock);

  // Drag in the far left margin without crossing any blocks horizontally
  // Start above the editor content
  const startX = 5;
  const startY = firstBox.y - 50;
  const endX = 5;
  const endY = firstBox.y - 10;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();

  // Selection should be cleared since we didn't touch any blocks
  await expect(getBlockByIndex(page, 0)).not.toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 1)).not.toHaveAttribute('data-blok-selected', 'true');
});

test('Shift+drag adds to existing selection instead of replacing', async ({ page }) => {
  await createBlokWithBlocks(page, [
    {
      type: 'paragraph',
      data: {
        text: 'First block',
      },
    },
    {
      type: 'paragraph',
      data: {
        text: 'Second block',
      },
    },
    {
      type: 'paragraph',
      data: {
        text: 'Third block',
      },
    },
    {
      type: 'paragraph',
      data: {
        text: 'Fourth block',
      },
    },
  ]);

  const firstBlock = getBlockByIndex(page, 0);
  const secondBlock = getBlockByIndex(page, 1);
  const thirdBlock = getBlockByIndex(page, 2);
  const fourthBlock = getBlockByIndex(page, 3);

  // First, select blocks 0-1 via rubber band
  const firstBox = await getRequiredBoundingBox(firstBlock);
  const secondBox = await getRequiredBoundingBox(secondBlock);

  await page.mouse.move(10, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, secondBox.y + secondBox.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 2)).not.toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 3)).not.toHaveAttribute('data-blok-selected', 'true');

  // Now Shift+drag to add blocks 2-3
  const thirdBox = await getRequiredBoundingBox(thirdBlock);
  const fourthBox = await getRequiredBoundingBox(fourthBlock);

  await page.keyboard.down('Shift');
  await page.mouse.move(10, thirdBox.y + thirdBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, fourthBox.y + fourthBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  // All four blocks should now be selected
  await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');
  await expect(getBlockByIndex(page, 3)).toHaveAttribute('data-blok-selected', 'true');
});
```

**Step 3: Run E2E tests**

Run: `yarn e2e test/playwright/tests/modules/selection.spec.ts`

Expected: All tests PASS

**Step 4: Commit**

```bash
git add test/playwright/tests/modules/selection.spec.ts
git commit -m "test: add E2E tests for page-wide rubber band selection"
```

---

## Task 5: Run full test suite and fix any issues

**Step 1: Run linting**

Run: `yarn lint`

Expected: No errors

**Step 2: Run all unit tests**

Run: `yarn test`

Expected: All tests PASS

**Step 3: Build and run E2E tests**

Run: `yarn build:test && yarn e2e`

Expected: All tests PASS

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address test issues from page-wide rubber band selection"
```

---

## Summary of Changes

1. **Moved mousedown listener** from editor container to `document.body` to capture page-wide clicks
2. **Replaced "inside editor" check** with vertical alignment check using `getBoundingClientRect()`
3. **Added shiftKey parameter** to `startSelection()` for additive selection behavior
4. **Updated processMouseDown** to pass `shiftKey` from the mouse event
5. **Added comprehensive tests** for both unit and E2E scenarios

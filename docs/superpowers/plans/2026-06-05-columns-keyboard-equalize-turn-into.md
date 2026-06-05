# Columns: keyboard nav/resize, dblclick-equalize, turn-into-columns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three Notion-parity gaps in the columns tool — keyboard cross-column caret traversal + keyboard-driven resize with ARIA, double-click-to-equalize, and a "Turn into columns" multi-select command.

**Architecture:** Three mostly-independent slices. (1) Resizer enhancements live in `src/tools/columns-shared.ts`; `buildColumnResizers`/`createColumnResizer` gain `api` + `columnListId` so each resizer can equalize (dblclick), resize via keyboard, and expose i18n'd ARIA. (2) Cross-column caret traversal hooks the existing container-exit seam in `src/components/modules/caret.ts` (horizontal `navigateNext`/`navigatePrevious` only — vertical nav untouched). (3) `wrapBlocksInColumns` generalizes the existing `wrapInNewColumnList` primitive in `src/tools/column-drop.ts`, surfaced as a block-settings menu item.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), existing Blok module/tool system, `blok-translations` skill for locale strings.

---

## File Structure

- `src/components/i18n/locales/*/messages.json` — add `tools.columns.resizeAriaLabel`, `tools.columns.turnInto`.
- `src/tools/columns-shared.ts` — thread `api`/`columnListId` into `buildColumnResizers`/`createColumnResizer`; add dblclick-equalize, keyboard resize, ARIA value sync.
- `src/tools/column-list/index.ts` — pass `api` + `this.blockId` to `buildColumnResizers` (two call sites).
- `src/tools/column-drop.ts` — pass `api` + `columnListId` to `buildColumnResizers`; add `wrapBlocksInColumns`.
- `src/components/modules/caret.ts` — add `findAdjacentColumnEdgeBlock`; wire it into `navigateNext`/`navigatePrevious`.
- `src/components/modules/toolbar/blockSettings.ts` — add "Turn into columns" item in the multi-select branch.
- Tests: `test/unit/tools/columns-shared.test.ts`, `test/unit/tools/column-drop.test.ts`, `test/playwright/tests/tools/columns-blocks/{caret-nav-in-column,keyboard-resize-in-column,dblclick-equalize-in-column,turn-into-columns}.spec.ts`.

---

## Task 1: i18n keys

**Files:**
- Modify: `src/components/i18n/locales/en/messages.json` (+ every other locale via skill)

- [ ] **Step 1: Add English keys**

In `src/components/i18n/locales/en/messages.json`, near the existing `tools.columns.col2…col5` keys (around line 113), add:

```json
"tools.columns.resizeAriaLabel": "Resize columns",
"tools.columns.turnInto": "Turn into columns",
```

- [ ] **Step 2: Propagate to all locales via the blok-translations skill**

Invoke the `blok-translations` skill to add translated values for `tools.columns.resizeAriaLabel` and `tools.columns.turnInto` to every locale `messages.json`, then run its validation.

- [ ] **Step 3: Verify lint/types**

Run: `yarn lint`
Expected: PASS (no missing-key or JSON errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/i18n/locales
git commit -m "i18n(columns): add resize aria-label and turn-into-columns strings"
```

---

## Task 2: Fix 3 — double-click divider equalizes widths

Thread `api` + `columnListId` through the resizer builders, then add a `dblclick` handler that calls the existing `resetColumnsToEvenWidth`.

**Files:**
- Modify: `src/tools/columns-shared.ts` (`buildColumnResizers:155`, `createColumnResizer:129`)
- Modify: `src/tools/column-list/index.ts` (`rendered:89`, `seedColumns:129`)
- Modify: `src/tools/column-drop.ts` (`rebuildColumnResizers:18-25`)
- Test: `test/unit/tools/columns-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/tools/columns-shared.test.ts`:

```typescript
import { buildColumnResizers, COLUMN_RESIZER_ATTR } from '../../../src/tools/columns-shared';

describe('column resizer dblclick equalizes widths', () => {
  const makeHolder = (grow: string): HTMLElement => {
    const el = document.createElement('div');

    el.style.flexGrow = grow;

    return el;
  };

  it('double-clicking a resizer resets all sibling columns to even width', () => {
    const left = makeHolder('3');
    const right = makeHolder('1');
    const container = document.createElement('div');

    container.append(left, right);

    // resetColumnsToEvenWidth reads children via api.blocks.getChildren(columnListId)
    const columns = [left, right].map((holder, i) => ({ id: `c${i}`, holder }));
    const getChildren = vi.fn().mockReturnValue(columns);
    const i18n = { t: vi.fn().mockReturnValue('Resize columns') };
    const api = { blocks: { getChildren }, i18n } as unknown as API;

    buildColumnResizers(container, [left, right], false, api, 'cl-1');

    const resizer = container.querySelector(`[${COLUMN_RESIZER_ATTR}]`);

    if (!(resizer instanceof HTMLElement)) {
      throw new Error('resizer not built');
    }

    resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(getChildren).toHaveBeenCalledWith('cl-1');
    expect(left.style.flexGrow).toBe('1');
    expect(right.style.flexGrow).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/columns-shared.test.ts -t "double-clicking a resizer"`
Expected: FAIL — `buildColumnResizers` currently takes 3 args; `COLUMN_RESIZER_ATTR` is not yet exported (or the dblclick does nothing).

- [ ] **Step 3: Export the resizer attr and widen the signatures**

In `src/tools/columns-shared.ts`, export the existing constant:

```typescript
export const COLUMN_RESIZER_ATTR = 'data-blok-column-resizer';
```

Change `createColumnResizer` to accept `api` + `columnListId` and add the dblclick handler:

```typescript
const createColumnResizer = (
  leftHolder: HTMLElement,
  rightHolder: HTMLElement,
  api: API,
  columnListId: string
): HTMLElement => {
  const resizer = document.createElement('div');

  resizer.setAttribute(COLUMN_RESIZER_ATTR, '');
  resizer.setAttribute('data-blok-testid', 'column-resizer');
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');

  resizer.addEventListener('pointerdown', event => {
    startColumnResize(event, resizer, leftHolder, rightHolder);
  });

  // Double-click equalizes every column in the list, à la Notion.
  resizer.addEventListener('dblclick', () => {
    resetColumnsToEvenWidth(api, columnListId);
  });

  return resizer;
};
```

Change `buildColumnResizers` to take and forward `api` + `columnListId`:

```typescript
export const buildColumnResizers = (
  container: HTMLElement,
  holders: HTMLElement[],
  readOnly: boolean,
  api: API,
  columnListId: string
): void => {
  if (readOnly) {
    return;
  }

  container
    .querySelectorAll(`[${COLUMN_RESIZER_ATTR}]`)
    .forEach(resizer => resizer.remove());

  holders.slice(1).forEach((rightHolder, index) => {
    const leftHolder = holders[index];
    const resizer = createColumnResizer(leftHolder, rightHolder, api, columnListId);

    container.insertBefore(resizer, rightHolder);
  });
};
```

- [ ] **Step 4: Update the three call sites**

`src/tools/column-list/index.ts` — `rendered()` (line ~89):

```typescript
    mountChildBlocks(this.container, children);
    buildColumnResizers(this.container, children.map(child => child.holder), this.readOnly, this.api, this.blockId);
```

`src/tools/column-list/index.ts` — `seedColumns()` (line ~129):

```typescript
    buildColumnResizers(container, columns.map(column => column.holder), this.readOnly, this.api, this.blockId);
```

`src/tools/column-drop.ts` — `rebuildColumnResizers()` (lines 18-25):

```typescript
const rebuildColumnResizers = (api: API, columnListId: string): void => {
  const holders = api.blocks.getChildren(columnListId).map(column => column.holder);
  const container = holders[0]?.closest(`[${COLUMNS_ATTR}]`);

  if (container instanceof HTMLElement) {
    buildColumnResizers(container, holders, api.readOnly.isEnabled, api, columnListId);
  }
};
```

- [ ] **Step 5: Run unit test to verify it passes**

Run: `yarn test test/unit/tools/columns-shared.test.ts`
Expected: PASS (new test + all existing `buildColumnResizers`-adjacent tests).

- [ ] **Step 6: Add the e2e**

Create `test/playwright/tests/tools/columns-blocks/dblclick-equalize-in-column.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { createBlok, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

test.describe('double-click divider equalizes column widths', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('an uneven layout returns to equal widths on divider double-click', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: { widthRatio: 3 }, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ],
    });

    const resizer = page.getByTestId('column-resizer').first();

    await resizer.dblclick();

    const grows = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-blok-columns] > [data-blok-element]')
      ).map(el => (el as HTMLElement).style.flexGrow)
    );

    expect(grows).toEqual(['1', '1']);
  });
});
```

- [ ] **Step 7: Run the e2e**

Run: `yarn e2e dblclick-equalize-in-column`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tools/columns-shared.ts src/tools/column-list/index.ts src/tools/column-drop.ts test/unit/tools/columns-shared.test.ts test/playwright/tests/tools/columns-blocks/dblclick-equalize-in-column.spec.ts
git commit -m "feat(columns): double-click a divider to equalize column widths"
```

---

## Task 3: Fix 2B — keyboard resize + i18n ARIA on the separator

The separator is already `role="separator"` + `aria-orientation="vertical"` and now receives `api` (Task 2). Make it focusable, expose `aria-valuemin/max/now` + an i18n `aria-label`, and resize on Arrow/Home/End. Refactor the grow-apply so pointer and keyboard share one routine that also updates `aria-valuenow`.

**Files:**
- Modify: `src/tools/columns-shared.ts`
- Test: `test/unit/tools/columns-shared.test.ts`, new e2e

- [ ] **Step 1: Write the failing unit test**

Append to `test/unit/tools/columns-shared.test.ts`:

```typescript
describe('column resizer keyboard resize + aria', () => {
  // jsdom returns 0 for getBoundingClientRect; stub equal widths so the resize
  // math (width-fraction based) has a non-degenerate pair to redistribute.
  const stubWidth = (el: HTMLElement, width: number): void => {
    el.getBoundingClientRect = () =>
      ({ width, height: 10, top: 0, left: 0, right: width, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  };

  const build = (): { resizer: HTMLElement; left: HTMLElement; right: HTMLElement } => {
    const left = document.createElement('div');
    const right = document.createElement('div');

    left.style.flexGrow = '1';
    right.style.flexGrow = '1';
    stubWidth(left, 200);
    stubWidth(right, 200);

    const container = document.createElement('div');

    container.append(left, right);

    const i18n = { t: vi.fn().mockReturnValue('Resize columns') };
    const api = { blocks: { getChildren: vi.fn() }, i18n } as unknown as API;

    buildColumnResizers(container, [left, right], false, api, 'cl-1');

    const resizer = container.querySelector(`[${COLUMN_RESIZER_ATTR}]`);

    if (!(resizer instanceof HTMLElement)) {
      throw new Error('resizer not built');
    }

    return { resizer, left, right };
  };

  it('exposes an i18n aria-label, slider value bounds, and is focusable', () => {
    const { resizer } = build();

    expect(resizer.getAttribute('aria-label')).toBe('Resize columns');
    expect(resizer.getAttribute('tabindex')).toBe('0');
    expect(resizer.getAttribute('aria-valuemin')).toBe('0');
    expect(resizer.getAttribute('aria-valuemax')).toBe('100');
    expect(resizer.getAttribute('aria-valuenow')).toBe('50');
  });

  it('ArrowRight grows the left column and updates aria-valuenow', () => {
    const { resizer, left, right } = build();

    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(Number(left.style.flexGrow)).toBeGreaterThan(1);
    expect(Number(right.style.flexGrow)).toBeLessThan(1);
    expect(Number(resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  });

  it('ArrowLeft shrinks the left column', () => {
    const { resizer, left } = build();

    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    expect(Number(left.style.flexGrow)).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/columns-shared.test.ts -t "keyboard resize"`
Expected: FAIL — no aria-label/tabindex/aria-valuenow, no keydown handler.

- [ ] **Step 3: Implement aria + shared apply + keyboard handler**

In `src/tools/columns-shared.ts`, add a shared apply helper above `startColumnResize`:

```typescript
/** Update the separator's slider value to the left column's width percentage. */
const updateResizerAria = (
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement
): void => {
  const leftWidth = leftHolder.getBoundingClientRect().width;
  const pairWidth = leftWidth + rightHolder.getBoundingClientRect().width;
  const percent = pairWidth > 0 ? Math.round((leftWidth / pairWidth) * 100) : 50;

  resizer.setAttribute('aria-valuenow', String(percent));
};

/** Apply a px `delta` to the column pair and sync the separator's aria value. */
const applyResizeDelta = (
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement,
  delta: number
): void => {
  const next = resizeColumnGrow({
    leftWidth: leftHolder.getBoundingClientRect().width,
    rightWidth: rightHolder.getBoundingClientRect().width,
    leftGrow: Number(leftHolder.style.flexGrow) || 1,
    rightGrow: Number(rightHolder.style.flexGrow) || 1,
    delta,
    minWidth: COLUMN_MIN_WIDTH,
  });

  leftHolder.style.flexGrow = String(next.leftGrow);
  rightHolder.style.flexGrow = String(next.rightGrow);
  updateResizerAria(resizer, leftHolder, rightHolder);
};

/** Per-press keyboard resize step in px. */
const KEYBOARD_RESIZE_STEP = 16;
```

Update `startColumnResize.onMove` to keep aria in sync (reuse `updateResizerAria`):

```typescript
  const onMove = (moveEvent: PointerEvent): void => {
    const next = resizeColumnGrow({
      leftWidth,
      rightWidth,
      leftGrow,
      rightGrow,
      delta: moveEvent.clientX - startX,
      minWidth: COLUMN_MIN_WIDTH,
    });

    leftEl.style.flexGrow = String(next.leftGrow);
    rightEl.style.flexGrow = String(next.rightGrow);
    updateResizerAria(resizer, leftEl, rightEl);
  };
```

Add a keyboard handler and wire ARIA in `createColumnResizer`:

```typescript
const onResizerKeydown = (
  event: KeyboardEvent,
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement
): void => {
  const pairWidth =
    leftHolder.getBoundingClientRect().width + rightHolder.getBoundingClientRect().width;

  const deltaByKey: Record<string, number> = {
    ArrowLeft: -KEYBOARD_RESIZE_STEP,
    ArrowRight: KEYBOARD_RESIZE_STEP,
    Home: -pairWidth,
    End: pairWidth,
  };

  const delta = deltaByKey[event.key];

  if (delta === undefined) {
    return;
  }

  event.preventDefault();
  applyResizeDelta(resizer, leftHolder, rightHolder, delta);
};

const createColumnResizer = (
  leftHolder: HTMLElement,
  rightHolder: HTMLElement,
  api: API,
  columnListId: string
): HTMLElement => {
  const resizer = document.createElement('div');

  resizer.setAttribute(COLUMN_RESIZER_ATTR, '');
  resizer.setAttribute('data-blok-testid', 'column-resizer');
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('tabindex', '0');
  resizer.setAttribute('aria-label', api.i18n.t('tools.columns.resizeAriaLabel'));
  resizer.setAttribute('aria-valuemin', '0');
  resizer.setAttribute('aria-valuemax', '100');
  updateResizerAria(resizer, leftHolder, rightHolder);

  resizer.addEventListener('pointerdown', event => {
    startColumnResize(event, resizer, leftHolder, rightHolder);
  });

  resizer.addEventListener('keydown', event => {
    onResizerKeydown(event, resizer, leftHolder, rightHolder);
  });

  resizer.addEventListener('dblclick', () => {
    resetColumnsToEvenWidth(api, columnListId);
  });

  return resizer;
};
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `yarn test test/unit/tools/columns-shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the e2e**

Create `test/playwright/tests/tools/columns-blocks/keyboard-resize-in-column.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { createBlok, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

test.describe('keyboard column resize', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('focusing a divider and pressing ArrowRight widens the left column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ],
    });

    const resizer = page.getByTestId('column-resizer').first();

    await resizer.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    const valueNow = Number(await resizer.getAttribute('aria-valuenow'));

    expect(valueNow).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 6: Run the e2e**

Run: `yarn e2e keyboard-resize-in-column`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools/columns-shared.ts test/unit/tools/columns-shared.test.ts test/playwright/tests/tools/columns-blocks/keyboard-resize-in-column.spec.ts
git commit -m "feat(columns): keyboard-resizable dividers with aria slider semantics"
```

---

## Task 4: Fix 2A — cross-column caret traversal

Horizontal arrows now move between sibling columns instead of exiting the whole layout. Vertical arrows (`navigateVertical*`) are untouched, so the vertical caret-nav specs stay green. A structural gate (`column.parentId === containerId`, i.e. a genuine two-level nest) keeps single-level nests like table cells exiting as before.

**Files:**
- Modify: `src/components/modules/caret.ts` (`navigateNext:534-553`, `navigatePrevious:633-652`; new private helper)
- Test (rewrite): `test/playwright/tests/tools/columns-blocks/caret-nav-in-column.spec.ts`

- [ ] **Step 1: Rewrite the two shipped no-teleport specs to assert the NEW behavior**

In `test/playwright/tests/tools/columns-blocks/caret-nav-in-column.spec.ts`, replace test 4 (`ArrowLeft … does not teleport`) and test 5 (`ArrowRight … does not teleport`) with these four tests (two crossing, two edge-exit). Leave tests 1–3 unchanged.

```typescript
  test('ArrowRight at end of a column block moves into the next column', async ({ page }) => {
    // Caret at end of the LEFT column's block; ArrowRight crosses into the RIGHT
    // column's first block (caret at start), Notion-style left-to-right reading.
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    await editableById(page, 'l1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');

    const caret = await expectCaretInBlock(page, 'r1');

    expect(caret.columnIndex).toBe(1);
  });

  test('ArrowLeft at start of a column block moves into the previous column', async ({ page }) => {
    // Caret at start of the RIGHT column's block; ArrowLeft crosses into the LEFT
    // column's last block (caret at end).
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    await editableById(page, 'r1').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');

    const caret = await expectCaretInBlock(page, 'l1');

    expect(caret.columnIndex).toBe(0);
  });

  test('ArrowRight in the RIGHTMOST column exits the layout instead of crossing', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
        { id: 'below', type: 'paragraph', data: { text: 'Root below' } },
      ],
    });

    await editableById(page, 'r1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');

    const caret = await expectCaretInBlock(page, 'below');

    expect(caret.columnIndex).toBeNull();
  });

  test('ArrowLeft in the LEFTMOST column exits the layout instead of crossing', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'above', type: 'paragraph', data: { text: 'Root above' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    await editableById(page, 'l1').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');

    const caret = await expectCaretInBlock(page, 'above');

    expect(caret.columnIndex).toBeNull();
  });
```

- [ ] **Step 2: Run the specs to verify the two crossing tests fail**

Run: `yarn e2e caret-nav-in-column`
Expected: the two "moves into the … column" tests FAIL (caret currently exits the layout, not into the sibling column). Tests 1–3 and the two edge-exit tests PASS.

- [ ] **Step 3: Add the helper in caret.ts**

In `src/components/modules/caret.ts`, add a private method near `resolveContainerToExit` (around line 985):

```typescript
  /**
   * On HORIZONTAL navigation that would exit a column, return the edge block of
   * the adjacent sibling column instead of leaving the whole column_list. Climbs
   * to the column wrapper (the ancestor whose own parent IS the container), finds
   * the sibling column in the travel direction, and returns that sibling's first
   * (next) or last (previous) child block.
   *
   * Returns null when there is no adjacent sibling column, or when the nest is a
   * single-level container (e.g. a table cell, whose block.parentId already
   * equals the container) — those keep exiting via findFirstBlock(After|Before)Parent.
   * @param currentBlock - the block the caret is leaving
   * @param containerId - outermost container resolved for currentBlock
   * @param direction - 'next' for ArrowRight, 'previous' for ArrowLeft
   */
  private findAdjacentColumnEdgeBlock(
    currentBlock: Block,
    containerId: string,
    direction: 'next' | 'previous'
  ): Block | null {
    const getBlockById = this.Blok.BlockManager.getBlockById?.bind(this.Blok.BlockManager);

    if (getBlockById === undefined || currentBlock.parentId === null) {
      return null;
    }

    // Climb to the column wrapper: the ancestor whose parent IS the container.
    let columnId = currentBlock.parentId;
    let column = getBlockById(columnId);

    while (column !== undefined && column.parentId !== null && column.parentId !== containerId) {
      columnId = column.parentId;
      column = getBlockById(columnId);
    }

    // Genuine two-level nest only. A single-level nest (table cell) has
    // column.parentId !== containerId here, so it is rejected and keeps exiting.
    if (column === undefined || column.parentId !== containerId) {
      return null;
    }

    const columns = this.Blok.BlockManager.blocks.filter(block => block.parentId === containerId);
    const ownIndex = columns.findIndex(candidate => candidate.id === columnId);
    const sibling = columns[direction === 'next' ? ownIndex + 1 : ownIndex - 1];

    if (sibling === undefined) {
      return null;
    }

    const siblingChildren = this.Blok.BlockManager.blocks.filter(block => block.parentId === sibling.id);

    return direction === 'next'
      ? (siblingChildren[0] ?? null)
      : (siblingChildren[siblingChildren.length - 1] ?? null);
  }
```

- [ ] **Step 4: Wire it into `navigateNext`**

In `resolveNextAcrossContainer` (line ~546-552), insert the cross-column attempt before the exit:

```typescript
      const containerId = this.resolveContainerToExit(currentBlock.parentId);

      if (!this.shouldExitContainer(currentBlock, nextBlock, containerId)) {
        return nextBlock;
      }

      const adjacentColumnBlock = this.findAdjacentColumnEdgeBlock(currentBlock, containerId, 'next');

      if (adjacentColumnBlock !== null) {
        return adjacentColumnBlock;
      }

      return this.findFirstBlockAfterParent(containerId);
```

- [ ] **Step 5: Wire it into `navigatePrevious`**

In `resolvePreviousAcrossContainer` (line ~645-651):

```typescript
      const containerId = this.resolveContainerToExit(currentBlock.parentId);

      if (!this.shouldExitContainer(currentBlock, previousBlock, containerId)) {
        return previousBlock;
      }

      const adjacentColumnBlock = this.findAdjacentColumnEdgeBlock(currentBlock, containerId, 'previous');

      if (adjacentColumnBlock !== null) {
        return adjacentColumnBlock;
      }

      return this.findFirstBlockBeforeParent(containerId);
```

- [ ] **Step 6: Run the caret specs to verify all pass**

Run: `yarn e2e caret-nav-in-column`
Expected: all tests PASS (crossing + edge-exit + vertical 1–3).

- [ ] **Step 7: Regression — run the other in-column caret/nav specs**

Run: `yarn e2e columns-blocks`
Expected: PASS (no teleport regressions in backspace-merge, enter-split, etc.).

- [ ] **Step 8: Commit**

```bash
git add src/components/modules/caret.ts test/playwright/tests/tools/columns-blocks/caret-nav-in-column.spec.ts
git commit -m "feat(columns): horizontal arrows traverse between sibling columns"
```

---

## Task 5: Fix 4 — `wrapBlocksInColumns` primitive

Generalize `wrapInNewColumnList` (2 columns) to N columns, one selected block per column.

**Files:**
- Modify: `src/tools/column-drop.ts`
- Test: `test/unit/tools/column-drop.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/tools/column-drop.test.ts`:

```typescript
import { wrapBlocksInColumns } from '../../../src/tools/column-drop';

describe('wrapBlocksInColumns', () => {
  it('creates one column per selected block under a new column_list, in order', () => {
    const mock = createMockAPI([
      { id: 'a', parentId: null, index: 2 },
      { id: 'b', parentId: null, index: 3 },
      { id: 'c', parentId: null, index: 4 },
    ]);

    const result = wrapBlocksInColumns(mock.api, ['a', 'b', 'c']);

    expect(mock.transact).toHaveBeenCalledTimes(1);
    // 1 list + 3 columns
    expect(mock.insert).toHaveBeenCalledTimes(4);
    expect(mock.insert.mock.calls[0][0]).toBe(COLUMN_LIST_TOOL);
    expect(mock.insert.mock.calls[0][3]).toBe(2); // list at first block's index
    expect(mock.insert.mock.calls[1][0]).toBe(COLUMN_TOOL);
    expect(mock.insert.mock.calls[2][0]).toBe(COLUMN_TOOL);
    expect(mock.insert.mock.calls[3][0]).toBe(COLUMN_TOOL);

    // each block reparented into its own created column, in selection order
    expect(mock.setBlockParent).toHaveBeenCalledWith('a', 'column-new-2');
    expect(mock.setBlockParent).toHaveBeenCalledWith('b', 'column-new-3');
    expect(mock.setBlockParent).toHaveBeenCalledWith('c', 'column-new-4');

    expect(result).toBe('column_list-new-1');
  });

  it('aborts (returns null, no mutation) for fewer than 2 blocks', () => {
    const mock = createMockAPI([{ id: 'a', parentId: null, index: 0 }]);

    expect(wrapBlocksInColumns(mock.api, ['a'])).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('aborts when any block is not top-level', () => {
    const mock = createMockAPI([
      { id: 'a', parentId: null, index: 0 },
      { id: 'b', parentId: 'some-col', index: 1 },
    ]);

    expect(wrapBlocksInColumns(mock.api, ['a', 'b'])).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('aborts when any block id is stale', () => {
    const mock = createMockAPI([{ id: 'a', parentId: null, index: 0 }]);

    expect(wrapBlocksInColumns(mock.api, ['a', 'ghost'])).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
```

> Note: `insert` ids are `${type}-new-${counter}` (see `createMockAPI`). The list is the 1st insert (`column_list-new-1`); the 3 columns are `column-new-2/3/4`.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/column-drop.test.ts -t "wrapBlocksInColumns"`
Expected: FAIL — `wrapBlocksInColumns` is not exported.

- [ ] **Step 3: Implement the primitive**

In `src/tools/column-drop.ts`, add after `wrapInNewColumnList`:

```typescript
/**
 * Wrap N top-level `blockIds` into a brand new `column_list`, one block per
 * column, preserving selection order. Each block keeps its subtree (children
 * track their parent). All work runs in a single undo entry via `transact`.
 *
 * Aborts (returns null, no mutation) when: fewer than 2 ids, any id is stale
 * (no flat index), or any id is not top-level (already inside a container).
 */
export const wrapBlocksInColumns = (
  api: API,
  blockIds: string[]
): string | null => {
  if (blockIds.length < 2) {
    return null;
  }

  for (const blockId of blockIds) {
    if (api.blocks.getBlockIndex(blockId) === undefined) {
      return null;
    }

    if (api.blocks.getById(blockId)?.parentId !== null) {
      return null;
    }
  }

  const baseIndex = api.blocks.getBlockIndex(blockIds[0]);

  if (baseIndex === undefined) {
    return null;
  }

  const created: { listId: string | null } = { listId: null };

  runTransacted(api, () => {
    const list = api.blocks.insert(COLUMN_LIST_TOOL, { noSeed: true }, {}, baseIndex, false, false);

    created.listId = list.id;

    const columns = blockIds.map((_, i) =>
      api.blocks.insert(COLUMN_TOOL, { noSeed: true }, {}, baseIndex + 1 + i, false, false)
    );

    for (const column of columns) {
      api.blocks.setBlockParent(column.id, list.id);
    }

    blockIds.forEach((blockId, i) => {
      api.blocks.setBlockParent(blockId, columns[i].id);
    });

    // New list: rendered() already fired with zero children, so it never built
    // separators — rebuild the N-1 set and even the widths.
    resetColumnsToEvenWidth(api, list.id);
    rebuildColumnResizers(api, list.id);
  });

  return created.listId;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/column-drop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/column-drop.ts test/unit/tools/column-drop.test.ts
git commit -m "feat(columns): wrapBlocksInColumns primitive for N-block turn-into"
```

---

## Task 6: Fix 4 — "Turn into columns" block-settings item

Surface `wrapBlocksInColumns` in the ☰ menu, visible only when 2+ blocks are selected (mirrors the multi-select delete branch).

**Files:**
- Modify: `src/components/modules/toolbar/blockSettings.ts` (multi-select branch, line ~479-501)
- Test: new e2e `turn-into-columns.spec.ts`

- [ ] **Step 1: Add the menu item in the multi-select branch**

In `src/components/modules/toolbar/blockSettings.ts`, inside the `else` (multi-select) branch that currently pushes only `delete` (around line 481), add the "Turn into columns" item before the delete item:

```typescript
    } else {
      items.push({
        icon: IconColumns,
        title: this.Blok.I18n.t('tools.columns.turnInto'),
        name: 'turn-into-columns',
        closeOnActivate: true,
        onActivate: () => {
          const { BlockSelection, Caret, Toolbar } = this.Blok;
          const api = this.Blok.API.methods;
          const ids = BlockSelection.selectedBlocks.map(selected => selected.id);

          const listId = wrapBlocksInColumns(api, ids);

          if (listId !== null) {
            const firstColumn = api.blocks.getChildren(listId)[0];
            const firstBlock = firstColumn !== undefined
              ? api.blocks.getChildren(firstColumn.id)[0]
              : undefined;

            if (firstBlock !== undefined) {
              Caret.setToBlock(firstBlock.id, Caret.positions.START);
            }
          }

          Toolbar.close();
        },
      });
      items.push({
        icon: IconTrash,
        title: this.Blok.I18n.t('blockSettings.delete'),
        name: 'delete',
        isDestructive: true,
        secondaryLabel: 'Del',
        closeOnActivate: true,
        onActivate: () => {
          const { BlockManager, Caret, Toolbar } = this.Blok;

          const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

          if (insertedBlock) {
            Caret.setToBlock(insertedBlock, Caret.positions.END);
          }

          Toolbar.close();
        },
      });
    }
```

Add the imports at the top of the file (match existing icon/import style — `IconColumns` from the icons barrel, `wrapBlocksInColumns` from the tool):

```typescript
import { IconColumns } from '../../icons';
import { wrapBlocksInColumns } from '../../../tools/column-drop';
```

> If `IconColumns` does not exist in `src/components/icons/index.ts`, add a columns SVG export there and register its name in the `iconGroups` map in `index.html` (per CLAUDE.md icon rule). Reuse the `columnsIcon(2)` shape from `src/tools/column-list/index.ts:23` as the SVG body.

> Verify `Caret.setToBlock` accepts a block id here; if the in-module signature needs a `Block`, resolve via `BlockManager.getBlockById(firstBlock.id)` before the call.

- [ ] **Step 2: Verify types/lint**

Run: `yarn lint`
Expected: PASS (imports resolve, no unused vars, `this.Blok.API.methods` typed).

- [ ] **Step 3: Add the e2e**

Create `test/playwright/tests/tools/columns-blocks/turn-into-columns.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { createBlok, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

test.describe('turn selection into columns', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('selecting 3 blocks and choosing "Turn into columns" wraps them one-per-column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
        { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
        { id: 'c', type: 'paragraph', data: { text: 'Gamma' } },
      ],
    });

    // Select all three blocks (CtrlA twice = select-all blocks in Blok).
    await page.getByText('Alpha').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');

    // Open block settings (☰) and pick the command.
    await page.getByTestId('block-settings').click();
    await page.getByText('Turn into columns').click();

    // One column_list with three columns, each holding one paragraph.
    await expect(page.getByTestId('column-list')).toHaveCount(1);

    const columnCount = await page.evaluate(() =>
      document.querySelectorAll('[data-blok-columns] > [data-blok-column], [data-blok-columns] > [data-blok-element] [data-blok-column]').length
    );

    expect(columnCount).toBe(3);
    await expect(page.getByText('Alpha')).toBeVisible();
    await expect(page.getByText('Beta')).toBeVisible();
    await expect(page.getByText('Gamma')).toBeVisible();
  });

  test('the command is absent for a single-block selection', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Solo' } }],
    });

    await page.getByText('Solo').click();
    await page.getByTestId('block-settings').click();

    await expect(page.getByText('Turn into columns')).toHaveCount(0);
  });
});
```

> If `block-settings` is not the correct test id for the ☰ trigger, locate the trigger via the existing pattern in `block-settings-in-column.spec.ts` and reuse it.

- [ ] **Step 4: Run the e2e**

Run: `yarn e2e turn-into-columns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/toolbar/blockSettings.ts src/components/icons/index.ts index.html test/playwright/tests/tools/columns-blocks/turn-into-columns.spec.ts
git commit -m "feat(columns): 'Turn into columns' command for multi-block selections"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `yarn test`
Expected: PASS.

- [ ] **Run the columns e2e suite**

Run: `yarn e2e columns-blocks`
Expected: PASS.

- [ ] **Lint + types**

Run: `yarn lint`
Expected: PASS.

- [ ] **Update memory**

Update `columns-tool-status.md` to mark SP4 (keyboard nav + a11y) done, and note the new dblclick-equalize and turn-into-columns features.

- [ ] **Push**

```bash
git push
```

---

## Notes & risks

- **Fix 2A intentionally changes shipped behavior.** The two rewritten caret specs are the contract for the new horizontal-arrow semantics. Vertical specs (tests 1–3) must remain untouched and green.
- **No `COLUMN_MIN_WIDTH` change here.** `Home`/`End` keyboard resize collapses to 0 / full because the floor is currently 0 — that is the separate, not-in-scope fix.
- **Core→tool import.** Task 6 imports `wrapBlocksInColumns` into a core module; `column-drop.ts` only depends on `columns-shared` (which imports `type API`), so there is no runtime cycle. `caret.ts` (Task 4) avoids importing tool code entirely by using the structural two-level gate instead of tool-name strings.
- **Nested-column edge:** if an adjacent column's first/last child is itself a `column_list`, the caret lands on that container block; acceptable for now (out of scope).
```

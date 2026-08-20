import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { dragBetweenCharacters, readTextSelectionState } from '../helpers/text-drag';

/**
 * Regression guard for the CLASS of bug fixed for table cells in
 * table-cell-multiline-selection.spec.ts: every nesting tool renders its
 * children as separate contenteditable blocks inside a
 * [data-blok-nested-blocks] container, so no engine will extend a DRAG-driven
 * text selection across the "lines" — CrossBlockSelection has to apply the
 * spanning range itself. These tests pin that behavior for the other
 * nested-blocks containers: callout, toggle, and column.
 *
 * A drag that LEAVES its container is a different gesture and keeps selecting
 * whole blocks (see the column-to-column test) — a merge across containers is
 * refused downstream, so a character range spanning one would not be editable.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const assertBoundingBox = (box: { x: number; y: number; width: number; height: number } | null, label: string): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, data: initialData });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data }
  );
};

/**
 * Drag the mouse from the center of one locator to the center of another.
 */
const dragBetween = async (page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>): Promise<void> => {
  const fromBox = assertBoundingBox(await from.boundingBox(), 'drag start');
  const toBox = assertBoundingBox(await to.boundingBox(), 'drag end');

  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 12 });
  await page.mouse.up();
};

const lineLocator = (page: Page, text: string): ReturnType<Page['locator']> =>
  page.locator('[data-blok-component="paragraph"]', { hasText: text });

const editableOf = (page: Page, text: string): ReturnType<Page['locator']> =>
  lineLocator(page, text).locator('[contenteditable="true"]');

const BLOCK_WRAPPER_SELECTOR = '[data-blok-testid="block-wrapper"]';

/** Drag across a whole line and into `chars` characters of the next one. */
const dragAcrossLines = async (page: Page, fromText: string, toText: string, toOffset: number): Promise<void> => {
  await dragBetweenCharacters(
    page,
    { editable: editableOf(page, fromText),
      offset: 0 },
    { editable: editableOf(page, toText),
      offset: toOffset }
  );
};

test.describe('nested containers — selecting several lines inside one container', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.afterEach(async ({ page }) => {
    await resetBlok(page);
  });

  test('dragging across lines inside a callout selects the text across them', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'ca1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'ca1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'ca1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 'ca1' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const lineTwo = lineLocator(page, 'Line two');

    await expect(lineOne).toBeVisible();

    await dragAcrossLines(page, 'Line one', 'Line two', 'Line two'.length);

    const state = await readTextSelectionState(page, BLOCK_WRAPPER_SELECTOR);

    expect(state.blockTexts).toStrictEqual([ 'Line one', 'Line two' ]);
    expect(state.selectedBlockCount).toBe(0);
    await expect(lineTwo).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(page.locator('[data-blok-component="callout"]')).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('dragging across lines inside an open toggle selects the text across them', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 't1', type: 'toggle', data: { text: 'My toggle', isOpen: true }, content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 't1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 't1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 't1' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const lineTwo = lineLocator(page, 'Line two');

    await expect(lineOne).toBeVisible();

    await dragAcrossLines(page, 'Line one', 'Line two', 'Line two'.length);

    const state = await readTextSelectionState(page, BLOCK_WRAPPER_SELECTOR);

    expect(state.blockTexts).toStrictEqual([ 'Line one', 'Line two' ]);
    expect(state.selectedBlockCount).toBe(0);
    await expect(lineTwo).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('dragging across lines inside one column selects the text across them', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'c1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'c1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right block' }, parent: 'c2' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const lineTwo = lineLocator(page, 'Line two');

    await expect(lineOne).toBeVisible();

    await dragAcrossLines(page, 'Line one', 'Line two', 'Line two'.length);

    const state = await readTextSelectionState(page, BLOCK_WRAPPER_SELECTOR);

    expect(state.blockTexts).toStrictEqual([ 'Line one', 'Line two' ]);
    expect(state.selectedBlockCount).toBe(0);
    await expect(lineTwo).not.toHaveAttribute('data-blok-selected', 'true');
  });

  /**
   * A column and its row are structural containers, never selection units
   * (BlockHoverController.isColumnContainer: "only the blocks inside a column
   * are selectable"). A drag that leaves the column therefore selects the
   * document-order run of blocks it spans across both columns — it used to
   * select nothing at all, because both endpoints resolved up to the same
   * column_list root and the gesture was discarded.
   */
  test('dragging from one column into another selects the run it spans', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1', 'p2'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'c1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right block' }, parent: 'c2' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const rightBlock = lineLocator(page, 'Right block');

    await expect(lineOne).toBeVisible();

    await dragBetween(page, lineOne, rightBlock);

    await expect(lineOne).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineLocator(page, 'Line two')).toHaveAttribute('data-blok-selected', 'true');
    await expect(rightBlock).toHaveAttribute('data-blok-selected', 'true');

    // The layout containers themselves are never part of the selection
    await expect(page.locator('[data-blok-component="column"][data-blok-selected="true"]')).toHaveCount(0);
    await expect(page.locator('[data-blok-component="column_list"][data-blok-selected="true"]')).toHaveCount(0);
  });

  /**
   * Leaving the container is a different gesture: merging across containers is
   * refused downstream, so a character range spanning one could not be edited.
   * Pinned so nobody widens the text path here without deciding to.
   */
  test('dragging from a callout line out to a top-level paragraph selects whole blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'ca1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['p1', 'p2'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'ca1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'ca1' },
        { id: 'after', type: 'paragraph', data: { text: 'After the callout' } },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const after = lineLocator(page, 'After the callout');

    await expect(lineOne).toBeVisible();

    await dragBetween(page, lineOne, after);

    const state = await readTextSelectionState(page, BLOCK_WRAPPER_SELECTOR);

    expect(state.selectedBlockCount).toBeGreaterThan(0);
    await expect(after).toHaveAttribute('data-blok-selected', 'true');
  });

  test('pressing Delete removes the selected callout text but keeps the callout', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'ca1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'ca1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'ca1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 'ca1' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');

    await expect(lineOne).toBeVisible();

    await dragAcrossLines(page, 'Line one', 'Line two', 'Line two'.length);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);

    await page.keyboard.press('Delete');

    const callout = page.locator('[data-blok-component="callout"]');

    await expect(callout).toBeVisible();
    await expect(callout).toContainText('Line three');
    await expect(callout).not.toContainText('Line one');
    await expect(callout).not.toContainText('Line two');

    /**
     * A delete inside a container is where redo has silently died before
     * (transactMoves/reparent-replay): the removals and the merge must come back
     * as ONE undo entry.
     */
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');

    await expect(callout).toContainText('Line one');
    await expect(callout).toContainText('Line two');
    await expect(callout).toContainText('Line three');
  });
});

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { pointAtCharacter, readTextSelectionState } from '../helpers/text-drag';
import type { TextSelectionState } from '../helpers/text-drag';

const HOLDER_ID = 'blok';
const SCROLLER_ID = 'cross-scroll-container';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const BLOCK_COUNT = 40;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Layout = {
  /** Put the editor inside a fixed-height overflow:auto box. */
  container?: boolean;
  /** Put a sticky header above the editor. */
  stickyHeader?: boolean;
  /** Make this block a divider, so a drag across it is a block-level selection. */
  dividerAt?: number;
  /** A common host style: one-viewport-tall html/body, body clipping x. */
  clippedBody?: boolean;
};

/**
 * Builds the page: an optional sticky header, the editor in a narrow column
 * (so a real left gutter exists), optionally inside a scroll box, and a spacer
 * after it so the page can scroll past the last block.
 */
const createBlok = async (page: Page, layout: Layout = {}): Promise<void> => {
  const blocks: OutputData['blocks'] = Array.from({ length: BLOCK_COUNT }, (_, index) => (
    index === layout.dividerAt
      ? { type: 'divider', data: {} }
      : { type: 'paragraph', data: { text: `Block number ${index} with some text here` } }
  ));

  await page.evaluate(async ({ holder, scrollerId, blokBlocks, withContainer, withHeader, withClippedBody }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();
    document.getElementById(scrollerId)?.remove();
    document.querySelectorAll('[data-blok-testid="cross-scroll-fixture"]').forEach((node) => node.remove());

    const fixture = document.createElement('div');

    fixture.setAttribute('data-blok-testid', 'cross-scroll-fixture');
    document.body.appendChild(fixture);

    if (withClippedBody) {
      const style = document.createElement('style');

      style.textContent = 'html, body { height: 100%; } body { overflow-x: hidden; }';
      fixture.appendChild(style);
    }

    if (withHeader) {
      const header = document.createElement('div');

      header.setAttribute('data-blok-testid', 'sticky-header');
      header.style.cssText = 'position:sticky;top:0;height:60px;background:#eee;z-index:5';
      header.textContent = 'sticky header';
      fixture.appendChild(header);
    }

    const editorHolder = document.createElement('div');

    editorHolder.id = holder;
    editorHolder.setAttribute('data-blok-testid', holder);
    editorHolder.style.cssText = 'margin-left:160px;width:560px';

    if (withContainer) {
      const scroller = document.createElement('div');

      scroller.id = scrollerId;
      scroller.setAttribute('data-blok-testid', scrollerId);
      scroller.style.cssText = 'height:400px;overflow:auto;margin-top:40px';
      scroller.appendChild(editorHolder);
      fixture.appendChild(scroller);
    } else {
      fixture.appendChild(editorHolder);
    }

    const spacer = document.createElement('div');

    spacer.style.height = '300px';
    fixture.appendChild(spacer);

    const blok = new window.Blok({
      holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    scrollerId: SCROLLER_ID,
    blokBlocks: blocks,
    withContainer: layout.container === true,
    withHeader: layout.stickyHeader === true,
    withClippedBody: layout.clippedBody === true,
  });
};

const editableByIndex = (page: Page, index: number): Locator => {
  return page.locator(BLOCK_WRAPPER_SELECTOR).nth(index).locator('[contenteditable="true"]');
};

/** Indices of the block wrappers marked selected. */
const selectedIndexes = async (page: Page): Promise<number[]> => {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector)).flatMap((wrapper, index) => {
      return wrapper.getAttribute('data-blok-selected') === 'true' ? [index] : [];
    });
  }, BLOCK_WRAPPER_SELECTOR);
};

const indexRange = (from: number, to: number): number[] => {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
};

const readSelectionState = async (page: Page): Promise<TextSelectionState> => {
  return readTextSelectionState(page, BLOCK_WRAPPER_SELECTOR);
};

/**
 * Index of the block wrapper whose row holds viewport `y`, from wrapper rects
 * alone. Rows clipped by the scroll box are not visible, so `y` is first
 * clamped into the box when there is one.
 */
const rowAt = async (page: Page, y: number): Promise<number> => {
  return page.evaluate(({ selector, pointerY, scrollerId }) => {
    const scroller = document.getElementById(scrollerId);
    const box = scroller?.getBoundingClientRect();
    const clampedY = box === undefined ? pointerY : Math.min(Math.max(pointerY, box.top), box.bottom - 1);
    const wrappers = Array.from(document.querySelectorAll(selector));
    const rects = wrappers.map((wrapper) => wrapper.getBoundingClientRect());
    const inside = rects.findIndex((rect) => rect.top <= clampedY && clampedY < rect.bottom);

    if (inside !== -1) {
      return inside;
    }

    if (clampedY < rects[0].top) {
      return 0;
    }

    return rects.length - 1;
  }, { selector: BLOCK_WRAPPER_SELECTOR, pointerY: y, scrollerId: SCROLLER_ID });
};

/** Lets the engine's own default action on the last input run before reading. */
const nextFrame = async (page: Page): Promise<void> => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  }));
};

/** Press at a character of `from`, then drag over `over`, holding the button. */
const pressAndDragOver = async (page: Page, from: number, over: number): Promise<{ x: number; y: number }> => {
  await editableByIndex(page, from).scrollIntoViewIfNeeded();

  const start = await pointAtCharacter(editableByIndex(page, from), 6);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y, { steps: 2 });

  const end = await pointAtCharacter(editableByIndex(page, over), 6);

  await page.mouse.move(end.x, end.y, { steps: 8 });

  return end;
};

/**
 * Waits until the edge autoscroll has run all the way down. Reading while it
 * still moves races the selection against the geometry.
 */
const waitForAutoscrollToEnd = async (page: Page): Promise<void> => {
  await expect.poll(() => page.evaluate((scrollerId) => {
    const scroller = document.getElementById(scrollerId) ?? document.scrollingElement;

    return scroller === null ? -1 : scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  }, SCROLLER_ID), { timeout: 10_000 }).toBeLessThanOrEqual(1);
  await nextFrame(page);
};

const scrollContent = async (page: Page, deltaY: number, container: boolean): Promise<void> => {
  await page.evaluate(({ dy, scrollerId, inContainer }) => {
    if (inContainer) {
      const scroller = document.getElementById(scrollerId);

      if (scroller !== null) {
        scroller.scrollTop += dy;
      }

      return;
    }

    window.scrollBy(0, dy);
  }, { dy: deltaY, scrollerId: SCROLLER_ID, inContainer: container });
  await nextFrame(page);
  await nextFrame(page);
};

for (const container of [false, true]) {
  const where = container ? 'in an overflow:auto container' : 'in a scrolling window';

  test.describe(`cross-block text selection with scroll ${where}`, () => {
    test.beforeAll(() => {
      ensureBlokBundleBuilt();
    });

    test.beforeEach(async ({ page }) => {
      await gotoTestPage(page);
      await createBlok(page, { container });
    });

    test('content scrolled under a held pointer extends the selection to the row under it', async ({ page }) => {
      const pointer = await pressAndDragOver(page, 2, 5);

      await scrollContent(page, 400, container);

      const expected = await rowAt(page, pointer.y);
      const held = await readSelectionState(page);

      expect(expected).toBeGreaterThan(8);
      expect(held.collapsed).toBe(false);
      expect(held.startBlock).toBe(2);
      expect(held.endBlock).toBe(expected);

      await page.mouse.up();
      await nextFrame(page);

      const released = await readSelectionState(page);

      expect(released.startBlock).toBe(2);
      expect(released.endBlock).toBe(expected);
    });

    test('holding the pointer past the bottom edge autoscrolls and the selection follows', async ({ page }) => {
      await pressAndDragOver(page, 2, 5);

      const edgeY = await page.evaluate((scrollerId) => {
        const scroller = document.getElementById(scrollerId);

        return scroller === null ? window.innerHeight - 2 : scroller.getBoundingClientRect().bottom + 15;
      }, SCROLLER_ID);
      const x = await page.evaluate(() => window.innerWidth / 2);

      await page.mouse.move(x, edgeY, { steps: 5 });

      await waitForAutoscrollToEnd(page);

      const expected = await rowAt(page, edgeY);
      const held = await readSelectionState(page);

      expect(held.startBlock).toBe(2);
      expect(Math.abs(held.endBlock - expected)).toBeLessThanOrEqual(1);
      expect(held.endBlock).toBeGreaterThan(10);

      await page.mouse.up();
    });

    test('wheel scrolling then releasing without moving ends at the row under the pointer', async ({ page }) => {
      const pointer = await pressAndDragOver(page, 2, 5);

      await page.mouse.wheel(0, 400);
      await expect.poll(() => rowAt(page, pointer.y)).toBeGreaterThan(8);

      const expected = await rowAt(page, pointer.y);

      await page.mouse.up();
      await nextFrame(page);

      const released = await readSelectionState(page);

      expect(released.collapsed).toBe(false);
      expect(released.startBlock).toBe(2);
      expect(released.endBlock).toBe(expected);
    });

    test('a pointer in the left gutter selects up to the row level with it', async ({ page }) => {
      await pressAndDragOver(page, 2, 6);

      /** Row 8 stays clear of the scroll box's bottom edge, where the engine autoscrolls. */
      const row = await pointAtCharacter(editableByIndex(page, 8), 6);
      const inGutter = await page.evaluate(({ y, selector }) => {
        return document.elementFromPoint(3, y)?.closest(selector) ?? null;
      }, { y: row.y, selector: BLOCK_WRAPPER_SELECTOR });

      expect(inGutter).toBeNull();

      await page.mouse.move(3, row.y, { steps: 6 });

      const expected = await rowAt(page, row.y);
      const held = await readSelectionState(page);

      expect(expected).toBeGreaterThan(6);
      expect(held.startBlock).toBe(2);
      expect(held.endBlock).toBe(expected);
    });

    test('a backward drag into the left gutter stays anchored at its start', async ({ page }) => {
      await pressAndDragOver(page, 8, 5);

      const row = await pointAtCharacter(editableByIndex(page, 3), 6);

      await page.mouse.move(3, row.y, { steps: 6 });

      const held = await readSelectionState(page);

      expect(held.collapsed).toBe(false);
      expect(held.startBlock).toBe(3);
      expect(held.endBlock).toBe(8);

      await page.mouse.up();
      await nextFrame(page);

      const released = await readSelectionState(page);

      expect(released.startBlock).toBe(3);
      expect(released.endBlock).toBe(8);
    });

    test('a pointer below the last block selects through the end of the last block', async ({ page }) => {
      await pressAndDragOver(page, BLOCK_COUNT - 6, BLOCK_COUNT - 3);

      const last = await editableByIndex(page, BLOCK_COUNT - 1).boundingBox();

      expect(last).not.toBeNull();

      const belowY = (last?.y ?? 0) + (last?.height ?? 0) + 40;
      const below = await page.evaluate(({ y, selector }) => {
        return document.elementFromPoint(window.innerWidth / 2, y)?.closest(selector) ?? null;
      }, { y: belowY, selector: BLOCK_WRAPPER_SELECTOR });

      expect(below).toBeNull();

      await page.mouse.move(400, belowY, { steps: 6 });
      await page.mouse.up();
      await nextFrame(page);

      const released = await readSelectionState(page);

      expect(released.startBlock).toBe(BLOCK_COUNT - 6);
      expect(released.endBlock).toBe(BLOCK_COUNT - 1);
      expect(released.blockTexts.at(-1)).toBe(`Block number ${BLOCK_COUNT - 1} with some text here`);
    });

    test('a press followed by a scroll and a release without moving stays a caret', async ({ page }) => {
      await editableByIndex(page, 2).scrollIntoViewIfNeeded();

      const start = await pointAtCharacter(editableByIndex(page, 2), 6);

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await scrollContent(page, 300, container);
      await page.mouse.up();
      await nextFrame(page);

      const released = await readSelectionState(page);

      /** Block-level selection on a press+scroll belongs to RectangleSelection, not to this gesture. */
      expect(released.startBlock).toBe(released.endBlock);
    });

    test('a block-level drag follows content scrolled under the held pointer', async ({ page }) => {
      await createBlok(page, { container, dividerAt: 4 });

      const pointer = await pressAndDragOver(page, 2, 8);

      expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, 8));

      await scrollContent(page, 400, container);

      const expected = await rowAt(page, pointer.y);

      expect(expected).toBeGreaterThan(12);
      expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));

      await page.mouse.up();
    });

    test('a block-level drag ends at the row under the pointer after a wheel scroll and release', async ({ page }) => {
      await createBlok(page, { container, dividerAt: 4 });

      const pointer = await pressAndDragOver(page, 2, 8);

      await page.mouse.wheel(0, 400);
      await expect.poll(() => rowAt(page, pointer.y)).toBeGreaterThan(12);

      const expected = await rowAt(page, pointer.y);

      await page.mouse.up();
      await nextFrame(page);

      expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));
    });

    test('a block-level drag reaches the row level with a pointer in the left gutter', async ({ page }) => {
      await createBlok(page, { container, dividerAt: 4 });
      await pressAndDragOver(page, 2, 6);

      const row = await pointAtCharacter(editableByIndex(page, 8), 6);

      await page.mouse.move(3, row.y, { steps: 6 });

      const expected = await rowAt(page, row.y);

      expect(expected).toBeGreaterThan(6);
      expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));

      await page.mouse.up();
    });

    test('a block-level drag held past the bottom edge follows the autoscroll', async ({ page }) => {
      await createBlok(page, { container, dividerAt: 4 });
      await pressAndDragOver(page, 2, 6);

      const edgeY = await page.evaluate((scrollerId) => {
        const scroller = document.getElementById(scrollerId);

        return scroller === null ? window.innerHeight - 2 : scroller.getBoundingClientRect().bottom + 15;
      }, SCROLLER_ID);

      await page.mouse.move(400, edgeY, { steps: 5 });

      await waitForAutoscrollToEnd(page);

      const expected = await rowAt(page, edgeY);
      const selected = await selectedIndexes(page);

      expect(selected[0]).toBe(2);
      expect(selected).toStrictEqual(indexRange(2, selected.at(-1) ?? -1));
      expect(Math.abs((selected.at(-1) ?? -1) - expected)).toBeLessThanOrEqual(1);

      await page.mouse.up();
    });
  });
}

type BlockGesture = 'shift' | 'non-text';

/**
 * Start a block-level drag at `from` and move over `over`, holding the button.
 * 'shift' places a caret at `from` and Shift+presses there. 'non-text' presses
 * a divider at `from`, so the drag has no text anchor.
 */
const startBlockDrag = async (
  page: Page,
  gesture: BlockGesture,
  from: number,
  over: number
): Promise<{ x: number; y: number }> => {
  const fromWrapper = page.locator(BLOCK_WRAPPER_SELECTOR).nth(from);

  await fromWrapper.scrollIntoViewIfNeeded();

  let start: { x: number; y: number };

  if (gesture === 'shift') {
    start = await pointAtCharacter(editableByIndex(page, from), 6);
    await page.mouse.click(start.x, start.y);
    await page.keyboard.down('Shift');
  } else {
    const box = await fromWrapper.boundingBox();

    expect(box).not.toBeNull();
    start = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
  }

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y, { steps: 2 });

  const end = await pointAtCharacter(editableByIndex(page, over), 6);

  await page.mouse.move(end.x, end.y, { steps: 8 });

  expect(await selectedIndexes(page)).toStrictEqual(indexRange(Math.min(from, over), Math.max(from, over)));

  return end;
};

const releaseBlockDrag = async (page: Page, gesture: BlockGesture): Promise<void> => {
  await page.mouse.up();

  if (gesture === 'shift') {
    await page.keyboard.up('Shift');
  }

  await nextFrame(page);
};

for (const gesture of ['shift', 'non-text'] as const) {
  for (const container of [false, true]) {
    const what = gesture === 'shift' ? 'a Shift+drag' : 'a drag from a block with no text';
    const where = container ? 'in an overflow:auto container' : 'in a scrolling window';

    test.describe(`${what} with scroll ${where}`, () => {
      const layoutFor = (anchor: number): Layout => ({
        container,
        dividerAt: gesture === 'non-text' ? anchor : undefined,
      });

      test.beforeAll(() => {
        ensureBlokBundleBuilt();
      });

      test.beforeEach(async ({ page }) => {
        await gotoTestPage(page);
      });


      /**
       * After a scroll Chromium fires one synthetic mouseover at the pointer, so
       * the held pointer sits in the gutter, where that mouseover hits no block.
       */
      test('content scrolled under a held pointer in the gutter, then a release without moving, ends at the row under it', async ({ page }) => {
        await createBlok(page, layoutFor(2));

        const pointer = await startBlockDrag(page, gesture, 2, 5);

        await page.mouse.move(3, pointer.y, { steps: 4 });
        await scrollContent(page, 400, container);

        const expected = await rowAt(page, pointer.y);

        expect(expected).toBeGreaterThan(8);
        expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));

        await releaseBlockDrag(page, gesture);

        expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));
      });

      test('a wheel scroll with the pointer in the gutter then a release without moving ends at the row level with it', async ({ page }) => {
        await createBlok(page, layoutFor(2));

        const pointer = await startBlockDrag(page, gesture, 2, 5);

        /** Inside the scroll box (the body margin at x=3 is not), left of the editor column. */
        const wheelX = 80;
        const inGutter = await page.evaluate(({ x, y, selector }) => {
          return document.elementFromPoint(x, y)?.closest(selector) ?? null;
        }, { x: wheelX, y: pointer.y, selector: BLOCK_WRAPPER_SELECTOR });

        expect(inGutter).toBeNull();

        await page.mouse.move(wheelX, pointer.y, { steps: 4 });
        // A wheel with Shift held does not scroll down on Linux CI. Shift only counts at the press.
        if (gesture === 'shift') {
          await page.keyboard.up('Shift');
        }
        await page.mouse.wheel(0, 400);
        await expect.poll(() => rowAt(page, pointer.y)).toBeGreaterThan(8);

        const expected = await rowAt(page, pointer.y);

        await releaseBlockDrag(page, gesture);

        expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));
      });

      test('a pointer in the left gutter selects up to the row level with it', async ({ page }) => {
        await createBlok(page, layoutFor(2));
        await startBlockDrag(page, gesture, 2, 5);

        const row = await pointAtCharacter(editableByIndex(page, 8), 6);
        const inGutter = await page.evaluate(({ y, selector }) => {
          return document.elementFromPoint(3, y)?.closest(selector) ?? null;
        }, { y: row.y, selector: BLOCK_WRAPPER_SELECTOR });

        expect(inGutter).toBeNull();

        await page.mouse.move(3, row.y, { steps: 6 });

        const expected = await rowAt(page, row.y);

        expect(expected).toBe(8);
        expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));

        await releaseBlockDrag(page, gesture);

        expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, expected));
      });

      if (gesture === 'non-text') {
        test('a caret left in another block does not become the anchor of the drag', async ({ page }) => {
          await createBlok(page, layoutFor(2));

          const caret = await pointAtCharacter(editableByIndex(page, 9), 6);

          await page.mouse.click(caret.x, caret.y);
          await startBlockDrag(page, gesture, 2, 5);

          const row = await pointAtCharacter(editableByIndex(page, 7), 6);

          await page.mouse.move(3, row.y, { steps: 6 });
          await releaseBlockDrag(page, gesture);

          expect(await selectedIndexes(page)).toStrictEqual(indexRange(2, 7));
        });
      }

      test('a fast flick below the last block then a release selects through the last block', async ({ page }) => {
        const anchor = BLOCK_COUNT - 6;

        await createBlok(page, layoutFor(anchor));
        await startBlockDrag(page, gesture, anchor, BLOCK_COUNT - 3);

        const last = await page.locator(BLOCK_WRAPPER_SELECTOR).nth(BLOCK_COUNT - 1).boundingBox();

        expect(last).not.toBeNull();

        const belowY = (last?.y ?? 0) + (last?.height ?? 0) + 40;
        const below = await page.evaluate(({ y, selector }) => {
          return document.elementFromPoint(window.innerWidth / 2, y)?.closest(selector) ?? null;
        }, { y: belowY, selector: BLOCK_WRAPPER_SELECTOR });

        expect(below).toBeNull();

        /** One step: a fast flick fires no mouseover on the rows it skips. */
        await page.mouse.move(400, belowY);
        await releaseBlockDrag(page, gesture);

        expect(await selectedIndexes(page)).toStrictEqual(indexRange(anchor, BLOCK_COUNT - 1));
      });
    });
  }
}

test.describe('cross-block text selection leaving the editor upward', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('a backward drag over a sticky header keeps the anchor and reaches the row under the header', async ({ page }) => {
    await createBlok(page, { stickyHeader: true });
    await page.evaluate(() => window.scrollTo(0, 700));
    await nextFrame(page);

    await pressAndDragOver(page, 22, 18);

    const x = (await pointAtCharacter(editableByIndex(page, 18), 6)).x;

    await page.mouse.move(x, 30, { steps: 6 });

    const expected = await rowAt(page, 30);
    const held = await readSelectionState(page);

    expect(held.collapsed).toBe(false);
    expect(held.endBlock).toBe(22);
    expect(Math.abs(held.startBlock - expected)).toBeLessThanOrEqual(1);
    expect(held.startBlock).toBeLessThan(18);

    await page.mouse.up();
    await nextFrame(page);

    const released = await readSelectionState(page);

    expect(released.collapsed).toBe(false);
    expect(released.endBlock).toBe(22);
    expect(released.startBlock).toBe(held.startBlock);
  });

  test('a gutter drag on a page whose body is one viewport tall reaches the row level with the pointer', async ({ page }) => {
    await createBlok(page, { clippedBody: true });
    await page.evaluate(() => window.scrollTo(0, 700));
    await nextFrame(page);

    await pressAndDragOver(page, 22, 24);

    const row = await pointAtCharacter(editableByIndex(page, 28), 6);

    await page.mouse.move(3, row.y, { steps: 6 });

    const expected = await rowAt(page, row.y);
    const held = await readSelectionState(page);

    expect(expected).toBe(28);
    expect(held.startBlock).toBe(22);
    expect(held.endBlock).toBe(28);

    await page.mouse.up();
  });

  test('a backward drag above the editor selects from the start of the first block', async ({ page }) => {
    await createBlok(page);

    await pressAndDragOver(page, 4, 1);

    const top = await page.locator(`[data-blok-testid="${HOLDER_ID}"]`).boundingBox();

    expect(top).not.toBeNull();

    const aboveY = Math.max(2, (top?.y ?? 0) - 10);

    await page.mouse.move(400, aboveY, { steps: 6 });

    const held = await readSelectionState(page);

    expect(held.collapsed).toBe(false);
    expect(held.startBlock).toBe(0);
    expect(held.endBlock).toBe(4);
    expect(held.blockTexts[0]).toBe('Block number 0 with some text here');

    await page.mouse.up();
  });
});

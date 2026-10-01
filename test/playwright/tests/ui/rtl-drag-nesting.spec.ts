import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Direction = 'ltr' | 'rtl';

const BLOCKS: OutputData['blocks'] = [
  { id: 'a', type: 'list', data: { text: 'Head item', style: 'unordered' } },
  { id: 'b', type: 'paragraph', data: { text: 'Spacer paragraph' } },
  { id: 'c', type: 'list', data: { text: 'Mover item', style: 'unordered' } },
];

/**
 * A block takes its direction from its own text, so RTL needs RTL text. An RLM
 * makes the text RTL without changing its width, which the drop line follows.
 */
const RTL_MARK = '\u200F';

const blocksFor = (direction: Direction): OutputData['blocks'] => direction === 'ltr'
  ? BLOCKS
  : BLOCKS.map(block => ({ ...block, data: { ...block.data, text: `${RTL_MARK}${String(block.data.text)}` } }));

type DropResult = {
  /** Resolved `left` / `right` of the blue line and of the gray lead-in. */
  line: [string, string];
  lead: [string, string];
  /** Saved `[text, depth, parent]` rows after the drop. */
  saved: Array<[string, number, string | null]>;
};

/**
 * Drags "Mover item" onto the bottom edge of "Head item" with the pointer
 * `offset` px in from the content's inline-start edge, then drops.
 */
const dropAtOffset = async (page: Page, direction: Direction, offset: number): Promise<DropResult> => {
  await page.evaluate(async ({ dir, blocks }) => {
    const blok = window.blokInstance;

    if (!blok) {
      throw new Error('no editor');
    }

    await blok.i18n.update({ direction: dir });
    await blok.render({ blocks });
  }, { dir: direction, blocks: blocksFor(direction) });

  await page.locator('[data-blok-id="c"]').hover();

  const handle = page.getByTestId('settings-toggler');

  await expect(handle).toBeVisible();

  const handleBox = await handle.boundingBox();
  const geometry = await page.evaluate(() => {
    const head = document.querySelector('[data-blok-id="a"]');
    const content = head?.querySelector('[data-blok-element-content]');

    if (!head || !content) {
      throw new Error('no head block');
    }

    const contentRect = content.getBoundingClientRect();

    return { bottom: head.getBoundingClientRect().bottom, left: contentRect.left, right: contentRect.right };
  });

  if (!handleBox) {
    throw new Error('no handle box');
  }

  const x = direction === 'rtl' ? geometry.right - offset : geometry.left + offset;

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, geometry.bottom - 3, { steps: 15 });
  await page.waitForFunction(() => document.querySelector('[data-blok-id="a"][data-drop-indicator="bottom"]') !== null);

  const indicator = await page.evaluate(() => {
    const el = document.querySelector('[data-blok-id="a"]');

    if (!el) {
      throw new Error('no indicator');
    }

    const line = getComputedStyle(el, '::before');
    const lead = getComputedStyle(el, '::after');

    return { line: [ line.left, line.right ] as [string, string], lead: [ lead.left, lead.right ] as [string, string] };
  });

  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true');

  const saved = await page.evaluate(async (mark) => {
    const output = await window.blokInstance?.save();

    return (output?.blocks ?? []).map((block): [string, number, string | null] => {
      const data = block.data as { text: string; depth?: number };

      return [ data.text.replace(mark, ''), data.depth ?? 0, block.parent ?? null ];
    });
  }, RTL_MARK);

  return { ...indicator, saved };
};

test.describe('RTL drag-to-nest measures from the inline start', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('a drop near the inline start stays at root and a drop one indent in nests, mirrored in RTL', async ({ page }) => {
    await page.evaluate(async ({ holder, blocks }) => {
      document.getElementById(holder)?.remove();

      const container = document.createElement('div');

      container.id = holder;
      container.style.width = '900px';
      document.body.appendChild(container);

      const blok = new window.Blok({ holder, data: { blocks } });

      window.blokInstance = blok;
      await blok.isReady;
    }, { holder: HOLDER_ID, blocks: BLOCKS });

    // LTR first, then flip the same editor: the drag layer is set up on the
    // first drag and must follow the direction change.
    const ltrRoot = await dropAtOffset(page, 'ltr', 6);
    const ltrNested = await dropAtOffset(page, 'ltr', 34);
    const rtlRoot = await dropAtOffset(page, 'rtl', 6);
    const rtlNested = await dropAtOffset(page, 'rtl', 34);

    expect(rtlRoot.saved).toEqual([[ 'Head item', 0, null ], [ 'Mover item', 0, null ], [ 'Spacer paragraph', 0, null ]]);
    expect(rtlNested.saved).toEqual([[ 'Head item', 0, null ], [ 'Mover item', 1, 'a' ], [ 'Spacer paragraph', 0, null ]]);
    expect(ltrRoot.saved).toEqual(rtlRoot.saved);
    expect(ltrNested.saved).toEqual(rtlNested.saved);

    // The line and its gray lead-in mirror: LTR left/right == RTL right/left.
    expect([ rtlRoot.line[1], rtlRoot.line[0] ]).toEqual(ltrRoot.line);
    expect([ rtlRoot.lead[1], rtlRoot.lead[0] ]).toEqual(ltrRoot.lead);
    expect([ rtlNested.line[1], rtlNested.line[0] ]).toEqual(ltrNested.line);
    expect([ rtlNested.lead[1], rtlNested.lead[0] ]).toEqual(ltrNested.lead);
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { DATA_ATTR, createSelector } from '../../../../../src/components/constants';

/**
 * Notion parity (audit M-4): while hovering a vertical drop gap, the cursor's
 * horizontal position chooses the landing nesting depth — drag right to nest one
 * level under the previous list item, keep the cursor at the content's left edge
 * to stay at root. The depth is bounded by `previousDepth + 1`, and dropping far
 * to the right (a plain vertical reorder over the block text) keeps the
 * neighbour-based auto depth rather than max-nesting.
 */

const HOLDER_ID = 'blok';
const INDENT_PER_LEVEL = 27;
const SETTINGS_BUTTON_SELECTOR = `${createSelector(DATA_ATTR.interface)} [data-blok-testid="settings-toggler"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

/**
 * The left edge (viewport px) of the editor content box — the depth-0 anchor the
 * cursor depth is measured from.
 */
const getContentLeft = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('[data-blok-element-content]');

    return el instanceof HTMLElement ? el.getBoundingClientRect().left : 0;
  });

const getBox = async (locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Could not get bounding box');
  }

  return box;
};

/**
 * Pointer-based drag of a block's settings handle onto the BOTTOM edge of a
 * target block, releasing at an explicit absolute X so the cursor's horizontal
 * position controls the landing depth (Notion drag-to-indent).
 */
const dragToBottomEdgeAtX = async (
  page: Page,
  sourceHandle: ReturnType<Page['locator']>,
  targetBlock: ReturnType<Page['locator']>,
  dropX: number
): Promise<void> => {
  const sourceBox = await getBox(sourceHandle);
  const targetBox = await getBox(targetBlock);

  const dropY = targetBox.y + targetBox.height - 1;

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();

  // Move onto the target first (passes the drag threshold), then settle at the
  // chosen horizontal position so the final cursor X decides the depth.
  await page.mouse.move(targetBox.x + targetBox.width / 2, dropY, { steps: 12 });
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');

    return wrapper?.getAttribute('data-blok-dragging') === 'true';
  }, { timeout: 2000 });

  await page.mouse.move(dropX, dropY, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');

    return wrapper?.getAttribute('data-blok-dragging') !== 'true';
  }, { timeout: 2000 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

const seedThreeRootItems = (): OutputData => ({
  blocks: [
    { id: 'first', type: 'list', data: { text: 'First', style: 'unordered' } },
    { id: 'second', type: 'list', data: { text: 'Second', style: 'unordered' } },
    { id: 'third', type: 'list', data: { text: 'Third', style: 'unordered' } },
  ],
}) as OutputData;

const seedParagraphThenBullet = (): OutputData => ({
  blocks: [
    { id: 'para', type: 'paragraph', data: { text: 'Heading para' } },
    { id: 'bullet', type: 'list', data: { text: 'Bullet', style: 'unordered' } },
  ],
}) as OutputData;

test.describe('Notion parity: list drag-to-indent (horizontal motion picks nesting depth)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('dragging right nests the item one level under the previous list item', async ({ page }) => {
    await createBlok(page, seedThreeRootItems());

    const third = page.getByTestId('block-wrapper').filter({ hasText: 'Third' });

    await third.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    const first = page.getByTestId('block-wrapper').filter({ hasText: 'First' });
    const contentLeft = await getContentLeft(page);

    // Cursor ~1.3 indents to the right of the content origin → nests at depth 1.
    await dragToBottomEdgeAtX(page, settingsButton, first, contentLeft + Math.round(1.3 * INDENT_PER_LEVEL));

    const saved = await page.evaluate(() => window.blokInstance?.save());
    const blocks = saved?.blocks ?? [];

    // Order: First, then Third (now nested under First), then Second.
    expect(blocks[0]?.id).toBe('first');
    expect(blocks[1]?.id).toBe('third');
    expect(blocks[2]?.id).toBe('second');

    // Third is structurally nested one level under First.
    const third1 = blocks[1];
    const first0 = blocks[0];

    expect((third1?.data as { depth?: number }).depth).toBe(1);
    expect(third1?.parent).toBe('first');
    expect(first0?.content).toContain('third');
  });

  test('keeping the cursor at the content edge drops the item at root depth', async ({ page }) => {
    await createBlok(page, seedThreeRootItems());

    const third = page.getByTestId('block-wrapper').filter({ hasText: 'Third' });

    await third.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    const first = page.getByTestId('block-wrapper').filter({ hasText: 'First' });
    const contentLeft = await getContentLeft(page);

    // Cursor at the content origin → no nesting, stays at root between First and Second.
    await dragToBottomEdgeAtX(page, settingsButton, first, contentLeft);

    const saved = await page.evaluate(() => window.blokInstance?.save());
    const blocks = saved?.blocks ?? [];

    expect(blocks[0]?.id).toBe('first');
    expect(blocks[1]?.id).toBe('third');
    expect(blocks[2]?.id).toBe('second');

    const third1 = blocks[1];

    // Root level: no parent, depth 0 (the depth key is omitted at root).
    expect(third1?.parent ?? null).toBeNull();
    expect((third1?.data as { depth?: number }).depth ?? 0).toBe(0);
  });

  test('BUG 3: dragging far to the right caps at the deepest legal depth and holds there', async ({ page }) => {
    await createBlok(page, seedThreeRootItems());

    const third = page.getByTestId('block-wrapper').filter({ hasText: 'Third' });

    await third.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    const first = page.getByTestId('block-wrapper').filter({ hasText: 'First' });
    const contentLeft = await getContentLeft(page);

    // Cursor dragged FAR right (5 indents). Max legal depth after First(0) is 1, so
    // the drop must CAP at 1 and HOLD there — not fall through to auto-resolution.
    await dragToBottomEdgeAtX(page, settingsButton, first, contentLeft + 5 * INDENT_PER_LEVEL);

    const saved = await page.evaluate(() => window.blokInstance?.save());
    const blocks = saved?.blocks ?? [];

    expect(blocks[0]?.id).toBe('first');
    expect(blocks[1]?.id).toBe('third');

    const third1 = blocks[1];

    expect((third1?.data as { depth?: number }).depth).toBe(1);
    expect(third1?.parent).toBe('first');
  });

  test('BUG 2: dragging a bullet right nests it under a preceding PARAGRAPH', async ({ page }) => {
    await createBlok(page, seedParagraphThenBullet());

    const bullet = page.getByTestId('block-wrapper').filter({ hasText: 'Bullet' });

    await bullet.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    const para = page.getByTestId('block-wrapper').filter({ hasText: 'Heading para' });
    const contentLeft = await getContentLeft(page);

    // Drag the bullet onto the paragraph's bottom edge, cursor ~1.3 indents right →
    // nests one level UNDER the paragraph (Notion nests under any preceding block).
    await dragToBottomEdgeAtX(page, settingsButton, para, contentLeft + Math.round(1.3 * INDENT_PER_LEVEL));

    const saved = await page.evaluate(() => window.blokInstance?.save());
    const blocks = saved?.blocks ?? [];

    expect(blocks[0]?.id).toBe('para');
    expect(blocks[1]?.id).toBe('bullet');

    const bullet1 = blocks[1];

    // Structurally nested under the paragraph, not fallen back to root.
    expect(bullet1?.parent).toBe('para');
    expect((bullet1?.data as { depth?: number }).depth).toBe(1);
  });
});

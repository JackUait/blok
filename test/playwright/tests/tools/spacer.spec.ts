import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
  saveBlok,
} from './columns-blocks/_helpers';

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const SPACER = '[data-blok-spacer]';
const GRIP = '[data-blok-spacer-grip]';
const BOTTOM_GRIP = '[data-blok-spacer-grip="bottom"]';
const TOP_GRIP = '[data-blok-spacer-grip="top"]';

const spacerFixture: OutputData = {
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'Above spacer.' } },
    { id: 'sp1', type: 'spacer', data: { height: 64 } },
    { id: 'p2', type: 'paragraph', data: { text: 'Below spacer.' } },
  ],
};

const getSpacerHeight = async (page: Page): Promise<number> => {
  return await page.locator(SPACER).evaluate((el) => el.getBoundingClientRect().height);
};

test.describe('Spacer block', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders with the stored height between paragraphs', async ({ page }) => {
    await createBlok(page, spacerFixture);

    await expect(page.getByText('Above spacer.')).toBeVisible();
    await expect(page.getByText('Below spacer.')).toBeVisible();
    await expect(page.locator(SPACER)).toHaveCount(1);
    expect(await getSpacerHeight(page)).toBe(64);
  });

  test('@smoke dragging the grip resizes and the new height is saved', async ({ page }) => {
    await createBlok(page, spacerFixture);

    const spacer = page.locator(SPACER);

    await spacer.hover();
    const gripBox = await page.locator(BOTTOM_GRIP).boundingBox();

    if (!gripBox) {
      throw new Error('missing grip bounding box');
    }

    const startX = gripBox.x + gripBox.width / 2;
    const startY = gripBox.y + gripBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 40, { steps: 10 });
    await page.mouse.up();

    expect(await getSpacerHeight(page)).toBe(104);

    const saved = await saveBlok(page);
    const savedSpacer = saved.blocks.find((block) => block.type === 'spacer');

    expect(savedSpacer?.data).toEqual({ height: 104 });
  });

  test('grip resizes with arrow keys and clamps at the Text-block-height floor', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Reference line.' } },
        { id: 'sp1', type: 'spacer', data: { height: 54 } },
      ],
    });

    const grip = page.locator(BOTTOM_GRIP);

    await grip.focus();
    await page.keyboard.press('ArrowDown');
    expect(await getSpacerHeight(page)).toBe(62);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    // 62 → 54 → 46 → 38, then clamped at the floor
    expect(await getSpacerHeight(page)).toBe(38);

    // The floor is the default Text block height — a spacer can never be
    // thinner than one line of text.
    const paragraphHeight = await page
      .getByText('Reference line.')
      .evaluate((el) => el.getBoundingClientRect().height);

    expect(await getSpacerHeight(page)).toBe(paragraphHeight);

    const saved = await saveBlok(page);
    const savedSpacer = saved.blocks.find((block) => block.type === 'spacer');

    expect(savedSpacer?.data).toEqual({ height: 38 });
  });

  test('dragging the top grip upward grows the spacer', async ({ page }) => {
    await createBlok(page, spacerFixture);

    await page.locator(SPACER).hover();
    const gripBox = await page.locator(TOP_GRIP).boundingBox();

    if (!gripBox) {
      throw new Error('missing top grip bounding box');
    }

    const startX = gripBox.x + gripBox.width / 2;
    const startY = gripBox.y + gripBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 30, { steps: 10 });
    await page.mouse.up();

    expect(await getSpacerHeight(page)).toBe(94);

    const saved = await saveBlok(page);
    const savedSpacer = saved.blocks.find((block) => block.type === 'spacer');

    expect(savedSpacer?.data).toEqual({ height: 94 });
  });

  test('read-only mode renders the gap without a resize grip', async ({ page }) => {
    await createBlok(page, spacerFixture);

    await page.evaluate(async () => {
      await window.blokInstance?.readOnly?.toggle(true);
    });

    await expect(page.locator(SPACER)).toHaveCount(1);
    expect(await getSpacerHeight(page)).toBe(64);
    await expect(page.locator(GRIP)).toHaveCount(0);
  });

  test('spacer inside a column pushes following blocks down and round-trips', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1-p'] },
        { id: 'c1-p', type: 'paragraph', data: { text: 'Tall left column text.' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2-p', 'sp1', 'c2-f'] },
        { id: 'c2-p', type: 'paragraph', data: { text: 'Short right text.' }, parent: 'c2' },
        { id: 'sp1', type: 'spacer', data: { height: 48 }, parent: 'c2' },
        { id: 'c2-f', type: 'paragraph', data: { text: 'Right footer.' }, parent: 'c2' },
      ],
    });

    const columns = page.locator('[data-blok-column]');

    await expect(columns).toHaveCount(2);
    await expect(columns.nth(1).locator(SPACER)).toHaveCount(1);

    // The footer sits below the spacer: its top is at least 48px under the paragraph's bottom.
    const textBox = await page.getByText('Short right text.').boundingBox();
    const footerBox = await page.getByText('Right footer.').boundingBox();

    if (!textBox || !footerBox) {
      throw new Error('missing bounding boxes');
    }
    expect(footerBox.y - (textBox.y + textBox.height)).toBeGreaterThanOrEqual(48);

    const saved = await saveBlok(page);
    const savedSpacer = saved.blocks.find((block) => block.type === 'spacer');

    expect(savedSpacer?.data).toEqual({ height: 48 });
    expect(savedSpacer?.parent).toBe('c2');
  });
});

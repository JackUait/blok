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

  test('inserting from the slash menu creates a visible spacer block', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ id: 'p0', type: 'paragraph', data: { text: '' } }],
    });

    await page.locator('[data-blok-interface=blok] [contenteditable]').first().focus();
    await page.keyboard.type('/spacer');

    const popover = page.getByTestId('toolbox-popover');
    await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
    await popover.locator('[data-blok-item-name="spacer"]').click();

    await expect(page.locator(SPACER)).toHaveCount(1);

    // A freshly inserted spacer must not look like nothing happened: its
    // outline, grips, and readout are revealed outright (not hover-gated).
    const spacer = page.locator(SPACER);

    await expect(spacer).toHaveAttribute('data-blok-spacer-fresh', '');
    expect(await spacer.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');
    expect(await page.locator(BOTTOM_GRIP).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

    // Typing elsewhere puts the chrome back behind the hover gate.
    await page.keyboard.type('next');
    await expect(spacer).not.toHaveAttribute('data-blok-spacer-fresh', '');

    const saved = await saveBlok(page);
    const savedSpacer = saved.blocks.find((block) => block.type === 'spacer');

    expect(savedSpacer?.data).toEqual({ height: 38 });
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

  test('chrome stays visible while dragging even when the pointer leaves the block', async ({ page }) => {
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
    // Drag far below the block — the pointer is no longer over the spacer.
    await page.mouse.move(startX, startY + 200, { steps: 10 });

    await expect(spacer).toHaveAttribute('data-blok-spacer-dragging', '');
    expect(await spacer.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');
    expect(await page.locator(BOTTOM_GRIP).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

    await page.mouse.up();
    await expect(spacer).not.toHaveAttribute('data-blok-spacer-dragging', '');
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

    // Fully invisible in read-only: hovering must not reveal any outline.
    await page.locator(SPACER).hover();
    expect(await page.locator(SPACER).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  });

  test('dragging near a sibling column block end snaps and shows the guideline', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1-a', 'c1-b'] },
        { id: 'c1-a', type: 'paragraph', data: { text: 'Left first line.' }, parent: 'c1' },
        { id: 'c1-b', type: 'paragraph', data: { text: 'Left second line.' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2-p', 'sp1', 'c2-f'] },
        { id: 'c2-p', type: 'paragraph', data: { text: 'Right text.' }, parent: 'c2' },
        { id: 'sp1', type: 'spacer', data: { height: 40 }, parent: 'c2' },
        { id: 'c2-f', type: 'paragraph', data: { text: 'Right footer.' }, parent: 'c2' },
      ],
    });

    const spacer = page.locator(SPACER);
    const spacerBox = await spacer.boundingBox();
    // The alignment we are hunting: the bottom of the LAST block in the left column.
    const leftLast = await page.getByText('Left second line.').boundingBox();

    if (!spacerBox || !leftLast) {
      throw new Error('missing bounding boxes');
    }

    const targetY = leftLast.y + leftLast.height;

    await spacer.hover();
    const gripBox = await page.locator(BOTTOM_GRIP).boundingBox();

    if (!gripBox) {
      throw new Error('missing grip bounding box');
    }

    const startX = gripBox.x + gripBox.width / 2;
    const startY = gripBox.y + gripBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Land 4px shy of the alignment — inside the 6px snap threshold.
    await page.mouse.move(startX, targetY - 4, { steps: 12 });

    // The guideline appears, spanning the column list at the alignment.
    const guide = page.locator('[data-blok-spacer-guide]');

    await expect(guide).toHaveCount(1);

    const guideBox = await guide.boundingBox();

    if (!guideBox) {
      throw new Error('missing guide bounding box');
    }
    expect(Math.abs(guideBox.y - targetY)).toBeLessThanOrEqual(2);

    // It must actually PAINT: the guide sits on <body>, outside the editor's
    // token scope, so a var() background would silently resolve to nothing.
    const paint = await guide.evaluate((el) => {
      const style = getComputedStyle(el);

      return { background: style.backgroundColor, width: el.getBoundingClientRect().width };
    });

    expect(paint.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(paint.background).not.toBe('transparent');
    expect(paint.width).toBeGreaterThan(100);

    // The spacer's bottom edge snapped onto the alignment, not to the pointer.
    const draggedBox = await spacer.boundingBox();

    if (!draggedBox) {
      throw new Error('missing dragged spacer box');
    }
    expect(Math.abs(draggedBox.y + draggedBox.height - targetY)).toBeLessThanOrEqual(1);

    await page.mouse.up();

    // The guide is transient — it belongs to the gesture, not the document.
    await expect(guide).toHaveCount(0);
  });

  test('content pushed down by empty paragraphs still offers its top as a snap target', async ({ page }) => {
    // The shape a user builds by pressing Enter to push a column's text down:
    // the middle column's only visible block sits under two empty paragraphs, so
    // its TOP edge is shared with an empty block. Dropping empty blocks from the
    // targets used to take that edge with them, leaving the visible content with
    // nothing to line up against on the side the eye is drawn to.
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2', 'c3'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1-a'] },
        { id: 'c1-a', type: 'paragraph', data: { text: 'Plan text.' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2-e1', 'c2-e2', 'c2-p'] },
        { id: 'c2-e1', type: 'paragraph', data: { text: '' }, parent: 'c2' },
        { id: 'c2-e2', type: 'paragraph', data: { text: '' }, parent: 'c2' },
        { id: 'c2-p', type: 'paragraph', data: { text: 'Build text.' }, parent: 'c2' },
        { id: 'c3', type: 'column', data: {}, parent: 'cl1', content: ['sp1', 'c3-f'] },
        { id: 'sp1', type: 'spacer', data: { height: 40 }, parent: 'c3' },
        { id: 'c3-f', type: 'paragraph', data: { text: 'Ship footer.' }, parent: 'c3' },
      ],
    });

    const middleContent = page.locator('[data-blok-id="c2-p"]');
    const contentBox = await middleContent.boundingBox();

    if (!contentBox) {
      throw new Error('missing middle content bounding box');
    }

    // The alignment being hunted: where the middle column's visible content STARTS.
    const targetY = contentBox.y;
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
    // Land 4px shy of the alignment — inside the 6px snap threshold.
    await page.mouse.move(startX, targetY - 4, { steps: 12 });

    const guide = page.locator('[data-blok-spacer-guide]');

    await expect(guide).toHaveCount(1);

    const guideBox = await guide.boundingBox();
    const snappedBox = await spacer.boundingBox();

    if (!guideBox || !snappedBox) {
      throw new Error('missing bounding boxes');
    }

    // The guideline sits on the content's top edge, and the spacer's dragged
    // edge snapped onto it — so the footer below now starts level with it.
    expect(Math.abs(guideBox.y - targetY)).toBeLessThanOrEqual(2);
    expect(Math.abs(snappedBox.y + snappedBox.height - targetY)).toBeLessThanOrEqual(1);

    await page.mouse.up();
  });

  test('an empty text block in a sibling column offers no snap target', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1-a', 'c1-empty'] },
        { id: 'c1-a', type: 'paragraph', data: { text: 'Left text.' }, parent: 'c1' },
        // The trailing empty paragraph an Enter press leaves behind.
        { id: 'c1-empty', type: 'paragraph', data: { text: '' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2-p', 'sp1'] },
        { id: 'c2-p', type: 'paragraph', data: { text: 'Right text.' }, parent: 'c2' },
        { id: 'sp1', type: 'spacer', data: { height: 40 }, parent: 'c2' },
      ],
    });

    const emptyBlock = page.locator('[data-blok-id="c1-empty"]');
    const emptyBox = await emptyBlock.boundingBox();

    if (!emptyBox) {
      throw new Error('missing empty block bounding box');
    }

    // Aim the dragged edge right at the empty paragraph's bottom.
    const targetY = emptyBox.y + emptyBox.height;
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
    await page.mouse.move(startX, targetY, { steps: 12 });

    // No guideline: the empty paragraph's bottom is not an alignment worth offering.
    await expect(page.locator('[data-blok-spacer-guide]')).toHaveCount(0);

    await page.mouse.up();
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

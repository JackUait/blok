import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  childrenOf,
  createBlok,
  ensureBlokBundleBuilt,
  reloadFromSave,
  saveBlok,
} from './_helpers';

/**
 * Regression: a block inserted via the slash menu into the MIDDLE of a column
 * (an empty paragraph right under the column's heading, with more content
 * below) must keep that position in the saved output. The real-world report:
 * an image placed right under the title of the first column displayed
 * correctly while editing, but after saving the article it had moved to the
 * very bottom of the column.
 *
 * The pre-existing toolbox-insert suite only proves MEMBERSHIP (`toContain`);
 * this suite pins the ORDER of the column's children.
 */

const TOOLBOX_POPOVER = '[data-blok-testid="toolbox-popover"]';
const TOOLBOX_CONTAINER = `${TOOLBOX_POPOVER} [data-blok-testid="popover-container"]`;
const toolboxItem = (name: string): string =>
  `${TOOLBOX_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`;

/**
 * Mirrors the reported article: the left column has a heading, an EMPTY
 * paragraph right under it (where the user summons the slash menu), then body
 * text and an author line. The right column is a fully-formed reference.
 */
const buildArticleColumns = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1', 'slot', 'body1', 'author1'] },
    { id: 'h1', type: 'header', data: { text: 'Left title', level: 2 }, parent: 'c1' },
    { id: 'slot', type: 'paragraph', data: { text: '' }, parent: 'c1' },
    { id: 'body1', type: 'paragraph', data: { text: 'Left body text' }, parent: 'c1' },
    { id: 'author1', type: 'paragraph', data: { text: 'Author: someone' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['h2', 'body2'] },
    { id: 'h2', type: 'header', data: { text: 'Right title', level: 2 }, parent: 'c2' },
    { id: 'body2', type: 'paragraph', data: { text: 'Right body text' }, parent: 'c2' },
  ],
});

/**
 * Focuses the empty paragraph under the left column's heading and opens the
 * toolbox by typing "/".
 */
const openToolboxInSlot = async (page: Page): Promise<void> => {
  const slotContent = page
    .locator('[data-blok-element][data-blok-id="slot"]')
    .locator('[data-blok-element-content]')
    .first();

  await slotContent.click();
  await page.keyboard.type('/');

  await expect(page.locator(TOOLBOX_CONTAINER)).toBeVisible();
};

/**
 * Returns the ids of the LIVE DOM block holders inside the first column, in
 * visual (document) order.
 */
const domOrderInFirstColumn = async (page: Page): Promise<string[]> => {
  return await page.evaluate(() => {
    const column = document.querySelector('[data-blok-column]');

    if (column === null) {
      return [];
    }

    return Array.from(column.querySelectorAll('[data-blok-element][data-blok-id]'))
      .map((el) => el.getAttribute('data-blok-id'))
      .filter((id): id is string => id !== null);
  });
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Insert order inside a column with existing content', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('an Image inserted right under the column heading stays there in the saved output', async ({ page }) => {
    await createBlok(page, buildArticleColumns());

    await openToolboxInSlot(page);
    await page.locator(toolboxItem('image')).click();

    // The image block replaces the empty paragraph in the live DOM: it renders
    // between the heading and the body text.
    const image = page.locator('[data-blok-tool="image"]');
    await expect(image).toHaveCount(1);

    const saved = await saveBlok(page);
    const imageBlock = saved.blocks.find((block) => block.type === 'image');

    expect(imageBlock).toBeDefined();
    expect(imageBlock?.parent).toBe('c1');

    // ORDER: the image sits right under the heading — NOT at the bottom.
    expect(childrenOf(saved, 'c1')).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);

    // The DOM agrees with the saved order.
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);

    // The right column is untouched.
    expect(childrenOf(saved, 'c2')).toEqual(['h2', 'body2']);

    // And the order survives a save -> reload -> save round-trip.
    const after = await reloadFromSave(page);
    expect(childrenOf(after, 'c1')).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);
  });

  test('the mid-column insert order survives undo -> redo', async ({ page }) => {
    await createBlok(page, buildArticleColumns());

    await openToolboxInSlot(page);
    await page.locator(toolboxItem('image')).click();
    await expect(page.locator('[data-blok-tool="image"]')).toHaveCount(1);

    const isMac = process.platform === 'darwin';
    const undo = isMac ? 'Meta+z' : 'Control+z';
    const redo = isMac ? 'Meta+Shift+z' : 'Control+Shift+z';

    await page.keyboard.press(undo);
    await page.keyboard.press(redo);
    await expect(page.locator('[data-blok-tool="image"]')).toHaveCount(1);

    const saved = await saveBlok(page);
    const imageBlock = saved.blocks.find((block) => block.type === 'image');

    expect(imageBlock?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);
  });

  test('the mid-column insert order survives editing another block before saving', async ({ page }) => {
    await createBlok(page, buildArticleColumns());

    await openToolboxInSlot(page);
    await page.locator(toolboxItem('image')).click();
    await expect(page.locator('[data-blok-tool="image"]')).toHaveCount(1);

    // Type into the right column's body paragraph — "editing elsewhere".
    const rightBody = page
      .locator('[data-blok-element][data-blok-id="body2"]')
      .locator('[data-blok-element-content]')
      .first();

    await rightBody.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — edited later');

    const saved = await saveBlok(page);
    const imageBlock = saved.blocks.find((block) => block.type === 'image');

    expect(imageBlock?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);
  });

  test('an Image dragged from the bottom of a column to right under the heading keeps its new position in the saved output', async ({ page }) => {
    // The image starts at the BOTTOM of the left column (as after a paste), and
    // the user drags it up right under the heading — the other plausible
    // real-world path to the reported layout.
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1', 'body1', 'author1', 'img1'] },
        { id: 'h1', type: 'header', data: { text: 'Left title', level: 2 }, parent: 'c1' },
        { id: 'body1', type: 'paragraph', data: { text: 'Left body text' }, parent: 'c1' },
        { id: 'author1', type: 'paragraph', data: { text: 'Author: someone' }, parent: 'c1' },
        {
          id: 'img1',
          type: 'image',
          data: { url: 'https://placehold.co/600x400.png', alt: 'pic' },
          parent: 'c1',
        },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['h2', 'body2'] },
        { id: 'h2', type: 'header', data: { text: 'Right title', level: 2 }, parent: 'c2' },
        { id: 'body2', type: 'paragraph', data: { text: 'Right body text' }, parent: 'c2' },
      ],
    });

    // Reveal the image block's drag handle by hovering its holder.
    const imageHolder = page.locator('[data-blok-id="img1"]').first();
    const imageBox = await imageHolder.boundingBox();

    if (!imageBox) {
      throw new Error('missing bounding box for image holder');
    }

    await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + 4);

    const handle: Locator = page.locator('[data-blok-interface=blok] [data-blok-testid="settings-toggler"]');
    await expect(handle).toBeVisible();

    const handleBox = await handle.boundingBox();
    const targetBox = await page
      .locator('[data-blok-element][data-blok-id="body1"]')
      .locator('[data-blok-element-content]')
      .first()
      .boundingBox();

    if (!handleBox || !targetBox) {
      throw new Error('missing bounding boxes for drag');
    }

    // Drag onto the TOP edge of body1 → the image lands between h1 and body1.
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 2, { steps: 18 });
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
      { timeout: 2000 }
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
      { timeout: 2000 }
    );
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
      { timeout: 2000 }
    );

    // The DOM shows the image right under the heading…
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', 'img1', 'body1', 'author1']);

    // …and the saved output agrees.
    const saved = await saveBlok(page);

    expect(childrenOf(saved, 'c1')).toEqual(['h1', 'img1', 'body1', 'author1']);

    // The order also survives a save -> reload -> save round-trip.
    const after = await reloadFromSave(page);
    expect(childrenOf(after, 'c1')).toEqual(['h1', 'img1', 'body1', 'author1']);
  });

  test('an image FILE pasted into the empty paragraph under the heading keeps its position in the saved output', async ({ page }) => {
    await createBlok(page, buildArticleColumns());

    // Focus the empty slot paragraph under the left heading.
    const slotContent = page
      .locator('[data-blok-element][data-blok-id="slot"]')
      .locator('[data-blok-element-content]')
      .first();

    await slotContent.click();

    // Paste a real PNG file through the clipboard pipeline.
    await page.evaluate(() => {
      // 1x1 transparent PNG.
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
      const dt = new DataTransfer();

      dt.items.add(file);

      const active = document.activeElement;

      if (!active) {
        throw new Error('nothing focused');
      }
      active.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }));
    });

    await expect(page.locator('[data-blok-tool="image"]')).toHaveCount(1);

    const saved = await saveBlok(page);
    const imageBlock = saved.blocks.find((block) => block.type === 'image');

    expect(imageBlock).toBeDefined();
    expect(imageBlock?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', imageBlock?.id, 'body1', 'author1']);
  });

  test('an image FILE pasted with the caret at the END of the heading lands right under it in the saved output', async ({ page }) => {
    await createBlok(page, buildArticleColumns());

    // Click the heading text and move the caret to its end — the most natural
    // real-world spot to paste a screenshot "right under the title".
    const headingContent = page
      .locator('[data-blok-element][data-blok-id="h1"]')
      .locator('[data-blok-element-content]')
      .first();

    await headingContent.click();
    await page.keyboard.press('End');

    await page.evaluate(() => {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
      const dt = new DataTransfer();

      dt.items.add(file);

      const active = document.activeElement;

      if (!active) {
        throw new Error('nothing focused');
      }
      active.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }));
    });

    await expect(page.locator('[data-blok-tool="image"]')).toHaveCount(1);

    const saved = await saveBlok(page);
    const imageBlock = saved.blocks.find((block) => block.type === 'image');

    expect(imageBlock).toBeDefined();
    expect(imageBlock?.parent).toBe('c1');
    // The heading is NOT empty, so the image is inserted right AFTER it — with
    // the untouched slot/body/author following.
    expect(childrenOf(saved, 'c1')).toEqual(['h1', imageBlock?.id, 'slot', 'body1', 'author1']);
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', imageBlock?.id, 'slot', 'body1', 'author1']);
  });

  test('a block added via the PLUS BUTTON on the column heading lands right under it in the saved output', async ({ page }) => {
    // THE reported bug's path: hover the (non-empty) title of the first column,
    // click the "+" button, pick Image. The plus button creates a fresh empty
    // paragraph for the toolbox: its FLAT index and its DOM position must both
    // be right under the heading — not at the end of the document with the
    // holder visually patched into place.
    await createBlok(page, buildArticleColumns());

    // Hover the heading's own content to surface the per-block "+" button.
    const headingContent = page
      .locator('[data-blok-element][data-blok-id="h1"]')
      .locator('[data-blok-element-content]')
      .first();

    await headingContent.hover();

    const plusButton = page.locator('[data-blok-interface=blok] [data-blok-testid="plus-button"]');
    await expect(plusButton).toBeVisible();
    await plusButton.click();

    await expect(page.locator(TOOLBOX_CONTAINER)).toBeVisible();
    await page.locator(toolboxItem('image')).click();

    await expect(page.locator('[data-blok-tool="image"]')).toHaveCount(1);

    const saved = await saveBlok(page);
    const imageBlock = saved.blocks.find((block) => block.type === 'image');

    expect(imageBlock).toBeDefined();
    // The image belongs to the FIRST column…
    expect(imageBlock?.parent).toBe('c1');
    // …right under the heading — never at the bottom of any column.
    expect(childrenOf(saved, 'c1')).toEqual(['h1', imageBlock?.id, 'slot', 'body1', 'author1']);
    expect(childrenOf(saved, 'c2')).toEqual(['h2', 'body2']);
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', imageBlock?.id, 'slot', 'body1', 'author1']);
  });

  test('the empty paragraph created by the PLUS BUTTON in a column has a consistent model position even if the toolbox is dismissed', async ({ page }) => {
    // If the user dismisses the toolbox and types/pastes into the plus-created
    // paragraph later, its saved position must match where it is displayed.
    await createBlok(page, buildArticleColumns());

    const headingContent = page
      .locator('[data-blok-element][data-blok-id="h1"]')
      .locator('[data-blok-element-content]')
      .first();

    await headingContent.hover();

    const plusButton = page.locator('[data-blok-interface=blok] [data-blok-testid="plus-button"]');
    await expect(plusButton).toBeVisible();
    await plusButton.click();
    await expect(page.locator(TOOLBOX_CONTAINER)).toBeVisible();

    // Dismiss the toolbox by clicking into the freshly created paragraph area,
    // then type real content into it.
    await page.keyboard.type('typed under the title');

    const saved = await saveBlok(page);
    const typed = saved.blocks.find(
      (block) => block.type === 'paragraph' && (block.data as { text?: string }).text === 'typed under the title'
    );

    expect(typed).toBeDefined();
    expect(typed?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['h1', typed?.id, 'slot', 'body1', 'author1']);
    expect(childrenOf(saved, 'c2')).toEqual(['h2', 'body2']);
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', typed?.id, 'slot', 'body1', 'author1']);
  });

  test('a Header inserted mid-column via the slash menu keeps its position in the saved output', async ({ page }) => {
    await createBlok(page, buildArticleColumns());

    await openToolboxInSlot(page);
    await page.locator(toolboxItem('header-3')).click();

    const saved = await saveBlok(page);
    const inserted = saved.blocks.find(
      (block) => block.type === 'header' && block.id !== 'h1' && block.id !== 'h2'
    );

    expect(inserted).toBeDefined();
    expect(inserted?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['h1', inserted?.id, 'body1', 'author1']);
    expect(await domOrderInFirstColumn(page)).toEqual(['h1', inserted?.id, 'body1', 'author1']);
  });
});

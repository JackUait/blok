import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { coverColors } from '../../../../src/components/inline-tools/link-cover';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened="true"]';
const SHELF_SELECTOR = '[data-link-recent-list]';
const SPINE_SELECTOR = '[data-link-recent-row]';
const HEADING_ROW_SELECTOR = '[data-link-heading-row]';
// 1x1 PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const RECENT = [
  { url: 'https://video.example.test/watch?v=1', title: 'Me at the zoo', image: 'https://pics.example.test/cover-a.png' },
  { url: 'https://en.wikipedia.org/wiki/Block_(data_storage)', title: 'Block (data storage)' },
  { url: 'https://docs.example.test/selection', title: 'Selection', image: 'https://pics.example.test/cover-b.png' },
  { url: 'https://example.com/', title: 'Example Domain' },
];

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const openLinkField = async (page: Page, text: string): Promise<Locator> => {
  const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: text });

  await paragraph.evaluate((element, target) => {
    const node = Array.from(element.childNodes).find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(target));

    if (!node) {
      throw new Error(`"${target}" not found`);
    }

    const start = node.textContent?.indexOf(target) ?? 0;
    const range = document.createRange();

    range.setStart(node, start);
    range.setEnd(node, start + target.length);
    (element as HTMLElement).focus();
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, text);
  await page.locator(LINK_BUTTON_SELECTOR).click();

  const input = page.locator(LINK_INPUT_SELECTOR);

  await expect(input).toBeVisible();
  // The menu scales in: measure nothing until the shelf has its full height.
  await expect.poll(async () => (await page.locator(SHELF_SELECTOR).boundingBox())?.height).toBe(112);

  return input;
};

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const rect = await locator.boundingBox();

  if (!rect) {
    throw new Error('element has no box');
  }

  return rect;
};

const css = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

const toRgb = (page: Page, color: string): Promise<string> => page.evaluate((value) => {
  const probe = document.createElement('span');

  probe.style.color = value;
  document.body.append(probe);

  const rgb = getComputedStyle(probe).color;

  probe.remove();

  return rgb;
}, color);

test.describe('link field: shelf of recent links', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.route('https://pics.example.test/**', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }));
    await page.evaluate((entries) => localStorage.setItem('blok-recent-links', JSON.stringify(entries)), RECENT);
    await createBlok(page, [
      { type: 'header', data: { text: 'Pages', level: 2 } },
      { type: 'header', data: { text: 'Ordered List', level: 3 } },
      { type: 'header', data: { text: 'Deep part', level: 4 } },
      { type: 'paragraph', data: { text: 'target words' } },
    ]);
  });

  test.afterEach(async ({ page }) => {
    await page.unroute('https://pics.example.test/**');
    await page.evaluate(() => localStorage.removeItem('blok-recent-links'));
  });

  test('stands four links on a 112px shelf with the first one open at five shares', async ({ page }) => {
    await openLinkField(page, 'target');

    const shelf = page.locator(SHELF_SELECTOR);
    const spines = shelf.locator(SPINE_SELECTOR);

    await expect(spines).toHaveCount(4);
    await expect(spines.first()).toHaveAttribute('data-link-recent-open', '');

    const shelfBox = await box(shelf);
    const share = (shelfBox.width - 3 * 4) / 8;

    expect(shelfBox.height).toBe(112);
    await expect.poll(async () => Math.abs((await box(spines.nth(0))).width - 5 * share)).toBeLessThan(1);
    await expect.poll(async () => Math.abs((await box(spines.nth(1))).width - share)).toBeLessThan(1);

    const [first, second] = [await box(spines.nth(0)), await box(spines.nth(1))];

    expect(Math.abs(second.x - (first.x + first.width) - 4)).toBeLessThan(1);
    expect(first.height).toBe(112);
    await expect(spines.nth(0).locator('[data-link-recent-caption]')).toHaveCSS('opacity', '1');
    await expect(spines.nth(1).locator('[data-link-recent-caption]')).toHaveCSS('opacity', '0');
  });

  test('opens the spine the pointer aims at and keeps it open after the pointer leaves', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const shelf = page.locator(SHELF_SELECTOR);
    const spines = shelf.locator(SPINE_SELECTOR);
    const share = ((await box(shelf)).width - 3 * 4) / 8;

    await spines.nth(2).hover();

    await expect(spines.nth(2)).toHaveAttribute('data-link-recent-open', '');
    await expect(spines.nth(0)).not.toHaveAttribute('data-link-recent-open', '');
    await expect.poll(async () => Math.abs((await box(spines.nth(2))).width - 5 * share)).toBeLessThan(1);
    await expect.poll(async () => Math.abs((await box(spines.nth(0))).width - share)).toBeLessThan(1);
    await expect(spines.nth(2).locator('[data-link-recent-caption]')).toHaveCSS('opacity', '1');
    // Aiming with the pointer does not pick the row: Enter still belongs to the field.
    await expect(spines.nth(2)).toHaveAttribute('aria-selected', 'false');

    await input.hover();
    await expect(spines.nth(2)).toHaveAttribute('data-link-recent-open', '');
  });

  test('draws a link with no picture as its first letter on its own strong color, and no site icon', async ({ page }) => {
    await openLinkField(page, 'target');

    const spines = page.locator(`${SHELF_SELECTOR} ${SPINE_SELECTOR}`);
    const plain = spines.nth(3);
    const letter = plain.locator('[data-link-recent-letter]');
    const colors = coverColors('example.com');

    await plain.hover();

    await expect(letter).toHaveText('E');
    await expect(letter).toHaveCSS('font-size', '156px');
    await expect(letter).toHaveCSS('font-weight', '900');
    await expect(letter).toHaveCSS('color', await toRgb(page, colors.letter));
    await expect(plain.locator('[data-link-recent-cover]')).toHaveCSS('background-color', await toRgb(page, colors.background));
    await expect(plain.locator('[data-link-recent-caption]')).toHaveCSS('color', await toRgb(page, colors.ink));
    await expect(plain.locator('[data-link-recent-caption]')).toHaveCSS('background-image', 'none');
    await expect(plain.locator('[data-link-recent-title]')).toHaveText('Example Domain');
    await expect(plain.locator('[data-link-recent-title]')).toHaveCSS('font-weight', '600');
    await expect(plain.locator('[data-link-recent-picture]')).toHaveCount(0);
    // Two links have a picture; nothing else on the shelf is an image.
    expect(await page.locator(SHELF_SELECTOR).evaluate((shelf) => shelf.querySelectorAll('img').length)).toBe(2);

    // The letter slides aside for the title: its centre sits right of the spine's centre.
    await expect.poll(async () => {
      const [spineBox, letterBox] = [await box(plain), await box(letter)];

      return (letterBox.x + letterBox.width / 2) - (spineBox.x + spineBox.width / 2);
    }).toBeGreaterThan(30);

    // Closed, the letter is centred and the spine shows a slice of it.
    await spines.nth(0).hover();
    await expect.poll(async () => {
      const [spineBox, letterBox] = [await box(plain), await box(letter)];

      return Math.abs((letterBox.x + letterBox.width / 2) - (spineBox.x + spineBox.width / 2));
    }).toBeLessThan(1);
    expect((await box(letter)).width).toBeGreaterThan((await box(plain)).width);
  });

  test('fills a spine with the page picture and writes the title over a scrim', async ({ page }) => {
    await openLinkField(page, 'target');

    const spine = page.locator(`${SHELF_SELECTOR} ${SPINE_SELECTOR}`).first();
    const picture = spine.locator('[data-link-recent-picture]');

    await expect(picture).toHaveAttribute('src', 'https://pics.example.test/cover-a.png');
    await expect(picture).toHaveCSS('object-fit', 'cover');
    await expect.poll(async () => {
      const [spineBox, pictureBox] = [await box(spine), await box(picture)];

      return Math.abs(spineBox.width - pictureBox.width) + Math.abs(spineBox.height - pictureBox.height);
    }).toBeLessThan(1);
    await expect(spine.locator('[data-link-recent-caption]')).toHaveCSS('color', 'rgb(255, 255, 255)');
    expect(await css(spine.locator('[data-link-recent-caption]'), 'background-image')).not.toBe('none');
    await expect(spine.locator('[data-link-recent-letter]')).toHaveCount(0);
  });

  test('shows the Enter chip in the corner of the spine the arrows picked', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const spines = page.locator(`${SHELF_SELECTOR} ${SPINE_SELECTOR}`);

    await input.press('ArrowDown');
    await input.press('ArrowDown');

    const spine = spines.nth(1);
    const chip = spine.locator('[data-link-option-enter-hint]');

    await expect(spine).toHaveAttribute('aria-selected', 'true');
    await expect(spine).toHaveAttribute('data-link-recent-open', '');
    await expect(chip).toBeVisible();
    await expect(spines.nth(0).locator('[data-link-option-enter-hint]')).toBeHidden();
    await expect.poll(async () => {
      const [spineBox, chipBox] = [await box(spine), await box(chip)];

      return Math.abs(spineBox.x + spineBox.width - (chipBox.x + chipBox.width) - 6) + Math.abs(chipBox.y - spineBox.y - 6);
    }).toBeLessThan(1);
    expect((await box(chip)).width).toBe(20);
  });

  test('sets the headings as an outline with no icons, stepped in 16px a level', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const rows = page.locator(HEADING_ROW_SELECTOR);
    const titles = rows.locator('[data-link-heading-title]');

    await expect(titles).toHaveText(['Pages', 'Ordered List', 'Deep part']);
    const tags = rows.locator('[data-link-heading-tag]');

    expect(await tags.evaluateAll((all) => all.map((tag) => getComputedStyle(tag, '::before').content))).toEqual(['"H2"', '"H3"', '"H4"']);
    await expect(tags.first()).toBeVisible();

    const [top, child, deep] = [await box(titles.nth(0)), await box(titles.nth(1)), await box(titles.nth(2))];
    const rowBox = await box(rows.nth(0));

    expect(top.x - rowBox.x).toBe(8);
    expect(child.x - top.x).toBe(16);
    expect(deep.x - child.x).toBe(16);
    expect(rowBox.height).toBe(32);
    await expect(titles.nth(0)).toHaveCSS('font-weight', '650');
    await expect(titles.nth(1)).toHaveCSS('font-weight', '400');
    await expect(titles.nth(2)).toHaveCSS('font-size', '13px');
    // The only drawing in a row is the Enter mark, and it shows on the picked row only.
    expect(await rows.nth(0).evaluate((row) => row.querySelectorAll('svg').length)).toBe(1);
    await expect(rows.nth(0).locator('[data-link-option-enter-hint]')).toBeHidden();

    // The level gives its place to the Enter mark on the picked row.
    for (let step = 0; step < 5; step++) {
      await input.press('ArrowDown');
    }
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(0).locator('[data-link-heading-tag]')).toBeHidden();
    await expect(rows.nth(0).locator('[data-link-option-enter-hint]')).toBeVisible();
    await expect(rows.nth(1).locator('[data-link-heading-tag]')).toBeVisible();
  });

  test('prints the section labels in normal case with no rule under the field', async ({ page }) => {
    await openLinkField(page, 'target');

    const label = page.locator('[data-link-recent-label]');

    await expect(label).toHaveCSS('text-transform', 'none');
    await expect(label).toHaveCSS('font-size', '11px');
    await expect(label).toHaveCSS('font-weight', '600');
    await expect(page.locator('[data-link-headings-label]')).toHaveCSS('text-transform', 'none');
    expect(await page.locator('[data-link-options]').evaluate((options) => Array.from(options.children).every((child) => child.hasAttribute('data-link-group')))).toBe(true);
  });

  test('keeps the field in place while the lists scroll under it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 380 });
    await createBlok(page, [
      ...['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((text) => ({ type: 'header', data: { text, level: 2 } })),
      { type: 'paragraph', data: { text: 'target words' } },
    ]);

    const input = await openLinkField(page, 'target');
    const options = page.locator('[data-link-options]');
    const before = await box(input);

    expect(await options.evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);

    // No native scrollbar lane beside the shelf: the popover draws its own thumb.
    const thumb = page.locator('[data-blok-popover-scrollbar]').last();
    const thumbAtTop = await thumb.evaluate((element) => element.style.transform);

    await expect(options).toHaveCSS('scrollbar-width', 'none');
    expect(await options.evaluate((list) => list.offsetWidth - list.clientWidth)).toBe(0);
    await expect(thumb).toBeVisible();

    for (let step = 0; step < 10; step++) {
      await input.press('ArrowDown');
    }

    const last = page.locator(HEADING_ROW_SELECTOR).last();

    await expect(last).toHaveAttribute('aria-selected', 'true');
    expect(await options.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);

    // The picked row is scrolled fully into the list, and the field has not moved.
    const [listBox, lastBox] = [await box(options), await box(last)];

    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 0.5);
    expect(await box(input)).toEqual(before);
    expect(before.y + before.height).toBeLessThanOrEqual(listBox.y + 0.5);
    expect(await thumb.evaluate((element) => element.style.transform)).not.toBe(thumbAtTop);
    expect(await page.getByTestId('popover-items').last().evaluate((items) => items.scrollTop)).toBe(0);
  });
});

import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expectNoA11yViolations } from '../helpers/a11y';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened="true"]';
const RECENT_ROW_SELECTOR = '[data-link-recent-row]';
const OPTIONS_SELECTOR = '[data-link-options]';
const HEADING_ROW_SELECTOR = '[data-link-heading-row]';

// Four stored, as an older version left them: only three are shown.
const RECENT = [
  { url: 'https://video.example.test/watch?v=1', title: 'Me at the zoo', image: 'https://pics.example.test/cover-a.png', checked: true },
  { url: 'https://video.example.test/', checked: true },
  { url: 'https://en.wikipedia.org/wiki/WYSIWYG', title: 'WYSIWYG', checked: true },
  { url: 'https://example.com/', title: 'Example Domain', checked: true },
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
  // The menu scales in: measure nothing until the field has its full height.
  await expect.poll(async () => (await input.boundingBox())?.height).toBe(32);

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

const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 0.75;

test.describe('link field: recent links as a list', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.evaluate((entries) => localStorage.setItem('blok-recent-links', JSON.stringify(entries)), RECENT);
    await createBlok(page, [
      { type: 'header', data: { text: 'Pages', level: 2 } },
      { type: 'header', data: { text: 'Ordered List', level: 3 } },
      { type: 'header', data: { text: 'Deep part', level: 4 } },
      { type: 'paragraph', data: { text: 'target words' } },
    ]);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('blok-recent-links'));
  });

  test('lists the three newest links as rows that start and end where the field does', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const rows = page.locator(RECENT_ROW_SELECTOR);

    await expect(rows).toHaveCount(3);
    await expect(rows.locator('[data-link-recent-title]')).toHaveText(['Me at the zoo', 'video.example.test', 'WYSIWYG']);

    const field = await box(input);
    const boxes = await Promise.all([0, 1, 2].map((index) => box(rows.nth(index))));

    expect(boxes.every((row) => near(row.x, field.x) && near(row.x + row.width, field.x + field.width))).toBe(true);
    // Two lines with a site under the title, one line without.
    expect(boxes.map((row) => Math.round(row.height))).toEqual([46, 32, 46]);
    expect(near(boxes[1].y, boxes[0].y + boxes[0].height)).toBe(true);
  });

  test('keeps the soft inks readable: no contrast or other serious accessibility failure, at rest or on a picked row', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const card = '[data-blok-popover-container]:has([data-link-field])';

    await expectNoA11yViolations(page, { include: card, label: 'link field list' });

    // The picked row's grey fill is the darkest ground the small text stands on.
    await input.press('ArrowDown');
    await expect(page.locator(RECENT_ROW_SELECTOR).first()).toHaveAttribute('aria-selected', 'true');
    await expectNoA11yViolations(page, { include: card, label: 'link field list, row picked' });
  });

  test('gives the field a filled 32px box and says what it takes', async ({ page }) => {
    const input = await openLinkField(page, 'target');

    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('placeholder', 'Paste link or search pages');
    await expect(input).toHaveCSS('height', '32px');
    await expect(input).toHaveCSS('border-radius', '6px');
    await expect(input).toHaveCSS('background-color', 'rgba(55, 53, 47, 0.08)');
    expect(await input.evaluate((element) => getComputedStyle(element, '::placeholder').color)).toBe('rgba(55, 53, 47, 0.7)');

    const popover = await box(page.locator('[data-blok-popover-container]', { has: input }).last());
    const field = await box(input);

    // The same 8px gutter on every side of the field.
    expect(near(field.x - popover.x, 8)).toBe(true);
    expect(near(popover.x + popover.width - (field.x + field.width), 8)).toBe(true);
    expect(near(field.y - popover.y, 8)).toBe(true);
  });

  test('starts every row with the same grey link sign, drawn 12px wide', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const rows = page.locator(RECENT_ROW_SELECTOR);
    const sign = rows.nth(0).locator('[data-link-recent-icon]');
    const field = await box(input);
    const signBox = await box(sign);
    // The drawn shape without its line thickness: Playwright's own box adds the stroke.
    const ink = await sign.evaluate((element) => {
      const path = element.querySelector('path');
      const rect = path?.getBoundingClientRect();

      return { width: rect?.width ?? 0, height: rect?.height ?? 0, line: path ? getComputedStyle(path).strokeWidth : '' };
    });

    expect([signBox.width, signBox.height].map(Math.round)).toEqual([20, 20]);
    expect(near(signBox.x - field.x, 4)).toBe(true);
    // On the title's line, not the middle of the two-line row.
    expect(near(signBox.y - (await box(rows.nth(0))).y, 5)).toBe(true);
    expect(Math.abs(ink.width - 12)).toBeLessThan(0.3);
    expect(Math.abs(ink.height - 13.2)).toBeLessThan(0.3);
    expect(ink.line).toBe('1.05px');
    await expect(sign).toHaveCSS('color', 'rgba(55, 53, 47, 0.7)');
    expect(await rows.evaluateAll((all) => new Set(all.map((row) => row.querySelector('[data-link-recent-icon]')?.innerHTML)).size)).toBe(1);
    // No picture, no letter, no color of the site: even for a link stored with a picture.
    expect(await page.locator('[data-link-recent]').evaluate((section) => section.querySelectorAll('img, [data-link-recent-cover], [data-link-recent-letter]').length)).toBe(0);
  });

  test('writes the title in soft ink with the site under it in small monospace', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const row = page.locator(RECENT_ROW_SELECTOR).first();
    const title = row.locator('[data-link-recent-title]');
    const meta = row.locator('[data-link-recent-meta]');

    await expect(title).toHaveCSS('color', 'rgb(55, 53, 47)');
    await expect(title).toHaveCSS('font-size', '14px');
    await expect(title).toHaveCSS('line-height', '20px');
    await expect(meta).toHaveText('video.example.test');
    await expect(meta).toHaveCSS('color', 'rgba(55, 53, 47, 0.7)');
    await expect(meta).toHaveCSS('font-size', '10.5px');
    await expect(meta).toHaveCSS('line-height', '16px');
    expect(await css(meta, 'font-family')).toMatch(/mono/i);

    const [field, titleBox, metaBox] = [await box(input), await box(title), await box(meta)];

    // Sign 4px in, 20px wide, 10px gap.
    expect(near(titleBox.x - field.x, 34)).toBe(true);
    expect(near(metaBox.x, titleBox.x)).toBe(true);
    expect(near(metaBox.y, titleBox.y + titleBox.height)).toBe(true);
    await expect(page.locator(RECENT_ROW_SELECTOR).nth(1).locator('[data-link-recent-meta]')).toHaveCount(0);
  });

  test('fills the picked row to the field\'s edges and shows the Enter mark at its end', async ({ page }) => {
    const input = await openLinkField(page, 'target');
    const rows = page.locator(RECENT_ROW_SELECTOR);

    await input.press('ArrowDown');
    await input.press('ArrowDown');

    const row = rows.nth(1);
    const mark = row.locator('[data-link-option-enter-hint]');

    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row).toHaveCSS('background-color', 'rgba(55, 53, 47, 0.08)');
    await expect(row).toHaveCSS('border-radius', '6px');
    await expect(mark).toBeVisible();
    await expect(rows.nth(0).locator('[data-link-option-enter-hint]')).toBeHidden();

    const [rowBox, markBox] = [await box(row), await box(mark)];

    expect(Math.round(markBox.width)).toBe(20);
    expect(near(rowBox.x + rowBox.width - (markBox.x + markBox.width), 8)).toBe(true);
    expect(near(markBox.y + markBox.height / 2, rowBox.y + rowBox.height / 2)).toBe(true);

    // On a two-line row the mark sits in the middle of the row.
    await input.press('ArrowDown');

    const [tall, tallMark] = [await box(rows.nth(2)), await box(rows.nth(2).locator('[data-link-option-enter-hint]'))];

    expect(Math.round(tall.height)).toBe(46);
    expect(near(tallMark.y + tallMark.height / 2, tall.y + tall.height / 2)).toBe(true);
  });

  test('walks the list with the arrows when the field was opened with Cmd+K', async ({ page }) => {
    await page.locator(PARAGRAPH_SELECTOR).evaluate((element) => {
      const range = document.createRange();

      range.selectNodeContents(element);
      (element as HTMLElement).focus();
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.keyboard.press('ControlOrMeta+k');

    const input = page.locator(LINK_INPUT_SELECTOR);
    const rows = page.locator(RECENT_ROW_SELECTOR);

    await expect(input).toBeFocused();
    await expect(rows).toHaveCount(3);

    await page.keyboard.press('ArrowDown');
    await expect(input).toBeVisible();
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeFocused();

    // The card scales in: measure nothing until the field has its full height.
    await expect.poll(async () => (await input.boundingBox())?.height).toBe(32);

    // The same 8px gutters as the card the toolbar button opens.
    const [popover, field] = [await box(page.locator('[data-blok-popover-container]', { has: input }).last()), await box(input)];

    expect(near(field.x - popover.x, 8)).toBe(true);
    expect(near(popover.x + popover.width - (field.x + field.width), 8)).toBe(true);
    expect(near(field.y - popover.y, 8)).toBe(true);
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

    expect(top.x - rowBox.x).toBe(4);
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
    for (let step = 0; step < 4; step++) {
      await input.press('ArrowDown');
    }
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(0).locator('[data-link-heading-tag]')).toBeHidden();
    await expect(rows.nth(0).locator('[data-link-option-enter-hint]')).toBeVisible();
    await expect(rows.nth(1).locator('[data-link-heading-tag]')).toBeVisible();
  });

  test('prints the section labels in normal case, 4px in from the field\'s edge', async ({ page }) => {
    const input = await openLinkField(page, 'target');

    const label = page.locator('[data-link-recent-label]');

    await expect(label).toHaveText('Recents');
    await expect(label).toHaveCSS('text-transform', 'none');
    await expect(label).toHaveCSS('letter-spacing', 'normal');
    await expect(label).toHaveCSS('font-size', '12px');
    await expect(label).toHaveCSS('font-weight', '500');
    await expect(label).toHaveCSS('color', 'rgba(55, 53, 47, 0.7)');
    await expect(label).toHaveCSS('padding', '8px 4px 6px');

    const [field, labelBox, headings] = [await box(input), await box(label), await box(page.locator('[data-link-headings-label]'))];
    const lastRecent = await box(page.locator(RECENT_ROW_SELECTOR).last());

    expect(near(labelBox.x, field.x)).toBe(true);
    // 8px under the field, and 8px between a section and the next label.
    expect(near(labelBox.y - (field.y + field.height), 8)).toBe(true);
    expect(near(headings.y - (lastRecent.y + lastRecent.height), 8)).toBe(true);
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

    // No native scrollbar lane beside the list: the popover draws its own thumb.
    const thumb = page.locator('[data-blok-popover-scrollbar]').last();
    const thumbAtTop = await thumb.evaluate((element) => element.style.transform);

    await expect(options).toHaveCSS('scrollbar-width', 'none');
    expect(await options.evaluate((list) => list instanceof HTMLElement ? list.offsetWidth - list.clientWidth : null)).toBe(0);
    await expect(thumb).toBeVisible();

    // At its top the list fades at the bottom only, and ends 22px under a whole row.
    await expect(options).toHaveAttribute('data-link-more-down', '');
    await expect(options).not.toHaveAttribute('data-link-more-up', '');
    expect(await css(options, 'mask-image')).not.toBe('none');

    const atTop = await box(options);
    const bottoms = await page.locator(`${OPTIONS_SELECTOR} [role="option"]`).evaluateAll((all) => all.map((row) => row.getBoundingClientRect().bottom));
    const lastWhole = Math.max(...bottoms.filter((bottom) => bottom <= atTop.y + atTop.height + 0.5));

    expect(near(atTop.y + atTop.height - lastWhole, 22)).toBe(true);

    // It scrolls up and down only: a sideways swipe finds nothing to move.
    await expect(options).toHaveCSS('overflow-x', 'hidden');
    await expect(options).toHaveCSS('overscroll-behavior-x', 'none');
    expect(await options.evaluate((list) => list.scrollWidth - list.clientWidth)).toBe(0);

    // A row picked with the arrows stops 28px short of the bottom edge, clear of the fade.
    const picked = page.locator(`${OPTIONS_SELECTOR} [role="option"][aria-selected="true"]`);
    const rowCount = await page.locator(`${OPTIONS_SELECTOR} [role="option"]`).count();
    const scrollTop = (): Promise<number> => options.evaluate((list) => list.scrollTop);

    for (let step = 0; step < rowCount && await scrollTop() === 0; step++) {
      await input.press('ArrowDown');
    }

    expect(await scrollTop()).toBeGreaterThan(0);
    await expect(options).toHaveAttribute('data-link-more-up', '');

    const [scrolled, pickedBox] = [await box(options), await box(picked)];

    expect(near(scrolled.y + scrolled.height - (pickedBox.y + pickedBox.height), 28)).toBe(true);

    for (let step = 0; step < rowCount; step++) {
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

  test('shows no scrollbar once a typed link replaces the long list', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 380 });
    await createBlok(page, [
      ...['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((text) => ({ type: 'header', data: { text, level: 2 } })),
      { type: 'paragraph', data: { text: 'target words' } },
    ]);

    const input = await openLinkField(page, 'target');
    const thumb = page.locator('[data-blok-popover-scrollbar]').last();

    await expect(thumb).toBeVisible();

    await input.fill('https://www.example.com/page');

    await expect(page.locator('[data-link-suggestion-row]')).toBeVisible();
    await expect(page.locator(OPTIONS_SELECTOR)).toBeHidden();
    await expect(thumb).toBeHidden();

    // Back to the long list: the bar comes back with it.
    await input.fill('');
    await expect(thumb).toBeVisible();
  });
});

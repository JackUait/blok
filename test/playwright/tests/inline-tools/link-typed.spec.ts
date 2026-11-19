import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened="true"]';
const ROW_SELECTOR = '[data-link-suggestion-row]';
const ERROR_SELECTOR = '[data-blok-link-tool-error]';

type Box = { x: number; y: number; width: number; height: number };

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

// One evaluate per measurement: separate boundingBox calls race the reveal.
const boxes = (page: Page, selectors: Record<string, string>): Promise<Record<string, Box>> =>
  page.evaluate((map) => Object.fromEntries(Object.entries(map).map(([name, selector]) => {
    const all = document.querySelectorAll(selector);
    const element = all[all.length - 1];

    if (!element) {
      throw new Error(`${selector} not found`);
    }

    const rect = element.getBoundingClientRect();

    return [name, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
  })), selectors);

const settled = async (page: Page, selector: string): Promise<void> => {
  await expect.poll(() => page.locator(selector).last().evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
};

const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 0.75;

test.describe('link field: the row under a typed address', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page, [{ type: 'paragraph', data: { text: 'target words' } }]);
  });

  test('sits 8px under the field, edge to edge with it, 46px tall, lit, with no line and no Enter mark', async ({ page }) => {
    const input = await openLinkField(page, 'target');

    await input.fill('https://www.twitch.tv/ohnepixel');

    const row = page.locator(ROW_SELECTOR);

    await expect(row).toBeVisible();
    await settled(page, '[data-link-suggestion]');

    const b = await boxes(page, {
      field: LINK_INPUT_SELECTOR,
      row: ROW_SELECTOR,
      icon: '[data-link-suggestion-icon]',
      svg: '[data-link-suggestion-icon] svg',
      url: '[data-link-suggestion-url]',
      type: '[data-link-suggestion-type]',
      card: '[data-blok-popover-container]:has([data-link-field])',
    });

    expect(near(b.row.y - (b.field.y + b.field.height), 8)).toBe(true);
    expect(near(b.row.x, b.field.x)).toBe(true);
    expect(near(b.row.width, b.field.width)).toBe(true);
    expect(near(b.row.height, 46)).toBe(true);
    // The 24px sign box is centred on the first line, not on the row.
    expect(near(b.icon.width, 24)).toBe(true);
    expect(near(b.icon.height, 24)).toBe(true);
    expect(near(b.icon.x - b.row.x, 2)).toBe(true);
    expect(near(b.icon.y + b.icon.height / 2, b.url.y + b.url.height / 2)).toBe(true);
    expect(near(b.svg.width, 16)).toBe(true);
    expect(near(b.url.x - b.row.x, 34)).toBe(true);
    expect(near(b.url.y - b.row.y, 5)).toBe(true);
    expect(near(b.url.height, 20)).toBe(true);
    expect(near(b.type.y, b.url.y + b.url.height)).toBe(true);
    expect(near(b.type.height, 16)).toBe(true);
    // The card ends 8px under the row.
    expect(near(b.card.y + b.card.height - (b.row.y + b.row.height), 8)).toBe(true);
    expect(near(b.field.y - b.card.y, 8)).toBe(true);
    expect(near(b.field.x - b.card.x, 8)).toBe(true);
    expect(near(b.card.width, 332)).toBe(true);

    await expect(page.locator('[data-link-suggestion-url]')).toHaveCSS('font-size', '14px');
    await expect(page.locator('[data-link-suggestion-url]')).toHaveCSS('font-weight', '400');
    await expect(page.locator('[data-link-suggestion-type]')).toHaveCSS('font-size', '12px');
    await expect(page.locator('[data-link-suggestion-type]')).toHaveText('Link to web page');

    // Lit like a row picked with the arrows; one svg in the row, the sign.
    const hover = await page.locator('[data-link-field]').evaluate((element) => {
      const probe = document.createElement('div');

      probe.style.backgroundColor = 'var(--blok-item-hover-bg)';
      element.append(probe);

      const color = getComputedStyle(probe).backgroundColor;

      probe.remove();

      return color;
    });

    await expect(row).toHaveCSS('background-color', hover);
    expect(await row.evaluate((element) => ({
      signs: element.querySelectorAll('svg').length,
      partsOfTheSuggestion: element.parentElement?.childElementCount,
    }))).toEqual({ signs: 1, partsOfTheSuggestion: 1 });
  });

  test('is not lit while the address is half typed, and keeps its size', async ({ page }) => {
    const input = await openLinkField(page, 'target');

    await input.fill('twitch');

    const row = page.locator(ROW_SELECTOR);

    await expect(row).toBeVisible();
    await settled(page, '[data-link-suggestion]');

    const b = await boxes(page, { field: LINK_INPUT_SELECTOR, row: ROW_SELECTOR });

    await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('[data-link-suggestion-type]')).toHaveText('Keep typing to add link');
    expect(near(b.row.height, 46)).toBe(true);
    expect(near(b.row.y - (b.field.y + b.field.height), 8)).toBe(true);
  });

  test('a refused address keeps the row and the card height: red sign and title, the reason under it', async ({ page }) => {
    const input = await openLinkField(page, 'target');

    await input.fill('https://www.twitch.tv/ohnepixel');
    await expect(page.locator(ROW_SELECTOR)).toBeVisible();
    await settled(page, '[data-link-suggestion]');

    const whole = await boxes(page, { card: '[data-blok-popover-container]:has([data-link-field])', row: ROW_SELECTOR });

    await input.fill('https://www.twitch.tv/ohne pixel');
    await input.press('Enter');

    const error = page.locator(ERROR_SELECTOR);

    await expect(error).toBeVisible();
    await expect(page.locator(ROW_SELECTOR)).toBeHidden();
    await settled(page, ERROR_SELECTOR);

    const b = await boxes(page, {
      field: LINK_INPUT_SELECTOR,
      error: ERROR_SELECTOR,
      icon: `${ERROR_SELECTOR} [data-link-error-icon]`,
      svg: `${ERROR_SELECTOR} svg`,
      title: '[data-link-error-title]',
      reason: '[data-link-error-reason]',
      card: '[data-blok-popover-container]:has([data-link-field])',
    });

    expect(near(b.error.y - (b.field.y + b.field.height), 8)).toBe(true);
    expect(near(b.error.x, b.field.x)).toBe(true);
    expect(near(b.error.width, b.field.width)).toBe(true);
    expect(near(b.error.height, 46)).toBe(true);
    expect(near(b.card.height, whole.card.height)).toBe(true);
    expect(near(b.card.y + b.card.height - (b.error.y + b.error.height), 8)).toBe(true);
    expect(near(b.icon.x - b.error.x, 2)).toBe(true);
    expect(near(b.icon.width, 24)).toBe(true);
    expect(near(b.icon.y + b.icon.height / 2, b.title.y + b.title.height / 2)).toBe(true);
    expect(near(b.svg.width, 16)).toBe(true);
    expect(near(b.title.x - b.error.x, 34)).toBe(true);
    expect(near(b.title.y - b.error.y, 5)).toBe(true);
    expect(near(b.reason.y, b.title.y + b.title.height)).toBe(true);

    const danger = await page.locator('[data-link-field]').evaluate((element) => {
      const probe = document.createElement('div');

      probe.style.color = 'var(--blok-color-danger)';
      element.append(probe);

      const color = getComputedStyle(probe).color;

      probe.remove();

      return color;
    });

    await expect(page.locator('[data-link-error-title]')).toHaveText('Invalid link');
    await expect(page.locator('[data-link-error-title]')).toHaveCSS('color', danger);
    await expect(page.locator('[data-link-error-title]')).toHaveCSS('font-size', '14px');
    await expect(page.locator(`${ERROR_SELECTOR} [data-link-error-icon]`)).toHaveCSS('color', danger);
    await expect(page.locator('[data-link-error-reason]')).toHaveText('An address cannot have spaces');
    await expect(page.locator('[data-link-error-reason]')).toHaveCSS('font-size', '12px');
    await expect(page.locator('[data-link-error-reason]')).not.toHaveCSS('color', danger);
    await expect(error).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
});

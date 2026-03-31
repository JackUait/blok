// test/playwright/tests/tools/callout.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const CALLOUT_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="callout"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

const createCalloutData = (overrides = {}): OutputData => ({
  blocks: [{ type: 'callout', data: { emoji: '💡', color: 'default', ...overrides } }],
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test('creates callout via slash menu and shows default emoji', async ({ page }) => {
  await createBlok(page);
  const defaultParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`);
  await defaultParagraph.click();
  await page.keyboard.type('/callout', { delay: 50 });
  const calloutItem = page.locator('[data-blok-item-name="callout"]');
  await expect(calloutItem).toBeVisible();
  await calloutItem.click();
  await expect(page.locator(CALLOUT_BLOCK_SELECTOR)).toBeVisible();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText('💡');
});

test('renders callout with auto-created first child paragraph', async ({ page }) => {
  await createBlok(page, createCalloutData());
  await expect(page.locator(CALLOUT_BLOCK_SELECTOR)).toBeVisible();
  // The callout should contain a child paragraph block inside the children container
  const childBlock = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"]`);
  await expect(childBlock).toBeVisible();
});

test('opens emoji picker on emoji button click', async ({ page }) => {
  await createBlok(page, createCalloutData());
  await page.getByTestId('callout-emoji-btn').click();
  await expect(page.locator('[data-emoji-picker-body]')).toBeVisible();
});

test('selects emoji from picker and updates button', async ({ page }) => {
  await createBlok(page, createCalloutData());
  await page.getByTestId('callout-emoji-btn').click();
  await expect(page.locator('[data-emoji-picker-body]')).toBeVisible();
  const targetEmoji = page.locator('[data-emoji-native="👉"]');
  const emojiChar = await targetEmoji.getAttribute('data-emoji-native');
  await targetEmoji.click();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText(emojiChar ?? '');
});

test('removes emoji via Remove button', async ({ page }) => {
  await createBlok(page, createCalloutData({ emoji: '💡' }));
  await page.getByTestId('callout-emoji-btn').click();
  await expect(page.locator('[data-emoji-picker-remove]')).toBeVisible();
  await page.locator('[data-emoji-picker-remove]').click();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText('');
});

test('closes emoji picker on Escape', async ({ page }) => {
  await createBlok(page, createCalloutData());
  await page.getByTestId('callout-emoji-btn').click();
  await expect(page.locator('[data-emoji-picker-body]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-emoji-picker-body]')).not.toBeVisible();
});

test('applies color from block settings menu', async ({ page }) => {
  await createBlok(page, createCalloutData());
  // Click the child paragraph to focus the callout, then hover to reveal toolbar
  const childEditable = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"] [contenteditable]`);
  await childEditable.click();
  const wrapper = page.locator(CALLOUT_BLOCK_SELECTOR);
  await wrapper.hover();
  const settingsBtn = page.getByTestId('settings-toggler');
  await expect(settingsBtn).toBeVisible();
  await settingsBtn.click();
  await page.getByText('Color').click();
  await page.getByTestId('callout-color-swatch-background-color-blue').click();
  await expect(wrapper).toHaveCSS('background-color', /rgb/);
});

test('child blocks support inline tool formatting', async ({ page }) => {
  await createBlok(page, createCalloutData());
  const childEditable = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"] [contenteditable]`);
  await childEditable.click();
  await page.keyboard.type('hello');
  await page.keyboard.press(`${MODIFIER_KEY}+A`);
  await page.keyboard.press(`${MODIFIER_KEY}+B`);
  const hasBold = await childEditable.evaluate((el) => el.querySelector('b, strong') !== null);
  expect(hasBold).toBe(true);
});

test('Enter in child block creates another child block', async ({ page }) => {
  await createBlok(page, createCalloutData());
  const childEditable = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-component="paragraph"] [contenteditable]`);
  await childEditable.click();
  await page.keyboard.type('first line');
  await page.keyboard.press('Enter');
  const childBlocks = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [contenteditable]`);
  await expect(childBlocks).toHaveCount(2);
});

test('read-only mode: emoji button is not interactive', async ({ page }) => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      readOnly: true,
      data: { blocks: [{ type: 'callout', data: { emoji: '💡', color: 'default' } }] },
    });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
  await expect(page.getByTestId('callout-emoji-btn')).toBeDisabled();
});

test('header and paragraph inside callout have the same left text position', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['header-1', 'para-1'] },
      { id: 'header-1', type: 'header', data: { text: 'Heading', level: 2 }, parent: 'callout-1' },
      { id: 'para-1', type: 'paragraph', data: { text: 'Paragraph text' }, parent: 'callout-1' },
    ],
  });

  const childrenContainer = `${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children]`;
  const headerEl = page.locator(`${childrenContainer} [data-blok-tool="header"]`);
  const paragraphEl = page.locator(`${childrenContainer} [data-blok-tool="paragraph"]`);

  await expect(headerEl).toBeVisible();
  await expect(paragraphEl).toBeVisible();

  const headerLeft = await headerEl.evaluate(el => el.getBoundingClientRect().left);
  const paragraphLeft = await paragraphEl.evaluate(el => el.getBoundingClientRect().left);

  expect(headerLeft).toBe(paragraphLeft);
});

test('header inside callout has same margin-top as paragraph', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['header-1', 'para-1'] },
      { id: 'header-1', type: 'header', data: { text: 'Heading', level: 2 }, parent: 'callout-1' },
      { id: 'para-1', type: 'paragraph', data: { text: 'Paragraph text' }, parent: 'callout-1' },
    ],
  });

  const childrenContainer = `${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children]`;
  const headerEl = page.locator(`${childrenContainer} [data-blok-tool="header"]`);
  const paragraphEl = page.locator(`${childrenContainer} [data-blok-tool="paragraph"]`);

  await expect(headerEl).toBeVisible();
  await expect(paragraphEl).toBeVisible();

  const headerMarginTop = await headerEl.evaluate(el => getComputedStyle(el).marginTop);
  const paragraphMarginTop = await paragraphEl.evaluate(el => getComputedStyle(el).marginTop);

  expect(headerMarginTop).toBe(paragraphMarginTop);
});

test('emoji is vertically centered against heading first line in callout', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['header-1'] },
      { id: 'header-1', type: 'header', data: { text: 'Heading 1', level: 1 }, parent: 'callout-1' },
    ],
  });

  const emojiBtn = page.getByTestId('callout-emoji-btn');
  const headerEl = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-tool="header"]`);

  await expect(emojiBtn).toBeVisible();
  await expect(headerEl).toBeVisible();

  // Compare vertical centers: emoji center should be within 2px of the heading's first line center
  const emojiCenter = await emojiBtn.evaluate(el => {
    const r = el.getBoundingClientRect();

    return (r.top + r.bottom) / 2;
  });
  const headerFirstLineCenter = await headerEl.evaluate(el => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const paddingTop = parseFloat(style.paddingTop);
    const lineHeight = parseFloat(style.lineHeight);

    // First line center = element top + padding-top + half the line height
    return r.top + paddingTop + lineHeight / 2;
  });

  expect(Math.abs(emojiCenter - headerFirstLineCenter)).toBeLessThanOrEqual(2);
});

test('emoji is vertically centered against H2 heading in callout', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['header-1'] },
      { id: 'header-1', type: 'header', data: { text: 'Heading 2', level: 2 }, parent: 'callout-1' },
    ],
  });

  const emojiBtn = page.getByTestId('callout-emoji-btn');
  const headerEl = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [data-blok-tool="header"]`);

  await expect(emojiBtn).toBeVisible();
  await expect(headerEl).toBeVisible();

  const emojiCenter = await emojiBtn.evaluate(el => {
    const r = el.getBoundingClientRect();

    return (r.top + r.bottom) / 2;
  });
  const headerFirstLineCenter = await headerEl.evaluate(el => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const paddingTop = parseFloat(style.paddingTop);
    const lineHeight = parseFloat(style.lineHeight);

    return r.top + paddingTop + lineHeight / 2;
  });

  expect(Math.abs(emojiCenter - headerFirstLineCenter)).toBeLessThanOrEqual(2);
});

test('emoji picker left edge is offset slightly left of emoji button', async ({ page }) => {
  await createBlok(page, createCalloutData());

  const emojiBtn = page.getByTestId('callout-emoji-btn');
  await emojiBtn.click();

  const picker = page.locator('[data-blok-emoji-picker]');
  await expect(picker).toBeVisible();

  // Wait for the opening animation to complete so the final position is stable
  await expect(picker).toHaveCSS('animation-duration', /.*/);
  await picker.evaluate(el => el.getAnimations().forEach(a => a.finish()));

  const positions = await page.evaluate(() => {
    const btn = document.querySelector('[data-blok-testid="callout-emoji-btn"]');
    const pick = document.querySelector('[data-blok-emoji-picker]');

    if (!btn || !pick) {
      throw new Error('Emoji button or picker not found');
    }

    return {
      btnLeft: btn.getBoundingClientRect().left,
      pickerLeft: pick.getBoundingClientRect().left,
    };
  });

  // Picker starts 8px to the left of the emoji button for visual balance
  // (aligns inner grid content with the callout emoji)
  expect(positions.pickerLeft).toBe(positions.btnLeft - 8);
});

test('search input border is not forced transparent inside colored callout', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { id: 'callout-1', type: 'callout', data: { emoji: '💡', backgroundColor: 'red' }, content: ['para-1'] },
      { id: 'para-1', type: 'paragraph', data: { text: '' }, parent: 'callout-1' },
    ],
  });

  // The callout wrapper must NOT override --blok-search-input-border to transparent.
  // Empty string or absent means the theme default border (visible) applies.
  const calloutComponent = page.locator(CALLOUT_BLOCK_SELECTOR);
  const borderVar = await calloutComponent.evaluate(el => {
    const contentEl = el.querySelector('[data-blok-element-content]');
    const wrapperEl = contentEl?.firstElementChild as HTMLElement | null;

    return wrapperEl?.style.getPropertyValue('--blok-search-input-border') ?? '';
  });

  expect(borderVar).not.toBe('transparent');
});

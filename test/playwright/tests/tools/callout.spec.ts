// test/playwright/tests/tools/callout.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const CALLOUT_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="callout"]`;
const CALLOUT_EMOJI_BTN_SELECTOR = `${CALLOUT_BLOCK_SELECTOR} button`;
const CALLOUT_TEXT_SELECTOR = `${CALLOUT_BLOCK_SELECTOR} [contenteditable="true"]`;
const SETTINGS_BTN_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

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
  blocks: [{ type: 'callout', data: { text: '', emoji: '💡', color: 'default', ...overrides } }],
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test('creates callout via slash menu and shows default emoji', async ({ page }) => {
  await createBlok(page);
  const firstBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable]`).first();
  await firstBlock.click();
  await page.keyboard.type('/callout', { delay: 50 });
  const calloutItem = page.locator('[data-blok-item-name="callout"]');
  await expect(calloutItem).toBeVisible();
  await calloutItem.click();
  await expect(page.locator(CALLOUT_BLOCK_SELECTOR)).toBeVisible();
  await expect(page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first()).toHaveText('💡');
});

test('renders callout with existing data', async ({ page }) => {
  await createBlok(page, createCalloutData({ text: '<b>Note</b>', emoji: '✅', color: 'green' }));
  await expect(page.locator(CALLOUT_BLOCK_SELECTOR)).toBeVisible();
  await expect(page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first()).toHaveText('✅');
  await expect(page.locator(CALLOUT_TEXT_SELECTOR).first()).toContainText('Note');
});

test('opens emoji picker on emoji button click', async ({ page }) => {
  await createBlok(page, createCalloutData());
  await page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first().click();
  await expect(page.locator('[data-emoji-picker-body]')).toBeVisible();
});

test('selects emoji from picker and updates button', async ({ page }) => {
  await createBlok(page, createCalloutData());
  await page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first().click();
  await page.waitForSelector('[data-emoji-picker-body]');
  const firstEmoji = page.locator('[data-emoji-native]').first();
  const emojiChar = await firstEmoji.getAttribute('data-emoji-native');
  await firstEmoji.click();
  await expect(page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first()).toHaveText(emojiChar!);
});

test('removes emoji via Remove button', async ({ page }) => {
  await createBlok(page, createCalloutData({ emoji: '💡' }));
  await page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first().click();
  await page.waitForSelector('[data-emoji-picker-remove]');
  await page.locator('[data-emoji-picker-remove]').click();
  const btn = page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first();
  await expect(btn).toHaveText('');
});

test('closes emoji picker on Escape', async ({ page }) => {
  await createBlok(page, createCalloutData());
  await page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first().click();
  await page.waitForSelector('[data-emoji-picker-body]');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-emoji-picker-body]')).not.toBeVisible();
});

test('applies color from block settings menu', async ({ page }) => {
  await createBlok(page, createCalloutData());
  const textArea = page.locator(CALLOUT_TEXT_SELECTOR).first();
  await textArea.click();
  const settingsBtn = page.locator(SETTINGS_BTN_SELECTOR);
  await expect(settingsBtn).toBeVisible();
  await settingsBtn.click();
  await page.getByText('Blue').click();
  const wrapper = page.locator(CALLOUT_BLOCK_SELECTOR);
  await expect(wrapper).toHaveCSS('background-color', /rgb/);
});

test('text area supports inline tool formatting', async ({ page }) => {
  await createBlok(page, createCalloutData());
  const textArea = page.locator(CALLOUT_TEXT_SELECTOR).first();
  await textArea.click();
  await page.keyboard.type('hello');
  await page.keyboard.press(`${MODIFIER_KEY}+A`);
  await page.keyboard.press(`${MODIFIER_KEY}+B`);
  // Bold tool wraps in <strong>
  await expect(textArea.locator('strong')).toBeVisible();
});

test('Enter at end of text creates a child block', async ({ page }) => {
  await createBlok(page, createCalloutData({ text: 'header' }));
  const textArea = page.locator(CALLOUT_TEXT_SELECTOR).first();
  await textArea.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const childBlocks = page.locator(`${CALLOUT_BLOCK_SELECTOR} [data-blok-toggle-children] [contenteditable]`);
  await expect(childBlocks.first()).toBeVisible();
});

test('Backspace on empty text converts callout to paragraph', async ({ page }) => {
  await createBlok(page, createCalloutData({ text: '' }));
  const textArea = page.locator(CALLOUT_TEXT_SELECTOR).first();
  await textArea.click();
  await page.keyboard.press('Backspace');
  await expect(page.locator(CALLOUT_BLOCK_SELECTOR)).toHaveCount(0);
  await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`)).toBeVisible();
});

test('read-only mode: emoji button is not interactive', async ({ page }) => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      readOnly: true,
      data: { blocks: [{ type: 'callout', data: { text: 'hi', emoji: '💡', color: 'default' } }] },
    });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
  const btn = page.locator(CALLOUT_EMOJI_BTN_SELECTOR).first();
  await expect(btn).toBeDisabled();
});

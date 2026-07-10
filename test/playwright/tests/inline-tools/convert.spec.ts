import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const INLINE_TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid=inline-toolbar]`;

/**
 * Reset holder + create a fresh blok with the given blocks.
 * @param page - Playwright page
 * @param blocks - initial blocks
 */
const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });

  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

/**
 * Open the inline "Turn into" submenu for the current selection and return the
 * set of data-blok-item-name values shown in the opened popover.
 * @param page - Playwright page
 */
const openConvertMenuItemNames = async (page: Page): Promise<string[]> => {
  const toolbar = page.locator(INLINE_TOOLBAR_SELECTOR);
  await expect(toolbar).toBeVisible();

  // The convert-to toggle is the first popover item in the inline toolbar
  // (it shows the current block type, e.g. "Text"). Confirmed by reading
  // src/components/modules/tools.ts: 'convertTo' is always prepended first
  // when building the inline tools collection.
  await toolbar.locator('[data-blok-testid=popover-item]').first().click();

  // A nested popover (marked with data-blok-nested="true", see
  // src/components/utils/popover/popover-desktop.ts) opens with the convert
  // targets. Scope to it — the outer inline toolbar's own popover items
  // (bold, italic, link, ...) also carry data-blok-item-name and would
  // otherwise pollute the result.
  const items = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid=popover-item][data-blok-item-name]`);
  await expect(items.first()).toBeVisible();

  return items.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-blok-item-name') ?? '').filter(Boolean)
  );
};

test.beforeAll(async () => {
  await ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test('inline "Turn into" on a paragraph offers the full text family', async ({ page }) => {
  await createBlokWithBlocks(page, [
    { type: 'paragraph', data: { text: 'convert me' } },
  ]);

  const paragraph = page.locator(PARAGRAPH_SELECTOR);

  await paragraph.click();
  await selectAllInEditable(paragraph);

  const names = await openConvertMenuItemNames(page);

  // 'header-1' verified against src/tools/header/index.ts toolbox (name:
  // `header-${level.number}`, no bare 'header' entry exists). 'toggle' and
  // 'callout' verified against their toolbox `name` fields; 'quote' and
  // 'code' have no toolbox `name`, so they fall back to the tool name.
  // 'bulleted-list' / 'numbered-list' / 'check-list' verified against
  // src/tools/list/style-config.ts.
  for (const expected of ['header-1', 'bulleted-list', 'numbered-list', 'check-list', 'quote', 'code', 'callout', 'toggle']) {
    expect(names).toContain(expected);
  }
});

/**
 * Open the block-settings (☰) "Turn into" submenu for the current block and
 * return the set of data-blok-item-name values in the opened popover.
 *
 * Test id verified against src/components/constants/test-ids.ts
 * (`settingsToggler: 'settings-toggler'`) — the brief's guessed
 * 'block-settings-toggler' does not exist. The "Turn into" entry name
 * ('convert-to') was verified against blockSettings.ts, which pushes
 * `{ name: 'convert-to', ... }` for the submenu toggle item.
 * @param page - Playwright page
 */
const openSettingsConvertItemNames = async (page: Page): Promise<string[]> => {
  // Selectors verified against test/playwright/tests/ui/block-settings-active-state.spec.ts,
  // which exercises the same block-tunes convert-to submenu:
  //   - settings toggler test id is 'settings-toggler' (the brief's guessed
  //     'block-settings-toggler' does not exist).
  //   - the block-tunes popover is scoped by 'block-tunes-popover'.
  //   - the "Turn into" entry is name="convert-to" (built in blockSettings.ts).
  //   - the nested submenu opens on HOVER, not click, and lives under
  //     [data-blok-nested="true"].
  // Click the block wrapper (mirrors the proven openBlockSettings helper in
  // ui/block-settings-active-state.spec.ts) to surface the gutter toggler in a
  // stable, clickable position.
  const blockWrapper = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`).first();
  await blockWrapper.click();

  const settingsButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`);
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const settings = page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]');
  await expect(settings).toBeVisible();

  await settings.locator('[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]').hover();

  // Scope to the nested popover, same as the inline dropdown helper above —
  // the outer block-settings popover's own items (duplicate, delete, ...)
  // also carry data-blok-item-name and would otherwise pollute the result.
  const nestedPopover = page.locator('[data-blok-nested="true"] [data-blok-testid="popover-container"]');
  await expect(nestedPopover).toBeVisible();

  const items = nestedPopover.locator('[data-blok-testid="popover-item"][data-blok-item-name]');
  await expect(items.first()).toBeVisible();

  return items.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-blok-item-name') ?? '').filter(Boolean)
  );
};

test('inline and block-settings "Turn into" offer identical options', async ({ page }) => {
  await createBlokWithBlocks(page, [
    { type: 'paragraph', data: { text: 'convert me' } },
  ]);

  await page.locator(PARAGRAPH_SELECTOR).click();
  await selectAllInEditable(page.locator(PARAGRAPH_SELECTOR));
  const inlineNames = (await openConvertMenuItemNames(page)).sort();

  // Dismiss the inline toolbar before opening block settings.
  await page.keyboard.press('Escape');
  await page.locator(PARAGRAPH_SELECTOR).click();

  const settingsNames = (await openSettingsConvertItemNames(page)).sort();

  expect(inlineNames).toEqual(settingsNames);
});

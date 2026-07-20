import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';
const TOGGLE_ARROW_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-toggle-arrow]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
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
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, data: initialData }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        data: initialData,
        tools: {
          header: { class: (window.Blok as unknown as { Header: unknown }).Header },
        },
      };

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data }
  );
};

const openBlockTunes = async (page: Page): Promise<void> => {
  const block = page.locator(HEADER_BLOCK_SELECTOR).first();

  await expect(block).toBeVisible();
  await block.click();
  await block.hover();

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible();
};

const save = async (page: Page): Promise<OutputData | undefined> =>
  page.evaluate(async () => window.blokInstance?.save());

const headerData = (text: string, level = 2, extra: Record<string, unknown> = {}): OutputData => ({
  blocks: [{ type: 'header', data: { text, level, ...extra } }],
});

test.describe('header Notion parity', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // D2: plain heading -> toggle heading via the settings menu.
  test('converts a plain heading into a toggle heading via the tune menu', async ({ page }) => {
    await createBlok(page, headerData('My Heading', 2));
    await openBlockTunes(page);

    const convertTo = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-item-name="convert-to"]`);

    await convertTo.dispatchEvent('mouseover');

    const toggleEntry = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="toggle-header-2"]`);

    await expect(toggleEntry).toBeVisible();
    await toggleEntry.click();

    await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toBeVisible();

    const saved = await save(page);

    expect(saved?.blocks[0].data.isToggleable).toBe(true);
    expect(saved?.blocks[0].data.level).toBe(2);
  });

  // D2: toggle heading -> plain heading; its children survive as siblings.
  test('converts a toggle heading back to plain, keeping children as siblings', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'header', data: { text: 'Toggle parent', level: 2, isToggleable: true, isOpen: true } },
        { type: 'header', data: { text: 'Child heading', level: 3 }, parentId: undefined },
      ],
    } as unknown as OutputData);

    // Make the second block a child of the toggle via the public API.
    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        return;
      }

      const parent = await blok.blocks.getBlockByIndex(0);
      const child = await blok.blocks.getBlockByIndex(1);

      if (parent && child) {
        blok.blocks.setBlockParent(child.id, parent.id);
      }
    });

    await openBlockTunes(page);

    const convertTo = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-item-name="convert-to"]`);

    await convertTo.dispatchEvent('mouseover');

    const headingEntry = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

    await expect(headingEntry).toBeVisible();
    await headingEntry.click();

    await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveCount(0);

    const saved = await save(page);

    // Parent is plain now and the child block still exists in the tree.
    expect(saved?.blocks.find(b => b.data.text === 'Toggle parent')?.data.isToggleable).toBeUndefined();
    expect(saved?.blocks.some(b => b.data.text === 'Child heading')).toBe(true);
  });

  // D1: block-level text color applied + persisted via the tune menu.
  test('applies a block-level text color from the tune menu and persists it', async ({ page }) => {
    await createBlok(page, headerData('Colored heading', 2));
    await openBlockTunes(page);

    const colorEntry = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-item-name="block-color"]`);

    await colorEntry.dispatchEvent('mouseover');

    const redSwatch = page.getByTestId('block-color-swatch-textColor-red');

    await expect(redSwatch).toBeVisible();
    await redSwatch.click();

    const heading = page.getByRole('heading', { level: 2, name: 'Colored heading' });

    await expect(heading).toHaveCSS('color', /.+/);

    const saved = await save(page);

    expect(saved?.blocks[0].data.textColor).toBe('red');
  });

  // D10: collapsed toggle heading + Enter at end inserts a plain paragraph sibling.
  test('collapsed toggle heading + Enter inserts a plain paragraph sibling', async ({ page }) => {
    await createBlok(page, headerData('Collapsed toggle', 2, { isToggleable: true, isOpen: true }));

    // Collapse it via the arrow.
    await page.locator(TOGGLE_ARROW_SELECTOR).click();

    const heading = page.getByRole('heading', { level: 2, name: 'Collapsed toggle' });

    await heading.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // A paragraph block (not a header, not a hidden child) now follows it.
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`);

    await expect(paragraph).toHaveCount(1);

    const saved = await save(page);
    const types = saved?.blocks.map(b => b.type) ?? [];

    expect(types).toContain('paragraph');
    // The toggle heading is unchanged (still toggleable), and no second header was created.
    expect(saved?.blocks.filter(b => b.type === 'header')).toHaveLength(1);
  });
});

import type { Page } from '@playwright/test';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  createBlok,
  ensureBlokBundleBuilt,
  saveBlok,
  findBlock,
  childrenOf,
} from './_helpers';

const BLOK_INTERFACE = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK_INTERFACE} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION = `${POPOVER_CONTAINER} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`;
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

const selectAllFlatBlocks = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const blok = window.blokInstance as unknown as {
      module: { blockSelection: { selectBlockByIndex: (i: number) => void } };
      blocks: { getBlocksCount: () => number };
    };
    const count = blok.blocks.getBlocksCount();

    for (let i = 0; i < count; i++) {
      blok.module.blockSelection.selectBlockByIndex(i);
    }
  });
};

const openSettingsFor = async (page: Page, hasText: string): Promise<void> => {
  const lastBlock = page.getByTestId('block-wrapper').filter({ hasText }).last();

  await lastBlock.hover();

  const settingsButton = page.locator(SETTINGS_BUTTON);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await expect(page.locator(POPOVER_CONTAINER).first()).toBeVisible();
};

test.describe('Convert to with a columns block in the selection', () => {
  test.beforeAll(() => ensureBlokBundleBuilt());

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('Convert-to still lists normal block types when a columns block is selected', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'h', type: 'header', data: { text: 'Columns', level: 2 } },
        { id: 'd', type: 'paragraph', data: { text: 'Desc' } },
        { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Plan' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Build' }, parent: 'c2' },
        { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
      ],
    });

    await selectAllFlatBlocks(page);
    await openSettingsFor(page, 'Tail');

    await page.locator(CONVERT_TO_OPTION).dispatchEvent('mouseover');
    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    const names = await page
      .locator('[data-blok-nested="true"] [data-blok-testid="popover-item"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-blok-item-name')));

    // Real block-type targets must be present, not only the columns wrap action.
    expect(names.some((n) => n !== null && n.startsWith('header'))).toBe(true);
    expect(names.includes('bulleted-list')).toBe(true);
    expect(names.includes('turn-into-columns')).toBe(true);
  });

  test('Converting the selection to a list leaves the columns block intact', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'h', type: 'header', data: { text: 'Columns', level: 2 } },
        { id: 'd', type: 'paragraph', data: { text: 'Desc' } },
        { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Plan' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Build' }, parent: 'c2' },
        { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
      ],
    });

    await selectAllFlatBlocks(page);
    await openSettingsFor(page, 'Tail');

    await page.locator(CONVERT_TO_OPTION).dispatchEvent('mouseover');
    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    const bulleted = page.locator('[data-blok-nested="true"] [data-blok-item-name="bulleted-list"]');

    await expect(bulleted).toBeVisible();
    await bulleted.click();

    const saved = await saveBlok(page);

    // The columns block survives untouched: still one column_list with its two
    // columns, and the inner paragraphs still live inside their columns.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    expect(childrenOf(saved, 'cl')).toStrictEqual(['c1', 'c2']);
    expect(findBlock(saved, 'l1')?.parent).toBe('c1');
    expect(findBlock(saved, 'r1')?.parent).toBe('c2');

    // A list was produced from the free-standing blocks.
    expect(saved.blocks.some((b) => b.type === 'list')).toBe(true);
  });
});

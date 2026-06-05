import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  createBlok,
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
} from './_helpers';

const BLOK_INTERFACE = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK_INTERFACE} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION = `${POPOVER_CONTAINER} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`;
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';
const NESTED_TURN_INTO_COLUMNS = '[data-blok-nested="true"] [data-blok-item-name="turn-into-columns"]';
const ANY_TURN_INTO_COLUMNS = '[data-blok-testid="block-tunes-popover"] [data-blok-item-name="turn-into-columns"]';

/**
 * Select blocks by flat index via the internal BlockSelection module, then
 * hover the last selected block so the toolbar + settings toggler become visible.
 */
const selectBlocksByIndex = async (
  page: Page,
  indices: number[]
): Promise<void> => {
  await page.evaluate((idxList: number[]) => {
    const blok = window.blokInstance;

    if (!blok) {
      throw new Error('Blok instance not found');
    }

    const blockSelection = (
      blok as unknown as {
        module: { blockSelection: { selectBlockByIndex: (i: number) => void } };
      }
    ).module.blockSelection;

    for (const idx of idxList) {
      blockSelection.selectBlockByIndex(idx);
    }
  }, indices);
};

/**
 * Open the block settings popover for a multi-block selection: hover the last
 * selected block so the toggler appears, then click it.
 */
const openSettingsFor = async (page: Page, hasText: string): Promise<void> => {
  const lastBlock = page.getByTestId('block-wrapper').filter({ hasText }).last();

  await lastBlock.hover();

  const settingsButton = page.locator(SETTINGS_BUTTON);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  await expect(page.locator(POPOVER_CONTAINER).first()).toBeVisible();
};

test.describe('turn selection into columns', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('"Turn into columns" lives inside the "Convert to" submenu, not at top level', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
        { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
      ],
    });

    await selectBlocksByIndex(page, [0, 1]);
    await openSettingsFor(page, 'Beta');

    // It must live under "Convert to"
    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');

    await expect(page.locator(NESTED_POPOVER)).toBeVisible();
    await expect(page.locator(NESTED_TURN_INTO_COLUMNS)).toBeVisible();

    // Inside "Convert to" it reads as the plain tool name, like every other entry.
    await expect(page.locator(NESTED_TURN_INTO_COLUMNS)).toHaveText('Columns');

    // The ONLY "turn-into-columns" entry is the nested one — never top-level.
    await expect(page.locator(ANY_TURN_INTO_COLUMNS)).toHaveCount(1);
    await expect(page.locator(NESTED_TURN_INTO_COLUMNS)).toHaveCount(1);
  });

  test('choosing "Convert to → Turn into columns" wraps the selection one-per-column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
        { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
        { id: 'c', type: 'paragraph', data: { text: 'Gamma' } },
      ],
    });

    await selectBlocksByIndex(page, [0, 1, 2]);
    await openSettingsFor(page, 'Gamma');

    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');

    const turnInto = page.locator(NESTED_TURN_INTO_COLUMNS);

    await expect(turnInto).toBeVisible();
    await turnInto.click();

    // One column_list should now exist
    await expect(page.getByTestId('column-list')).toHaveCount(1);

    // Three columns inside it, one per original block
    const columnCount = await page.evaluate(() =>
      document.querySelectorAll('[data-blok-columns] > [data-blok-element]').length
    );

    expect(columnCount).toBe(3);

    await expect(page.getByText('Alpha')).toBeVisible();
    await expect(page.getByText('Beta')).toBeVisible();
    await expect(page.getByText('Gamma')).toBeVisible();
  });

  test('the command is absent for a single-block selection', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Solo' } }],
    });

    const soloBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Solo' }).last();

    await soloBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON);

    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await expect(page.locator(POPOVER_CONTAINER).first()).toBeVisible();

    // Not present anywhere for a single block — neither top level nor nested
    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');

    await expect(page.locator(NESTED_POPOVER)).toBeVisible();
    await expect(page.locator(ANY_TURN_INTO_COLUMNS)).toHaveCount(0);
  });
});

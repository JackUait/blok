import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

/**
 * Notion-parity bug #2: turning a TOGGLE heading into plain text/heading via the
 * "Turn into" menu must RELEASE its children as following siblings — exactly like
 * the "Toggle heading" tune switch already does (see header-notion-parity.spec.ts
 * "converts a toggle heading back to plain, keeping children as siblings").
 *
 * Before the fix the two UIs disagreed: the tune switch released children, but the
 * turn-into menu routed through convert() -> replace() -> reparentChildren(), which
 * RE-NESTED the children under the now-plain block. Notion releases them in both UIs.
 */

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION = `${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`;
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
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
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, data: initialData });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data }
  );
};

const openBlockTunes = async (page: Page, hasText: string): Promise<void> => {
  const block = page.getByTestId('block-wrapper').filter({ hasText }).first();

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

test.describe('toggle heading turn-into releases children', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('turning a toggle heading into text via the menu releases its children as siblings', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toggle-h', type: 'header', data: { text: 'Toggle parent', level: 2, isToggleable: true, isOpen: true }, content: ['child-1'] },
        { id: 'child-1', type: 'paragraph', data: { text: 'Nested child' }, parent: 'toggle-h' },
      ],
    });

    await openBlockTunes(page, 'Toggle parent');

    const convertTo = page.locator(CONVERT_TO_OPTION);

    await expect(convertTo).toBeVisible();
    await convertTo.dispatchEvent('mouseover');

    await expect(page.locator(NESTED_POPOVER)).toBeVisible();

    // Paragraph entry in the "Convert to" submenu (toolbox title "Text").
    const paragraphEntry = page
      .locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"]`)
      .filter({ hasText: 'Text' })
      .first();

    await expect(paragraphEntry).toBeVisible();
    await paragraphEntry.click();

    const saved = await save(page);
    const blocks = saved?.blocks ?? [];

    // The child survived…
    const child = blocks.find(b => b.data.text === 'Nested child');

    expect(child).toBeDefined();
    // …and was RELEASED to the document root (not re-nested under the now-plain block).
    expect(child?.parent).toBeUndefined();
  });
});

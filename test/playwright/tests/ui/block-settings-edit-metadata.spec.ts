import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const EDIT_METADATA_SELECTOR = '[data-blok-item-name="edit-metadata"]';

test.beforeAll(ensureBlokBundleBuilt);

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

type CreateBlokOptions = {
  user?: { name: string };
};

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, user }) => {
    const config: Record<string, unknown> = {
      holder,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: 'Hello world' },
          },
        ],
      } satisfies OutputData,
    };

    if (user) {
      config.user = user;
    }

    const blok = new window.Blok(config);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, user: options.user ?? null });
};

const openBlockSettings = async (page: Page): Promise<void> => {
  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

  await expect(popover).toHaveCount(1);
  await popover.waitFor({ state: 'visible' });
};

test.describe('Block settings edit metadata footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('shows "Last edited by <user>" after editing a block with user configured', async ({ page }) => {
    await createBlok(page, { user: { name: 'Jack Uait' } });

    const block = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' });

    await block.click();

    /**
     * Type something to trigger a DOM mutation, which sets lastEditedAt and lastEditedBy on the block.
     */
    await page.keyboard.type(' test');

    await openBlockSettings(page);

    const metadataItem = page.locator(`${POPOVER_CONTAINER_SELECTOR} ${EDIT_METADATA_SELECTOR}`);

    await expect(metadataItem).toBeVisible();
    await expect(metadataItem).toContainText('Last edited by Jack Uait');
  });

  test('shows "Last edited" without user name when no user is configured', async ({ page }) => {
    await createBlok(page);

    const block = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' });

    await block.click();

    /**
     * Type something to trigger a DOM mutation, which sets lastEditedAt on the block.
     * Without user config, lastEditedBy remains null.
     */
    await page.keyboard.type(' test');

    await openBlockSettings(page);

    const metadataItem = page.locator(`${POPOVER_CONTAINER_SELECTOR} ${EDIT_METADATA_SELECTOR}`);

    await expect(metadataItem).toBeVisible();

    const label = metadataItem.locator('[data-edit-meta-label]');

    await expect(label).toHaveText('Last edited');
  });

  test('does not show metadata footer when block has not been edited', async ({ page }) => {
    await createBlok(page, { user: { name: 'Jack Uait' } });

    const block = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' });

    /**
     * Click the block to focus it but do NOT type anything.
     * Without a mutation, lastEditedAt remains undefined and the footer should not appear.
     */
    await block.click();

    await openBlockSettings(page);

    const metadataItem = page.locator(`${POPOVER_CONTAINER_SELECTOR} ${EDIT_METADATA_SELECTOR}`);

    await expect(metadataItem).toHaveCount(0);
  });
});

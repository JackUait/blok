import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const HOLDER_ID = 'blok';

const resetAndCreate = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
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

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
        tools: {
          database: { class: window.BlokDatabase },
          'database-row': { class: window.BlokDatabaseRow },
        },
      });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const DATABASE_WITH_CARD: OutputData['blocks'] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' },
            ],
          },
        },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  {
    id: 'row-1',
    type: 'database-row',
    parent: 'db-1',
    data: { position: 'a0', properties: { 'prop-title': 'My Card', 'prop-status': 'opt-todo' } },
  },
];

test.describe('Database board — card hover actions', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await resetAndCreate(page, DATABASE_WITH_CARD);
  });

  test('action group becomes visible on card hover', async ({ page }) => {
    const card = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-card]`).first();
    const actions = card.locator('[data-blok-database-card-actions]');

    await expect(actions).toHaveCSS('opacity', '0');
    await card.hover();
    await expect(actions).toHaveCSS('opacity', '1');
  });

  test('pencil click replaces title with input pre-filled with current title', async ({ page }) => {
    const card = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-card]`).first();

    await card.hover();
    await card.locator('[data-blok-database-edit-card]').click();

    const input = card.locator('[data-blok-database-card-title-input]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('My Card');
    await expect(input).toBeFocused();
  });

  test('Enter saves new title to the card', async ({ page }) => {
    const card = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-card]`).first();

    await card.hover();
    await card.locator('[data-blok-database-edit-card]').click();

    const input = card.locator('[data-blok-database-card-title-input]');
    await input.fill('Updated Title');
    await input.press('Enter');

    await expect(card.locator('[data-blok-database-card-title]')).toHaveText('Updated Title');
    await expect(card.locator('[data-blok-database-card-title-input]')).toBeHidden();
  });

  test('Escape restores original title without saving', async ({ page }) => {
    const card = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-card]`).first();

    await card.hover();
    await card.locator('[data-blok-database-edit-card]').click();

    const input = card.locator('[data-blok-database-card-title-input]');
    await input.fill('Temporary');
    await input.press('Escape');

    await expect(card.locator('[data-blok-database-card-title]')).toHaveText('My Card');
  });

  test('dots button opens a menu with Delete card option', async ({ page }) => {
    const card = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-card]`).first();

    await card.hover();
    await card.locator('[data-blok-database-card-menu]').click();

    const deleteOption = page.getByText('Delete card');
    await expect(deleteOption).toBeVisible();
  });

  test('clicking Delete in the menu removes the card', async ({ page }) => {
    const card = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-card]`).first();

    await card.hover();
    await card.locator('[data-blok-database-card-menu]').click();

    await page.getByText('Delete card').click();

    await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-card]`)).toHaveCount(0);
  });
});

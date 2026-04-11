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

const DATABASE_BLOCKS: OutputData['blocks'] = [
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
              { id: 'opt-backlog', label: 'Backlog', color: 'gray', position: 'a0' },
            ],
          },
        },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1', 'row-2'],
  },
  {
    id: 'row-1',
    type: 'database-row',
    data: { position: 'a0', properties: { 'prop-title': 'Fix bug', 'prop-status': 'opt-backlog' } },
  },
  {
    id: 'row-2',
    type: 'database-row',
    data: { position: 'a1', properties: { 'prop-title': 'Write tests', 'prop-status': 'opt-backlog' } },
  },
];

test.describe('Database board view — column header pill', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('column header pill width matches its text content, not the full header width', async ({ page }) => {
    await resetAndCreate(page, DATABASE_BLOCKS);

    const pill = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-pill]`).filter({ hasText: 'Backlog' });
    const header = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-column-header]`).filter({ hasText: 'Backlog' });

    await expect(pill).toBeVisible();

    const pillWidth = await pill.evaluate((el) => el.getBoundingClientRect().width);
    const headerWidth = await header.evaluate((el) => el.getBoundingClientRect().width);

    // The pill should be significantly narrower than the header — it holds a short
    // label ("Backlog") and must NOT stretch to fill available space.
    // A column is 260px wide; with padding the header is ~244px. The pill with
    // "Backlog" text (uppercase, 11px, ~50px) plus dot and padding should be well
    // under 150px. If it equals the header width the pill is incorrectly stretching.
    expect(pillWidth).toBeLessThan(headerWidth * 0.7);
  });
});

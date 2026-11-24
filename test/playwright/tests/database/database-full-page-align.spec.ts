import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

/**
 * A full-page database shares one column with its page title (notion-motion.md Round 99 #9:
 * the title text starts at the tabs' x). In a host wider than the text column the title
 * follows `contentAlign`, so the database must follow it too. An inline database keeps
 * its centred column.
 */
const HOLDER_ID = 'blok';
const TITLE = `${BLOK_INTERFACE_SELECTOR} [data-blok-page-title]`;
const FIRST_TAB = `${BLOK_INTERFACE_SELECTOR} [data-blok-database-tab]`;
const FIRST_HEADER = `${BLOK_INTERFACE_SELECTOR} [data-blok-database-table-column-header]`;

type Align = 'left' | 'center' | 'right';

const views = [
  { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], properties: [{ id: 't', visible: true, width: 280 }] },
  { id: 'v2', name: 'Board', type: 'board', position: 'a1', sorts: [], filters: [], properties: [{ id: 't', visible: true, width: 280 }] },
];

const blocks = (fullPage: boolean): OutputData['blocks'] => [{
  id: 'db-1',
  type: 'database',
  data: {
    title: fullPage ? '' : 'Tasks',
    schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
    views,
    activeViewId: 'v1',
    fullPage,
  },
  content: [],
}];

const create = async (page: Page, { fullPage, align, width }: { fullPage: boolean; align: Align; width: number }): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks, contentAlign, hostWidth }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.style.width = `${hostWidth}px`;
    container.style.setProperty('--blok-content-max-width', '692px');
    document.body.appendChild(container);
    const blok = new window.Blok({
      holder,
      pageTitle: true,
      style: { contentAlign },
      data: { blocks: blokBlocks },
      tools: {
        database: { class: window.BlokDatabase },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks(fullPage), contentAlign: align, hostWidth: width });
};

const left = async (page: Page, selector: string): Promise<number> => {
  const box = await page.locator(selector).first().boundingBox();

  if (box === null) throw new Error(`${selector} has no box`);

  return box.x;
};

const right = async (page: Page, selector: string): Promise<number> => {
  const box = await page.locator(selector).first().boundingBox();

  if (box === null) throw new Error(`${selector} has no box`);

  return box.x + box.width;
};

test.describe('Database — a full-page database shares the page title column', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await gotoTestPage(page);
  });

  for (const align of ['left', 'center'] as const) {
    test(`tabs and table start at the title text in a wide host, contentAlign ${align}`, async ({ page }) => {
      await create(page, { fullPage: true, align, width: 1242 });

      const title = await left(page, TITLE);

      expect(Math.abs(await left(page, FIRST_TAB) - title)).toBeLessThanOrEqual(1);
      expect(Math.abs(await left(page, FIRST_HEADER) - title)).toBeLessThanOrEqual(1);
    });
  }

  test('tabs end at the title column end in a wide host, contentAlign right', async ({ page }) => {
    await create(page, { fullPage: true, align: 'right', width: 1242 });

    const titleEnd = await right(page, TITLE);
    const toolbarEnd = await right(page, `${BLOK_INTERFACE_SELECTOR} [data-blok-database-view-toolbar]`);

    expect(Math.abs(toolbarEnd - titleEnd)).toBeLessThanOrEqual(1);
  });

  for (const align of ['left', 'center', 'right'] as const) {
    test(`an inline database keeps its centred column, contentAlign ${align}`, async ({ page }) => {
      await create(page, { fullPage: false, align, width: 1242 });

      const tab = await left(page, FIRST_TAB);

      // Centred: equal room on both sides of the 692px column inside the block.
      const block = await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-database-wrapper]`).boundingBox();

      if (block === null) throw new Error('no database');
      expect(Math.abs(tab - (block.x + (block.width - 692) / 2))).toBeLessThanOrEqual(1);
    });
  }
});

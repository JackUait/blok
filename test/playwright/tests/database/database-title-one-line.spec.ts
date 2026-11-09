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
 * A one-view database title (notion-motion.md, Round 7 "Long database title"):
 * Notion keeps it one line, 31.2 tall, with an ellipsis, at every width.
 */
const HOLDER_ID = 'blok';
const LONG_TITLE = 'Quarterly planning tracker for the product design and engineering teams, 2026 Q4';
const ROW = `${BLOK_INTERFACE_SELECTOR} [data-blok-database-title-row]`;
const TITLE = `${ROW} > [data-blok-database-title]`;

const blocks = (data: Record<string, unknown>): OutputData['blocks'] => [{
  id: 'db-1',
  type: 'database',
  data: {
    schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
    views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], properties: [{ id: 't', visible: true, width: 280 }] }],
    activeViewId: 'v1',
    ...data,
  },
  content: [],
}];

const create = async (page: Page, data: Record<string, unknown>): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '1000px';
    document.body.appendChild(container);
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
  }, { holder: HOLDER_ID, blokBlocks: blocks(data) });
};

/** Sizes the holder so the title row's content box is `width`, as Notion's box is measured. */
const setRowWidth = async (page: Page, width: number): Promise<void> => {
  await page.evaluate(async ({ holder, target, rowSelector }) => {
    const container = document.getElementById(holder);
    const row = document.querySelector<HTMLElement>(rowSelector);

    if (container === null || row === null) throw new Error('no title row');
    const inner = (): number => {
      const style = getComputedStyle(row);

      return row.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    };

    for (let i = 0; i < 6 && inner() !== target; i++) {
      container.style.width = `${Number.parseFloat(container.style.width) + target - inner()}px`;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    if (inner() !== target) throw new Error(`row is ${inner()}, not ${target}`);
  }, { holder: HOLDER_ID, target: width, rowSelector: ROW });
};

const titleBox = (page: Page): Promise<{ height: number; clientHeight: number; scrollHeight: number; scrollTop: number; clamp: string; overflow: string }> =>
  page.locator(TITLE).evaluate((el) => {
    const style = getComputedStyle(el);

    return {
      height: el.getBoundingClientRect().height,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clamp: style.webkitLineClamp,
      overflow: style.textOverflow,
    };
  });

test.describe('Database — a long title stays one line', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await gotoTestPage(page);
  });

  for (const width of [700, 480, 400, 330, 320, 319]) {
    test(`is one 31.2px line with an ellipsis in a ${width}px row`, async ({ page }) => {
      await create(page, { title: LONG_TITLE });
      await setRowWidth(page, width);
      const box = await titleBox(page);

      expect(box.height).toBeCloseTo(31.2, 0);
      // The text is longer than the line: it is cut, not wrapped.
      expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
      expect(box.clamp).toBe('1');
      expect(box.overflow).toBe('ellipsis');
      expect((await page.locator(ROW).boundingBox())?.height).toBe(40);
      // The title gives way: "+" and "…" stay 24 wide, as Notion's do.
      expect((await page.locator(ROW).locator('[data-blok-database-add-view]').boundingBox())?.width).toBe(24);
      expect((await page.locator(ROW).locator('[data-blok-database-title-more]').boundingBox())?.width).toBe(24);
    });
  }

  test('shows the whole title while it is edited, and one line again after Enter', async ({ page }) => {
    await create(page, { title: LONG_TITLE });
    await setRowWidth(page, 400);
    await page.locator(TITLE).click();
    // End only reaches the end of a wrapped line: put the caret after the last letter.
    await page.locator(TITLE).evaluate((el) => window.getSelection()?.collapse(el, el.childNodes.length));
    await page.keyboard.type('!');
    const editing = await titleBox(page);

    expect(editing.scrollHeight).toBe(editing.clientHeight);
    expect(editing.height).toBeGreaterThan(40);
    await expect(page.locator(TITLE)).toHaveText(`${LONG_TITLE}!`);

    await page.keyboard.press('Enter');
    const after = await titleBox(page);

    expect(after.height).toBeCloseTo(31.2, 0);
    expect(after.scrollTop).toBe(0);
  });

  test('an empty title keeps its placeholder width', async ({ page }) => {
    await create(page, { title: '' });
    await setRowWidth(page, 700);
    const box = await page.locator(TITLE).boundingBox();

    expect(box?.height).toBeCloseTo(31.2, 0);
    // "New database" at 24px: the hidden copy still holds the title open.
    expect(box?.width).toBeGreaterThan(100);
  });

  test('a full-page database still hides its own title', async ({ page }) => {
    await create(page, { title: LONG_TITLE, fullPage: true });

    await expect(page.locator(TITLE)).toBeHidden();
  });

  // notion-motion.md, Round 7 "⤢ fold point": below 320, » goes with New ⌄.
  test('minimize folds with New below a 320px row', async ({ page }) => {
    await create(page, {
      title: LONG_TITLE,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [{ propertyId: 't', direction: 'ascending' }], filters: [], properties: [{ id: 't', visible: true, width: 280 }] }],
    });
    const minimize = page.getByTestId('database-toolbar-minimize');
    const settings = page.getByTestId('database-toolbar-settings');

    await setRowWidth(page, 320);
    await expect(minimize).toBeVisible();
    await expect(page.getByTestId('database-toolbar-new')).toBeVisible();

    await setRowWidth(page, 319);
    await expect(minimize).toBeHidden();
    await expect(page.getByTestId('database-toolbar-new')).toBeHidden();
    await expect(settings).toBeVisible();
  });
});

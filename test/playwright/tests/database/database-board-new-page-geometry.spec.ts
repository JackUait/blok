/**
 * A board column's "+ New page", the card it makes, and a card's ⋯ menu
 * (notion-motion.md, Round 8c).
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const GROUPS = [
  { id: 'todo', kind: 'todo', name: 'To-do', color: 'gray', position: 'a0' },
  { id: 'inProgress', kind: 'inProgress', name: 'In progress', color: 'blue', position: 'a1' },
  { id: 'complete', kind: 'complete', name: 'Complete', color: 'green', position: 'a2' },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        {
          id: 'st',
          name: 'Status',
          type: 'status',
          position: 'a1',
          status: { groups: GROUPS },
          config: {
            options: [
              { id: 's1', label: 'Not started', groupId: 'todo', position: 'a0' },
              { id: 's2', label: 'In progress', color: 'blue', groupId: 'inProgress', position: 'a1' },
            ],
          },
        },
      ],
      views: [{ id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'st', sorts: [], filters: [], properties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { t: 'Alpha', st: 's1' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, blocks());
};

const column = (page: Page, optionId: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-database-column][data-option-id="${optionId}"]`);

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await mount(page);
});

test('"+ New page" has its plus at x 12 and its text at x 31.5', async ({ page }) => {
  const button = column(page, 's1').getByRole('button', { name: 'New page' }).last();
  const geometry = await button.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const icon = el.querySelector('[data-blok-database-add-card-icon]')?.getBoundingClientRect();
    const svg = el.querySelector('[data-blok-database-add-card-icon] svg');
    const path = svg?.querySelector('path')?.getBBox();
    const matrix = svg instanceof SVGSVGElement ? svg.getScreenCTM() : null;
    const scale = matrix?.a ?? 0;
    const inkLeft = (matrix?.e ?? 0) + ((path?.x ?? 0) - 0.625) * scale - box.left;
    // The stroke is 1.25 with round caps; Notion's filled outline already holds its ends.
    const inkWidth = ((path?.width ?? 0) + 1.25) * scale;
    const label = el.querySelector('span:last-child');
    const range = document.createRange();

    if (label !== null) range.selectNodeContents(label);

    return {
      iconX: (icon?.left ?? 0) - box.left,
      iconWidth: icon?.width ?? 0,
      inkCentre: inkLeft + inkWidth / 2,
      inkWidth,
      textX: range.getBoundingClientRect().left - box.left,
    };
  });

  // r8c-newpage-rest.raw: the plus ink is a 10.5 box at x 12.
  expect(geometry.inkWidth).toBeCloseTo(10.5, 0);
  expect(geometry.inkCentre).toBeCloseTo(17.25, 0);
  expect(geometry.iconX).toBe(12);
  expect(geometry.iconWidth).toBe(10.5);
  expect(geometry.textX).toBe(31.5);
});

test('a new card\'s page glyph sits at x 11 and its name field at x 36, 214 wide', async ({ page }) => {
  await column(page, 's1').getByRole('button', { name: 'New page' }).last().click();
  const field = page.getByPlaceholder('Type a name…');

  await expect(field).toBeFocused();
  const geometry = await field.evaluate((el) => {
    const card = el.closest('[data-blok-database-card]')?.getBoundingClientRect();
    const glyph = el.parentElement?.querySelector('[data-blok-database-card-edit-glyph] svg')?.getBoundingClientRect();
    const box = el.getBoundingClientRect();

    return { glyphX: (glyph?.left ?? 0) - (card?.left ?? 0), fieldX: box.left - (card?.left ?? 0), fieldWidth: box.width };
  });

  expect(geometry.glyphX).toBe(11);
  expect(geometry.fieldX).toBe(36);
  expect(geometry.fieldWidth).toBe(214);
});

test('a card\'s ⋯ menu opens at the click point, with Notion\'s rows and its search focused', async ({ page }) => {
  const card = column(page, 's1').locator('[data-blok-database-card]').first();
  const button = card.getByRole('button', { name: 'Card options' });

  await card.hover();
  const anchor = await button.boundingBox();
  const clickX = (anchor?.x ?? 0) + 4;

  await page.mouse.click(clickX, (anchor?.y ?? 0) + 12);
  const search = page.getByPlaceholder('Search actions…');

  await expect(search).toBeFocused();
  const menu = page.locator('[data-blok-popover-custom-class~="blok-database-card-menu"] [data-blok-popover-container]').last();

  // The open motion scales the box; read it once it has settled.
  await expect.poll(() => menu.evaluate((el) => el.getAnimations().length)).toBe(0);
  const geometry = await menu.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
      .filter((row) => row.getBoundingClientRect().width > 0)
      .slice(0, 3)
      .map((row) => {
        const rect = row.getBoundingClientRect();
        const icon = row.querySelector('svg')?.getBoundingClientRect();
        const title = row.querySelector<HTMLElement>('[data-blok-popover-item-title]');
        const style = title === null ? null : getComputedStyle(title);

        return {
          top: rect.top,
          height: rect.height,
          iconX: (icon?.left ?? 0) - rect.left,
          iconWidth: icon?.width ?? 0,
          textX: (title?.getBoundingClientRect().left ?? 0) - rect.left,
          font: style === null ? '' : `${style.fontSize}/${style.lineHeight} ${style.fontWeight}`,
        };
      });

    return { left: box.left, rows };
  });

  expect(geometry.left).toBeCloseTo(clickX, 0);
  expect(geometry.rows[1].top - geometry.rows[0].top).toBe(29);
  for (const row of geometry.rows) {
    expect(row.height).toBe(28);
    expect(row.iconX).toBe(8);
    expect(row.iconWidth).toBe(20);
    expect(row.textX).toBe(36);
    expect(row.font).toBe('14px/16.8px 400');
  }
});

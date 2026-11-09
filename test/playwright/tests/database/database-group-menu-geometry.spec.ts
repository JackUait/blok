/**
 * The board column "More group options" menu (notion-motion.md, Round 8b
 * "Board group ⋯ menu"): 180 wide, flush under its button, 28px rows at a
 * 29px pitch, a 20px icon at x 8 and 14px text at x 36.
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
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { t: 'A', st: 's1' } } },
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

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await mount(page);
});

test('the group menu has Notion\'s size, place and rows', async ({ page }) => {
  const header = page.locator('[data-blok-database-column][data-option-id="s1"] [data-blok-database-column-header]');
  const button = header.getByRole('button', { name: 'More group options' });

  await header.hover();
  await button.click();
  const menu = page.getByRole('menu').last();

  await expect(menu.getByRole('menuitem', { name: 'Edit groups' })).toBeVisible();
  // The open motion scales the box; read it once it has settled.
  await expect.poll(() => menu.evaluate((el) => (el.closest('[data-blok-popover-container]') ?? el).getAnimations().length)).toBe(0);
  const anchor = await button.boundingBox();
  const geometry = await menu.evaluate((el) => {
    const container = el.closest('[data-blok-popover-container]') ?? el;
    const box = container.getBoundingClientRect();
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((row) => {
      const rect = row.getBoundingClientRect();
      const icon = row.querySelector('svg')?.getBoundingClientRect();
      const title = row.querySelector<HTMLElement>('[data-blok-popover-item-title]');
      const style = title === null ? null : getComputedStyle(title);

      return {
        label: row.textContent?.trim() ?? '',
        left: rect.left - box.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        iconX: (icon?.left ?? 0) - rect.left,
        iconWidth: icon?.width ?? 0,
        textX: (title?.getBoundingClientRect().left ?? 0) - rect.left,
        font: style === null ? '' : `${style.fontSize} ${style.fontWeight}`,
      };
    });

    return { left: box.left, top: box.top, width: box.width, height: box.height, rows };
  });

  expect(geometry.width).toBe(180);
  // 4px above the first row and below the last.
  expect(geometry.height).toBe(123);
  expect(geometry.top).toBeCloseTo((anchor?.y ?? 0) + (anchor?.height ?? 0), 0);
  expect(geometry.left).toBeCloseTo(anchor?.x ?? 0, 0);
  expect(geometry.rows.map((row) => row.label)).toEqual(['Edit groups', 'Hide aggregation', 'Hide group', 'Move to Trash']);
  expect(geometry.rows.slice(1).map((row, index) => row.top - geometry.rows[index].top)).toEqual([29, 29, 29]);
  for (const row of geometry.rows) {
    expect(row.left).toBe(4);
    expect(row.width).toBe(172);
    expect(row.height).toBe(28);
    expect(row.iconX).toBe(8);
    expect(row.iconWidth).toBe(20);
    expect(row.textX).toBe(36);
    expect(row.font).toBe('14px 400');
  }
});

/**
 * The filter popovers' geometry against notion-motion.md Round 36 §2 (r36-filter1.raw, r36-filter-adv1.raw,
 * r36-filter-group.raw). Offsets are read from the popover box, so the font does not move them.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

type Box = { x: number; y: number; width: number; height: number };

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-text', name: 'Text', type: 'text', position: 'a1' },
];

const RULE = { propertyId: 'p-text', operator: 'contains', value: '' };

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], ...view }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data: input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    localStorage.clear();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { data });
  await expect(page.getByRole('grid')).toBeVisible();
};

/** The popover scales in on open: read boxes after its animations finish. */
const settledBox = async (locator: Locator): Promise<Box> => locator.evaluate(async (element) => {
  await Promise.all(document.getAnimations().map((animation) => animation.finished));
  const rect = element.getBoundingClientRect();

  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});

const boxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox();

  expect(box).not.toBeNull();

  return box ?? { x: 0, y: 0, width: 0, height: 0 };
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('filter popover geometry', () => {
  test('one rule from a chip is 220×71 with the ⋯ 12 from the edge and the field at (12,35)', async ({ page }) => {
    await mount(page, blocks({ filters: [{ id: 'f1', ...RULE }] }));
    const chip = await boxOf(page.getByTestId('database-filter-pill-f1'));

    await page.getByTestId('database-filter-pill-f1').click();
    const popover = await settledBox(page.getByTestId('database-filter-popover'));
    const more = await boxOf(page.getByTestId('database-filter-more'));
    const field = await boxOf(page.getByTestId('database-filter-value'));

    expect(more.x + more.width).toBeCloseTo(popover.x + popover.width - 12, 1);
    expect(more.width).toBeCloseTo(20, 1);
    expect(more.y - popover.y).toBeCloseTo(8, 1);
    expect(field.x - popover.x).toBeCloseTo(12, 1);
    expect(field.y - popover.y).toBeCloseTo(35, 1);
    expect(popover.width).toBeCloseTo(220, 1);
    expect(popover.height).toBeCloseTo(71, 1);
    expect(popover.y - (chip.y + chip.height)).toBeCloseTo(4, 1);
  });

  test('advanced rules put every property button at +76 and the value 16 before the ⋯', async ({ page }) => {
    await mount(page, blocks({ filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'f1', ...RULE }, { id: 'f2', ...RULE }] } }));
    await page.getByTestId('database-advanced-pill').click();
    const popover = await settledBox(page.getByTestId('database-advanced-filter'));
    const and = await boxOf(page.getByTestId('database-filter-conjunction-root'));
    const second = await boxOf(page.getByTestId('database-filter-rule-property-f2'));
    const first = await boxOf(page.getByTestId('database-filter-rule-property-f1'));
    const value = await boxOf(page.getByTestId('database-filter-rule-value-f1'));
    const more = await boxOf(page.getByTestId('database-filter-rule-more-f1'));

    expect(second.x - popover.x).toBeCloseTo(76, 1);
    expect(first.x - popover.x).toBeCloseTo(76, 1);
    expect(and.x - popover.x).toBeCloseTo(7, 1);
    expect(value.width).toBeCloseTo(170, 1);
    expect(more.x - (value.x + value.width)).toBeCloseTo(16, 1);
    expect(popover.x + popover.width - (more.x + more.width)).toBeCloseTo(8, 1);
  });

  test('with a group, the box sits 1px in and the outer rule shares its room with the ⋯ gap', async ({ page }) => {
    await mount(page, blocks({ filterTree: { id: 'root', conjunction: 'and', filterRules: [
      { id: 'f1', ...RULE },
      { id: 'f2', ...RULE },
      { id: 'g1', conjunction: 'or', filterRules: [{ id: 'f3', ...RULE }] },
    ] } }));
    await page.getByTestId('database-advanced-pill').click();
    const popover = await settledBox(page.getByTestId('database-advanced-filter'));
    const group = await boxOf(page.getByTestId('database-filter-group-g1'));
    const groupMore = await boxOf(page.getByTestId('database-filter-group-more-g1'));
    const inner = await boxOf(page.getByTestId('database-filter-rule-property-f3'));
    const property = await boxOf(page.getByTestId('database-filter-rule-property-f1'));
    const value = await boxOf(page.getByTestId('database-filter-rule-value-f1'));
    const more = await boxOf(page.getByTestId('database-filter-rule-more-f1'));
    const secondMore = await boxOf(page.getByTestId('database-filter-rule-more-f2'));

    expect(group.x - popover.x).toBeCloseTo(77, 1);
    expect(group.y - secondMore.y).toBeCloseTo(41, 1);
    expect(groupMore.x - (group.x + group.width)).toBeCloseTo(9, 1);
    expect(inner.x - group.x).toBeCloseTo(76, 1);
    const innerAdd = await boxOf(page.getByTestId('database-filter-add-rule-g1'));

    expect(innerAdd.x - group.x).toBeCloseTo(4, 1);
    expect(innerAdd.width).toBeCloseTo(group.width - 8, 1);
    expect(innerAdd.y - (inner.y + inner.height)).toBeCloseTo(4, 1);
    expect(group.height).toBeCloseTo(80, 1);
    expect(popover.height).toBeCloseTo(247, 1);
    expect(property.width).toBeCloseTo(120, 1);
    // The room past 170 goes half to the value, half to the gap before the ⋯.
    expect(more.x - (value.x + value.width) - 16).toBeCloseTo(value.width - 170, 1);
    expect(more.x).toBeCloseTo(groupMore.x, 1);
  });
});

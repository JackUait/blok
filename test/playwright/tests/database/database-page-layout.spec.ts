/**
 * The row page layout, shared by every row of a database.
 * - Layouts: https://www.notion.com/help/layouts (pins up to 15, sections,
 *   details panel, modules, Simple/Tabbed, Apply to all pages, reset)
 * Measured: docs/plans/2026-10-09-database-notion-parity/research/09-notion-page-layout-builder.md.
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

const blocks = (title: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0', ...title },
        { id: 'p-due', name: 'Due', type: 'text', position: 'a1' },
        { id: 'p-owner', name: 'Owner', type: 'text', position: 'a2' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-due': 'Friday', 'p-owner': 'Ada' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Bravo', 'p-due': 'Monday', 'p-owner': 'Bo' } } },
];

const mount = async (page: Page, data: OutputBlockData[], dir: 'ltr' | 'rtl' = 'ltr'): Promise<void> => {
  await page.evaluate(async ({ data: input, dir: direction }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, i18n: { direction } });
    await window.blokInstance.isReady;
  }, { data, dir });
  await expect(page.getByRole('grid')).toBeVisible();
};

const savedTitle = async (page: Page): Promise<Record<string, unknown> | undefined> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const database = output?.blocks.find((block) => block.id === 'db-1');
  const schema = (database?.data as { schema?: Array<Record<string, unknown>> } | undefined)?.schema ?? [];

  return schema.find((property) => property.type === 'title');
});

const openRow = async (page: Page, rowId: string): Promise<void> => {
  const row = page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
};

const withView = (data: OutputBlockData[], view: Record<string, unknown>): OutputBlockData[] => {
  const db = data[0].data as { views: Array<Record<string, unknown>> };

  db.views = db.views.map((v) => ({ ...v, ...view }));

  return data;
};

const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');

const layoutBounds = async (page: Page): Promise<Record<'panelLeft' | 'panelRight' | 'panelTop' | 'groupLeft' | 'groupRight' | 'groupBottom', number>> =>
  peek(page).evaluate((drawer) => {
    const panel = drawer.querySelector('[data-blok-database-drawer-details]');
    const group = drawer.querySelector('[data-blok-database-drawer-props]');

    if (panel === null || group === null) throw new Error('missing layout regions');
    const p = panel.getBoundingClientRect();
    const g = group.getBoundingClientRect();

    return { panelLeft: p.left, panelRight: p.right, panelTop: p.top, groupLeft: g.left, groupRight: g.right, groupBottom: g.bottom };
  });

const pins = (page: Page): Locator => peek(page).locator('[data-blok-database-drawer-pins]');

const layoutMenu = async (page: Page, propertyId: string): Promise<void> => {
  await peek(page).locator(`[data-blok-database-layout-item-menu][data-property-id="${propertyId}"]`).click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('row page layout', () => {
  test('pins a property for every page with Apply to all pages', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');

    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeVisible();

    await layoutMenu(page, 'p-due');
    await page.getByRole('menuitem', { name: 'Pin to heading' }).click();
    await expect(pins(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toContainText('Friday');
    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([]);

    await peek(page).getByRole('button', { name: 'Apply to all pages' }).click();
    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeHidden();
    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([{ id: 'p-due', place: 'heading' }]);

    await page.keyboard.press('Escape');
    await openRow(page, 'r2');
    await expect(pins(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toContainText('Monday');
  });

  // research/10 §2: Escape never leaves Customize layout; only Cancel or Apply do.
  test('keeps Customize layout and its draft open on Escape', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await layoutMenu(page, 'p-due');
    await page.getByRole('menuitem', { name: 'Pin to heading' }).click();
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeVisible();
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();
  });

  // research/09 §3b: Cancel after edits asks "Discard all layout changes?"; Discard drops the draft.
  test('asks before discarding layout edits on Cancel', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await layoutMenu(page, 'p-due');
    await page.getByRole('menuitem', { name: 'Pin to heading' }).click();
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();

    await peek(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Discard all layout changes?' });

    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeHidden();
    await expect(pins(page)).toHaveCount(0);
    await expect(peek(page)).toBeVisible();
  });

  test('keeps the discard question above the docked full-page details panel', async ({ page }) => {
    await page.setViewportSize({ width: 756, height: 717 });
    await mount(page, withView(blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), { openPagesIn: 'full' }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await layoutMenu(page, 'p-due');
    await page.getByRole('menuitem', { name: 'Pin to heading' }).click();
    await peek(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    const discard = page.getByRole('alertdialog', { name: 'Discard all layout changes?' }).getByRole('button', { name: 'Discard' });

    await expect(discard).toBeVisible();
    expect(await discard.evaluate((el) => {
      const r = el.getBoundingClientRect();

      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
    })).toBe(true);
    await discard.click();
    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeHidden();
    await expect(pins(page)).toHaveCount(0);
  });

  test('folds a named section and opens and closes the details panel', async ({ page }) => {
    await mount(page, blocks({
      pageLayoutSections: [{ id: 's1', name: 'Planning' }],
      pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }, { id: 'p-owner', place: 'panel' }],
    }));
    await openRow(page, 'r1');

    const section = peek(page).getByRole('button', { name: 'Planning' });

    await expect(section).toHaveAttribute('aria-expanded', 'true');
    await expect(peek(page).locator('[data-blok-database-drawer-section] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toBeVisible();
    await section.click();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(peek(page).locator('[data-blok-database-drawer-section] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toBeHidden();

    const details = peek(page).getByRole('region', { name: 'Details' });
    const toggle = peek(page).getByRole('button', { name: 'View details' });

    await expect(details).toBeHidden();
    await toggle.click();
    await expect(details).toContainText('Ada');
    await toggle.click();
    await expect(details).toBeHidden();
  });

  // research/09 §9: closed on every navigation; it does not persist.
  test('starts the details panel closed on every open', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }));
    await openRow(page, 'r1');
    const details = peek(page).getByRole('region', { name: 'Details' });

    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(details).toBeVisible();
    await peek(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(peek(page)).toHaveCount(0);
    await openRow(page, 'r1');
    await expect(peek(page).getByRole('button', { name: 'View details' })).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeHidden();
  });

  // research/09 §9: full page, a 385px column at the window's right edge, full height, 1px left border.
  test('docks the details panel at the window edge on a full page', async ({ page }) => {
    await mount(page, withView(blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), { openPagesIn: 'full' }));
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'View details' }).click();
    const details = peek(page).getByRole('region', { name: 'Details' });

    await expect(details).toBeVisible();
    const box = await details.evaluate((el) => {
      const r = el.getBoundingClientRect();

      return { left: r.left, right: r.right, top: r.top, height: r.height, width: r.width, border: getComputedStyle(el).borderInlineStartWidth, viewport: document.documentElement.clientWidth, viewportHeight: window.innerHeight };
    });

    expect(box.width).toBeCloseTo(385, 0);
    expect(box.right).toBeCloseTo(box.viewport, 0);
    expect(box.top).toBe(0);
    expect(box.height).toBeCloseTo(box.viewportHeight, 0);
    expect(box.border).toBe('1px');
    const title = await peek(page).locator('[data-blok-database-drawer-title]').boundingBox();

    expect((title?.x ?? 0) + (title?.width ?? 0)).toBeLessThanOrEqual(box.left);
  });

  // research/09 §9: center peek, a 280px column inside the modal.
  test('docks the details panel inside the center peek', async ({ page }) => {
    await mount(page, withView(blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), { openPagesIn: 'center' }));
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'View details' }).click();
    const details = peek(page).getByRole('region', { name: 'Details' });

    await expect(details).toBeVisible();
    const [panel, modal, toolbar, title] = await Promise.all([
      details.boundingBox(),
      peek(page).boundingBox(),
      peek(page).locator('[data-blok-database-drawer-toolbar]').boundingBox(),
      peek(page).locator('[data-blok-database-drawer-title]').boundingBox(),
    ]);

    expect(panel?.width).toBeCloseTo(280, 0);
    expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeCloseTo((modal?.x ?? 0) + (modal?.width ?? 0), 0);
    expect(panel?.y).toBeCloseTo((toolbar?.y ?? 0) + (toolbar?.height ?? 0), 0);
    expect((panel?.y ?? 0) + (panel?.height ?? 0)).toBeCloseTo((modal?.y ?? 0) + (modal?.height ?? 0), 0);
    expect((title?.x ?? 0) + (title?.width ?? 0)).toBeLessThanOrEqual(panel?.x ?? 0);
    expect(await details.evaluate((el) => getComputedStyle(el).borderInlineStartWidth)).toBe('1px');
  });

  // Side peek geometry was not measured in research/09; Blok keeps the panel beside the group.
  test('places the details panel to the right of the page properties', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }));
    await openRow(page, 'r1');
    const details = peek(page).getByRole('region', { name: 'Details' });
    const properties = peek(page).locator('[data-blok-database-drawer-props]');

    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(details).toBeVisible();
    await expect(properties).toBeVisible();
    const bounds = await layoutBounds(page);

    expect(bounds.panelLeft).toBeGreaterThanOrEqual(bounds.groupRight - 1);
    expect(bounds.panelTop).toBeLessThan(bounds.groupBottom);
    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(details).toBeHidden();
  });

  test('mirrors the details panel to the left of the page properties in RTL', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), 'rtl');
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(peek(page).getByRole('region', { name: 'Details' })).toBeVisible();
    const bounds = await layoutBounds(page);

    expect(bounds.panelRight).toBeLessThanOrEqual(bounds.groupLeft + 1);
    expect(bounds.panelTop).toBeLessThan(bounds.groupBottom);
  });

  // Notion's narrow-width behaviour was not measured; Blok stacks the panel below.
  test('stacks the details panel below the page properties when the page is narrow', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }));
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(peek(page).getByRole('region', { name: 'Details' })).toBeVisible();
    const bounds = await layoutBounds(page);

    expect(bounds.panelTop).toBeGreaterThanOrEqual(bounds.groupBottom - 1);
  });

  test('opens the first page in Customize from More settings > Customize page layout', async ({ page }) => {
    await mount(page, blocks());
    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-more').click();
    await expect(page.getByTestId('database-settings-subitems')).toBeVisible();
    await page.getByTestId('database-settings-customize-layout').click();

    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeVisible();
    await expect(peek(page).locator('[data-blok-database-drawer-title]')).toHaveValue('Alpha');
    await expect(peek(page).locator('[data-blok-database-drawer-prop-icon]').first()).toBeVisible();
  });

  // research/09 §4: 400px per click, clamped; each arrow shows only while the strip can scroll its way.
  for (const dir of ['ltr', 'rtl'] as const) {
    test(`scrolls overflowing pins 400px per arrow click (${dir})`, async ({ page }) => {
      const extra = Array.from({ length: 10 }, (_, i) => ({ id: `p-x${i}`, name: `Pinned property ${i}`, type: 'text', position: `b${i}` }));
      const data = blocks({ pageLayoutPlacements: extra.map((p) => ({ id: p.id, place: 'heading' })) });
      const db = data[0].data as { schema: unknown[] };

      db.schema.push(...extra);
      await mount(page, data, dir);
      await openRow(page, 'r1');
      const back = peek(page).getByRole('button', { name: 'Scroll to previous pinned properties' });
      const forward = peek(page).getByRole('button', { name: 'Scroll to next pinned properties' });
      const max = await pins(page).evaluate((el) => el.scrollWidth - el.clientWidth);
      const offset = (): Promise<number> => pins(page).evaluate((el) => Math.abs(el.scrollLeft));
      // RTL rounds the clamped end to a whole pixel either way.
      const near = (target: number): Promise<void> => expect.poll(async () => Math.abs((await offset()) - target)).toBeLessThanOrEqual(1);

      expect(max).toBeGreaterThan(400);
      await expect(forward).toBeVisible();
      await expect(back).toBeHidden();
      expect(await forward.evaluate((el) => getComputedStyle(el).transition)).toContain('opacity 0.1s ease-in');
      expect(await forward.boundingBox()).toMatchObject({ width: 32, height: 32 });
      await forward.click();
      await near(400);
      expect(await pins(page).evaluate((el) => Math.sign(el.scrollLeft))).toBe(dir === 'rtl' ? -1 : 1);
      await expect(back).toBeVisible();
      for (let at = 400; at < max; at = Math.min(max, at + 400)) {
        await forward.click();
        await near(Math.min(max, at + 400));
      }
      await expect(forward).toBeHidden();
      await back.click();
      await near(max - 400);
    });
  }

  test('shows no pin arrows in Customize layout', async ({ page }) => {
    const extra = Array.from({ length: 10 }, (_, i) => ({ id: `p-x${i}`, name: `Pinned property ${i}`, type: 'text', position: `b${i}` }));
    const data = blocks({ pageLayoutPlacements: extra.map((p) => ({ id: p.id, place: 'heading' })) });
    const db = data[0].data as { schema: unknown[] };

    db.schema.push(...extra);
    await mount(page, data);
    await openRow(page, 'r1');
    await expect(peek(page).getByRole('button', { name: 'Scroll to next pinned properties' })).toBeVisible();
    await peek(page).locator('[data-blok-database-drawer-customize]').click();
    await expect(peek(page).getByRole('toolbar', { name: 'Customize layout' })).toBeVisible();

    await expect(peek(page).getByRole('button', { name: 'Scroll to next pinned properties' })).toHaveCount(0);
    await expect(peek(page).locator('[data-blok-database-drawer-pins-row]')).toHaveAttribute('data-scroll-forward', '');
  });

  test('shows no pin arrows when the pins fit', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }));
    await openRow(page, 'r1');
    await expect(pins(page)).toBeVisible();

    await expect(peek(page).getByRole('button', { name: 'Scroll to next pinned properties' })).toBeHidden();
    await expect(peek(page).getByRole('button', { name: 'Scroll to previous pinned properties' })).toBeHidden();
  });

  test('switches to a Tabbed page from Page settings and resets to the original layout', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutSections: [] }));
    await openRow(page, 'r1');
    await expect(pins(page)).toBeVisible();

    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await peek(page).getByRole('button', { name: 'Page settings' }).click();
    await page.getByRole('menuitem', { name: 'Tabbed' }).click();
    await expect(peek(page).getByRole('tablist')).toBeVisible();
    await expect(peek(page).getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');

    await peek(page).getByRole('button', { name: 'Page settings' }).click();
    await page.getByRole('menuitem', { name: /Reset to original page layout/ }).click();

    await expect(pins(page)).toHaveCount(0);
    await expect(peek(page).getByRole('tablist')).toHaveCount(0);
    expect(await savedTitle(page)).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
  });
});

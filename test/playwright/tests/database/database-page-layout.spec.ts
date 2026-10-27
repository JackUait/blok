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
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    favoriteRows?: string[];
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
  await expect(page.getByRole('grid').first()).toBeVisible();
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

/** The full-window layout builder (research/09 §1). It sits on body, outside the peek. */
const builder = (page: Page): Locator => page.getByRole('dialog', { name: 'Customize page layout' });

/** Heading and Property group each have an "Action menu for module" button. */
const headingModule = (page: Page): Locator => builder(page).locator('[data-blok-database-layout-module="heading"]');

/** The pins live in the peek, or in the builder's canvas while customizing. Never both. */
const pins = (page: Page): Locator => page.locator('[data-blok-database-drawer-pins]');

/** Pins from the Heading module's ••• menu (research/09 §3), then closes the menu. */
const pinFromHeadingMenu = async (page: Page, name: string): Promise<void> => {
  await headingModule(page).getByRole('button', { name: 'Action menu for module' }).click();
  await page.getByRole('button', { name: `Show ${name} as pinned` }).click();
  await expect(page.getByRole('button', { name: `Do not show ${name} as pinned` })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Do not show ${name} as pinned` })).toHaveCount(0);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('row page layout', () => {
  // research/09 §1 + §10, research/10 §8-9: a full-window takeover with its own top bar.
  test('opens Customize page layout full window and applies from its top bar', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();

    const dialog = builder(page);

    await expect(dialog).toBeVisible();
    expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 1400, height: 900 });
    expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(249, 248, 247)');
    await expect(dialog.getByRole('heading', { name: 'Alpha' })).toBeVisible();

    const preview = dialog.getByRole('button', { name: 'Preview: Alpha' });
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    const apply = dialog.getByRole('button', { name: 'Apply to all pages' });
    const more = dialog.getByRole('button', { name: 'More save options' });

    // research/10 §9: Preview → Cancel → Apply → More save options.
    await preview.focus();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(apply).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(more).toBeFocused();
    const bar = await Promise.all([cancel, apply, more].map(async (el) => (await el.boundingBox())?.y));

    expect(new Set(bar).size).toBe(1);

    await pinFromHeadingMenu(page, 'Due');
    await expect(dialog.locator('[data-blok-database-drawer-pins] [data-property-id="p-due"]').first()).toBeVisible();
    await apply.click();

    await expect(dialog).toBeHidden();
    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([{ id: 'p-due', place: 'heading' }]);
    await expect(peek(page).locator('[data-blok-database-drawer-pins] [data-property-id="p-due"]').first()).toBeVisible();
  });

  // research/09 §3, research/10 §8: a click in the Heading module opens its menu; a pin moves at once.
  test('opens the Heading menu from a click in the module and pins without losing focus', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);

    await dialog.getByRole('heading', { name: 'Alpha' }).click();
    await expect(page.getByPlaceholder('Search properties…')).toBeFocused();
    const pinDue = page.getByRole('button', { name: 'Show Due as pinned' });

    await pinDue.click();
    const unpinDue = page.getByRole('button', { name: 'Do not show Due as pinned' });

    await expect(unpinDue).toBeFocused();
    await expect(dialog.locator('[data-blok-database-drawer-pins] [data-property-id="p-due"]').first()).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Property labels' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    await expect(unpinDue).toHaveCount(0);
    await expect(dialog).toBeVisible();
    // The selected module is marked in neutral ink, never blue.
    const ring = await dialog.locator('[data-blok-database-layout-module="heading"]').evaluate((el) => getComputedStyle(el).boxShadow);

    expect(ring).not.toMatch(/rgb\(35, 131, 226\)|rgb\(182, 212, 243\)|rgb\(206, 227, 247\)/);
  });

  // research/09 §5: the eye is a draft that hides at once; Apply writes it, and the row page agrees.
  test('hides a property from the Property group eye and applies it to the row page', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);

    await dialog.locator('[data-blok-database-layout-module="group"]').getByRole('button', { name: 'Action menu for module' }).click();
    await expect(page.getByPlaceholder('Search properties…')).toBeFocused();
    const eye = page.getByRole('button', { name: 'Visibility of Due' });

    await eye.click();
    await page.getByRole('menuitemradio', { name: 'Always hide' }).click();
    await expect(eye).toBeFocused();
    await expect(eye).toHaveAttribute('data-visibility', 'hidden');
    await expect(dialog.locator('[data-blok-database-drawer-props] [data-property-id="p-due"]')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '1 more property' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Apply to all pages' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(peek(page).locator('[data-blok-database-drawer-props] [data-property-id="p-due"]')).toHaveCount(0);
    await peek(page).getByRole('button', { name: '1 more property' }).click();
    await expect(peek(page).locator('[data-blok-database-drawer-props] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toBeVisible();
  });

  // research/10 §7: "+ Add a property" in the Pinned list makes a property pinned first, not in the group.
  test('adds a property from the Heading menu first among the pins', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);

    await headingModule(page).getByRole('button', { name: 'Action menu for module' }).click();
    await page.locator('[data-blok-testid="database-layout-heading-menu"] [data-blok-database-layout-add-pin]').click();
    await page.locator('[data-blok-database-property-type-option="number"]').click();
    const pinned = dialog.locator('[data-blok-database-drawer-pins] [data-blok-database-drawer-prop-value]');

    await expect(pinned).toHaveCount(2);
    await expect(pinned.first()).not.toHaveAttribute('data-property-id', 'p-due');
    await expect(pinned.nth(1)).toHaveAttribute('data-property-id', 'p-due');
    await expect(dialog.locator('[data-blok-database-drawer-props] [data-blok-database-drawer-prop-value]')).toHaveCount(1);
    await expect(dialog).toBeVisible();
  });

  // research/09 §3b L65: "+" Add page module → "Add to page" → an existing property becomes its own module.
  test('adds an existing property as a page module from +', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);

    await dialog.getByRole('button', { name: 'Add page module' }).click();
    const menu = page.getByTestId('database-layout-add-module-menu');

    await expect(menu.getByText('Add to page')).toBeVisible();
    await menu.getByRole('button', { name: 'Due' }).click();

    await expect(menu).toHaveCount(0);
    await expect(dialog.getByTestId('database-layout-module-handle-p-due')).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply to all pages' }).click();

    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([{ id: 'p-due', place: 'page' }]);
  });

  // research/09 anatomy L39: modules drag by their ⠿; the drop ends no click on the card.
  test('drags a page module below another with the pointer', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'page' }, { id: 'p-owner', place: 'page' }] }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);
    const due = dialog.getByTestId('database-layout-module-handle-p-due');
    const owner = dialog.getByTestId('database-layout-module-handle-p-owner');
    const from = await due.boundingBox();
    const to = await dialog.getByRole('button', { name: 'Add page module' }).boundingBox();

    if (from === null || to === null) throw new Error('missing drag geometry');
    expect(from.y).toBeLessThan((await owner.boundingBox())?.y ?? 0);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(dialog.getByTestId('database-drop-line')).toHaveCount(1);
    await page.mouse.up();

    await expect.poll(async () => ((await due.boundingBox())?.y ?? 0) > ((await owner.boundingBox())?.y ?? 0)).toBe(true);
    await expect(page.getByTestId('database-layout-module-menu')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Apply to all pages' }).click();

    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([{ id: 'p-owner', place: 'page' }, { id: 'p-due', place: 'page' }]);
  });

  /** Presses at the centre of `from`, travels in steps and releases at `to`. */
  const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  };

  // research/09 anatomy L40: a page module dropped on the side panel column moves to the panel.
  test('drags a page module into the side panel column', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'page' }] }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);
    const from = await dialog.getByTestId('database-layout-module-handle-p-due').boundingBox();
    const to = await dialog.getByRole('button', { name: 'Add to panel' }).boundingBox();

    if (from === null || to === null) throw new Error('missing drag geometry');
    await drag(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
    await dialog.getByRole('button', { name: 'Apply to all pages' }).click();

    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([{ id: 'p-due', place: 'panel' }]);
  });

  // research/09 §8 L83: in the builder a pin drags by its label.
  test('drags a pin before another', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }, { id: 'p-owner', place: 'heading' }] }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);
    const due = await dialog.getByText('Due', { exact: true }).boundingBox();
    const owner = await dialog.getByText('Owner', { exact: true }).boundingBox();

    if (due === null || owner === null) throw new Error('missing drag geometry');
    await drag(page, { x: owner.x + owner.width / 2, y: owner.y + owner.height / 2 }, { x: due.x + 2, y: due.y + due.height / 2 });
    await expect(page.getByTestId('database-layout-heading-menu')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Apply to all pages' }).click();

    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([{ id: 'p-owner', place: 'heading' }, { id: 'p-due', place: 'heading' }]);
  });

  // research/09 §10 L164: at 756px the side panel column is a "«" button.
  test('collapses the side panel column at a narrow width', async ({ page }) => {
    await page.setViewportSize({ width: 756, height: 717 });
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);
    const addToPanel = dialog.getByRole('button', { name: 'Add to panel' });

    await expect(dialog.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
    await expect(addToPanel).toBeHidden();
    await dialog.getByRole('button', { name: 'Show sidebar' }).click();
    await expect(addToPanel).toBeVisible();
    await dialog.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(addToPanel).toBeHidden();
  });

  // research/09 §10: at 756px the bar stays on one 60px line.
  test('keeps the builder top bar on one line at 756px', async ({ page }) => {
    await page.setViewportSize({ width: 756, height: 717 });
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);
    const boxes = await Promise.all(['Cancel', 'Apply to all pages', 'More save options'].map(async (name) =>
      dialog.getByRole('button', { name, exact: true }).boundingBox()));

    expect(new Set(boxes.map((box) => box?.y)).size).toBe(1);
    for (const box of boxes) expect(box?.height).toBe(32);
    expect(Math.max(...boxes.map((box) => (box?.x ?? 0) + (box?.width ?? 0)))).toBeLessThanOrEqual(756 - 16);
  });

  // The centered heading sits above the bar's buttons; a long page name must not cover Cancel.
  test('keeps a long Preview page name clear of Cancel at 756px', async ({ page }) => {
    await page.setViewportSize({ width: 756, height: 717 });
    const data = blocks();

    (data[1].data as { properties: Record<string, unknown> }).properties['p-title'] = 'A very long page name that runs on and on past the middle';
    await mount(page, data);
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const preview = await builder(page).locator('[data-blok-database-layout-preview]').boundingBox();
    const cancel = await builder(page).getByRole('button', { name: 'Cancel', exact: true }).boundingBox();

    if (preview === null || cancel === null) throw new Error('missing top bar buttons');
    expect(preview.x + preview.width).toBeLessThanOrEqual(cancel.x);
  });

  test('pins a property for every page with Apply to all pages', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');

    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await expect(builder(page)).toBeVisible();

    await pinFromHeadingMenu(page, 'Due');
    await expect(pins(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toContainText('Friday');
    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([]);

    await builder(page).getByRole('button', { name: 'Apply to all pages' }).click();
    await expect(builder(page)).toBeHidden();
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
    await pinFromHeadingMenu(page, 'Due');
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect(builder(page)).toBeVisible();
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();
  });

  // research/09 §3b: Cancel after edits asks "Discard all layout changes?"; Discard drops the draft.
  test('asks before discarding layout edits on Cancel', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await pinFromHeadingMenu(page, 'Due');
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();

    await builder(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Discard all layout changes?' });

    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect(builder(page)).toBeHidden();
    await expect(pins(page)).toHaveCount(0);
    await expect(peek(page)).toBeVisible();
  });

  // research/23 §7: a page load with a draft gets the browser's "Leave site?"; without one it goes.
  test('holds a page load only while the layout draft has edits', async ({ page }) => {
    const leaveHeld = async (): Promise<boolean> => page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });

      window.dispatchEvent(event);

      return event.defaultPrevented;
    });

    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await expect(builder(page)).toBeVisible();
    expect(await leaveHeld()).toBe(false);

    await pinFromHeadingMenu(page, 'Due');
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();
    expect(await leaveHeld()).toBe(true);

    await builder(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Discard all layout changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(builder(page)).toBeHidden();
    expect(await leaveHeld()).toBe(false);
  });

  // research/23 §7: an in-app route change with a draft asks "Discard all layout changes?".
  test('asks before an in-app route change through blok.confirmLeave()', async ({ page }) => {
    const confirmLeave = (): Promise<boolean | undefined> => page.evaluate(() => window.blokInstance?.confirmLeave());
    const question = page.getByRole('alertdialog', { name: 'Discard all layout changes?' });

    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await expect(builder(page)).toBeVisible();
    expect(await confirmLeave()).toBe(true);
    await expect(question).toHaveCount(0);

    await pinFromHeadingMenu(page, 'Due');
    const stay = confirmLeave();

    await question.getByRole('button', { name: 'Cancel' }).click();
    expect(await stay).toBe(false);
    await expect(builder(page)).toBeVisible();
    await expect(pins(page).locator('[data-property-id="p-due"]').first()).toBeVisible();

    const leave = confirmLeave();

    await question.getByRole('button', { name: 'Discard' }).click();
    expect(await leave).toBe(true);
    await expect(builder(page)).toBeHidden();
    await expect(pins(page).locator('[data-property-id="p-due"]')).toHaveCount(0);
  });

  // Navigation API (Chromium): a same-document Back is held until the user answers.
  test('holds a same-document Back while the layout draft has edits', async ({ page }) => {
    const path = (): Promise<string> => page.evaluate(() => location.pathname + location.search + location.hash);
    const question = page.getByRole('alertdialog', { name: 'Discard all layout changes?' });

    await mount(page, blocks());
    const before = await path();

    await page.evaluate(() => history.pushState({}, '', '#row-page'));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await pinFromHeadingMenu(page, 'Due');

    await page.evaluate(() => history.back());
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(builder(page)).toBeVisible();
    expect(await path()).toBe(`${before}#row-page`);

    await page.evaluate(() => history.back());
    await question.getByRole('button', { name: 'Discard' }).click();
    await expect(builder(page)).toBeHidden();
    await expect.poll(path).toBe(before);
  });

  test('keeps the discard question above the docked full-page details panel', async ({ page }) => {
    await page.setViewportSize({ width: 756, height: 717 });
    await mount(page, withView(blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), { openPagesIn: 'full' }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await pinFromHeadingMenu(page, 'Due');
    await builder(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    const discard = page.getByRole('alertdialog', { name: 'Discard all layout changes?' }).getByRole('button', { name: 'Discard' });

    await expect(discard).toBeVisible();
    expect(await discard.evaluate((el) => {
      const r = el.getBoundingClientRect();

      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
    })).toBe(true);
    await discard.click();
    await expect(builder(page)).toBeHidden();
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

    await expect(details).toBeHidden();
    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(details).toContainText('Ada');
    await peek(page).getByRole('button', { name: 'Hide details' }).click();
    await expect(details).toBeHidden();
  });

  // research/10 §3: properties move between sections by dragging their row in the Property group menu.
  test('drags a property from one section to another in the Property group menu', async ({ page }) => {
    await mount(page, blocks({
      pageLayoutSections: [{ id: 's1', name: 'Planning' }, { id: 's2', name: 'Later' }],
      pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }, { id: 'p-owner', place: 'section', sectionId: 's1' }],
    }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const dialog = builder(page);

    await dialog.locator('[data-blok-database-layout-module="group"]').getByRole('button', { name: 'Action menu for module' }).click();
    const menu = page.getByTestId('database-layout-group-menu');
    const from = await menu.locator('[data-blok-database-layout-group-row][data-property-id="p-due"] [data-blok-database-layout-group-handle]').boundingBox();
    const to = await menu.getByTestId('database-layout-section-s2').boundingBox();

    if (from === null || to === null) throw new Error('missing drag geometry');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(menu.getByTestId('database-drop-line')).toBeVisible();
    const line = await menu.getByTestId('database-drop-line').boundingBox();
    const header = await menu.getByTestId('database-layout-section-s2').boundingBox();

    // Later is empty, so the line sits under its header, in the menu's own coordinates.
    expect(Math.abs((line?.y ?? 0) + (line?.height ?? 0) / 2 - ((header?.y ?? 0) + (header?.height ?? 0)))).toBeLessThan(4);
    await page.mouse.up();

    await expect(menu.locator('[data-blok-database-layout-menu-section][data-section-id="s2"] [data-blok-database-layout-group-row][data-property-id="p-due"]')).toHaveCount(1);
    await expect(dialog.locator('[data-blok-database-drawer-section][data-section-id="s2"] [data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Apply to all pages' }).click();

    expect((await savedTitle(page))?.pageLayoutPlacements).toEqual([
      { id: 'p-owner', place: 'section', sectionId: 's1' },
      { id: 'p-due', place: 'section', sectionId: 's2' },
    ]);
  });

  // research/10 §2b: a fold carries to other rows and survives a reload. Per viewer, in local storage (plan Q3).
  test('keeps a folded section folded on another row and after a reload', async ({ page }) => {
    const data = (): OutputBlockData[] => blocks({
      pageLayoutSections: [{ id: 's1', name: 'Planning' }],
      pageLayoutPlacements: [{ id: 'p-due', place: 'section', sectionId: 's1' }],
    });
    const due = (): Locator => peek(page).locator('[data-blok-database-drawer-section] [data-blok-database-drawer-prop-value][data-property-id="p-due"]');

    await mount(page, data());
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'Planning' }).click();
    await expect(due()).toBeHidden();
    await openRow(page, 'r2');
    await expect(peek(page).getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await mount(page, data());
    await openRow(page, 'r1');

    await expect(peek(page).getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'false');
    await expect(due()).toBeHidden();
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

  // research/10 §10: Page info in the top bar toggles the panel both ways; Close panel shuts it from inside.
  test('opens the full-page details panel from Page info and closes it from Close panel', async ({ page }) => {
    await mount(page, withView(blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), { openPagesIn: 'full' }));
    await openRow(page, 'r1');
    const details = peek(page).getByRole('region', { name: 'Details' });
    const info = peek(page).getByRole('button', { name: 'Page info' });

    await info.click();
    await expect(details).toBeVisible();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(peek(page).getByRole('button', { name: 'Hide details' })).toBeVisible();
    const [infoBox, panelBox] = await Promise.all([info.boundingBox(), details.boundingBox()]);

    // The open panel docks at the window edge; Page info must stay clickable beside it.
    expect((infoBox?.x ?? 0) + (infoBox?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
    await info.click();
    await expect(details).toBeHidden();
    await info.click();
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: 'Close panel' }).click();
    await expect(details).toBeHidden();
    await expect(peek(page).getByRole('button', { name: 'View details' })).toBeFocused();
    await expect(info).toHaveAttribute('aria-expanded', 'false');
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

  // research/22 §10: side peek, a 280px panel at the inline end under the top bar; the peek grows by 280px up to 1008.
  test('docks the details panel in the side peek and widens the peek by its width', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }));
    await openRow(page, 'r1');
    const details = peek(page).getByRole('region', { name: 'Details' });
    const width = async (): Promise<number> => Math.round((await peek(page).boundingBox())?.width ?? 0);

    await expect(details).toBeHidden();
    await expect.poll(width).toBe(756);
    await peek(page).getByRole('button', { name: 'View details' }).click();
    await expect(details).toBeVisible();
    await expect.poll(width).toBe(1008);
    const [panel, drawer, toolbar, title] = await Promise.all([
      details.boundingBox(),
      peek(page).boundingBox(),
      peek(page).locator('[data-blok-database-drawer-toolbar]').boundingBox(),
      peek(page).locator('[data-blok-database-drawer-title]').boundingBox(),
    ]);

    expect(panel?.width).toBeCloseTo(280, 0);
    expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeCloseTo((drawer?.x ?? 0) + (drawer?.width ?? 0), 0);
    expect(panel?.y).toBeCloseTo((toolbar?.y ?? 0) + (toolbar?.height ?? 0), 0);
    expect((title?.x ?? 0) + (title?.width ?? 0)).toBeLessThanOrEqual(panel?.x ?? 0);
    expect(await details.evaluate((el) => getComputedStyle(el).borderInlineStartWidth)).toBe('1px');

    // From 756 the measured close settles at 728.
    await peek(page).getByRole('button', { name: 'Page info' }).click();
    await expect(details).toBeHidden();
    await expect.poll(width).toBe(728);
  });

  test('docks the side peek details panel at the left edge in RTL', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), 'rtl');
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'View details' }).click();
    const details = peek(page).getByRole('region', { name: 'Details' });

    await expect(details).toBeVisible();
    await expect.poll(async () => Math.round((await peek(page).boundingBox())?.width ?? 0)).toBe(1008);
    const [panel, drawer] = await Promise.all([details.boundingBox(), peek(page).boundingBox()]);

    expect(panel?.x).toBeCloseTo(drawer?.x ?? 0, 0);
    expect(drawer?.x).toBeCloseTo(0, 0);
    expect(panel?.width).toBeCloseTo(280, 0);
  });

  // Notion's narrow-width behaviour was not measured; below 844px Blok stacks the panel below.
  // A peek narrower than its 564px minimum fills the window.
  test('stacks the details panel below the page properties when the page is narrow', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 900 });
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

    await expect(builder(page)).toBeVisible();
    await expect(builder(page).getByRole('heading', { name: 'Alpha' })).toBeVisible();
    await expect(builder(page).locator('[data-blok-database-drawer-prop-icon]').first()).toBeVisible();
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
      // Layout size: boundingBox follows ancestor transforms and once read 32.0000038.
      expect(await forward.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight])).toEqual([32, 32]);
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
    await expect(builder(page)).toBeVisible();

    await expect(page.getByRole('button', { name: 'Scroll to next pinned properties' })).toHaveCount(0);
    await expect(builder(page).locator('[data-blok-database-drawer-pins-row]')).toHaveAttribute('data-scroll-forward', '');
  });

  test('shows no pin arrows when the pins fit', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }] }));
    await openRow(page, 'r1');
    await expect(pins(page)).toBeVisible();

    await expect(peek(page).getByRole('button', { name: 'Scroll to next pinned properties' })).toBeHidden();
    await expect(peek(page).getByRole('button', { name: 'Scroll to previous pinned properties' })).toBeHidden();
  });

  test('switches to a Tabbed page from the Page settings column and resets to the original layout', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutSections: [] }));
    await openRow(page, 'r1');
    await expect(pins(page)).toBeVisible();

    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await expect(builder(page).getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
    await builder(page).getByRole('button', { name: 'Tabbed' }).click();
    await expect(builder(page).getByRole('button', { name: 'Tabbed' })).toHaveAttribute('aria-pressed', 'true');
    await expect(builder(page).getByRole('tablist')).toBeVisible();
    await expect(builder(page).getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');

    // research/10 §5: Reset sits in Apply's "More save options", asks first, then closes the builder.
    await builder(page).getByRole('button', { name: 'More save options' }).click();
    await page.getByRole('menuitem', { name: /Reset to original page layout/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reset to original page layout?' });

    await expect(confirm).toHaveAccessibleDescription('No properties will be deleted.');
    // Like "Delete the last view…" (research/30 B3), a dialog with a × opens with focus on it.
    await expect(confirm.getByRole('button', { name: 'Close' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Reset' }).click();

    await expect(builder(page)).toBeHidden();

    await expect(pins(page)).toHaveCount(0);
    await expect(peek(page).getByRole('tablist')).toHaveCount(0);
    // research/10 §5 L166: the old pin leads the group.
    expect(await savedTitle(page)).toMatchObject({ pageLayoutPlacements: [{ id: 'p-due', place: 'group' }], pageLayoutSections: [] });
  });

  // research/33 §3.10: title weight 500, body 12px. research/10 §5: Reset is a filled red button,
  // with a U-turn glyph, a ×, a 17px title and a grey borderless Cancel.
  // Notion's body grey and red fail AA, so Blok keeps its secondary ink and AA red.
  // research/36 §8.2: Reset's label is white in light; research/37:134: white in dark too.
  for (const [scheme, body, label] of [['light', 'rgb(114, 111, 106)', 'rgb(255, 255, 255)'], ['dark', 'rgb(173, 169, 163)', 'rgb(255, 255, 255)']] as const) {
    test(`the Reset confirm draws Notion's look in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mount(page, blocks({ pageLayoutPlacements: [{ id: 'p-due', place: 'heading' }], pageLayoutSections: [] }));
      await openRow(page, 'r1');
      await peek(page).hover();
      await peek(page).getByRole('button', { name: 'Customize layout' }).click();
      await builder(page).getByRole('button', { name: 'More save options' }).click();
      await page.getByRole('menuitem', { name: /Reset to original page layout/ }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Reset to original page layout?' });
      const read = (locator: Locator, props: string[]): Promise<string[]> =>
        locator.evaluate((el, names) => names.map((name) => getComputedStyle(el).getPropertyValue(name)), props);

      // The entrance scales the box; measure after it lands.
      await confirm.evaluate((box) => Promise.all(box.getAnimations({ subtree: true }).map((animation) => animation.finished)));

      // 226 tall with a one-line title. A wider OS font (Linux CI) wraps the title, so the title's own height is left out.
      expect(await confirm.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const title = el.querySelector('[data-blok-database-confirm-title]')?.getBoundingClientRect().height ?? 0;

        return [box.width, box.height - title];
      })).toEqual([300, 204]);
      expect(await read(confirm.locator('[data-blok-database-confirm-title]'), ['font-weight', 'font-size'])).toEqual(['600', '17px']);
      expect(await read(confirm.getByRole('button', { name: 'Close' }), ['width', 'height'])).toEqual(['22px', '22px']);
      await expect(confirm.locator('[data-blok-database-confirm-art] svg')).toBeVisible();
      await expect(confirm.getByRole('button', { name: 'Close' })).toBeVisible();
      expect(await read(confirm.getByRole('button', { name: 'Cancel' }), ['border-top-color', 'background-color', 'color']))
        .toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', body]);
      expect(await read(confirm.locator('[data-blok-database-confirm-description]'), ['font-size', 'color'])).toEqual(['14px', body]);
      expect(await read(confirm.getByRole('button', { name: 'Reset' }), ['background-color', 'color']))
        .toEqual(['rgb(182, 79, 70)', label]);
      await confirm.getByRole('button', { name: 'Cancel' }).click();
    });
  }

  // research/10 §2 and research/11 §2a: a view tab links a data source; after Apply every row page shows it.
  test('adds a view tab from the hover-only Add tab and shows the whole linked database on every row page', async ({ page }) => {
    await mount(page, blocks({ pageLayoutPlacements: [], pageLayoutSections: [] }));
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await builder(page).getByRole('button', { name: 'Tabbed' }).click();
    const strip = builder(page).getByRole('tablist');
    const addTab = builder(page).getByRole('button', { name: 'Add tab' });

    // Shown on hover only, but kept in the DOM so keyboard and touch reach it.
    await expect(addTab).toHaveCSS('opacity', '0');
    await strip.hover();
    await expect(addTab).toHaveCSS('opacity', '1');
    await addTab.click();
    await page.getByRole('button', { name: 'Link existing data source' }).click();
    await page.locator('[data-blok-testid="database-layout-source-db-1"]').click();
    await page.getByRole('textbox', { name: 'View name' }).fill('Roadmap');
    await page.getByTestId('database-layout-add-view').click();
    await expect(strip.getByRole('tab', { name: 'Roadmap' })).toHaveAttribute('aria-selected', 'true');
    await builder(page).getByRole('button', { name: 'Apply to all pages' }).click();
    await expect(builder(page)).toBeHidden();

    await expect(peek(page).getByRole('tab', { name: 'Roadmap' })).toHaveAttribute('aria-selected', 'true');
    const panel = peek(page).locator('[data-blok-database-drawer-tab-panel]');

    // The whole linked database: both rows, not only the open one.
    await expect(panel.getByRole('grid')).toBeVisible();
    await expect(panel.getByRole('grid')).toContainText('Alpha');
    await expect(panel.getByRole('grid')).toContainText('Bravo');
    await peek(page).getByRole('tab', { name: 'Content' }).click();
    await expect(panel).toHaveCount(0);
    expect(await savedTitle(page)).toMatchObject({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: expect.any(String) });
  });

  // research/11 §4, research/13 §3: the link names the row and the view tab, and opens both.
  test('copies a link to a view tab that opens the row page on that tab', async ({ page }) => {
    const data = blocks({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' });

    (data[0] as { content: string[] }).content.push('lt');
    data.push(
      { id: 'lt', type: 'tabs', parent: 'db-1', data: {}, content: ['tc', 'tv'] },
      { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
      { id: 'tv', type: 'tab', parent: 'lt', data: { title: 'Roadmap' }, content: ['lv'] },
      {
        id: 'lv',
        type: 'database',
        parent: 'tv',
        data: {
          title: '',
          schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'lvv', name: 'Roadmap', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'lvv',
          source: { databaseId: 'db-1' },
        },
      },
    );
    await mount(page, data);
    // A stub, so the copy reads the same in every browser without a permission prompt.
    await page.evaluate(() => {
      const copied: string[] = [];

      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
      (window as unknown as { copied: string[] }).copied = copied;
    });
    // The layout's hidden tabs block also holds a grid listing r2.
    const row = page.locator('[data-blok-database-table-row][data-row-id="r2"]').filter({ visible: true });

    await row.hover();
    await row.locator('[data-blok-database-table-open]').click();
    const roadmap = peek(page).getByRole('tab', { name: 'Roadmap' });

    await roadmap.click();
    await roadmap.click();
    await page.getByRole('menuitem', { name: 'Copy link to view' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy link to view' })).toHaveCount(0);
    const link = await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);

    expect(new URL(link).hash).toBe('#r2?v=tv');

    await page.evaluate((url) => window.history.replaceState(null, '', url), link);
    await mount(page, data);

    await expect(peek(page).getByRole('textbox', { name: 'Card title' })).toHaveValue('Bravo');
    await expect(peek(page).getByRole('tab', { name: 'Roadmap' })).toHaveAttribute('aria-selected', 'true');
  });

  // research/13 §3a: view tabs that do not fit collapse into "N more…", a searchable list of every tab.
  test('moves the row page tabs that do not fit into "N more…", whose list switches tabs', async ({ page }) => {
    const names = Array.from({ length: 10 }, (_, i) => `Roadmap view ${i + 1}`);
    const data = blocks({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' });

    (data[0] as { content: string[] }).content.push('lt');
    data.push(
      { id: 'lt', type: 'tabs', parent: 'db-1', data: {}, content: ['tc', ...names.map((_, i) => `tv${i}`)] },
      { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
      ...names.flatMap((name, i): OutputBlockData[] => [
        { id: `tv${i}`, type: 'tab', parent: 'lt', data: { title: name }, content: [`lv${i}`] },
        {
          id: `lv${i}`,
          type: 'database',
          parent: `tv${i}`,
          data: {
            title: '',
            schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
            views: [{ id: `lvv${i}`, name, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
            activeViewId: `lvv${i}`,
            source: { databaseId: 'db-1' },
          },
        },
      ]),
    );
    await mount(page, data);
    const row = page.locator('[data-blok-database-table-row][data-row-id="r2"]').filter({ visible: true });

    await row.hover();
    await row.locator('[data-blok-database-table-open]').click();

    const more = peek(page).getByRole('button', { name: /^\d+ more…$/ });

    await expect(more).toBeVisible();
    await expect(peek(page).getByRole('tab', { name: 'Roadmap view 10' })).toBeHidden();

    await more.click();
    await expect(page.getByPlaceholder('Search for a view...')).toBeFocused();
    await page.getByPlaceholder('Search for a view...').fill('view 10');
    await page.getByText('Roadmap view 10', { exact: true }).filter({ visible: true }).click();

    await expect(page.getByPlaceholder('Search for a view...')).toHaveCount(0);
    // The lent tabs block keeps its own (hidden) pills, so look in the row page's bar.
    await expect(peek(page).locator('[data-blok-database-drawer-tabs]').getByRole('tab', { name: 'Roadmap view 10', includeHidden: true })).toHaveAttribute('aria-selected', 'true');
    // research/21 §2: the open tab stays in the bar, even one from the list.
    await expect(peek(page).locator('[data-blok-database-drawer-tabs]').getByRole('tab', { name: 'Roadmap view 10' })).toBeVisible();
    await expect(peek(page)).toBeVisible();
  });

  // research/13 §3a: in the builder each view row of "N more…" has a drag handle; Apply saves the order.
  test('reorders the layout tabs by dragging a row of the builder\'s "N more…" list', async ({ page }) => {
    const names = Array.from({ length: 10 }, (_, i) => `Roadmap view ${i + 1}`);
    const data = blocks({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' });

    (data[0] as { content: string[] }).content.push('lt');
    data.push(
      { id: 'lt', type: 'tabs', parent: 'db-1', data: {}, content: ['tc', ...names.map((_, i) => `tv${i}`)] },
      { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
      ...names.flatMap((name, i): OutputBlockData[] => [
        { id: `tv${i}`, type: 'tab', parent: 'lt', data: { title: name }, content: [`lv${i}`] },
        {
          id: `lv${i}`,
          type: 'database',
          parent: `tv${i}`,
          data: {
            title: '',
            schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
            views: [{ id: `lvv${i}`, name, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
            activeViewId: `lvv${i}`,
            source: { databaseId: 'db-1' },
          },
        },
      ]),
    );
    await mount(page, data);
    // The linked views draw the rows too: open the one on screen.
    const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]').filter({ visible: true });

    await row.hover();
    await row.locator('[data-blok-database-table-open]').click();
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await builder(page).getByRole('button', { name: /^\d+ more…$/ }).click();
    const list = page.locator('[data-blok-database-tab-overflow-dropdown]');

    // research/13 §3a: 290px wide, in the top layer above the builder.
    expect((await list.boundingBox())?.width).toBe(290);
    await expect(list).toHaveCSS('padding-top', '4px');
    // A row's accessible name holds its buttons' labels too, so match the name text.
    const option = (name: string): Locator => list.getByRole('option').filter({ has: page.getByText(name, { exact: true }) });
    const handle = option('Roadmap view 10').getByRole('button', { name: 'Drag to reorder' });
    const target = await option('Roadmap view 1').boundingBox();
    const from = await handle.boundingBox();

    if (target === null || from === null) throw new Error('no list rows');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
    await page.mouse.up();

    const order = async (): Promise<string[]> => list.locator('[data-blok-database-tab-overflow-name]').allTextContents();

    expect((await order()).slice(0, 3)).toEqual(['Content', 'Roadmap view 10', 'Roadmap view 1']);
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await builder(page).getByRole('button', { name: 'Apply to all pages' }).click();
    await expect(builder(page)).toBeHidden();

    const saved = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks.find((block) => block.id === 'lt')?.content);

    expect(saved).toEqual(['tc', 'tv9', ...names.slice(0, 9).map((_, i) => `tv${i}`)]);
    await expect(peek(page).locator('[data-blok-database-drawer-tabs]').getByRole('tab').nth(1)).toHaveText('Roadmap view 10');
  });

  // research/09 §2: the Preview switch swaps the canvas; unapplied edits survive.
  // research/13 §1b-1c: a relation is a one-click tab of the related database, filtered to the row page shown.
  test('adds a Related to tab that lists each row page\'s own related rows', async ({ page }) => {
    const view = (id: string): Record<string, unknown> => ({ id, name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] });

    await mount(page, [
      {
        id: 'db-a',
        type: 'database',
        data: {
          title: 'Measure A',
          schema: [
            { id: 'at', name: 'Name', type: 'title', position: 'a0', pageLayoutStructure: 'tabbed' },
            { id: 'rel', name: 'Measure B', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-b', twoWay: true, syncedPropertyId: 'back' } },
          ],
          views: [view('va')],
          activeViewId: 'va',
        },
        content: ['ra', 'rb'],
      },
      { id: 'ra', type: 'database-row', parent: 'db-a', data: { position: 'a0', properties: { at: 'Alpha', rel: ['b1'] } } },
      { id: 'rb', type: 'database-row', parent: 'db-a', data: { position: 'a1', properties: { at: 'Beta' } } },
      {
        id: 'db-b',
        type: 'database',
        data: {
          title: 'Measure B',
          schema: [
            { id: 'bt', name: 'Name', type: 'title', position: 'a0' },
            { id: 'back', name: 'Measure A', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-a', twoWay: true, syncedPropertyId: 'rel' } },
          ],
          views: [view('vb')],
          activeViewId: 'vb',
        },
        content: ['b1', 'b2'],
      },
      { id: 'b1', type: 'database-row', parent: 'db-b', data: { position: 'a0', properties: { bt: 'One', back: ['ra'] } } },
      { id: 'b2', type: 'database-row', parent: 'db-b', data: { position: 'a1', properties: { bt: 'Two' } } },
    ]);
    await openRow(page, 'ra');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    const strip = builder(page).getByRole('tablist');

    await strip.hover();
    await builder(page).getByRole('button', { name: 'Add tab' }).click();
    await expect(page.getByText('Related to Measure A')).toBeVisible();
    await page.getByTestId('database-layout-related-rel').click();
    await expect(strip.getByRole('tab', { name: 'Measure B' })).toHaveAttribute('aria-selected', 'true');
    await builder(page).getByRole('button', { name: 'Apply to all pages' }).click();
    await expect(builder(page)).toBeHidden();
    const panel = peek(page).locator('[data-blok-database-drawer-tab-panel]');

    await expect(panel.getByRole('grid')).toContainText('One');
    await expect(panel.getByRole('grid')).not.toContainText('Two');
    await openRow(page, 'rb');
    await expect(peek(page).getByRole('tab', { name: 'Measure B' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('[data-blok-database-table-row][data-row-id]')).toHaveCount(0);
  });

  test('previews another page from the Preview switch and keeps the draft', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await pinFromHeadingMenu(page, 'Due');

    await builder(page).getByRole('button', { name: 'Preview: Alpha' }).click();
    await expect(page.getByPlaceholder('Search pages…')).toBeFocused();
    await page.keyboard.type('bra');
    await expect(page.getByRole('menuitem', { name: 'Alpha' })).toBeHidden();
    await page.getByRole('menuitem', { name: 'Bravo' }).click();

    await expect(builder(page).getByRole('heading', { name: 'Bravo' })).toBeVisible();
    await expect(builder(page).getByRole('button', { name: 'Preview: Bravo' })).toBeVisible();
    await expect(pins(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-due"]')).toContainText('Monday');
    expect((await savedTitle(page))?.pageLayoutPlacements ?? []).toEqual([]);
  });

  // research/09 §1: with zero rows the builder opens on a "New page" placeholder.
  test('opens Customize page layout on a New page placeholder with no rows', async ({ page }) => {
    const [database] = blocks();

    await mount(page, [{ ...database, content: [] }]);
    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-more').click();
    await page.getByTestId('database-settings-customize-layout').click();

    await expect(builder(page).getByRole('heading', { name: 'New page' })).toBeVisible();
    await expect(peek(page)).toHaveCount(0);
    await builder(page).getByRole('button', { name: 'Preview: New page' }).click();
    const empty = page.getByTestId('popover-item-html').filter({ hasText: 'No results.' });

    await expect(empty).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(empty).toBeHidden();
    await expect(builder(page)).toBeVisible();
    await builder(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(builder(page)).toBeHidden();
  });

  // One Escape = one layer: the peek's "Open pages in" menu closes first, the peek on the next press.
  // research/10 §6: with a template, an empty page lists it, Empty and New template in 32px rows.
  test('picks a template from the empty page picker', async ({ page }) => {
    const data = blocks();

    (data[0] as { content: string[] }).content.push('tA');
    data.push(
      { id: 'tA', type: 'database-row', parent: 'db-1', data: { position: 'b0', template: true, title: 'Tmpl A', properties: { 'p-title': 'Tmpl A', 'p-due': 'Soon' } }, content: ['tp'] },
      { id: 'tp', type: 'paragraph', parent: 'tA', data: { text: 'From template' } },
    );
    await mount(page, data);
    await openRow(page, 'r1');
    const picker = peek(page).locator('[data-blok-database-row-picker]');

    await expect(peek(page).getByText('Press ‘enter’ to continue with an empty page, or pick a template (use ↑ and ↓ to select)')).toBeVisible();
    await expect(picker.getByRole('button')).toHaveText(['Tmpl A', 'Empty', 'New template']);
    const first = picker.getByRole('button', { name: 'Tmpl A' });

    expect((await first.boundingBox())?.height).toBeCloseTo(32, 0);
    const rest = await first.evaluate((el) => getComputedStyle(el).backgroundColor);

    await peek(page).locator('[data-blok-database-drawer-title]').focus();
    await page.keyboard.press('ArrowDown');
    const lit = await first.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color }));
    const channels = lit.bg.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];

    expect(lit.bg).not.toBe(rest);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(10);
    await page.keyboard.press('Enter');

    await expect(peek(page).locator('[data-blok-database-row-body]')).toContainText('From template');
    await expect(picker).toBeHidden();
  });

  // research/09 §9: Full width widens only the full page; both peeks keep their width.
  test('widens the full page and leaves both peeks alone when Full width is on', async ({ page }) => {
    const titleWidth = async (mode: 'full' | 'center' | 'side', fullWidth: boolean): Promise<number> => {
      // A full page leaves #<row>?full in the URL, and a new editor would reopen it full (127c5fdf).
      await page.evaluate(() => history.replaceState(history.state, '', location.pathname + location.search));
      await mount(page, withView(blocks(fullWidth ? { pageLayoutFullWidth: true } : {}), { openPagesIn: mode }));
      await openRow(page, 'r1');
      const title = peek(page).locator('[data-blok-database-drawer-title]');

      await expect(title).toBeVisible();
      await expect(peek(page)).toHaveAttribute('data-peek-mode', mode);

      return (await title.boundingBox())?.width ?? 0;
    };
    const full = [await titleWidth('full', false), await titleWidth('full', true)];

    expect(full[0]).toBeCloseTo(720, 0);
    expect(full[1]).toBeGreaterThan(full[0]);
    expect(await titleWidth('center', true)).toBeCloseTo(await titleWidth('center', false), 0);
    expect(await titleWidth('side', true)).toBeCloseTo(await titleWidth('side', false), 0);
  });

  // research/09 §9: the page's own Full width overrides the layout; the others keep the layout's.
  test('turns Full width off for one page from its Actions menu while the layout is Full width', async ({ page }) => {
    await mount(page, withView(blocks({ pageLayoutFullWidth: true }), { openPagesIn: 'full' }));
    await openRow(page, 'r1');
    const title = peek(page).locator('[data-blok-database-drawer-title]');
    const width = async (): Promise<number> => (await title.boundingBox())?.width ?? 0;

    await expect(title).toBeVisible();
    expect(await width()).toBeGreaterThan(720);

    await peek(page).getByRole('button', { name: 'Page settings & actions' }).click();
    const fullWidth = page.getByRole('switch', { name: 'Full width' });

    await expect(fullWidth).toHaveAttribute('aria-checked', 'true');
    await fullWidth.click();
    await expect(fullWidth).toHaveAttribute('aria-checked', 'false');
    await expect.poll(width).toBeCloseTo(720, 0);

    await page.keyboard.press('Escape');
    await expect(fullWidth).toBeHidden();
    // A full page has no row steps (feel/findings-rowpage R17): go back through its path, then open the next row.
    await peek(page).locator('[data-blok-database-peek-crumb="database"]').click();
    await openRow(page, 'r2');
    await expect(title).toHaveValue('Bravo');
    await expect.poll(width).toBeGreaterThan(720);
  });

  test('leaves both peeks alone when a page has its own Full width', async ({ page }) => {
    const titleWidth = async (mode: 'center' | 'side', rowId: string): Promise<number> => {
      const data = withView(blocks(), { openPagesIn: mode });

      data[1].data.fullWidth = true;
      await mount(page, data);
      await openRow(page, rowId);
      const title = peek(page).locator('[data-blok-database-drawer-title]');

      await expect(title).toBeVisible();
      await expect(peek(page)).toHaveAttribute('data-peek-mode', mode);

      return (await title.boundingBox())?.width ?? 0;
    };

    expect(await titleWidth('center', 'r1')).toBeCloseTo(await titleWidth('center', 'r2'), 0);
    expect(await titleWidth('side', 'r1')).toBeCloseTo(await titleWidth('side', 'r2'), 0);
  });

  test('keeps a Full width page clear of the docked details panel', async ({ page }) => {
    await mount(page, withView(blocks({ pageLayoutFullWidth: true, pageLayoutPlacements: [{ id: 'p-owner', place: 'panel' }] }), { openPagesIn: 'full' }));
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'View details' }).click();
    const panel = await peek(page).getByRole('region', { name: 'Details' }).boundingBox();
    const title = await peek(page).locator('[data-blok-database-drawer-title]').boundingBox();

    expect((title?.x ?? 0) + (title?.width ?? 0)).toBeLessThanOrEqual(panel?.x ?? 0);
  });

  test('closes the Open pages in menu on the first Escape and the peek on the second', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await peek(page).getByRole('button', { name: 'Open pages in' }).click();
    await expect(page.getByRole('menuitem', { name: /Center peek/ })).toBeVisible();
    await expect(peek(page)).toHaveAttribute('data-open', '');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: /Center peek/ })).toBeHidden();
    // A closing side peek stays in the DOM while it slides out; data-open says whether it is open.
    await expect(peek(page)).toHaveAttribute('data-open', '');

    await page.keyboard.press('Escape');
    await expect(peek(page)).toHaveCount(0);
  });
  // research/21 §5: Favorite is a star right before "•••", with the hint "Add to your favorites".
  test('shows the host\'s Favorite star before Actions and toggles it', async ({ page }) => {
    await page.evaluate(async (input) => {
      await window.blokInstance?.destroy?.();
      document.getElementById('blok')?.remove();
      const holder = document.createElement('div');

      holder.id = 'blok';
      document.body.appendChild(holder);
      window.favoriteRows = [];
      const favorites = {
        isFavorite: ({ rowId }: { rowId: string }) => window.favoriteRows?.includes(rowId) === true,
        onToggle: ({ rowId, favorite }: { rowId: string; favorite: boolean }) => {
          window.favoriteRows = favorite ? [...(window.favoriteRows ?? []), rowId] : (window.favoriteRows ?? []).filter((id) => id !== rowId);
        },
      };

      window.blokInstance = new window.Blok({
        holder,
        data: { blocks: input },
        tools: { database: { class: window.BlokDatabase, config: { favorites } }, 'database-row': { class: window.BlokDatabaseRow } },
      });
      await window.blokInstance.isReady;
    }, blocks());
    await openRow(page, 'r1');
    const star = peek(page).getByRole('button', { name: 'Favorite' });

    await expect(star).toHaveAttribute('aria-pressed', 'false');
    // One frame for both rects: the side peek is still sliding in, so two boundingBox calls read two positions.
    const gap = await peek(page).evaluate((drawer) => {
      const starRect = drawer.querySelector('[data-blok-database-peek-favorite]')?.getBoundingClientRect();
      const actionsRect = drawer.querySelector('[data-blok-database-peek-actions]')?.getBoundingClientRect();

      return starRect === undefined || actionsRect === undefined ? null : actionsRect.left - starRect.right;
    });

    expect(gap).not.toBeNull();
    expect(gap ?? -1).toBeGreaterThanOrEqual(0);
    expect(gap ?? 16).toBeLessThan(16);

    await star.hover();
    await expect(page.getByText('Add to your favorites')).toBeVisible();

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.favoriteRows)).toEqual(['r1']);

    // research/22 §14: a filled yellow star, the "Remove" hint, and no button fill.
    const starFill = (): Promise<string | undefined> => star.evaluate((el) => {
      const path = el.querySelector('path');

      return path === null ? undefined : getComputedStyle(path).fill;
    });

    await expect.poll(starFill).toBe('rgb(246, 192, 80)');
    await page.mouse.move(0, 0);
    await star.hover();
    await expect(page.getByText('Remove from your favorites')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(star).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(starFill).toBe('none');
  });
});

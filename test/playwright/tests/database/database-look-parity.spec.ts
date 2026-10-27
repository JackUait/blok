/**
 * Computed look against Notion's measured values (research/07 and 08).
 * Reads getComputedStyle and boxes, never the stylesheet text.
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

const LONG_URL = 'https://example.com/a/very/long/path/that/would/wrap/onto/several/lines/if/the/cell/let/it/wrap';

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'p-tags',
    name: 'Tags',
    type: 'multiSelect',
    position: 'a1',
    config: { options: [{ id: 't-x', label: 'X', color: 'red', position: 'a0' }, { id: 't-y', label: 'Y', position: 'a1' }] },
  },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a2' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a3' },
  { id: 'p-mail', name: 'Mail', type: 'email', position: 'a4' },
  { id: 'p-tel', name: 'Tel', type: 'phone', position: 'a5' },
  { id: 'p-file', name: 'Attachment', type: 'files', position: 'a6' },
  { id: 'p-act', name: 'Act', type: 'button', position: 'a7', button: { label: 'Run', buttonActions: [] } },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a8',
    config: { options: [{ id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }] },
  },
];

const ROWS: Array<{ id: string; properties: Record<string, unknown> }> = [
  {
    id: 'r1',
    properties: {
      'p-title': 'Alpha',
      'p-tags': ['t-x', 't-y'],
      'p-link': LONG_URL,
      'p-mail': 'a@example.com',
      'p-tel': '+1 555 0100',
      'p-file': [{ id: 'f1', name: 'brief.pdf', url: 'https://example.com/brief.pdf' }],
      'p-stage': 'o-idea',
    },
  },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-done': true, 'p-stage': 'o-idea' } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [
        // Unwrapped: a table wraps by default, and the long URL would grow its row. Notion's URL wrap is unmeasured.
        { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], wrapCells: false },
        { id: 'v2', name: 'Board', type: 'board', position: 'a1', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: ['p-title'] },
      ],
      activeViewId: 'v1',
    },
    content: ROWS.map((r) => r.id),
  },
  ...ROWS.map((r, i) => ({
    id: r.id,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: r.properties },
  })),
];

const mount = async (page: Page, documentId?: string, input: OutputBlockData[] = blocks()): Promise<void> => {
  await page.evaluate(async ({ input, documentId: docId }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    // A documentId scopes api.viewState, so personal state survives a remount.
    window.blokInstance = new window.Blok({ holder, ...(docId === undefined ? {} : { documentId: docId }), data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { input, documentId });
  await expect(page.getByRole('grid')).toBeVisible();
};

const style = (locator: Locator, props: string[]): Promise<Record<string, string>> => locator.evaluate((el, names) => {
  const cs = getComputedStyle(el);

  return Object.fromEntries(names.map((name) => [name, cs.getPropertyValue(name)]));
}, props);

const tab = (page: Page, viewId: string): Locator => page.locator(`[data-blok-database-tab][data-view-id="${viewId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.emulateMedia({ colorScheme: 'light' });
  await mount(page);
});

test('view tabs: 32px pill, 6px 12px, label 14px 500, Notion ink (research/07:45-50)', async ({ page }) => {
  const active = tab(page, 'v1');
  const inactive = tab(page, 'v2');

  expect((await active.boundingBox())?.height).toBe(32);
  expect(await style(active, ['padding-top', 'padding-left', 'border-top-left-radius', 'font-size', 'font-weight', 'background-color', 'color'])).toEqual({
    'padding-top': '6px',
    'padding-left': '12px',
    // The pill role: on a 32px tab it draws the same round end as Notion's 20px.
    'border-top-left-radius': '9999px',
    'font-size': '14px',
    'font-weight': '500',
    'background-color': 'rgba(33, 27, 23, 0.05)',
    'color': 'rgb(44, 44, 43)',
  });
  expect((await style(inactive, ['color'])).color).toBe('rgb(114, 111, 106)');
  expect(await active.evaluate((el) => el.querySelector('svg')?.getBoundingClientRect().width)).toBe(20);
});

test('toolbar Filter and Sort are 28px icon buttons in Notion icon gray (research/07:53)', async ({ page }) => {
  for (const testId of ['database-toolbar-filter', 'database-toolbar-sort']) {
    const button = page.getByTestId(testId);
    const box = await button.boundingBox();

    expect([box?.width, box?.height]).toEqual([28, 28]);
    await expect(button).toHaveText('');
    expect(await button.evaluate((el) => el.querySelectorAll('svg').length)).toBe(1);
    expect((await style(button, ['color'])).color).toBe('rgb(142, 139, 134)');
  }
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
});

test('rows stay 37px with Files and Button columns and a long URL (research/07:70, 08:380)', async ({ page }) => {
  for (const rowId of ['r1', 'r2']) {
    expect((await page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`).boundingBox())?.height).toBe(37);
  }
});

test('URL, email and phone cells are ink with no underline (research/08:279)', async ({ page }) => {
  for (const propertyId of ['p-link', 'p-mail', 'p-tel']) {
    const link = cell(page, 'r1', propertyId).locator('[data-blok-database-cell-link]');

    expect(await style(link, ['color', 'text-decoration-line'])).toEqual({ 'color': 'rgb(44, 44, 43)', 'text-decoration-line': 'none' });
  }
});

test('cell deltas: multi-select gap 8, button 500 (research/07:98; 08:280)', async ({ page }) => {
  const pills = cell(page, 'r1', 'p-tags').locator('[data-blok-database-option-pill]');
  const first = await pills.nth(0).boundingBox();
  const second = await pills.nth(1).boundingBox();

  expect(Math.round((second?.x ?? 0) - ((first?.x ?? 0) + (first?.width ?? 0)))).toBe(8);
  expect(await style(cell(page, 'r1', 'p-act').locator('[data-blok-database-button]'), ['font-weight', 'line-height'])).toEqual({ 'font-weight': '500', 'line-height': '16.8px' });
});

test('board card: 40px, ink title, white action pill with the menu shadow (research/07:135, 08:73,317)', async ({ page }) => {
  await tab(page, 'v2').click();
  const card = page.locator('[data-blok-database-card][data-row-id="r2"]');

  await expect(card).toBeVisible();
  expect((await card.boundingBox())?.height).toBe(40);
  expect((await card.boundingBox())?.width).toBe(260);
  expect((await style(card.locator('[data-blok-database-card-title]'), ['color'])).color).toBe('rgb(44, 44, 43)');

  await card.hover();
  const actions = card.locator('[data-blok-database-card-actions]');

  await expect(actions).toHaveCSS('opacity', '1');
  expect(await style(actions, ['background-color', 'box-shadow', 'transition-duration'])).toEqual({
    'background-color': 'rgb(255, 255, 255)',
    'box-shadow': 'rgba(25, 25, 25, 0.027) 0px 8px 12px 0px, rgba(25, 25, 25, 0.027) 0px 2px 6px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px',
    'transition-duration': '0.2s',
  });
  expect((await actions.boundingBox())?.height).toBe(24);
  expect((await style(card.locator('[data-blok-database-card-menu]'), ['color'])).color).toBe('rgb(125, 122, 117)');
});

test('side peek: labels in the database secondary ink, 34px rows (research/08:329)', async ({ page }) => {
  await tab(page, 'v2').click();
  await page.locator('[data-blok-database-card][data-row-id="r2"] [data-blok-database-card-title]').click();
  const row = page.locator('[data-blok-database-drawer-prop-row]').first();

  await expect(row).toBeVisible();
  expect((await row.boundingBox())?.height).toBe(34);
  expect((await style(row.locator('[data-blok-database-drawer-prop-label]'), ['color'])).color).toBe('rgb(114, 111, 106)');
});

test('side peek: measured shadow with its ring, a 160x34 label hover cell, no value hover (research/08:329, 21 §1m, 26 §5f)', async ({ page }) => {
  await tab(page, 'v2').click();
  await page.locator('[data-blok-database-card][data-row-id="r2"] [data-blok-database-card-title]').click();
  const drawer = page.locator('[data-blok-database-drawer]');
  const label = drawer.locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: 'Mail' });
  const head = drawer.locator('[data-blok-database-drawer-prop-head]', {
    has: page.locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: 'Mail' }),
  });
  const value = drawer.locator('[data-blok-database-drawer-prop-value][data-property-id="p-mail"]');

  await expect(drawer).toHaveCSS('transform', 'none');
  await expect(drawer).toHaveCSS('box-shadow', 'rgba(25, 25, 25, 0.027) 0px 8px 12px 0px, rgba(25, 25, 25, 0.027) 0px 2px 6px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px');
  await expect(drawer).toHaveCSS('border-left-width', '0px');
  // Light title ink is unmeasured: it keeps the ink the panel already has.
  const title = drawer.locator('[data-blok-database-drawer-title]');

  expect((await style(title, ['color'])).color).toBe((await style(drawer, ['color'])).color);

  await label.hover();
  await expect(head).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(head).toHaveCSS('border-radius', '6px');
  const box = await head.boundingBox();

  expect(box?.width).toBe(160);
  expect(box?.height).toBe(34);

  // The hover box is the click target. findings-rowpage R09: on hover the glyph's place holds the ⋮⋮, and a click on it opens the property menu.
  // The glyph fades out under the ⋮⋮ rather than leaving the layout, so it stays "visible" to toBeHidden.
  await expect(head.locator('[data-blok-database-drawer-prop-icon]')).toHaveCSS('opacity', '0');
  await expect(head.locator('[data-blok-database-drawer-prop-handle]')).toHaveCSS('opacity', '1');
  const handle = await head.locator('[data-blok-database-drawer-prop-handle]').boundingBox();

  expect(handle).not.toBeNull();
  await page.mouse.click((handle?.x ?? 0) + 4, (handle?.y ?? 0) + 4);
  // findings-rowpage R07 (0e99d7ed): the label opens the row page's own menu, which starts with Rename.
  await expect(page.getByRole('menu').getByRole('menuitem').first()).toHaveText('Rename');
  await page.keyboard.press('Escape');

  // research/26 §5f: a light value cell has no hover fill.
  await value.hover();
  await expect(value).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('builder Structure tiles: unselected label rgb(115, 114, 110), selected rgb(29, 27, 22) 600 (research/10 §2)', async ({ page }) => {
  await tab(page, 'v2').click();
  await page.locator('[data-blok-database-card][data-row-id="r2"] [data-blok-database-card-title]').click();
  const drawer = page.locator('[data-blok-database-drawer]');

  await drawer.hover();
  await drawer.getByRole('button', { name: 'Customize layout' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize page layout' });

  await expect(dialog.locator('[data-blok-database-layout-structure-card][aria-pressed="true"]')).toHaveCSS('color', 'rgb(29, 27, 22)');
  await expect(dialog.locator('[data-blok-database-layout-structure-card][aria-pressed="false"]')).toHaveCSS('color', 'rgb(115, 114, 110)');
});

test('"Display as" Icon only hides tab names visually, keeps them named, and survives a remount (research/03 §1.2)', async ({ page }) => {
  const documentId = `look-parity-${Date.now()}`;

  await mount(page, documentId);
  await tab(page, 'v1').click({ button: 'right' });
  await page.getByText('Display as', { exact: true }).hover();
  await page.getByText('Icon only', { exact: true }).click();

  const name = tab(page, 'v2').locator('[data-blok-database-tab-name]');

  expect((await name.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();

  await mount(page, documentId);
  await expect(page.locator('[data-blok-database-tab-bar]')).toHaveAttribute('data-display', 'icon');
});

const LEDGER_SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a1' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a2',
    config: { options: [{ id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }, { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' }] },
  },
];

/** A table with a Sum footer, the same table grouped by Stage, and a board. */
const ledgerBlocks = (): OutputBlockData[] => [
  {
    id: 'db-2',
    type: 'database',
    data: {
      schema: LEDGER_SCHEMA,
      views: [
        { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], calculations: [{ id: 'p-amount', fn: 'sum' }] },
        { id: 'v2', name: 'By stage', type: 'table', position: 'a1', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: [] },
        { id: 'v3', name: 'Board', type: 'board', position: 'a2', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: ['p-title'] },
      ],
      activeViewId: 'v1',
    },
    content: ['l1', 'l2'],
  },
  { id: 'l1', type: 'database-row', parent: 'db-2', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-amount': 1200, 'p-stage': 'o-idea' } } },
  { id: 'l2', type: 'database-row', parent: 'db-2', data: { position: 'a1', properties: { 'p-title': 'Bravo', 'p-amount': 35, 'p-stage': 'o-build' } } },
];

/** rotate(θ) as Chromium reports it: matrix(cos θ, sin θ, -sin θ, cos θ, 0, 0). */
const rotationDegrees = (transform: string): number | null => {
  const match = /^matrix\(([^)]+)\)$/.exec(transform);

  if (match === null) return null;
  const [a, b] = match[1].split(',').map(Number);

  return Math.round(Math.atan2(b, a) * 180 / Math.PI);
};

test.describe('measured values the CSS snapshot used to pin alone (ledger OM6)', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, undefined, ledgerBlocks());
  });

  test('"+ New page" row: 36px row, 8px start pad, 14px/20px tertiary ink, 16px icon at 1px/7px; the hover fills the 28px button only (research/08:262, research/22 §12)', async ({ page }) => {
    const add = page.locator('[data-blok-database-table-add-row]').first();
    const box = await add.boundingBox();

    expect(box?.height).toBe(28);
    expect(await style(add, ['margin-top', 'margin-bottom', 'border-radius'])).toEqual({ 'margin-top': '4px', 'margin-bottom': '4px', 'border-radius': '6px' });
    expect(await style(add, ['padding-left', 'font-size', 'line-height', 'color'])).toEqual({
      'padding-left': '8px',
      'font-size': '14px',
      'line-height': '20px',
      'color': 'rgb(114, 111, 106)',
    });

    // The icon wrapper is the button's first child; the svg inside it.
    const icon = await add.evaluate((el) => {
      const wrap = el.firstElementChild;
      const cs = wrap === null ? null : getComputedStyle(wrap);
      const box = wrap?.firstElementChild?.getBoundingClientRect();

      return { color: cs?.color, marginLeft: cs?.marginLeft, marginRight: cs?.marginRight, size: [box?.width, box?.height] };
    });

    expect(icon).toEqual({ color: 'rgb(173, 169, 163)', marginLeft: '1px', marginRight: '7px', size: [16, 16] });

    // Notion: 105x28, the text's width, not the row's.
    expect(Math.abs((box?.width ?? 0) - 105)).toBeLessThanOrEqual(8);

    await add.hover();
    await expect(add).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
  });

  test('a number cell is right-aligned: its value ends at the cell\'s content edge (research/08:273)', async ({ page }) => {
    const numberCell = cell(page, 'l1', 'p-amount');

    expect((await style(numberCell, ['text-align']))['text-align']).toBe('end');
    const gap = await numberCell.evaluate((el) => {
      const value = el.querySelector('[data-blok-database-cell="number"]');
      const range = document.createRange();

      range.selectNodeContents(value ?? el);
      const cs = getComputedStyle(el);
      const contentRight = el.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);

      return contentRight - range.getBoundingClientRect().right;
    });

    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
  });

  test('footer label: 10px/15px 500 uppercase, 1px tracking, tertiary ink, 4px before the value (research/08:215)', async ({ page }) => {
    const label = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"] [data-blok-database-table-calc-label]');

    await expect(label).toBeVisible();
    expect(await style(label, ['font-size', 'line-height', 'font-weight', 'text-transform', 'letter-spacing', 'color', 'margin-right'])).toEqual({
      'font-size': '10px',
      'line-height': '15px',
      'font-weight': '500',
      'text-transform': 'uppercase',
      'letter-spacing': '1px',
      'color': 'rgb(114, 111, 106)',
      'margin-right': '4px',
    });
    expect(await label.evaluate((el) => (el instanceof HTMLElement ? el.innerText : ''))).toBe('SUM');
  });

  test('a database menu grows from the anchor\'s corner: top-left under a header (research/08:125)', async ({ page }) => {
    const header = page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"] [data-blok-database-table-column-button]');

    await header.click();
    const container = page.locator('[data-blok-popover][data-blok-popover-custom-class~="blok-database-menu"][data-blok-popover-opened="true"] [data-blok-popover-container]');

    await expect(container).toBeVisible();
    expect((await style(container, ['transform-origin']))['transform-origin']).toBe('0px 0px');

    const anchorBox = await header.boundingBox();
    const menuBox = await container.boundingBox();

    // The origin corner is the one nearest the anchor: the menu hangs below it, start edges lined up.
    expect(Math.abs((menuBox?.x ?? 0) - (anchorBox?.x ?? 0))).toBeLessThanOrEqual(8);
    expect((menuBox?.y ?? 0)).toBeGreaterThanOrEqual((anchorBox?.y ?? 0) + (anchorBox?.height ?? 0) - 1);
  });

  test('grouped table: collapse removes rows at once and turns only the caret -90deg over 200ms ease-out (research/08:134)', async ({ page }) => {
    await tab(page, 'v2').click();
    const section = page.locator('[data-blok-database-table-group][data-group-key="o-idea"]');
    const svg = section.locator('[data-blok-database-table-group-toggle] svg');

    await expect(section.locator('[data-row-id="l1"]').first()).toBeVisible();
    expect(await style(svg, ['transition-property', 'transition-duration', 'transition-timing-function'])).toEqual({
      'transition-property': 'transform',
      'transition-duration': '0.2s',
      'transition-timing-function': 'ease-out',
    });

    // Rows leave in the same task as the click: no height animation holds them.
    const rowsAfterClick = await section.evaluate((el) => {
      el.querySelector<HTMLElement>('[data-blok-database-table-group-toggle]')?.click();

      return el.querySelectorAll('[data-row-id="l1"]').length;
    });

    expect(rowsAfterClick).toBe(0);
    await expect.poll(async () => rotationDegrees((await style(svg, ['transform'])).transform)).toBe(-90);
  });

  test('a view tab switch swaps the body in one frame, with no cross-fade (research/08:140)', async ({ page }) => {
    const swap = await page.evaluate(() => {
      const root = document.querySelector('[data-blok-database-board-container]');

      document.querySelector<HTMLElement>('[data-blok-database-tab][data-view-id="v3"]')?.click();
      // Same task as the click: the old body is gone and the new one is in.
      const bodyAnimations = document.getAnimations().filter((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;

        return target !== null && root?.contains(target) === true;
      });

      return {
        grid: root?.querySelector('[role="grid"]') !== null,
        board: root?.querySelector('[data-blok-database-board]') !== null,
        animations: bodyAnimations.map((animation) => animation instanceof CSSTransition ? animation.transitionProperty : animation.constructor.name),
        opacity: getComputedStyle(root?.firstElementChild ?? document.body).opacity,
      };
    });

    expect(swap).toEqual({ grid: false, board: true, animations: [], opacity: '1' });
  });
});

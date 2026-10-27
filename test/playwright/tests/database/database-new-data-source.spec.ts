/**
 * "New data source" (research/23 §10): a second source inside one database
 * block, with its own schema and rows, and a Table view bound to it.
 */

import { readFileSync } from 'node:fs';

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

const NAMES = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const initial: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Projects',
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: NAMES.map((name, i) => ({
        id: `v${i}`, name, type: 'table', position: `a${i}`, sorts: [], filters: [], visibleProperties: [],
      })),
      activeViewId: 'v0',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const bound: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Projects',
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [
        { id: 'v0', name: 'Own', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
        { id: 'vb', name: 'Second', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: [], dataSourceId: 'src-b' },
      ],
      activeViewId: 'vb',
    },
    content: ['r1', 'src-b'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
  {
    id: 'src-b',
    type: 'database',
    parent: 'db-1',
    data: {
      title: 'Inventory',
      schema: [
        { id: 'b-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'b-stage', name: 'Stage', type: 'select', position: 'a1', config: { options: [
          { id: 'todo', label: 'Todo', color: 'gray', position: 'a0' },
          { id: 'done', label: 'Done', color: 'green', position: 'a1' },
        ] } },
      ],
      views: [{ id: 'bv', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'bv',
    },
    content: ['b1'],
  },
  { id: 'b1', type: 'database-row', parent: 'src-b', data: { position: 'a0', properties: { 'b-title': 'Gamma', 'b-stage': 'todo' } } },
];

const mount = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:520px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { data: blocks });
  await expect(page.getByRole('grid')).toBeVisible();
};

const save = (page: Page): Promise<OutputBlockData[]> =>
  page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const openList = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /more…$/ }).click();
  await expect(page.locator('[data-blok-database-tab-overflow-dropdown]')).toBeVisible();
};

const grid = (page: Page) => page.getByRole('grid');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database New data source', () => {
  test('a second source keeps its own rows and property through views and a reload', async ({ page }) => {
    await mount(page, initial);
    await openList(page);
    await page.getByRole('option', { name: 'New data source' }).click();

    // The new Table view is selected and shows only the title property.
    await expect(grid(page).getByRole('columnheader')).toHaveCount(1);
    await expect(grid(page)).not.toContainText('Alpha');
    // The title line is the new source's: empty, so it shows the placeholder.
    await expect(page.locator('[data-blok-database-source-title]')).toHaveAttribute('data-placeholder', 'New data source');
    await expect(page.locator('[data-blok-database-source-title]')).not.toHaveAttribute('hidden', '');
    await expect(page.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Table' })).toBeVisible();

    // A row and a property on the new source.
    await grid(page).locator('[data-blok-database-table-add-row]').first().click();
    await expect(page.locator('[data-blok-database-cell-editor]')).toBeVisible();
    await page.keyboard.type('Beta');
    await page.keyboard.press('Enter');
    await expect(grid(page)).toContainText('Beta');
    await grid(page).locator('[data-blok-database-table-add-property]').click();
    await page.locator('[data-blok-database-property-type-option="text"]').click();
    await page.keyboard.press('Escape');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
    await expect(grid(page)).toContainText('Beta');

    // Back on the first source: its own row, its one property. At this width its tab
    // may be folded into "N more…", so pick it from the list.
    await openList(page);
    await page.locator('[data-blok-database-tab-overflow-item]').first().click();
    await expect(grid(page)).toContainText('Alpha');
    await expect(grid(page)).not.toContainText('Beta');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(1);

    // save → render.
    const saved = await save(page);
    const source = saved.find((block) => block.type === 'database' && block.id !== 'db-1');

    expect(source).toBeDefined();
    expect(saved.filter((block) => block.type === 'database-row' && block.parent === source?.id)).toHaveLength(1);
    await mount(page, saved);
    await expect(grid(page)).toContainText('Alpha');

    await openList(page);
    await page.locator('[data-blok-database-tab-overflow-item]').last().click();
    await expect(grid(page)).toContainText('Beta');
    await expect(grid(page)).not.toContainText('Alpha');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
  });

  test('Layout switches a second source\'s view to a board of its rows, and CSV exports them', async ({ page }) => {
    await mount(page, bound);
    const settings = page.getByTestId('database-toolbar-settings');

    await settings.click();
    await page.getByTestId('database-settings-layout').click();
    await page.getByTestId('database-layout-board').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const board = page.locator('[data-blok-database-board]');

    await expect(board).toBeVisible();
    await expect(board).toContainText('Gamma');
    await expect(board).toContainText('Todo');
    await expect(board).not.toContainText('Alpha');

    // A card added in Done lands in the second source, in Done.
    await board.locator('[data-blok-database-add-card][data-option-id="done"]').click();
    await expect.poll(async () => {
      const saved = await save(page);

      return saved.filter((block) => block.type === 'database-row' && block.parent === 'src-b')
        .map((block) => (block.data as { properties: Record<string, unknown> }).properties['b-stage']);
    }).toEqual(['todo', 'done']);
    const views = (await save(page)).find((block) => block.id === 'db-1')?.data as { views: Array<{ id: string; type: string; groupBy?: string }> };

    expect(views.views.find((view) => view.id === 'vb')).toMatchObject({ type: 'board', groupBy: 'b-stage' });

    await settings.click();
    // CSV actions sit under More settings (feel/findings-toolbar V12).
    await page.getByTestId('database-settings-more').click();
    const download = page.waitForEvent('download');

    await page.getByTestId('database-settings-csv-export').click();
    const csv = readFileSync(await (await download).path(), 'utf8');

    expect(csv).toContain('Gamma');
    expect(csv).not.toContain('Alpha');
  });

  test('View settings "Source" moves a view onto the other source and back', async ({ page }) => {
    const table = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      id, name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...extra,
    });

    await mount(page, [
      {
        id: 'db-1', type: 'database', content: ['r1', 'src-b'],
        data: {
          title: 'Projects',
          schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [table('v0', { name: 'First' }), table('vb', { name: 'Second', position: 'a1', dataSourceId: 'src-b' })],
          activeViewId: 'v0',
        },
      },
      { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
      {
        id: 'src-b', type: 'database', parent: 'db-1', content: ['b1'],
        data: { title: 'Src B', schema: [{ id: 'b-title', name: 'Name', type: 'title', position: 'a0' }], views: [table('bv')], activeViewId: 'bv' },
      },
      { id: 'b1', type: 'database-row', parent: 'src-b', data: { position: 'a0', properties: { 'b-title': 'Beta' } } },
    ]);
    await expect(grid(page)).toContainText('Alpha');

    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-source').click();
    await expect(page.getByTestId('database-source-search')).toHaveAttribute('placeholder', 'Link to a data source…');
    await page.getByTestId('database-source-option-src-b').click();
    await expect(grid(page)).toContainText('Beta');
    await expect(grid(page)).not.toContainText('Alpha');

    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-source').click();
    await page.getByTestId('database-source-option-db-1').click();
    await expect(grid(page)).toContainText('Alpha');
    const views = (await save(page)).find((block) => block.id === 'db-1')?.data as { views: Array<{ id: string; dataSourceId?: string }> };

    expect(views.views.find((view) => view.id === 'v0')?.dataSourceId).toBeUndefined();
  });

  test.describe('the "New data source" panel', () => {
    const withOther: OutputBlockData[] = [
      ...initial,
      {
        id: 'db-2', type: 'database', content: ['o1'],
        data: {
          title: 'Stock',
          schema: [{ id: 'o-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'ov', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'ov',
        },
      },
      { id: 'o1', type: 'database-row', parent: 'db-2', data: { position: 'a0', properties: { 'o-title': 'Omega' } } },
    ];
    const firstGrid = (page: Page) => page.locator('[data-blok-id="db-1"]').getByRole('grid').first();
    const panel = (page: Page) => page.getByTestId('database-new-source-panel');

    const openPanel = async (page: Page): Promise<void> => {
      await openList(page);
      await page.getByRole('option', { name: 'New data source' }).click();
      await expect(panel(page)).toBeVisible();
    };

    test('opens with the measured rows, and Import CSV fills the new source', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);

      await expect(page.getByTestId('database-new-source-search')).toHaveAttribute('placeholder', 'Search…');
      await expect(page.getByTestId('database-new-source-search')).toBeFocused();
      await expect(panel(page)).toContainText('New empty data source');
      await expect(panel(page)).not.toContainText('Suggested');

      await page.getByTestId('database-new-source-csv').click();
      const dialog = page.getByRole('dialog');

      await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Size\nNut,3\nBolt,5') });
      await dialog.getByTestId('database-csv-map').click();
      await dialog.getByTestId('database-csv-import').click();

      await expect(grid(page)).toContainText('Nut');
      await expect(grid(page)).toContainText('Bolt');
      await expect(grid(page)).not.toContainText('Alpha');
      await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
      // research/27 §2: the title stays the placeholder, not the file name.
      await expect(page.locator('[data-blok-database-source-title]')).toHaveText('');
      const saved = await save(page);
      const source = saved.find((block) => block.type === 'database' && block.parent === 'db-1');

      expect(saved.filter((block) => block.type === 'database-row' && block.parent === source?.id)).toHaveLength(2);
    });

    test('New empty data source closes it and keeps the empty source', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);
      await page.getByTestId('database-new-source-empty').click();

      await expect(panel(page)).toBeHidden();
      await expect(grid(page).getByRole('columnheader')).toHaveCount(1);
      expect((await save(page)).filter((block) => block.type === 'database' && block.parent === 'db-1')).toHaveLength(1);
    });

    // research/26 §1b, r26:116: the round × of View settings; closing keeps the empty source.
    test('a 20px round × closes it from the panel and from Link to existing, keeping the empty source', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);
      const close = panel(page).getByRole('button', { name: 'Close', exact: true });

      await expect(close).toBeVisible();
      expect(await close.evaluate((el: HTMLElement) => ({ width: el.offsetWidth, height: el.offsetHeight }))).toEqual({ width: 20, height: 20 });
      await expect(close).toHaveCSS('border-radius', '50%');
      await expect(close).toHaveCSS('background-color', 'rgba(42, 28, 0, 0.07)');
      await close.hover();
      await expect(close).toHaveCSS('background-color', 'rgba(42, 28, 0, 0.106)');

      await page.getByTestId('database-new-source-link').click();
      await expect(panel(page)).toContainText('Link to existing data source');
      await panel(page).getByRole('button', { name: 'Close', exact: true }).click();

      await expect(panel(page)).toBeHidden();
      expect((await save(page)).filter((block) => block.type === 'database' && block.parent === 'db-1')).toHaveLength(1);
    });

    test('Link to existing data source puts the new view on another database of the page', async ({ page }) => {
      await page.evaluate(async ({ data }) => {
        if (window.blokInstance) {
          await window.blokInstance.destroy?.();
          window.blokInstance = undefined;
        }
        document.getElementById('blok')?.remove();
        const holder = document.createElement('div');

        holder.id = 'blok';
        holder.style.cssText = 'max-width:520px;margin:40px auto 0';
        document.body.appendChild(holder);
        window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
        await window.blokInstance.isReady;
      }, { data: withOther });
      await expect(firstGrid(page)).toContainText('Alpha');
      await openPanel(page);
      await page.getByTestId('database-new-source-link').click();
      await expect(panel(page)).toContainText('Existing data sources');
      await page.getByTestId('database-new-source-existing-db-2').click();

      await expect(panel(page)).toBeHidden();
      await expect(firstGrid(page)).toContainText('Omega');
      await expect(firstGrid(page)).not.toContainText('Alpha');
      const saved = await save(page);
      const views = saved.find((block) => block.id === 'db-1')?.data as { views: Array<{ dataSourceId?: string }>; activeViewId: string };

      expect(saved.filter((block) => block.type === 'database' && block.parent === 'db-1')).toHaveLength(0);
      expect(views.views.some((view) => view.dataSourceId === 'db-2')).toBe(true);
    });

    // research/26 §2.
    test('a typed query becomes New “<query>” data source, which names the new source', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);
      await page.getByTestId('database-new-source-search').fill('Stock');

      await expect(page.getByTestId('database-new-source-named')).toHaveText('New \u201CStock\u201D data source');
      await expect(page.getByTestId('database-new-source-csv')).toBeVisible();
      await expect(page.getByTestId('database-new-source-empty')).toHaveCount(0);
      await page.getByTestId('database-new-source-named').click();

      await expect(panel(page)).toBeHidden();
      await expect(page.locator('[data-blok-database-source-title]')).toHaveText('Stock');
      const source = (await save(page)).find((block) => block.type === 'database' && block.parent === 'db-1');

      expect((source?.data as { title?: string } | undefined)?.title).toBe('Stock');
    });

    test('Link to existing data source suggests this database\'s own data first', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);
      await page.getByTestId('database-new-source-link').click();
      await expect(panel(page)).toContainText('Suggested');
      await page.getByTestId('database-new-source-suggested-db-1').click();

      await expect(panel(page)).toBeHidden();
      await expect(firstGrid(page)).toContainText('Alpha');
      expect((await save(page)).filter((block) => block.type === 'database' && block.parent === 'db-1')).toHaveLength(0);
    });
  });

  // research/26 §5a.
  test.describe('deleting the last view of a source', () => {
    const deleteFromTabMenu = async (page: Page): Promise<void> => {
      await page.locator('[data-blok-database-tab][data-view-id="vb"]').click({ button: 'right' });
      await page.locator('[data-blok-item-name="database-view-delete"]:visible').click();
      await expect(page.getByRole('alertdialog')).toContainText('Delete the last view for this data source?');
    };

    // research/30 B3: focus on the × "Close", and no ring when the dialog was opened by a click.
    test('opens with focus on its × "Close", with no ring after a click', async ({ page }) => {
      await mount(page, bound);
      await deleteFromTabMenu(page);
      const close = page.getByRole('alertdialog').getByRole('button', { name: 'Close' });

      await expect(close).toBeFocused();
      const ring = await close.evaluate((el) => {
        const style = getComputedStyle(el);

        return { outline: style.outlineStyle, shadow: style.boxShadow };
      });

      expect(ring).toEqual({ outline: 'none', shadow: 'none' });
      await close.click();
      await expect(page.getByRole('alertdialog')).toBeHidden();
      expect((await save(page)).some((block) => block.id === 'src-b')).toBe(true);
    });

    // research/30 B3: the tab menu stays open behind the dialog; after Cancel, its Delete row has focus.
    test('from the tab menu: the menu stays open behind the dialog, Cancel and Escape go back to its Delete row', async ({ page }) => {
      await mount(page, bound);
      const row = page.locator('[data-blok-item-name="database-view-delete"]:visible');
      const dialog = page.getByRole('alertdialog');
      const ask = async (): Promise<void> => {
        await page.locator('[data-blok-database-tab][data-view-id="vb"]').click({ button: 'right' });
        await row.click();
        await expect(dialog).toContainText('Delete the last view for this data source?');
      };

      await ask();
      await expect(row).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-blok-focused', 'true');

      // One Escape closes the dialog only.
      await page.keyboard.press('Escape');
      await expect(row).toHaveCount(0);
      await ask();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(row).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(row).toHaveCount(0);

      // Deleting closes the menu with the view.
      await ask();
      await dialog.getByRole('button', { name: 'Delete view', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toHaveCount(0);
      await expect(page.locator('[data-blok-database-tab][data-view-id="vb"]')).toHaveCount(0);
      expect((await save(page)).some((block) => block.id === 'src-b')).toBe(true);
    });

    // research/26 §5a: title 17px/22px weight 500, a filled red Delete view, a red ring on the picked card.
    // Notion's fill rgb(229, 100, 88) fails AA under its label, so the fill is Blok's AA red in both themes.
    for (const scheme of ['light', 'dark'] as const) {
      test(`draws Notion's look in ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await mount(page, bound);
        await deleteFromTabMenu(page);
        const dialog = page.getByRole('alertdialog');
        const read = (locator: Locator, props: string[]): Promise<string[]> =>
          locator.evaluate((el, names) => names.map((name) => getComputedStyle(el).getPropertyValue(name)), props);

        expect(await read(dialog.locator('[data-blok-database-confirm-title]'), ['font-weight', 'font-size', 'line-height']))
          .toEqual(['500', '17px', '22px']);
        expect(await read(dialog.getByRole('button', { name: 'Delete view', exact: true }), ['background-color', 'color']))
          .toEqual(['rgb(182, 79, 70)', 'rgb(253, 246, 246)']);
        expect(await read(dialog.getByRole('radio', { name: /Delete view only/ }), ['box-shadow']))
          .toEqual(['rgb(229, 100, 88) 0px 0px 0px 1px inset']);
      });
    }

    // research/35 §1.7 and §10: colours per theme, and the box's inner geometry.
    for (const [scheme, look] of [
      ['light', { backdrop: 'rgba(15, 15, 15, 0.6)', close: 'rgba(42, 28, 0, 0.07)', glyph: 'rgb(142, 139, 134)', line: 'rgba(42, 28, 0, 0.07)', ring: 'rgb(230, 229, 227)', radio: ['rgb(255, 255, 255)', 'rgba(27, 21, 0, 0.19)'] }],
      ['dark', { backdrop: 'rgba(15, 15, 15, 0.8)', close: 'rgba(255, 255, 243, 0.082)', glyph: 'rgb(173, 169, 163)', line: 'rgba(255, 255, 243, 0.082)', ring: 'rgb(56, 56, 54)', radio: ['rgb(37, 37, 37)', 'rgba(255, 252, 235, 0.306)'] }],
    ] as const) {
      test(`draws Notion's round-13 colours and layout in ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await mount(page, bound);
        await deleteFromTabMenu(page);
        // The entrance scales the box; measure after it lands.
        await page.getByRole('alertdialog').evaluate((box) => Promise.all(box.getAnimations({ subtree: true }).map((animation) => animation.finished)));
        const measured = await page.getByRole('alertdialog').evaluate((box) => {
          const q = (selector: string): Element => box.querySelector(selector) ?? box;
          const rect = (el: Element): DOMRect => el.getBoundingClientRect();
          const style = (el: Element): CSSStyleDeclaration => getComputedStyle(el);
          const b = rect(box);
          const close = q('[data-blok-database-confirm-close]');
          const art = q('[data-blok-database-confirm-art] svg');
          const title = q('[data-blok-database-confirm-title]');
          const group = q('[data-blok-database-confirm-choices]');
          const cards = [...box.querySelectorAll('[data-blok-database-confirm-choice]')];
          const [picked, other] = cards;
          const pickedDot = picked.querySelector('[data-blok-database-confirm-choice-dot]') ?? picked;
          const otherDot = other.querySelector('[data-blok-database-confirm-choice-dot]') ?? other;
          const label = picked.querySelector('[data-blok-database-confirm-choice-label]') ?? picked;
          const remove = q('[data-blok-database-confirm-action="confirm"]');
          const cancel = q('[data-blok-database-confirm-action="cancel"]');
          // Text heights vary with the OS font (a description may wrap); the 20px and 16px line boxes do not.
          const option = (card: Element): { name: string | null | undefined; counts: number[]; labelLines: boolean; hintLines: boolean; hintGap: number; pad: number[]; expectedPad: number } => {
            const labels = card.querySelectorAll('[data-blok-database-confirm-choice-label]');
            const hints = card.querySelectorAll('[data-blok-database-confirm-choice-description]');
            const [head, hint] = [rect(labels[0] ?? card), rect(hints[0] ?? card)];
            const text = hint.bottom - head.top;
            const c = rect(card);

            return {
              name: labels[0]?.textContent,
              counts: [labels.length, hints.length],
              labelLines: head.height > 0 && head.height % 20 === 0,
              hintLines: hint.height > 0 && hint.height % 16 === 0,
              hintGap: hint.top - head.bottom,
              // Centred, 12px padding, 70px min height.
              pad: [head.top - c.top, c.bottom - hint.bottom],
              expectedPad: Math.max(12, (70 - text) / 2),
            };
          };

          return {
            backdrop: style(box.parentElement ?? box).backgroundColor,
            close: [style(close).backgroundColor, b.right - rect(close).right, rect(close).top - b.top],
            glyph: style(art).color,
            art: [rect(art).width, rect(art).height, rect(art).top - b.top, rect(title).top - rect(art).bottom],
            lines: [style(group).borderTopColor, style(group).borderBottomColor, rect(group).left - b.left, rect(group).width - b.width],
            gaps: [rect(group).top - rect(title).bottom, rect(picked).top - rect(group).top, rect(group).bottom - rect(other).bottom, rect(remove).top - rect(group).bottom],
            ring: style(other).boxShadow,
            radio: [style(otherDot).backgroundColor, style(otherDot).borderTopColor],
            dot: style(pickedDot).backgroundColor,
            card: [rect(label).left - rect(picked).left, rect(picked).right - rect(pickedDot).right],
            options: cards.map(option),
            stack: [cards.length, rect(other).top - rect(picked).bottom],
            fit: [b.bottom - rect(cancel).bottom, box.scrollHeight - box.clientHeight],
          };
        });

        expect(measured.backdrop).toBe(look.backdrop);
        expect(measured.close).toEqual([look.close, 10, 10]);
        expect(measured.glyph).toBe(look.glyph);
        expect(measured.art).toEqual([32, 32, 20, 10]);
        expect(measured.lines).toEqual([look.line, look.line, 0, 0]);
        expect(measured.gaps).toEqual([14, 1, 1, 20]);
        expect(measured.ring).toBe(`${look.ring} 0px 0px 0px 1px inset`);
        expect(measured.radio).toEqual(look.radio);
        expect(measured.dot).toBe('rgb(240, 239, 237)');
        expect(measured.card).toEqual([14, 14]);
        // "Delete view only" sits above "Delete view and data source", 8px apart, no overlap.
        expect(measured.stack).toEqual([2, 8]);
        expect(measured.options.map((option) => option.name)).toEqual(['Delete view only', 'Delete view and data source']);
        for (const { expectedPad, name, ...option } of measured.options) {
          expect(option, name ?? '').toEqual({ counts: [1, 1], labelLines: true, hintLines: true, hintGap: 2, pad: [expectedPad, expectedPad] });
        }
        // The box grows to its content: Cancel sits on the 20px padding and nothing scrolls.
        expect(measured.fit).toEqual([20, 0]);
      });
    }

    test('"Delete view only" is picked and keeps the source and its rows', async ({ page }) => {
      await mount(page, bound);
      await deleteFromTabMenu(page);
      const dialog = page.getByRole('alertdialog');

      await expect(dialog.getByRole('radio', { name: /Delete view only/ })).toHaveAttribute('aria-checked', 'true');
      await dialog.getByRole('button', { name: 'Delete view', exact: true }).click();
      await expect(dialog).toBeHidden();
      const saved = await save(page);

      expect(saved.some((block) => block.id === 'src-b')).toBe(true);
      expect(saved.some((block) => block.id === 'b1')).toBe(true);
    });

    test('"Delete view and data source" removes the source and its rows; undo brings them back', async ({ page }) => {
      await mount(page, bound);
      await deleteFromTabMenu(page);
      const dialog = page.getByRole('alertdialog');

      await dialog.getByRole('radio', { name: /Delete view and data source/ }).click();
      await dialog.getByRole('button', { name: 'Delete view', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(grid(page)).toContainText('Alpha');
      const saved = await save(page);

      expect(saved.some((block) => block.id === 'src-b' || block.id === 'b1')).toBe(false);
      expect(saved.filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['r1']);

      await page.evaluate(() => window.blokInstance?.history.undo());
      await expect.poll(async () => (await save(page)).find((block) => block.id === 'b1')?.parent).toBe('src-b');
    });
  });

  // research/26 §5b, 27 §5: every filter goes; the title sort stays, on the new source's title.
  test('picking another source drops every filter and keeps only the title sort', async ({ page }) => {
    const rules = {
      sorts: [{ id: 's1', propertyId: 'p-title', direction: 'desc' }],
      filters: [{ id: 'f1', propertyId: 'p-title', operator: 'contains', value: 'zzz' }],
    };
    const sortedBound = bound.map((block) => (block.id === 'db-1'
      ? { ...block, data: { ...block.data, activeViewId: 'v0', views: (block.data as { views: Array<Record<string, unknown>> }).views.map((view) => (view.id === 'v0' ? { ...view, ...rules } : view)) } }
      : block));

    await mount(page, sortedBound);
    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-source').click();
    await page.getByTestId('database-source-option-src-b').click();
    // "zzz" matches no row: Gamma shows only once the filter is gone.
    await expect(grid(page)).toContainText('Gamma');
    const views = (await save(page)).find((block) => block.id === 'db-1')?.data as { views: Array<{ id: string; sorts: unknown[]; filters: unknown[] }> };
    const moved = views.views.find((view) => view.id === 'v0');

    expect(moved?.filters).toEqual([]);
    expect(moved?.sorts).toEqual([{ id: 's1', propertyId: 'b-title', direction: 'desc' }]);
  });
});

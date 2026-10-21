/**
 * The controls research/26 §3 and §1b measured that Blok lacked, in light and
 * dark (§4a). Reads getComputedStyle and boxes, never the stylesheet text.
 * Dark runs once on the OS preference and once on the forced dark theme.
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

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [
        {
          id: 'v1',
          name: 'Table',
          type: 'table',
          position: 'a0',
          sorts: [ { id: 's1', propertyId: 'p-due', direction: 'asc' } ],
          filters: [],
          visibleProperties: [],
        },
      ],
      activeViewId: 'v1',
    },
    content: [ 'r1', 'r2' ],
  },
  ...[ 'Alpha', 'Bravo' ].map((title, i) => ({
    id: `r${i + 1}`,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: { 'p-title': title, 'p-amount': i } },
  })),
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, blocks());
  await expect(page.getByRole('grid')).toBeVisible();
};

interface Look {
  border: string;
  sortBg: string;
  sortHover: string;
  sortLabel: string;
  divider: string;
  iconInk: string;
  iconHover: string;
  closeBg: string;
  closeHover: string;
  closeGlyph: string;
  closePressed: string;
  rowHover: string;
  rowPressed: string;
  todayHover: string;
  todayInk: string;
}

const LIGHT: Look = {
  border: 'rgba(28, 19, 1, 0.11)',
  sortBg: 'rgb(255, 255, 255)',
  sortHover: 'rgb(244, 243, 243)',
  sortLabel: 'rgb(44, 44, 43)',
  divider: 'rgba(42, 28, 0, 0.07)',
  iconInk: 'rgb(85, 83, 78)',
  iconHover: 'rgb(249, 248, 247)',
  closeBg: 'rgba(42, 28, 0, 0.07)',
  closeHover: 'rgba(42, 28, 0, 0.106)',
  closeGlyph: 'rgb(142, 139, 134)',
  // research/27 §6. A light row press was not read: it keeps the hover fill.
  // Chrome reads Notion's 0.102 and 0.051 alphas back as 0.1 and 0.05 (8-bit alpha).
  closePressed: 'rgba(33, 27, 23, 0.1)',
  rowHover: 'rgba(33, 27, 23, 0.05)',
  rowPressed: 'rgba(33, 27, 23, 0.05)',
  todayHover: 'rgba(33, 27, 23, 0.05)',
  // The database tertiary AA step: Notion's rgb(142, 139, 134) is 3.39:1 on white.
  todayInk: 'rgb(114, 111, 106)',
};

const DARK: Look = {
  border: 'rgba(255, 255, 235, 0.1)',
  sortBg: 'rgb(25, 25, 25)',
  sortHover: 'rgb(38, 38, 38)',
  sortLabel: 'rgb(240, 239, 237)',
  divider: 'rgba(255, 255, 243, 0.082)',
  iconInk: 'rgb(211, 211, 211)',
  iconHover: 'rgb(32, 32, 32)',
  closeBg: 'rgba(255, 255, 235, 0.1)',
  closeHover: 'rgba(255, 255, 235, 0.153)',
  closeGlyph: 'rgb(173, 169, 163)',
  closePressed: 'rgba(255, 255, 255, 0.11)',
  rowHover: 'rgba(255, 255, 255, 0.055)',
  rowPressed: 'rgba(255, 255, 255, 0.11)',
  todayHover: 'rgba(255, 255, 255, 0.055)',
  todayInk: 'rgb(142, 139, 134)',
};

const paths: Array<{ name: string; look: Look; setup: (page: Page) => Promise<void> }> = [
  {
    name: 'light',
    look: LIGHT,
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await mount(page);
    },
  },
  {
    name: 'OS dark preference',
    look: DARK,
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await mount(page);
    },
  },
  {
    name: 'forced dark theme',
    look: DARK,
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await mount(page);
      await page.evaluate(() => window.blokInstance?.theme.set('dark'));
    },
  },
];

/** Layout size, not the box: popovers open with a scale transform. */
const size = (locator: Locator): Promise<{ width: number; height: number }> =>
  locator.evaluate((el: HTMLElement) => ({ width: el.offsetWidth, height: el.offsetHeight }));

test.beforeAll(ensureBlokBundleBuilt);

for (const path of paths) {
  const { look } = path;

  test.describe(`Notion's bordered controls, ${path.name} (research/26 §3, §1b)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await gotoTestPage(page);
      await page.waitForFunction(() => typeof window.Blok === 'function');
      await path.setup(page);
    });

    test('sort panel: 32px bordered property and direction buttons, hover fill, a 24px remove × (§3a)', async ({ page }) => {
      await page.getByTestId('database-toolbar-sort').click();
      const property = page.getByTestId('database-sort-property-s1');
      const direction = page.getByTestId('database-sort-direction-s1');
      const remove = page.getByTestId('database-sort-remove-s1');

      for (const button of [ property, direction ]) {
        await expect(button).toHaveCSS('border-top', `1px solid ${look.border}`);
        await expect(button).toHaveCSS('border-radius', '6px');
        await expect(button).toHaveCSS('background-color', look.sortBg);
        await expect(button).toHaveCSS('font-weight', '500');
        await expect(button).toHaveCSS('color', look.sortLabel);
        expect((await size(button)).height).toBe(32);
      }
      await expect(property.locator('[data-blok-database-panel-icon] svg')).toBeVisible();
      await property.hover();
      await expect(property).toHaveCSS('background-color', look.sortHover);
      await expect(property).toHaveCSS('border-top', `1px solid ${look.border}`);

      await expect(remove).toHaveAccessibleName(/.+/);
      await expect(remove).toHaveCSS('border-top-width', '0px');
      expect(await size(remove)).toEqual({ width: 24, height: 24 });
    });

    test('selection bar: a 1px divider shadow on every segment but the last (§3b)', async ({ page }) => {
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      await row.hover();
      await row.locator('[data-blok-database-table-row-checkbox]').click();
      const bar = page.locator('[data-blok-database-table-selection-bar]');

      await expect(bar).toBeVisible();
      const segments = await bar.evaluate((el) => [ ...el.children ].map((child) => {
        const previous = child.previousElementSibling?.getBoundingClientRect();

        return {
          shadow: getComputedStyle(child).boxShadow,
          gap: previous === undefined ? 0 : child.getBoundingClientRect().left - previous.right,
        };
      }));
      const last = segments.pop();

      expect(segments.length).toBeGreaterThan(1);
      for (const segment of segments) {
        expect(segment.shadow).toBe(`${look.divider} 1px 0px 0px 0px`);
      }
      expect(last?.shadow).toBe('none');
      const gap = segments[1].gap;

      expect(Math.round(gap)).toBe(1);
    });

    test('property menu: a 28px bordered icon button with no fill and the measured hover (§3c)', async ({ page }) => {
      await page.locator('[data-blok-database-table-column-header][data-property-id="p-due"]').click();
      const icon = page.locator('[data-blok-popover-opened="true"] [data-blok-database-property-menu-icon]');

      await expect(icon).toBeVisible();
      expect(await size(icon)).toEqual({ width: 28, height: 28 });
      await expect(icon).toHaveCSS('border-top', `1px solid ${look.border}`);
      await expect(icon).toHaveCSS('border-radius', '6px');
      await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(icon).toHaveCSS('color', look.iconInk);
      await icon.hover();
      await expect(icon).toHaveCSS('background-color', look.iconHover);
    });

    // Dark ink unmeasured for the (i): it borrows the × glyph ink (§4a).
    test('property menu: a 15x20 (i) at the name field\'s end with no fill, in the × glyph ink (§3c)', async ({ page }) => {
      await page.locator('[data-blok-database-table-column-header][data-property-id="p-due"]').click();
      const info = page.locator('[data-blok-popover-opened="true"]').getByRole('button', { name: 'Add property description', exact: true });

      await expect(info).toBeVisible();
      expect(await size(info)).toEqual({ width: 15, height: 20 });
      await expect(info).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(info).toHaveCSS('color', look.closeGlyph);
    });

    test('view settings: a 20px round Close × with the measured fills, no hint, and it closes (§1b)', async ({ page }) => {
      await page.getByTestId('database-toolbar-settings').click();
      const panel = page.getByTestId('database-view-settings');
      const close = panel.getByRole('button', { name: 'Close', exact: true });

      await expect(close).toBeVisible();
      expect(await size(close)).toEqual({ width: 20, height: 20 });
      await expect(close).toHaveCSS('border-radius', '50%');
      await expect(close).toHaveCSS('background-color', look.closeBg);
      await expect(close).toHaveCSS('color', look.closeGlyph);
      await close.hover();
      await expect(close).toHaveCSS('background-color', look.closeHover);
      // Notion shows no hint here. Wait past the 500ms hint delay, then look.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 700)));
      await expect(page.getByTestId('tooltip-content').filter({ visible: true })).toHaveCount(0);

      await close.click();
      await expect(panel).toBeHidden();
    });

    test('view settings: a row and the × press to the measured fills (research/27 §6)', async ({ page }) => {
      await page.getByTestId('database-toolbar-settings').click();
      const panel = page.getByTestId('database-view-settings');
      const row = panel.getByTestId('database-settings-filter');
      const close = panel.getByRole('button', { name: 'Close', exact: true });

      await row.hover();
      await expect(row).toHaveCSS('background-color', look.rowHover);
      await page.mouse.down();
      await expect(row).toHaveCSS('background-color', look.rowPressed);
      // Released off the row, as measured: the panel stays on its root.
      await page.mouse.move(5, 5);
      await page.mouse.up();

      await close.hover();
      await page.mouse.down();
      await expect(close).toHaveCSS('background-color', look.closePressed);
      await expect(close).toHaveCSS('box-shadow', 'none');
      await page.mouse.move(5, 5);
      await page.mouse.up();
      await expect(panel).toBeVisible();
    });

    test('date picker: Today and Now keep one box and ink and hover to the measured fill (research/27 §6)', async ({ page }) => {
      await page.getByRole('row').filter({ hasText: 'Alpha' }).getByRole('gridcell').and(page.locator('[data-property-id="p-due"]')).click();
      const picker = page.locator('[data-blok-database-date-editor]');

      if (!await picker.isVisible()) await page.keyboard.press('Enter');
      await expect(picker).toBeVisible();
      const today = picker.locator('[data-blok-database-date-today]');

      for (const label of [ 'Today', 'Now' ]) {
        if (label === 'Now') await picker.locator('[data-blok-database-date-time-toggle]').click();
        await expect(today).toHaveText(label);
        expect((await size(today)).height).toBe(20);
        await expect(today).toHaveCSS('color', look.todayInk);
        await expect(today).toHaveCSS('padding', '0px 8px');
        await today.hover();
        await expect(today).toHaveCSS('background-color', look.todayHover);
        await page.mouse.move(5, 5);
      }
    });
  });
}

// research/27 §7: the Edit property submenu opens on ArrowRight or Enter, never on a click or a keyboard highlight.
test.describe('property header menu: Edit property opens one level at a time (research/27 §7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.emulateMedia({ colorScheme: 'light' });
    await mount(page);
  });

  test('a click and a highlight do not open it; ArrowRight and Enter do; ArrowLeft and Escape close one level', async ({ page }) => {
    const open = page.locator('[data-blok-popover-opened="true"]');
    const edit = page.locator('[data-blok-popover-opened="true"] [data-blok-item-name="editProperty"]');
    const formatRow = page.locator('[data-blok-popover-opened="true"] [data-blok-item-name="numberFormat"]');

    await page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"]').click();
    await expect(edit).toBeVisible();
    // Notion still showed one menu 1.4s after the click.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1400)));
    await expect(open).toHaveCount(1);

    for (let i = 0; i < 10 && await edit.getAttribute('data-blok-focused') !== 'true'; i++) {
      await page.keyboard.press('ArrowDown');
      // Human pace: the name field takes focus 50ms after the highlight lands on it.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
    }
    await expect(edit).toHaveAttribute('data-blok-focused', 'true');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 700)));
    await expect(open).toHaveCount(1);

    await page.keyboard.press('ArrowRight');
    await expect(open).toHaveCount(2);
    await expect(formatRow).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(open).toHaveCount(1);
    await expect(edit).toHaveAttribute('data-blok-focused', 'true');

    await page.keyboard.press('Enter');
    await expect(open).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(1);
    await expect(edit).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
  });

  // research/30 X2: the (i) shows a field inside the header menu; there is no "Property description" row.
  test('the (i) shows a description field in the same menu; Enter adds no line; Escape closes the menu and saves', async ({ page }) => {
    const open = page.locator('[data-blok-popover-opened="true"]');
    const header = page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"]');

    await header.click();
    await expect(open).toHaveCount(1);
    await expect(open.locator('[data-blok-item-name="description"]')).toHaveCount(0);
    const area = open.getByRole('textbox', { name: 'Property description', exact: true });

    await expect(area).toBeHidden();
    await open.getByRole('button', { name: 'Add property description', exact: true }).click();

    await expect(area).toBeVisible();
    await expect(area).toBeFocused();
    await expect(area).toHaveAttribute('placeholder', 'Add a description…');
    await expect(area).toHaveCSS('font-size', '13px');
    await expect(area).toHaveCSS('line-height', '20px');
    await expect(area).toHaveCSS('padding', '3px 6px');
    // The menu grows and moves: no submenu may open under the resting pointer.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
    await expect(open).toHaveCount(1);
    await expect(area).toBeVisible();

    await page.keyboard.type('First line');
    await page.keyboard.press('Enter');
    await expect(area).toHaveValue('First line');
    await expect(area).toBeFocused();
    await expect(open).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);

    const description = await page.evaluate(async () => {
      const saved = await window.blokInstance?.save();
      const data = saved?.blocks.find((block) => block.id === 'db-1')?.data as { schema: Array<{ id: string; description?: string }> } | undefined;

      return data?.schema.find((p) => p.id === 'p-amount')?.description;
    });

    expect(description).toBe('First line');

    // Reopened: the field shows the text at once and the (i) reads "Edit".
    await header.click();
    await expect(open.getByRole('button', { name: 'Edit property description', exact: true })).toBeVisible();
    await expect(open.getByRole('textbox', { name: 'Property description', exact: true })).toHaveValue('First line');
  });

  // research/30 X2: a described property's header shows an (i). research/31 §1: hovering the header shows its name and description above it.
  test('a described header shows an (i); hovering the header shows the name and the description above it', async ({ page }) => {
    const open = page.locator('[data-blok-popover-opened="true"]');
    const header = page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"]');
    const info = header.locator('[data-blok-database-table-column-description]');
    const hint = page.getByTestId('tooltip');
    const setDescription = async (text: string): Promise<void> => {
      await header.click();
      const area = open.getByRole('textbox', { name: 'Property description', exact: true });

      if (await area.isVisible()) {
        await area.fill(text);
      } else {
        await open.getByRole('button', { name: 'Add property description', exact: true }).click();
        await page.keyboard.type(text);
      }
      await page.keyboard.press('Escape');
      await expect(open).toHaveCount(0);
    };
    const hintText = page.locator('[data-blok-database-header-hint-text]');
    const hintLines = async (): Promise<Array<{ text: string; size: string; weight: string }>> => hintText.evaluate((el) =>
      [...el.children].map((line) => ({ text: line.textContent ?? '', size: getComputedStyle(line).fontSize, weight: getComputedStyle(line).fontWeight })));
    const hover = async (): Promise<void> => {
      const box = await header.boundingBox();

      await page.mouse.move((box?.x ?? 0) - 40, (box?.y ?? 0) - 60);
      await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) - 10, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    };

    await expect(info).toHaveCount(0);
    await setDescription('Short one');

    await expect(info).toBeVisible();
    await expect(header).toHaveAttribute('aria-description', 'Short one');
    const [iconBox, nameBox, headerBox] = await Promise.all([
      info.boundingBox(),
      header.locator('[data-blok-database-table-column-name]').boundingBox(),
      header.boundingBox(),
    ]);

    expect(iconBox?.width).toBe(16);
    expect(iconBox?.height).toBe(16);
    expect((iconBox?.x ?? 0)).toBeGreaterThan((nameBox?.x ?? 0) + (nameBox?.width ?? 0) - 1);

    // The empty right part of the header carries the hint too, after Blok's hint delay.
    await hover();
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
    await expect(hint).not.toHaveAttribute('data-blok-shown', 'true');
    await expect(hint).toHaveAttribute('data-blok-shown', 'true');
    await expect(hintText).toHaveText('AmountShort one');
    const short = await hint.boundingBox();

    // Notion: 71.2x43.6 shrink-to-fit, left edges aligned, 6px above the header.
    expect(short?.height).toBeCloseTo(43.6, 1);
    expect(short?.width).toBeLessThan(120);
    expect(short?.x).toBeCloseTo(headerBox?.x ?? -1, 1);
    // Sub-pixel: the tooltip places itself with the whole-pixel clientHeight.
    expect((short?.y ?? 0) + (short?.height ?? 0)).toBeCloseTo((headerBox?.y ?? 0) - 6, 0);
    await expect(hint).toHaveCSS('border-radius', '6px');
    expect(await hintLines()).toEqual([
      { text: 'Amount', size: '12px', weight: '400' },
      { text: 'Short one', size: '12px', weight: '400' },
    ]);

    // A long description wraps at 280px: the box is 296 wide.
    await page.mouse.move((headerBox?.x ?? 0) - 40, (headerBox?.y ?? 0) - 60);
    await setDescription('This longer property description is here to measure how the header hint wraps across several lines of text.');
    await hover();
    await expect(hint).toHaveAttribute('data-blok-shown', 'true');
    const long = await hint.boundingBox();
    const lines = Math.round(((long?.height ?? 0) - 10) / 16.8);

    expect(long?.width).toBeCloseTo(296, 0);
    expect(lines).toBeGreaterThanOrEqual(3);
    expect(long?.height).toBeCloseTo(10 + lines * 16.8, 1);

    // Clearing the description removes the (i).
    await page.mouse.move((headerBox?.x ?? 0) - 40, (headerBox?.y ?? 0) - 60);
    await header.click();
    const area = open.getByRole('textbox', { name: 'Property description', exact: true });

    await area.fill('');
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await expect(info).toHaveCount(0);
    await expect(header).not.toHaveAttribute('aria-description', /.*/);
  });

  test('the (i) shows the field even while another submenu is open, and closes that submenu', async ({ page }) => {
    const open = page.locator('[data-blok-popover-opened="true"]');
    const edit = page.locator('[data-blok-popover-opened="true"] [data-blok-item-name="editProperty"]');

    await page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"]').click();
    await expect(edit).toBeVisible();
    for (let i = 0; i < 10 && await edit.getAttribute('data-blok-focused') !== 'true'; i++) {
      await page.keyboard.press('ArrowDown');
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
    }
    await page.keyboard.press('ArrowRight');
    await expect(open).toHaveCount(2);

    await open.first().getByRole('button', { name: 'Add property description', exact: true }).click();
    const area = page.locator('[data-blok-database-property-description]');

    await expect(area).toBeVisible();
    await expect(area).toBeFocused();
    await expect(open).toHaveCount(1);
  });

  test('the name field keeps its caret and Enter while it holds the highlight', async ({ page }) => {
    await page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"]').click();
    const name = page.locator('[data-blok-popover-opened="true"] [data-blok-database-property-menu-name-input]');

    await name.click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    expect(await name.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe('Amount'.length - 1);
    await page.keyboard.type('X');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-blok-popover-opened="true"]')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"]')).toContainText('AmounXt');
  });
});

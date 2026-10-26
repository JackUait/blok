/**
 * The row page peeks and the layout builder in dark, against Notion's
 * measured dark values (research/21 §1m, §1n). Reads computed styles only.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    outsideClicks?: string[];
    stopLoggingClicks?: () => void;
  }
}

const blocks = (openPagesIn: 'side' | 'center'): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
        { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], openPagesIn }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'Note' } } },
];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ input }) => {
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
  }, { input: data });
  await expect(page.getByRole('grid')).toBeVisible();
};

const openRow = async (page: Page): Promise<void> => {
  const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
};

const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');
const label = (page: Page, name: string): Locator =>
  peek(page).locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: name });
/** The whole label column cell: Notion's hover box (research/21 §1m). */
const labelCell = (page: Page, name: string): Locator =>
  peek(page).locator('[data-blok-database-drawer-prop-head]', {
    has: page.locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: name }),
  });
const value = (page: Page, propertyId: string): Locator =>
  peek(page).locator(`[data-blok-database-drawer-prop-value][data-property-id="${propertyId}"]`);

/** Both dark copies: the OS media query, and the theme attribute over a light OS. */
const DARK_MODES = [
  { name: 'system dark', apply: (page: Page) => page.emulateMedia({ colorScheme: 'dark' }) },
  {
    name: 'theme set to dark',
    apply: async (page: Page): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => window.blokInstance?.theme.set('dark'));
    },
  },
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

// The page is shared: leave no theme behind for the next spec.
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    document.documentElement.removeAttribute('data-blok-theme');
  });
  await page.emulateMedia({ colorScheme: null });
});

for (const mode of DARK_MODES) {
  test.describe(`row page peek, ${mode.name} (research/21 §1m)`, () => {
    test('side peek: rgb(32, 32, 32) panel, label ink and hover', async ({ page }) => {
      await mount(page, blocks('side'));
      await mode.apply(page);
      await openRow(page);
      await expect(peek(page)).toHaveCSS('transform', 'none');

      await expect(peek(page)).toHaveCSS('background-color', 'rgb(32, 32, 32)');
      await expect(peek(page)).toHaveCSS('box-shadow', 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.08) 0px 4px 12px -2px');
      await expect(peek(page)).toHaveCSS('border-left-width', '0px');
      await expect(peek(page).locator('[data-blok-database-drawer-title]')).toHaveCSS('color', 'rgb(240, 239, 237)');
      await expect(label(page, 'Notes')).toHaveCSS('color', 'rgb(173, 169, 163)');

      await label(page, 'Notes').hover();
      await expect(labelCell(page, 'Notes')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.055)');
      await expect(labelCell(page, 'Notes')).toHaveCSS('border-radius', '6px');
      const box = await labelCell(page, 'Notes').boundingBox();

      expect(box?.width).toBe(160);
      expect(box?.height).toBe(34);

      await value(page, 'p-notes').hover();
      await expect(value(page, 'p-notes')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    });

    test('side peek: "Empty" in the nearest AA step of Notion\'s tertiary', async ({ page }) => {
      await mount(page, blocks('side'));
      await mode.apply(page);
      await openRow(page);
      const empty = value(page, 'p-due').locator('[data-blok-database-cell][data-empty]');

      await expect(empty).toHaveText('Empty');
      // The dark tertiary AA step: Notion's rgb(125, 122, 117) is 3.8:1 on the peek.
      await expect(empty).toHaveCSS('color', 'rgb(143, 140, 135)');
    });

    test('center peek: rgb(32, 32, 32) panel, measured shadow, 0.8 backdrop', async ({ page }) => {
      await mount(page, blocks('center'));
      await mode.apply(page);
      await openRow(page);
      const dialog = page.getByRole('dialog');

      await expect(dialog).toHaveCSS('background-color', 'rgb(32, 32, 32)');
      await expect(dialog).toHaveCSS('box-shadow', 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.08) 0px 4px 12px -2px');
      await expect(page.locator('[data-blok-database-peek-backdrop]')).toHaveCSS('background-color', 'rgba(15, 15, 15, 0.8)');
      await label(page, 'Notes').hover();
      await expect(labelCell(page, 'Notes')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.055)');
    });
  });
}

test('the layout builder paints the measured dark surfaces (research/21 §1n)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mount(page, blocks('side'));
  await openRow(page);
  await peek(page).hover();
  await peek(page).getByRole('button', { name: 'Customize layout' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize page layout' });

  await expect(dialog).toHaveCSS('background-color', 'rgb(32, 32, 32)');
  await expect(dialog.locator('[data-blok-database-layout-canvas]')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(dialog.locator('[data-blok-database-layout-module="heading"]')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(dialog.locator('[data-blok-database-layout-structure-card]').first()).toHaveCSS('background-color', 'rgb(32, 32, 32)');
  // Selected "Simple" label white; unselected "Tabbed" takes the dark tertiary AA step (Notion's rgb(90, 90, 90) is 2.5:1).
  await expect(dialog.locator('[data-blok-database-layout-structure-card][aria-pressed="true"]')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(dialog.locator('[data-blok-database-layout-structure-card][aria-pressed="false"]')).toHaveCSS('color', 'rgb(143, 140, 135)');
});

test('light keeps the 0.6 backdrop and the white panel (research/08)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mount(page, blocks('center'));
  await openRow(page);

  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('[data-blok-database-peek-backdrop]')).toHaveCSS('background-color', 'rgba(15, 15, 15, 0.6)');
});

// research/30 B24: hover changes nothing on the handle; a hint beside it follows the pointer's height.
test('side peek handle: no hover look, and a "Close Click / Resize Drag" hint to its left that follows the pointer', async ({ page }) => {
  await mount(page, blocks('side'));
  await openRow(page);
  const handle = page.locator('[data-blok-database-peek-resize]');

  await expect(handle).toBeVisible();
  // The peek slides in: measure the handle once it stops.
  await expect.poll(async () => peek(page).evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  const look = async (): Promise<string> => handle.evaluate((el) => {
    const s = getComputedStyle(el);

    return [s.backgroundColor, s.boxShadow, s.opacity, getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content].join('|');
  });
  const rest = await look();
  const box = await handle.boundingBox();

  if (box === null) throw new Error('no handle');
  await page.mouse.move(box.x - 60, box.y + 300);
  await page.mouse.move(box.x + 6, box.y + 300);
  // By test id: the open peek hides the rest of the page from the accessibility tree.
  const tooltip = page.getByTestId('tooltip');

  // Never instant: still hidden well inside the 300ms floor.
  await page.evaluate(() => new Promise<void>((resolve) => {
    setTimeout(resolve, 150);
  }));
  await expect(tooltip).toBeHidden();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('Close ClickResize Drag');
  expect(await tooltip.getByTestId('tooltip-content').evaluate((el) => [...(el.firstElementChild?.children ?? [])].map((line) => line.textContent))).toEqual(['Close Click', 'Resize Drag']);
  expect(await look()).toBe(rest);

  const first = await tooltip.boundingBox();

  if (first === null) throw new Error('no tooltip');
  expect(first.x + first.width).toBeLessThanOrEqual(box.x);
  expect(Math.abs(first.y + first.height / 2 - (box.y + 300))).toBeLessThan(2);

  await page.mouse.move(box.x + 6, box.y + 420);
  await expect.poll(async () => {
    const next = await tooltip.boundingBox();

    // Sub-pixel: the 43.6px bubble is placed with its whole-pixel clientHeight.
    return next === null ? NaN : Math.abs(next.y + next.height / 2 - (box.y + 420));
  }).toBeLessThan(1);

  await page.mouse.move(box.x - 200, box.y + 420);
  await expect(tooltip).toBeHidden();
});

// research/31 §2: a click on the handle closes the peek; a press alone does not; a drag resizes and keeps it.
test('side peek handle: a click closes the peek, a drag resizes it', async ({ page }) => {
  await mount(page, blocks('side'));
  await openRow(page);
  const handle = page.locator('[data-blok-database-peek-resize]');
  const viewport = page.viewportSize()?.width ?? 0;

  // Wait for the slide-in to finish, so the handle is where the pointer goes.
  await expect.poll(async () => Math.round((await peek(page).boundingBox())?.x ?? -1)).toBe(viewport - 756);
  const box = await handle.boundingBox();

  if (box === null) throw new Error('no handle');
  const x = box.x + box.width / 2;
  const y = box.y + 300;
  const before = (await peek(page).boundingBox())?.width ?? 0;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 56, y, { steps: 6 });
  await page.mouse.up();
  await expect(peek(page)).toBeVisible();
  // The width follows the pointer from the peek's right edge.
  expect(Math.round((await peek(page).boundingBox())?.width ?? 0)).toBe(Math.round(viewport - (x - 56)));
  expect(before).toBe(756);

  const moved = await handle.boundingBox();

  if (moved === null) throw new Error('no handle');
  await page.mouse.move(moved.x + moved.width / 2, y);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>((resolve) => {
    setTimeout(resolve, 500);
  }));
  await expect(peek(page)).toBeVisible();
  await page.mouse.up();
  await expect(peek(page)).toHaveCount(0);
  // The click that closed it opens nothing behind it.
  await page.evaluate(() => new Promise<void>((resolve) => {
    setTimeout(resolve, 300);
  }));
  await expect(peek(page)).toHaveCount(0);
});

// The click that follows the closing pointerup must not land on whatever the peek uncovers.
test('side peek handle: the click that closes the peek activates nothing behind it', async ({ page }) => {
  await mount(page, blocks('side'));
  await openRow(page);
  const handle = page.locator('[data-blok-database-peek-resize]');
  const viewport = page.viewportSize()?.width ?? 0;

  await expect.poll(async () => Math.round((await peek(page).boundingBox())?.x ?? -1)).toBe(viewport - 756);
  const box = await handle.boundingBox();

  if (box === null) throw new Error('no handle');
  const x = box.x + box.width / 2;
  const y = box.y + 300;

  // A button under the handle, below the peek, and a log of every click outside the peek.
  await page.evaluate(({ left }) => {
    const button = document.createElement('button');

    button.setAttribute('data-blok-testid', 'behind');
    button.textContent = 'Behind';
    button.dataset.clicks = '0';
    // In the peek's stacking context, one step under it, so only the peek can cover it.
    const peekZ = Number(getComputedStyle(document.querySelector('[data-blok-database-drawer]') ?? document.body).zIndex);

    button.style.cssText = `position:fixed;top:0;bottom:0;left:${left - 40}px;width:80px;z-index:${peekZ - 1}`;
    button.addEventListener('click', () => {
      button.dataset.clicks = String(Number(button.dataset.clicks) + 1);
    });
    (document.querySelector('[data-blok-interface]') ?? document.body).appendChild(button);
    const log: string[] = [];
    const onClick = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;

      if (target === null || target.closest('[data-blok-database-drawer]') === null) {
        log.push(target?.outerHTML.slice(0, 80) ?? 'non-element target');
      }
    };

    window.outsideClicks = log;
    document.addEventListener('click', onClick, true);
    window.stopLoggingClicks = () => document.removeEventListener('click', onClick, true);
  }, { left: x });
  const behind = page.getByTestId('behind');

  // The peek covers the button: the handle is what the pointer hits.
  expect(await page.evaluate(({ px, py }) => document.elementFromPoint(px, py)?.hasAttribute('data-blok-database-peek-resize') ?? false, { px: x, py: y })).toBe(true);

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(peek(page)).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => {
    setTimeout(resolve, 300);
  }));

  // The button is uncovered now.
  expect(await page.evaluate(({ px, py }) => document.elementFromPoint(px, py)?.getAttribute('data-blok-testid'), { px: x, py: y })).toBe('behind');
  expect(await page.evaluate(() => window.outsideClicks)).toEqual([]);
  await expect(behind).toHaveAttribute('data-clicks', '0');
  await expect(peek(page)).toHaveCount(0);

  // Control: the button is now uncovered and a plain click reaches it.
  await page.mouse.click(x, y);
  await expect(behind).toHaveAttribute('data-clicks', '1');
  expect(await page.evaluate(() => window.outsideClicks)).toHaveLength(1);
  // The page is shared: leave no button or listener behind.
  await page.evaluate(() => {
    window.stopLoggingClicks?.();
    document.querySelector('[data-blok-testid="behind"]')?.remove();
  });
});

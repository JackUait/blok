/**
 * The row page: peek modes, stepping between rows, and the page body as the
 * row's own child blocks.
 * - Open modes and per-layout defaults: https://www.notion.com/help/views-filters-and-sorts
 * - Previous/next shortcuts: https://www.notion.com/help/keyboard-shortcuts
 * - Expand with ⤡: https://www.notion.com/help/intro-to-databases
 * Sizes and motion: research/08 (side peek half the viewport, center peek 960
 * wide over a 60% backdrop with no open animation).
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
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
];

const blocks = (view: Record<string, unknown> = {}, extra: OutputBlockData[] = []): OutputBlockData[] => [
  { id: 'p-before', type: 'paragraph', data: { text: 'Before' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } }, content: ['b1'] },
  { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'Alpha body' } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Bravo' } } },
  { id: 'r3', type: 'database-row', parent: 'db-1', data: { position: 'a2', properties: { 'p-title': 'Charlie' } } },
  { id: 'p-after', type: 'paragraph', data: { text: 'After' } },
  ...extra,
];

/**
 * The same page with one layout section, so the row page draws its "Properties" fold:
 * a plain button in the peek that opens nothing (a classic page has no fold).
 */
const withSection = (data: OutputBlockData[]): OutputBlockData[] => data.map((block) => (block.id !== 'db-1' ? block : {
  ...block,
  data: {
    ...block.data,
    schema: SCHEMA.map((p) => (p.type === 'title' ? { ...p, pageLayoutSections: [{ id: 's1', name: 'Details' }] } : p)),
  },
}));

const mount = async (page: Page, data: OutputBlockData[], readOnly = false): Promise<void> => {
  await page.evaluate(async ({ data: input, readOnly: ro }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, readOnly: ro });
    await window.blokInstance.isReady;
  }, { data, readOnly });
  await expect(page.getByRole('grid')).toBeVisible();
};

interface SavedBlock {
  id: string;
  type: string;
  parent?: string;
  data: Record<string, unknown>;
}

const saved = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? []) as SavedBlock[];
});

const textOf = (block: SavedBlock): string => {
  const text = block.data.text;

  if (Array.isArray(text)) {
    return text.map((segment: { text?: string }) => segment.text ?? '').join('');
  }

  return typeof text === 'string' ? text : '';
};

const openRow = async (page: Page, rowId: string): Promise<void> => {
  const row = page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
};

const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');
const peekTitle = (page: Page): Locator => page.locator('[data-blok-database-drawer-title]');
const body = (page: Page): Locator => page.locator('[data-blok-database-drawer-editor]');

const stepKey = async (page: Page, direction: 'next' | 'previous'): Promise<string> => {
  const mac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));
  const letter = direction === 'next' ? 'J' : 'K';

  return mac ? `Control+Shift+${letter}` : `Control+${letter}`;
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('page body as child blocks', () => {
  test('shows the row body in the peek and keeps it out of the page', async ({ page }) => {
    await mount(page, blocks());

    await expect(page.getByText('Alpha body')).toBeHidden();
    await openRow(page, 'r1');
    await expect(body(page).getByText('Alpha body')).toBeVisible();
  });

  test('typing a new body writes child blocks of the row, and undo takes the typing back', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r2');
    await body(page).locator('[data-blok-database-row-empty]').click();
    await page.keyboard.type('First line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');

    await expect.poll(async () => (await saved(page)).filter((b) => b.parent === 'r2').map(textOf))
      .toEqual(['First line', 'Second line']);
    expect((await saved(page)).filter((b) => b.parent === undefined).map((b) => b.id)).toEqual(['p-before', 'db-1', 'p-after']);

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await saved(page)).filter((b) => b.parent === 'r2').map(textOf).join('|'))
      .not.toContain('Second line');
  });

  test('Shift+Tab on a top-level body block keeps it in the page', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await body(page).getByText('Alpha body').click();
    await page.keyboard.press('Shift+Tab');

    await expect.poll(async () => (await saved(page)).find((b) => b.id === 'b1')?.parent).toBe('r1');
  });

  test('Escape in the body stays with the editor; Escape outside it closes the peek', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await body(page).getByText('Alpha body').click();
    await page.keyboard.press('Escape');
    await expect(peek(page)).toHaveAttribute('data-open', '');

    await peekTitle(page).click();
    await page.keyboard.press('Escape');
    await expect(peek(page)).toHaveCount(0);
  });

  test('Escape after a click on a button in the peek closes it, as from the title', async ({ page }) => {
    await mount(page, withSection(blocks()));
    await openRow(page, 'r1');
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await peek(page).getByRole('button', { name: 'Properties' }).click();
    await page.keyboard.press('Escape');

    await expect(peek(page)).toHaveCount(0);
    await expect(page.locator('[data-blok-id="db-1"]')).toHaveAttribute('data-blok-navigation-focused', 'true');
  });

  test('undo after a click on a button in the peek still undoes the title', async ({ page }) => {
    const title = async (): Promise<unknown> => ((await saved(page)).find((b) => b.id === 'r1')?.data.properties as Record<string, unknown>)['p-title'];

    await mount(page, withSection(blocks()));
    await openRow(page, 'r1');
    await peekTitle(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type('XYZ');
    await expect.poll(title).toBe('AlphaXYZ');
    await peek(page).getByRole('button', { name: 'Properties' }).click();
    await page.keyboard.press('ControlOrMeta+z');

    await expect.poll(title).toBe('Alpha');
  });

  test('the body stays in the side peek while it slides out', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await expect(body(page).getByText('Alpha body')).toBeVisible();
    // The open slide must end first, so the close starts from rest.
    await expect(peek(page)).toHaveCSS('transform', 'none');

    const midSlide = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('[data-blok-database-drawer-close]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
      const drawer = document.querySelector('[data-blok-database-drawer]');

      return { inDom: drawer !== null, bodyText: drawer?.querySelector('[data-blok-database-drawer-editor]')?.textContent ?? '' };
    });

    expect(midSlide.inDom).toBe(true);
    expect(midSlide.bodyText).toContain('Alpha body');
    await expect(peek(page)).toHaveCount(0);
    await expect(page.getByText('Alpha body')).toBeHidden();
  });

  test('turns a legacy body into child blocks once, without an undo step', async ({ page }) => {
    const legacy = blocks({}, []);
    const db = legacy[1];

    db.data = { ...db.data, schema: [...SCHEMA, { id: 'p-body', name: 'Card details', type: 'richText', position: 'a2' }] };
    legacy[4] = {
      ...legacy[4],
      data: { position: 'a1', properties: { 'p-title': 'Bravo', 'p-body': { blocks: [{ type: 'paragraph', data: { text: 'Old body' } }] } } },
    };
    await mount(page, legacy);
    await openRow(page, 'r2');
    await expect(body(page).getByText('Old body')).toBeVisible();

    const after = await saved(page);

    expect(after.filter((b) => b.parent === 'r2').map(textOf)).toEqual(['Old body']);
    expect(after.find((b) => b.id === 'r2')?.data.bodyBlocks).toBe(true);

    await page.keyboard.press('ControlOrMeta+z');
    expect((await saved(page)).filter((b) => b.parent === 'r2').map(textOf)).toEqual(['Old body']);
  });
});

test.describe('peek modes', () => {
  // research/22 §10: 756px by default.
  test('a table opens a 756px side peek', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await expect(peek(page)).toHaveAttribute('data-peek-mode', 'side');
    await expect.poll(async () => Math.round((await peek(page).boundingBox())?.width ?? 0)).toBe(756);
  });

  test('a center peek is a 960px modal over a 60% backdrop, with no slide', async ({ page }) => {
    await mount(page, blocks({ openPagesIn: 'center' }));
    await openRow(page, 'r1');

    const dialog = page.getByRole('dialog');

    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(Math.round((await dialog.boundingBox())?.width ?? 0)).toBe(960);
    await expect(page.locator('[data-blok-database-peek-backdrop]')).toHaveCSS('background-color', 'rgba(15, 15, 15, 0.6)');
    await expect(dialog).toHaveCSS('border-radius', '12px');
    await expect(dialog).toHaveCSS('transform', 'none');

    await page.locator('[data-blok-database-peek-backdrop]').click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('full page takes the database place; Back returns to the view', async ({ page }) => {
    await mount(page, blocks({ openPagesIn: 'full' }));
    await openRow(page, 'r1');

    await expect(page.getByRole('grid')).toBeHidden();
    await expect(peekTitle(page)).toHaveValue('Alpha');
    await expect(body(page).getByText('Alpha body')).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
  });

  test('⤡ expands a peek to a full page', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await page.getByRole('button', { name: 'Open as full page' }).click();
    await expect(peek(page)).toHaveAttribute('data-peek-mode', 'full');
    await expect(page.getByRole('grid')).toBeHidden();
  });

  // feel/findings-rowpage R19: titles only, and a pick changes this peek, not the view default.
  test('the header mode menu switches this peek to a center peek and leaves the view default alone', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await page.getByRole('button', { name: 'Open pages in' }).click();
    await expect(page.getByText('Open pages in a focused, centered modal.')).toHaveCount(0);
    await page.getByText('Center peek').click();

    await expect(peek(page)).toHaveAttribute('data-peek-mode', 'center');
    const db = (await saved(page)).find((b) => b.id === 'db-1');

    expect((db?.data.views as Array<Record<string, unknown>>)[0].openPagesIn).toBeUndefined();
  });

  test('steps between rows with the arrows and the shortcuts', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(peekTitle(page)).toHaveValue('Bravo');

    await peek(page).locator('[data-blok-database-drawer-toolbar]').click({ position: { x: 300, y: 10 } });
    await page.keyboard.press(await stepKey(page, 'next'));
    await expect(peekTitle(page)).toHaveValue('Charlie');
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();

    await page.keyboard.press(await stepKey(page, 'previous'));
    await expect(peekTitle(page)).toHaveValue('Bravo');
  });
});

// research/22 §10: the inner edge resizes the side peek between 564 and 1008px; labels stay 160px.
test.describe('side peek width', () => {
  const peekWidth = async (page: Page): Promise<number> => Math.round((await peek(page).boundingBox())?.width ?? 0);
  const labelWidth = async (page: Page): Promise<number> =>
    Math.round((await peek(page).locator('[data-blok-database-drawer-prop-head]').first().boundingBox())?.width ?? 0);
  const dragEdgeTo = async (page: Page, x: number): Promise<void> => {
    const handle = await peek(page).getByRole('separator', { name: 'Side peek' }).boundingBox();

    if (handle === null) throw new Error('no resize handle');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(x, handle.y + 200, { steps: 8 });
    await page.mouse.up();
  };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
  });

  test('drags between 564 and 1008px, keeps the label column at 160px, and reopens at the last width', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await expect.poll(() => peekWidth(page)).toBe(756);
    // The width is set at once; wait for the slide-in before aiming at the edge.
    await expect.poll(async () => Math.round((await peek(page).boundingBox())?.x ?? 0)).toBe(1512 - 756);
    const handle = peek(page).getByRole('separator', { name: 'Side peek' });

    await expect(handle).toHaveAttribute('aria-valuenow', '756');
    expect(await handle.evaluate((el) => getComputedStyle(el).cursor)).toBe('col-resize');
    expect(Math.round((await handle.boundingBox())?.width ?? 0)).toBe(12);
    expect(await labelWidth(page)).toBe(160);

    await dragEdgeTo(page, 1300);
    await expect.poll(() => peekWidth(page)).toBe(564);
    await expect(handle).toHaveAttribute('aria-valuenow', '564');
    expect(await labelWidth(page)).toBe(160);

    await dragEdgeTo(page, 100);
    await expect.poll(() => peekWidth(page)).toBe(1008);
    expect(await labelWidth(page)).toBe(160);

    await dragEdgeTo(page, 1512 - 800);
    await expect.poll(() => peekWidth(page)).toBe(800);
    await page.keyboard.press('Escape');
    await expect(peek(page)).toHaveCount(0);
    await openRow(page, 'r2');
    await expect.poll(() => peekWidth(page)).toBe(800);
  });

  test('resizes from the keyboard', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    const handle = peek(page).getByRole('separator', { name: 'Side peek' });

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => peekWidth(page)).toBe(772);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => peekWidth(page)).toBe(740);
    await page.keyboard.press('End');
    await expect(handle).toHaveAttribute('aria-valuenow', '1008');
    await expect.poll(() => peekWidth(page)).toBe(1008);
  });

  test('has no resize handle in the center peek', async ({ page }) => {
    await mount(page, blocks({ openPagesIn: 'center' }));
    await openRow(page, 'r1');
    await expect(peek(page)).toHaveAttribute('data-peek-mode', 'center');
    await expect(peek(page).getByRole('separator', { name: 'Side peek' })).toBeHidden();
  });
});

test.describe('page icon', () => {
  test('Add icon picks an emoji that shows on the page and in the title cell', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    await page.getByRole('button', { name: 'Add icon' }).click();
    const emoji = page.locator('[data-blok-emoji-picker] [data-emoji-native]').first();

    await expect(emoji).toBeVisible();
    const native = await emoji.getAttribute('data-emoji-native');

    await emoji.click();

    await expect(peek(page).locator('[data-blok-database-drawer-icon]')).toHaveText(native ?? '');
    await expect(page.locator('[data-blok-database-table-row][data-row-id="r1"] [data-blok-database-page-icon]')).toHaveText(native ?? '');
    expect((await saved(page)).find((b) => b.id === 'r1')?.data.icon).toBe(native);
  });
});

test.describe('read-only', () => {
  test('a read-only viewer opens a row page to read it', async ({ page }) => {
    await mount(page, blocks(), true);
    await openRow(page, 'r1');

    await expect(body(page).getByText('Alpha body')).toBeVisible();
    await expect(peekTitle(page)).toHaveAttribute('readonly', '');
    await expect(peek(page).locator('[data-blok-database-drawer-add-prop]')).toHaveCount(0);
  });
});

// research/22 §3: the value row is 34px, level with the 160x34 label cell; Escape saves a text.
test.describe('property rows', () => {
  const valueOf = (page: Page): Locator => peek(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-notes"]');
  const headOf = (page: Page): Locator => valueOf(page).locator('xpath=..').locator('[data-blok-database-drawer-prop-head]');

  test('a value row is 34px tall and lines up with its label cell', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    const value = await valueOf(page).boundingBox();
    const head = await headOf(page).boundingBox();

    expect(value?.height).toBe(34);
    expect(head?.height).toBe(34);
    expect(value?.y).toBe(head?.y);
  });

  test('Escape saves a typed note, closes only the editor, and one undo takes it back', async ({ page }) => {
    const notes = async (): Promise<unknown> => ((await saved(page)).find((b) => b.id === 'r1')?.data.properties as Record<string, unknown>)['p-notes'];

    await mount(page, blocks());
    await openRow(page, 'r1');
    await valueOf(page).click();
    await page.locator('[data-blok-database-cell-input="text"]').fill('A note');
    await page.keyboard.press('Escape');

    await expect.poll(notes).toBe('A note');
    await expect(page.locator('[data-blok-database-cell-editor]')).toHaveCount(0);
    await expect(peek(page)).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(notes).toBeUndefined();
  });
});

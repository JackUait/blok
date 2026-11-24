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

  test('body blocks copied from one row paste into another row, toggle child included', async ({ page }) => {
    await mount(page, blocks().flatMap((b): OutputBlockData[] => {
      if (b.id === 'r1') {
        return [{ ...b, content: ['b1', 'b2', 'b3'] }];
      }

      return b.id !== 'b1' ? [b] : [
        { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'Body one' } },
        { id: 'b2', type: 'toggle', parent: 'r1', data: { text: 'Body toggle', isOpen: true }, content: ['b2c'] },
        { id: 'b2c', type: 'paragraph', parent: 'b2', data: { text: 'Toggle child' } },
        { id: 'b3', type: 'paragraph', parent: 'r1', data: { text: 'Body three' } },
      ];
    }));
    await openRow(page, 'r1');
    await body(page).getByText('Body one').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');

    const formats = await page.evaluate(() => {
      const store: Record<string, string> = {};
      const transfer = new DataTransfer();
      const setData = transfer.setData.bind(transfer);

      transfer.setData = (format: string, value: string): void => {
        store[format] = value;
        setData(format, value);
      };
      (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true }));

      return store;
    });

    expect(formats['application/x-blok']).toBeDefined();

    await page.mouse.click(5, 5);
    await page.keyboard.press('Escape');
    await expect(peek(page)).toHaveCount(0);
    await openRow(page, 'r2');
    await body(page).locator('[data-blok-database-row-empty]').click();
    await page.evaluate((data) => {
      const transfer = new DataTransfer();

      Object.entries(data).forEach(([format, value]) => transfer.setData(format, value));
      (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, formats);

    await expect.poll(async () => (await saved(page)).filter((b) => b.parent === 'r2').map(textOf))
      .toEqual(['Body one', 'Body toggle', 'Body three']);

    const after = await saved(page);
    const pastedToggle = after.find((b) => b.parent === 'r2' && b.type === 'toggle');

    expect(after.filter((b) => b.parent === pastedToggle?.id).map(textOf)).toEqual(['Toggle child']);
    expect(after.filter((b) => b.parent === undefined).map((b) => b.id)).toEqual(['p-before', 'db-1', 'p-after']);
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
    // One Escape = one layer: the peek closes and the database stays unselected (findings-darkkeys K01).
    await expect(page.locator('[data-blok-id="db-1"]')).not.toHaveAttribute('data-blok-selected', 'true');
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

  // notion-motion.md Round 44 §5: a center peek shows the mode switch and the row steps only while the pointer is on its header.
  test('a center peek shows its mode switch and row steps only while the pointer is on the header', async ({ page }) => {
    await mount(page, blocks({ openPagesIn: 'center' }));
    await openRow(page, 'r1');
    await expect(peek(page)).toHaveAttribute('data-peek-mode', 'center');

    const toolbar = peek(page).locator('[data-blok-database-drawer-toolbar]');
    const revealed = toolbar.locator('[data-blok-database-peek-mode], [data-blok-database-peek-next]');
    const box = await toolbar.boundingBox();

    if (box === null) throw new Error('no toolbar');

    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    for (const el of await revealed.all()) await expect(el).toHaveCSS('opacity', '0');
    await expect(toolbar.locator('[data-blok-database-peek-expand]')).toHaveCSS('opacity', '1');
    await expect(toolbar.locator('[data-blok-database-drawer-close]')).toBeHidden();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (const el of await revealed.all()) await expect(el).toHaveCSS('opacity', '1');
  });

  test('a keyboard user still reaches the center peek\'s hidden header controls', async ({ page }) => {
    await mount(page, blocks({ openPagesIn: 'center' }));
    await openRow(page, 'r1');

    const toolbar = peek(page).locator('[data-blok-database-drawer-toolbar]');
    const box = await peek(page).boundingBox();

    if (box === null) throw new Error('no peek');
    // The peek focuses its title on open; wait so that does not take focus back later.
    await expect(peekTitle(page)).toBeFocused();
    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    await toolbar.locator('[data-blok-database-peek-expand]').focus();
    await page.keyboard.press('Tab');
    // The Tab must stay with the header: Blok's block Tab would nest the database under the paragraph above.
    expect((await saved(page)).find((b) => b.id === 'db-1')?.parent).toBeUndefined();
    await expect(toolbar.locator('[data-blok-database-peek-mode]')).toBeFocused();
    await expect(toolbar.locator('[data-blok-database-peek-mode]')).toHaveCSS('opacity', '1');
  });

  // notion-motion.md Round 56 §1: the controls show only near the top: the bar, and the page head down to 4px under its icon row.
  test('a side peek shows its top controls only while the pointer is near its top', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    // Hover is read where the pointer lands, so the slide-in must be over first.
    // data-open comes a frame after mount. Before it no slide runs yet and the peek sits off screen.
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await expect.poll(() => peek(page).evaluate((el) => el.getAnimations().length)).toBe(0);

    const box = await peek(page).boundingBox();
    const head = await peek(page).locator('[data-blok-database-drawer-page-head]').boundingBox();
    const title = await peekTitle(page).boundingBox();

    if (box === null || head === null || title === null) throw new Error('no peek');
    const controls = [peek(page).locator('[data-blok-database-peek-mode]'), peek(page).getByRole('button', { name: 'Add icon' })];
    const expectOpacity = async (opacity: string): Promise<void> => {
      for (const el of controls) await expect(el).toHaveCSS('opacity', opacity);
    };

    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    await expectOpacity('0');
    // Just under the bar, over the head's top: Notion's 44..80 strip.
    await page.mouse.move(head.x + head.width / 2, box.y + 46);
    await expectOpacity('1');
    await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
    await expectOpacity('0');
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await expectOpacity('1');
    await expect(controls[0]).toHaveCSS('transition', 'opacity 0.1s');
  });

  // notion-motion.md Round 56 §6: a center peek hides its icon row too while the pointer is lower down.
  test('a center peek shows its icon row only while the pointer is near its top', async ({ page }) => {
    await mount(page, blocks({ openPagesIn: 'center' }));
    await openRow(page, 'r1');

    const box = await peek(page).boundingBox();
    const addIcon = peek(page).getByRole('button', { name: 'Add icon' });

    if (box === null) throw new Error('no peek');
    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    await expect(addIcon).toHaveCSS('opacity', '0');
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await expect(addIcon).toHaveCSS('opacity', '1');
  });

  // notion-motion.md Round 56 §6: switching to a center peek widens the page over 200ms ease.
  test('switching a side peek to a center peek widens the page over 200ms', async ({ page }) => {
    await mount(page, blocks());
    await openRow(page, 'r1');
    const host = page.locator('[data-blok-database-peek]');

    await expect(host).toHaveCount(1);
    const handle = await host.elementHandle();

    if (handle === null) throw new Error('no host');
    await page.getByRole('button', { name: 'Open pages in' }).click();
    await page.getByText('Center peek').click();
    await expect(peek(page)).toHaveAttribute('data-peek-mode', 'center');

    const widening = await handle.evaluate((el) => el.getAnimations().map((a) => (a as CSSTransition).transitionProperty));

    // Chromium names the running transition by its physical side.
    expect(widening).toEqual(expect.arrayContaining(['padding-right']));
    await expect.poll(() => handle.evaluate((el) => getComputedStyle(el).paddingInlineEnd)).toBe('0px');
    await expect(host).toHaveCount(0);
  });
});

// notion-motion.md Round 57 §6 and Round 58 §1, read at 1512×717 (and 530 / 900 tall for the cover height).
test.describe('row page cover', () => {
  const COVER = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22%23e07a3f%22/%3E%3C/svg%3E';
  // r1 has an icon and a cover, r2 only an icon, r3 only a cover.
  const HEADS: Record<string, Record<string, string> | undefined> = { r1: { icon: '🍎', cover: COVER }, r2: { icon: '🍎' }, r3: { cover: COVER } };
  const withCover = (view: Record<string, unknown> = {}): OutputBlockData[] => blocks(view).map((block) => {
    const extra = HEADS[block.id ?? ''];

    return extra === undefined ? block : { ...block, data: { ...block.data, ...extra } };
  });

  interface Box { x: number; y: number; width: number; height: number }

  const boxOf = async (locator: Locator): Promise<Box> => {
    const box = await locator.boundingBox();

    if (box === null) throw new Error('no box');

    return box;
  };

  const open = async (page: Page, rowId: string, mode: 'side' | 'center' | 'full'): Promise<void> => {
    await mount(page, withCover(mode === 'side' ? {} : { openPagesIn: mode }));
    await openRow(page, rowId);
    await expect(peek(page)).toHaveAttribute('data-peek-mode', mode);
    // data-open comes a frame after mount. Before it no slide runs yet and a side peek sits off screen.
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await expect.poll(() => peek(page).evaluate((el) => el.getAnimations().length)).toBe(0);
  };

  const cover = (page: Page): Locator => peek(page).locator('[data-blok-database-drawer-cover]');
  const coverImagePosition = (page: Page): Promise<string> => cover(page).evaluate((el) => {
    const image = el.querySelector('img');

    return image === null ? '' : getComputedStyle(image).objectPosition;
  });
  const icon = (page: Page): Locator => peek(page).locator('[data-blok-database-drawer-icon]');
  const control = (page: Page, name: 'add-icon' | 'add-cover' | 'customize'): Locator => peek(page).locator(`[data-blok-database-drawer-${name}]`);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
  });

  test('side peek: spans the whole peek under the bar, square, the row under it and a 36px icon under the row', async ({ page }) => {
    await open(page, 'r1', 'side');

    const box = await boxOf(peek(page));
    const coverBox = await boxOf(cover(page));
    const iconBox = await boxOf(icon(page));
    const customize = await boxOf(control(page, 'customize'));
    const title = await boxOf(peekTitle(page));

    expect(coverBox.x).toBe(box.x);
    expect(coverBox.width).toBe(box.width);
    expect(coverBox.y).toBe(box.y + 44);
    expect(coverBox.height).toBeCloseTo(143.4, 1);
    await expect(cover(page)).toHaveCSS('border-radius', '0px');
    expect(customize.y).toBeCloseTo(coverBox.y + coverBox.height + 16, 1);
    expect(customize.x).toBeCloseTo(title.x - 1, 1);
    expect(iconBox.width).toBe(36);
    expect(iconBox.height).toBe(36);
    expect(iconBox.x).toBeCloseTo(title.x + 8, 1);
    expect(iconBox.y).toBeCloseTo(customize.y + 32, 1);
    expect(title.y).toBeCloseTo(iconBox.y + iconBox.height, 1);
  });

  test('side peek: an icon with no cover sits under the row, 36px', async ({ page }) => {
    await open(page, 'r2', 'side');

    const box = await boxOf(peek(page));
    const iconBox = await boxOf(icon(page));
    const addCover = await boxOf(control(page, 'add-cover'));
    const customize = await boxOf(control(page, 'customize'));
    const title = await boxOf(peekTitle(page));

    expect(addCover.y).toBe(box.y + 48);
    expect(addCover.x).toBeCloseTo(title.x - 1, 1);
    expect(customize.x).toBeCloseTo(addCover.x + addCover.width, 1);
    expect(iconBox.width).toBe(36);
    expect(iconBox.x).toBeCloseTo(title.x + 8, 1);
    expect(iconBox.y).toBe(box.y + 80);
    expect(title.y).toBe(box.y + 116);
  });

  for (const [height, side, full] of [[530, 106, 159], [900, 180, 270]] as const) {
    test(`the cover is 20vh in a peek and 30vh on a full page (${height} tall)`, async ({ page }) => {
      await page.setViewportSize({ width: 1512, height });
      await open(page, 'r3', 'side');
      expect((await boxOf(cover(page))).height).toBeCloseTo(side, 1);
      await open(page, 'r3', 'center');
      expect((await boxOf(cover(page))).height).toBeCloseTo(side, 1);
      await open(page, 'r3', 'full');
      expect((await boxOf(cover(page))).height).toBeCloseTo(full, 1);
    });
  }

  for (const [mode, coverHeight] of [['center', 143.4], ['full', 215.1]] as const) {
    test(`${mode}: the cover spans the whole page under the bar and a 78px icon overlaps it by 42`, async ({ page }) => {
      await open(page, 'r1', mode);

      const box = await boxOf(peek(page));
      const coverBox = await boxOf(cover(page));
      const iconBox = await boxOf(icon(page));
      const customize = await boxOf(control(page, 'customize'));
      const title = await boxOf(peekTitle(page));

      expect(coverBox.x).toBe(box.x);
      expect(coverBox.width).toBe(box.width);
      expect(coverBox.y).toBe(box.y + 44);
      expect(coverBox.height).toBeCloseTo(coverHeight, 1);
      await expect(cover(page)).toHaveCSS('border-radius', '0px');
      expect(iconBox.width).toBe(78);
      expect(iconBox.height).toBe(78);
      expect(iconBox.x).toBeCloseTo(title.x + 8, 1);
      expect(iconBox.y).toBeCloseTo(coverBox.y + coverBox.height - 42, 1);
      // The icon paints over the cover.
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-blok-database-drawer-icon]') !== null, { x: iconBox.x + 39, y: iconBox.y + 10 })).toBe(true);
      expect(customize.x).toBeCloseTo(title.x - 1, 1);
      expect(customize.y).toBeCloseTo(iconBox.y + iconBox.height + 8, 1);
      expect(title.y).toBeCloseTo(customize.y + 32, 1);
    });

    test(`${mode}: with a cover and no icon the row sits 16 under the cover`, async ({ page }) => {
      await open(page, 'r3', mode);

      const coverBox = await boxOf(cover(page));
      const addIcon = await boxOf(control(page, 'add-icon'));
      const customize = await boxOf(control(page, 'customize'));
      const title = await boxOf(peekTitle(page));

      expect(addIcon.y).toBeCloseTo(coverBox.y + coverBox.height + 16, 1);
      expect(addIcon.x).toBeCloseTo(title.x - 1, 1);
      expect(customize.x).toBeCloseTo(addIcon.x + addIcon.width, 1);
      expect(title.y).toBeCloseTo(addIcon.y + 32, 1);
    });

    test(`${mode}: an icon with no cover sits 96 under the bar, the row under it`, async ({ page }) => {
      await open(page, 'r2', mode);

      const box = await boxOf(peek(page));
      const iconBox = await boxOf(icon(page));
      const addCover = await boxOf(control(page, 'add-cover'));
      const title = await boxOf(peekTitle(page));

      expect(iconBox.width).toBe(78);
      expect(iconBox.x).toBeCloseTo(title.x + 8, 1);
      expect(iconBox.y).toBe(box.y + 44 + 96);
      expect(addCover.x).toBeCloseTo(title.x - 1, 1);
      expect(addCover.y).toBe(iconBox.y + iconBox.height + 8);
      expect(title.y).toBe(addCover.y + 32);
    });
  }

  // notion-motion.md Round 59 §2: no icon and no cover. Centre: row at bar + 32, shown at bar + 46, hidden at bar + 66.
  // Full page: row at bar + 80; Round 74 §2: shown from bar + 2, hidden over the bar (bar - 14). The title 32 under the row in both.
  for (const [mode, gap, shownAt, hiddenAt] of [['center', 32, 46, 66], ['full', 80, 2, -14]] as const) {
    test(`${mode}: with no icon and no cover the row sits ${gap} under the bar, the title 32 under it`, async ({ page }) => {
      await mount(page, blocks({ openPagesIn: mode }));
      await openRow(page, 'r2');
      await expect(peek(page)).toHaveAttribute('data-peek-mode', mode);
      await expect(peek(page)).toHaveAttribute('data-open', '');
      await expect.poll(() => peek(page).evaluate((el) => el.getAnimations().length)).toBe(0);

      const box = await boxOf(peek(page));
      const addIcon = await boxOf(control(page, 'add-icon'));
      const title = await boxOf(peekTitle(page));

      expect(addIcon.y).toBeCloseTo(box.y + 44 + gap, 1);
      expect(title.y).toBeCloseTo(addIcon.y + 32, 1);

      const at = async (y: number, opacity: string): Promise<void> => {
        await page.mouse.move(box.x + box.width / 2, box.y + 500);
        await expect(control(page, 'add-icon')).toHaveCSS('opacity', '0');
        await page.mouse.move(addIcon.x + 200, box.y + 44 + y);
        await expect(control(page, 'add-icon')).toHaveCSS('opacity', opacity);
      };

      await at(shownAt, '1');
      await at(hiddenAt, '0');
    });
  }

  // Keyboard focus follows the drawn order: top to bottom, then start to end. The cover's own button comes first.
  const tabOrderAndDrawn = async (page: Page): Promise<{ tabbed: string[]; drawn: string[] }> => {
    const head = peek(page).locator('[data-blok-database-drawer-page-head]');
    const drawn = await head.evaluate((el) => [...el.querySelectorAll('button')]
      .filter((b) => b.closest('[data-blok-database-drawer-cover]') === null)
      .map((b) => ({ name: b.getAttributeNames().find((n) => n.startsWith('data-blok-database-drawer-')) ?? '', rect: b.getBoundingClientRect() }))
      .sort((a, b) => (Math.round(a.rect.top) - Math.round(b.rect.top)) || (a.rect.left - b.rect.left))
      .map((b) => b.name));
    const tabbed: string[] = [];

    await head.evaluate((el) => {
      [...el.querySelectorAll('button')].find((b) => b.closest('[data-blok-database-drawer-cover]') === null)?.focus();
    });
    for (const _ of drawn) {
      tabbed.push(await page.evaluate(() => document.activeElement?.getAttributeNames().find((n) => n.startsWith('data-blok-database-drawer-')) ?? ''));
      await page.keyboard.press('Tab');
    }

    return { tabbed, drawn };
  };

  for (const [mode, rowId] of [['side', 'r1'], ['side', 'r2'], ['center', 'r1'], ['center', 'r2'], ['full', 'r1']] as const) {
    test(`${mode}: Tab walks the head (${rowId}) in the order it is drawn`, async ({ page }) => {
      await open(page, rowId, mode);
      const { tabbed, drawn } = await tabOrderAndDrawn(page);

      expect(tabbed).toEqual(drawn);
      expect(drawn.length).toBeGreaterThan(1);
    });
  }

  // notion-motion.md Round 59 §1: a 28-tall white group 12 in from the cover's top-right. Round 60 §1: its text is 12/16.
  const coverGroup = (page: Page): Locator => cover(page).locator('[data-blok-database-drawer-cover-controls]');

  const expectGroupAt = async (page: Page, right: number): Promise<void> => {
    const coverBox = await boxOf(cover(page));

    await page.mouse.move(coverBox.x + 40, coverBox.y + coverBox.height / 2);
    await expect(coverGroup(page)).toHaveCSS('opacity', '1');
    const group = await boxOf(coverGroup(page));
    const change = await boxOf(coverGroup(page).getByRole('button', { name: 'Change the page cover' }));
    const reposition = await boxOf(coverGroup(page).getByRole('button', { name: 'Reposition the cover image' }));
    const download = await boxOf(coverGroup(page).getByRole('button', { name: 'Download the cover image' }));

    expect(group.y).toBeCloseTo(coverBox.y + 12, 1);
    expect(group.x + group.width).toBeCloseTo(right - 12, 1);
    expect(group.height).toBeCloseTo(28, 1);
    expect(change.height).toBeCloseTo(24, 1);
    expect(change.y).toBeCloseTo(group.y + 2, 1);
    expect(download.width).toBeCloseTo(24, 1);
    expect(download.height).toBeCloseTo(24, 1);
    // A 1px divider with 4px on each side between each two buttons.
    expect(reposition.x).toBeCloseTo(change.x + change.width + 9, 1);
    expect(download.x).toBeCloseTo(reposition.x + reposition.width + 9, 1);
    expect(download.x + download.width).toBeCloseTo(group.x + group.width - 2, 1);
  };

  for (const mode of ['side', 'center', 'full'] as const) {
    test(`${mode}: the cover group sits 12 in from the cover's top-right`, async ({ page }) => {
      await open(page, 'r3', mode);
      await expectGroupAt(page, (await boxOf(cover(page))).x + (await boxOf(cover(page))).width);
      const change = coverGroup(page).getByRole('button', { name: 'Change the page cover' });

      await expect(change).toHaveText('Change');
      await expect(change).toHaveCSS('font-size', '12px');
      await expect(change).toHaveCSS('line-height', '16px');
      await expect(change).toHaveCSS('padding', '0px 6px');
      await expect(change).toHaveCSS('border-radius', '4px');
      await expect(coverGroup(page)).toHaveCSS('padding', '2px');
      await expect(coverGroup(page)).toHaveCSS('border-radius', '6px');
    });
  }

  for (const mode of ['side', 'center', 'full'] as const) {
    test(`${mode} with the details panel open: the cover stops at the panel and the group sits 12 in from it`, async ({ page }) => {
      const data = withCover(mode === 'side' ? {} : { openPagesIn: mode }).map((block) => (block.id !== 'db-1' ? block : {
        ...block,
        data: { ...block.data, schema: SCHEMA.map((p) => (p.type === 'title' ? { ...p, pageLayoutPlacements: [{ id: 'p-notes', place: 'panel' }] } : p)) },
      }));

      await mount(page, data);
      await openRow(page, 'r3');
      await expect(peek(page)).toHaveAttribute('data-peek-mode', mode);
      await expect(peek(page)).toHaveAttribute('data-open', '');
      await peek(page).locator('[data-blok-database-peek-page-info]').click();
      const panel = peek(page).locator('[data-blok-database-drawer-details]');

      await expect(panel).toBeVisible();
      await expect.poll(() => peek(page).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
      const coverBox = await boxOf(cover(page));
      const panelBox = await boxOf(panel);

      // Round 59 §3 (side peek): the cover stops at the panel. Centre and full are inferred from it.
      expect(coverBox.x + coverBox.width).toBeCloseTo(panelBox.x, 1);
      await expectGroupAt(page, panelBox.x);
      // Nothing paints over the buttons.
      for (const name of ['Change the page cover', 'Download the cover image']) {
        const button = coverGroup(page).getByRole('button', { name });
        const b = await boxOf(button);

        expect(await page.evaluate(({ x, y, label }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') === label, { x: b.x + b.width / 2, y: b.y + b.height / 2, label: name })).toBe(true);
      }
    });
  }

  test('the cover group fades in over 0.2s and holds 0.11s before it fades out', async ({ page }) => {
    await open(page, 'r3', 'side');
    const group = coverGroup(page);
    const timing = (): Promise<string[]> => group.evaluate((el) => {
      const style = getComputedStyle(el);

      return [style.transitionProperty, style.transitionDuration, style.transitionTimingFunction, style.transitionDelay];
    });

    await page.mouse.move(10, 700);
    await expect(group).toHaveCSS('opacity', '0');
    expect(await timing()).toEqual(['opacity', '0.2s', 'ease', '0.11s']);
    const coverBox = await boxOf(cover(page));

    await page.mouse.move(coverBox.x + 40, coverBox.y + 40);
    await expect(group).toHaveCSS('opacity', '1');
    expect(await timing()).toEqual(['opacity', '0.2s', 'ease', '0s']);
  });

  // notion-motion.md Round 60 §1: Reposition.
  test('Reposition swaps the group, shows the pill, and a drag moves the image vertically until Save', async ({ page }) => {
    await open(page, 'r3', 'side');
    const coverBox = await boxOf(cover(page));

    await page.mouse.move(coverBox.x + 40, coverBox.y + coverBox.height / 2);
    await coverGroup(page).getByRole('button', { name: 'Reposition the cover image' }).click();

    const save = coverGroup(page).getByRole('button', { name: 'Save position' });
    const cancel = coverGroup(page).getByRole('button', { name: 'Cancel' });
    const hint = cover(page).getByText('Drag image to reposition');

    await expect(save).toBeVisible();
    await expect(cover(page)).toHaveCSS('cursor', 'ns-resize');
    // No divider: Save sits right against Cancel, and both against the group's 2px padding.
    const group = await boxOf(coverGroup(page));
    const saveBox = await boxOf(save);
    const cancelBox = await boxOf(cancel);

    expect(group.height).toBeCloseTo(28, 1);
    expect(cancelBox.x).toBeCloseTo(saveBox.x + saveBox.width, 1);
    expect(group.width).toBeCloseTo(saveBox.width + cancelBox.width + 4, 1);
    expect(group.x + group.width).toBeCloseTo(coverBox.x + coverBox.width - 12, 1);

    const pill = await boxOf(hint);

    expect(pill.height).toBeCloseTo(25.2, 0);
    // notion-motion.md Round 88 §1 #6: 180 wide with the text centred.
    // 180 is a floor, so it is checked with a short text: CI's Linux font runs the English text past it.
    await expect(hint).toHaveCSS('text-align', 'center');
    const pillEl = cover(page).locator('[data-blok-database-drawer-cover-hint]');
    const short = await pillEl.evaluate((el) => {
      el.replaceChildren('Drag');

      return el.getBoundingClientRect().width;
    });

    expect(short).toBeCloseTo(180, 1);
    expect(pill.width).toBeGreaterThanOrEqual(short);
    // A longer locale string widens the pill and is never cut.
    const long = await pillEl.evaluate((el) => {
      el.replaceChildren('Перетащите изображение, чтобы переместить');

      return { width: el.getBoundingClientRect().width, cut: el.scrollWidth > el.clientWidth };
    });

    expect(long.width).toBeGreaterThan(180);
    expect(long.cut).toBe(false);
    await pillEl.evaluate((el) => {
      el.replaceChildren('Drag image to reposition');
    });
    expect(pill.x + pill.width / 2).toBeCloseTo(coverBox.x + coverBox.width / 2, 0);
    expect(pill.y + pill.height / 2).toBeCloseTo(coverBox.y + coverBox.height / 2, 0);
    await expect(hint).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.4)');
    await expect(hint).toHaveCSS('font-size', '12px');
    await expect(hint).toHaveCSS('transition-property', 'opacity');
    await expect(hint).toHaveCSS('transition-duration', '0.2s');
    // A mouse click hands focus to Save with no ring.
    expect(await save.evaluate((el) => el.matches(':focus-visible'))).toBe(false);

    // The group stays with the pointer off the cover.
    await page.mouse.move(coverBox.x + 40, coverBox.y + coverBox.height + 200);
    await expect(coverGroup(page)).toHaveCSS('opacity', '1');

    // The 10×10 image shows as wide as the cover is, so a 70px drag down is 70 ÷ width.
    await page.mouse.move(coverBox.x + 200, coverBox.y + 60);
    await page.mouse.down();
    await page.mouse.move(coverBox.x + 280, coverBox.y + 100, { steps: 4 });
    await page.mouse.move(coverBox.x + 280, coverBox.y + 130, { steps: 2 });
    await page.mouse.up();
    const expected = Math.round((50 - (70 / coverBox.width) * 100) * 100) / 100;
    const position = (await coverImagePosition(page)).split(' ');

    expect(position[0]).toBe('50%');
    expect(parseFloat(position[1])).toBeCloseTo(expected, 1);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);
    await expect(peek(page)).toHaveAttribute('data-open', '');

    await save.click();
    await expect(hint).toHaveCount(0);
    await expect(coverGroup(page).getByRole('button', { name: 'Reposition the cover image' })).toHaveCount(1);
    const saved = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks.find((block) => block.id === 'r3')?.data as { coverPosition?: number } | undefined);

    expect(saved?.coverPosition).toBeCloseTo(expected, 1);
    await expect.poll(() => coverImagePosition(page)).toBe(`50% ${saved?.coverPosition}%`);
  });

  // notion-motion.md Round 61 §3: Escape cancels and closes the side peek; a click elsewhere saves.
  test('Cancel and Escape leave Reposition without moving the image, and Escape closes the side peek', async ({ page }) => {
    await open(page, 'r3', 'side');
    const coverBox = await boxOf(cover(page));
    const reposition = async (): Promise<void> => {
      await page.mouse.move(coverBox.x + 40, coverBox.y + coverBox.height / 2);
      await coverGroup(page).getByRole('button', { name: 'Reposition the cover image' }).click();
      await page.mouse.move(coverBox.x + 200, coverBox.y + 60);
      await page.mouse.down();
      await page.mouse.move(coverBox.x + 200, coverBox.y + 120, { steps: 3 });
      await page.mouse.up();
      await expect.poll(() => coverImagePosition(page)).not.toBe('50% 50%');
    };

    await reposition();
    await coverGroup(page).getByRole('button', { name: 'Cancel' }).click();
    // The pill is still there, fading to 0, then goes.
    expect(await cover(page).evaluate((el) => el.querySelector<HTMLElement>('[data-blok-database-drawer-cover-hint]')?.style.opacity ?? 'gone')).toBe('0');
    await expect(cover(page).getByText('Drag image to reposition')).toHaveCount(0);
    await expect.poll(() => coverImagePosition(page)).toBe('50% 50%');

    await reposition();
    await page.keyboard.press('Escape');
    await expect(peek(page)).not.toHaveAttribute('data-open', '');
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);
    const saved = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks.find((block) => block.id === 'r3')?.data);

    expect(saved).not.toHaveProperty('coverPosition');
    await openRow(page, 'r3');
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await expect.poll(() => coverImagePosition(page)).toBe('50% 50%');
  });

  test('a click on the title or outside the peek saves the dragged position', async ({ page }) => {
    await open(page, 'r3', 'side');
    const coverBox = await boxOf(cover(page));
    const repositionBy = async (dy: number): Promise<string> => {
      await page.mouse.move(coverBox.x + 40, coverBox.y + coverBox.height / 2);
      await coverGroup(page).getByRole('button', { name: 'Reposition the cover image' }).click();
      await page.mouse.move(coverBox.x + 200, coverBox.y + 40);
      await page.mouse.down();
      await page.mouse.move(coverBox.x + 200, coverBox.y + 40 + dy, { steps: 3 });
      await page.mouse.up();
      await expect.poll(() => coverImagePosition(page)).not.toBe('50% 50%');

      return coverImagePosition(page);
    };
    const savedPosition = (): Promise<number | undefined> => page.evaluate(async () => ((await window.blokInstance?.save())?.blocks.find((block) => block.id === 'r3')?.data as { coverPosition?: number } | undefined)?.coverPosition);

    const shown = await repositionBy(40);

    await peek(page).locator('[data-blok-database-drawer-title]').click();
    await expect(cover(page).getByText('Drag image to reposition')).toHaveCount(0);
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await expect.poll(savedPosition).toBe(parseFloat(shown.split(' ')[1]));

    const moved = await repositionBy(20);

    await page.mouse.click(20, 700);
    await expect.poll(savedPosition).toBe(parseFloat(moved.split(' ')[1]));
  });

  test('Download saves the cover image and Change opens the picker', async ({ page }) => {
    await open(page, 'r3', 'side');
    const coverBox = await boxOf(cover(page));

    await page.mouse.move(coverBox.x + 40, coverBox.y + 40);
    const download = page.waitForEvent('download');

    await coverGroup(page).getByRole('button', { name: 'Download the cover image' }).click();
    expect(await download).toBeTruthy();
    await coverGroup(page).getByRole('button', { name: 'Change the page cover' }).click();
    await expect(page.locator('[data-role="audio-cover-picker"]')).toBeVisible();
  });

  test('shows the top controls over the whole cover and down to the title', async ({ page }) => {
    await open(page, 'r1', 'side');

    const box = await peek(page).boundingBox();

    if (box === null) throw new Error('no peek');
    const mode = peek(page).locator('[data-blok-database-peek-mode]');
    // Notion's points, relative to the peek's left edge (756).
    const at = async (x: number, y: number, opacity: string): Promise<void> => {
      await page.mouse.move(box.x + 744, 700);
      await expect(mode).toHaveCSS('opacity', '0');
      await page.mouse.move(box.x + x - 756, y);
      await expect(mode).toHaveCSS('opacity', opacity);
    };

    await at(780, 62, '1');
    await at(1440, 62, '1');
    await at(1000, 190, '1');
    await at(1000, 268, '1');
    await at(1000, 274, '0');
    await at(800, 200, '0');
    await at(1450, 200, '0');
    await at(800, 250, '0');
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

  // A read-only viewer cannot convert a legacy body, so the peek shows it in its own nested editor.
  test('a read-only viewer reads a legacy body in the nested editor', async ({ page }) => {
    const legacy = blocks({}, []);
    const db = legacy[1];

    db.data = { ...db.data, schema: [...SCHEMA, { id: 'p-body', name: 'Card details', type: 'richText', position: 'a2' }] };
    legacy[4] = {
      ...legacy[4],
      data: { position: 'a1', properties: { 'p-title': 'Bravo', 'p-body': { blocks: [{ type: 'paragraph', data: { text: 'Old body' } }] } } },
    };
    await mount(page, legacy, true);
    await openRow(page, 'r2');

    await expect(body(page).locator('[data-blok-editor]').getByText('Old body')).toBeVisible();
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

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SavedBlock {
  id: string;
  type: string;
  parent: string | null;
}

const toggle = (id: string, extra: Partial<OutputData['blocks'][number]> & { isOpen?: boolean } = {}): OutputData['blocks'][number] => {
  const { isOpen = true, ...rest } = extra;

  return { id, type: 'toggle', data: { text: `Toggle ${id}`, isOpen }, ...rest };
};

const paragraph = (id: string, parent?: string): OutputData['blocks'][number] => ({
  id,
  type: 'paragraph',
  data: { text: `Paragraph ${id}` },
  ...(parent !== undefined ? { parent } : {}),
});

/**
 * The test page registers every default tool, columns included — the same
 * set the real consumer registers.
 */
const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const save = async (page: Page): Promise<SavedBlock[]> =>
  await page.evaluate(async () => {
    const output = await window.blokInstance?.save();

    return (output?.blocks ?? []).map(block => ({
      id: block.id ?? '',
      type: block.type,
      parent: block.parent ?? null,
    }));
  });

const boxOf = async (page: Page, selector: string): Promise<Box> => {
  const box = await page.locator(selector).first().boundingBox();

  if (box === null) {
    throw new Error(`missing bounding box for ${selector}`);
  }

  return box;
};

/** The block's own title (its first editable), not a nested child's. */
const titleOf = (id: string): string => `[data-blok-id="${id}"] [contenteditable="true"]`;

/**
 * Real pointer drag of block `id` by its ⠿ handle to (x, y). Returns the edge
 * the drop indicator showed right before release.
 */
const dragBlockTo = async (
  page: Page,
  id: string,
  target: (start: { x: number; y: number }) => Promise<{ x: number; y: number }>
): Promise<{ indicatorId: string | null; edge: string | null }> => {
  const title = await boxOf(page, titleOf(id));

  await page.mouse.move(title.x + 10, title.y + title.height / 2);
  await expect(page.locator(HANDLE)).toBeVisible();

  const handle = await boxOf(page, HANDLE);
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 6, { steps: 3 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true'
  );

  const point = await target({ x: startX, y: startY });

  await page.mouse.move(point.x, point.y, { steps: 15 });

  const indicator = await page.evaluate(() => {
    const element = document.querySelector('[data-drop-indicator]');

    return {
      indicatorId: element?.getAttribute('data-blok-id') ?? null,
      edge: element?.getAttribute('data-drop-indicator') ?? null,
    };
  });

  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true'
  );

  return indicator;
};

/** 2px above the bottom of the toggle's holder: the strip below its last child. */
const bottomStripOf = (page: Page, id: string) => async (): Promise<{ x: number; y: number }> => {
  const holder = await boxOf(page, `[data-blok-id="${id}"]`);
  const title = await boxOf(page, titleOf(id));

  return { x: title.x + 40, y: holder.y + holder.height - 2 };
};

test.describe('toggle drag regressions', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('an open toggle with a child dropped below a collapsed toggle stays a visible root block', async ({ page }) => {
    await createBlok(page, [
      paragraph('p0'),
      toggle('C', { isOpen: false, content: ['c1'] }),
      paragraph('c1', 'C'),
      toggle('M', { content: ['m1'] }),
      paragraph('m1', 'M'),
      paragraph('q'),
      paragraph('z'),
    ]);

    const indicator = await dragBlockTo(page, 'M', async () => {
      const row = await boxOf(page, titleOf('C'));
      const content = await boxOf(page, '[data-blok-id="C"] [data-blok-element-content]');

      return { x: content.x + content.width / 2, y: row.y + row.height * 0.8 };
    });

    const saved = await save(page);

    expect(saved.find(block => block.id === 'M')?.parent).toBeNull();
    expect(indicator).toEqual({ indicatorId: 'C', edge: 'bottom' });
    expect(saved.map(block => block.id)).toEqual(['p0', 'C', 'c1', 'M', 'm1', 'q', 'z']);
    expect(saved.find(block => block.id === 'm1')?.parent).toBe('M');
    await expect(page.locator('[data-blok-id="M"]')).toBeVisible();
    expect(await page.locator('[data-blok-id="C"] [data-blok-id="M"]').count()).toBe(0);
  });

  test('a nested toggle WITH a child escapes to root after its parent\'s subtree', async ({ page }) => {
    await createBlok(page, [
      paragraph('a'),
      toggle('out', { content: ['c1', 'in', 'c2'] }),
      paragraph('c1', 'out'),
      toggle('in', { parent: 'out', content: ['g1'] }),
      paragraph('g1', 'in'),
      paragraph('c2', 'out'),
      paragraph('b'),
    ]);

    const indicator = await dragBlockTo(page, 'in', bottomStripOf(page, 'out'));
    const saved = await save(page);

    expect(saved.find(block => block.id === 'in')?.parent).toBeNull();
    expect(indicator).toEqual({ indicatorId: 'out', edge: 'bottom' });
    expect(saved.map(block => block.id)).toEqual(['a', 'out', 'c1', 'c2', 'in', 'g1', 'b']);
    expect(saved.find(block => block.id === 'g1')?.parent).toBe('in');
    expect(await page.locator('[data-blok-id="out"] [data-blok-id="in"]').count()).toBe(0);
  });

  test('a childless nested toggle escapes after its parent\'s subtree, and undo restores the tree', async ({ page }) => {
    await createBlok(page, [
      paragraph('a'),
      toggle('out', { content: ['c1', 'in', 'c2'] }),
      paragraph('c1', 'out'),
      toggle('in', { parent: 'out' }),
      paragraph('c2', 'out'),
      paragraph('b'),
    ]);

    const before = await save(page);

    await dragBlockTo(page, 'in', bottomStripOf(page, 'out'));

    const saved = await save(page);

    expect(saved.map(block => block.id)).toEqual(['a', 'out', 'c1', 'c2', 'in', 'b']);
    expect(saved.find(block => block.id === 'in')?.parent).toBeNull();

    await page.keyboard.press(UNDO);

    await expect.poll(async () => await save(page)).toEqual(before);
    expect(await page.locator('[data-blok-id="out"] [data-blok-id="in"]').count()).toBe(1);
  });

  test('a straight vertical drag from the handle reorders and never creates columns', async ({ page }) => {
    await createBlok(page, [
      paragraph('p1'),
      paragraph('p2'),
      paragraph('p3'),
    ]);

    // Same x as the handle the drag started from: no sideways move at all.
    const indicator = await dragBlockTo(page, 'p1', async (start) => {
      const target = await boxOf(page, '[data-blok-id="p3"] [data-blok-element-content]');

      return { x: start.x, y: target.y + target.height / 2 + 3 };
    });

    const saved = await save(page);

    expect(saved.some(block => block.type === 'column_list')).toBe(false);
    expect(indicator.edge).not.toBe('left');
    expect(saved.map(block => block.id)).toEqual(['p2', 'p3', 'p1']);
  });
});

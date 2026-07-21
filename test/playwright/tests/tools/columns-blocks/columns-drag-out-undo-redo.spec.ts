import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE = 600;

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => new Promise<void>((r) => window.setTimeout(r, t)), ms);
};

/** Article: top paras, a 2-column layout (each: header + media), bottom paras. */
const fixture = (): OutputData => ({
  blocks: [
    { id: 'top1', type: 'paragraph', data: { text: 'Top one' } },
    { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1h', 'c1p'] },
    { id: 'c1h', type: 'header', data: { text: 'Left', level: 3 }, parent: 'c1' },
    { id: 'c1p', type: 'paragraph', data: { text: 'Left media' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2h', 'c2p'] },
    { id: 'c2h', type: 'header', data: { text: 'Right', level: 3 }, parent: 'c2' },
    { id: 'c2p', type: 'paragraph', data: { text: 'Right media' }, parent: 'c2' },
    { id: 'bot1', type: 'paragraph', data: { text: 'Bottom one' } },
    { id: 'bot2', type: 'paragraph', data: { text: 'Bottom two' } },
  ],
});

const grabLeafHandle = async (page: Page, id: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${id}"]`).first();
  const box = await holder.boundingBox();
  if (!box) throw new Error(`no box for ${id}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();
  return handle;
};

const dragTo = async (page: Page, handle: Locator, targetId: string, yFrac: number): Promise<void> => {
  const src = await handle.boundingBox();
  const tgt = await page.locator(`[data-blok-id="${targetId}"] [data-blok-element-content]`).first().boundingBox();
  if (!src || !tgt) throw new Error('missing boxes for drag');
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(tgt.x + tgt.width / 2, tgt.y + tgt.height * yFrac, { steps: 18 });
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/** Every block's model parent must equal its live DOM column membership, and the
 *  columns row must hold only column wrappers + resizers. */
const assertConsistent = async (page: Page, label: string): Promise<void> => {
  const divergences = await page.evaluate(() => {
    const inst = window.blokInstance as unknown as {
      blocks: { getById?: (id: string) => { parentId: string | null } | null };
    };
    const domColumnOf = (holder: Element): string | null =>
      holder.closest('[data-blok-column]')?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null;

    // A block's live DOM column membership must equal its model parentId.
    const holderMismatch = (holder: Element): string | null => {
      const id = holder.getAttribute('data-blok-id');
      if (id === null) {
        return null;
      }
      const modelParent = inst.blocks.getById?.(id)?.parentId ?? null;
      const domColumn = domColumnOf(holder);

      return domColumn !== null && domColumn !== modelParent
        ? `${id}: DOM column ${domColumn} != model parent ${modelParent}`
        : null;
    };

    // The columns row must hold only column wrappers + resizers.
    const foreignRowChild = (el: Element): string | null =>
      el.matches('[data-blok-column-resizer]') || el.querySelector('[data-blok-column]') !== null
        ? null
        : `foreign row child: ${el.getAttribute('data-blok-id') ?? '<anon>'}`;

    const rowChildren = Array.from(document.querySelector('[data-blok-columns]')?.children ?? []);

    return [
      ...Array.from(document.querySelectorAll('[data-blok-element][data-blok-id]')).map(holderMismatch),
      ...rowChildren.map(foreignRowChild),
    ].filter((entry): entry is string => entry !== null);
  });
  expect(divergences, `${label}: model/DOM divergences`).toEqual([]);
};

test.beforeAll(() => ensureBlokBundleBuilt());

test('drag a column child out, edit elsewhere, undo/redo — no stranded holders', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await createBlok(page, fixture());
  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  await assertConsistent(page, 'initial');

  // Drag c2p (right column media) out, stack below bot1 at root.
  await dragTo(page, await grabLeafHandle(page, 'c2p'), 'bot1', 0.9);
  await wait(page, CAPTURE);
  await assertConsistent(page, 'after drag c2p out');

  // Edit elsewhere (forces re-render churn).
  const top1 = page.locator('[data-blok-id="top1"] [contenteditable="true"]').first();
  await top1.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await wait(page, CAPTURE);
  await assertConsistent(page, 'after edit elsewhere');

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(UNDO);
    await wait(page, CAPTURE);
    await assertConsistent(page, `after undo ${i + 1}`);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(REDO);
    await wait(page, CAPTURE);
    await assertConsistent(page, `after redo ${i + 1}`);
  }
});

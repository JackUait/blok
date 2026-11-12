/**
 * Round 4 of the Notion undo replica (parity-v4.md): announcements stay put,
 * keyboard moves keep the caret offset, and a block menu delete survives
 * undo, Backspace, undo.
 */
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Past the capture window, so gestures stay separate steps.
const CAPTURE_GAP = 800;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
    regionLog?: Array<{ t: number; text: string }>;
  }
}

type SavedBlock = OutputData['blocks'][number];

const P = (id: string, text: string): SavedBlock => ({ id, type: 'paragraph', data: { text } });
const BASE = [P('p-before', 'before'), P('p1', 'Alpha'), P('p2', 'Beta'), P('p-after', 'after')];

const createBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await page.evaluate(async ({ holder, initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
};

const gap = async (page: Page, ms = CAPTURE_GAP): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const savedIds = async (page: Page): Promise<string[]> => page.evaluate(async () =>
  ((await window.blokInstance?.save())?.blocks ?? []).map((block) => block.id ?? ''));

/** Saved blocks as `id:html`, next to the same read from the DOM. */
const savedAndDom = async (page: Page): Promise<{ saved: string[]; dom: string[] }> => {
  const { blocks, dom } = await page.evaluate(async (holder) => ({
    blocks: (await window.blokInstance?.save())?.blocks ?? [],
    dom: Array.from(document.querySelectorAll(`#${holder} [data-blok-testid="block-wrapper"]`)).map((el) =>
      `${el.getAttribute('data-blok-id') ?? ''}:${el.querySelector('[contenteditable="true"]')?.innerHTML ?? ''}`),
  }), HOLDER_ID);
  const saved = blocksAsHtml(blocks).map((block) => `${block.id ?? ''}:${String(block.data.text ?? '')}`);

  return { saved, dom };
};

const selectedIds = async (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"][data-blok-selected="true"]'))
    .map(el => el.getAttribute('data-blok-id') ?? ''));

const openTunes = async (page: Page, id: string): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  const points = [[0.5, 0.5], [0.1, 0.1], [0.5, 0.05], [0.9, 0.5]];

  for (const [fx, fy] of points) {
    await page.mouse.move(box.x + box.width * fx, box.y + Math.min(box.height * fy, box.height - 2));
    const handle = page.locator(HANDLE);

    if (!(await handle.isVisible())) {
      continue;
    }
    await handle.click();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    if (await page.locator(`[data-blok-id="${id}"][data-blok-selected="true"]`).count() > 0) {
      return;
    }
    await page.keyboard.press('Escape');
    await gap(page, 200);
  }
  throw new Error(`could not open the block menu for ${id}`);
};

const tune = (page: Page, name: string): Locator =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

/** Log every text the polite region shows, with a timestamp. */
const watchRegion = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const region = document.querySelector('[data-blok-announcer][role="status"]');

    if (region === null) {
      throw new Error('no polite region');
    }
    window.regionLog = [];
    new MutationObserver(() => {
      window.regionLog?.push({ t: performance.now(), text: region.textContent ?? '' });
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
};

/**
 * Ms from the last write of `text` until the region went blank with no new
 * message right behind; Infinity if it never did, -1 if never written.
 * A blank followed by a write within 20 ms is the announcer's own blank-before-write.
 */
const blankedAfter = async (page: Page, text: string): Promise<number> => page.evaluate((wanted) => {
  const log = window.regionLog ?? [];
  const index = log.map((entry) => entry.text).lastIndexOf(wanted);

  if (index === -1) {
    return -1;
  }
  const wipe = log.slice(index + 1).find((entry, i, rest) => {
    const next = rest[i + 1];

    return entry.text === '' && (next === undefined || next.text === '' || next.t - entry.t > 20);
  });

  return wipe === undefined ? Number.POSITIVE_INFINITY : wipe.t - log[index].t;
}, text);

test.describe('undo replica round 4', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  // A4-2 (U104): Notion writes "Undone" / "Redone" once and never clears them early.
  test('a newer Undone or Redone is not blanked by an older message\'s clear', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p2').click();
    await gap(page);
    await openTunes(page, 'p2');
    await tune(page, 'delete').click();
    await expect.poll(() => savedIds(page)).toEqual(['p-before', 'p1', 'p-after']);
    await watchRegion(page);
    await gap(page, 700);

    await page.keyboard.press(UNDO);
    await expect.poll(() => savedIds(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
    await gap(page, 700);
    expect(await blankedAfter(page, 'Undone')).toBeGreaterThanOrEqual(500);

    await page.keyboard.press(REDO);
    await expect.poll(() => savedIds(page)).toEqual(['p-before', 'p1', 'p-after']);
    await gap(page, 600);
    expect(await blankedAfter(page, 'Redone')).toBeGreaterThanOrEqual(500);
  });

  // Data-loss check: block menu Delete, undo, Backspace, undo. Each press is one step.
  test('U104 then Backspace: each undo brings the block back and save matches the DOM', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p2').click();
    await gap(page);
    await openTunes(page, 'p2');
    await tune(page, 'delete').click();
    await expect.poll(() => savedIds(page)).toEqual(['p-before', 'p1', 'p-after']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => savedIds(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    await gap(page);

    await page.keyboard.press('Backspace');
    await expect.poll(() => savedIds(page)).toEqual(['p-before', 'p1', 'p-after']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => savedIds(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
    const restored = await savedAndDom(page);

    expect(restored.saved).toEqual(['p-before:before', 'p1:Alpha', 'p2:Beta', 'p-after:after']);
    expect(restored.dom).toEqual(restored.saved);

    // The Backspace cleared the redo of the menu delete, so nothing is left to undo.
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page, 300);
    expect(await savedIds(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
  });
});

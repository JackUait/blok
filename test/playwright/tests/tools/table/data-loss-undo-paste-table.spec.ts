/**
 * Undoing the paste of an HTML table into an empty paragraph must
 * leave the document as it was, in save() and in the Yjs doc.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

const wait = (page: Page, ms: number): Promise<void> => page.evaluate((t) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, t);
}), ms);

const DOC: OutputData = {
  blocks: [
    { id: 'keep', type: 'paragraph', data: { text: 'keep' } },
    { id: 'p', type: 'paragraph', data: { text: '' } },
    { id: 'after', type: 'paragraph', data: { text: 'after' } },
  ],
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

/** "id:type:parent:text" per block, sorted, with generated ids masked. */
const savedFacts = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const out = await window.blokInstance?.save();

  return (out?.blocks ?? []).map(b => `${['keep', 'p', 'after'].includes(b.id ?? '') ? b.id : 'NEW'}:${b.type}:${b.parent === undefined ? '' : 'PARENT'}:${String((b.data as { text?: string }).text ?? '')}`).sort();
});

const yjsFacts = (page: Page): Promise<string[]> => page.evaluate(() => {
  const blok = window.blokInstance as unknown as { module: { yjsManager: { toJSON: () => OutputData['blocks'] } } };

  return blok.module.yjsManager.toJSON().map(b => `${['keep', 'p', 'after'].includes(b.id ?? '') ? b.id : 'NEW'}:${b.type}:${b.parent === undefined || b.parent === null ? '' : 'PARENT'}:${String((b.data as { text?: string }).text ?? '')}`).sort();
});

test.describe('undo of pasting a table into an empty paragraph', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page, DOC);
    await wait(page, 700);
  });

  test('one undo leaves no pasted cell blocks in save() or in the Yjs doc', async ({ page }) => {
    await page.locator('[data-blok-id="p"] [contenteditable="true"]').click();
    await page.evaluate(() => {
      const html = '<table><tr><td>X1</td><td>X2</td></tr><tr><td>X3</td><td>X4</td></tr></table>';
      const data: Record<string, string> = { 'text/html': html, 'text/plain': 'X1\tX2\nX3\tX4' };
      const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
      });

      document.activeElement?.dispatchEvent(event);
    });
    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(1);
    await wait(page, 700);

    await page.locator('[data-blok-id="keep"] [contenteditable="true"]').click();
    await page.keyboard.press(UNDO);
    await wait(page, 1500);

    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(0);
    expect(await savedFacts(page)).toEqual(['after:paragraph::after', 'keep:paragraph::keep', 'p:paragraph::']);
    expect(await yjsFacts(page)).toEqual(['after:paragraph::after', 'keep:paragraph::keep', 'p:paragraph::']);
  });

  test('history.undo() leaves no pasted cell blocks in save() or in the Yjs doc', async ({ page }) => {
    await page.locator('[data-blok-id="p"] [contenteditable="true"]').click();
    await page.evaluate(() => {
      const html = '<table><tr><td>X1</td><td>X2</td></tr><tr><td>X3</td><td>X4</td></tr></table>';
      const data: Record<string, string> = { 'text/html': html, 'text/plain': 'X1\tX2\nX3\tX4' };
      const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
      });

      document.activeElement?.dispatchEvent(event);
    });
    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(1);
    await wait(page, 700);

    await page.evaluate(() => window.blokInstance?.history.undo());
    await wait(page, 1500);

    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(0);
    expect(await savedFacts(page)).toEqual(['after:paragraph::after', 'keep:paragraph::keep', 'p:paragraph::']);
    expect(await yjsFacts(page)).toEqual(['after:paragraph::after', 'keep:paragraph::keep', 'p:paragraph::']);
  });

  test('slow device: a big pasted table undone in one press leaves no orphans', async ({ page }) => {
    test.setTimeout(60_000);
    const cdp = await page.context().newCDPSession(page);
    const rows = Array.from({ length: 8 }, (_, r) => `<tr>${Array.from({ length: 8 }, (_, c) => `<td>R${r}C${c}</td>`).join('')}</tr>`).join('');

    await page.locator('[data-blok-id="p"] [contenteditable="true"]').click();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
    await page.evaluate((html) => {
      const data: Record<string, string> = { 'text/html': `<table>${html}</table>` };
      const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
      });

      document.activeElement?.dispatchEvent(event);
    }, rows);
    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(1, { timeout: 60_000 });
    await expect.poll(() => page.locator('[data-blok-tool="table"] [data-blok-table-cell]').count(), { timeout: 60_000 }).toBe(64);
    await wait(page, 3000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await wait(page, 700);
    const stackItems = await page.evaluate(() => (window.blokInstance as unknown as { module: { yjsManager: { undoHistory: { undoManager: { undoStack: unknown[] } } } } }).module.yjsManager.undoHistory.undoManager.undoStack.length);

    await page.locator('[data-blok-id="keep"] [contenteditable="true"]').click();
    await page.keyboard.press(UNDO);
    await wait(page, 1500);

    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(0);
    expect(await savedFacts(page), `undo stack items after paste: ${stackItems}`).toEqual(['after:paragraph::after', 'keep:paragraph::keep', 'p:paragraph::']);
    expect(await yjsFacts(page), `undo stack items after paste: ${stackItems}`).toEqual(['after:paragraph::after', 'keep:paragraph::keep', 'p:paragraph::']);
  });
});

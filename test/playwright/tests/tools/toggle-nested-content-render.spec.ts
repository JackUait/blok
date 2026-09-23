import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const createBlok = async (
  page: Page,
  blocks: OutputData['blocks'],
  readOnly = false
): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks, isReadOnly }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, readOnly: isReadOnly, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks, isReadOnly: readOnly });
};

const paragraph = (id: string, text: string, parent?: string, content?: string[]): OutputData['blocks'][number] => ({
  id,
  type: 'paragraph',
  data: { text },
  ...(parent === undefined ? {} : { parent }),
  ...(content === undefined ? {} : { content }),
});

/** Id of the block whose DOM encloses the given block's holder ('ROOT' at top level). */
const domOwnerOf = (page: Page, blockId: string): Promise<string> =>
  page.evaluate((id) => {
    const holder = document.querySelector(`[data-blok-id="${id}"]`);

    return holder?.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? 'ROOT';
  }, blockId);

const savedBlock = async (page: Page, blockId: string): Promise<OutputData['blocks'][number] | undefined> => {
  const saved = await page.evaluate(() => window.blokInstance?.save());

  return saved?.blocks.find(block => block.id === blockId);
};

const arrowOf = (page: Page, blockId: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${blockId}"] [data-blok-toggle-arrow]`).first();

const editableOf = (page: Page, blockId: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${blockId}"] [contenteditable="true"]`).first();

test.describe('Toggle: content nested under a toggle child renders inside the toggle', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Tab on a toggle child keeps it inside the toggle, and collapsing hides it', async ({ page }) => {
    await createBlok(page, [
      { id: 't1', type: 'toggle', data: { text: 'Spoiler', isOpen: true }, content: ['c1', 'c2'] },
      paragraph('c1', 'first line', 't1'),
      paragraph('c2', 'second line', 't1'),
      paragraph('after', 'After spoiler'),
    ]);

    await page.getByText('second line').click();
    await page.keyboard.press('Tab');

    await expect.poll(async () => (await savedBlock(page, 'c2'))?.parent).toBe('c1');
    expect(await domOwnerOf(page, 'c2')).toBe('t1');

    await arrowOf(page, 't1').click();

    await expect(page.getByText('second line')).toBeHidden();
    await expect(page.getByText('After spoiler')).toBeVisible();
  });

  test('a tabbed toggle grandchild is indented one step more than its parent', async ({ page }) => {
    await createBlok(page, [
      { id: 't1', type: 'toggle', data: { text: 'Spoiler', isOpen: true }, content: ['c1', 'c2'] },
      paragraph('c1', 'first line', 't1'),
      paragraph('c2', 'second line', 't1'),
    ]);

    await page.getByText('second line').click();
    await page.keyboard.press('Tab');
    await expect.poll(() => domOwnerOf(page, 'c2')).toBe('t1');

    const parentBox = await editableOf(page, 'c1').boundingBox();
    const childBox = await editableOf(page, 'c2').boundingBox();

    expect((childBox?.x ?? 0) - (parentBox?.x ?? 0)).toBeCloseTo(24, 0);
  });

  test('a collapsed toggle loaded with toggle > paragraph > paragraph hides the grandchild until expanded', async ({ page }) => {
    await createBlok(page, [
      { id: 't1', type: 'toggle', data: { text: 'Spoiler', isOpen: false }, content: ['c1'] },
      paragraph('c1', 'first line', 't1', ['c2']),
      paragraph('c2', 'nested line', 'c1'),
      paragraph('after', 'After spoiler'),
    ]);

    expect(await domOwnerOf(page, 'c2')).toBe('t1');
    await expect(page.getByText('nested line')).toBeHidden();

    await arrowOf(page, 't1').click();

    await expect(page.getByText('nested line')).toBeVisible();
  });

  test('read-only render keeps the grandchild inside the toggle', async ({ page }) => {
    await createBlok(page, [
      { id: 't1', type: 'toggle', data: { text: 'Spoiler', isOpen: true }, content: ['c1'] },
      paragraph('c1', 'first line', 't1', ['c2']),
      paragraph('c2', 'nested line', 'c1'),
      paragraph('after', 'After spoiler'),
    ], true);

    expect(await domOwnerOf(page, 'c2')).toBe('t1');

    await arrowOf(page, 't1').click();

    await expect(page.getByText('nested line')).toBeHidden();
  });

  test('Tab inside a toggle heading keeps the block inside the heading, and collapsing hides it', async ({ page }) => {
    await createBlok(page, [
      { id: 'h1', type: 'header', data: { text: 'Heading', level: 2, isToggleable: true, isOpen: true }, content: ['c1', 'c2'] },
      paragraph('c1', 'first line', 'h1'),
      paragraph('c2', 'second line', 'h1'),
      paragraph('after', 'After heading'),
    ]);

    await page.getByText('second line').click();
    await page.keyboard.press('Tab');

    await expect.poll(async () => (await savedBlock(page, 'c2'))?.parent).toBe('c1');
    expect(await domOwnerOf(page, 'c2')).toBe('h1');

    await arrowOf(page, 'h1').click();

    await expect(page.getByText('second line')).toBeHidden();
    await expect(page.getByText('After heading')).toBeVisible();
  });

  test('Shift+Tab on a middle child of a toggle inside a callout keeps the adopted sibling inside the callout', async ({ page }) => {
    await createBlok(page, [
      { id: 'co', type: 'callout', data: { emoji: '💡' }, content: ['t1'] },
      { id: 't1', type: 'toggle', data: { text: 'Inner', isOpen: true }, parent: 'co', content: ['c1', 'c2', 'c3'] },
      paragraph('c1', 'one', 't1'),
      paragraph('c2', 'two', 't1'),
      paragraph('c3', 'three', 't1'),
    ]);

    await page.getByText('two', { exact: true }).click();
    await page.keyboard.press('Shift+Tab');

    await expect.poll(async () => (await savedBlock(page, 'c3'))?.parent).toBe('c2');
    expect((await savedBlock(page, 'c2'))?.parent).toBe('co');
    expect(await domOwnerOf(page, 'c3')).toBe('co');
    expect(await domOwnerOf(page, 'c2')).toBe('co');
  });
});

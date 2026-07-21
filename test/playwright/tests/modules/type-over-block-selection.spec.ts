import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '../../../../types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const getParagraphByIndex = (page: Page, index: number): Locator =>
  page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);

const createBlok = async (page: Page, texts: string[]): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });

  await page.evaluate(async ({ holder, texts: t }) => {
    const blok = new window.Blok({
      holder,
      data: { blocks: t.map((text) => ({ type: 'paragraph', data: { text } })) },
    });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, texts });
};

const dumpTexts = async (page: Page): Promise<Array<unknown>> =>
  page.evaluate(async () => {
    const instance = window.blokInstance;

    if (!instance) {
      return [];
    }
    const data: OutputData = await instance.save();

    return data.blocks.map((b) => b.data.text);
  });

const center = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const dragSelect = async (page: Page, fromIndex: number, toIndex: number): Promise<void> => {
  const from = await center(getParagraphByIndex(page, fromIndex));
  const to = await center(getParagraphByIndex(page, toIndex));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
};

test.describe('modules/type-over-block-selection', () => {
  test.beforeAll(() => ensureBlokBundleBuilt());
  test.beforeEach(async ({ page }) => { await gotoTestPage(page); });

  test('typing over a cross-block selection replaces every selected block with one block holding the char', async ({ page }) => {
    await createBlok(page, ['Hello world', 'Second block', 'Foobar tail']);

    await dragSelect(page, 0, 2);
    // Every block is part of the selection.
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);

    await page.keyboard.type('X');

    await expect.poll(() => dumpTexts(page)).toEqual(['X']);
  });

  test('typing over a subset selection deletes those blocks and drops the char into a fresh block at their position', async ({ page }) => {
    await createBlok(page, ['One', 'Two', 'Three', 'Four']);

    await dragSelect(page, 0, 2);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);

    await page.keyboard.type('Z');

    await expect.poll(() => dumpTexts(page)).toEqual(['Z', 'Four']);
  });
});

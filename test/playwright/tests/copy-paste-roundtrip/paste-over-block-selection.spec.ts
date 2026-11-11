import type { Page } from '@playwright/test';

import type { OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';
import { IMG, createEditor, holder, save, selectedIds, settledSave } from './atomic-media-helpers';

/**
 * Real Cmd+C / Cmd+V over a block selection: trusted clipboard events and the
 * system clipboard, which the synthetic tests in copy-paste.spec.ts do not reach.
 */

const P = (id: string, text: string): OutputBlockData => ({ id, type: 'paragraph', data: { text } });

const texts = async (page: Page): Promise<string[]> =>
  blocksAsHtml((await save(page)).blocks).map(b => (b.type === 'paragraph' ? String(b.data.text) : `<${b.type}>`));

const realCopy = async (page: Page): Promise<void> => {
  await page.keyboard.press('ControlOrMeta+C');
  // eslint-disable-next-line playwright/no-wait-for-timeout -- the copy handler is async
  await page.waitForTimeout(400);
};

const realPaste = async (page: Page): Promise<void> => {
  await page.keyboard.press('ControlOrMeta+V');
  // eslint-disable-next-line playwright/no-wait-for-timeout -- the paste pipeline has no handle
  await page.waitForTimeout(800);
  await settledSave(page);
};

const editable = (page: Page, id: string): ReturnType<typeof holder> => holder(page, id).locator('[contenteditable="true"]').first();

const copyFirstTwo = async (page: Page): Promise<void> => {
  await editable(page, 'a').click();
  await editable(page, 'b').click({ modifiers: ['Shift'] });
  expect(await selectedIds(page)).toEqual(['a', 'b']);
  await realCopy(page);
  await page.keyboard.press('Escape');
};

test.describe('paste over a block selection with real keys', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('a paste at a caret inserts the copied blocks', async ({ page }) => {
    await createEditor(page, [P('a', 'First'), P('b', 'Second'), P('t', '')]);
    await copyFirstTwo(page);
    await editable(page, 't').click();
    await realPaste(page);

    expect(await texts(page)).toEqual(['First', 'Second', 'First', 'Second']);
  });

  test('a shift-click selection is replaced by the paste', async ({ page }) => {
    await createEditor(page, [P('a', 'First'), P('b', 'Second'), P('x', 'Xray'), P('y', 'Yankee'), P('z', 'Zulu')]);
    await copyFirstTwo(page);
    await editable(page, 'x').click();
    await editable(page, 'y').click({ modifiers: ['Shift'] });
    expect(await selectedIds(page)).toEqual(['x', 'y']);
    await realPaste(page);

    expect(await texts(page)).toEqual(['First', 'Second', 'First', 'Second', 'Zulu']);
  });

  test('a select-all selection is replaced by the paste', async ({ page }) => {
    await createEditor(page, [P('a', 'First'), P('b', 'Second')]);
    await copyFirstTwo(page);
    await editable(page, 'a').click();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ControlOrMeta+A');
    }
    expect(await selectedIds(page)).toEqual(['a', 'b']);
    await realPaste(page);

    expect(await texts(page)).toEqual(['First', 'Second']);
  });

  test('a rubber-band selection is replaced by the paste', async ({ page }) => {
    await createEditor(page, [P('a', 'First'), P('b', 'Second'), P('x', 'Xray'), P('y', 'Yankee'), P('z', 'Zulu')]);
    await copyFirstTwo(page);
    const from = await holder(page, 'x').boundingBox();
    const to = await holder(page, 'y').boundingBox();

    if (from === null || to === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    expect(await selectedIds(page)).toEqual(['x', 'y']);
    await realPaste(page);

    expect(await texts(page)).toEqual(['First', 'Second', 'First', 'Second', 'Zulu']);
  });

  test('an image still selected after Cmd+C is replaced by its pasted copy', async ({ page }) => {
    await createEditor(page, [
      P('anchor', 'Anchor'),
      { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', naturalWidth: 800, naturalHeight: 600 } },
      P('tail', 'Tail'),
    ]);
    await editable(page, 'anchor').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    expect(await selectedIds(page)).toEqual(['src']);
    await realCopy(page);
    await realPaste(page);
    const saved = await save(page);

    expect(saved.blocks.map(b => b.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(saved.blocks[1].id).not.toBe('src');
    expect(saved.blocks[1].data).toMatchObject({ url: IMG });
  });
});

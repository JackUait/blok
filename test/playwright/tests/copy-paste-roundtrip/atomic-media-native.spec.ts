import { expect, test, type Page } from '@playwright/test';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { IMG, createEditor, holder, selectByKeyboard, selectedIds, settledSave, uploads, waitForChange } from './atomic-media-helpers';

/**
 * Text selections inside atomic blocks (caption, code), copied and pasted with
 * real Cmd/Ctrl+C and Cmd/Ctrl+V on a context that may use the clipboard.
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const readClipboard = async (page: Page): Promise<Record<string, string>> =>
  await page.evaluate(async () => {
    const out: Record<string, string> = {};

    try {
      const items = await navigator.clipboard.read();

      for (const item of items) {
        // eslint-disable-next-line max-depth -- in-page DOM walk
        for (const type of item.types) {
          out[type] = await (await item.getType(type)).text();
        }
      }
    } catch (error) {
      out.error = String(error);
    }

    return out;
  });

/** Selects characters [start, end) of the first text node under the locator's element. */
const selectText = async (page: Page, selector: string, start: number, end: number): Promise<void> => {
  await page.locator(selector).first().evaluate((el, [from, to]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push(node as Text);
    }

    const locate = (offset: number): [Text, number] => {
      let left = offset;

      for (const node of nodes) {
        if (left <= node.length) {
          return [node, left];
        }
        left -= node.length;
      }

      const last = nodes[nodes.length - 1];

      return [last, last.length];
    };
    const [sn, so] = locate(from);
    const [en, eo] = locate(to);
    const range = document.createRange();

    range.setStart(sn, so);
    range.setEnd(en, eo);
    (el as HTMLElement).focus();
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, [start, end]);
};

test.describe('atomic/media: native text copy inside atomic blocks', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('image caption partial text -> empty paragraph', async ({ page }) => {
    await createEditor(page, [
      { id: 'src', type: 'image', data: { url: IMG, caption: 'Sunset caption', naturalWidth: 800, naturalHeight: 600 } },
      { id: 'target', type: 'paragraph', data: { text: '' } },
    ]);

    const before = await settledSave(page);
    const captionSel = '[data-blok-id="src"] [contenteditable="true"]';

    await holder(page, 'src').locator('[contenteditable="true"]').first().click();
    await selectText(page, captionSel, 0, 6);
    await page.keyboard.press('ControlOrMeta+C');

    const clipboard = await readClipboard(page);

    expect(clipboard['text/plain']).toBe('Sunset');

    await holder(page, 'target').locator('[contenteditable="true"]').first().click();
    await page.keyboard.press('ControlOrMeta+V');

    const after = await waitForChange(page, before);

    expect(after.blocks.map((b) => b.type)).toEqual(['image', 'paragraph']);
    expect(JSON.stringify(after.blocks.find((b) => b.id === 'target')?.data)).toContain('Sunset');
    expect(after.blocks.find((b) => b.id === 'src')?.data.caption).toBe('Sunset caption');
    expect(await uploads(page)).toEqual([]);
  });

  test('image caption text -> another image caption', async ({ page }) => {
    await createEditor(page, [
      { id: 'src', type: 'image', data: { url: IMG, caption: 'Sunset caption', naturalWidth: 800, naturalHeight: 600 } },
      { id: 'dst', type: 'image', data: { url: IMG, caption: 'Other', naturalWidth: 800, naturalHeight: 600 } },
    ]);

    const before = await settledSave(page);

    await holder(page, 'src').locator('[contenteditable="true"]').first().click();
    await selectText(page, '[data-blok-id="src"] [contenteditable="true"]', 0, 14);
    await page.keyboard.press('ControlOrMeta+C');

    const dst = holder(page, 'dst').locator('[contenteditable="true"]').first();

    await dst.click();
    await page.keyboard.press('End');
    await page.keyboard.press('ControlOrMeta+V');

    const after = await waitForChange(page, before);

    expect(after.blocks.map((b) => b.type)).toEqual(['image', 'image']);
    expect(after.blocks.find((b) => b.id === 'dst')?.data.caption).toBe('OtherSunset caption');
  });

  test('code lines with a tab -> another code block', async ({ page }) => {
    await createEditor(page, [
      { id: 'src', type: 'code', data: { code: 'one\n\ttwo <b>\nthree', language: 'javascript' } },
      { id: 'dst', type: 'code', data: { code: 'X', language: 'javascript' } },
    ]);

    const before = await settledSave(page);
    const codeSel = '[data-blok-id="src"] [contenteditable]';

    await holder(page, 'src').locator('[contenteditable]').first().click();
    await selectText(page, codeSel, 0, 'one\n\ttwo <b>'.length);
    await page.keyboard.press('ControlOrMeta+C');

    const dst = holder(page, 'dst').locator('[contenteditable]').first();

    await dst.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('ControlOrMeta+V');

    const after = await waitForChange(page, before);

    expect(after.blocks.map((b) => b.type)).toEqual(['code', 'code']);
    expect(after.blocks.find((b) => b.id === 'dst')?.data.code).toBe('Xone\n\ttwo <b>');
  });

  test('code lines with a tab -> empty paragraph', async ({ page }) => {
    await createEditor(page, [
      { id: 'src', type: 'code', data: { code: 'one\n\ttwo <b>\nthree', language: 'javascript' } },
      { id: 'target', type: 'paragraph', data: { text: '' } },
    ]);

    const before = await settledSave(page);

    await holder(page, 'src').locator('[contenteditable]').first().click();
    await selectText(page, '[data-blok-id="src"] [contenteditable]', 0, 'one\n\ttwo <b>'.length);
    await page.keyboard.press('ControlOrMeta+C');
    await holder(page, 'target').locator('[contenteditable="true"]').first().click();
    await page.keyboard.press('ControlOrMeta+V');

    const after = await waitForChange(page, before);

    const pasted = JSON.stringify(after.blocks.filter((b) => b.id !== 'src').map((b) => b.data));

    // Text survives with its markup characters as text, not as tags.
    expect(pasted).toContain('one');
    expect(pasted).toMatch(/two (<b>|&lt;b&gt;)/);
    expect(pasted).not.toContain('"bold"');
  });

  test('real Cmd+C of a block-selected image -> real Cmd+V into empty paragraph', async ({ page }) => {
    await createEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', width: 60, alignment: 'right', naturalWidth: 800, naturalHeight: 600 } },
      { id: 'target', type: 'paragraph', data: { text: '' } },
    ]);

    const before = await settledSave(page);

    await selectByKeyboard(page, 'anchor', 1);
    expect(await selectedIds(page)).toEqual(['src']);
    await page.keyboard.press('ControlOrMeta+C');
    await holder(page, 'target').locator('[contenteditable="true"]').first().click();
    await page.keyboard.press('ControlOrMeta+V');

    const after = await waitForChange(page, before);

    const images = after.blocks.filter((b) => b.type === 'image');

    expect(images).toHaveLength(2);
    expect(images[1].data).toEqual(images[0].data);
    expect(await uploads(page)).toEqual([]);
  });

  test('real Cmd+V while the copied image is still block-selected replaces it with the copy', async ({ page }) => {
    await createEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', naturalWidth: 800, naturalHeight: 600 } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ]);

    const before = await settledSave(page);

    await selectByKeyboard(page, 'anchor', 1);
    await page.keyboard.press('ControlOrMeta+C');
    await page.keyboard.press('ControlOrMeta+V');

    const after = await waitForChange(page, before);
    const images = after.blocks.filter((b) => b.type === 'image');

    // A paste over selected blocks replaces them, as cut and typing do.
    expect(images).toHaveLength(1);
    expect(images[0].id).not.toBe('src');
    expect(images[0].data).toEqual(before.blocks.find((b) => b.id === 'src')?.data);
  });

  test('real Cmd+C of a block-selected code block -> real Cmd+V inside another code block', async ({ page }) => {
    await createEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'src', type: 'code', data: { code: 'inner()\n\tx', language: 'javascript' } },
      { id: 'dst', type: 'code', data: { code: 'outer\nend', language: 'javascript' } },
    ]);

    const before = await settledSave(page);

    await selectByKeyboard(page, 'anchor', 1);
    expect(await selectedIds(page)).toEqual(['src']);
    await page.keyboard.press('ControlOrMeta+C');

    const dst = holder(page, 'dst').locator('[contenteditable]').first();

    await dst.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('ControlOrMeta+V');

    const after = await waitForChange(page, before);

    const codes = after.blocks.filter((b) => b.type === 'code').map((b) => String(b.data.code));

    expect(codes.join('|')).not.toContain('```');
    expect(codes.join('|')).toContain('inner()\n\tx');
  });
});

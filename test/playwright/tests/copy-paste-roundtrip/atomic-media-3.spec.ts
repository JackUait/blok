import type { Page } from '@playwright/test';
import type { OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import {
  AUDIO, IMG, VIDEO,
  blokPayload, clip, createEditor, degrade, forest, holder, newRoots, pasteFocused, pasteInto,
  save, selectAll, selectByKeyboard, selectedIds, settledSave, uploads, waitForChange,
  type Variant,
} from './atomic-media-helpers';

const FILE_URL = 'http://localhost:4444/public/samples/release-notes.txt';

test.describe('atomic/media: mixes, gestures, stale data, pattern hijack', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.route(/youtube\.com|ytimg|example\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // ---- Multi-block selections whose text/plain may collapse to a pattern ----
  const MULTI: Array<{ name: string; blocks: OutputBlockData[] }> = [
    { name: 'spacer + divider', blocks: [
      { id: 's1', type: 'spacer', data: { height: 96 } },
      { id: 's2', type: 'divider', data: {} },
    ] },
    { name: 'table-of-contents + divider', blocks: [
      { id: 's1', type: 'table_of_contents', data: {} },
      { id: 's2', type: 'divider', data: {} },
    ] },
    { name: 'divider + divider', blocks: [
      { id: 's1', type: 'divider', data: {} },
      { id: 's2', type: 'divider', data: {} },
    ] },
    { name: 'image + video', blocks: [
      { id: 's1', type: 'image', data: { url: IMG, caption: 'Cap', naturalWidth: 800, naturalHeight: 600 } },
      { id: 's2', type: 'video', data: { url: VIDEO, caption: 'Vid' } },
    ] },
    { name: 'text + image + code + divider + file', blocks: [
      { id: 's1', type: 'paragraph', data: { text: 'Intro <b>bold</b> <a href="https://example.com/x">link</a>' } },
      { id: 's2', type: 'image', data: { url: IMG, caption: 'Cap', width: 50, naturalWidth: 800, naturalHeight: 600 } },
      { id: 's3', type: 'code', data: { code: 'x < 1\n\ty', language: 'python' } },
      { id: 's4', type: 'divider', data: {} },
      { id: 's5', type: 'file', data: { url: FILE_URL, fileName: 'release-notes.txt', size: 10, mimeType: 'text/plain' } },
    ] },
  ];

  for (const mc of MULTI) {
    for (const variant of ['full', 'html-only', 'plain-only'] as Variant[]) {
      test(`multi ${mc.name} [${variant}]`, async ({ page }) => {
        await createEditor(page, [
          { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
          ...mc.blocks,
          { id: 'target', type: 'paragraph', data: { text: '' } },
        ]);

        const before = await settledSave(page);
        // Shift+ArrowDown extends from the anchor paragraph, so it rides along.
        const ids = ['anchor', ...mc.blocks.map((block) => block.id ?? '')];
        const expected = forest(before.blocks, ids);

        await selectByKeyboard(page, 'anchor', 0, ids.length - 1);
        expect(await selectedIds(page)).toEqual(ids);

        const data = await clip(page, 'copy');

        await pasteInto(page, 'target', degrade(data, variant));

        const after = await waitForChange(page, before);
        const actual = forest(after.blocks, newRoots(before, after));

        if (variant === 'full') {
          // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
          expect(actual).toEqual(expected);
        } else {
          // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
          expect(actual.length, 'no block silently disappears').toBeGreaterThanOrEqual(1);
        }
        expect(await uploads(page)).toEqual([]);
      });
    }
  }

  // ---- Select-all where the other blocks export no Markdown: text/plain may collapse to "---" ----
  for (const extra of ['spacer', 'table_of_contents'] as const) {
    test(`select-all ${extra} + divider + empty paragraph -> fresh editor`, async ({ page }) => {
      await createEditor(page, [
        { id: 's1', type: extra, data: extra === 'spacer' ? { height: 96 } : {} },
        { id: 's2', type: 'divider', data: {} },
        { id: 'p', type: 'paragraph', data: { text: '' } },
      ]);

      const source = await settledSave(page);

      await selectAll(page, 'p');
      expect((await selectedIds(page)).length).toBe(3);

      const data = await clip(page, 'copy');

      // Drop the paragraph's text from the source, as if it were empty: keep it to compare what is pasted.
      const expected = forest(source.blocks, ['s1', 's2', 'p']);

      await createEditor(page, [{ id: 'target', type: 'paragraph', data: { text: '' } }]);

      const before = await settledSave(page);

      await pasteInto(page, 'target', data);

      const after = await waitForChange(page, before);
      const actual = forest(after.blocks, after.blocks.map((block) => block.id ?? ''));

      expect(actual).toEqual(expected);
    });
  }

  // ---- Divider nested in a container, copied alone ----
  test('divider inside toggle copied alone -> top level', async ({ page }) => {
    await createEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'tog', type: 'toggle', data: { text: 'Group', isOpen: true }, content: ['src'] },
      { id: 'src', type: 'divider', data: {}, parent: 'tog' },
      { id: 'target', type: 'paragraph', data: { text: '' } },
    ]);

    const before = await settledSave(page);

    await selectByKeyboard(page, 'anchor', 2);
    expect(await selectedIds(page)).toEqual(['src']);

    const data = await clip(page, 'copy');

    await pasteInto(page, 'target', data);

    const after = await waitForChange(page, before);
    const roots = newRoots(before, after);

    expect(forest(after.blocks, roots)).toEqual([{ type: 'divider', data: {}, children: [] }]);
    expect(roots.map((id) => after.blocks.find((block) => block.id === id)?.parent ?? null)).toEqual([null]);
  });

  // ---- Cmd+A x3: copy the whole document of atomic blocks, paste into a fresh editor ----
  const ALL: OutputBlockData[] = [
    { id: 'anchor', type: 'paragraph', data: { text: 'Start' } },
    { id: 'i', type: 'image', data: { url: IMG, caption: 'Cap', width: 40, alignment: 'left', naturalWidth: 800, naturalHeight: 600 } },
    { id: 'v', type: 'video', data: { url: VIDEO, caption: 'Vid' } },
    { id: 'a', type: 'audio', data: { url: AUDIO, title: 'Song' } },
    { id: 'f', type: 'file', data: { url: FILE_URL, fileName: 'release-notes.txt', size: 10, mimeType: 'text/plain' } },
    { id: 'b', type: 'bookmark', data: { url: 'https://example.com/article', title: 'T' } },
    { id: 'e', type: 'embed', data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ', width: 580, height: 320 } },
    { id: 'c', type: 'code', data: { code: 'line1\n\tline2\n', language: 'go' } },
    { id: 'd', type: 'divider', data: {} },
    { id: 's', type: 'spacer', data: { height: 64 } },
    { id: 't', type: 'table_of_contents', data: {} },
    { id: 'end', type: 'paragraph', data: { text: 'End' } },
  ];

  for (const variant of ['full', 'html-only', 'plain-only'] as Variant[]) {
    test(`select-all document of atomic blocks -> fresh editor [${variant}]`, async ({ page }) => {
      await createEditor(page, ALL);

      const source = await settledSave(page);
      const expected = forest(source.blocks, source.blocks.filter((block) => block.parent === undefined).map((block) => block.id ?? ''));

      await selectAll(page, 'anchor');
      expect((await selectedIds(page)).length).toBe(ALL.length);

      const data = await clip(page, 'copy');

      await createEditor(page, [{ id: 'target', type: 'paragraph', data: { text: '' } }]);

      const before = await settledSave(page);

      await pasteInto(page, 'target', degrade(data, variant));

      const after = await waitForChange(page, before);
      const actual = forest(after.blocks, after.blocks.filter((block) => block.parent === undefined).map((block) => block.id ?? ''));

      if (variant === 'full') {
        // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
        expect(actual).toEqual(expected);
      } else {
        // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
        expect(actual.length).toBeGreaterThanOrEqual(1);
      }
      expect(await uploads(page)).toEqual([]);
    });
  }

  // ---- Cut ----
  for (const block of [
    { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', width: 60, naturalWidth: 800, naturalHeight: 600 } },
    { id: 'src', type: 'divider', data: {} },
    { id: 'src', type: 'code', data: { code: 'a\n\tb\n', language: 'rust' } },
    { id: 'src', type: 'embed', data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ', width: 580, height: 400 } },
  ] as OutputBlockData[]) {
    test(`cut ${block.type} then paste into empty paragraph`, async ({ page }) => {
      await createEditor(page, [
        { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
        block,
        { id: 'target', type: 'paragraph', data: { text: '' } },
      ]);

      const before = await settledSave(page);
      const expected = forest(before.blocks, ['src']);

      await selectByKeyboard(page, 'anchor', 1);
      expect(await selectedIds(page)).toEqual(['src']);

      const data = await clip(page, 'cut');
      const afterCut = await waitForChange(page, before);

      await pasteInto(page, 'target', data);

      const after = await waitForChange(page, afterCut);
      const actual = forest(after.blocks, newRoots(afterCut, after));

      expect(afterCut.blocks.some((entry) => entry.id === 'src'), 'cut removed the source').toBe(false);
      expect(actual).toEqual(expected);
    });
  }

  // ---- Paste the same clipboard twice ----
  test('image pasted twice gives two equal images', async ({ page }) => {
    await createEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', width: 60, naturalWidth: 800, naturalHeight: 600 } },
      { id: 'target', type: 'paragraph', data: { text: '' } },
      { id: 'target2', type: 'paragraph', data: { text: '' } },
    ]);

    const before = await settledSave(page);
    const expected = forest(before.blocks, ['src']);

    await selectByKeyboard(page, 'anchor', 1);
    const data = await clip(page, 'copy');

    await pasteInto(page, 'target', data);
    const mid = await waitForChange(page, before);

    await pasteInto(page, 'target2', data);
    const after = await waitForChange(page, mid);
    const actual = forest(after.blocks, newRoots(before, after));

    expect(actual).toEqual([...expected, ...expected]);
  });

  // ---- Paste while the copied block is still selected ----
  test('paste while the copied image is still block-selected', async ({ page }) => {
    await createEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', naturalWidth: 800, naturalHeight: 600 } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ]);

    const before = await settledSave(page);

    await selectByKeyboard(page, 'anchor', 1);
    const data = await clip(page, 'copy');

    expect(await selectedIds(page)).toEqual(['src']);
    await pasteFocused(page, data);

    const after = await waitForChange(page, before);

    // Whatever paste-over-selection does, the image must not be lost and nothing else may vanish.
    expect(after.blocks.filter((entry) => entry.type === 'image').length).toBeGreaterThanOrEqual(1);
    expect(after.blocks.some((entry) => entry.id === 'tail')).toBe(true);
    expect(after.blocks.some((entry) => entry.id === 'anchor')).toBe(true);
  });

  // ---- Block-copied code pasted into the middle of another code block ----
  test('block-copied code pasted inside another code block text', async ({ page }) => {
    await createEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'src', type: 'code', data: { code: 'inner()\n\tx', language: 'javascript' } },
      { id: 'dst', type: 'code', data: { code: 'outer\nend', language: 'javascript' } },
    ]);

    const before = await settledSave(page);

    await selectByKeyboard(page, 'anchor', 1);
    const data = await clip(page, 'copy');

    const dstCode = holder(page, 'dst').locator('[contenteditable]').first();

    await dstCode.click();
    await dstCode.evaluate((el) => {
      const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();

      range.setStart(node ?? el, node === null ? 0 : 5);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await pasteFocused(page, data);

    const after = await waitForChange(page, before);

    const codes = after.blocks.filter((entry) => entry.type === 'code').map((entry) => entry.data.code);

    // Either inline (outer + inner()\n\tx + \nend) or a new code block: the copied code text must survive intact.
    expect(codes.join('|')).toContain('inner()\n\tx');
    expect(codes.join('|')).toContain('outer');
    expect(codes.join('|')).toContain('end');
  });

  // ---- Stale data: edit, then copy straight away with no save() call ----
  const STALE: Array<{ name: string; block: OutputBlockData; field: string; edit: (page: Page) => Promise<void> }> = [
    {
      name: 'image caption typed',
      block: { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', naturalWidth: 800, naturalHeight: 600 } },
      field: 'caption',
      edit: async (page) => {
        const caption = holder(page, 'src').getByRole('textbox').first();

        await caption.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' EDITED');
        await page.keyboard.press('Escape');
      },
    },
    {
      name: 'file caption typed',
      block: { id: 'src', type: 'file', data: { url: FILE_URL, fileName: 'release-notes.txt', caption: 'Cap', captionVisible: true } },
      field: 'caption',
      edit: async (page) => {
        // The file card's name is also a textbox and comes first; target the caption itself.
        const caption = holder(page, 'src').locator('[data-role="file-caption"]');

        await caption.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' EDITED');
        await expect(caption).toContainText('EDITED');
        await page.keyboard.press('Escape');
      },
    },
    {
      name: 'video caption typed',
      block: { id: 'src', type: 'video', data: { url: VIDEO, caption: 'Cap', captionVisible: true } },
      field: 'caption',
      edit: async (page) => {
        const caption = holder(page, 'src').getByRole('textbox').first();

        await caption.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' EDITED');
        await page.keyboard.press('Escape');
      },
    },
    {
      name: 'code text typed',
      block: { id: 'src', type: 'code', data: { code: 'abc', language: 'javascript' } },
      field: 'code',
      edit: async (page) => {
        const code = holder(page, 'src').locator('[contenteditable]').first();

        await code.click();
        await page.keyboard.press('End');
        await page.keyboard.type('XYZ');
        await page.keyboard.press('Escape');
      },
    },
  ];

  for (const sc of STALE) {
    test(`stale: ${sc.name}, Escape, copy at once`, async ({ page }) => {
      await createEditor(page, [sc.block, { id: 'target', type: 'paragraph', data: { text: '' } }]);
      await settledSave(page);
      await sc.edit(page);

      const selected = await selectedIds(page);

      expect(selected).toEqual(['src']);

      const data = await clip(page, 'copy');
      const payload = blokPayload(data)[0]?.data[sc.field];
      const live = (await save(page)).blocks.find((block) => block.id === 'src')?.data[sc.field];

      expect(String(live)).toContain(sc.field === 'code' ? 'XYZ' : 'EDITED');
      expect(payload).toEqual(live);
    });
  }
});

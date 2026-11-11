import type { OutputBlockData, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { openFixtureToggles } from '../helpers/toggle-open';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import {
  AUDIO, IMG, VIDEO,
  blokPayload, clip, createEditor, forest, holder, newRoots, pasteAtLocator, pasteInto,
  selectByKeyboard, selectedIds, settledSave, uploads, waitForChange,
} from './atomic-media-helpers';

/**
 * Paste a block-selected atomic/media block into containers: callout, toggle,
 * column, tab, table cell, and the middle of a non-empty paragraph.
 */

const TOOLS: Array<{ name: string; block: OutputBlockData }> = [
  { name: 'image', block: { id: 'src', type: 'image', data: { url: IMG, caption: 'Cap', width: 60, alignment: 'right', naturalWidth: 800, naturalHeight: 600 } } },
  { name: 'video', block: { id: 'src', type: 'video', data: { url: VIDEO, caption: 'Vid', width: 70 } } },
  { name: 'audio', block: { id: 'src', type: 'audio', data: { url: AUDIO, caption: 'Aud', title: 'Song' } } },
  { name: 'file', block: { id: 'src', type: 'file', data: { url: 'http://localhost:4444/public/samples/release-notes.txt', fileName: 'release-notes.txt', size: 1234, mimeType: 'text/plain', caption: 'File cap' } } },
  { name: 'bookmark', block: { id: 'src', type: 'bookmark', data: { url: 'https://example.com/article', title: 'Article title', description: 'Desc', domain: 'example.com' } } },
  { name: 'embed', block: { id: 'src', type: 'embed', data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ', width: 580, height: 400, caption: 'Emb' } } },
  { name: 'code', block: { id: 'src', type: 'code', data: { code: 'a <b>\n\tc\n', language: 'javascript', filename: 'x.js' } } },
  { name: 'divider', block: { id: 'src', type: 'divider', data: {} } },
  { name: 'spacer', block: { id: 'src', type: 'spacer', data: { height: 96 } } },
  { name: 'table-of-contents', block: { id: 'src', type: 'table_of_contents', data: { textColor: 'red' } } },
];

type Target = {
  name: string;
  blocks: OutputBlockData[];
  /** Container id every pasted root must hang under; null = top level. */
  parent: string | null;
  editable: string;
  /** Text that must still exist after the paste. */
  keepText?: string;
  offset?: number;
};

const TARGETS: Target[] = [
  {
    name: 'callout child',
    blocks: [
      { id: 'call', type: 'callout', data: { emoji: '💡' }, content: ['target'] },
      { id: 'target', type: 'paragraph', data: { text: '' }, parent: 'call' },
    ],
    parent: 'call',
    editable: 'target',
  },
  {
    name: 'toggle child',
    blocks: [
      { id: 'tog', type: 'toggle', data: { text: 'Group', isOpen: true }, content: ['target'] },
      { id: 'target', type: 'paragraph', data: { text: '' }, parent: 'tog' },
    ],
    parent: 'tog',
    editable: 'target',
  },
  {
    name: 'column',
    blocks: [
      { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['target'] },
      { id: 'target', type: 'paragraph', data: { text: '' }, parent: 'c1' },
      { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
      { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
    ],
    parent: 'c1',
    editable: 'target',
  },
  {
    name: 'tab',
    blocks: [
      { id: 'tabs1', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs1', content: ['target'] },
      { id: 'target', type: 'paragraph', data: { text: '' }, parent: 't1' },
    ],
    parent: 't1',
    editable: 'target',
  },
  {
    name: 'table cell',
    blocks: [
      { id: 'tbl', type: 'table', data: { withHeadings: false, content: [['', ''], ['', '']] } },
    ],
    parent: 'tbl',
    editable: 'tbl',
  },
  {
    name: 'middle of non-empty paragraph',
    blocks: [
      { id: 'target', type: 'paragraph', data: { text: 'Hello world' } },
    ],
    parent: null,
    editable: 'target',
    keepText: 'Hello world',
    offset: 5,
  },
];

const allText = (saved: OutputData): string =>
  saved.blocks.filter((block) => block.type === 'paragraph').map((block) => JSON.stringify(block.data.text)).join('');

test.describe('atomic/media: block-copy pasted into containers', () => {
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

  for (const tool of TOOLS) {
    for (const target of TARGETS) {
      test(`${tool.name} -> ${target.name}`, async ({ page }) => {
        await createEditor(page, [
          { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
          tool.block,
          ...target.blocks,
        ]);
        await openFixtureToggles(page, { blocks: target.blocks });

        const before = await settledSave(page);
        const expected = forest(before.blocks, ['src']);

        await selectByKeyboard(page, 'anchor', 1);
        expect(await selectedIds(page)).toEqual(['src']);

        const data = await clip(page, 'copy');

        expect(blokPayload(data).map((entry) => entry.tool)).toEqual([tool.block.type]);

        if (target.offset !== undefined) {
          await pasteInto(page, target.editable, data, target.offset);
        } else {
          await pasteAtLocator(page, holder(page, target.editable).locator('[contenteditable="true"]').first(), data);
        }

        const after = await waitForChange(page, before);
        const roots = newRoots(before, after);
        // A table cell's own paragraph is new too; keep only blocks of the pasted tool type at the root level.
        const pastedRoots = roots.filter((id) => after.blocks.find((block) => block.id === id)?.type === tool.block.type);
        const actual = forest(after.blocks, pastedRoots);
        const parents = pastedRoots.map((id) => after.blocks.find((block) => block.id === id)?.parent ?? null);
        const domInside = target.parent === null
          ? true
          : await holder(page, target.parent).locator(`[data-blok-id="${pastedRoots[0] ?? 'none'}"]`).count() === 1;

        if (target.name === 'table cell') {
        }

        expect(actual).toEqual(expected);
        expect(parents).toEqual([target.parent]);
        expect(domInside, 'pasted holder sits inside the container DOM').toBe(true);
        expect(await uploads(page)).toEqual([]);
        if (target.keepText !== undefined) {
          // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
          expect(allText(after)).toContain('Hello');
          // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
          expect(allText(after)).toContain(' world');
        }
      });
    }
  }
});

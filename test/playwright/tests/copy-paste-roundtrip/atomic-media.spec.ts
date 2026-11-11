import type { OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import {
  AUDIO, AUDIO_COVER, IMG, VIDEO,
  blokPayload, clip, createEditor, degrade, forest, newRoots, pasteInto,
  selectByKeyboard, selectedIds, settledSave, uploads, waitForChange,
  type Variant,
} from './atomic-media-helpers';

/**
 * Block-select ONE atomic/media block, copy, paste into an empty top-level
 * paragraph, compare the pasted subtree with the source. Three clipboards:
 * everything Blok wrote, html+plain only, plain only.
 */

const CODE = 'function f(a, b) {\n\tif (a < b && b > 0) {\n    return "<div>&amp;</div>";\n\t}\n}\n\n';

export const TOOL_CASES: Array<{ name: string; block: OutputBlockData; pageLink?: boolean; url?: string; layoutOnly?: true }> = [
  {
    name: 'image-full-fields',
    url: IMG,
    block: { id: 'src', type: 'image', data: {
      url: IMG, caption: 'Sunset caption', width: 60, alignment: 'center', frame: 'shadow', rounded: false,
      alt: 'Alt words', fileName: 'shot.png', crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, rotation: 90, flipX: true,
      filter: 'sepia', filterStrength: 50, adjust: { brightness: 10 },
      markup: [{ id: 'm1', type: 'rect', color: '#e03e3e', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, size: 4 }],
      naturalWidth: 800, naturalHeight: 600,
    } },
  },
  {
    name: 'image-size-hidden-caption',
    url: IMG,
    block: { id: 'src', type: 'image', data: { url: IMG, size: 'sm', caption: 'hidden one', captionVisible: false, naturalWidth: 800, naturalHeight: 600 } },
  },
  {
    name: 'video',
    url: VIDEO,
    block: { id: 'src', type: 'video', data: {
      url: VIDEO, caption: 'Video cap', width: 70, alignment: 'right', loop: true, hideControls: true,
      fileName: 'bunny.mp4', mimeType: 'video/mp4',
    } },
  },
  {
    name: 'audio',
    url: AUDIO,
    block: { id: 'src', type: 'audio', data: {
      url: AUDIO, caption: 'Audio cap', title: 'Song', artist: 'Artist', coverUrl: AUDIO_COVER, loop: true,
      fileName: 'song.mp3', mimeType: 'audio/mpeg', duration: 12.5, peaks: [0.1, 0.5, 0.9],
    } },
  },
  {
    name: 'file',
    url: 'http://localhost:4444/public/samples/release-notes.txt',
    block: { id: 'src', type: 'file', data: {
      url: 'http://localhost:4444/public/samples/release-notes.txt', fileName: 'release-notes.txt', size: 1234,
      mimeType: 'text/plain', caption: 'File cap', captionVisible: true,
    } },
  },
  {
    name: 'bookmark',
    url: 'https://example.com/article',
    block: { id: 'src', type: 'bookmark', data: {
      url: 'https://example.com/article', title: 'Article title', description: 'Article description',
      image: IMG, favicon: IMG, domain: 'example.com',
    } },
  },
  {
    name: 'embed-youtube',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    block: { id: 'src', type: 'embed', data: {
      service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ', width: 580, height: 400, widthPercent: 80,
      alignment: 'center', caption: 'Embed cap',
    } },
  },
  {
    name: 'embed-generic-iframe',
    url: 'https://example.com/widget',
    block: { id: 'src', type: 'embed', data: {
      service: '', source: 'https://example.com/widget',
      embed: 'https://example.com/widget', kind: 'iframe', width: 580, height: 240,
    } },
  },
  {
    name: 'code-js-tabs-trailing-newline',
    block: { id: 'src', type: 'code', data: { code: CODE, language: 'javascript', lineNumbers: true, filename: 'x.js' } },
  },
  {
    name: 'code-plain',
    block: { id: 'src', type: 'code', data: { code: '  indented\n\n  two blank above\n', language: 'plain' } },
  },
  { name: 'divider', block: { id: 'src', type: 'divider', data: {} } },
  { name: 'spacer', layoutOnly: true, block: { id: 'src', type: 'spacer', data: { height: 96 } } },
  { name: 'table-of-contents', layoutOnly: true, block: { id: 'src', type: 'table_of_contents', data: { textColor: 'red', backgroundColor: 'blue' } } },
  { name: 'page-link', pageLink: true, block: { id: 'src', type: 'page-link', data: { pageId: 'p1' } } },
  { name: 'page (live in doc)', pageLink: true, block: { id: 'src', type: 'page', data: { pageId: 'p2' } } },
];

const VARIANTS: Variant[] = ['full', 'html-only', 'plain-only'];

test.describe('atomic/media: block-select one, copy, paste into empty top-level paragraph', () => {
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

  for (const tc of TOOL_CASES) {
    for (const variant of VARIANTS) {
      test(`${tc.name} [${variant}]`, async ({ page }) => {
        await createEditor(page, [
          { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
          tc.block,
          { id: 'target', type: 'paragraph', data: { text: '' } },
        ], { pageLink: tc.pageLink });

        const before = await settledSave(page);
        const expected = forest(before.blocks, ['src']);

        await selectByKeyboard(page, 'anchor', 1);
        expect(await selectedIds(page)).toEqual(['src']);

        const data = await clip(page, 'copy');

        expect(blokPayload(data).map((entry) => entry.tool)).toEqual([tc.block.type]);

        const uploadsBefore = await uploads(page);

        await pasteInto(page, 'target', degrade(data, variant));

        const after = await waitForChange(page, before);
        const target = after.blocks.find((block) => block.id === 'target');
        const targetBefore = before.blocks.find((block) => block.id === 'target');
        const targetChanged = target !== undefined && JSON.stringify(target.data) !== JSON.stringify(targetBefore?.data);
        const roots = [...(targetChanged ? ['target'] : []), ...newRoots(before, after)];
        const actual = forest(after.blocks, roots);
        const sourceStill = forest(after.blocks, ['src']);

        expect(sourceStill, 'source block unchanged').toEqual(expected);
        expect((await uploads(page)).slice(uploadsBefore.length), 'no re-upload').toEqual([]);

        if (variant === 'full') {
          // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
          expect(actual).toEqual(expected);
        } else {
          // Degraded clipboard: no block may vanish, and its URL must survive somewhere.
          // A layout-only block has no content to carry, so nothing may land.
          // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
          expect(roots.length > 0, 'something was pasted').toBe(tc.layoutOnly !== true);
          if (tc.url !== undefined) {
            // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
            expect(JSON.stringify(actual), 'url survives').toContain(tc.url);
          }
        }
      });
    }
  }
});

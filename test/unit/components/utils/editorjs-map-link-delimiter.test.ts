import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

/**
 * Editor.js -> Blok migration verification for the @editorjs/link (linkTool) and
 * @editorjs/delimiter block types.
 *
 * These tests run the EXACT runtime migration pipeline (the same calls made on
 * data load with dataModel 'auto'):
 *
 *   const analysis = analyzeDataFormat(blocks)
 *   const out = shouldExpandToHierarchical('auto', analysis.format)
 *     ? expandToHierarchical(blocks)
 *     : blocks
 *
 * Nothing is mocked except silencing console.warn so the linkTool site_name
 * lossy-field warning doesn't pollute test output. The transform functions are
 * the real ones.
 *
 * Source contracts verified before writing these tests:
 * - linkTool -> bookmark mapping: expandLinkToolToHierarchical
 *   (src/components/utils/data-model-transform.ts:741). Maps
 *   { link, meta:{ title, description, image:{url}|string, favicon, domain, site_name } }
 *   -> bookmark { url, title?, description?, image?, favicon?, domain? }.
 *   meta.site_name has no Blok equivalent -> dropped + warned.
 * - Bookmark data shape: BookmarkData extends BookmarkMeta
 *   (src/tools/link/metadata-fetcher.ts:18) = { url, title?, description?,
 *   image?, favicon?, domain? } — image is a flat string, NOT { url }.
 * - delimiter: NOT handled by the transform. It has no legacy-block detector, so
 *   a delimiter-only array is classified 'flat' and the transform is skipped
 *   entirely (pass-through). When a delimiter rides alongside a legacy block the
 *   transform runs but has no delimiter branch, so the block passes through
 *   unchanged with type 'delimiter'. The renderer aliases delimiter -> divider at
 *   render time (TOOL_ALIASES, src/components/modules/renderer.ts:21).
 * - Divider data: DividerData extends BlockToolData and is empty
 *   (src/tools/divider/types.ts) — the divider tool has no configurable fields,
 *   so newer @editorjs/delimiter fields { style, lineWidth, lineThickness } are
 *   ignored at render. The transform itself is field-agnostic and preserves them.
 */

/**
 * The set of Blok-renderable block types: keys of defaultBlockTools in
 * src/tools/index.ts plus the `delimiter` alias resolved at render time
 * (TOOL_ALIASES: delimiter -> divider). A block whose `.type` is not in this
 * set would render as a stub, so bookmark/delimiter must stay inside it.
 */
const RENDERABLE_TYPES = new Set([
  'paragraph',
  'header',
  'list',
  'table',
  'toggle',
  'callout',
  'database',
  'database-row',
  'divider',
  'quote',
  'code',
  'image',
  'column_list',
  'column',
  'embed',
  'bookmark',
  'delimiter',
]);

/**
 * Mirror the runtime load path exactly.
 *
 * @param blocks - editor.js output blocks to migrate
 * @returns blocks after the auto data-model transform
 */
const runMigration = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const analysis = analyzeDataFormat(blocks);

  return shouldExpandToHierarchical('auto', analysis.format)
    ? expandToHierarchical(blocks)
    : blocks;
};

describe('editorjs map: linkTool + delimiter blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('linkTool (@editorjs/link)', () => {
    it('maps a full-meta linkTool (image as {url}) to a bookmark and drops site_name', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'link-full',
          type: 'linkTool',
          data: {
            link: 'https://example.com/article',
            meta: {
              title: 'Example Article',
              description: 'A description of the article.',
              image: { url: 'https://example.com/og.png' },
              favicon: 'https://example.com/favicon.ico',
              domain: 'example.com',
              site_name: 'Example Site',
            },
          },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('bookmark');
      expect(out.data).toEqual({
        url: 'https://example.com/article',
        title: 'Example Article',
        description: 'A description of the article.',
        image: 'https://example.com/og.png',
        favicon: 'https://example.com/favicon.ico',
        domain: 'example.com',
      });
      // site_name has no Blok equivalent and must be dropped, not carried over.
      expect(out.data).not.toHaveProperty('site_name');
      // image must be flattened from { url } to a plain string.
      expect(typeof out.data.image).toBe('string');
      expect(out.id).toBe('link-full');
      expect(out.id).toBeTruthy();
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });

    it('warns once that site_name was dropped', () => {
      const warnSpy = vi.spyOn(console, 'warn');
      const blocks: OutputBlockData[] = [
        {
          id: 'link-warn',
          type: 'linkTool',
          data: {
            link: 'https://example.com',
            meta: { site_name: 'Example Site' },
          },
        },
      ];

      runMigration(blocks);

      expect(warnSpy).toHaveBeenCalled();
      const warnedAboutSiteName = warnSpy.mock.calls.some(call =>
        call.some(arg => typeof arg === 'string' && arg.includes('site_name'))
      );

      expect(warnedAboutSiteName).toBe(true);
    });

    it('maps a linkTool whose meta.image is already a plain string', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'link-img-string',
          type: 'linkTool',
          data: {
            link: 'https://example.com/page',
            meta: {
              title: 'Page',
              image: 'https://example.com/preview.jpg',
            },
          },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('bookmark');
      expect(out.data).toEqual({
        url: 'https://example.com/page',
        title: 'Page',
        image: 'https://example.com/preview.jpg',
      });
      expect(out.id).toBeTruthy();
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });

    it('maps a linkTool with NO meta to a bare bookmark { url }', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'link-bare',
          type: 'linkTool',
          data: {
            link: 'https://example.com/bare',
          },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('bookmark');
      expect(out.data).toEqual({ url: 'https://example.com/bare' });
      // No meta means no title/description/image/favicon/domain keys at all.
      expect(out.data).not.toHaveProperty('title');
      expect(out.data).not.toHaveProperty('image');
      expect(out.id).toBe('link-bare');
      expect(out.id).toBeTruthy();
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });
  });

  describe('delimiter (@editorjs/delimiter)', () => {
    it('passes an empty-data delimiter {} through unchanged, resolvable to a renderable type', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'delim-empty',
          type: 'delimiter',
          data: {},
        },
      ];

      // A delimiter-only array has no legacy blocks, so it is classified 'flat'
      // and the transform is skipped entirely (out === blocks).
      const analysis = analyzeDataFormat(blocks);

      expect(analysis.format).toBe('flat');
      expect(shouldExpandToHierarchical('auto', analysis.format)).toBe(false);

      const [out] = runMigration(blocks);

      expect(out.type).toBe('delimiter');
      expect(out.data).toEqual({});
      expect(out.id).toBe('delim-empty');
      expect(out.id).toBeTruthy();
      // delimiter is renderable via the TOOL_ALIASES delimiter -> divider alias.
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });

    it('passes a delimiter through the transform unchanged when it rides with a legacy block', () => {
      // A legacy linkTool forces the array into 'legacy' format so the transform
      // actually runs over every block. This exercises the path where the
      // transform sees the delimiter (rather than skipping the whole array).
      const blocks: OutputBlockData[] = [
        {
          id: 'link-trigger',
          type: 'linkTool',
          data: { link: 'https://example.com' },
        },
        {
          id: 'delim-with-legacy',
          type: 'delimiter',
          data: {},
        },
      ];

      const analysis = analyzeDataFormat(blocks);

      expect(analysis.format).toBe('legacy');
      expect(shouldExpandToHierarchical('auto', analysis.format)).toBe(true);

      const out = runMigration(blocks);
      const delimiter = out.find(block => block.id === 'delim-with-legacy');

      expect(delimiter).toBeDefined();
      expect(delimiter?.type).toBe('delimiter');
      expect(delimiter?.data).toEqual({});
      expect(delimiter?.id).toBeTruthy();
      expect(RENDERABLE_TYPES.has(delimiter?.type ?? '')).toBe(true);
    });

    it('preserves newer delimiter fields { style, lineWidth, lineThickness } through the transform (divider tool ignores them at render)', () => {
      // GAP NOTE: Blok's DividerData (src/tools/divider/types.ts) is empty — the
      // divider tool has no configurable fields. The transform is field-agnostic
      // so these editor.js fields survive in the transformed data, but they are
      // ignored when the divider renders. Documenting, not asserting a drop.
      const blocks: OutputBlockData[] = [
        {
          id: 'delim-styled',
          type: 'delimiter',
          data: {
            style: 'line',
            lineWidth: 100,
            lineThickness: 2,
          },
        },
      ];

      const analysis = analyzeDataFormat(blocks);

      // Still 'flat' — newer delimiter fields don't make it a legacy block.
      expect(analysis.format).toBe('flat');

      const [out] = runMigration(blocks);

      expect(out.type).toBe('delimiter');
      // Transform does not touch delimiter data, so the fields survive verbatim.
      expect(out.data).toEqual({
        style: 'line',
        lineWidth: 100,
        lineThickness: 2,
      });
      expect(out.id).toBe('delim-styled');
      expect(out.id).toBeTruthy();
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });
  });
});

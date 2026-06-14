import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';
import type { ImageData } from '../../../../types/tools/image';
import type { EmbedData } from '../../../../src/tools/link/embed';

/**
 * Editor.js -> Blok migration verification for the @editorjs/image and
 * @editorjs/embed block types.
 *
 * These tests run the EXACT runtime migration pipeline (the same calls made on
 * data load with dataModel 'auto'):
 *
 *   const analysis = analyzeDataFormat(blocks)
 *   const out = shouldExpandToHierarchical('auto', analysis.format)
 *     ? expandToHierarchical(blocks)
 *     : blocks
 *
 * Nothing is mocked except silencing console.warn so the lossy-field warning
 * (image.withBackground) doesn't pollute test output. The transform functions
 * are the real ones.
 *
 * - image: handled by expandImageToHierarchical inside expandToHierarchical
 *   (legacy `data.file.url` shape triggers the 'legacy' format detection).
 * - embed: NOT handled by any expand* helper, so it passes through unchanged.
 *   The critical question is whether the editor.js embed data shape
 *   `{ service, source, embed, width, height, caption }` is the SAME shape
 *   Blok's Embed tool reads on load. These tests assert that field-by-field.
 */

/**
 * The set of Blok-renderable block types: keys of defaultBlockTools in
 * src/tools/index.ts plus the `delimiter` alias resolved at render time
 * (TOOL_ALIASES: delimiter -> divider). A block whose `.type` is not in this
 * set would render as a stub, so image/embed must stay inside it.
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

describe('editorjs map: image + embed media blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('image (@editorjs/image)', () => {
    it('maps the full editor.js image shape to Blok ImageData', () => {
      const url = 'https://cdn.example.com/cat.png';
      const blocks: OutputBlockData[] = [
        {
          id: 'img-full',
          type: 'image',
          data: {
            file: { url },
            caption: 'A cat',
            withBorder: true,
            stretched: true,
            withBackground: true,
          },
        },
      ];

      const [out] = runMigration(blocks);
      const data = out.data as ImageData & Record<string, unknown>;

      // type stays renderable
      expect(out.type).toBe('image');
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);

      // file.url -> url, file wrapper gone
      expect(data.url).toBe(url);
      expect('file' in data).toBe(false);

      // flag mapping
      expect(data.frame).toBe('border'); // withBorder: true
      expect(data.size).toBe('full'); // stretched: true

      // caption preserved
      expect(data.caption).toBe('A cat');

      // withBackground dropped (no Blok equivalent) + warned
      expect('withBackground' in data).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('withBackground')
      );

      // id preserved + non-empty
      expect(out.id).toBe('img-full');
      expect(out.id).toBeTruthy();
    });

    it('maps a minimal editor.js image (file.url only)', () => {
      const url = 'https://cdn.example.com/min.jpg';
      const blocks: OutputBlockData[] = [
        {
          id: 'img-min',
          type: 'image',
          data: { file: { url } },
        },
      ];

      const [out] = runMigration(blocks);
      const data = out.data as ImageData & Record<string, unknown>;

      expect(out.type).toBe('image');
      expect(data.url).toBe(url);
      expect('file' in data).toBe(false);
      // no flags set -> no frame/size keys
      expect('frame' in data).toBe(false);
      expect('size' in data).toBe(false);
      expect(out.id).toBeTruthy();
      // minimal image has no lossy field -> no warning
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('simple-image (@editorjs/simple-image)', () => {
    // @editorjs/simple-image stores the URL at the TOP LEVEL (no `file` wrapper):
    //   { url, caption, withBorder, withBackground, stretched }
    // Blok's ImageData wants { url, caption?, frame?, size? }. The legacy flag
    // mapping is identical to @editorjs/image: withBorder -> frame:'border',
    // stretched -> size:'full', withBackground -> dropped + warned.
    it('maps the full simple-image shape (flat url + flags) to Blok ImageData', () => {
      const url = 'https://cdn.example.com/simple.png';
      const blocks: OutputBlockData[] = [
        {
          id: 'simg-full',
          type: 'image',
          data: {
            url,
            caption: 'A simple cat',
            withBorder: true,
            stretched: true,
            withBackground: true,
          } as unknown as OutputBlockData['data'],
        },
      ];

      const analysis = analyzeDataFormat(blocks);

      // flat-url image carrying editor.js flags must be detected as legacy so the
      // transform runs (otherwise the flags leak through unmapped).
      expect(analysis.format).toBe('legacy');

      const [out] = runMigration(blocks);
      const data = out.data as ImageData & Record<string, unknown>;

      expect(out.type).toBe('image');
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);

      // url preserved at top level
      expect(data.url).toBe(url);

      // flag mapping identical to @editorjs/image
      expect(data.frame).toBe('border'); // withBorder: true
      expect(data.size).toBe('full'); // stretched: true

      // caption preserved
      expect(data.caption).toBe('A simple cat');

      // editor.js-only flags gone; withBackground dropped + warned
      expect('withBorder' in data).toBe(false);
      expect('stretched' in data).toBe(false);
      expect('withBackground' in data).toBe(false);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('withBackground')
      );

      expect(out.id).toBe('simg-full');
    });

    it('does NOT touch a native Blok image (flat url, no editor.js flags)', () => {
      // A Blok-native image is also flat { url, frame?, size? }. With no editor.js
      // flags present it must be left alone (treated as already-migrated), not
      // re-detected as legacy.
      const blocks: OutputBlockData[] = [
        {
          id: 'blok-img',
          type: 'image',
          data: { url: 'https://cdn.example.com/native.png', frame: 'border', size: 'full' } as unknown as OutputBlockData['data'],
        },
      ];

      const analysis = analyzeDataFormat(blocks);

      expect(analysis.format).toBe('flat');

      const [out] = runMigration(blocks);
      const data = out.data as ImageData & Record<string, unknown>;

      expect(data.url).toBe('https://cdn.example.com/native.png');
      expect(data.frame).toBe('border');
      expect(data.size).toBe('full');
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('embed (@editorjs/embed)', () => {
    /**
     * The editor.js @editorjs/embed output shape. This is what an exported
     * editor.js document carries for an embed block.
     */
    const editorjsEmbed: OutputBlockData = {
      id: 'embed-yt',
      type: 'embed',
      data: {
        service: 'youtube',
        source: 'https://youtube.com/watch?v=x',
        embed: 'https://youtube.com/embed/x',
        width: 580,
        height: 320,
        caption: 'cap',
      },
    };

    it('passes the embed block through unchanged (type stays renderable)', () => {
      const [out] = runMigration([{ ...editorjsEmbed }]);

      // Embed is not in expandToHierarchical, so a lone embed block is a 'flat'
      // document -> no transform -> identical block (id guaranteed).
      expect(out.type).toBe('embed');
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
      expect(out.id).toBe('embed-yt');
      expect(out.id).toBeTruthy();
    });

    it('the editor.js embed data shape matches the fields Blok Embed reads on load', () => {
      const [out] = runMigration([{ ...editorjsEmbed }]);
      const data = out.data as EmbedData & Record<string, unknown>;

      // Blok's Embed tool (src/tools/link/embed/index.ts) does
      //   this.data = { ...options.data }
      // and renderState() reads this.data.embed (iframe src), this.data.service,
      // this.data.kind, this.data.width, this.data.height, this.data.source,
      // this.data.caption. It does NOT re-derive `embed` from a `url` via the
      // registry on load. So the editor.js fields line up 1:1:

      // embed: the iframe src Blok renders. Editor.js supplies it directly.
      expect(data.embed).toBe('https://youtube.com/embed/x');
      // source: the canonical URL (copy-link + script blockquotes use it).
      expect(data.source).toBe('https://youtube.com/watch?v=x');
      // service: drives fixedWidth / minWidth / script-vs-iframe branch.
      expect(data.service).toBe('youtube');
      // dimensions -> aspect ratio.
      expect(data.width).toBe(580);
      expect(data.height).toBe(320);
      // caption preserved.
      expect(data.caption).toBe('cap');
    });

    it('renders as an iframe (kind undefined is treated as iframe, NOT script)', () => {
      const [out] = runMigration([{ ...editorjsEmbed }]);
      const data = out.data as EmbedData & Record<string, unknown>;

      // Editor.js does not emit `kind`. Blok's renderState() only takes the
      // script branch when `this.data.kind === 'script'`; any other value
      // (including undefined) renders the iframe figure. So a missing `kind` is
      // SAFE for the youtube iframe path — the embed renders correctly.
      expect('kind' in data).toBe(false);
      expect(data.kind).toBeUndefined();
      // Asserting the consequence: NOT script -> iframe path is taken.
      expect(data.kind === 'script').toBe(false);
    });

    it('GAP CHECK: script-kind providers lose their script branch when kind is absent', () => {
      // Editor.js @editorjs/embed never emits `kind`. Blok decides iframe-vs-
      // script SOLELY from `data.kind === 'script'`. For iframe providers
      // (youtube above) the missing kind is harmless. But for a provider Blok
      // renders via a widget SCRIPT (twitter/x, telegram, threads), editor.js
      // data carrying only { service, source, embed } and NO `kind: 'script'`
      // would take the IFRAME branch and try to load the share URL in an
      // iframe instead of injecting the provider widget script.
      //
      // This is the one partial-mismatch worth flagging. We assert the CURRENT
      // reality: a twitter embed coming from editor.js has no `kind`, so
      // renderState() would NOT take the script branch.
      const twitterFromEditorjs: OutputBlockData = {
        id: 'embed-tw',
        type: 'embed',
        data: {
          service: 'twitter',
          source: 'https://twitter.com/jack/status/20',
          embed: 'https://twitter.com/jack/status/20',
          width: 580,
          height: 320,
        },
      };

      const [out] = runMigration([twitterFromEditorjs]);
      const data = out.data as EmbedData & Record<string, unknown>;

      // The block survives and is renderable...
      expect(out.type).toBe('embed');
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);

      // ...but `kind` is absent, so Blok would render it as an iframe, not via
      // the twitter widgets.js script branch. This documents the partial gap:
      // script-rendered providers migrated from editor.js will not pick up
      // their widget script unless `kind: 'script'` is added. (editor.js itself
      // also never produced a working Blok-style script embed, so this is a
      // shape-coverage note, not a regression in the transform.)
      expect(data.kind).toBeUndefined();
      expect(data.kind === 'script').toBe(false);
    });
  });
});

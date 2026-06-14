import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

/**
 * Editor.js -> Blok migration verification for the @editorjs/paragraph and
 * @editorjs/header block types.
 *
 * These tests run the EXACT runtime migration pipeline (the same calls made on
 * data load with dataModel 'auto'):
 *
 *   const analysis = analyzeDataFormat(blocks)
 *   const out = shouldExpandToHierarchical('auto', analysis.format)
 *     ? expandToHierarchical(blocks)
 *     : blocks
 *
 * Nothing is mocked except silencing console.warn so a stray lossy-field warning
 * doesn't pollute test output. The transform functions are the real ones.
 */

/**
 * The set of Blok-renderable block types: keys of defaultBlockTools in
 * src/tools/index.ts plus the `delimiter` alias resolved at render time
 * (TOOL_ALIASES: delimiter -> divider). A block whose `.type` is not in this
 * set would render as a stub, so paragraph/header must stay inside it.
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

describe('editorjs map: paragraph + header text blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('paragraph (@editorjs/paragraph)', () => {
    it('preserves a plain paragraph block through the pipeline', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'para-plain',
          type: 'paragraph',
          data: { text: 'Hello world' },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('paragraph');
      expect(out.data).toEqual({ text: 'Hello world' });
      expect(out.id).toBe('para-plain');
      expect(out.id).toBeTruthy();
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });

    it('preserves inline HTML in paragraph text verbatim', () => {
      const richText =
        'Some <b>bold</b>, <i>italic</i>, and <a href="https://example.com">a link</a>.';
      const blocks: OutputBlockData[] = [
        {
          id: 'para-rich',
          type: 'paragraph',
          data: { text: richText },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('paragraph');
      expect((out.data as { text: string }).text).toBe(richText);
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });

    it('mints a non-empty id once a legacy block forces hierarchical expansion', () => {
      // A flat (paragraph-only) document is NOT expanded (format 'flat'), so the
      // transform leaves ids untouched. Id minting for an id-less paragraph only
      // happens when SOMETHING in the document triggers expandToHierarchical
      // (here a legacy list). Then the id-less paragraph passes through the
      // `else` branch which assigns `id: block.id ?? generateBlockId()`.
      const blocks: OutputBlockData[] = [
        {
          type: 'paragraph',
          data: { text: 'No id supplied' },
        },
        {
          type: 'list',
          data: { style: 'unordered', items: [{ content: 'item' }] },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('paragraph');
      expect(typeof out.id).toBe('string');
      expect(out.id).toBeTruthy();
      expect((out.data as { text: string }).text).toBe('No id supplied');
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });
  });

  describe('header (@editorjs/header)', () => {
    it.each([1, 2, 3, 4, 5, 6])(
      'preserves header level %i with text and renderable type',
      (level) => {
        const blocks: OutputBlockData[] = [
          {
            id: `header-h${level}`,
            type: 'header',
            data: { text: `Heading level ${level}`, level },
          },
        ];

        const [out] = runMigration(blocks);

        expect(out.type).toBe('header');
        expect(out.data).toEqual({ text: `Heading level ${level}`, level });
        expect((out.data as { level: number }).level).toBe(level);
        expect(out.id).toBe(`header-h${level}`);
        expect(out.id).toBeTruthy();
        expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
      }
    );

    it('preserves inline HTML in header text verbatim', () => {
      const richText = 'A <b>bold</b> heading with <i>emphasis</i>';
      const blocks: OutputBlockData[] = [
        {
          id: 'header-rich',
          type: 'header',
          data: { text: richText, level: 2 },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('header');
      expect((out.data as { text: string }).text).toBe(richText);
      expect((out.data as { level: number }).level).toBe(2);
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });

    it('mints a non-empty id once a legacy block forces hierarchical expansion', () => {
      // Same flat-vs-expanded contract as paragraph: a header-only document is
      // 'flat' and not expanded, so ids are left untouched. The presence of a
      // legacy list triggers expandToHierarchical, and the id-less header then
      // gets `id: block.id ?? generateBlockId()` in the pass-through branch.
      const blocks: OutputBlockData[] = [
        {
          type: 'header',
          data: { text: 'No id heading', level: 3 },
        },
        {
          type: 'list',
          data: { style: 'unordered', items: [{ content: 'item' }] },
        },
      ];

      const [out] = runMigration(blocks);

      expect(out.type).toBe('header');
      expect(typeof out.id).toBe('string');
      expect(out.id).toBeTruthy();
      expect((out.data as { text: string; level: number }).text).toBe('No id heading');
      expect((out.data as { level: number }).level).toBe(3);
      expect(RENDERABLE_TYPES.has(out.type)).toBe(true);
    });
  });

  describe('mixed paragraph + header document', () => {
    it('keeps every block renderable, preserves data, and assigns non-empty ids', () => {
      const blocks: OutputBlockData[] = [
        { id: 'h1', type: 'header', data: { text: 'Title', level: 1 } },
        { id: 'p1', type: 'paragraph', data: { text: 'Intro paragraph.' } },
        { id: 'h2', type: 'header', data: { text: 'Section', level: 2 } },
        { id: 'p2', type: 'paragraph', data: { text: 'Body <b>text</b>.' } },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(4);

      for (const block of out) {
        expect(block.id).toBeTruthy();
        expect(RENDERABLE_TYPES.has(block.type)).toBe(true);
      }

      expect(out[0]).toMatchObject({ type: 'header', data: { text: 'Title', level: 1 } });
      expect(out[1]).toMatchObject({ type: 'paragraph', data: { text: 'Intro paragraph.' } });
      expect(out[2]).toMatchObject({ type: 'header', data: { text: 'Section', level: 2 } });
      expect(out[3]).toMatchObject({ type: 'paragraph', data: { text: 'Body <b>text</b>.' } });
    });
  });
});

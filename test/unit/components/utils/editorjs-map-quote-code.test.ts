import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

/**
 * Editor.js -> Blok migration verification for the @editorjs/quote and
 * @editorjs/code block types.
 *
 * Pipeline mirrored exactly (the runtime load path with dataModel 'auto'):
 *
 *   const analysis = analyzeDataFormat(blocks)
 *   const out = shouldExpandToHierarchical('auto', analysis.format)
 *     ? expandToHierarchical(blocks)
 *     : blocks
 *
 * Nothing is mocked except silencing console.warn (a stray lossy-field warning
 * for dropped quote `alignment` would otherwise pollute test output). The
 * transform functions are the real ones.
 *
 * Editor.js source shapes:
 *   @editorjs/quote: { text, caption, alignment: 'left' | 'center' }
 *   @editorjs/code:  { code }
 *
 * Blok consumed shapes (confirmed from src/tools):
 *   quote (src/tools/quote/index.ts): QuoteData = { text, size: 'default'|'large' }
 *     - no `caption`, no `alignment`. Caption is rescued to a trailing paragraph,
 *       alignment is dropped + warned by expandQuoteToHierarchical.
 *   code (src/tools/code/index.ts): CodeData = { code, language, lineNumbers? }
 *     - constructor defaults language -> DEFAULT_LANGUAGE and lineNumbers -> true,
 *       so a bare { code } from editor.js is consumed correctly via pass-through.
 */

/**
 * The set of Blok-renderable block types: keys of defaultBlockTools in
 * src/tools/index.ts plus the `delimiter` alias resolved at render time
 * (TOOL_ALIASES: delimiter -> divider). A block whose `.type` is not in this
 * set would render as a stub.
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

/**
 * Assert every block in the output is renderable with a non-empty id.
 *
 * @param out - migrated blocks
 */
const expectAllRenderableWithIds = (out: OutputBlockData[]): void => {
  for (const block of out) {
    expect(RENDERABLE_TYPES.has(block.type)).toBe(true);
    expect(typeof block.id).toBe('string');
    expect(block.id).toBeTruthy();
  }
};

describe('editorjs map: quote + code blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('quote (@editorjs/quote)', () => {
    it('splits a quote with caption + alignment into a cleaned quote + trailing caption paragraph', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'quote-1',
          type: 'quote',
          data: {
            text: 'The only way to do great work is to love what you do.',
            caption: 'Steve Jobs',
            alignment: 'center',
          },
        },
      ];

      const out = runMigration(blocks);

      // Two blocks: the cleaned quote, then the caption paragraph.
      expect(out).toHaveLength(2);

      const [quote, caption] = out;

      // Quote keeps its text + id; caption and alignment are stripped from it.
      expect(quote.type).toBe('quote');
      expect(quote.id).toBe('quote-1');
      expect(quote.data.text).toBe('The only way to do great work is to love what you do.');
      expect(quote.data).not.toHaveProperty('caption');
      expect(quote.data).not.toHaveProperty('alignment');

      // Caption becomes a paragraph sibling immediately after, with a fresh id.
      expect(caption.type).toBe('paragraph');
      expect(caption.data).toEqual({ text: 'Steve Jobs' });
      expect(caption.id).toBeTruthy();
      expect(caption.id).not.toBe('quote-1');

      expectAllRenderableWithIds(out);
    });

    it('emits a single cleaned quote (no trailing paragraph) when only alignment is present', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'quote-align-only',
          type: 'quote',
          data: {
            text: 'Stay hungry, stay foolish.',
            alignment: 'left',
          },
        },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(1);

      const [quote] = out;

      expect(quote.type).toBe('quote');
      expect(quote.id).toBe('quote-align-only');
      expect(quote.data.text).toBe('Stay hungry, stay foolish.');
      expect(quote.data).not.toHaveProperty('alignment');
      expect(quote.data).not.toHaveProperty('caption');

      expectAllRenderableWithIds(out);
    });

    it('does not split when caption is an empty string (alignment still dropped)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'quote-empty-caption',
          type: 'quote',
          data: {
            text: 'A quote with no real caption.',
            caption: '',
            alignment: 'center',
          },
        },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(1);

      const [quote] = out;

      expect(quote.type).toBe('quote');
      expect(quote.data.text).toBe('A quote with no real caption.');
      expect(quote.data).not.toHaveProperty('caption');
      expect(quote.data).not.toHaveProperty('alignment');

      expectAllRenderableWithIds(out);
    });

    it('passes a quote with neither caption nor alignment through unchanged', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'quote-plain',
          type: 'quote',
          data: {
            text: 'A plain quote, nothing to strip.',
          },
        },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(1);

      const [quote] = out;

      expect(quote.type).toBe('quote');
      expect(quote.id).toBe('quote-plain');
      expect(quote.data).toEqual({ text: 'A plain quote, nothing to strip.' });

      expectAllRenderableWithIds(out);
    });

    it('preserves inline HTML in the quote text when splitting off a caption', () => {
      const richText = 'Be <b>bold</b> and <i>italic</i>.';
      const blocks: OutputBlockData[] = [
        {
          id: 'quote-rich',
          type: 'quote',
          data: {
            text: richText,
            caption: 'Anonymous',
            alignment: 'left',
          },
        },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(2);

      const [quote, caption] = out;

      expect(quote.data.text).toBe(richText);
      expect(caption.data.text).toBe('Anonymous');

      expectAllRenderableWithIds(out);
    });
  });

  describe('code (@editorjs/code)', () => {
    it('passes a single-line code block through unchanged and stays renderable', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'code-1',
          type: 'code',
          data: { code: 'const x = 1;' },
        },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(1);

      const [code] = out;

      expect(code.type).toBe('code');
      expect(code.id).toBe('code-1');
      expect(code.data.code).toBe('const x = 1;');

      expectAllRenderableWithIds(out);
    });

    it('preserves multi-line code verbatim', () => {
      const source = 'function add(a, b) {\n  return a + b;\n}\n';
      const blocks: OutputBlockData[] = [
        {
          id: 'code-multiline',
          type: 'code',
          data: { code: source },
        },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(1);

      const [code] = out;

      expect(code.type).toBe('code');
      expect(code.data.code).toBe(source);

      expectAllRenderableWithIds(out);
    });

    it('preserves an empty code string and stays a renderable code block', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'code-empty',
          type: 'code',
          data: { code: '' },
        },
      ];

      const out = runMigration(blocks);

      expect(out).toHaveLength(1);

      const [code] = out;

      expect(code.type).toBe('code');
      expect(code.id).toBe('code-empty');
      expect(code.data.code).toBe('');

      expectAllRenderableWithIds(out);
    });

    it('does not inject language/lineNumbers during migration (constructor defaults them)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'code-bare',
          type: 'code',
          data: { code: 'echo hi' },
        },
      ];

      const out = runMigration(blocks);

      const [code] = out;

      // Pass-through leaves the editor.js shape untouched; the Blok code tool
      // constructor supplies language (DEFAULT_LANGUAGE) and lineNumbers (true)
      // at instantiation, NOT the migration transform.
      expect(code.data).toEqual({ code: 'echo hi' });
    });
  });

  describe('mixed quote + code document', () => {
    it('migrates a mixed document with all outputs renderable and id-bearing', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'q',
          type: 'quote',
          data: { text: 'Quoted.', caption: 'Cited', alignment: 'center' },
        },
        {
          id: 'c',
          type: 'code',
          data: { code: 'let y = 2;' },
        },
      ];

      const out = runMigration(blocks);

      // quote splits into 2, code passes through -> 3 total.
      expect(out).toHaveLength(3);
      expect(out.map(b => b.type)).toEqual(['quote', 'paragraph', 'code']);

      expectAllRenderableWithIds(out);
    });
  });
});

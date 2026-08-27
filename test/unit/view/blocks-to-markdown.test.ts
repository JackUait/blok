// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToMarkdown, blocksToMarkdownWithReport } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Convenience: wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('blocksToMarkdown (view)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs without document or window (node environment)', () => {
    expect(typeof document).toBe('undefined');

    expect(blocksToMarkdown(doc([{ type: 'paragraph', data: { text: 'Hello <b>world</b>' } }]))).toBe('Hello **world**');
  });

  it('serializes inline bold, italic, code, strikethrough and links', () => {
    const text = 'a <b>bold</b> <i>italic</i> <code>c</code> <s>gone</s> <a href="https://x.com">link</a>';

    expect(blocksToMarkdown(doc([{ type: 'paragraph', data: { text } }]))).toBe(
      'a **bold** *italic* `c` ~~gone~~ [link](https://x.com)'
    );
  });

  it('decodes HTML entities in inline text', () => {
    expect(blocksToMarkdown(doc([{ type: 'paragraph', data: { text: 'a &lt; b &amp; c' } }]))).toBe('a < b & c');
  });

  it('serializes headings, quotes, dividers and code fences', () => {
    expect(blocksToMarkdown(doc([{ type: 'header', data: { text: 'Title', level: 2 } }]))).toBe('## Title');
    expect(blocksToMarkdown(doc([{ type: 'quote', data: { text: 'wisdom' } }]))).toBe('> wisdom');
    expect(blocksToMarkdown(doc([{ type: 'divider', data: {} }]))).toBe('---');
    expect(blocksToMarkdown(doc([{ type: 'code', data: { code: 'const a = 1;' } }]))).toBe('```\nconst a = 1;\n```');
  });

  /**
   * `delimiter` is Editor.js's name for the same block. Documents imported from
   * an Editor.js-era store still carry it, and without the alias it fell to the
   * default branch and serialized as an EMPTY line.
   */
  it('serializes the legacy `delimiter` alias as a thematic break', () => {
    expect(blocksToMarkdown(doc([{ type: 'delimiter', data: {} }]))).toBe('---');
  });

  it('serializes list styles and structural nesting', () => {
    const md = blocksToMarkdown(doc([
      { id: 'a', type: 'list', data: { text: 'one', style: 'unordered' } },
      { id: 'b', type: 'list', data: { text: 'nested', style: 'ordered' }, parent: 'a' },
      { id: 'c', type: 'list', data: { text: 'todo', style: 'checklist', checked: true } },
    ]));

    expect(md).toBe('- one\n    1. nested\n- [x] todo');
  });

  describe('containers that own their children', () => {
    it('renders a callout as a blockquote carrying its emoji and its children', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Note body' }, parent: 'cal1' },
      ]));

      expect(md).toBe('> 💡 Note body');
    });

    it('keeps every callout child inside the quote, exactly once', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'First' }, parent: 'cal1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' }, parent: 'cal1' },
      ]));

      expect(md).toBe('> 💡 First\n> \n> Second');
    });

    it('renders a toggle as a bold summary followed by its body', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tg1', type: 'toggle', data: { text: 'Details' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Hidden' }, parent: 'tg1' },
      ]));

      expect(md).toBe('**Details**\n\nHidden');
    });

    it('flattens columns into their blocks in reading order', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cl', type: 'column_list', data: {} },
        { id: 'c1', type: 'column', data: {}, parent: 'cl' },
        { id: 'p1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl' },
        { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ]));

      expect(md).toBe('Left\n\nRight');
    });

    /**
     * The defect these cases exist for: a contentless container carries no
     * `data.text`, so the default branch emitted an empty string — and the
     * blank-line separator around it was still applied, leaving a run of stray
     * blank lines in place of the block.
     */
    it('leaves no stray blank lines where a container used to serialize empty', () => {
      const md = blocksToMarkdown(doc([
        { type: 'paragraph', data: { text: 'Before' } },
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Inside' }, parent: 'cal1' },
        { type: 'paragraph', data: { text: 'After' } },
      ]));

      expect(md).toBe('Before\n\n> 💡 Inside\n\nAfter');
    });
  });

  it('drops a spacer without leaving a gap', () => {
    const md = blocksToMarkdown(doc([
      { type: 'paragraph', data: { text: 'A' } },
      { type: 'spacer', data: {} },
      { type: 'paragraph', data: { text: 'B' } },
    ]));

    expect(md).toBe('A\n\nB');
  });

  it('serializes media and embeds as links', () => {
    expect(blocksToMarkdown(doc([{ type: 'image', data: { url: 'https://i/x.png', caption: 'Shot' } }])))
      .toBe('![Shot](https://i/x.png)');
    expect(blocksToMarkdown(doc([{ type: 'bookmark', data: { url: 'https://x.com', title: 'X' } }])))
      .toBe('[X](https://x.com)');
  });

  it('serializes a table as a GFM pipe table', () => {
    const md = blocksToMarkdown(doc([
      {
        id: 't1',
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            [{ text: 'H1' }, { text: 'H2' }],
            [{ text: 'a' }, { text: 'b' }],
          ],
        },
      },
    ]));

    expect(md).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |');
  });

  describe('degradation report', () => {
    it('reports a dropped spacer', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([{ type: 'spacer', data: {} }]));

      expect(warnings).toEqual([
        { block: 'spacer', action: 'dropped', detail: expect.stringContaining('Markdown') },
      ]);
    });

    it('reports a callout as degraded', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Body' }, parent: 'cal1' },
      ]));

      expect(warnings).toEqual([
        { block: 'callout', action: 'degraded', detail: expect.stringContaining('blockquote') },
      ]);
    });

    /**
     * A block that vanishes from the output must be named. Without this, a
     * custom or unrecognized contentless tool disappeared silently — the same
     * failure mode the Markdown serialization law exists to prevent, but at
     * runtime rather than at build time.
     */
    it('reports an unrecognized block that produced no output', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'paragraph', data: { text: 'A' } },
        { type: 'org-chart', data: { nodes: [] } },
      ]));

      expect(markdown).toBe('A');
      expect(warnings).toEqual([
        { block: 'org-chart', action: 'dropped', detail: expect.any(String) },
      ]);
    });

    it('keeps an unrecognized block that carries text, without a warning', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'org-chart', data: { text: 'Team' } },
      ]));

      expect(markdown).toBe('Team');
      expect(warnings).toEqual([]);
    });

    it('reports nothing for a document that serializes losslessly', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'header', data: { text: 'Title', level: 1 } },
        { type: 'paragraph', data: { text: 'Body' } },
      ]));

      expect(markdown).toBe('# Title\n\nBody');
      expect(warnings).toEqual([]);
    });
  });

  it('returns an empty string for an empty or malformed document', () => {
    expect(blocksToMarkdown(undefined)).toBe('');
    expect(blocksToMarkdown(doc([]))).toBe('');
  });
});

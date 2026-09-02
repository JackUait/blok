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

  it('keeps a code block language on the fence', () => {
    const md = blocksToMarkdown(doc([
      { type: 'code', data: { code: 'var x = 1;', language: 'csharp' } },
    ]));

    expect(md).toBe('```csharp\nvar x = 1;\n```');
  });

  it('emits a bare fence when the language is plain text or absent', () => {
    expect(blocksToMarkdown(doc([{ type: 'code', data: { code: 'x', language: 'plain text' } }])))
      .toBe('```\nx\n```');
    expect(blocksToMarkdown(doc([{ type: 'code', data: { code: 'x' } }])))
      .toBe('```\nx\n```');
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

  it('does not indent a paragraph nested under a heading into a code block', () => {
    const md = blocksToMarkdown(doc([
      { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true } },
      { id: 'p1', type: 'paragraph', data: { text: 'Body' }, parent: 'h1' },
    ]));

    expect(md).toBe('## Section\n\nBody');
  });

  it('keeps the indent for a paragraph continuing a list item', () => {
    const md = blocksToMarkdown(doc([
      { id: 'l1', type: 'list', data: { text: 'Step one', style: 'unordered' } },
      { id: 'p1', type: 'paragraph', data: { text: 'More about step one' }, parent: 'l1' },
    ]));

    expect(md).toBe('- Step one\n\n    More about step one');
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

    /**
     * A container claims every descendant, not just its direct children, but
     * used to render only the direct ones — so anything deeper vanished with
     * no warning. A list inside a toggle is the everyday shape of that.
     */
    it('renders a grandchild instead of dropping it', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tg', type: 'toggle', data: { text: 'More' } },
        { id: 'l1', type: 'list', data: { text: 'a', style: 'unordered' }, parent: 'tg' },
        { id: 'l2', type: 'list', data: { text: 'b', style: 'unordered' }, parent: 'l1' },
      ]));

      expect(md).toBe('**More**\n\n- a\n    - b');
    });

    it('lets a nested container render its own children once', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cal', type: 'callout', data: { emoji: '💡' } },
        { id: 'tg', type: 'toggle', data: { text: 'More' }, parent: 'cal' },
        { id: 'p1', type: 'paragraph', data: { text: 'Deep' }, parent: 'tg' },
      ]));

      expect(md).toBe('> 💡 **More**\n> \n> Deep');
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
        { construct: 'spacer', action: 'dropped', detail: expect.stringContaining('Markdown') },
      ]);
    });

    it('reports a callout as degraded', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Body' }, parent: 'cal1' },
      ]));

      expect(warnings).toEqual([
        { construct: 'callout', action: 'degraded', detail: expect.stringContaining('blockquote') },
      ]);
    });

    it('reports a collapsible heading', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true } },
      ]));

      expect(warnings).toEqual([
        { construct: 'header',
          action: 'degraded',
          detail: 'collapsible heading is rendered as a heading followed by its body; collapsibility is lost' },
      ]);
    });

    it('does not report an ordinary heading', () => {
      expect(blocksToMarkdownWithReport(doc([
        { type: 'header', data: { text: 'Section', level: 2 } },
      ])).warnings).toEqual([]);
    });

    it.each(['embed', 'video', 'audio', 'file', 'bookmark'])('reports %s as a plain link', (tool) => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { type: tool, data: { url: 'https://example.com/x', title: 'X' } },
      ]));

      expect(warnings).toEqual([
        { construct: tool, action: 'degraded', detail: expect.stringContaining('rendered as a plain link') },
      ]);
    });

    it('reports table cell references it could not resolve', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 't1', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['gone'] }]] } },
      ]));

      expect(warnings).toContainEqual({
        construct: 'table',
        action: 'dropped',
        detail: '1 child block reference could not be resolved and was dropped',
      });
    });

    it('pluralizes the unresolved table cell reference report', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 't1', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['gone', 'also-gone'] }]] } },
      ]));

      expect(warnings).toContainEqual({
        construct: 'table',
        action: 'dropped',
        detail: '2 child block references could not be resolved and were dropped',
      });
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
        { construct: 'org-chart', action: 'dropped', detail: expect.any(String) },
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

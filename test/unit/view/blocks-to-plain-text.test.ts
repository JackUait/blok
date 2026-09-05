// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToPlainText } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Convenience: wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('blocksToPlainText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs without document or window (node environment)', () => {
    expect(typeof document).toBe('undefined');

    expect(blocksToPlainText(doc([{ type: 'paragraph', data: { text: 'Hello <b>world</b>' } }]))).toBe('Hello world');
  });

  /**
   * An equation span's children are a rendering cache of its `data-latex`
   * source. Legacy documents carry the text KaTeX's MathML and HTML layers left
   * behind, so a preview or search index built from this text used to read
   * `E=mc2E=mc^2E=mc2`. The source is authoritative on every read path.
   */
  it('reads an inline equation as its LaTeX source, not the rendered residue', () => {
    const text = blocksToPlainText(doc([
      { type: 'paragraph', data: { text: 'mass: <span data-latex="E=mc^2">E=mc2E=mc^2E=mc2</span>' } },
    ]));

    expect(text).toBe('mass: E=mc^2');
  });

  it('separates top-level blocks with a blank line', () => {
    const text = blocksToPlainText(doc([
      { type: 'header', data: { text: 'Title', level: 1 } },
      { type: 'paragraph', data: { text: 'Body' } },
    ]));

    expect(text).toBe('Title\n\nBody');
  });

  it('separates list items with a single newline', () => {
    const text = blocksToPlainText(doc([
      { type: 'list', data: { text: 'One', style: 'unordered' } },
      { type: 'list', data: { text: 'Two', style: 'unordered' } },
      { type: 'paragraph', data: { text: 'After' } },
    ]));

    expect(text).toBe('One\nTwo\n\nAfter');
  });

  it('includes structurally nested list items with a single newline', () => {
    const text = blocksToPlainText(doc([
      { id: 'a', type: 'list', data: { text: 'One', style: 'unordered' } },
      { id: 'b', type: 'list', parent: 'a', data: { text: 'Sub', style: 'unordered', depth: 1 } },
      { id: 'c', type: 'list', data: { text: 'Two', style: 'unordered' } },
    ]));

    expect(text).toBe('One\nSub\nTwo');
  });

  it('separates table cells with tabs and rows with newlines', () => {
    const text = blocksToPlainText(doc([
      {
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            [{ blocks: [], text: 'A' }, { blocks: [], text: 'B' }],
            [{ blocks: [], text: '1' }, { blocks: [], text: '2' }],
          ],
        },
      },
    ]));

    expect(text).toBe('A\tB\n1\t2');
  });

  it('extracts text from table cell child blocks', () => {
    const text = blocksToPlainText(doc([
      { id: 't1', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['p1'] }, { blocks: [], text: 'X' }]] } },
      { id: 'p1', type: 'paragraph', parent: 't1', data: { text: 'In cell' } },
    ]));

    expect(text).toBe('In cell\tX');
  });

  it('keeps code literal', () => {
    expect(blocksToPlainText(doc([{ type: 'code', data: { code: 'a < b && c' } }]))).toBe('a < b && c');
  });

  it('converts <br> to newline', () => {
    expect(blocksToPlainText(doc([{ type: 'paragraph', data: { text: 'a<br>b' } }]))).toBe('a\nb');
  });

  it('skips contentless blocks (divider, spacer) without stray separators', () => {
    const text = blocksToPlainText(doc([
      { type: 'paragraph', data: { text: 'A' } },
      { type: 'divider', data: {} },
      { type: 'spacer', data: { height: 24 } },
      { type: 'paragraph', data: { text: 'B' } },
    ]));

    expect(text).toBe('A\n\nB');
  });

  it('uses caption/title/fileName labels for media blocks', () => {
    expect(blocksToPlainText(doc([{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap' } }]))).toBe('Cap');
    expect(blocksToPlainText(doc([{ type: 'file', data: { url: 'https://x.y/r.pdf', fileName: 'r.pdf' } }]))).toBe('r.pdf');
    expect(blocksToPlainText(doc([{ type: 'audio', data: { url: 'https://x.y/a.mp3', title: 'Song' } }]))).toBe('Song');
  });

  it('includes toggle title and children', () => {
    const text = blocksToPlainText(doc([
      { id: 'tg', type: 'toggle', data: { text: 'More' } },
      { id: 'c1', type: 'paragraph', parent: 'tg', data: { text: 'Hidden' } },
    ]));

    expect(text).toBe('More\n\nHidden');
  });

  /**
   * A container carries no text of its own, so its children are the whole of
   * it. A consumer's hand-written extractor missed this by looking for a
   * `columns` block that Blok has never saved, and every word written in a
   * column was invisible to its search index.
   */
  it('reads text out of a column list through its children', () => {
    const text = blocksToPlainText(doc([
      { id: 'cl', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', parent: 'cl', data: {} },
      { id: 'p1', type: 'paragraph', parent: 'c1', data: { text: 'Left' } },
      { id: 'c2', type: 'column', parent: 'cl', data: {} },
      { id: 'p2', type: 'paragraph', parent: 'c2', data: { text: 'Right' } },
    ]));

    expect(text).toContain('Left');
    expect(text).toContain('Right');
  });

  it('tolerates loose input', () => {
    expect(blocksToPlainText(null)).toBe('');
    expect(blocksToPlainText({} as unknown as OutputData)).toBe('');
    expect(blocksToPlainText({ blocks: [{ type: 'paragraph', data: null }] })).toBe('');
  });

  it('derives text from custom renderers when provided', () => {
    const text = blocksToPlainText(
      doc([{ type: 'widget', data: { label: 'Box' } }]),
      { renderers: { widget: (data) => `<section>${typeof data.label === 'string' ? data.label : ''}</section>` } }
    );

    expect(text).toBe('Box');
  });

  /**
   * A legacy quote stores its attribution in `caption`; the renderer paints it
   * as a `<cite>`. The reader used to see only `data.text`, so the person being
   * quoted was unsearchable. Unconditional — it is displayed text.
   */
  it('reads a legacy quote caption after its text', () => {
    expect(blocksToPlainText(doc([
      { type: 'quote', data: { text: 'Wise <b>words</b>', caption: 'Ada <i>Lovelace</i>' } },
    ]))).toBe('Wise words\nAda Lovelace');
  });

  it('emits nothing extra for a quote without a caption', () => {
    expect(blocksToPlainText(doc([{ type: 'quote', data: { text: 'Wise words' } }]))).toBe('Wise words');
  });

  /**
   * The default reader emits the FIRST non-empty label of a media block, which
   * is what the editor paints. A search index needs the rest — an image's alt,
   * a bookmark's description, the URLs a person pastes back verbatim.
   */
  describe('includeHiddenText', () => {
    it('adds an image alt after its caption', () => {
      const blocks: OutputBlockData[] = [
        { type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', alt: 'A tabby cat' } },
      ];

      expect(blocksToPlainText(doc(blocks))).toBe('Cap');
      expect(blocksToPlainText(doc(blocks), { includeHiddenText: true })).toBe('Cap\nA tabby cat');
    });

    it('adds a video url after its caption', () => {
      const blocks: OutputBlockData[] = [{ type: 'video', data: { url: 'https://x.y/clip.mp4', caption: 'Clip' } }];

      expect(blocksToPlainText(doc(blocks))).toBe('Clip');
      expect(blocksToPlainText(doc(blocks), { includeHiddenText: true })).toBe('Clip\nhttps://x.y/clip.mp4');
    });

    it('adds an embed source after its caption', () => {
      const blocks: OutputBlockData[] = [
        { type: 'embed', data: { service: 'youtube', source: 'https://youtu.be/abc', embed: 'https://www.youtube.com/embed/abc', caption: 'Talk' } },
      ];

      expect(blocksToPlainText(doc(blocks))).toBe('Talk');
      expect(blocksToPlainText(doc(blocks), { includeHiddenText: true })).toBe('Talk\nhttps://youtu.be/abc');
    });

    it('adds an audio title, artist and url after its caption', () => {
      const blocks: OutputBlockData[] = [
        { type: 'audio', data: { url: 'https://x.y/a.mp3', caption: 'Episode 1', title: 'Intro', artist: 'The Band' } },
      ];

      expect(blocksToPlainText(doc(blocks))).toBe('Episode 1');
      expect(blocksToPlainText(doc(blocks), { includeHiddenText: true }))
        .toBe('Episode 1\nIntro\nThe Band\nhttps://x.y/a.mp3');
    });

    it('adds a file name and url after its caption', () => {
      const blocks: OutputBlockData[] = [
        { type: 'file', data: { url: 'https://x.y/spec.pdf', fileName: 'spec.pdf', caption: 'The spec' } },
      ];

      expect(blocksToPlainText(doc(blocks))).toBe('The spec');
      expect(blocksToPlainText(doc(blocks), { includeHiddenText: true }))
        .toBe('The spec\nspec.pdf\nhttps://x.y/spec.pdf');
    });

    it('adds a bookmark description and url after its title', () => {
      const blocks: OutputBlockData[] = [
        { type: 'bookmark', data: { url: 'https://example.com', title: 'Example', description: 'A sample site' } },
      ];

      expect(blocksToPlainText(doc(blocks))).toBe('Example');
      expect(blocksToPlainText(doc(blocks), { includeHiddenText: true }))
        .toBe('Example\nA sample site\nhttps://example.com');
    });

    it('skips absent fields instead of leaving blank lines', () => {
      expect(blocksToPlainText(
        doc([{ type: 'image', data: { url: 'https://x.y/a.png', alt: 'Only alt' } }]),
        { includeHiddenText: true }
      )).toBe('Only alt');

      expect(blocksToPlainText(
        doc([{ type: 'bookmark', data: { url: 'https://example.com' } }]),
        { includeHiddenText: true }
      )).toBe('https://example.com');
    });

    it('leaves blocks that carry no hidden text byte-identical', () => {
      const blocks: OutputBlockData[] = [
        { type: 'header', data: { text: 'Title', level: 1 } },
        { type: 'paragraph', data: { text: 'Body' } },
        { type: 'code', data: { code: 'a < b' } },
      ];

      expect(blocksToPlainText(doc(blocks), { includeHiddenText: true })).toBe(blocksToPlainText(doc(blocks)));
    });
  });
});

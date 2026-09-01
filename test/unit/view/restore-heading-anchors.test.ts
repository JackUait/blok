import { describe, it, expect } from 'vitest';
import { restoreHeadingAnchors } from '../../../src/view/restore-heading-anchors';
import type { OutputBlockData, OutputData } from '../../../types';

const doc = (blocks: OutputBlockData[]): OutputData => ({
  time: 1,
  version: 'test',
  blocks,
});

const heading = (id: string, text: string, extra: Record<string, unknown> = {}): OutputBlockData => ({
  id,
  type: 'header',
  data: { text, level: 2, ...extra },
});

const link = (id: string, href: string, text: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: `<a href="${href}">${text}</a>` },
});

const anchorOf = (result: { data: OutputData }, blockId: string): unknown =>
  result.data.blocks.find((block) => block.id === blockId)?.data.anchor;

describe('restoreHeadingAnchors', () => {
  it('restores the anchor onto the heading the link names', () => {
    /**
     * The real shape from a Google Docs import: the table of contents links to
     * the bookmark the export put on the heading, and the converter dropped it.
     * The link text is the heading text — the only surviving clue.
     */
    const result = restoreHeadingAnchors(
      doc([
        link('list-13', '#h.2y1ok8y7pef0', 'КЛН территориального управляющего'),
        heading('header-18', 'КЛН территориального управляющего'),
      ])
    );

    expect(anchorOf(result, 'header-18')).toBe('h.2y1ok8y7pef0');
    expect(result.report.restored).toEqual([{ anchor: 'h.2y1ok8y7pef0', blockId: 'header-18' }]);
  });

  it('matches past surrounding markup, entities and stray whitespace', () => {
    const result = restoreHeadingAnchors(
      doc([
        link('p-1', '#h.mt2rn5qdr20g', '<b>КЛН   управляющего </b>'),
        heading('header-32', '<span style="color:#222">КЛН управляющего</span>'),
      ])
    );

    expect(anchorOf(result, 'header-32')).toBe('h.mt2rn5qdr20g');
  });

  it('leaves a fragment alone when no heading matches', () => {
    const result = restoreHeadingAnchors(
      doc([link('p-1', '#h.unknown', 'см. выше'), heading('header-1', 'Введение')])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report.skipped).toEqual([{ anchor: 'h.unknown', reason: 'no-match' }]);
  });

  it('refuses to guess when two headings carry the same text', () => {
    const result = restoreHeadingAnchors(
      doc([
        link('p-1', '#h.dup', 'Подведение итогов'),
        heading('header-1', 'Подведение итогов'),
        heading('header-2', 'Подведение итогов'),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(anchorOf(result, 'header-2')).toBeUndefined();
    expect(result.report.skipped).toEqual([{ anchor: 'h.dup', reason: 'ambiguous' }]);
  });

  it('refuses to give one heading two different anchors', () => {
    const result = restoreHeadingAnchors(
      doc([
        link('p-1', '#h.one', 'Раздел'),
        link('p-2', '#h.two', 'Раздел'),
        heading('header-1', 'Раздел'),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report.skipped).toEqual([
      { anchor: 'h.one', reason: 'ambiguous' },
      { anchor: 'h.two', reason: 'ambiguous' },
    ]);
  });

  it('never overwrites an anchor the heading already carries', () => {
    const result = restoreHeadingAnchors(
      doc([
        link('p-1', '#h.new', 'Раздел'),
        heading('header-1', 'Раздел', { anchor: 'h.original' }),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.original');
    expect(result.report.restored).toEqual([]);
  });

  it('treats a fragment that already resolves as nothing to repair', () => {
    const live = restoreHeadingAnchors(
      doc([link('p-1', '#header-1', 'Раздел'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(live, 'header-1')).toBeUndefined();
    expect(live.report.skipped).toEqual([]);
  });

  it('is idempotent', () => {
    const first = restoreHeadingAnchors(
      doc([link('p-1', '#h.abc', 'Раздел'), heading('header-1', 'Раздел')])
    );
    const second = restoreHeadingAnchors(first.data);

    expect(second.data).toEqual(first.data);
    expect(second.report.restored).toEqual([]);
  });

  it('leaves the input document untouched', () => {
    const source = doc([link('p-1', '#h.abc', 'Раздел'), heading('header-1', 'Раздел')]);

    restoreHeadingAnchors(source);

    expect(source.blocks[1]?.data.anchor).toBeUndefined();
  });

  it('ignores links that do not address this document', () => {
    const result = restoreHeadingAnchors(
      doc([
        link('p-1', 'https://example.com/page#h.abc', 'Раздел'),
        link('p-2', '#', 'Раздел'),
        heading('header-1', 'Раздел'),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report.skipped).toEqual([]);
  });

  it('finds links wherever a block keeps its HTML, including table cells', () => {
    const result = restoreHeadingAnchors(
      doc([
        {
          id: 'table-1',
          type: 'table',
          data: { content: [['<a href="#h.cell">Раздел</a>', 'plain']] },
        },
        heading('header-1', 'Раздел'),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.cell');
  });

  it('decodes a percent-encoded fragment before matching', () => {
    // The legacy frontend's own anchors are the heading text with dashes, and a
    // shared link carries them percent-encoded.
    const result = restoreHeadingAnchors(
      doc([
        link('p-1', `#${encodeURIComponent('Раздел-один')}`, 'Раздел один'),
        heading('header-1', 'Раздел один'),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBe('Раздел-один');
  });

  it('refuses a fragment that cannot be an element id', () => {
    const result = restoreHeadingAnchors(
      doc([link('p-1', `#${encodeURIComponent('два слова')}`, 'Раздел'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
  });

  it('survives a document with no blocks', () => {
    const result = restoreHeadingAnchors(doc([]));

    expect(result.data.blocks).toEqual([]);
    expect(result.report).toEqual({ restored: [], skipped: [] });
  });
});

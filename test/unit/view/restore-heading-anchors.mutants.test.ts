import { describe, it, expect, beforeEach, vi } from 'vitest';
import { restoreHeadingAnchors } from '../../../src/view/restore-heading-anchors';
import type { HeadingAnchorResult } from '../../../src/view/restore-heading-anchors';
import type { OutputBlockData, OutputData } from '../../../types';

const doc = (blocks: OutputBlockData[]): OutputData => ({
  time: 1,
  version: 'test',
  blocks,
});

const para = (id: string, html: string, extra: Record<string, unknown> = {}): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: html, ...extra },
});

const heading = (id: string, text: string, extra: Record<string, unknown> = {}): OutputBlockData => ({
  id,
  type: 'header',
  data: { text, level: 2, ...extra },
});

const anchorOf = (result: HeadingAnchorResult, blockId: string): unknown =>
  result.data.blocks.find((block) => block.id === blockId)?.data.anchor;

const emptyReport = { restored: [], skipped: [] };

describe('restoreHeadingAnchors — label normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('folds case downwards, so a sharp s never equals a double s', () => {
    // Case folding is not symmetric: "Straße" uppercases to "STRASSE" but
    // "STRASSE" never lowercases back to "straße". Matching down keeps the two
    // labels apart, which is the safe direction for a pass that writes data.
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a href="#h.strasse">STRASSE</a>'), heading('header-1', 'Straße')])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report).toEqual({
      restored: [],
      skipped: [{ anchor: 'h.strasse', reason: 'no-match' }],
    });
  });

  it('drops a zero-width character instead of standing in for it', () => {
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a href="#h.zw">Раз\u200Bдел</a>'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.zw');
    expect(result.report).toEqual({
      restored: [{ anchor: 'h.zw', blockId: 'header-1' }],
      skipped: [],
    });
  });

  it('collapses a whitespace run to one space, never to nothing', () => {
    // Both labels are normalized the same way, so only a run that exists on one
    // side alone can tell "collapse to a space" from "delete".
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a href="#h.run">Разделодин</a>'), heading('header-1', 'Раздел один')])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report).toEqual({
      restored: [],
      skipped: [{ anchor: 'h.run', reason: 'no-match' }],
    });
  });
});

describe('restoreHeadingAnchors — reading the link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a malformed percent-escape verbatim', () => {
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a href="#%E0%A4%A">Раздел</a>'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBe('%E0%A4%A');
    expect(result.report).toEqual({
      restored: [{ anchor: '%E0%A4%A', blockId: 'header-1' }],
      skipped: [],
    });
  });

  it('ignores an href on an element that is not an anchor', () => {
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<span href="#h.abc">Раздел</span>'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report).toEqual(emptyReport);
  });

  it('survives an anchor that carries no href at all', () => {
    // The text has to carry a "#" of its own, or the string never reaches the
    // parser and the missing attribute is never read.
    const source = doc([para('p-1', '<a>Раздел #1</a>'), heading('header-1', 'Раздел')]);

    expect(() => restoreHeadingAnchors(source)).not.toThrow();
    expect(restoreHeadingAnchors(source).report).toEqual(emptyReport);
  });

  it('finds the href by name, not by position', () => {
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a class="toc" href="#h.abc">Раздел</a>'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.abc');
    expect(result.report).toEqual({
      restored: [{ anchor: 'h.abc', blockId: 'header-1' }],
      skipped: [],
    });
  });

  it('finds a link nested inside inline markup', () => {
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<em><a href="#h.abc">Раздел</a></em>'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.abc');
    expect(result.report).toEqual({
      restored: [{ anchor: 'h.abc', blockId: 'header-1' }],
      skipped: [],
    });
  });

  it('steps over a comment inside the link text', () => {
    // A parse5 comment node has no childNodes, so walking into it would throw.
    const source = doc([
      para('p-1', '<a href="#h.abc">Раз<!-- note -->дел</a>'),
      heading('header-1', 'Раздел'),
    ]);

    expect(() => restoreHeadingAnchors(source)).not.toThrow();
    expect(anchorOf(restoreHeadingAnchors(source), 'header-1')).toBe('h.abc');
  });

  it('joins link text split across markup with nothing between the parts', () => {
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a href="#h.abc">Раз<b>дел</b></a>'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.abc');
    expect(result.report).toEqual({
      restored: [{ anchor: 'h.abc', blockId: 'header-1' }],
      skipped: [],
    });
  });

  it('only parses a field that carries a literal hash', () => {
    // A fragment written as a character reference is invisible to the pass:
    // the field is skipped before parse5 would decode "&num;" back to "#".
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a href="&num;h.abc">Раздел</a>'), heading('header-1', 'Раздел')])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report).toEqual(emptyReport);
  });

  it('walks past a null or undefined value in block data', () => {
    const source = doc([
      para('p-1', '<a href="#h.abc">Раздел</a>', { caption: null, alt: undefined }),
      heading('header-1', 'Раздел'),
    ]);

    expect(() => restoreHeadingAnchors(source)).not.toThrow();
    expect(anchorOf(restoreHeadingAnchors(source), 'header-1')).toBe('h.abc');
  });

  it('handles the same fragment referenced twice as one claim', () => {
    const result = restoreHeadingAnchors(
      doc([
        para('p-1', '<a href="#h.abc">Раздел</a>'),
        para('p-2', '<a href="#h.abc">Раздел</a>'),
        heading('header-1', 'Раздел'),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.abc');
    expect(result.report).toEqual({
      restored: [{ anchor: 'h.abc', blockId: 'header-1' }],
      skipped: [],
    });
  });
});

describe('restoreHeadingAnchors — choosing a heading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not treat a heading without an id as a candidate', () => {
    const result = restoreHeadingAnchors(
      doc([
        para('p-1', '<a href="#h.x">Раздел</a>'),
        { type: 'header', data: { text: 'Раздел', level: 2 } },
      ])
    );

    expect(result.report).toEqual({
      restored: [],
      skipped: [{ anchor: 'h.x', reason: 'no-match' }],
    });
  });

  it('does not read text off a heading that has none', () => {
    const source = doc([
      para('p-1', '<a href="#h.x">Раздел</a>'),
      { id: 'header-9', type: 'header', data: { level: 2 } },
    ]);

    expect(() => restoreHeadingAnchors(source)).not.toThrow();
    expect(restoreHeadingAnchors(source).report).toEqual({
      restored: [],
      skipped: [{ anchor: 'h.x', reason: 'no-match' }],
    });
  });

  it('does not match a heading with no text to a link with no text', () => {
    const result = restoreHeadingAnchors(
      doc([para('p-1', '<a href="#h.abc"></a>'), heading('header-1', '')])
    );

    expect(anchorOf(result, 'header-1')).toBeUndefined();
    expect(result.report).toEqual({
      restored: [],
      skipped: [{ anchor: 'h.abc', reason: 'no-match' }],
    });
  });
});

describe('restoreHeadingAnchors — which fragments are already live', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores an anchor field on a block that is not a heading', () => {
    const result = restoreHeadingAnchors(
      doc([
        para('p-1', '<a href="#h.abc">Раздел</a>', { anchor: 'h.abc' }),
        heading('header-1', 'Раздел'),
      ])
    );

    expect(anchorOf(result, 'header-1')).toBe('h.abc');
    expect(result.report).toEqual({
      restored: [{ anchor: 'h.abc', blockId: 'header-1' }],
      skipped: [],
    });
  });

  it("treats a heading's own anchor as an answer to the fragment", () => {
    const result = restoreHeadingAnchors(
      doc([
        para('p-1', '<a href="#h.original">Раздел</a>'),
        heading('header-1', 'Заголовок', { anchor: 'h.original' }),
        heading('header-2', 'Раздел'),
      ])
    );

    expect(anchorOf(result, 'header-2')).toBeUndefined();
    expect(result.report).toEqual(emptyReport);
  });

  it('reads a record saved without a blocks key as an empty document', () => {
    const legacy: OutputData = { time: 1, version: 'test', blocks: [] };
    const partial: Partial<OutputData> = legacy;

    delete partial.blocks;

    const result = restoreHeadingAnchors(legacy);

    expect(result.data.blocks).toEqual([]);
    expect(result.report).toEqual(emptyReport);
  });
});

/*
 * Mutants proven equivalent — no test can separate them from the original.
 *
 * 1782 — the href default when the attribute is absent. Neither '' nor any
 *   other non-hash string starts with '#', so line 115 returns null either way.
 * 1789 — dropping the bare-"#" length check. The fragment is then '', and
 *   normalizeHeadingAnchor rejects an empty string (heading-anchor.ts line 32),
 *   so the link is dropped one step later instead.
 * 1809, 1811, 1812 — the guard at the top of elementText. It has exactly one
 *   call site (line 121), reached only after line 108 proved nodeName === 'a',
 *   and a parse5 element always has childNodes. The guard cannot fire.
 * 1841, 1842 — the Array.isArray branch in collectFromValue. Without it an
 *   array falls into the object branch, and Object.values on an array yields
 *   the same elements in the same order, holes skipped exactly as forEach
 *   skips them (measured: Object.values(['a', , 'c']) is ["a","c"]).
 * 1878, 1883 — adding to the live set unconditionally. The extra member is
 *   undefined, and the set is only ever queried with a string that
 *   normalizeHeadingAnchor already proved is not undefined (line 259).
 * 1888 — seeding the links array with a string. Destructuring a string yields
 *   undefined for both fields, and normalizeHeadingAnchor(undefined) is
 *   undefined, so the fake entry is dropped at line 259.
 * 1901 — the fallback label for a heading whose text is not a string. The
 *   mutant key carries a capital letter, and every lookup key comes from
 *   normalizeLabel, which lowercases (line 82), so the entry is unreachable.
 * 1963 — the id guard in the final map. The placed map is keyed by strings
 *   built with String(), so a get with undefined always misses.
 */

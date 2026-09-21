import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { atomize, diffText } from '../../../../../src/components/modules/yjs/text-diff';

/**
 * Two properties of `atomize` that are not about a merge outcome, so they are
 * cheaper and sharper to pin here than through two Y.Text peers.
 *
 * 1. A COMPLETE tag or entity is one atom, whatever precedes it. The UAX #29
 *    Prepend characters — the Arabic number signs, U+0D4E, the Brahmic ones —
 *    cluster with what FOLLOWS them, and they swallowed the `<` of the tag
 *    after them. An edit boundary then landed between `<` and the tag name,
 *    which is how this file's earlier bugs produced an `href` pointing at a
 *    domain nobody typed.
 * 2. The cost of the split is about the CLUSTERS in the block, not its length.
 *    Asking `Intl.Segmenter` about every character is the difference between
 *    7us and 116us per keystroke for a Thai or Hebrew document — so these count
 *    the calls rather than the microseconds, which is the defect itself and
 *    does not depend on how loaded the machine is.
 */

/** U+0600 ARABIC NUMBER SIGN, a Prepend character. */
const PREPEND = '؀';

/** A grapheme segmenter's `containing`, which the scan pays 250ns a call for. */
const segmentsPrototype = Object.getPrototypeOf(
  new Intl.Segmenter('en', { granularity: 'grapheme' }).segment('')
) as Intl.Segments;

describe('atomize: a tag stays whole after a Prepend character', () => {
  it('does not swallow the `<` of a complete tag into the character before it', () => {
    expect(atomize(`${PREPEND}<b>bold</b>`)).toEqual([PREPEND, '<b>', 'b', 'o', 'l', 'd', '</b>']);
  });

  it('does not swallow the `&` of a complete entity', () => {
    expect(atomize(`${PREPEND}&amp;x`)).toEqual([PREPEND, '&amp;', 'x']);
  });

  it('retags in one whole-tag replacement, not one that starts inside the tag', () => {
    const ops = diffText(`${PREPEND}<b>bold</b> tail`, `${PREPEND}<i>bold</i> tail`);

    expect(ops).toEqual([
      { index: 1,
        remove: 3,
        insert: '<i>' },
      { index: 8,
        remove: 4,
        insert: '</i>' },
    ]);
  });

  it('still clusters a Prepend with a `<` that is only a typed character', () => {
    expect(atomize(`${PREPEND}<x no tag`)).toEqual([`${PREPEND}<`, 'x', ' ', 'n', 'o', ' ', 't', 'a', 'g']);
  });
});

describe('atomize: the segmenter is asked about clusters, not about characters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks it nothing at all for text that is plain ASCII', () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');

    atomize('the quick brown fox jumps over the lazy dog, '.repeat(40));

    expect(segment).not.toHaveBeenCalled();
  });

  it('asks it nothing per character for a Thai block, whose letters are not clusters', () => {
    const containing = vi.spyOn(segmentsPrototype, 'containing');
    const thai = 'กัขิคีงจ็ฉ่ชญ้ฎ '.repeat(40);

    atomize(thai);

    expect(containing).not.toHaveBeenCalled();
    expect(thai.length).toBeGreaterThan(500);
  });

  it('asks it nothing per character for a Hebrew block with niqqud', () => {
    const containing = vi.spyOn(segmentsPrototype, 'containing');

    atomize('אְבִגּדהוזחטיכל '.repeat(40));

    expect(containing).not.toHaveBeenCalled();
  });

  it('asks it only about the one cluster an otherwise Latin block holds', () => {
    const containing = vi.spyOn(segmentsPrototype, 'containing');

    atomize(`${'the quick brown fox '.repeat(25)}\u{1f44d}\u{1f3fd}${'jumps over '.repeat(25)}`);

    expect(containing).toHaveBeenCalledTimes(1);
  });

  it('keeps the clusters whole all the same', () => {
    expect(atomize('กัขิ')).toEqual(['กั', 'ขิ']);
    expect(atomize('אְבּ')).toEqual(['אְ', 'בּ']);
    expect(atomize('क्ष')).toEqual(['क्ष']);
    expect(atomize('\u{1f44d}\u{1f3fd}')).toEqual(['\u{1f44d}\u{1f3fd}']);
  });
});

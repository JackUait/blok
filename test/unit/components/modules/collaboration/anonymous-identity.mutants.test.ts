import { describe, it, expect } from 'vitest';

import {
  ANONYMOUS_GLYPHS,
  assignAnonymousGlyphs,
  UNKNOWN_GLYPH,
} from '../../../../../src/components/modules/collaboration/anonymous-identity';

/**
 * All six survivors are equivalent, and one fact covers them: once the glyph
 * list is spent, the slot search finds nothing free and the guard below the
 * size check assigns the very same unnamed silhouette. Deleting the size check
 * (or either of its arms), and deleting the slot-undefined check with it, only
 * changes which of two identical assignments runs.
 */
describe('anonymous glyph assignment mutants', () => {
  it('gives every peer a distinct glyph while the list lasts', () => {
    const ids = Array.from({ length: ANONYMOUS_GLYPHS.length }, (_, index) => 1000 + index);
    const assigned = assignAnonymousGlyphs(ids);

    expect(assigned.size).toBe(ANONYMOUS_GLYPHS.length);
    expect(new Set(assigned.values()).size).toBe(ANONYMOUS_GLYPHS.length);
    expect([...assigned.values()]).not.toContain(UNKNOWN_GLYPH);
  });

  // Past the last glyph everyone shares the unnamed silhouette: a face that
  // says "somebody" beats a duplicate that says the wrong somebody.
  it('hands the unnamed silhouette to every peer past the list', () => {
    const ids = Array.from({ length: ANONYMOUS_GLYPHS.length + 3 }, (_, index) => 1000 + index);
    const assigned = assignAnonymousGlyphs(ids);
    const unknown = [...assigned.values()].filter((glyph) => glyph === UNKNOWN_GLYPH);

    expect(assigned.size).toBe(ANONYMOUS_GLYPHS.length + 3);
    expect(unknown).toHaveLength(3);
  });

  // The pass sorts first, so every browser draws the same peer the same face
  // however its awareness map happened to fill.
  it('answers the same whatever order the peers arrive in', () => {
    const ids = [7, 3, 11, 42];

    expect([...assignAnonymousGlyphs(ids).entries()].sort())
      .toStrictEqual([...assignAnonymousGlyphs([...ids].reverse()).entries()].sort());
  });
});

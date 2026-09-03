/**
 * Anonymous peers — who a nameless collaborator is drawn as.
 *
 * `collaboration.user` is optional, so an unnamed peer is the DEFAULT room,
 * not an edge case. Google Docs answers it with a funny animal; this answers
 * it with a space silhouette and a localized label.
 *
 * The assignment has one hard requirement: every browser in the room must
 * derive the SAME silhouette for the same person, from the awareness client id
 * alone, with nothing new on the wire. That means the pass cannot depend on
 * the order awareness happened to hand the states over, and two peers whose
 * ids land on the same slot have to be separated the same way everywhere.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_GLYPHS,
  ANONYMOUS_LABEL_KEYS,
  UNKNOWN_GLYPH,
  assignAnonymousGlyphs,
  type AnonymousGlyph,
} from '../../../../../src/components/modules/collaboration/anonymous-identity';

const ENGLISH = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../src/components/i18n/locales/en.json'), 'utf8')
) as Record<string, string>;

/** A client id whose base slot is `slot`, offset by whole turns of the list. */
const idFor = (slot: number, turns = 0): number => slot + turns * ANONYMOUS_GLYPHS.length;

describe('anonymous presence identity', () => {
  it('names a peer from their client id, the way their colour is named', () => {
    const glyphs = assignAnonymousGlyphs([idFor(2)]);

    expect(glyphs.get(idFor(2))).toBe(ANONYMOUS_GLYPHS[2]);
  });

  it('assigns the same glyphs whatever order awareness reports the peers in', () => {
    const ids = [idFor(4), idFor(4, 1), idFor(0), idFor(11, 3)];
    const forward = assignAnonymousGlyphs(ids);
    const backward = assignAnonymousGlyphs([...ids].reverse());

    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
  });

  it('lets the lower client id keep the contested glyph and steps the other on', () => {
    const glyphs = assignAnonymousGlyphs([idFor(5, 1), idFor(5)]);

    expect(glyphs.get(idFor(5))).toBe(ANONYMOUS_GLYPHS[5]);
    expect(glyphs.get(idFor(5, 1))).toBe(ANONYMOUS_GLYPHS[6]);
  });

  it('wraps to the front of the list when the contested glyph is the last one', () => {
    const last = ANONYMOUS_GLYPHS.length - 1;
    const glyphs = assignAnonymousGlyphs([idFor(last), idFor(last, 1)]);

    expect(glyphs.get(idFor(last))).toBe(ANONYMOUS_GLYPHS[last]);
    expect(glyphs.get(idFor(last, 1))).toBe(ANONYMOUS_GLYPHS[0]);
  });

  it('gives every peer a different glyph while the list lasts', () => {
    const ids = Array.from({ length: ANONYMOUS_GLYPHS.length }, (_, index) => idFor(3, index));
    const assigned = [...assignAnonymousGlyphs(ids).values()];

    expect(new Set(assigned).size).toBe(ANONYMOUS_GLYPHS.length);
    expect(assigned).not.toContain(UNKNOWN_GLYPH);
  });

  it('falls back to the unnamed silhouette once the list is exhausted', () => {
    const ids = Array.from({ length: ANONYMOUS_GLYPHS.length + 2 }, (_, index) => idFor(3, index));
    const glyphs = assignAnonymousGlyphs(ids);
    const overflow = ids.slice(ANONYMOUS_GLYPHS.length);

    expect(overflow.map((id) => glyphs.get(id))).toEqual([UNKNOWN_GLYPH, UNKNOWN_GLYPH]);
  });

  it('folds a negative or fractional client id onto a real slot', () => {
    const glyphs = assignAnonymousGlyphs([-idFor(7), idFor(1) + 0.5]);

    expect(glyphs.get(-idFor(7))).toBe(ANONYMOUS_GLYPHS[7]);
    expect(glyphs.get(idFor(1) + 0.5)).toBe(ANONYMOUS_GLYPHS[1]);
  });

  it('carries a message key for every silhouette, including the fallback', () => {
    const glyphs: AnonymousGlyph[] = [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH];

    expect(Object.keys(ANONYMOUS_LABEL_KEYS).sort()).toEqual([...glyphs].sort());
    glyphs.forEach((glyph) => {
      expect(ENGLISH[ANONYMOUS_LABEL_KEYS[glyph]]).toBeTypeOf('string');
    });
  });
});

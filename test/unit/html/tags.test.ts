import { describe, expect, it } from 'vitest';
import { html } from 'parse5';
import { getTagID, NS, SPECIAL_ELEMENTS, TAG_ID } from '../../../src/html/tags';

/** The tree builder is a port, so its tag ids and special sets must stay parse5's. */
describe('html tag tables', () => {
  it('numbers every known tag exactly like parse5', () => {
    const ours = Object.keys(TAG_ID).filter((key) => Number.isNaN(Number(key)));
    const theirs = Object.keys(html.TAG_ID).filter((key) => Number.isNaN(Number(key)));

    expect(ours).toEqual(theirs);
    expect(ours.map((name) => TAG_ID[name as keyof typeof TAG_ID])).toEqual(theirs.map((name) => html.TAG_ID[name as keyof typeof html.TAG_ID]));
  });

  it('maps every tag name to the id parse5 gives it', () => {
    const names = Object.values(html.TAG_NAMES);

    expect(names.map(getTagID)).toEqual(names.map((name) => html.getTagID(name)));
    expect(getTagID('blok-unknown')).toBe(TAG_ID.UNKNOWN);
  });

  it('keeps the special-element sets of every namespace', () => {
    for (const ns of Object.values(NS)) {
      expect([...SPECIAL_ELEMENTS[ns]].sort()).toEqual([...html.SPECIAL_ELEMENTS[ns]].sort());
    }
  });
});

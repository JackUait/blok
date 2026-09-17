/**
 * The fake DOMRectList the suite hands to code that measures geometry.
 *
 * jsdom ships no layout, so every rect a test asserts against comes from here.
 * A fake that answers some of the list's surface and not the rest is worse than
 * no fake at all: the suite stays green and the browser breaks.
 */
import { describe, expect, it } from 'vitest';

import { toDOMRectList } from './dom-rect-list';

describe('toDOMRectList', () => {
  const first = new DOMRect(10, 20, 30, 40);
  const second = new DOMRect(0, 60, 25, 18);

  it('answers indexed access, the way a real list does', () => {
    const list = toDOMRectList([first, second]);

    // The member a browser's list answers and a plain `{length, item}` object
    // does not — while still type-checking, because TypeScript skips
    // string-named members when it checks a numeric index signature.
    expect(list[0]).toBe(first);
    expect(list[1]).toBe(second);
  });

  it('answers length, item and iteration too', () => {
    const list = toDOMRectList([first, second]);

    expect(list.length).toBe(2);
    expect(list.item(1)).toBe(second);
    expect(list.item(5)).toBeNull();
    expect(Array.from(list)).toEqual([first, second]);
  });

  it('copies the array it was given, so a later push cannot reach it', () => {
    const rects = [first];
    const list = toDOMRectList(rects);

    rects.push(second);

    expect(list.length).toBe(1);
  });
});

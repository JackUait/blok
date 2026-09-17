/**
 * A DOMRectList over `rects`, for jsdom — which ships no layout and so measures
 * nothing of its own.
 *
 * Array-backed on purpose. A browser's list answers `rects[0]`, and a fake
 * carrying only `length`, `item` and the iterator still type-checks — TypeScript
 * skips string-named members when it checks a numeric index signature — while
 * handing back `undefined` there. That shape gives whoever first indexes into it
 * a green suite and a broken browser.
 * @param rects - the boxes the list reports, in order
 */
export const toDOMRectList = (rects: DOMRect[]): DOMRectList =>
  Object.assign([...rects], {
    item: (index: number) => rects[index] ?? null,
  });

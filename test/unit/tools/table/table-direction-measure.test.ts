import { afterEach, describe, expect, it, vi } from 'vitest';
import { inlineAxis, measureLastColumnWidth, measureLastRowHeight } from '../../../../src/tools/table/table-direction';

const rectOf = (x: number, y: number, width: number, height: number): DOMRect =>
  ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });

/** An outer 2x2 grid whose last row's first cell holds a nested 1x1 grid. */
const build = (): { outer: HTMLElement; rects: Map<Element, DOMRect> } => {
  const rects = new Map<Element, DOMRect>();
  const grid = (): HTMLElement => {
    const table = document.createElement('table');

    table.appendChild(document.createElement('tbody'));

    return table;
  };
  const row = (parent: HTMLElement, rect: DOMRect): HTMLElement => {
    const tr = document.createElement('tr');

    tr.setAttribute('data-blok-table-row', '');
    parent.querySelector('tbody')?.appendChild(tr);
    rects.set(tr, rect);

    return tr;
  };
  const cell = (parent: HTMLElement, rect: DOMRect): HTMLElement => {
    const td = document.createElement('td');

    td.setAttribute('data-blok-table-cell', '');
    parent.appendChild(td);
    rects.set(td, rect);

    return td;
  };

  const outer = grid();

  rects.set(outer, rectOf(0, 0, 300, 120));

  const first = row(outer, rectOf(0, 0, 300, 30));

  cell(first, rectOf(0, 0, 100, 30));
  cell(first, rectOf(100, 0, 200, 30));

  const last = row(outer, rectOf(0, 30, 300, 90));
  const host = cell(last, rectOf(0, 30, 100, 90));

  cell(last, rectOf(100, 30, 200, 90));

  const inner = grid();

  host.appendChild(inner);
  rects.set(inner, rectOf(10, 40, 80, 20));
  cell(row(inner, rectOf(10, 40, 80, 20)), rectOf(10, 40, 80, 20));

  document.body.appendChild(outer);

  return { outer, rects };
};

describe('last row and column of a grid holding a nested table', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('measures the grid own last row, not the nested table row after it', () => {
    const { outer, rects } = build();

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rects.get(this) ?? rectOf(0, 0, 0, 0);
    });

    expect(measureLastRowHeight(outer)).toBe(90);
  });

  it('measures the grid own last column, not a nested cell', () => {
    const { outer, rects } = build();

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rects.get(this) ?? rectOf(0, 0, 0, 0);
    });

    expect(measureLastColumnWidth(outer, outer.getBoundingClientRect(), inlineAxis('ltr'))).toBe(200);
  });
});

import { describe, it, expect } from 'vitest';

import { resizeFloorPx } from '../../../../src/tools/image/resize-floor';
import { IMAGE_TABLE_CELL_MIN_WIDTH_PX, TABLE_CELL_ATTR } from '../../../../src/tools/image/constants';
import { CELL_ATTR } from '../../../../src/tools/table/table-core';

describe('resizeFloorPx', () => {
  it('floors the resize width to the table-cell minimum when the figure is inside a cell', () => {
    const cell = document.createElement('td');
    cell.setAttribute(TABLE_CELL_ATTR, '');
    const figure = document.createElement('div');
    cell.appendChild(figure);

    expect(resizeFloorPx(figure)).toBe(IMAGE_TABLE_CELL_MIN_WIDTH_PX);
  });

  it('returns undefined for an image outside any table cell (global percent floor applies)', () => {
    const wrapper = document.createElement('div');
    const figure = document.createElement('div');
    wrapper.appendChild(figure);

    expect(resizeFloorPx(figure)).toBeUndefined();
  });

  it('mirrors the table tool cell attribute so a rename there is caught here (drift guard)', () => {
    // TABLE_CELL_ATTR is a local copy so the image bundle need not import the
    // whole table module for one selector string. This guards against drift.
    expect(TABLE_CELL_ATTR).toBe(CELL_ATTR);
  });
});

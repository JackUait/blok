import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconDotsHorizontal, IconMenu } from '../../../../src/components/icons';
import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';
import { TableRowColControls } from '../../../../src/tools/table/table-row-col-controls';

const svgOf = (icon: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(icon, 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Missing SVG');
  }

  return svg;
};

const requiredElement = <T extends Element>(root: Element, selector: string): T => {
  const element = root.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`Missing ${selector}`);
  }

  return element;
};

const dotsOf = (svg: SVGSVGElement): (string | null)[][] =>
  Array.from(svg.querySelectorAll(':scope > circle'), circle =>
    ['cx', 'cy', 'r', 'fill'].map(attribute => circle.getAttribute(attribute)));

describe('table micro icons in the Blok Line family', () => {
  let grid: HTMLElement;
  let controls: TableRowColControls;
  let selection: TableCellSelection;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    grid = document.createElement('div');

    for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
      const row = document.createElement('div');

      row.setAttribute('data-blok-table-row', '');

      for (let colIndex = 0; colIndex < 2; colIndex++) {
        const cell = document.createElement('div');

        cell.setAttribute('data-blok-table-cell', '');
        cell.setAttribute('data-blok-table-cell-row', String(rowIndex));
        cell.setAttribute('data-blok-table-cell-col', String(colIndex));
        row.appendChild(cell);
      }

      grid.appendChild(row);
    }

    document.body.appendChild(grid);

    const i18n = {
      t: (key: string) => key,
      has: () => false,
      getEnglishTranslation: (key: string) => key,
      getLocale: () => 'en',
    };

    controls = new TableRowColControls({
      grid,
      getColumnCount: () => 2,
      getRowCount: () => 2,
      isHeadingRow: () => false,
      isHeadingColumn: () => false,
      onAction: vi.fn(),
      onClearContents: vi.fn(),
      onColorChange: vi.fn(),
      i18n,
    });
    selection = new TableCellSelection({ grid, i18n });
  });

  afterEach(() => {
    selection.destroy();
    controls.destroy();
    grid.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { type: 'row', width: '10', height: '14', viewBox: '5 3 10 14', rotation: null, dimension: 'width' },
    { type: 'col', width: '14', height: '10', viewBox: '3 5 14 10', rotation: 'rotate(90 10 10)', dimension: 'height' },
  ] as const)('$type grips crop IconMenu without thickening dots or changing pill expansion', ({ type, width, height, viewBox, rotation, dimension }) => {
    const grip = requiredElement<HTMLElement>(grid, `[data-blok-table-grip-${type}="0"]`);
    const svg = requiredElement<SVGSVGElement>(grip, 'svg');

    expect(dotsOf(svg)).toStrictEqual(dotsOf(svgOf(IconMenu)));
    expect(svg.querySelectorAll(':scope > circle')).toHaveLength(6);
    expect(svg.getAttribute('viewBox')).toBe(viewBox);
    expect(svg.getAttribute('width')).toBe(width);
    expect(svg.getAttribute('height')).toBe(height);
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');

    for (const circle of svg.querySelectorAll(':scope > circle')) {
      expect(circle.getAttribute('transform')).toBe(rotation);
    }

    expect(svg).toHaveClass('pointer-events-none', 'opacity-0', 'text-gray-400');
    expect(grip.style[dimension]).toBe('4px');
    grip.dispatchEvent(new MouseEvent('mouseenter'));
    expect(grip.style[dimension]).toBe('16px');
    expect(svg).toHaveClass('opacity-100');
    grip.dispatchEvent(new MouseEvent('mouseleave'));
    expect(grip.style[dimension]).toBe('4px');
    expect(svg).toHaveClass('opacity-0');
  });

  it('the cell menu crops rotated IconDotsHorizontal while keeping its white compact pill', () => {
    selection.selectRow(0);

    const pill = requiredElement<HTMLElement>(grid, '[data-blok-table-cell-menu]');
    const svg = requiredElement<SVGSVGElement>(pill, 'svg');

    expect(dotsOf(svg)).toStrictEqual(dotsOf(svgOf(IconDotsHorizontal)));
    expect(svg.querySelectorAll(':scope > circle')).toHaveLength(3);
    expect(svg.getAttribute('viewBox')).toBe('8 3 4 14');
    expect(svg.getAttribute('width')).toBe('4');
    expect(svg.getAttribute('height')).toBe('14');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');

    for (const circle of svg.querySelectorAll(':scope > circle')) {
      expect(circle).toHaveAttribute('transform', 'rotate(90 10 10)');
    }

    expect(svg).toHaveClass('pointer-events-none', 'opacity-0', 'text-white');
    expect(pill.style.width).toBe('4px');
    expect(pill.style.height).toBe('20px');
    pill.dispatchEvent(new MouseEvent('mouseenter'));
    expect(pill.style.width).toBe('16px');
    expect(svg).toHaveClass('opacity-100');
    pill.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pill.style.width).toBe('4px');
    expect(svg).toHaveClass('opacity-0');
    expect(selection.getSelectedRange()).toStrictEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createCellPlacementPicker } from '../../../../src/tools/table/table-cell-placement-picker';
import type { CellPlacement } from '../../../../src/tools/table/types';

type PickerOptions = Parameters<typeof createCellPlacementPicker>[0];

const i18n = {
  t: (key: string): string => key,
} as PickerOptions['i18n'];

/**
 * alignItems comes from the horizontal half of the placement, justifyContent from
 * the vertical half. Spelled out per placement instead of looked up, so a mutated
 * `placement.split('-')` cannot feed the expectation the same wrong key.
 */
const CELL_ALIGNMENT: ReadonlyArray<readonly [CellPlacement, string, string]> = [
  ['top-left', 'flex-start', 'flex-start'],
  ['top-center', 'center', 'flex-start'],
  ['top-right', 'flex-end', 'flex-start'],
  ['middle-left', 'flex-start', 'center'],
  ['middle-center', 'center', 'center'],
  ['middle-right', 'flex-end', 'center'],
  ['bottom-left', 'flex-start', 'flex-end'],
  ['bottom-center', 'center', 'flex-end'],
  ['bottom-right', 'flex-end', 'flex-end'],
];

const IDLE_TAIL = ' background-color: var(--blok-bg-light, #eff2f5);';
const ACTIVE_TAIL = ' outline: 2px solid var(--blok-color-primary, #388AE5);'
  + ' outline-offset: -2px;'
  + ' background-color: var(--blok-item-focus-bg, rgba(35, 131, 226, 0.14));';
/**
 * A click re-uses the background-color slot the deselect pass already wrote, so
 * outline lands after it. cssText keeps first-write order, hence the flip.
 */
const CLICKED_TAIL = ' background-color: var(--blok-item-focus-bg, rgba(35, 131, 226, 0.14));'
  + ' outline: 2px solid var(--blok-color-primary, #388AE5);'
  + ' outline-offset: -2px;';
const DESELECTED_TAIL = ' background-color: var(--blok-bg-tertiary, #f0f0f0);';

const cellCss = (alignItems: string, justifyContent: string, tail: string): string =>
  'width: 32px; height: 26px; border-radius: 3px; display: flex; flex-direction: column;'
  + ` align-items: ${alignItems}; justify-content: ${justifyContent};`
  + ` padding: 3px; cursor: pointer; gap: 1px;${tail}`;

type CellSnapshot = [placement: string | null, active: string | null, css: string];

const expectedCells = (activePlacement: CellPlacement, activeTail: string, idleTail: string): CellSnapshot[] =>
  CELL_ALIGNMENT.map(([placement, alignItems, justifyContent]) => {
    const isActive = placement === activePlacement;

    return [
      placement,
      isActive ? 'true' : null,
      cellCss(alignItems, justifyContent, isActive ? activeTail : idleTail),
    ];
  });

interface Rendered {
  wrapper: HTMLDivElement;
  grid: HTMLElement;
  label: HTMLElement;
  cells: HTMLElement[];
}

const snapshot = (cells: HTMLElement[]): CellSnapshot[] =>
  cells.map(cell => [cell.getAttribute('data-placement'), cell.getAttribute('data-active'), cell.style.cssText]);

describe('createCellPlacementPicker — mutation coverage', () => {
  let onPlacementSelect: Mock<(placement: CellPlacement) => void>;

  const render = (currentPlacement: CellPlacement | undefined): Rendered => {
    const { element } = createCellPlacementPicker({ i18n, currentPlacement, onPlacementSelect });
    const [grid, label] = Array.from(element.children);

    if (!(grid instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      throw new Error('picker must render a grid element followed by a label element');
    }

    return {
      wrapper: element,
      grid,
      label,
      cells: Array.from(grid.querySelectorAll<HTMLElement>('[data-placement]')),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onPlacementSelect = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives the wrapper, the grid and the label their exact inline styles', () => {
    const { wrapper, grid, label } = render('top-left');

    expect([wrapper.style.cssText, grid.style.cssText, label.style.cssText]).toEqual([
      'padding: 8px;',
      'display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px;',
      'text-align: center; font-size: 11px; margin-top: 6px; color: var(--blok-text-secondary, #707684);',
    ]);
  });

  it('styles all nine cells and marks only the current one active', () => {
    const { cells } = render('top-left');

    expect(snapshot(cells)).toEqual(expectedCells('top-left', ACTIVE_TAIL, IDLE_TAIL));
  });

  it('moves the active styling with currentPlacement without touching the alignment of the rest', () => {
    const { cells } = render('middle-right');

    expect(snapshot(cells)).toEqual(expectedCells('middle-right', ACTIVE_TAIL, IDLE_TAIL));
  });

  it('falls back to top-left styling when currentPlacement is undefined', () => {
    const { cells } = render(undefined);

    expect(snapshot(cells)).toEqual(expectedCells('top-left', ACTIVE_TAIL, IDLE_TAIL));
  });

  it('puts exactly two indicator lines with their exact styles inside every cell', () => {
    const { cells } = render('bottom-center');
    const lines = cells.map(cell =>
      Array.from(cell.children).map(child => (child instanceof HTMLElement ? child.style.cssText : 'not-an-element')));

    expect(lines).toEqual(cells.map(() => [
      'width: 14px; height: 2px; border-radius: 1px; background-color: currentcolor; opacity: 0.6;',
      'width: 9px; height: 2px; border-radius: 1px; background-color: currentcolor; opacity: 0.3;',
    ]));
  });

  it('repaints every cell on click: the clicked one active, all others reset to the deselect background', () => {
    const { cells, grid } = render('top-left');
    const target = grid.querySelector<HTMLElement>('[data-placement="middle-right"]');

    target?.click();

    expect(snapshot(cells)).toEqual(expectedCells('middle-right', CLICKED_TAIL, DESELECTED_TAIL));
    expect(onPlacementSelect.mock.calls).toEqual([['middle-right']]);
  });

  it('leaves exactly one cell carrying data-active="true" after a chain of clicks', () => {
    const { cells, grid } = render('top-left');

    grid.querySelector<HTMLElement>('[data-placement="bottom-left"]')?.click();
    grid.querySelector<HTMLElement>('[data-placement="top-center"]')?.click();
    grid.querySelector<HTMLElement>('[data-placement="middle-center"]')?.click();

    const active = Array.from(grid.querySelectorAll('[data-active]'));

    expect(active.map(el => [el.getAttribute('data-placement'), el.getAttribute('data-active')])).toEqual([
      ['middle-center', 'true'],
    ]);
    expect(snapshot(cells)).toEqual(expectedCells('middle-center', CLICKED_TAIL, DESELECTED_TAIL));
    expect(onPlacementSelect.mock.calls).toEqual([['bottom-left'], ['top-center'], ['middle-center']]);
  });

  it('reads the label from the clicked placement key', () => {
    const { grid, label } = render('top-left');

    expect(label.textContent).toBe('tools.table.placementTopLeft');

    grid.querySelector<HTMLElement>('[data-placement="bottom-right"]')?.click();

    expect(label.textContent).toBe('tools.table.placementBottomRight');
  });
});

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createCellPlacementPicker } from '../../../../src/tools/table/table-cell-placement-picker';
import type { CellPlacement } from '../../../../src/tools/table/types';

const mockI18n = {
  t: (key: string): string => {
    const map: Record<string, string> = {
      'tools.table.placementTopLeft': 'Top Left',
      'tools.table.placementTopCenter': 'Top Center',
      'tools.table.placementTopRight': 'Top Right',
      'tools.table.placementMiddleLeft': 'Middle Left',
      'tools.table.placementMiddleCenter': 'Center',
      'tools.table.placementMiddleRight': 'Middle Right',
      'tools.table.placementBottomLeft': 'Bottom Left',
      'tools.table.placementBottomCenter': 'Bottom Center',
      'tools.table.placementBottomRight': 'Bottom Right',
    };

    return map[key] ?? key;
  },
} as Parameters<typeof createCellPlacementPicker>[0]['i18n'];

describe('createCellPlacementPicker', () => {
  let onPlacementSelect: Mock<(placement: CellPlacement) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    onPlacementSelect = vi.fn();
  });

  it('returns an element containing 9 clickable grid cells', () => {
    const { element } = createCellPlacementPicker({
      i18n: mockI18n,
      currentPlacement: undefined,
      onPlacementSelect,
    });

    const cells = element.querySelectorAll('[data-placement]');

    expect(cells.length).toBe(9);
  });

  it('highlights the current placement cell', () => {
    const { element } = createCellPlacementPicker({
      i18n: mockI18n,
      currentPlacement: 'middle-center',
      onPlacementSelect,
    });

    const active = element.querySelector('[data-placement="middle-center"]');

    expect(active?.getAttribute('data-active')).toBe('true');
  });

  it('defaults highlight to top-left when currentPlacement is undefined', () => {
    const { element } = createCellPlacementPicker({
      i18n: mockI18n,
      currentPlacement: undefined,
      onPlacementSelect,
    });

    const active = element.querySelector('[data-placement="top-left"]');

    expect(active?.getAttribute('data-active')).toBe('true');
  });

  it('calls onPlacementSelect with the clicked placement', () => {
    const { element } = createCellPlacementPicker({
      i18n: mockI18n,
      currentPlacement: undefined,
      onPlacementSelect,
    });

    const cell = element.querySelector<HTMLElement>('[data-placement="bottom-right"]');

    cell?.click();

    expect(onPlacementSelect).toHaveBeenCalledWith('bottom-right');
  });

  it('shows a label below the grid', () => {
    const { element } = createCellPlacementPicker({
      i18n: mockI18n,
      currentPlacement: 'middle-center',
      onPlacementSelect,
    });

    expect(element.textContent).toContain('Center');
  });
});

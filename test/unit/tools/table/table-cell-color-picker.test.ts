import { describe, it, expect, vi } from 'vitest';
import type { I18n } from '../../../../types/api';
import { createCellColorPicker } from '../../../../src/tools/table/table-cell-color-picker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';

describe('createCellColorPicker', () => {
  const mockI18n: I18n = {
    t: (key: string) => key,
    has: () => false,
    getEnglishTranslation: () => '',
  };

  it('renders a container with 9 swatches', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const swatches = element.querySelectorAll('[data-blok-testid^="cell-color-swatch-"]');

    expect(swatches).toHaveLength(9);
  });

  it('renders a default button', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const defaultBtn = element.querySelector('[data-blok-testid="cell-color-default-btn"]');

    expect(defaultBtn).toBeTruthy();
  });

  it('clicking a swatch calls onColorSelect with bg color', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const firstSwatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="cell-color-swatch-${COLOR_PRESETS[0].name}"]`
    );

    firstSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].bg);
  });

  it('clicking default button calls onColorSelect with null', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const defaultBtn = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-default-btn"]');

    defaultBtn?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null);
  });
});

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

  it('renders tab buttons for Text and Background', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const tabs = element.querySelectorAll('[data-blok-testid^="cell-color-tab-"]');

    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('data-blok-testid')).toBe('cell-color-tab-textColor');
    expect(tabs[1].getAttribute('data-blok-testid')).toBe('cell-color-tab-backgroundColor');
  });

  it('Background tab is active by default', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const bgTab = element.querySelector('[data-blok-testid="cell-color-tab-backgroundColor"]');

    expect(bgTab?.className).toContain('font-medium');
  });

  it('renders 9 swatches', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const swatches = element.querySelectorAll('[data-blok-testid^="cell-color-swatch-"]');

    expect(swatches).toHaveLength(9);
  });

  it('clicking swatch in background mode calls onColorSelect with bg color and backgroundColor mode', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const firstSwatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="cell-color-swatch-${COLOR_PRESETS[0].name}"]`
    );

    firstSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].bg, 'backgroundColor');
  });

  it('switching to text tab changes active tab', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const textTab = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-tab-textColor"]');

    textTab?.click();

    expect(textTab?.className).toContain('font-medium');

    const bgTab = element.querySelector('[data-blok-testid="cell-color-tab-backgroundColor"]');

    expect(bgTab?.className).not.toContain('font-medium');
  });

  it('clicking swatch in text mode calls onColorSelect with text color and textColor mode', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    // Switch to text mode
    const textTab = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-tab-textColor"]');

    textTab?.click();

    const firstSwatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="cell-color-swatch-${COLOR_PRESETS[0].name}"]`
    );

    firstSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].text, 'textColor');
  });

  it('default button calls onColorSelect with null and current mode', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const defaultBtn = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-default-btn"]');

    defaultBtn?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'backgroundColor');
  });

  it('default button uses current mode (textColor)', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    // Switch to text mode
    const textTab = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-tab-textColor"]');

    textTab?.click();

    const defaultBtn = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-default-btn"]');

    defaultBtn?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'textColor');
  });

  it('renders a default button', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const defaultBtn = element.querySelector('[data-blok-testid="cell-color-default-btn"]');

    expect(defaultBtn).toBeTruthy();
  });

  it('swatches always display "A" text in both modes', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const swatches = Array.from(element.querySelectorAll('[data-blok-testid^="cell-color-swatch-"]'));

    for (const swatch of swatches) {
      expect(swatch.textContent).toBe('A');
    }

    // Switch to text mode
    const textTab = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-tab-textColor"]');

    textTab?.click();

    const textSwatches = Array.from(element.querySelectorAll('[data-blok-testid^="cell-color-swatch-"]'));

    for (const swatch of textSwatches) {
      expect(swatch.textContent).toBe('A');
    }
  });

  it('swatches show background color in background mode', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const firstSwatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="cell-color-swatch-${COLOR_PRESETS[0].name}"]`
    );

    // JSDOM normalises hex to rgb(), so just check the property is set
    expect(firstSwatch?.style.backgroundColor).toBeTruthy();
  });
});

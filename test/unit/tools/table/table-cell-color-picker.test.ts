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

  it('renders two sections for Text and Background', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const textSection = element.querySelector('[data-blok-testid="cell-color-section-textColor"]');
    const bgSection = element.querySelector('[data-blok-testid="cell-color-section-backgroundColor"]');

    expect(textSection).not.toBeNull();
    expect(bgSection).not.toBeNull();
  });

  it('does not render tab buttons', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const tabs = element.querySelectorAll('[data-blok-testid^="cell-color-tab-"]');

    expect(tabs).toHaveLength(0);
  });

  it('renders all color swatches in each section including the default swatch', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const textSwatches = element.querySelectorAll('[data-blok-testid^="cell-color-swatch-textColor-"]');
    const bgSwatches = element.querySelectorAll('[data-blok-testid^="cell-color-swatch-backgroundColor-"]');

    // 1 default swatch + one per preset per section
    expect(textSwatches).toHaveLength(COLOR_PRESETS.length + 1);
    expect(bgSwatches).toHaveLength(COLOR_PRESETS.length + 1);
  });

  it('clicking swatch in background section calls onColorSelect with bg color and backgroundColor mode', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const firstSwatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="cell-color-swatch-backgroundColor-${COLOR_PRESETS[0].name}"]`
    );

    firstSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].bg, 'backgroundColor');
  });

  it('clicking swatch in text section calls onColorSelect with text color and textColor mode', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const firstSwatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="cell-color-swatch-textColor-${COLOR_PRESETS[0].name}"]`
    );

    firstSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].text, 'textColor');
  });

  it('default swatch in background section calls onColorSelect with null and backgroundColor mode', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const defaultSwatch = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-swatch-backgroundColor-default"]');

    defaultSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'backgroundColor');
  });

  it('default swatch in text section calls onColorSelect with null and textColor mode', () => {
    const onColorSelect = vi.fn();
    const { element } = createCellColorPicker({ i18n: mockI18n, onColorSelect });

    const defaultSwatch = element.querySelector<HTMLElement>('[data-blok-testid="cell-color-swatch-textColor-default"]');

    defaultSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'textColor');
  });

  it('renders a default swatch in each section', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    expect(element.querySelector('[data-blok-testid="cell-color-swatch-textColor-default"]')).toBeTruthy();
    expect(element.querySelector('[data-blok-testid="cell-color-swatch-backgroundColor-default"]')).toBeTruthy();
  });

  it('does not render a separate default button', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const defaultBtn = element.querySelector('[data-blok-testid="cell-color-default-btn"]');

    expect(defaultBtn).toBeNull();
  });

  it('text-color swatches display "A" text, background-color swatches do not', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const textSwatches = Array.from(element.querySelectorAll('[data-blok-testid^="cell-color-swatch-textColor-"]'));
    const bgSwatches = Array.from(element.querySelectorAll('[data-blok-testid^="cell-color-swatch-backgroundColor-"]'));

    for (const swatch of textSwatches) {
      expect(swatch.textContent).toBe('A');
    }

    for (const swatch of bgSwatches) {
      expect(swatch.textContent).toBe('');
    }
  });

  it('swatches in background section show background color', () => {
    const { element } = createCellColorPicker({
      i18n: mockI18n,
      onColorSelect: vi.fn(),
    });

    const firstSwatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="cell-color-swatch-backgroundColor-${COLOR_PRESETS[0].name}"]`
    );

    // JSDOM normalises hex to rgb(), so just check the property is set
    expect(firstSwatch?.style.backgroundColor).toBeTruthy();
  });
});

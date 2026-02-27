import { describe, it, expect, vi } from 'vitest';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import type { ColorPickerOptions } from '../../../../src/components/shared/color-picker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import type { I18n } from '../../../../types/api';

const mockI18n: I18n = {
  t: (key: string) => key,
  has: () => false,
  getEnglishTranslation: () => '',
};

const createOptions = (overrides: Partial<ColorPickerOptions> = {}): ColorPickerOptions => ({
  i18n: mockI18n,
  testIdPrefix: 'test',
  modes: [
    { key: 'text', labelKey: 'label.text', presetField: 'text' },
    { key: 'bg', labelKey: 'label.bg', presetField: 'bg' },
  ],
  onColorSelect: vi.fn(),
  ...overrides,
});

describe('createColorPicker', () => {
  it('renders two tab buttons', () => {
    const picker = createColorPicker(createOptions());
    const tabs = picker.querySelectorAll('[data-blok-testid^="test-tab-"]');

    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('data-blok-testid')).toBe('test-tab-text');
    expect(tabs[1].getAttribute('data-blok-testid')).toBe('test-tab-bg');
  });

  it('renders 9 color swatches', () => {
    const picker = createColorPicker(createOptions());
    const swatches = picker.querySelectorAll('[data-blok-testid^="test-swatch-"]');

    expect(swatches).toHaveLength(COLOR_PRESETS.length);
  });

  it('renders a default button', () => {
    const picker = createColorPicker(createOptions());
    const defaultBtn = picker.querySelector('[data-blok-testid="test-default-btn"]');

    expect(defaultBtn).not.toBeNull();
  });

  it('first mode is active by default (defaultModeIndex=0)', () => {
    const picker = createColorPicker(createOptions());
    const firstTab = picker.querySelector('[data-blok-testid="test-tab-text"]');
    const secondTab = picker.querySelector('[data-blok-testid="test-tab-bg"]');

    expect(firstTab?.className).toContain('font-medium');
    expect(secondTab?.className).not.toContain('font-medium');
  });

  it('respects defaultModeIndex=1', () => {
    const picker = createColorPicker(createOptions({ defaultModeIndex: 1 }));
    const firstTab = picker.querySelector('[data-blok-testid="test-tab-text"]');
    const secondTab = picker.querySelector('[data-blok-testid="test-tab-bg"]');

    expect(firstTab?.className).not.toContain('font-medium');
    expect(secondTab?.className).toContain('font-medium');
  });

  it('switching tabs updates active state', () => {
    const picker = createColorPicker(createOptions());
    const secondTab = picker.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

    secondTab?.click();

    const firstTab = picker.querySelector('[data-blok-testid="test-tab-text"]');

    expect(firstTab?.className).not.toContain('font-medium');
    expect(secondTab?.className).toContain('font-medium');
  });

  it('swatch click calls onColorSelect with color and mode key', () => {
    const onColorSelect = vi.fn();
    const picker = createColorPicker(createOptions({ onColorSelect }));

    const swatch = picker.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].text, 'text');
  });

  it('swatch click in second mode calls onColorSelect with bg color', () => {
    const onColorSelect = vi.fn();
    const picker = createColorPicker(createOptions({ onColorSelect }));

    const bgTab = picker.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

    bgTab?.click();

    const swatch = picker.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].bg, 'bg');
  });

  it('default button calls onColorSelect with null and current mode key', () => {
    const onColorSelect = vi.fn();
    const picker = createColorPicker(createOptions({ onColorSelect }));

    const defaultBtn = picker.querySelector<HTMLElement>('[data-blok-testid="test-default-btn"]');

    defaultBtn?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'text');
  });

  it('all swatches display "A" text in both modes', () => {
    const picker = createColorPicker(createOptions());

    const bgSwatches = Array.from(picker.querySelectorAll('[data-blok-testid^="test-swatch-"]'));

    for (const swatch of bgSwatches) {
      expect(swatch.textContent).toBe('A');
    }

    const bgTab = picker.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

    bgTab?.click();

    const textSwatches = Array.from(picker.querySelectorAll('[data-blok-testid^="test-swatch-"]'));

    for (const swatch of textSwatches) {
      expect(swatch.textContent).toBe('A');
    }
  });

  it('text-mode swatches have a neutral background', () => {
    const picker = createColorPicker(createOptions());
    const swatch = picker.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    expect(swatch?.style.backgroundColor).toBeTruthy();
    expect(swatch?.style.color).toBeTruthy();
  });

  it('bg-mode swatches show preset background color', () => {
    const picker = createColorPicker(createOptions({ defaultModeIndex: 1 }));
    const swatch = picker.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    expect(swatch?.style.backgroundColor).toBeTruthy();
  });

  it('uses testIdPrefix for all test IDs', () => {
    const picker = createColorPicker(createOptions({ testIdPrefix: 'custom' }));

    expect(picker.getAttribute('data-blok-testid')).toBe('custom-picker');
    expect(picker.querySelector('[data-blok-testid="custom-tab-text"]')).not.toBeNull();
    expect(picker.querySelector('[data-blok-testid="custom-grid"]')).not.toBeNull();
    expect(picker.querySelector('[data-blok-testid="custom-default-btn"]')).not.toBeNull();
    expect(picker.querySelector(`[data-blok-testid="custom-swatch-${COLOR_PRESETS[0].name}"]`)).not.toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import type { ColorPickerOptions } from '../../../../src/components/shared/color-picker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import type { I18n } from '../../../../types/api';
import * as tooltipModule from '../../../../src/components/utils/tooltip';

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
  it('renders two sections — one per mode', () => {
    const { element } = createColorPicker(createOptions());
    const sections = element.querySelectorAll('[data-blok-testid^="test-section-"]');

    expect(sections).toHaveLength(2);
    expect(sections[0].getAttribute('data-blok-testid')).toBe('test-section-text');
    expect(sections[1].getAttribute('data-blok-testid')).toBe('test-section-bg');
  });

  it('does not render any tab buttons', () => {
    const { element } = createColorPicker(createOptions());
    const tabs = element.querySelectorAll('[data-blok-testid^="test-tab-"]');

    expect(tabs).toHaveLength(0);
  });

  it('renders all color swatches in each section (presets + 1 default per section)', () => {
    const { element } = createColorPicker(createOptions());

    const textSwatches = element.querySelectorAll('[data-blok-testid^="test-swatch-text-"]');
    const bgSwatches = element.querySelectorAll('[data-blok-testid^="test-swatch-bg-"]');

    expect(textSwatches).toHaveLength(COLOR_PRESETS.length + 1);
    expect(bgSwatches).toHaveLength(COLOR_PRESETS.length + 1);
  });

  it('renders a default swatch in the first position of each section', () => {
    const { element } = createColorPicker(createOptions());

    expect(element.querySelector('[data-blok-testid="test-swatch-text-default"]')).not.toBeNull();
    expect(element.querySelector('[data-blok-testid="test-swatch-bg-default"]')).not.toBeNull();
  });

  it('does not render a separate default button', () => {
    const { element } = createColorPicker(createOptions());
    const defaultBtn = element.querySelector('[data-blok-testid="test-default-btn"]');

    expect(defaultBtn).toBeNull();
  });

  it('swatch click in text section calls onColorSelect with text color and text mode key', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-text-${COLOR_PRESETS[0].name}"]`
    );

    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].text, 'text');
  });

  it('swatch click in bg section calls onColorSelect with bg color and bg mode key', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-bg-${COLOR_PRESETS[0].name}"]`
    );

    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].bg, 'bg');
  });

  it('default swatch in text section calls onColorSelect with null and text mode key', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const defaultSwatch = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-text-default"]');

    defaultSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'text');
  });

  it('default swatch in bg section calls onColorSelect with null and bg mode key', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const defaultSwatch = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-bg-default"]');

    defaultSwatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'bg');
  });

  it('text-mode swatches display "A" text, bg-mode swatches do not', () => {
    const { element } = createColorPicker(createOptions());
    const textSwatches = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-text-"]'));
    const bgSwatches = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-bg-"]'));

    for (const swatch of textSwatches) {
      expect(swatch.textContent).toBe('A');
    }

    for (const swatch of bgSwatches) {
      expect(swatch.textContent).toBe('');
    }
  });

  it('text-mode swatches have a neutral background', () => {
    const { element } = createColorPicker(createOptions());
    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-text-${COLOR_PRESETS[0].name}"]`
    );

    expect(swatch?.style.backgroundColor).toBeTruthy();
    expect(swatch?.style.color).toBeTruthy();
  });

  it('bg-mode swatches show preset background color', () => {
    const { element } = createColorPicker(createOptions());
    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-bg-${COLOR_PRESETS[0].name}"]`
    );

    expect(swatch?.style.backgroundColor).toBeTruthy();
  });

  it('teal swatch exists', () => {
    const { element } = createColorPicker(createOptions());

    expect(element.querySelector('[data-blok-testid="test-swatch-text-teal"]')).not.toBeNull();
    expect(element.querySelector('[data-blok-testid="test-swatch-bg-teal"]')).not.toBeNull();
  });

  describe('active color indicator', () => {
    it('returns an object with setActiveColor method', () => {
      const handle = createColorPicker(createOptions());

      expect(handle).toHaveProperty('setActiveColor');
      expect(typeof handle.setActiveColor).toBe('function');
    });

    it('highlights the matching swatch in the correct section when setActiveColor is called', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const activeSwatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-text-${COLOR_PRESETS[0].name}"]`
      );

      expect(activeSwatch?.className).toContain('ring-2 ring-swatch-ring-hover');
    });

    it('does not highlight non-matching swatches in the same section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const inactiveSwatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-text-${COLOR_PRESETS[1].name}"]`
      );

      expect(inactiveSwatch?.className).not.toContain('ring-2 ring-swatch-ring-hover');
    });

    it('does not highlight swatches in the other section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const bgSwatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-bg-${COLOR_PRESETS[0].name}"]`
      );

      expect(bgSwatch?.className).not.toContain('ring-2 ring-swatch-ring-hover');
    });

    it('clears active indicator on preset swatches when setActiveColor is called with null', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');
      setActiveColor(null, 'text');

      const swatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-text-${COLOR_PRESETS[0].name}"]`
      );

      expect(swatch?.className).not.toContain('ring-2 ring-swatch-ring-hover');
    });

    it('default swatch in each section shows active ring when no color is selected (initial state)', () => {
      const { element } = createColorPicker(createOptions());

      const textDefault = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-text-default"]');
      const bgDefault = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-bg-default"]');

      expect(textDefault?.className).toContain('ring-2 ring-swatch-ring-hover');
      expect(bgDefault?.className).toContain('ring-2 ring-swatch-ring-hover');
    });

    it('default swatch in a section shows active ring after setActiveColor is called with null for that section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');
      setActiveColor(null, 'text');

      const textDefault = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-text-default"]');

      expect(textDefault?.className).toContain('ring-2 ring-swatch-ring-hover');
    });

    it('default swatch in active section does not show ring when a color swatch is selected', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const textDefault = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-text-default"]');

      expect(textDefault?.className).not.toContain('ring-2 ring-swatch-ring-hover');
    });

    it('default swatch in unrelated section keeps its active ring when another section has a color selected', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      // bg section has no active color — its default swatch should still show active ring
      const bgDefault = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-bg-default"]');

      expect(bgDefault?.className).toContain('ring-2 ring-swatch-ring-hover');
    });

    it('highlights the swatch in the bg section when setActiveColor is called with bg modeKey', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].bg, 'bg');

      const bgSwatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-bg-${COLOR_PRESETS[0].name}"]`
      );

      expect(bgSwatch?.className).toContain('ring-2 ring-swatch-ring-hover');
    });

    it('highlights the swatch in the text section when setActiveColor is called with text modeKey', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const textSwatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-text-${COLOR_PRESETS[0].name}"]`
      );

      expect(textSwatch?.className).toContain('ring-2 ring-swatch-ring-hover');
    });
  });

  describe('active color indicator with rgb format (bug #1)', () => {
    it('highlights the matching swatch when setActiveColor receives an rgb() string', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      /**
       * '#d44c47' (the "red" preset text color) is rgb(212, 76, 71).
       * DOM APIs like style.getPropertyValue('color') return rgb() format,
       * so setActiveColor must match rgb against hex presets.
       */
      setActiveColor('rgb(212, 76, 71)', 'text');

      const redSwatch = element.querySelector<HTMLElement>(
        '[data-blok-testid="test-swatch-text-red"]'
      );

      expect(redSwatch?.className).toContain('ring-2 ring-swatch-ring-hover');
    });

    it('does not highlight non-matching swatches when rgb color is used', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('rgb(212, 76, 71)', 'text');

      const graySwatch = element.querySelector<HTMLElement>(
        '[data-blok-testid="test-swatch-text-gray"]'
      );

      expect(graySwatch?.className).not.toContain('ring-2 ring-swatch-ring-hover');
    });

    it('highlights the matching swatch in bg section with rgb() format', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      /**
       * '#fdebec' (the "red" preset bg color) is rgb(253, 235, 236).
       */
      setActiveColor('rgb(253, 235, 236)', 'bg');

      const redSwatch = element.querySelector<HTMLElement>(
        '[data-blok-testid="test-swatch-bg-red"]'
      );

      expect(redSwatch?.className).toContain('ring-2 ring-swatch-ring-hover');
    });
  });

  describe('reset', () => {
    it('returns an object with a reset method', () => {
      const handle = createColorPicker(createOptions());

      expect(handle).toHaveProperty('reset');
      expect(typeof handle.reset).toBe('function');
    });

    it('reset clears all active color indicators across all sections', () => {
      const { element, setActiveColor, reset } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');
      reset();

      const swatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-text-${COLOR_PRESETS[0].name}"]`
      );

      expect(swatch?.className).not.toContain('ring-2 ring-swatch-ring-hover');

      // default swatch should show active ring after reset
      const textDefault = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-text-default"]');

      expect(textDefault?.className).toContain('ring-2 ring-swatch-ring-hover');
    });
  });

  describe('dark mode preset selection', () => {
    beforeEach(() => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');
    });

    afterEach(() => {
      document.documentElement.removeAttribute('data-blok-theme');
    });

    it('uses dark text preset colors when in dark mode', () => {
      const onColorSelect = vi.fn();
      const { element } = createColorPicker(createOptions({ onColorSelect }));
      const graySwatch = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-text-gray"]');

      graySwatch?.click();

      expect(onColorSelect).toHaveBeenCalledWith('#9b9b9b', 'text');
    });

    it('uses dark bg preset colors when in dark mode', () => {
      const onColorSelect = vi.fn();
      const { element } = createColorPicker(createOptions({ onColorSelect }));
      const graySwatch = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-bg-gray"]');

      graySwatch?.click();

      expect(onColorSelect).toHaveBeenCalledWith('#2f2f2f', 'bg');
    });

    it('bg-mode swatches use adapted text color for the A label in dark mode', () => {
      const { element } = createColorPicker(createOptions());
      const graySwatch = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-bg-gray"]');

      // Dark mode bg swatches should use the dark text color (#9b9b9b) not the light charcoal (#37352f).
      // jsdom normalizes hex to rgb when reading back style.color.
      expect(graySwatch?.style.color).toBe('rgb(155, 155, 155)');
    });

    it('highlights active swatch using dark preset colors', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('#9b9b9b', 'text');

      const graySwatch = element.querySelector<HTMLElement>('[data-blok-testid="test-swatch-text-gray"]');

      expect(graySwatch?.className).toContain('ring-2 ring-swatch-ring-hover');
    });
  });

  it('uses testIdPrefix for all test IDs', () => {
    const { element } = createColorPicker(createOptions({ testIdPrefix: 'custom' }));

    expect(element.getAttribute('data-blok-testid')).toBe('custom-picker');
    expect(element.querySelector('[data-blok-testid="custom-section-text"]')).not.toBeNull();
    expect(element.querySelector('[data-blok-testid="custom-section-bg"]')).not.toBeNull();
    expect(element.querySelector('[data-blok-testid="custom-swatch-text-default"]')).not.toBeNull();
    expect(element.querySelector('[data-blok-testid="custom-swatch-bg-default"]')).not.toBeNull();
    expect(element.querySelector(`[data-blok-testid="custom-swatch-text-${COLOR_PRESETS[0].name}"]`)).not.toBeNull();
    expect(element.querySelector(`[data-blok-testid="custom-swatch-bg-${COLOR_PRESETS[0].name}"]`)).not.toBeNull();
  });

  describe('tooltip templates for locale-aware word order', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const makeI18n = (translations: Record<string, string>): I18n => ({
      t: (key: string) => translations[key] ?? key,
      has: () => false,
      getEnglishTranslation: () => '',
    });

    it('calls i18n.t with tools.colorPicker.defaultSwatchLabel for default swatch tooltip', () => {
      const tSpy = vi.fn().mockReturnValue('');
      const i18n: I18n = { t: tSpy, has: () => false, getEnglishTranslation: () => '' };

      createColorPicker(createOptions({ i18n }));

      expect(tSpy).toHaveBeenCalledWith('tools.colorPicker.defaultSwatchLabel');
    });

    it('calls i18n.t with tools.colorPicker.colorSwatchLabel for color swatch tooltip', () => {
      const tSpy = vi.fn().mockReturnValue('');
      const i18n: I18n = { t: tSpy, has: () => false, getEnglishTranslation: () => '' };

      createColorPicker(createOptions({ i18n }));

      expect(tSpy).toHaveBeenCalledWith('tools.colorPicker.colorSwatchLabel');
    });

    it('default swatch tooltip uses {default} {mode} template for English word order', () => {
      const onHoverSpy = vi.spyOn(tooltipModule, 'onHover');
      const i18n = makeI18n({
        'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
        'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
        'tools.marker.default': 'Default',
        'label.text': 'Text',
        'label.bg': 'Background',
      });

      createColorPicker(createOptions({ i18n }));

      const call = onHoverSpy.mock.calls.find(
        ([el]) => el.getAttribute?.('data-blok-testid') === 'test-swatch-text-default'
      );

      expect(call?.[1]).toBe('Default text');
    });

    it('default swatch tooltip reverses word order with {mode} {default} template (Russian-style)', () => {
      const onHoverSpy = vi.spyOn(tooltipModule, 'onHover');
      const i18n = makeI18n({
        'tools.colorPicker.defaultSwatchLabel': '{mode} {default}',
        'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
        'tools.marker.default': 'по умолчанию',
        'label.text': 'Текст',
        'label.bg': 'Фон',
      });

      createColorPicker(createOptions({ i18n }));

      const call = onHoverSpy.mock.calls.find(
        ([el]) => el.getAttribute?.('data-blok-testid') === 'test-swatch-text-default'
      );

      expect(call?.[1]).toBe('Текст по умолчанию');
    });

    it('color swatch tooltip reverses word order with {mode} {color} template (Vietnamese-style)', () => {
      const onHoverSpy = vi.spyOn(tooltipModule, 'onHover');
      const i18n = makeI18n({
        'tools.colorPicker.defaultSwatchLabel': '{mode} {default}',
        'tools.colorPicker.colorSwatchLabel': '{mode} {color}',
        'tools.marker.default': 'mặc định',
        'label.text': 'Chữ',
        'label.bg': 'Nền',
        'tools.colorPicker.color.gray': 'Xám',
      });

      createColorPicker(createOptions({ i18n }));

      const call = onHoverSpy.mock.calls.find(
        ([el]) => el.getAttribute?.('data-blok-testid') === 'test-swatch-text-gray'
      );

      expect(call?.[1]).toBe('Chữ Xám');
    });
  });

  describe('focus outline suppression', () => {
    it('suppresses native focus outline on color swatches', () => {
      const { element } = createColorPicker(createOptions());
      const swatches = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-blok-testid^="test-swatch-"]'));

      for (const swatch of swatches) {
        expect(swatch.className).toContain('outline-hidden');
      }
    });

    it('suppresses native focus outline on default swatches', () => {
      const { element } = createColorPicker(createOptions());
      const textDefault = element.querySelector<HTMLButtonElement>('[data-blok-testid="test-swatch-text-default"]');
      const bgDefault = element.querySelector<HTMLButtonElement>('[data-blok-testid="test-swatch-bg-default"]');

      expect(textDefault?.className).toContain('outline-hidden');
      expect(bgDefault?.className).toContain('outline-hidden');
    });
  });
});

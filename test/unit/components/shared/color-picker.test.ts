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
    const { element } = createColorPicker(createOptions());
    const tabs = element.querySelectorAll('[data-blok-testid^="test-tab-"]');

    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('data-blok-testid')).toBe('test-tab-text');
    expect(tabs[1].getAttribute('data-blok-testid')).toBe('test-tab-bg');
  });

  it('renders all color swatches', () => {
    const { element } = createColorPicker(createOptions());
    const swatches = element.querySelectorAll('[data-blok-testid^="test-swatch-"]');

    expect(swatches).toHaveLength(COLOR_PRESETS.length);
  });

  it('renders a default button', () => {
    const { element } = createColorPicker(createOptions());
    const defaultBtn = element.querySelector('[data-blok-testid="test-default-btn"]');

    expect(defaultBtn).not.toBeNull();
  });

  it('first mode is active by default (defaultModeIndex=0)', () => {
    const { element } = createColorPicker(createOptions());
    const firstTab = element.querySelector('[data-blok-testid="test-tab-text"]');
    const secondTab = element.querySelector('[data-blok-testid="test-tab-bg"]');

    expect(firstTab?.className).toContain('font-medium');
    expect(secondTab?.className).not.toContain('font-medium');
  });

  it('respects defaultModeIndex=1', () => {
    const { element } = createColorPicker(createOptions({ defaultModeIndex: 1 }));
    const firstTab = element.querySelector('[data-blok-testid="test-tab-text"]');
    const secondTab = element.querySelector('[data-blok-testid="test-tab-bg"]');

    expect(firstTab?.className).not.toContain('font-medium');
    expect(secondTab?.className).toContain('font-medium');
  });

  it('switching tabs updates active state', () => {
    const { element } = createColorPicker(createOptions());
    const secondTab = element.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

    secondTab?.click();

    const firstTab = element.querySelector('[data-blok-testid="test-tab-text"]');

    expect(firstTab?.className).not.toContain('font-medium');
    expect(secondTab?.className).toContain('font-medium');
  });

  it('swatch click calls onColorSelect with color and mode key', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].text, 'text');
  });

  it('swatch click in second mode calls onColorSelect with bg color', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const bgTab = element.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

    bgTab?.click();

    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS[0].bg, 'bg');
  });

  it('default button calls onColorSelect with null and current mode key', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const defaultBtn = element.querySelector<HTMLElement>('[data-blok-testid="test-default-btn"]');

    defaultBtn?.click();

    expect(onColorSelect).toHaveBeenCalledWith(null, 'text');
  });

  it('all swatches display "A" text in both modes', () => {
    const { element } = createColorPicker(createOptions());

    const bgSwatches = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-"]'));

    for (const swatch of bgSwatches) {
      expect(swatch.textContent).toBe('A');
    }

    const bgTab = element.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

    bgTab?.click();

    const textSwatches = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-"]'));

    for (const swatch of textSwatches) {
      expect(swatch.textContent).toBe('A');
    }
  });

  it('text-mode swatches have a neutral background', () => {
    const { element } = createColorPicker(createOptions());
    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    expect(swatch?.style.backgroundColor).toBeTruthy();
    expect(swatch?.style.color).toBeTruthy();
  });

  it('bg-mode swatches show preset background color', () => {
    const { element } = createColorPicker(createOptions({ defaultModeIndex: 1 }));
    const swatch = element.querySelector<HTMLElement>(
      `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
    );

    expect(swatch?.style.backgroundColor).toBeTruthy();
  });

  it('teal swatch click calls onColorSelect with teal text color', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const swatch = element.querySelector<HTMLElement>(
      '[data-blok-testid="test-swatch-teal"]'
    );

    expect(swatch).not.toBeNull();
    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith('#2b9a8f', 'text');
  });

  it('teal swatch click in bg mode calls onColorSelect with teal bg color', () => {
    const onColorSelect = vi.fn();
    const { element } = createColorPicker(createOptions({ onColorSelect }));

    const bgTab = element.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

    bgTab?.click();

    const swatch = element.querySelector<HTMLElement>(
      '[data-blok-testid="test-swatch-teal"]'
    );

    expect(swatch).not.toBeNull();
    swatch?.click();

    expect(onColorSelect).toHaveBeenCalledWith('#e4f5f3', 'bg');
  });

  describe('active color indicator (bug #4)', () => {
    it('returns an object with setActiveColor method', () => {
      const handle = createColorPicker(createOptions());

      expect(handle).toHaveProperty('setActiveColor');
      expect(typeof handle.setActiveColor).toBe('function');
    });

    it('highlights the matching swatch with a ring when setActiveColor is called', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const activeSwatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
      );

      expect(activeSwatch?.className).toContain('ring-black/30');
    });

    it('does not highlight non-matching swatches', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const inactiveSwatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-${COLOR_PRESETS[1].name}"]`
      );

      expect(inactiveSwatch?.className).not.toContain('ring-black/30');
    });

    it('clears active indicator when setActiveColor is called with null', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');
      setActiveColor(null, 'text');

      const swatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
      );

      expect(swatch?.className).not.toContain('ring-black/30');
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
        '[data-blok-testid="test-swatch-red"]'
      );

      expect(redSwatch?.className).toContain('ring-black/30');
    });

    it('does not highlight non-matching swatches when rgb color is used', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('rgb(212, 76, 71)', 'text');

      const graySwatch = element.querySelector<HTMLElement>(
        '[data-blok-testid="test-swatch-gray"]'
      );

      expect(graySwatch?.className).not.toContain('ring-black/30');
    });

    it('highlights the matching swatch in bg mode with rgb() format', () => {
      const { element, setActiveColor } = createColorPicker(
        createOptions({ defaultModeIndex: 1 })
      );

      /**
       * '#fdebec' (the "red" preset bg color) is rgb(253, 235, 236).
       */
      setActiveColor('rgb(253, 235, 236)', 'bg');

      const redSwatch = element.querySelector<HTMLElement>(
        '[data-blok-testid="test-swatch-red"]'
      );

      expect(redSwatch?.className).toContain('ring-black/30');
    });
  });

  describe('tab state reset on reopen (bug #11)', () => {
    it('returns an object with a reset method', () => {
      const handle = createColorPicker(createOptions());

      expect(handle).toHaveProperty('reset');
      expect(typeof handle.reset).toBe('function');
    });

    it('resets tab to defaultModeIndex when reset is called after switching tabs', () => {
      const { element, reset } = createColorPicker(createOptions());

      const bgTab = element.querySelector<HTMLElement>('[data-blok-testid="test-tab-bg"]');

      bgTab?.click();
      expect(bgTab?.className).toContain('font-medium');

      reset();

      const textTab = element.querySelector('[data-blok-testid="test-tab-text"]');

      expect(textTab?.className).toContain('font-medium');
      expect(bgTab?.className).not.toContain('font-medium');
    });
  });

  describe('setActiveColor auto-switches tab to match modeKey (bug #6)', () => {
    it('switches to the bg tab when setActiveColor is called with bg modeKey', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      /** Picker starts on text tab (index 0). Calling setActiveColor with 'bg' mode
       *  should switch to the bg tab automatically. */
      setActiveColor(COLOR_PRESETS[0].bg, 'bg');

      const textTab = element.querySelector('[data-blok-testid="test-tab-text"]');
      const bgTab = element.querySelector('[data-blok-testid="test-tab-bg"]');

      expect(bgTab?.className).toContain('font-medium');
      expect(textTab?.className).not.toContain('font-medium');
    });

    it('switches to the text tab when setActiveColor is called with text modeKey from bg tab', () => {
      const { element, setActiveColor } = createColorPicker(
        createOptions({ defaultModeIndex: 1 })
      );

      /** Picker starts on bg tab (index 1). Calling setActiveColor with 'text' mode
       *  should switch to the text tab. */
      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const textTab = element.querySelector('[data-blok-testid="test-tab-text"]');
      const bgTab = element.querySelector('[data-blok-testid="test-tab-bg"]');

      expect(textTab?.className).toContain('font-medium');
      expect(bgTab?.className).not.toContain('font-medium');
    });

    it('highlights the correct swatch after auto-switching tabs', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      /** Start on text tab, switch to bg via setActiveColor and verify the swatch is active */
      setActiveColor(COLOR_PRESETS[0].bg, 'bg');

      const swatch = element.querySelector<HTMLElement>(
        `[data-blok-testid="test-swatch-${COLOR_PRESETS[0].name}"]`
      );

      expect(swatch?.className).toContain('ring-black/30');
    });

    it('does not switch tabs when modeKey matches the current tab', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      /** Already on text tab, calling with 'text' modeKey should keep it there */
      setActiveColor(COLOR_PRESETS[0].text, 'text');

      const textTab = element.querySelector('[data-blok-testid="test-tab-text"]');

      expect(textTab?.className).toContain('font-medium');
    });
  });

  it('uses testIdPrefix for all test IDs', () => {
    const { element } = createColorPicker(createOptions({ testIdPrefix: 'custom' }));

    expect(element.getAttribute('data-blok-testid')).toBe('custom-picker');
    expect(element.querySelector('[data-blok-testid="custom-tab-text"]')).not.toBeNull();
    expect(element.querySelector('[data-blok-testid="custom-grid"]')).not.toBeNull();
    expect(element.querySelector('[data-blok-testid="custom-default-btn"]')).not.toBeNull();
    expect(element.querySelector(`[data-blok-testid="custom-swatch-${COLOR_PRESETS[0].name}"]`)).not.toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getByRole, queryByAttribute, queryByRole } from '@testing-library/dom';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import type { ColorPickerOptions } from '../../../../src/components/shared/color-picker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import type { I18n } from '../../../../types/api';

const mockI18n: I18n = {
  t: (key: string) => key,
  has: () => false,
  getEnglishTranslation: () => '',
  getLocale: () => 'en',
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

const getSwatch = (root: HTMLElement, testId: string): HTMLElement => {
  const found = queryByAttribute('data-blok-testid', root, testId);

  if (!(found instanceof HTMLElement)) {
    throw new Error(`No element with test id ${testId}`);
  }

  return found;
};

const getTile = (root: HTMLElement, testId: string): HTMLElement => {
  const tile = getSwatch(root, testId).firstElementChild;

  if (!(tile instanceof HTMLElement)) {
    throw new Error(`No tile in ${testId}`);
  }

  return tile;
};

/**
 * True when the row shows its checkmark and reports itself pressed.
 */
const isPicked = (root: HTMLElement, testId: string): boolean => {
  const row = getSwatch(root, testId);
  const check = row.lastElementChild;

  if (!(check instanceof HTMLElement) || check.querySelector('svg') === null) {
    throw new Error(`No checkmark in ${testId}`);
  }

  const pressed = row.getAttribute('aria-pressed') === 'true';

  if (pressed === check.hidden) {
    throw new Error(`aria-pressed and the checkmark disagree in ${testId}`);
  }

  return pressed;
};

describe('createColorPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('blok-recent-colors');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    localStorage.removeItem('blok-recent-colors');
  });

  it('renders two sections — one per mode', () => {
    const { element } = createColorPicker(createOptions());
    const sections = element.querySelectorAll('[data-blok-testid^="test-section-"]');

    expect(sections).toHaveLength(2);
    expect(sections[0].getAttribute('data-blok-testid')).toBe('test-section-text');
    expect(sections[1].getAttribute('data-blok-testid')).toBe('test-section-bg');
  });

  it('shows every mode section at once, each labelled as a group', () => {
    const { element } = createColorPicker(createOptions());

    document.body.appendChild(element);
    expect(getByRole(element, 'group', { name: 'label.text' })).toBeVisible();
    expect(getByRole(element, 'group', { name: 'tools.colorPicker.backgroundColor' })).toBeVisible();
    expect(queryByRole(element, 'tab')).toBeNull();
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

  it('text-mode tiles display "A", bg-mode tiles do not', () => {
    const { element } = createColorPicker(createOptions());

    for (const name of ['default', ...COLOR_PRESETS.map((preset) => preset.name)]) {
      expect(getTile(element, `test-swatch-text-${name}`).classList.contains("before:content-['A']")).toBe(true);
      expect(getTile(element, `test-swatch-bg-${name}`).textContent).toBe('');
    }
  });

  it('text-mode tiles put the preset ink on the popover surface', () => {
    const { element } = createColorPicker(createOptions());
    const tile = getTile(element, `test-swatch-text-${COLOR_PRESETS[0].name}`);
    const defaultTile = getTile(element, 'test-swatch-text-default');

    expect(tile).toHaveStyle({ color: COLOR_PRESETS[0].text });
    expect(tile.style.backgroundColor).toBe('var(--blok-popover-bg)');
    expect(defaultTile.style.color).toBe('var(--blok-text-primary)');
    expect(defaultTile.style.backgroundColor).toBe('var(--blok-popover-bg)');
  });

  it('bg-mode tiles show the preset background color', () => {
    const { element } = createColorPicker(createOptions());
    const tile = getTile(element, `test-swatch-bg-${COLOR_PRESETS[0].name}`);
    const defaultTile = getTile(element, 'test-swatch-bg-default');

    expect(tile).toHaveStyle({ backgroundColor: COLOR_PRESETS[0].bg });
    expect(tile.style.color).toBe('');
    expect(defaultTile.style.backgroundColor).toBe('var(--blok-swatch-neutral-bg)');
  });

  it('keeps the paint on the tile, not on the row button', () => {
    const { element } = createColorPicker(createOptions());

    for (const testId of [`test-swatch-text-${COLOR_PRESETS[0].name}`, `test-swatch-bg-${COLOR_PRESETS[0].name}`]) {
      const row = getSwatch(element, testId);

      expect(row.style.color).toBe('');
      expect(row.style.backgroundColor).toBe('');
    }
  });

  it('teal swatch does not exist', () => {
    const { element } = createColorPicker(createOptions());

    expect(element.querySelector('[data-blok-testid="test-swatch-text-teal"]')).toBeNull();
    expect(element.querySelector('[data-blok-testid="test-swatch-bg-teal"]')).toBeNull();
  });

  describe('active color indicator', () => {
    it('returns an object with setActiveColor method', () => {
      const handle = createColorPicker(createOptions());

      expect(handle).toHaveProperty('setActiveColor');
      expect(typeof handle.setActiveColor).toBe('function');
    });

    it('checks the matching row in the correct section when setActiveColor is called', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      expect(isPicked(element, `test-swatch-text-${COLOR_PRESETS[0].name}`)).toBe(true);
    });

    it('does not check non-matching rows in the same section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      expect(isPicked(element, `test-swatch-text-${COLOR_PRESETS[1].name}`)).toBe(false);
    });

    it('does not check rows in the other section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      expect(isPicked(element, `test-swatch-bg-${COLOR_PRESETS[0].name}`)).toBe(false);
    });

    it('clears the checkmark on preset rows when setActiveColor is called with null', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');
      setActiveColor(null, 'text');

      expect(isPicked(element, `test-swatch-text-${COLOR_PRESETS[0].name}`)).toBe(false);
    });

    it('default row in each section shows the checkmark when no color is selected (initial state)', () => {
      const { element } = createColorPicker(createOptions());

      expect(isPicked(element, 'test-swatch-text-default')).toBe(true);
      expect(isPicked(element, 'test-swatch-bg-default')).toBe(true);
    });

    it('default row in a section shows the checkmark after setActiveColor is called with null for that section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');
      setActiveColor(null, 'text');

      expect(isPicked(element, 'test-swatch-text-default')).toBe(true);
    });

    it('default row in active section does not show the checkmark when a color row is selected', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      expect(isPicked(element, 'test-swatch-text-default')).toBe(false);
    });

    it('default row in unrelated section keeps its checkmark when another section has a color selected', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      expect(isPicked(element, 'test-swatch-bg-default')).toBe(true);
    });

    it('checks the row in the bg section when setActiveColor is called with bg modeKey', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].bg, 'bg');

      expect(isPicked(element, `test-swatch-bg-${COLOR_PRESETS[0].name}`)).toBe(true);
    });

    it('checks the row in the text section when setActiveColor is called with text modeKey', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(COLOR_PRESETS[0].text, 'text');

      expect(isPicked(element, `test-swatch-text-${COLOR_PRESETS[0].name}`)).toBe(true);
    });
  });

  describe('active color indicator with rgb format (bug #1)', () => {
    it('checks the matching row when setActiveColor receives an rgb() string', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      /**
       * '#d44c47' (the "red" preset text color) is rgb(212, 76, 71).
       * DOM APIs like style.getPropertyValue('color') return rgb() format,
       * so setActiveColor must match rgb against hex presets.
       */
      setActiveColor('rgb(212, 76, 71)', 'text');

      expect(isPicked(element, 'test-swatch-text-red')).toBe(true);
    });

    it('does not check non-matching rows when rgb color is used', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('rgb(212, 76, 71)', 'text');

      expect(isPicked(element, 'test-swatch-text-gray')).toBe(false);
    });

    it('checks the matching row in bg section with rgb() format', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      /**
       * '#fdebec' (the "red" preset bg color) is rgb(253, 235, 236).
       */
      setActiveColor('rgb(253, 235, 236)', 'bg');

      expect(isPicked(element, 'test-swatch-bg-red')).toBe(true);
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

      expect(isPicked(element, `test-swatch-text-${COLOR_PRESETS[0].name}`)).toBe(false);
      expect(isPicked(element, 'test-swatch-text-default')).toBe(true);
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

    it('checks the active row using dark preset colors', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('#9b9b9b', 'text');

      expect(isPicked(element, 'test-swatch-text-gray')).toBe(true);
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

  describe('label templates for locale-aware word order', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const makeI18n = (translations: Record<string, string>): I18n => ({
      t: (key: string) => translations[key] ?? key,
      has: () => false,
      getEnglishTranslation: () => '',
      getLocale: () => 'en',
    });

    it('calls i18n.t with tools.colorPicker.defaultSwatchLabel for the default swatch label', () => {
      const tSpy = vi.fn().mockReturnValue('');
      const i18n: I18n = { t: tSpy, has: () => false, getEnglishTranslation: () => '', getLocale: () => 'en' };

      createColorPicker(createOptions({ i18n }));

      expect(tSpy).toHaveBeenCalledWith('tools.colorPicker.defaultSwatchLabel');
    });

    it('calls i18n.t with tools.colorPicker.colorSwatchLabel for a color swatch label', () => {
      const tSpy = vi.fn().mockReturnValue('');
      const i18n: I18n = { t: tSpy, has: () => false, getEnglishTranslation: () => '', getLocale: () => 'en' };

      createColorPicker(createOptions({ i18n }));

      expect(tSpy).toHaveBeenCalledWith('tools.colorPicker.colorSwatchLabel');
    });

    it('default swatch label uses {default} {mode} template for English word order', () => {
      const i18n = makeI18n({
        'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
        'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
        'tools.marker.default': 'Default',
        'label.text': 'Text',
        'label.bg': 'Background',
      });

      const { element } = createColorPicker(createOptions({ i18n }));

      expect(getSwatch(element, 'test-swatch-text-default')).toHaveAttribute('aria-label', 'Default text');
    });

    it('default swatch label reverses word order with {mode} {default} template (Russian-style)', () => {
      const i18n = makeI18n({
        'tools.colorPicker.defaultSwatchLabel': '{mode} {default}',
        'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
        'tools.marker.default': 'по умолчанию',
        'label.text': 'Текст',
        'label.bg': 'Фон',
      });

      const { element } = createColorPicker(createOptions({ i18n }));

      expect(getSwatch(element, 'test-swatch-text-default')).toHaveAttribute('aria-label', 'Текст по умолчанию');
    });

    it('color swatch label reverses word order with {mode} {color} template (Vietnamese-style)', () => {
      const i18n = makeI18n({
        'tools.colorPicker.defaultSwatchLabel': '{mode} {default}',
        'tools.colorPicker.colorSwatchLabel': '{mode} {color}',
        'tools.marker.default': 'mặc định',
        'label.text': 'Chữ',
        'label.bg': 'Nền',
        'tools.colorPicker.color.gray': 'Xám',
      });

      const { element } = createColorPicker(createOptions({ i18n }));

      expect(getSwatch(element, 'test-swatch-text-gray')).toHaveAttribute('aria-label', 'Chữ Xám');
    });
  });

  describe('recently used section', () => {
    beforeEach(() => {
      localStorage.removeItem('blok-recent-colors');
    });

    afterEach(() => {
      localStorage.removeItem('blok-recent-colors');
    });

    const clickSwatch = (element: HTMLElement, testId: string): void => {
      element.querySelector<HTMLElement>(`[data-blok-testid="${testId}"]`)?.click();
    };

    it('does not render a recent section when no colors have been used', () => {
      const { element } = createColorPicker(createOptions());

      expect(element.querySelector('[data-blok-testid="test-section-recent"]')).toBeNull();
    });

    it('leaves no visible empty spacer child when there are no recents (would add a stray grid gap)', () => {
      const { element } = createColorPicker(createOptions());

      const visibleEmptyChildren = Array.from(element.children).filter(
        (child) => child.childElementCount === 0 && !(child as HTMLElement).hidden
      );

      expect(visibleEmptyChildren).toHaveLength(0);
    });

    it('shows a recent section in a new picker after a color swatch was clicked', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const second = createColorPicker(createOptions());

      expect(second.element.querySelector('[data-blok-testid="test-section-recent"]')).not.toBeNull();
      expect(second.element.querySelector('[data-blok-testid="test-swatch-recent-text-red"]')).not.toBeNull();
    });

    it('shows recently used colors in a fresh picker', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const second = createColorPicker(createOptions());

      document.body.appendChild(second.element);

      expect(queryByAttribute('data-blok-testid', second.element, 'test-swatch-recent-text-red')).toBeVisible();
    });

    it('shows at most 8 recent swatches, most recent first', () => {
      const first = createColorPicker(createOptions());
      const names = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

      for (const name of names) {
        clickSwatch(first.element, `test-swatch-text-${name}`);
      }

      const { element } = createColorPicker(createOptions());
      const recents = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-recent-"]'));

      expect(recents.map((recent) => recent.getAttribute('data-blok-testid'))).toEqual(
        names.slice(1).reverse().map((name) => `test-swatch-recent-text-${name}`)
      );
    });

    it('does not duplicate an entry when the same color+mode is clicked twice', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');
      clickSwatch(first.element, 'test-swatch-text-blue');
      clickSwatch(first.element, 'test-swatch-text-red');

      const { element } = createColorPicker(createOptions());
      const recents = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-recent-"]'));

      expect(recents).toHaveLength(2);
      expect(recents[0].getAttribute('data-blok-testid')).toBe('test-swatch-recent-text-red');
    });

    it('tracks the same preset name separately per mode (text vs bg)', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');
      clickSwatch(first.element, 'test-swatch-bg-red');

      const { element } = createColorPicker(createOptions());

      expect(element.querySelector('[data-blok-testid="test-swatch-recent-text-red"]')).not.toBeNull();
      expect(element.querySelector('[data-blok-testid="test-swatch-recent-bg-red"]')).not.toBeNull();
    });

    it('does not record default swatch clicks', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-default');
      clickSwatch(first.element, 'test-swatch-bg-default');

      const { element } = createColorPicker(createOptions());

      expect(localStorage.getItem('blok-recent-colors')).toBeNull();
      expect(element.querySelector('[data-blok-testid="test-section-recent"]')).toBeNull();
    });

    it('clicking a recent text swatch calls onColorSelect with the text color and text mode key', () => {
      const onColorSelect = vi.fn();
      const redText = COLOR_PRESETS.find((p) => p.name === 'red')?.text;

      clickSwatch(createColorPicker(createOptions()).element, 'test-swatch-text-red');

      const { element } = createColorPicker(createOptions({ onColorSelect }));

      clickSwatch(element, 'test-swatch-recent-text-red');

      expect(onColorSelect).toHaveBeenCalledTimes(1);
      expect(onColorSelect).toHaveBeenCalledWith(redText, 'text');
    });

    it('clicking a recent bg swatch calls onColorSelect with the bg color and bg mode key', () => {
      const onColorSelect = vi.fn();
      const blueBg = COLOR_PRESETS.find((p) => p.name === 'blue')?.bg;

      clickSwatch(createColorPicker(createOptions()).element, 'test-swatch-bg-blue');

      const { element } = createColorPicker(createOptions({ onColorSelect }));

      clickSwatch(element, 'test-swatch-recent-bg-blue');

      expect(onColorSelect).toHaveBeenCalledTimes(1);
      expect(onColorSelect).toHaveBeenCalledWith(blueBg, 'bg');
    });

    it('recent text tiles show "A" in the preset ink, recent bg tiles show the fill and no letter', () => {
      const first = createColorPicker(createOptions());
      const red = COLOR_PRESETS.find((p) => p.name === 'red');
      const blue = COLOR_PRESETS.find((p) => p.name === 'blue');

      clickSwatch(first.element, 'test-swatch-text-red');
      clickSwatch(first.element, 'test-swatch-bg-blue');

      const { element } = createColorPicker(createOptions());
      const textTile = getTile(element, 'test-swatch-recent-text-red');
      const bgTile = getTile(element, 'test-swatch-recent-bg-blue');

      expect(textTile.classList.contains("before:content-['A']")).toBe(true);
      expect(textTile).toHaveStyle({ color: red?.text });
      expect(bgTile.textContent).toBe('');
      expect(bgTile).toHaveStyle({ backgroundColor: blue?.bg });
      expect(getSwatch(element, 'test-swatch-recent-text-red').style.color).toBe('');
      expect(getSwatch(element, 'test-swatch-recent-bg-blue').style.backgroundColor).toBe('');
    });

    it('resolves recent swatch colors against the active theme presets', () => {
      const light = createColorPicker(createOptions());

      clickSwatch(light.element, 'test-swatch-text-gray');

      document.documentElement.setAttribute('data-blok-theme', 'dark');

      try {
        const onColorSelect = vi.fn();
        const dark = createColorPicker(createOptions({ onColorSelect }));

        clickSwatch(dark.element, 'test-swatch-recent-text-gray');

        expect(onColorSelect).toHaveBeenCalledWith('#9b9b9b', 'text');
      } finally {
        document.documentElement.removeAttribute('data-blok-theme');
      }
    });

    it('persists recents in localStorage under blok-recent-colors', () => {
      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      const stored: unknown = JSON.parse(localStorage.getItem('blok-recent-colors') ?? 'null');

      expect(stored).toEqual([{ name: 'red', field: 'text' }]);
    });

    it('ignores corrupt localStorage content without crashing', () => {
      localStorage.setItem('blok-recent-colors', 'not-json{');

      const { element } = createColorPicker(createOptions());

      expect(element.querySelector('[data-blok-testid="test-section-recent"]')).toBeNull();
    });

    it('titles the recent section via the tools.colorPicker.recentlyUsed i18n key when translated', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const i18n: I18n = {
        t: (key: string) => (key === 'tools.colorPicker.recentlyUsed' ? 'Récemment utilisées' : key),
        has: (key: string) => key === 'tools.colorPicker.recentlyUsed',
        getEnglishTranslation: () => '',
        getLocale: () => 'en',
      };
      const second = createColorPicker(createOptions({ i18n }));
      const section = second.element.querySelector('[data-blok-testid="test-section-recent"]');

      expect(section?.textContent).toContain('Récemment utilisées');
    });

    it('tolerates an i18n object without has() — swatch clicks still record and select', () => {
      const onColorSelect = vi.fn();
      const partialI18n = { t: (key: string) => key } as unknown as I18n;
      const { element } = createColorPicker(createOptions({ i18n: partialI18n, onColorSelect }));

      clickSwatch(element, 'test-swatch-text-red');

      expect(onColorSelect).toHaveBeenCalledWith(COLOR_PRESETS.find((p) => p.name === 'red')?.text, 'text');

      const next = createColorPicker(createOptions({ i18n: partialI18n }));

      expect(next.element.querySelector('[data-blok-testid="test-swatch-recent-text-red"]')).not.toBeNull();
    });

    it('uses dictionary resolution without a hard-coded English fallback', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const i18n: I18n = {
        t: (key: string) => (key === 'tools.colorPicker.recentlyUsed' ? 'Localized recent colors' : key),
        has: () => false,
        getEnglishTranslation: () => '',
        getLocale: () => 'en',
      };
      const second = createColorPicker(createOptions({ i18n }));
      const section = second.element.querySelector('[data-blok-testid="test-section-recent"]');

      expect(section?.textContent).toContain('Localized recent colors');
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

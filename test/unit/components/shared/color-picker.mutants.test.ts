import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import { createColorPicker, getActivePresets } from '../../../../src/components/shared/color-picker';
import type { ColorPickerOptions } from '../../../../src/components/shared/color-picker';
import { COLOR_PRESETS, COLOR_PRESETS_DARK } from '../../../../src/components/shared/color-presets';
import type { ColorPreset } from '../../../../src/components/shared/color-presets';
import type { I18n } from '../../../../types/api';
import * as tooltipModule from '../../../../src/components/utils/tooltip';

const RECENT_KEY = 'blok-recent-colors';
const NEUTRAL_BG = 'var(--blok-swatch-neutral-bg)';
const TEXT_PRIMARY = 'var(--blok-text-primary)';
const RING = 'ring-2 ring-swatch-ring-hover';

const TRANSLATIONS: Record<string, string> = {
  'tools.marker.default': 'Default',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.colorPicker.recentlyUsed': 'Recently used',
  'tools.colorPicker.color.gray': 'Gray',
  'tools.colorPicker.color.brown': 'Brown',
  'tools.colorPicker.color.blue': 'Blue',
  'tools.colorPicker.color.red': 'Red',
  'label.text': 'Text',
  'label.bg': 'Background',
};

const makeI18n = (overrides: Record<string, string> = {}): I18n => ({
  t: (key: string) => ({ ...TRANSLATIONS, ...overrides })[key] ?? key,
  has: () => false,
  getEnglishTranslation: () => '',
  getLocale: () => 'en',
});

const createOptions = (overrides: Partial<ColorPickerOptions> = {}): ColorPickerOptions => ({
  i18n: makeI18n(),
  testIdPrefix: 'test',
  modes: [
    { key: 'text', labelKey: 'label.text', presetField: 'text' },
    { key: 'bg', labelKey: 'label.bg', presetField: 'bg' },
  ],
  onColorSelect: vi.fn(),
  ...overrides,
});

const byTestId = (root: HTMLElement, testId: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`[data-blok-testid="${testId}"]`);

  if (found === null) {
    throw new Error(`no element with data-blok-testid="${testId}"`);
  }

  return found;
};

const preset = (name: string): ColorPreset => {
  const found = COLOR_PRESETS.find((entry) => entry.name === name);

  if (found === undefined) {
    throw new Error(`no preset named ${name}`);
  }

  return found;
};

const darkPreset = (name: string): ColorPreset => {
  const found = COLOR_PRESETS_DARK.find((entry) => entry.name === name);

  if (found === undefined) {
    throw new Error(`no dark preset named ${name}`);
  }

  return found;
};

/** jsdom normalizes hex colors to `rgb(r, g, b)` on read-back. */
const rgbOf = (hex: string): string => {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => parseInt(part, 16));

  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
};

const installMatchMedia = (dark: boolean): void => {
  window.matchMedia = ((query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    media: query,
  })) as unknown as typeof window.matchMedia;
};

const removeMatchMedia = (): void => {
  window.matchMedia = undefined as unknown as typeof window.matchMedia;
};

const seedRecents = (value: unknown): void => {
  localStorage.setItem(RECENT_KEY, JSON.stringify(value));
};

const clickSwatch = (element: HTMLElement, testId: string): void => {
  byTestId(element, testId).click();
};

describe('color-picker mutant kills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(RECENT_KEY);
    document.documentElement.removeAttribute('data-blok-theme');
    removeMatchMedia();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    localStorage.removeItem(RECENT_KEY);
    document.documentElement.removeAttribute('data-blok-theme');
    removeMatchMedia();
  });

  describe('getActivePresets theme resolution', () => {
    it('returns the dark palette when the document declares data-blok-theme="dark"', () => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');

      expect(getActivePresets()).toBe(COLOR_PRESETS_DARK);
    });

    it('returns the light palette for an explicit data-blok-theme="light"', () => {
      document.documentElement.setAttribute('data-blok-theme', 'light');

      expect(getActivePresets()).toBe(COLOR_PRESETS);
    });

    it('keeps the light palette when the theme is explicitly light even if the OS prefers dark', () => {
      document.documentElement.setAttribute('data-blok-theme', 'light');
      installMatchMedia(true);

      expect(getActivePresets()).toBe(COLOR_PRESETS);
    });

    it('falls back to the dark palette when the OS prefers dark and no theme is declared', () => {
      installMatchMedia(true);

      expect(getActivePresets()).toBe(COLOR_PRESETS_DARK);
    });

    it('falls back to the light palette when the OS does not prefer dark', () => {
      installMatchMedia(false);

      expect(getActivePresets()).toBe(COLOR_PRESETS);
    });

    it('renders a picker against the light palette when no matchMedia API exists', () => {
      const onColorSelect = vi.fn();
      const { element } = createColorPicker(createOptions({ onColorSelect }));

      clickSwatch(element, 'test-swatch-text-gray');

      expect(onColorSelect).toHaveBeenCalledWith(preset('gray').text, 'text');
    });
  });

  describe('theme-aware swatch colors', () => {
    it('uses the dark preset values for swatch clicks when the theme is dark', () => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const onColorSelect = vi.fn();
      const { element } = createColorPicker(createOptions({ onColorSelect }));

      clickSwatch(element, 'test-swatch-bg-gray');

      expect(onColorSelect).toHaveBeenCalledWith(darkPreset('gray').bg, 'bg');
    });

    it('paints bg swatches with the light charcoal label color', () => {
      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-bg-gray');

      expect(swatch.style.color).toBe('rgb(55, 53, 47)');
    });

    it('paints text swatches with the preset text color', () => {
      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-text-gray');

      expect(swatch.style.color).toBe(rgbOf(preset('gray').text));
    });

    it('paints the bg swatch label with the dark preset text color in dark mode', () => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-bg-gray').style.color).toBe(rgbOf(darkPreset('gray').text));
    });

    it('falls back to the neutral background for the default swatch in each section', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-text-default').style.backgroundColor).toBe(NEUTRAL_BG);
      expect(byTestId(element, 'test-swatch-bg-default').style.backgroundColor).toBe(NEUTRAL_BG);
    });

    it('uses the text-primary variable as the default swatch label color', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-text-default').style.color).toBe(TEXT_PRIMARY);
    });

    it('uses the text-primary variable for the default bg swatch label in dark mode', () => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-bg-default').style.color).toBe(TEXT_PRIMARY);
    });

    it('paints text swatches with the neutral swatch background', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-text-red').style.backgroundColor).toBe(NEUTRAL_BG);
    });
  });

  describe('picker structure', () => {
    it('marks the wrapper with the prefixed picker test id and layout classes', () => {
      const { element } = createColorPicker(createOptions());

      expect(element.getAttribute('data-blok-testid')).toBe('test-picker');
      expect(element.className).toContain('flex flex-col gap-3 p-2');
    });

    it('generates tab ids under the blok-color-picker- prefix', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-tab-text').id).toMatch(/^blok-color-picker-.+-tab-0$/);
      expect(byTestId(element, 'test-tab-bg').id).toMatch(/^blok-color-picker-.+-tab-1$/);
    });

    it('marks the tab list with role=tablist and its layout classes', () => {
      const { element } = createColorPicker(createOptions());
      const tabList = element.children[0];

      expect(tabList.getAttribute('role')).toBe('tablist');
      expect(tabList.className).toBe('grid grid-cols-2 gap-1 rounded-lg bg-item-hover-bg p-1');
    });

    it('gives every swatch the shared swatch class contract', () => {
      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-text-red');
      const classes = swatch.className;

      expect(classes).toContain('w-10 h-10 rounded-lg cursor-pointer border-none outline-hidden');
      expect(classes).toContain('flex items-center justify-center text-sm font-semibold');
      expect(classes).toContain('ring-inset hover:ring-2 hover:ring-swatch-ring-hover aria-pressed:ring-swatch-ring-active');
      expect(classes).toContain('focus-visible:ring-2 focus-visible:ring-text-secondary aria-pressed:focus-visible:ring-text-secondary');
      expect(classes).toContain('transition-[box-shadow,transform,scale]');
      expect(classes).toContain('duration-150');
      expect(classes).toContain('motion-reduce:transition-none motion-reduce:active:scale-100');
    });

    it('gives every tab the shared tab class contract', () => {
      const { element } = createColorPicker(createOptions());
      const classes = byTestId(element, 'test-tab-text').className;

      expect(classes).toContain('min-w-0');
      expect(classes).toContain('py-1.5');
      expect(classes).toContain('outline-hidden');
      expect(classes).toContain('bg-transparent');
      expect(classes).toContain('text-text-secondary');
      expect(classes).toContain('transition-colors');
      expect(classes).toContain('duration-150');
      expect(classes).toContain('motion-reduce:transition-none');
    });

    it('wires aria-selected styling classes on the tabs', () => {
      const classes = byTestId(createColorPicker(createOptions()).element, 'test-tab-text').className;

      expect(classes).toContain('aria-selected:bg-popover-bg');
      expect(classes).toContain('hover:text-text-primary');
      expect(classes).toContain('focus-visible:ring-2');
    });

    it('renders the selected preview row with its layout classes', () => {
      const { element } = createColorPicker(createOptions());
      const preview = byTestId(element, 'test-preview-text');
      const selectedRow = preview.parentElement;

      expect(selectedRow?.className).toBe('flex items-center gap-2 px-0.5');
      expect(preview.className).toBe('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold');
      expect(preview.textContent).toBe('A');
      expect(preview.getAttribute('aria-hidden')).toBe('true');
    });

    it('marks the color name as a status region with its layout classes', () => {
      const { element } = createColorPicker(createOptions());
      const colorName = byTestId(element, 'test-preview-text').nextElementSibling;

      expect(colorName?.className).toBe('min-w-0 flex-1 truncate text-xs font-medium text-text-primary');
      expect(colorName?.getAttribute('role')).toBe('status');
    });

    it('renders a reset button per section with the prefixed test id', () => {
      const { element } = createColorPicker(createOptions());
      const reset = byTestId(element, 'test-reset-text');

      expect(reset.textContent).toBe('Default');
      expect(reset.className).toContain('min-h-8');
      expect(reset.className).toContain('text-text-secondary');
      expect(reset.className).toContain('hover:bg-item-hover-bg');
      expect(reset.className).toContain('outline-hidden');
      expect(reset.className).toContain('focus-visible:ring-2');
    });

    it('lays each swatch grid out as five 2.5rem columns', () => {
      const { element } = createColorPicker(createOptions());
      const grid = byTestId(element, 'test-swatch-text-red').parentElement;

      expect(grid?.className).toBe('grid gap-1.5');
      expect(grid?.style.gridTemplateColumns).toBe('repeat(5, 2.5rem)');
    });
  });

  describe('active color matching', () => {
    it('marks the default swatch active and nothing else on a fresh picker', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-text-default').className).toContain(RING);
      expect(byTestId(element, 'test-swatch-text-red').className).not.toContain(RING);
      expect(byTestId(element, 'test-swatch-text-blue').className).not.toContain(RING);
    });

    it('matches a color by all three RGB channels, never by a partial overlap', () => {
      const gray = preset('gray');

      // [r, g, b] of each entry overlaps the gray text color (#787774 = 120,119,116)
      // on exactly one or two channels — a `||` or a `true` in the channel chain
      // would light the swatch up. The last entry is the positive control.
      const cases: { color: string; matches: boolean }[] = [
        { color: 'rgb(0, 0, 0)', matches: false },
        { color: 'rgb(0, 0, 116)', matches: false },
        { color: 'rgb(0, 119, 116)', matches: false },
        { color: 'rgb(120, 0, 0)', matches: false },
        { color: 'rgb(120, 0, 116)', matches: false },
        { color: 'rgb(120, 119, 0)', matches: false },
        { color: 'rgb(120, 119, 116)', matches: true },
      ];

      for (const { color, matches } of cases) {
        const { element, setActiveColor } = createColorPicker(createOptions());

        setActiveColor(color, 'text');

        const swatch = byTestId(element, 'test-swatch-text-gray');

        expect(swatch.getAttribute('aria-pressed')).toBe(String(matches));
        expect(rgbOf(gray.text)).toBe('rgb(120, 119, 116)');
      }
    });

    it('treats an unparseable active color as matching nothing instead of throwing', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('not-a-color', 'text');

      expect(byTestId(element, 'test-swatch-text-gray').getAttribute('aria-pressed')).toBe('false');
      expect(byTestId(element, 'test-swatch-text-default').getAttribute('aria-pressed')).toBe('false');
    });

    it('matches an rgb() string against the hex presets', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('rgb(212, 76, 71)', 'text');

      expect(byTestId(element, 'test-swatch-text-red').className).toContain(RING);
      expect(byTestId(element, 'test-swatch-text-gray').className).not.toContain(RING);
    });

    it('ignores an unknown mode key without touching any section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('#123456', 'no-such-mode');

      expect(byTestId(element, 'test-swatch-text-default').className).toContain(RING);
      expect(byTestId(element, 'test-swatch-text-gray').className).not.toContain(RING);
    });
  });

  describe('preview and color name', () => {
    it('names the default entry and leaves the preview at the neutral text token when nothing is active', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-preview-text').nextElementSibling?.textContent).toBe('Default');
      expect(byTestId(element, 'test-preview-text').style.color).toBe(TEXT_PRIMARY);
      expect(byTestId(element, 'test-preview-text').style.backgroundColor).toBe(NEUTRAL_BG);
    });

    it('previews the raw active color for text mode even when it matches no preset', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('#123456', 'text');

      expect(byTestId(element, 'test-preview-text').style.color).toBe('rgb(18, 52, 86)');
      expect(byTestId(element, 'test-preview-text').style.backgroundColor).toBe(NEUTRAL_BG);
    });

    it('previews the preset text color when the active text color is a preset', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(preset('gray').text, 'text');

      expect(byTestId(element, 'test-preview-text').style.color).toBe(rgbOf(preset('gray').text));
      expect(byTestId(element, 'test-preview-text').nextElementSibling?.textContent).toBe('Gray');
    });

    it('previews the matching preset text color for a bg-mode active color', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor(preset('gray').bg, 'bg');

      expect(byTestId(element, 'test-preview-bg').style.color).toBe(rgbOf(preset('gray').text));
      expect(byTestId(element, 'test-preview-bg').style.backgroundColor).toBe(rgbOf(preset('gray').bg));
      expect(byTestId(element, 'test-preview-bg').nextElementSibling?.textContent).toBe('Gray');
    });

    it('names the default entry for a bg-mode picker with no active color', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-preview-bg').nextElementSibling?.textContent).toBe('Default');
      expect(byTestId(element, 'test-preview-bg').style.color).toBe(TEXT_PRIMARY);
      expect(byTestId(element, 'test-preview-bg').style.backgroundColor).toBe(NEUTRAL_BG);
    });
  });

  describe('section visibility', () => {
    it('hides the inactive panel and keeps the active one laid out', () => {
      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-section-text').hidden).toBe(false);
      expect(byTestId(element, 'test-section-text').className).toContain('flex flex-col gap-3');
      expect(byTestId(element, 'test-section-text').className).not.toContain('hidden');
      expect(byTestId(element, 'test-section-bg').hidden).toBe(true);
      expect(byTestId(element, 'test-section-bg').className).toContain('hidden');
    });

    it('swaps visibility and aria-selected when the other tab is activated', () => {
      const { element } = createColorPicker(createOptions());

      byTestId(element, 'test-tab-bg').click();

      expect(byTestId(element, 'test-section-bg').hidden).toBe(false);
      expect(byTestId(element, 'test-section-bg').className).toContain('flex flex-col gap-3');
      expect(byTestId(element, 'test-section-text').className).toContain('hidden');
      expect(byTestId(element, 'test-tab-bg').getAttribute('aria-selected')).toBe('true');
      expect(byTestId(element, 'test-tab-text').getAttribute('aria-selected')).toBe('false');
      expect(byTestId(element, 'test-tab-bg').tabIndex).toBe(0);
      expect(byTestId(element, 'test-tab-text').tabIndex).toBe(-1);
    });

    it('resets every section to default on reset()', () => {
      const { element, setActiveColor, reset } = createColorPicker(createOptions());

      setActiveColor(preset('red').text, 'text');
      reset();

      expect(byTestId(element, 'test-swatch-text-red').getAttribute('aria-pressed')).toBe('false');
      expect(byTestId(element, 'test-swatch-text-default').getAttribute('aria-pressed')).toBe('true');
      expect(byTestId(element, 'test-preview-text').nextElementSibling?.textContent).toBe('Default');
    });
  });

  describe('recently used storage', () => {
    it('records a picked preset under the shared storage key', () => {
      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')).toStrictEqual([{ name: 'red', field: 'text' }]);
    });

    it('drops a non-array storage payload instead of scanning it', () => {
      seedRecents({ name: 'red', field: 'text' });

      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')).toStrictEqual([{ name: 'red', field: 'text' }]);
    });

    it('drops entries that survive a corrupt payload', () => {
      localStorage.setItem(RECENT_KEY, 'not-json{');

      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')).toStrictEqual([{ name: 'red', field: 'text' }]);
    });

    it('keeps only well-formed entries when the stored list holds junk', () => {
      seedRecents(['junk', null, { name: 5, field: 'text' }, { name: 'blue', field: 'nope' }]);

      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')).toStrictEqual([{ name: 'red', field: 'text' }]);
    });

    it('drops a stored entry whose name is not a string', () => {
      seedRecents([{ name: 5, field: 'text' }]);

      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')).toStrictEqual([{ name: 'red', field: 'text' }]);
    });

    it('drops a stored entry whose field is not an axis', () => {
      seedRecents([{ name: 'blue', field: 'nope' }]);

      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')).toStrictEqual([{ name: 'red', field: 'text' }]);
    });

    it('keeps a valid stored entry alongside the new pick, most recent first', () => {
      seedRecents([{ name: 'blue', field: 'bg' }]);

      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');

      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')).toStrictEqual([
        { name: 'red', field: 'text' },
        { name: 'blue', field: 'bg' },
      ]);
    });
  });

  describe('recently used rendering', () => {
    it('renders no recent section when the stored recents do not resolve to a preset', () => {
      seedRecents([{ name: 'no-such-preset', field: 'text' }]);

      const { element } = createColorPicker(createOptions());

      expect(element.querySelector('[data-blok-testid="test-section-recent"]')).toBeNull();
    });

    it('renders the recent section with its title and layout once a preset was picked', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const { element } = createColorPicker(createOptions());
      const section = byTestId(element, 'test-section-recent');

      expect(section.className).toBe('flex flex-col gap-2 border-t border-popover-border pt-3');
      expect(section.textContent).toContain('Recently used');
      expect(section.children[0].className).toBe('text-xs font-medium text-text-secondary px-0.5');
      expect(byTestId(element, 'test-swatch-recent-text-red').parentElement?.className).toBe('grid gap-1.5');
      expect(byTestId(element, 'test-swatch-recent-text-red').parentElement?.style.gridTemplateColumns).toBe('repeat(5, 2.5rem)');
    });

    it('paints a recent text swatch with the preset text color on the neutral background', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-recent-text-red');

      expect(swatch.textContent).toBe('A');
      expect(swatch.style.color).toBe(rgbOf(preset('red').text));
      expect(swatch.style.backgroundColor).toBe(NEUTRAL_BG);
    });

    it('paints a recent bg swatch with the preset background and the charcoal label', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-bg-blue');

      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-recent-bg-blue');

      expect(swatch.textContent).toBe('');
      expect(swatch.style.color).toBe('rgb(55, 53, 47)');
      expect(swatch.style.backgroundColor).toBe(rgbOf(preset('blue').bg));
    });

    it('resolves the recent swatch colors against the dark palette in dark mode', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-recent-text-red').style.color).toBe(rgbOf(darkPreset('red').text));
    });

    it('labels a recent bg swatch with the dark preset text color in dark mode', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-bg-blue');

      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const { element } = createColorPicker(createOptions());

      expect(byTestId(element, 'test-swatch-recent-bg-blue').style.color).toBe(rgbOf(darkPreset('blue').text));
    });

    it('skips a recent entry whose axis has no mode in this picker', () => {
      seedRecents([{ name: 'red', field: 'text' }]);

      const { element } = createColorPicker(
        createOptions({
          modes: [
            { key: 'bg', labelKey: 'label.bg', presetField: 'bg' },
            { key: 'bg-alt', labelKey: 'label.bg', presetField: 'bg' },
          ],
        })
      );

      expect(element.querySelector('[data-blok-testid="test-section-recent"]')).toBeNull();
    });

    it('re-renders the recent list when a recent swatch is clicked', () => {
      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');
      clickSwatch(element, 'test-swatch-text-blue');

      const before = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-recent-"]'));

      expect(before[0].getAttribute('data-blok-testid')).toBe('test-swatch-recent-text-blue');

      clickSwatch(element, 'test-swatch-recent-text-red');

      const after = Array.from(element.querySelectorAll('[data-blok-testid^="test-swatch-recent-"]'));

      expect(after[0].getAttribute('data-blok-testid')).toBe('test-swatch-recent-text-red');
    });

    it('selects the clicked recent color with its axis', () => {
      const onColorSelect = vi.fn();
      const { element } = createColorPicker(createOptions({ onColorSelect }));

      clickSwatch(element, 'test-swatch-bg-blue');
      onColorSelect.mockClear();
      clickSwatch(element, 'test-swatch-recent-bg-blue');

      expect(onColorSelect).toHaveBeenCalledWith(preset('blue').bg, 'bg');
      expect(byTestId(element, 'test-section-bg').hidden).toBe(false);
    });
  });

  describe('tooltip wiring', () => {
    it('wires the swatch tooltip with the top placement', () => {
      const onHoverSpy = vi.spyOn(tooltipModule, 'onHover');

      createColorPicker(createOptions());

      const call = onHoverSpy.mock.calls.find(([el]) => el.getAttribute('data-blok-testid') === 'test-swatch-text-red');

      expect(call?.[2]).toStrictEqual({ placement: 'top' });
    });

    it('wires the recent swatch tooltip with the top placement', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const onHoverSpy = vi.spyOn(tooltipModule, 'onHover');

      createColorPicker(createOptions());

      const call = onHoverSpy.mock.calls.find(
        ([el]) => el.getAttribute('data-blok-testid') === 'test-swatch-recent-text-red'
      );

      expect(call?.[2]).toStrictEqual({ placement: 'top' });
    });
  });

  describe('focus management', () => {
    it('moves focus with the arrow keys and wraps around the tab ring', () => {
      const { element } = createColorPicker(createOptions());

      document.body.appendChild(element);
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

      fireEvent.keyDown(byTestId(element, 'test-tab-text'), { key: 'ArrowLeft' });

      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-tab-bg');
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });

      fireEvent.keyDown(byTestId(element, 'test-tab-bg'), { key: 'ArrowLeft' });

      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-tab-text');
    });

    it('supports ArrowRight, Home and End on the tab list', () => {
      const { element } = createColorPicker(createOptions());

      document.body.appendChild(element);

      fireEvent.keyDown(byTestId(element, 'test-tab-text'), { key: 'ArrowRight' });
      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-tab-bg');

      fireEvent.keyDown(byTestId(element, 'test-tab-bg'), { key: 'Home' });
      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-tab-text');

      fireEvent.keyDown(byTestId(element, 'test-tab-text'), { key: 'End' });
      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-tab-bg');
    });

    it('leaves other keys to the editor', () => {
      const { element } = createColorPicker(createOptions());

      document.body.appendChild(element);
      const tab = byTestId(element, 'test-tab-text');

      tab.focus();
      fireEvent.keyDown(tab, { key: 'a' });

      expect(tab).toHaveFocus();
    });

    it('moves focus to the activated tab when the focused panel is hidden', () => {
      const { element } = createColorPicker(createOptions());

      document.body.appendChild(element);
      // Force keyboard modality so the focus move is allowed.
      fireEvent.keyDown(document.body, { key: 'Tab' });

      const reset = byTestId(element, 'test-reset-text');

      reset.focus();
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

      byTestId(element, 'test-tab-bg').click();

      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-tab-bg');
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });

      byTestId(element, 'test-tab-text').click();

      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-tab-text');
    });

    it('restores focus to the matching recent swatch after a re-render', () => {
      const { element } = createColorPicker(createOptions());

      document.body.appendChild(element);
      clickSwatch(element, 'test-swatch-text-gray');
      clickSwatch(element, 'test-swatch-text-brown');

      const gray = byTestId(element, 'test-swatch-recent-text-gray');

      gray.focus();
      expect(gray).toHaveFocus();

      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

      clickSwatch(element, 'test-swatch-recent-text-brown');

      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-swatch-recent-text-gray');
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    });

    it('survives a re-render that evicts the focused recent entry', () => {
      const uncaught: string[] = [];
      const onError = (event: Event): void => {
        uncaught.push(event.type);
      };

      window.addEventListener('error', onError);
      try {
        const { element } = createColorPicker(createOptions());

        document.body.appendChild(element);
        for (const name of ['gray', 'brown', 'orange', 'yellow', 'green']) {
          clickSwatch(element, `test-swatch-text-${name}`);
        }

        byTestId(element, 'test-swatch-recent-text-gray').focus();
        clickSwatch(element, 'test-swatch-text-blue');

        // The evicted entry has no swatch to restore focus to — dropping the
        // optional call throws an uncaught TypeError out of the click handler.
        expect(uncaught).toStrictEqual([]);
        expect(element.querySelector('[data-blok-testid="test-swatch-recent-text-gray"]')).toBeNull();
      } finally {
        window.removeEventListener('error', onError);
      }
    });

    it('reads the focused test id without a focusable element', () => {
      const { element } = createColorPicker(createOptions());

      document.body.appendChild(element);
      clickSwatch(element, 'test-swatch-text-red');

      const body = document.body;

      body.remove();

      try {
        expect(document.activeElement).toBeNull();

        clickSwatch(element, 'test-swatch-text-blue');

        expect(byTestId(element, 'test-swatch-recent-text-blue')).not.toBeNull();
      } finally {
        document.documentElement.appendChild(body);
      }
    });
  });
});

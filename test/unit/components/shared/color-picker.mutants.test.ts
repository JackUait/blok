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
const POPOVER_BG = 'var(--blok-popover-bg)';

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

const tileOf = (element: HTMLElement, testId: string): HTMLElement => {
  const tile = byTestId(element, testId).firstElementChild;

  if (!(tile instanceof HTMLElement)) {
    throw new Error(`no tile in ${testId}`);
  }

  return tile;
};

const isChecked = (element: HTMLElement, testId: string): boolean => {
  const check = byTestId(element, testId).lastElementChild;

  if (!(check instanceof HTMLElement) || check.querySelector('svg') === null) {
    throw new Error(`no check in ${testId}`);
  }

  return !check.hidden;
};

/** twMerge reorders classes, so compare them as a set. */
const classesOf = (el: Element): string[] => el.className.split(' ').sort();

const classes = (...parts: string[]): string[] => parts.join(' ').split(' ').sort();

const FOCUS_RING = 'ring-inset focus-visible:ring-2 focus-visible:ring-focus-ring';

const storedRecents = (): unknown => JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null');

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

    it('paints a text tile with a letter in the preset text color', () => {
      const { element } = createColorPicker(createOptions());
      const tile = tileOf(element, 'test-swatch-text-gray');

      expect(tile.style.color).toBe(rgbOf(preset('gray').text));
      expect(tile.classList.contains("before:content-['A']")).toBe(true);
    });

    it('paints a bg tile with the preset background and no letter', () => {
      const { element } = createColorPicker(createOptions());
      const tile = tileOf(element, 'test-swatch-bg-gray');

      expect(tile.style.backgroundColor).toBe(rgbOf(preset('gray').bg));
      expect(tile.textContent).toBe('');
      expect(tile.style.color).toBe('');
    });

    it('paints the tiles from the dark palette in dark mode', () => {
      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const { element } = createColorPicker(createOptions());

      expect(tileOf(element, 'test-swatch-text-gray').style.color).toBe(rgbOf(darkPreset('gray').text));
      expect(tileOf(element, 'test-swatch-bg-gray').style.backgroundColor).toBe(rgbOf(darkPreset('gray').bg));
    });

    it('falls back to the neutral background for the default bg tile', () => {
      const { element } = createColorPicker(createOptions());

      expect(tileOf(element, 'test-swatch-bg-default').style.backgroundColor).toBe(NEUTRAL_BG);
    });

    it('uses the text-primary variable as the default text tile color', () => {
      const { element } = createColorPicker(createOptions());

      expect(tileOf(element, 'test-swatch-text-default').style.color).toBe(TEXT_PRIMARY);
    });

    it('paints every text tile on the popover surface', () => {
      const { element } = createColorPicker(createOptions());

      expect(tileOf(element, 'test-swatch-text-red').style.backgroundColor).toBe(POPOVER_BG);
      expect(tileOf(element, 'test-swatch-text-default').style.backgroundColor).toBe(POPOVER_BG);
    });

    it('edges a text tile with the ring token and a bg tile with its own hue', () => {
      const { element } = createColorPicker(createOptions());

      expect(tileOf(element, 'test-swatch-text-red').style.boxShadow).toBe('inset 0 0 0 1px var(--blok-swatch-ring-hover)');
      expect(tileOf(element, 'test-swatch-bg-red').style.boxShadow).toBe(`inset 0 0 0 1px color-mix(in srgb, ${preset('red').text} 30%, transparent)`);
      expect(tileOf(element, 'test-swatch-bg-default').style.boxShadow).toBe(`inset 0 0 0 1px color-mix(in srgb, ${TEXT_PRIMARY} 30%, transparent)`);
    });
  });

  describe('picker structure', () => {
    it('marks the wrapper with the prefixed picker test id and the two-column grid', () => {
      const { element } = createColorPicker(createOptions());

      expect(element.getAttribute('data-blok-testid')).toBe('test-picker');
      expect(element.className).toBe('grid w-76 grid-cols-2 gap-x-2 gap-y-2.5 p-0.5 mobile:w-full');
    });

    it('titles each section with a picker-unique id under the blok-color-picker- prefix', () => {
      const { element } = createColorPicker(createOptions());
      const section = byTestId(element, 'test-section-text');
      const titleId = section.getAttribute('aria-labelledby') ?? '';
      const title = element.querySelector(`[id="${titleId}"]`);

      expect(section.getAttribute('role')).toBe('group');
      expect(titleId).toMatch(/^blok-color-picker-.+-title-0$/);
      expect(byTestId(element, 'test-section-bg').getAttribute('aria-labelledby')).toMatch(/^blok-color-picker-.+-title-1$/);
      expect(title?.className).toBe('text-xs font-medium text-text-secondary px-0.5');
      expect(title?.textContent).toBe('Text');
    });

    it('has no tab list, preview row or reset button', () => {
      const { element } = createColorPicker(createOptions());

      expect(element.querySelector('[role="tablist"]')).toBeNull();
      expect(element.querySelector('[data-blok-testid^="test-preview-"]')).toBeNull();
      expect(element.querySelector('[data-blok-testid^="test-reset-"]')).toBeNull();
    });

    it('gives every row the shared row class contract', () => {
      const { element } = createColorPicker(createOptions());
      const row = byTestId(element, 'test-swatch-text-red');

      const [tile, name, check] = Array.from(row.children);

      expect(classesOf(row)).toStrictEqual(classes(
        '-ml-1 flex h-7 w-[calc(100%+0.25rem)] items-center gap-2 px-1.5 text-left',
        'rounded-(--blok-radius-control) cursor-pointer border-none outline-hidden bg-transparent',
        'hover:bg-item-hover-bg active:bg-swatch-ring-hover',
        FOCUS_RING,
        'transition-colors duration-150 motion-reduce:transition-none'
      ));
      expect(row.getAttribute('type')).toBe('button');
      expect(row.children).toHaveLength(3);
      expect(classesOf(tile)).toStrictEqual(classes(
        'flex size-5 shrink-0 items-center justify-center rounded-(--blok-radius-control-sm)',
        'text-[13px] leading-none font-semibold',
        "before:content-['A']"
      ));
      expect(name.className).toBe('min-w-0 flex-1 truncate text-sm font-normal text-text-primary');
      expect(check.className).toBe('flex size-3.5 shrink-0 text-text-primary [&>svg]:size-full [&_path]:stroke-[2.25]');
    });

    it('stacks the rows of each column', () => {
      const { element } = createColorPicker(createOptions());

      for (const key of ['text', 'bg']) {
        const rows = byTestId(element, `test-swatch-${key}-red`).parentElement;

        expect(rows?.className).toBe('flex flex-col');
        expect(rows?.children).toHaveLength(COLOR_PRESETS.length + 1);
      }
    });
  });

  describe('active color matching', () => {
    it('checks the default row and nothing else on a fresh picker', () => {
      const { element } = createColorPicker(createOptions());

      expect(isChecked(element, 'test-swatch-text-default')).toBe(true);
      expect(isChecked(element, 'test-swatch-text-red')).toBe(false);
      expect(isChecked(element, 'test-swatch-text-blue')).toBe(false);
      expect(isChecked(element, 'test-swatch-bg-default')).toBe(true);
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

      expect(isChecked(element, 'test-swatch-text-red')).toBe(true);
      expect(isChecked(element, 'test-swatch-text-gray')).toBe(false);
      expect(isChecked(element, 'test-swatch-text-default')).toBe(false);
    });

    it('ignores an unknown mode key without touching any section', () => {
      const { element, setActiveColor } = createColorPicker(createOptions());

      setActiveColor('#123456', 'no-such-mode');

      expect(isChecked(element, 'test-swatch-text-default')).toBe(true);
      expect(isChecked(element, 'test-swatch-bg-default')).toBe(true);
      expect(isChecked(element, 'test-swatch-text-gray')).toBe(false);
    });
  });

  describe('section visibility', () => {
    it('shows every column as a shrinkable flex column', () => {
      const { element } = createColorPicker(createOptions());

      for (const key of ['text', 'bg']) {
        expect(byTestId(element, `test-section-${key}`).hidden).toBe(false);
        expect(byTestId(element, `test-section-${key}`).className).toBe('flex min-w-0 flex-col gap-1');
      }
    });

    it('resets every section to default on reset()', () => {
      const { element, setActiveColor, reset } = createColorPicker(createOptions());

      setActiveColor(preset('red').text, 'text');
      reset();

      expect(byTestId(element, 'test-swatch-text-red').getAttribute('aria-pressed')).toBe('false');
      expect(byTestId(element, 'test-swatch-text-default').getAttribute('aria-pressed')).toBe('true');
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
      // The empty host would still take a row gap in the grid.
      expect(element.firstElementChild).toHaveProperty('hidden', true);
    });

    it('shows the recent host again once a reset finds recents', () => {
      const { element, reset } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-text-red');
      reset();

      expect(element.firstElementChild).toHaveProperty('hidden', false);
      expect(element.querySelectorAll('[data-blok-testid="test-section-recent"]')).toHaveLength(1);
    });

    it('clears the recent row when a reset finds none left', () => {
      seedRecents([{ name: 'red', field: 'text' }]);

      const { element, reset } = createColorPicker(createOptions());

      localStorage.removeItem(RECENT_KEY);
      reset();

      expect(element.querySelector('[data-blok-testid="test-section-recent"]')).toBeNull();
      expect(element.firstElementChild).toHaveProperty('hidden', true);
    });

    it('renders the recent section with its title and layout once a preset was picked', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const { element } = createColorPicker(createOptions());
      const section = byTestId(element, 'test-section-recent');

      expect(section.className).toBe('flex min-w-0 flex-col gap-1');
      // Recents lead the panel and span both columns.
      expect(element.firstElementChild?.contains(section)).toBe(true);
      expect(element.firstElementChild?.className).toBe('col-span-2');
      expect(section.children[0].textContent).toBe('Recently used');
      expect(section.children[0].className).toBe('text-xs font-medium text-text-secondary px-0.5');
      expect(byTestId(element, 'test-swatch-recent-text-red').parentElement?.className).toBe('flex gap-[calc((100%-14rem)/7)] px-0.5');
    });

    it('paints a recent text tile with the preset text color on the popover surface', () => {
      seedRecents([{ name: 'red', field: 'text' }]);

      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-recent-text-red');
      const tile = tileOf(element, 'test-swatch-recent-text-red');

      expect(tile.style.color).toBe(rgbOf(preset('red').text));
      expect(tile.style.backgroundColor).toBe(POPOVER_BG);
      expect(tile.classList.contains("before:content-['A']")).toBe(true);
      expect(swatch.children).toHaveLength(1);
      expect(swatch.getAttribute('style')).toBeNull();
    });

    it('paints a recent bg tile with the preset background and no letter', () => {
      seedRecents([{ name: 'blue', field: 'bg' }]);

      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-recent-bg-blue');
      const tile = tileOf(element, 'test-swatch-recent-bg-blue');

      expect(tile.style.backgroundColor).toBe(rgbOf(preset('blue').bg));
      expect(tile.style.color).toBe('');
      expect(swatch.textContent).toBe('');
      expect(swatch.getAttribute('style')).toBeNull();
    });

    it('resolves the recent tile colors against the dark palette in dark mode', () => {
      seedRecents([{ name: 'red', field: 'text' }, { name: 'blue', field: 'bg' }]);
      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const { element } = createColorPicker(createOptions());

      expect(tileOf(element, 'test-swatch-recent-text-red').style.color).toBe(rgbOf(darkPreset('red').text));
      expect(tileOf(element, 'test-swatch-recent-bg-blue').style.backgroundColor).toBe(rgbOf(darkPreset('blue').bg));
    });

    it('labels a recent tile like its named row and leaves it unpressed', () => {
      seedRecents([{ name: 'blue', field: 'bg' }]);

      const { element } = createColorPicker(createOptions());
      const swatch = byTestId(element, 'test-swatch-recent-bg-blue');

      expect(swatch.getAttribute('aria-label')).toBe(byTestId(element, 'test-swatch-bg-blue').getAttribute('aria-label'));
      expect(swatch.getAttribute('aria-label')).toBe('Blue background');
      expect(swatch.hasAttribute('aria-pressed')).toBe(false);
      expect(swatch.getAttribute('type')).toBe('button');
    });

    it('gives a recent button and its tile their class contract', () => {
      seedRecents([{ name: 'red', field: 'text' }]);

      const { element } = createColorPicker(createOptions());

      expect(classesOf(byTestId(element, 'test-swatch-recent-text-red'))).toStrictEqual(classes(
        'relative flex h-8.5 w-7 shrink-0 items-center justify-center p-0',
        'rounded-(--blok-radius-control-lg) cursor-pointer border-none outline-hidden bg-transparent',
        "before:absolute before:inset-y-0 before:-inset-x-0.75 before:content-['']",
        'before:rounded-(--blok-radius-control-lg) before:transition-colors before:duration-150',
        'hover:before:bg-item-hover-bg active:before:bg-swatch-ring-hover motion-reduce:before:transition-none',
        FOCUS_RING
      ));
      expect(classesOf(tileOf(element, 'test-swatch-recent-text-red'))).toStrictEqual(classes(
        'relative flex size-7 items-center justify-center rounded-(--blok-radius-control)',
        'text-base leading-none font-semibold',
        "before:content-['A']"
      ));
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

    it('moves a clicked recent color to the front of the stored list', () => {
      seedRecents([{ name: 'blue', field: 'text' }, { name: 'red', field: 'text' }]);

      const { element } = createColorPicker(createOptions());

      clickSwatch(element, 'test-swatch-recent-text-red');

      expect(storedRecents()).toStrictEqual([{ name: 'red', field: 'text' }, { name: 'blue', field: 'text' }]);
    });

    it('selects the clicked recent color with its axis', () => {
      seedRecents([{ name: 'blue', field: 'bg' }]);

      const onColorSelect = vi.fn();
      const { element } = createColorPicker(createOptions({ onColorSelect }));

      clickSwatch(element, 'test-swatch-recent-bg-blue');

      expect(onColorSelect).toHaveBeenCalledTimes(1);
      expect(onColorSelect).toHaveBeenCalledWith(preset('blue').bg, 'bg');
    });

    it('selects the dark value of a recent color in dark mode', () => {
      seedRecents([{ name: 'red', field: 'text' }]);
      document.documentElement.setAttribute('data-blok-theme', 'dark');

      const onColorSelect = vi.fn();
      const { element } = createColorPicker(createOptions({ onColorSelect }));

      clickSwatch(element, 'test-swatch-recent-text-red');

      expect(onColorSelect).toHaveBeenCalledWith(darkPreset('red').text, 'text');
    });
  });

  describe('tooltip wiring', () => {
    it('wires the recent swatch tooltip with the top placement', () => {
      const first = createColorPicker(createOptions());

      clickSwatch(first.element, 'test-swatch-text-red');

      const onHoverSpy = vi.spyOn(tooltipModule, 'onHover');

      createColorPicker(createOptions());

      const call = onHoverSpy.mock.calls.find(
        ([el]) => el.getAttribute('data-blok-testid') === 'test-swatch-recent-text-red'
      );

      expect(call?.[2]).toStrictEqual({ placement: 'top' });
      expect(call?.[1]).toBe('Red text');
    });
  });

  describe('focus management', () => {
    it('focuses the active swatch of the first section for a keyboard open', () => {
      const { element, setActiveColor, focusActiveSwatch } = createColorPicker(createOptions());

      document.body.appendChild(element);
      fireEvent.keyDown(document.body, { key: 'Tab' });
      setActiveColor(preset('red').text, 'text');
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

      focusActiveSwatch();

      expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('test-swatch-text-red');
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    });

    it('leaves focus alone after a mouse press', () => {
      const { element, focusActiveSwatch } = createColorPicker(createOptions());

      document.body.appendChild(element);
      fireEvent.pointerDown(document.body);
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

      focusActiveSwatch();

      expect(focusSpy).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Tab' });
    });
  });
});

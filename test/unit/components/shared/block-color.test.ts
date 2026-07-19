import { describe, it, expect, vi } from 'vitest';
import {
  applyBlockColor,
  buildBlockColorTunes,
  getBlockColorToolboxEntries,
  BLOCK_COLOR_SANITIZE,
} from '../../../../src/components/shared/block-color';

/**
 * Russian-style dictionary: templates reorder to "{mode}: {color}" so the tests
 * prove word order and color names come from the locale, not from code.
 */
const RU_DICT: Record<string, string> = {
  'tools.marker.textColor': 'Цвет текста',
  'tools.marker.background': 'Фон',
  'tools.marker.default': 'По умолчанию',
  'tools.colorPicker.defaultSwatchLabel': '{mode}: {default}',
  'tools.colorPicker.colorSwatchLabel': '{mode}: {color}',
  'tools.colorPicker.color.red': 'Красный',
  'tools.colorPicker.color.orange': 'Оранжевый',
};

const EN_DICT: Record<string, string> = {
  'tools.marker.textColor': 'Text color',
  'tools.marker.background': 'Background',
  'tools.marker.default': 'Default',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.colorPicker.color.red': 'Red',
  'tools.colorPicker.color.orange': 'Orange',
};

const toolboxI18n = {
  t: (key: string): string => RU_DICT[key] ?? key,
  has: (key: string): boolean => key in RU_DICT,
  getEnglishTranslation: (key: string): string => EN_DICT[key] ?? '',
  getLocale: (): string => 'ru',
};

describe('block-color foundation', () => {
  describe('applyBlockColor', () => {
    it('sets text and background color via the shared CSS vars', () => {
      const el = document.createElement('div');

      applyBlockColor(el, { textColor: 'red', backgroundColor: 'blue' });

      expect(el.style.color).toBe('var(--blok-color-red-text)');
      expect(el.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
    });

    it('clears styles when the field is absent (idempotent)', () => {
      const el = document.createElement('div');

      applyBlockColor(el, { textColor: 'green' });
      applyBlockColor(el, {});

      expect(el.style.color).toBe('');
      expect(el.style.backgroundColor).toBe('');
    });
  });

  describe('BLOCK_COLOR_SANITIZE', () => {
    it('declares the color data fields so they are preserved', () => {
      expect(BLOCK_COLOR_SANITIZE).toMatchObject({ textColor: false, backgroundColor: false });
    });
  });

  describe('buildBlockColorTunes', () => {
    const i18n = { t: (key: string) => key, has: () => true } as never;

    const pickerElement = (tunes: unknown): HTMLElement => {
      const [tune] = tunes as Array<{
        children: { items: Array<{ element: HTMLElement }> };
      }>;

      return tune.children.items[0].element;
    };

    it('returns a single Color entry hosting the shared two-section picker', () => {
      const tunes = buildBlockColorTunes({ data: {}, i18n, onPick: vi.fn() }) as Array<{
        name: string;
        title: string;
        children: { items: Array<{ type: string; element: HTMLElement }> };
      }>;

      expect(tunes).toHaveLength(1);
      expect(tunes[0].name).toBe('block-color');
      // mock i18n echoes the key; reuses the marker's "Color" label
      expect(tunes[0].title).toBe('toolNames.marker');

      const picker = pickerElement(tunes);

      expect(picker.querySelector('[data-blok-testid="block-color-section-textColor"]')).not.toBeNull();
      expect(picker.querySelector('[data-blok-testid="block-color-section-backgroundColor"]')).not.toBeNull();
    });

    it('marks the active swatch from data and the Default when unset', () => {
      const tunes = buildBlockColorTunes({ data: { textColor: 'purple' }, i18n, onPick: vi.fn() });
      const picker = pickerElement(tunes);

      const purple = picker.querySelector('[data-blok-testid="block-color-swatch-textColor-purple"]');
      const textDefault = picker.querySelector('[data-blok-testid="block-color-swatch-textColor-default"]');
      const bgDefault = picker.querySelector('[data-blok-testid="block-color-swatch-backgroundColor-default"]');

      expect(purple?.classList.contains('ring-2')).toBe(true);
      expect(textDefault?.classList.contains('ring-2')).toBe(false);
      // background unset → its Default is active
      expect(bgDefault?.classList.contains('ring-2')).toBe(true);
    });

    it('calls onPick with the field + preset name, and undefined for Default', () => {
      const onPick = vi.fn();
      const picker = pickerElement(buildBlockColorTunes({ data: {}, i18n, onPick }));

      (picker.querySelector('[data-blok-testid="block-color-swatch-backgroundColor-red"]') as HTMLElement).click();
      expect(onPick).toHaveBeenCalledWith('backgroundColor', 'red');

      (picker.querySelector('[data-blok-testid="block-color-swatch-backgroundColor-default"]') as HTMLElement).click();
      expect(onPick).toHaveBeenCalledWith('backgroundColor', undefined);
    });
  });

  describe('getBlockColorToolboxEntries', () => {
    it('returns a flat text + background command per preset, plus two Default resets', () => {
      const entries = getBlockColorToolboxEntries(toolboxI18n);

      // 9 presets × 2 axes + 2 default resets
      expect(entries).toHaveLength(20);

      const names = entries.map((e) => e.name);

      expect(new Set(names).size).toBe(names.length); // names are unique
    });

    it('composes titles from the locale swatch-label template (translated color, locale word order)', () => {
      const entries = getBlockColorToolboxEntries(toolboxI18n);

      const redText = entries.find((e) => e.field === 'textColor' && e.value === 'red');
      const redBg = entries.find((e) => e.field === 'backgroundColor' && e.value === 'red');

      expect(redText?.title).toBe('Цвет текста: Красный');
      expect(redBg?.title).toBe('Фон: Красный');
    });

    it('exposes an English title alongside the localized one for multilingual search', () => {
      const entries = getBlockColorToolboxEntries(toolboxI18n);

      const redText = entries.find((e) => e.field === 'textColor' && e.value === 'red');
      const redBg = entries.find((e) => e.field === 'backgroundColor' && e.value === 'red');

      expect(redText?.englishTitle).toBe('Red text color');
      expect(redBg?.englishTitle).toBe('Red background');
    });

    it('emits Default reset entries composed from the locale default-swatch template', () => {
      const entries = getBlockColorToolboxEntries(toolboxI18n);

      const defaults = entries.filter((e) => e.value === undefined);

      expect(defaults).toHaveLength(2);
      expect(defaults.map((e) => e.field).sort()).toEqual(['backgroundColor', 'textColor']);

      const textDefault = defaults.find((e) => e.field === 'textColor');

      expect(textDefault?.title).toBe('Цвет текста: По умолчанию');
      expect(textDefault?.englishTitle).toBe('Default text color');
    });

    it('carries a swatch icon and color-related search terms for filtering', () => {
      const entries = getBlockColorToolboxEntries(toolboxI18n);

      const orangeText = entries.find((e) => e.field === 'textColor' && e.value === 'orange');

      expect(orangeText?.icon).toContain('<span');
      expect(orangeText?.searchTerms).toEqual(expect.arrayContaining(['color', 'text', 'orange']));
    });
  });
});

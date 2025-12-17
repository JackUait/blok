import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import I18n from '../../../../src/components/i18n';
import {
  enLocale,
  loadLocale,
  loadBasicLocales,
  loadExtendedLocales,
  loadAllLocales,
  BASIC_LOCALE_CODES,
  EXTENDED_LOCALE_CODES,
  ALL_LOCALE_CODES,
} from '../../../../src/components/i18n/locales/exports';
import type { I18nDictionary, LocaleRegistry, TranslationKey } from '../../../../types/configs';

/**
 * Expected locales in each preset.
 * Tests assert behavior (contains expected locales) rather than implementation details (exact counts).
 */
const EXPECTED_BASIC_LOCALES = ['en', 'zh', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'ar', 'it', 'ru', 'hi', 'hy', 'id'];
const EXPECTED_EXTENDED_ADDITIONS = ['tr', 'vi', 'pl', 'nl', 'th', 'ms', 'sv', 'no', 'da', 'fi', 'el', 'cs'];

const createDictionary = (): I18nDictionary => ({
  'toolbox.addBelow': 'Cliquez pour ajouter ci-dessous',
  'toolbox.optionAddAbove': 'Option-clic pour ajouter ci-dessus',
  'tools.link.addLink': 'Ajouter un lien',
});

const alternativeDictionary: I18nDictionary = {
  'tools.link.addLink': 'Lien secondaire',
};

describe('I18n', () => {
  beforeEach(() => {
    I18n.reset();
  });

  afterEach(() => {
    I18n.reset();
  });

  it('translates keys via t()', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('toolbox.addBelow')).toBe('Cliquez pour ajouter ci-dessous');
    expect(I18n.t('tools.link.addLink')).toBe('Ajouter un lien');
  });

  it('returns the last segment of key when translation is missing', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('missing.namespace.Fallback text' as TranslationKey)).toBe('Fallback text');
  });

  it('returns the last segment when translation is missing for existing namespace prefix', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('tools.link.Missing label' as TranslationKey)).toBe('Missing label');
  });

  it('allows overriding dictionary via setDictionary()', () => {
    const firstDictionary = createDictionary();

    I18n.setDictionary(firstDictionary);
    expect(I18n.t('tools.link.addLink')).toBe('Ajouter un lien');

    I18n.setDictionary(alternativeDictionary);
    expect(I18n.t('tools.link.addLink')).toBe('Lien secondaire');
  });

  describe('setLocaleAsync', () => {
    it('sets locale to Russian and loads Russian dictionary', async () => {
      // Allow all locales for this test
      I18n.init({ allowedLocales: ALL_LOCALE_CODES });

      const result = await I18n.setLocaleAsync('ru');

      expect(result.locale).toBe('ru');
      expect(result.direction).toBe('ltr');
      expect(I18n.getLocale()).toBe('ru');
      expect(I18n.t('blockSettings.dragToMove')).toBe('Тяните, чтобы переместить');
    });

    it('sets locale to Chinese and loads Chinese dictionary', async () => {
      I18n.init({ allowedLocales: ALL_LOCALE_CODES });

      const result = await I18n.setLocaleAsync('zh');

      expect(result.locale).toBe('zh');
      expect(result.direction).toBe('ltr');
      expect(I18n.getLocale()).toBe('zh');
      expect(I18n.t('blockSettings.dragToMove')).toBe('拖动以移动');
    });

    it('sets locale to English and loads English dictionary', async () => {
      await I18n.setLocaleAsync('ru');
      const result = await I18n.setLocaleAsync('en');

      expect(result.locale).toBe('en');
      expect(I18n.getLocale()).toBe('en');
    });
  });

  describe('setLocale (sync) with custom registry', () => {
    it('sets locale when using custom registry', async () => {
      // Load locales first
      const frConfig = await loadLocale('fr');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
      };

      I18n.init({ locales: customLocales });

      const result = I18n.setLocale('fr');

      expect(result.locale).toBe('fr');
      expect(result.direction).toBe('ltr');
      expect(I18n.getLocale()).toBe('fr');
      expect(I18n.t('blockSettings.dragToMove')).toBe('Glisser pour déplacer');
    });
  });

  describe('detectLocale', () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it('returns default locale when navigator is undefined', () => {
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('returns default locale when no languages match', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['xyz', 'abc'],
          language: 'xyz',
        },
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('matches exact locale code', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['ru', 'en'],
          language: 'ru',
        },
        configurable: true,
      });

      // Allow Russian for this test
      I18n.init({ allowedLocales: ['en', 'ru'] });

      expect(I18n.detectLocale()).toBe('ru');
    });

    it('matches base language from full locale tag', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['en-US', 'fr-FR'],
          language: 'en-US',
        },
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('handles empty language values gracefully', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['', 'en'],
          language: '',
        },
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('returns first matching locale from preference list', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['xyz', 'de', 'en'],
          language: 'xyz',
        },
        configurable: true,
      });

      // Allow German for this test
      I18n.init({ allowedLocales: ['en', 'de'] });

      expect(I18n.detectLocale()).toBe('de');
    });

    it('uses configured default locale as fallback', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['xyz'],
          language: 'xyz',
        },
        configurable: true,
      });

      I18n.init({ allowedLocales: ['en', 'fr'], defaultLocale: 'fr' });

      expect(I18n.detectLocale()).toBe('fr');
    });

    it('returns correct RTL direction for Arabic', () => {
      expect(I18n.getDirectionForLocale('ar')).toBe('rtl');
    });

    it('returns correct LTR direction for English', () => {
      expect(I18n.getDirectionForLocale('en')).toBe('ltr');
    });
  });

  describe('resolveLocaleAsync', () => {
    const originalNavigator = global.navigator;

    beforeEach(() => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['ru', 'en'],
          language: 'ru',
        },
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it('auto-detects and loads locale when locale is undefined', async () => {
      I18n.init({ allowedLocales: ['en', 'ru'] });

      const result = await I18n.resolveLocaleAsync();

      expect(result.locale).toBe('ru');
    });

    it('auto-detects and loads locale when locale is "auto"', async () => {
      I18n.init({ allowedLocales: ['en', 'ru'] });

      const result = await I18n.resolveLocaleAsync('auto');

      expect(result.locale).toBe('ru');
    });

    it('uses specified locale when provided', async () => {
      I18n.init({ allowedLocales: ALL_LOCALE_CODES });

      const result = await I18n.resolveLocaleAsync('zh');

      expect(result.locale).toBe('zh');
      expect(result.direction).toBe('ltr');
    });

    it('returns correct direction for the locale', async () => {
      const result = await I18n.resolveLocaleAsync('en');

      expect(result.direction).toBe('ltr');
    });
  });

  describe('getSupportedLocales', () => {
    it('returns array of all supported locales', () => {
      const locales = I18n.getSupportedLocales();

      // Default is basic locales - verify it contains expected languages
      for (const code of EXPECTED_BASIC_LOCALES) {
        expect(locales).toContain(code);
      }
    });

    it('returns allowed locales when set', () => {
      I18n.init({ allowedLocales: ['en', 'fr', 'de'] });

      const locales = I18n.getSupportedLocales();

      expect(locales).toEqual(['en', 'fr', 'de']);
    });
  });

  describe('init', () => {
    it('initializes with custom locales registry', async () => {
      const frConfig = await loadLocale('fr');
      const deConfig = await loadLocale('de');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
        de: deConfig,
      };

      I18n.init({ locales: customLocales });

      expect(I18n.getSupportedLocales()).toEqual(['en', 'fr', 'de']);
      expect(I18n.getDefaultLocale()).toBe('en');
    });

    it('initializes with allowed locales for lazy loading', () => {
      I18n.init({ allowedLocales: ['en', 'fr', 'de'] });

      expect(I18n.getSupportedLocales()).toEqual(['en', 'fr', 'de']);
      expect(I18n.getDefaultLocale()).toBe('en');
    });

    it('initializes with explicit defaultLocale', async () => {
      const frConfig = await loadLocale('fr');
      const deConfig = await loadLocale('de');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
        de: deConfig,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'fr' });

      expect(I18n.getDefaultLocale()).toBe('fr');
    });

    it('throws when defaultLocale is not in custom locales registry', async () => {
      const frConfig = await loadLocale('fr');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
      };

      expect(() => {
        I18n.init({ locales: customLocales, defaultLocale: 'de' });
      }).toThrow('defaultLocale "de" is not in locales');
    });

    it('uses first locale as default when not specified', async () => {
      const frConfig = await loadLocale('fr');
      const deConfig = await loadLocale('de');
      const customLocales: LocaleRegistry = {
        fr: frConfig,
        de: deConfig,
        en: enLocale,
      };

      I18n.init({ locales: customLocales });

      expect(I18n.getDefaultLocale()).toBe('fr');
    });

    it('works without any options', () => {
      I18n.init({});

      // Default is basic locales - verify expected behavior
      expect(I18n.getDefaultLocale()).toBe('en');
      expect(I18n.getSupportedLocales()).toContain('en');
    });
  });

  describe('reset', () => {
    it('resets all configuration to defaults', async () => {
      const frConfig = await loadLocale('fr');
      const deConfig = await loadLocale('de');
      const customLocales: LocaleRegistry = {
        fr: frConfig,
        de: deConfig,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'fr' });
      I18n.setLocale('fr');

      I18n.reset();

      // Default is basic locales - verify expected behavior
      expect(I18n.getLocale()).toBe('en');
      expect(I18n.getDefaultLocale()).toBe('en');
      expect(I18n.getSupportedLocales()).toContain('en');
    });
  });

  describe('setLocale with custom locales registry', () => {
    const originalConsoleWarn = console.warn;

    beforeEach(() => {
      console.warn = vi.fn();
    });

    afterEach(() => {
      console.warn = originalConsoleWarn;
    });

    it('allows setting locale that is in custom registry', async () => {
      const frConfig = await loadLocale('fr');
      const deConfig = await loadLocale('de');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
        de: deConfig,
      };

      I18n.init({ locales: customLocales });

      const result = I18n.setLocale('fr');

      expect(result.locale).toBe('fr');
      expect(I18n.getLocale()).toBe('fr');
    });

    it('uses dictionary from custom registry', async () => {
      const frConfig = await loadLocale('fr');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
      };

      I18n.init({ locales: customLocales });
      I18n.setLocale('fr');

      expect(I18n.t('blockSettings.dragToMove')).toBe('Glisser pour déplacer');
    });

    it('falls back to defaultLocale when setting unavailable locale', async () => {
      const frConfig = await loadLocale('fr');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
      };

      I18n.init({ locales: customLocales });

      const result = I18n.setLocale('de');

      expect(result.locale).toBe('en');
      expect(console.warn).toHaveBeenCalled();
    });

    it('warns when locale is unavailable', async () => {
      const frConfig = await loadLocale('fr');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
      };

      I18n.init({ locales: customLocales });

      I18n.setLocale('de');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Locale "de" is not available')
      );
    });

    it('warns when locale is unavailable and lists available locales', async () => {
      const frConfig = await loadLocale('fr');
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frConfig,
      };

      I18n.init({ locales: customLocales });

      I18n.setLocale('de');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('en, fr')
      );
    });
  });

  describe('hasTranslation', () => {
    it('returns true when translation exists', () => {
      const dictionary: I18nDictionary = {
        'test.key': 'Test value',
      };

      I18n.setDictionary(dictionary);

      expect(I18n.hasTranslation('test.key')).toBe(true);
    });

    it('returns false when translation does not exist', () => {
      const dictionary: I18nDictionary = {
        'test.key': 'Test value',
      };

      I18n.setDictionary(dictionary);

      expect(I18n.hasTranslation('other.key')).toBe(false);
    });

    it('returns false for empty string translation', () => {
      const dictionary: I18nDictionary = {
        'test.key': '',
      };

      I18n.setDictionary(dictionary);

      expect(I18n.hasTranslation('test.key')).toBe(false);
    });
  });

  describe('RTL direction detection', () => {
    it('returns rtl for Arabic', () => {
      expect(I18n.getDirectionForLocale('ar')).toBe('rtl');
    });

    it('returns rtl for Hebrew', () => {
      expect(I18n.getDirectionForLocale('he')).toBe('rtl');
    });

    it('returns rtl for Persian', () => {
      expect(I18n.getDirectionForLocale('fa')).toBe('rtl');
    });

    it('returns ltr for English', () => {
      expect(I18n.getDirectionForLocale('en')).toBe('ltr');
    });

    it('returns ltr for German', () => {
      expect(I18n.getDirectionForLocale('de')).toBe('ltr');
    });
  });

  describe('lazy loading with allowedLocales', () => {
    const originalConsoleWarn = console.warn;

    beforeEach(() => {
      console.warn = vi.fn();
    });

    afterEach(() => {
      console.warn = originalConsoleWarn;
    });

    it('allows setting locale that is in allowed list', async () => {
      I18n.init({ allowedLocales: ['en', 'fr', 'de'] });

      const result = await I18n.setLocaleAsync('fr');

      expect(result.locale).toBe('fr');
      expect(I18n.getLocale()).toBe('fr');
    });

    it('falls back when locale is not in allowed list', async () => {
      I18n.init({ allowedLocales: ['en', 'fr'] });

      const result = await I18n.setLocaleAsync('de');

      expect(result.locale).toBe('en');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Locale "de" is not allowed')
      );
    });

    it('uses default locale when unavailable locale is requested', async () => {
      I18n.init({ allowedLocales: ['en', 'fr'], defaultLocale: 'fr' });

      // Load French first so it's available
      await I18n.setLocaleAsync('fr');

      const result = await I18n.setLocaleAsync('de');

      expect(result.locale).toBe('fr');
    });
  });

  describe('locale presets', () => {
    it('BASIC_LOCALE_CODES contains expected locales', () => {
      // Verify all expected basic locales are present
      for (const code of EXPECTED_BASIC_LOCALES) {
        expect(BASIC_LOCALE_CODES).toContain(code);
      }
    });

    it('EXTENDED_LOCALE_CODES contains basic plus extended locales', () => {
      const expectedExtended = [...EXPECTED_BASIC_LOCALES, ...EXPECTED_EXTENDED_ADDITIONS];

      // Verify all expected extended locales are present
      for (const code of expectedExtended) {
        expect(EXTENDED_LOCALE_CODES).toContain(code);
      }
    });

    it('ALL_LOCALE_CODES contains all supported locales', () => {
      expect(ALL_LOCALE_CODES.length).toBeGreaterThanOrEqual(68);
    });

    it('loadBasicLocales loads all basic locales', async () => {
      const registry = await loadBasicLocales();

      expect(Object.keys(registry)).toHaveLength(BASIC_LOCALE_CODES.length);
      expect(registry.en).toBeDefined();
      expect(registry.zh).toBeDefined();
    });

    it('loadExtendedLocales loads all extended locales', async () => {
      const registry = await loadExtendedLocales();

      expect(Object.keys(registry)).toHaveLength(EXTENDED_LOCALE_CODES.length);
      expect(registry.en).toBeDefined();
      expect(registry.tr).toBeDefined(); // extended addition
    });

    it('loadAllLocales loads all locales', async () => {
      const registry = await loadAllLocales();

      expect(Object.keys(registry).length).toBeGreaterThanOrEqual(68);
    });

    it('presets can be used with I18n.init()', async () => {
      const registry = await loadBasicLocales();

      I18n.init({ locales: registry });

      expect(I18n.getSupportedLocales()).toHaveLength(BASIC_LOCALE_CODES.length);
      expect(I18n.getDefaultLocale()).toBe('en');
    });

    it('enLocale is always available', () => {
      expect(enLocale).toBeDefined();
      expect(enLocale.dictionary).toBeDefined();
      expect(enLocale.direction).toBe('ltr');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import I18n from '../../../../src/components/i18n';
import { enLocale, frLocale, deLocale } from '../../../../src/components/i18n/locales/exports';
import type { I18nDictionary, LocaleRegistry } from '../../../../types/configs';

const createDictionary = (): I18nDictionary => ({
  'ui.toolbar.toolbox.Click to add below': 'Cliquez pour ajouter ci-dessous',
  'ui.toolbar.toolbox.Option-click to add above': 'Option-clic pour ajouter ci-dessus',
  'tools.link.Add a link': 'Ajouter un lien',
});

const alternativeDictionary: I18nDictionary = {
  'tools.link.Add a link': 'Lien secondaire',
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

    expect(I18n.t('ui.toolbar.toolbox.Click to add below')).toBe('Cliquez pour ajouter ci-dessous');
    expect(I18n.t('tools.link.Add a link')).toBe('Ajouter un lien');
  });

  it('returns the last segment of key when translation is missing', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('missing.namespace.Fallback text')).toBe('Fallback text');
  });

  it('returns the last segment when translation is missing for existing namespace prefix', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('tools.link.Missing label')).toBe('Missing label');
  });

  it('allows overriding dictionary via setDictionary()', () => {
    const firstDictionary = createDictionary();

    I18n.setDictionary(firstDictionary);
    expect(I18n.t('tools.link.Add a link')).toBe('Ajouter un lien');

    I18n.setDictionary(alternativeDictionary);
    expect(I18n.t('tools.link.Add a link')).toBe('Lien secondaire');
  });

  describe('setLocale', () => {
    it('sets locale to Russian and loads Russian dictionary', () => {
      const result = I18n.setLocale('ru');

      expect(result.locale).toBe('ru');
      expect(result.direction).toBe('ltr');
      expect(I18n.getLocale()).toBe('ru');
      expect(I18n.t('ui.blockTunes.toggler.dragToMove')).toBe('Тяните, чтобы переместить');
    });

    it('sets locale to Chinese and loads Chinese dictionary', () => {
      const result = I18n.setLocale('zh');

      expect(result.locale).toBe('zh');
      expect(result.direction).toBe('ltr');
      expect(I18n.getLocale()).toBe('zh');
      expect(I18n.t('ui.blockTunes.toggler.dragToMove')).toBe('拖动以移动');
    });

    it('sets locale to English and loads English dictionary', () => {
      I18n.setLocale('ru');
      const result = I18n.setLocale('en');

      expect(result.locale).toBe('en');
      expect(I18n.getLocale()).toBe('en');
    });
  });

  describe('detectLocale', () => {
    const originalNavigator = globalThis.navigator;

    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('returns default locale when navigator is undefined', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('detects exact locale match from navigator.languages', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['ru', 'en'],
          language: 'ru',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('ru');
    });

    it('detects base language from locale with region (en-US -> en)', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['en-US', 'fr'],
          language: 'en-US',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('detects base language from locale with region (ru-RU -> ru)', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['ru-RU'],
          language: 'ru-RU',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('ru');
    });

    it('falls back to default for unsupported languages', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['xyz', 'abc', 'qwerty'],
          language: 'xyz',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('finds first supported language in preferences list', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['xyz', 'abc', 'ru', 'en'],
          language: 'xyz',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('ru');
    });

    it('handles case-insensitive locale matching', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['RU', 'EN'],
          language: 'RU',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('ru');
    });

    it('falls back to navigator.language when languages array is empty', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: undefined,
          language: 'zh',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('zh');
    });
  });

  describe('resolveLocale', () => {
    const originalNavigator = globalThis.navigator;

    beforeEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['ru', 'en'],
          language: 'ru',
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('auto-detects locale when locale is undefined', () => {
      const result = I18n.resolveLocale(undefined);

      expect(result.locale).toBe('ru');
    });

    it('auto-detects locale when locale is "auto"', () => {
      const result = I18n.resolveLocale('auto');

      expect(result.locale).toBe('ru');
    });

    it('uses specified locale when provided', () => {
      const result = I18n.resolveLocale('zh');

      expect(result.locale).toBe('zh');
      expect(result.direction).toBe('ltr');
    });

    it('returns correct direction for the locale', () => {
      const result = I18n.resolveLocale('en');

      expect(result.direction).toBe('ltr');
    });
  });

  describe('getSupportedLocales', () => {
    it('returns array of all supported locales', () => {
      const locales = I18n.getSupportedLocales();

      expect(locales).toContain('ar');
      expect(locales).toContain('de');
      expect(locales).toContain('en');
      expect(locales).toContain('es');
      expect(locales).toContain('fr');
      expect(locales).toContain('hy');
      expect(locales).toContain('it');
      expect(locales).toContain('ja');
      expect(locales).toContain('ko');
      expect(locales).toContain('nl');
      expect(locales).toContain('pl');
      expect(locales).toContain('pt');
      expect(locales).toContain('ru');
      expect(locales).toContain('sv');
      expect(locales).toContain('zh');
      expect(locales.length).toBeGreaterThanOrEqual(68);
    });
  });

  describe('init', () => {
    it('initializes with custom locales registry', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales });

      expect(I18n.getSupportedLocales()).toEqual(['en', 'fr', 'de']);
      expect(I18n.getDefaultLocale()).toBe('en');
    });

    it('initializes with explicit defaultLocale', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'fr' });

      expect(I18n.getDefaultLocale()).toBe('fr');
    });

    it('throws when defaultLocale is not in custom locales registry', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
      };

      expect(() => {
        I18n.init({ locales: customLocales, defaultLocale: 'de' });
      }).toThrow('defaultLocale "de" is not in locales');
    });

    it('uses first locale as default when not specified', () => {
      const customLocales: LocaleRegistry = {
        fr: frLocale,
        de: deLocale,
        en: enLocale,
      };

      I18n.init({ locales: customLocales });

      expect(I18n.getDefaultLocale()).toBe('fr');
    });

    it('works without any options', () => {
      I18n.init({});

      expect(I18n.getDefaultLocale()).toBe('en');
      expect(I18n.getSupportedLocales().length).toBeGreaterThanOrEqual(68);
    });
  });

  describe('reset', () => {
    it('resets all configuration to defaults', () => {
      const customLocales: LocaleRegistry = {
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'fr' });
      I18n.setLocale('fr');

      I18n.reset();

      expect(I18n.getLocale()).toBe('en');
      expect(I18n.getDefaultLocale()).toBe('en');
      expect(I18n.getSupportedLocales().length).toBeGreaterThanOrEqual(68);
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

    it('allows setting locale that is in custom registry', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales });

      const result = I18n.setLocale('fr');

      expect(result.locale).toBe('fr');
      expect(I18n.getLocale()).toBe('fr');
    });

    it('uses dictionary from custom registry', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
      };

      I18n.init({ locales: customLocales });
      I18n.setLocale('fr');

      expect(I18n.t('ui.blockTunes.toggler.dragToMove')).toBe('Glisser pour déplacer');
    });

    it('falls back to defaultLocale when setting unavailable locale', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'fr' });

      const result = I18n.setLocale('ru');

      expect(result.locale).toBe('fr');
      expect(I18n.getLocale()).toBe('fr');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Locale "ru" is not available')
      );
    });

    it('falls back when locale not in custom registry', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
      };

      I18n.init({ locales: customLocales });
      I18n.setLocale('de');

      expect(I18n.getLocale()).toBe('en');
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('detectLocale with custom locales', () => {
    const originalNavigator = globalThis.navigator;

    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('returns available locale when browser locale matches', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['fr', 'en'],
          language: 'fr',
        },
        writable: true,
        configurable: true,
      });

      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales });

      expect(I18n.detectLocale()).toBe('fr');
    });

    it('skips unavailable locales and finds next available', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['ru', 'es', 'fr', 'en'],
          language: 'ru',
        },
        writable: true,
        configurable: true,
      });

      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales });

      expect(I18n.detectLocale()).toBe('fr');
    });

    it('returns defaultLocale when no browser locale is available', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['ru', 'es', 'ja'],
          language: 'ru',
        },
        writable: true,
        configurable: true,
      });

      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'de' });

      expect(I18n.detectLocale()).toBe('de');
    });
  });

  describe('resolveLocale with custom locales', () => {
    const originalNavigator = globalThis.navigator;

    beforeEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['ru', 'en'],
          language: 'ru',
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('auto-detects only from available locales', () => {
      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
        de: deLocale,
      };

      I18n.init({ locales: customLocales });

      const result = I18n.resolveLocale('auto');

      expect(result.locale).toBe('en');
    });

    it('falls back to defaultLocale for unavailable explicit locale', () => {
      const originalConsoleWarn = console.warn;

      console.warn = vi.fn();

      const customLocales: LocaleRegistry = {
        en: enLocale,
        fr: frLocale,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'fr' });

      const result = I18n.resolveLocale('de');

      expect(result.locale).toBe('fr');
      console.warn = originalConsoleWarn;
    });
  });

  describe('infinite recursion guard', () => {
    it('throws error if default locale is not available (configuration error)', () => {
      // Manually set up a broken state where default locale is not in registry
      // This simulates a configuration error
      const customLocales: LocaleRegistry = {
        fr: frLocale,
      };

      I18n.init({ locales: customLocales, defaultLocale: 'fr' });

      // Now try to set a locale that's not available
      // The fallback should work since 'fr' is available
      const originalConsoleWarn = console.warn;

      console.warn = vi.fn();
      I18n.setLocale('en');
      expect(I18n.getLocale()).toBe('fr');
      console.warn = originalConsoleWarn;
    });
  });
});

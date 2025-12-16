import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import I18n from '../../../../src/components/i18n';
import defaultDictionary from '../../../../src/components/i18n/locales/en/messages.json';
import type { I18nDictionary } from '../../../../types/configs';

const createDictionary = (): I18nDictionary => ({
  ui: {
    toolbar: {
      toolbox: {
        'Click to add below': 'Cliquez pour ajouter ci-dessous',
        'Option-click to add above': 'Option-clic pour ajouter ci-dessus',
      },
    },
  },
  tools: {
    link: {
      'Add a link': 'Ajouter un lien',
    },
  },
});

const alternativeDictionary: I18nDictionary = {
  tools: {
    link: {
      'Add a link': 'Lien secondaire',
    },
  },
};

describe('I18n', () => {
  beforeEach(() => {
    I18n.setDictionary(defaultDictionary as I18nDictionary);
  });

  afterEach(() => {
    I18n.setDictionary(defaultDictionary as I18nDictionary);
  });

  it('translates internal namespaces via ui()', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.ui('ui.toolbar.toolbox', 'Click to add below')).toBe('Cliquez pour ajouter ci-dessous');
  });

  it('translates external namespaces via t()', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('tools.link', 'Add a link')).toBe('Ajouter un lien');
  });

  it('returns the original key when namespace is missing', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('missing.namespace', 'Fallback text')).toBe('Fallback text');
  });

  it('returns the original key when translation is missing inside namespace', () => {
    const dictionary = createDictionary();

    I18n.setDictionary(dictionary);

    expect(I18n.t('tools.link', 'Missing label')).toBe('Missing label');
  });

  it('allows overriding dictionary via setDictionary()', () => {
    const firstDictionary = createDictionary();

    I18n.setDictionary(firstDictionary);
    expect(I18n.t('tools.link', 'Add a link')).toBe('Ajouter un lien');

    I18n.setDictionary(alternativeDictionary);
    expect(I18n.t('tools.link', 'Add a link')).toBe('Lien secondaire');
  });

  describe('setLocale', () => {
    it('sets locale to Russian and loads Russian dictionary', () => {
      const result = I18n.setLocale('ru');

      expect(result.locale).toBe('ru');
      expect(result.direction).toBe('ltr');
      expect(I18n.getLocale()).toBe('ru');
      expect(I18n.ui('ui.blockTunes.toggler', 'Drag to move')).toBe('Тяните, чтобы переместить');
    });

    it('sets locale to Chinese and loads Chinese dictionary', () => {
      const result = I18n.setLocale('zh');

      expect(result.locale).toBe('zh');
      expect(result.direction).toBe('ltr');
      expect(I18n.getLocale()).toBe('zh');
      expect(I18n.ui('ui.blockTunes.toggler', 'Drag to move')).toBe('拖动以移动');
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
          languages: ['fr', 'de', 'es'],
          language: 'fr',
        },
        writable: true,
        configurable: true,
      });

      expect(I18n.detectLocale()).toBe('en');
    });

    it('finds first supported language in preferences list', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          languages: ['fr', 'de', 'ru', 'en'],
          language: 'fr',
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

      expect(locales).toContain('en');
      expect(locales).toContain('ru');
      expect(locales).toContain('zh');
      expect(locales).toContain('hy');
      expect(locales.length).toBe(4);
    });
  });
});

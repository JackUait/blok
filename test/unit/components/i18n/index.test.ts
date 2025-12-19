import { afterEach, describe, expect, it } from 'vitest';

import { I18n } from '../../../../src/components/modules/i18n';
import {
  enLocale,
  loadLocale,
  ALL_LOCALE_CODES,
  getDirection,
} from '../../../../src/components/i18n/locales';
import type { I18nDictionary } from '../../../../types/configs';
import type { BlokConfig } from '../../../../types';
import { EventsDispatcher } from '../../../../src/components/utils/events';

/**
 * Creates a new I18n module instance for testing
 */
const createI18nModule = (config: Partial<BlokConfig> = {}): I18n => {
  return new I18n({
    config: config as BlokConfig,
    eventsDispatcher: new EventsDispatcher(),
  });
};

const createDictionary = (): I18nDictionary => ({
  'toolbox.addBelow': 'Cliquez pour ajouter ci-dessous',
  'toolbox.optionAddAbove': 'Option-clic pour ajouter ci-dessus',
  'tools.link.addLink': 'Ajouter un lien',
});

const alternativeDictionary: I18nDictionary = {
  'tools.link.addLink': 'Lien secondaire',
};

describe('I18n Module', () => {
  describe('t() translation method', () => {
    it('translates keys via t()', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const dictionary = createDictionary();

      i18n.setDictionary(dictionary);

      expect(i18n.t('toolbox.addBelow')).toBe('Cliquez pour ajouter ci-dessous');
      expect(i18n.t('tools.link.addLink')).toBe('Ajouter un lien');
    });

    it('returns the key when translation is missing', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const dictionary = createDictionary();

      i18n.setDictionary(dictionary);

      // i18next returns the full key when translation is missing
      expect(i18n.t('missing.namespace.fallback')).toBe('missing.namespace.fallback');
    });

    it('returns the key when translation is missing for existing namespace prefix', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const dictionary = createDictionary();

      i18n.setDictionary(dictionary);

      // i18next returns the full key when translation is missing
      expect(i18n.t('tools.link.missingLabel')).toBe('tools.link.missingLabel');
    });

    it('allows overriding dictionary via setDictionary()', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const firstDictionary = createDictionary();

      i18n.setDictionary(firstDictionary);
      expect(i18n.t('tools.link.addLink')).toBe('Ajouter un lien');

      i18n.setDictionary(alternativeDictionary);
      expect(i18n.t('tools.link.addLink')).toBe('Lien secondaire');
    });

    it('supports interpolation with vars parameter', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const dictionary: I18nDictionary = {
        'a11y.blockMoved': 'Block moved to position {position} of {total}',
      };

      i18n.setDictionary(dictionary);

      expect(i18n.t('a11y.blockMoved', { position: 3, total: 10 })).toBe(
        'Block moved to position 3 of 10'
      );
    });
  });

  describe('setLocale', () => {
    it('sets locale to Russian and loads Russian dictionary', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();
      await i18n.setLocale('ru');

      expect(i18n.getLocale()).toBe('ru');
      expect(i18n.t('blockSettings.dragToMove')).toBe('Тяните, чтобы переместить');
    });

    it('sets locale to Chinese and loads Chinese dictionary', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();
      await i18n.setLocale('zh');

      expect(i18n.getLocale()).toBe('zh');
      expect(i18n.t('blockSettings.dragToMove')).toBe('拖动以移动');
    });

    it('sets locale to English and loads English dictionary', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();
      await i18n.setLocale('ru');
      await i18n.setLocale('en');

      expect(i18n.getLocale()).toBe('en');
    });
  });

  describe('detectAndSetLocale', () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it('returns default locale when navigator is undefined', async () => {
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        configurable: true,
      });

      const i18n = createI18nModule();

      await i18n.prepare();
      const result = await i18n.detectAndSetLocale();

      expect(result).toBe('en');
    });

    it('returns default locale when no languages match', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['xyz', 'abc'],
          language: 'xyz',
        },
        configurable: true,
      });

      const i18n = createI18nModule();

      await i18n.prepare();
      const result = await i18n.detectAndSetLocale();

      expect(result).toBe('en');
    });

    it('matches exact locale code', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['ru', 'en'],
          language: 'ru',
        },
        configurable: true,
      });

      const i18n = createI18nModule();

      await i18n.prepare();
      const result = await i18n.detectAndSetLocale();

      expect(result).toBe('ru');
    });

    it('matches base language from full locale tag', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['en-US', 'fr-FR'],
          language: 'en-US',
        },
        configurable: true,
      });

      const i18n = createI18nModule();

      await i18n.prepare();
      const result = await i18n.detectAndSetLocale();

      expect(result).toBe('en');
    });
  });


  describe('has() method', () => {
    it('returns true when translation exists', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const dictionary: I18nDictionary = {
        'test.key': 'Test value',
      };

      i18n.setDictionary(dictionary);

      expect(i18n.has('test.key')).toBe(true);
    });

    it('returns false when translation does not exist', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const dictionary: I18nDictionary = {
        'test.key': 'Test value',
      };

      i18n.setDictionary(dictionary);

      expect(i18n.has('other.key')).toBe(false);
    });

    it('returns true for empty string translation (key exists)', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      const dictionary: I18nDictionary = {
        'test.key': '',
      };

      i18n.setDictionary(dictionary);

      // i18next's exists() returns true if key exists, even with empty value
      // Note: t() will return the key itself due to returnEmptyString: false
      expect(i18n.has('test.key')).toBe(true);
    });
  });

  describe('RTL direction detection', () => {
    it('returns rtl for Arabic', () => {
      const i18n = createI18nModule();

      expect(i18n.getDirectionForLocale('ar')).toBe('rtl');
    });

    it('returns rtl for Hebrew', () => {
      const i18n = createI18nModule();

      expect(i18n.getDirectionForLocale('he')).toBe('rtl');
    });

    it('returns rtl for Persian', () => {
      const i18n = createI18nModule();

      expect(i18n.getDirectionForLocale('fa')).toBe('rtl');
    });

    it('returns ltr for English', () => {
      const i18n = createI18nModule();

      expect(i18n.getDirectionForLocale('en')).toBe('ltr');
    });

    it('returns ltr for German', () => {
      const i18n = createI18nModule();

      expect(i18n.getDirectionForLocale('de')).toBe('ltr');
    });
  });

  describe('locale loading', () => {
    it('loads any of the 68 supported locales', async () => {
      const i18n = createI18nModule();

      await i18n.prepare();

      // Test loading a few different locales from different regions
      await i18n.setLocale('de');
      expect(i18n.getLocale()).toBe('de');

      await i18n.setLocale('ja');
      expect(i18n.getLocale()).toBe('ja');

      await i18n.setLocale('ar');
      expect(i18n.getLocale()).toBe('ar');

      await i18n.setLocale('fr');
      expect(i18n.getLocale()).toBe('fr');
    });
  });

  describe('locale system', () => {
    it('ALL_LOCALE_CODES contains all 68 supported locales', () => {
      expect(ALL_LOCALE_CODES.length).toBe(68);
    });

    it('loadLocale loads a specific locale', async () => {
      const frConfig = await loadLocale('fr');

      expect(frConfig).toBeDefined();
      expect(frConfig.dictionary).toBeDefined();
      expect(frConfig.direction).toBe('ltr');
    });

    it('enLocale is always available', () => {
      expect(enLocale).toBeDefined();
      expect(enLocale.dictionary).toBeDefined();
      expect(enLocale.direction).toBe('ltr');
    });

    it('getDirection returns correct direction for RTL locales', () => {
      expect(getDirection('ar')).toBe('rtl');
      expect(getDirection('he')).toBe('rtl');
      expect(getDirection('fa')).toBe('rtl');
    });

    it('getDirection returns ltr for LTR locales', () => {
      expect(getDirection('en')).toBe('ltr');
      expect(getDirection('fr')).toBe('ltr');
      expect(getDirection('de')).toBe('ltr');
    });
  });

  describe('prepare() with config', () => {
    it('uses custom messages when provided', async () => {
      const customMessages: I18nDictionary = {
        'test.key': 'Custom value',
      };

      const i18n = createI18nModule({
        i18n: { messages: customMessages },
      });

      await i18n.prepare();

      expect(i18n.t('test.key')).toBe('Custom value');
    });

    it('uses specified locale when provided', async () => {
      const i18n = createI18nModule({
        i18n: { locale: 'fr' },
      });

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('fr');
    });

    it('auto-detects locale when locale is "auto"', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          languages: ['fr', 'en'],
          language: 'fr',
        },
        configurable: true,
      });

      const i18n = createI18nModule({
        i18n: { locale: 'auto' },
      });

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('fr');
    });
  });
});

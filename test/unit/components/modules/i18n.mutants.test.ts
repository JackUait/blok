import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlokConfig } from '../../../../types';
import type { I18nDictionary } from '../../../../types/configs';
import type { SupportedLocale } from '../../../../types/configs/i18n-config';
import type { I18nChangedPayload } from '../../../../types/events/editor-events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { I18nextInitResult } from '../../../../src/components/i18n/i18next-loader';
import type * as I18nextLoaderModule from '../../../../src/components/i18n/i18next-loader';

import { I18n } from '../../../../src/components/modules/i18n';
import { I18nChanged } from '../../../../src/components/events';
import type { BlokEventMap } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';

type LoadI18next = (
  locale: SupportedLocale,
  localeConfig: { dictionary: I18nDictionary }
) => Promise<I18nextInitResult>;

const mocks = vi.hoisted(() => ({
  loadI18next: vi.fn(),
  repaintBlocks: vi.fn(),
  real: { loadI18next: undefined as undefined | LoadI18next },
}));

/*
 * The loader is spied rather than replaced: the number of times it runs is the
 * only observable difference between "i18next is loaded once and re-targeted"
 * and "a fresh instance per locale", and a fresh instance silently drops every
 * host override recorded on the previous one.
 */
vi.mock('../../../../src/components/i18n/i18next-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof I18nextLoaderModule>();

  mocks.real.loadI18next = actual.loadI18next;

  return { ...actual, loadI18next: mocks.loadI18next };
});

// Repainting needs a whole mounted editor; only the fact that it is requested matters here.
vi.mock('../../../../src/components/utils/repaint-blocks', () => ({
  repaintBlocks: mocks.repaintBlocks,
}));

/**
 * Runs the unmocked loader, so locale bundles behave exactly as in production.
 */
const realLoadI18next: LoadI18next = async (locale, localeConfig) => {
  const load = mocks.real.loadI18next;

  if (load === undefined) {
    throw new Error('the i18next loader module was never imported');
  }

  return load(locale, localeConfig);
};

/**
 * Makes the next i18next instance reject one `changeLanguage` call, which is
 * the only way into `setLocale`'s catch block with the wrapper already built.
 *
 * @param failing - locale whose switch should fail
 */
const failChangeLanguageFor = (failing: SupportedLocale): void => {
  mocks.loadI18next.mockImplementationOnce(async (
    locale: SupportedLocale,
    localeConfig: { dictionary: I18nDictionary }
  ): Promise<I18nextInitResult> => {
    const wrapper = await realLoadI18next(locale, localeConfig);

    return {
      ...wrapper,
      changeLanguage: async (next: SupportedLocale): Promise<void> => {
        if (next === failing) {
          throw new Error(`changeLanguage("${next}") failed`);
        }

        await wrapper.changeLanguage(next);
      },
    };
  });
};

interface Harness {
  i18n: I18n;
  config: BlokConfig;
  events: I18nChangedPayload[];
}

/**
 * Builds an I18n module with no editor chrome attached, plus a live record of
 * every `i18n:changed` payload it emits.
 *
 * @param config - editor config the module reads and writes
 */
const createHarness = (config: BlokConfig = {}): Harness => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const events: I18nChangedPayload[] = [];

  eventsDispatcher.on(I18nChanged, (payload) => {
    events.push(payload);
  });

  return { i18n: new I18n({ config, eventsDispatcher }), config, events };
};

interface EditorHarness extends Harness {
  refreshI18n: ReturnType<typeof vi.fn>;
  setDirection: ReturnType<typeof vi.fn>;
}

/**
 * Same, with the two chrome modules `update()` reaches for.
 *
 * @param config - editor config the module reads and writes
 */
const createEditorHarness = (config: BlokConfig = {}): EditorHarness => {
  const harness = createHarness(config);
  const refreshI18n = vi.fn();
  const setDirection = vi.fn();

  harness.i18n.state = {
    Toolbar: { refreshI18n },
    UI: { setDirection },
  } as unknown as BlokModules;

  return { ...harness, refreshI18n, setDirection };
};

describe('I18n module — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadI18next.mockImplementation(realLoadI18next);
    mocks.repaintBlocks.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('translation lookup routing', () => {
    it('answers from the active locale bundle, not from the English fallback', async () => {
      const { i18n } = createHarness();

      await i18n.prepare();
      await i18n.setLocale('ru');
      i18n.setDictionary({ 'host.custom.label': 'Хост' });

      expect(i18n.t('host.custom.label')).toBe('Хост');
      expect(i18n.has('host.custom.label')).toBe(true);
      expect(i18n.has('host.missing.label')).toBe(false);
    });

    it('goes back to English text and to the English store after returning to en', async () => {
      const { i18n } = createHarness();

      await i18n.prepare();
      await i18n.setLocale('ru');

      expect(i18n.t('blockSettings.dragToMove')).toBe('Перетащите, чтобы переместить');

      await i18n.setLocale('en');
      i18n.setDictionary({ 'host.after.switch': 'Back in English' });

      expect(i18n.getLocale()).toBe('en');
      // The i18next instance still says "ru"; reading from it here shows Russian.
      expect(i18n.t('blockSettings.dragToMove')).toBe('Drag to move');
      expect(i18n.t('host.after.switch')).toBe('Back in English');
      expect(i18n.has('host.after.switch')).toBe(true);
    });

    it('keeps English search terms reachable while another locale is active', async () => {
      const { i18n } = createHarness();

      await i18n.prepare();
      await i18n.setLocale('ru');

      expect(i18n.t('toolNames.heading')).toBe('Заголовок');
      expect(i18n.getEnglishTranslation('toolNames.heading')).toBe('Heading');
      expect(i18n.getEnglishTranslation('toolNames.notAToolAtAll')).toBe('');
    });
  });

  describe('setLocale', () => {
    it('serves English without ever loading i18next', async () => {
      const { i18n } = createHarness();

      await i18n.prepare();
      await i18n.setLocale('en');

      expect(i18n.getLocale()).toBe('en');
      expect(mocks.loadI18next).not.toHaveBeenCalled();
    });

    it('re-targets one i18next instance and keeps host overrides across a round trip', async () => {
      const { i18n } = createHarness();

      await i18n.prepare();
      await i18n.setLocale('ru');
      i18n.setDictionary({ 'toolNames.heading': 'Мой заголовок' });

      expect(i18n.t('toolNames.heading')).toBe('Мой заголовок');
      expect(i18n.t('toolNames.quote')).toBe('Цитата');

      await i18n.setLocale('fr');

      // 'Titre' only exists in the French bundle; English fallback would say 'Heading'.
      expect(i18n.t('toolNames.heading')).toBe('Titre');
      expect(i18n.t('blockSettings.dragToMove')).toBe('Glisser pour déplacer');

      await i18n.setLocale('ru');

      expect(i18n.t('toolNames.heading')).toBe('Мой заголовок');
      expect(mocks.loadI18next).toHaveBeenCalledTimes(1);
    });

    it('warns and falls back to the default locale when the chunk fails to load', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n } = createHarness();

      await i18n.prepare();
      mocks.loadI18next.mockRejectedValueOnce(new Error('chunk failed'));
      await i18n.setLocale('ru');

      expect(i18n.getLocale()).toBe('en');
      expect(i18n.t('blockSettings.dragToMove')).toBe('Drag to move');
      expect(warn).toHaveBeenCalledWith(
        'Failed to load locale "ru". Falling back to "en".',
        expect.any(Error)
      );
    });

    it('stops reading from i18next when a switch fails back onto English', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      failChangeLanguageFor('fr');

      const { i18n } = createHarness();

      await i18n.prepare();
      await i18n.setLocale('ru');
      await i18n.setLocale('fr');

      expect(i18n.getLocale()).toBe('en');
      // Leaving i18next in charge here would serve Russian under an 'en' locale.
      expect(i18n.t('blockSettings.dragToMove')).toBe('Drag to move');
    });

    it('keeps serving a non-English default locale after a failed switch', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      failChangeLanguageFor('ru');

      const { i18n } = createHarness({ i18n: { locale: 'fr', defaultLocale: 'fr' } });

      await i18n.prepare();

      expect(i18n.t('blockSettings.dragToMove')).toBe('Glisser pour déplacer');

      await i18n.setLocale('ru');

      expect(i18n.getLocale()).toBe('fr');
      // Resetting to the lightweight store here would drop French for English.
      expect(i18n.t('blockSettings.dragToMove')).toBe('Glisser pour déplacer');
    });

    it('does not serve the half-loaded locale when the very first switch fails', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      failChangeLanguageFor('ru');

      // The very first switch has to be the failing one: every completed
      // setLocale writes the "using i18next" flag, which would hide its
      // starting value.
      const { i18n } = createHarness({ i18n: { locale: 'ru', defaultLocale: 'fr' } });

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('fr');
      // The wrapper is built and initialised to 'ru' before the switch throws;
      // only the "not in use yet" flag keeps its Russian strings out of a
      // request that never succeeded.
      expect(i18n.t('blockSettings.dragToMove')).toBe('Drag to move');
    });
  });

  describe('prepare', () => {
    it('stamps the resolved direction on config.i18n without discarding host keys', async () => {
      const config: BlokConfig = { i18n: { locale: 'ar' } };
      const { i18n } = createHarness(config);

      await i18n.prepare();

      expect(config.i18n?.direction).toBe('rtl');
      expect(config.i18n?.locale).toBe('ar');
      expect(i18n.getDirection()).toBe('rtl');
    });

    it('creates config.i18n when the host supplied none', async () => {
      const config: BlokConfig = {};
      const { i18n } = createHarness(config);

      await i18n.prepare();

      expect(config.i18n?.direction).toBe('ltr');
    });

    it('honours an explicit direction over the one the locale implies', async () => {
      const config: BlokConfig = { i18n: { locale: 'ar', direction: 'ltr' } };
      const { i18n } = createHarness(config);

      await i18n.prepare();

      expect(config.i18n?.direction).toBe('ltr');
    });

    it('warns and falls back when config.i18n.locale is unsupported', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n } = createHarness({ i18n: { locale: 'xx', defaultLocale: 'fr' } });

      await i18n.prepare();

      expect(warn).toHaveBeenCalledWith(
        'Unsupported locale "xx" in config.i18n.locale. Falling back to "fr".'
      );
      expect(i18n.getLocale()).toBe('fr');
    });

    it('warns and keeps English when config.i18n.defaultLocale is unsupported', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n } = createHarness({ i18n: { locale: 'xx', defaultLocale: 'zzz' } });

      await i18n.prepare();

      expect(warn).toHaveBeenCalledWith('Unsupported defaultLocale "zzz". Keeping "en".');
      expect(i18n.getLocale()).toBe('en');
    });

    it('says nothing when no defaultLocale is configured', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n } = createHarness();

      await i18n.prepare();

      expect(warn).not.toHaveBeenCalled();
    });

    it('routes config.i18n.messages into the store t() reads', async () => {
      const { i18n } = createHarness({ i18n: { messages: { 'toolNames.heading': 'Config heading' } } });

      await i18n.prepare();

      expect(i18n.t('toolNames.heading')).toBe('Config heading');
      // Untouched keys still come from the base English bundle.
      expect(i18n.t('toolNames.quote')).toBe('Quote');
    });

    it('detects the browser locale for config.i18n.locale "auto"', async () => {
      vi.stubGlobal('navigator', { languages: ['ru-RU'], language: 'ru-RU' });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n } = createHarness({ i18n: { locale: 'auto' } });

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('ru');
      expect(warn).not.toHaveBeenCalled();
    });

    it('treats an empty locale tag as unsupported, not as "auto"', async () => {
      vi.stubGlobal('navigator', { languages: ['ru-RU'], language: 'ru-RU' });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n } = createHarness({ i18n: { locale: '', defaultLocale: 'fr' } });

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('fr');
      expect(warn).toHaveBeenCalledWith(
        'Unsupported locale "" in config.i18n.locale. Falling back to "fr".'
      );
    });
  });

  describe('direction lookup', () => {
    it('resolves the direction of any locale without changing the active one', () => {
      const { i18n } = createHarness();

      expect(i18n.getDirectionForLocale('ar')).toBe('rtl');
      expect(i18n.getDirectionForLocale('fr')).toBe('ltr');
      expect(i18n.getLocale()).toBe('en');
    });
  });

  describe('browser locale detection', () => {
    it('walks navigator.languages in order and skips the tags it cannot serve', async () => {
      vi.stubGlobal('navigator', { languages: ['', 'xx-YY', 'ru-RU'], language: 'de' });

      const { i18n } = createHarness();

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('ru');
    });

    it('falls back to navigator.language when the list is absent', async () => {
      vi.stubGlobal('navigator', { language: 'ru-RU' });

      const { i18n } = createHarness();

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('ru');
    });

    it('falls back to the configured default when nothing matches', async () => {
      vi.stubGlobal('navigator', { languages: ['xx', 'yy'], language: 'xx' });

      const { i18n } = createHarness({ i18n: { defaultLocale: 'fr' } });

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('fr');
    });

    it('uses the default locale in a runtime that has no navigator at all', async () => {
      // A server-side run: the global is genuinely absent, so `navigator.languages`
      // would be a TypeError rather than a miss.
      vi.stubGlobal('navigator', undefined);

      const { i18n } = createHarness({ i18n: { defaultLocale: 'fr' } });

      await i18n.prepare();

      expect(i18n.getLocale()).toBe('fr');
    });
  });

  describe('update', () => {
    it('repaints, relabels the chrome and announces a locale switch', async () => {
      const { i18n, events, refreshI18n, setDirection } = createEditorHarness();

      await i18n.prepare();
      await i18n.update({ locale: 'ru' });

      expect(i18n.getLocale()).toBe('ru');
      expect(i18n.t('blockSettings.dragToMove')).toBe('Перетащите, чтобы переместить');
      expect(setDirection).toHaveBeenCalledWith('ltr');
      expect(refreshI18n).toHaveBeenCalledTimes(1);
      expect(mocks.repaintBlocks).toHaveBeenCalledTimes(1);
      expect(events).toStrictEqual([{ locale: 'ru', direction: 'ltr' }]);
    });

    it('flips direction when the new locale is RTL', async () => {
      const config: BlokConfig = {};
      const { i18n, events, setDirection } = createEditorHarness(config);

      await i18n.prepare();
      await i18n.update({ locale: 'ar' });

      expect(setDirection).toHaveBeenCalledWith('rtl');
      expect(config.i18n?.direction).toBe('rtl');
      expect(events).toStrictEqual([{ locale: 'ar', direction: 'rtl' }]);
    });

    it('does nothing at all for an empty update', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n, events, refreshI18n, setDirection } = createEditorHarness();

      await i18n.prepare();
      await i18n.update({});

      expect(refreshI18n).not.toHaveBeenCalled();
      expect(setDirection).not.toHaveBeenCalled();
      expect(mocks.repaintBlocks).not.toHaveBeenCalled();
      expect(events).toStrictEqual([]);
      // An absent locale must not reach locale resolution, which would reject
      // `undefined` as an unsupported tag and warn about it.
      expect(warn).not.toHaveBeenCalled();
    });

    it('stays silent when the requested locale is already the active one', async () => {
      const { i18n, events, refreshI18n } = createEditorHarness();

      await i18n.prepare();
      await i18n.update({ locale: 'en' });

      expect(refreshI18n).not.toHaveBeenCalled();
      expect(mocks.repaintBlocks).not.toHaveBeenCalled();
      expect(events).toStrictEqual([]);
    });

    it('repaints for message overrides without touching direction', async () => {
      const { i18n, events, refreshI18n, setDirection } = createEditorHarness();

      await i18n.prepare();
      await i18n.update({ messages: { 'toolNames.heading': 'Section' } });

      expect(i18n.t('toolNames.heading')).toBe('Section');
      expect(mocks.repaintBlocks).toHaveBeenCalledTimes(1);
      expect(refreshI18n).toHaveBeenCalledTimes(1);
      expect(setDirection).not.toHaveBeenCalled();
      expect(events).toStrictEqual([{ locale: 'en', direction: 'ltr' }]);
    });

    it('applies an explicit direction without repainting blocks', async () => {
      const config: BlokConfig = {};
      const { i18n, events, refreshI18n, setDirection } = createEditorHarness(config);

      await i18n.prepare();
      await i18n.update({ direction: 'rtl' });

      expect(setDirection).toHaveBeenCalledWith('rtl');
      expect(config.i18n?.direction).toBe('rtl');
      expect(refreshI18n).toHaveBeenCalledTimes(1);
      expect(mocks.repaintBlocks).not.toHaveBeenCalled();
      expect(events).toStrictEqual([{ locale: 'en', direction: 'rtl' }]);
    });

    it('warns and changes nothing for an unsupported locale', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { i18n, events, refreshI18n } = createEditorHarness();

      await i18n.prepare();
      await i18n.update({ locale: 'xx' });

      expect(warn).toHaveBeenCalledWith(
        'Unsupported locale "xx" passed to i18n.update(). Keeping "en".'
      );
      expect(i18n.getLocale()).toBe('en');
      expect(refreshI18n).not.toHaveBeenCalled();
      expect(mocks.repaintBlocks).not.toHaveBeenCalled();
      expect(events).toStrictEqual([]);
    });

    it('re-runs browser detection for locale "auto"', async () => {
      const { i18n, events } = createEditorHarness({ i18n: { locale: 'en' } });

      await i18n.prepare();

      vi.stubGlobal('navigator', { languages: ['ru-RU'], language: 'ru-RU' });

      await i18n.update({ locale: 'auto' });

      expect(i18n.getLocale()).toBe('ru');
      expect(events).toStrictEqual([{ locale: 'ru', direction: 'ltr' }]);
    });

    it('replays host overrides onto the store that serves the new locale', async () => {
      const { i18n } = createEditorHarness();

      await i18n.prepare();
      await i18n.update({
        messages: { 'toolNames.heading': 'Custom heading', 'toolNames.quote': 'Custom quote' },
      });
      await i18n.update({ locale: 'ru' });

      expect(i18n.t('toolNames.heading')).toBe('Custom heading');
      expect(i18n.t('toolNames.quote')).toBe('Custom quote');
      expect(i18n.t('blockSettings.dragToMove')).toBe('Перетащите, чтобы переместить');
      expect(i18n.getEnglishTranslation('toolNames.heading')).toBe('Heading');
    });

    it('updates an editor whose toolbar and UI are not mounted', async () => {
      const { i18n, events } = createHarness();

      await i18n.prepare();
      await i18n.update({ direction: 'rtl' });

      expect(events).toStrictEqual([{ locale: 'en', direction: 'rtl' }]);
    });

    it('reports a direction even when config.i18n was never created', async () => {
      const { i18n, events } = createHarness();

      await i18n.update({ messages: { 'toolNames.heading': 'Section' } });

      expect(events).toStrictEqual([{ locale: 'en', direction: 'ltr' }]);
    });
  });
});

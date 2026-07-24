import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18n } from '../../../../src/components/modules/i18n';
import { normalizeLocale } from '../../../../src/components/i18n/locales';
import type { BlokConfig } from '../../../../types';
import { EventsDispatcher } from '../../../../src/components/utils/events';

const createI18nModule = (config: Partial<BlokConfig> = {}): I18n =>
  new I18n({
    config,
    eventsDispatcher: new EventsDispatcher(),
  });

describe('normalizeLocale (public BCP-47 normalizer)', () => {
  it('maps region subtags to the base supported locale', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('ru-RU')).toBe('ru');
    expect(normalizeLocale('fr-CA')).toBe('fr');
  });

  it('is case-insensitive', () => {
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('Ru-ru')).toBe('ru');
  });

  it('aliases nb (Norwegian Bokmål) to Blok "no"', () => {
    expect(normalizeLocale('nb')).toBe('no');
    expect(normalizeLocale('nb-NO')).toBe('no');
  });

  it('aliases ckb (canonical Central Kurdish) to Blok "ku"', () => {
    expect(normalizeLocale('ckb')).toBe('ku');
    expect(normalizeLocale('ckb-IR')).toBe('ku');
  });

  it('preserves Chinese script/region', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW');
    expect(normalizeLocale('zh-CN')).toBe('zh');
    expect(normalizeLocale('zh')).toBe('zh');
  });

  it('returns null for unsupported locales (the observable signal)', () => {
    expect(normalizeLocale('xx')).toBeNull();
    expect(normalizeLocale('klingon')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
  });
});

describe('I18n explicit paths normalize BCP-47 tags', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('config.i18n.locale accepts a region-tagged locale instead of silently falling back', async () => {
    const i18n = createI18nModule({ i18n: { locale: 'ru-RU' } });

    await i18n.prepare();

    expect(i18n.getLocale()).toBe('ru');
  });

  it('config.i18n.locale accepts an alias', async () => {
    const i18n = createI18nModule({ i18n: { locale: 'nb-NO' } });

    await i18n.prepare();

    expect(i18n.getLocale()).toBe('no');
  });

  it('config.i18n.defaultLocale accepts a region-tagged locale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Unsupported requested locale forces a fall back to defaultLocale.
    const i18n = createI18nModule({ i18n: { locale: 'xx', defaultLocale: 'fr-CA' } });

    await i18n.prepare();

    expect(i18n.getLocale()).toBe('fr');
    warn.mockRestore();
  });
});

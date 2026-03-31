// test/unit/tools/callout/emoji-picker/emoji-locale.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MOCK_FR_DATA = {
  '😀': { n: 'visage souriant', k: ['joyeux', 'rire'] },
  '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
};

describe('emoji-locale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadEmojiLocale returns locale data for a supported locale', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: MOCK_FR_DATA,
    }));

    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const data = await loadEmojiLocale('fr');

    expect(data).toEqual(MOCK_FR_DATA);
  });

  it('loadEmojiLocale returns null for English', async () => {
    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const data = await loadEmojiLocale('en');

    expect(data).toBeNull();
  });

  it('loadEmojiLocale returns null for unsupported locale', async () => {
    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const data = await loadEmojiLocale('xx');

    expect(data).toBeNull();
  });

  it('loadEmojiLocale caches result on second call', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: MOCK_FR_DATA,
    }));

    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const first = await loadEmojiLocale('fr');
    const second = await loadEmojiLocale('fr');

    expect(first).toBe(second);
  });

  it('getTranslatedName returns translated name when available', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: MOCK_FR_DATA,
    }));

    const { loadEmojiLocale, getTranslatedName } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    await loadEmojiLocale('fr');
    const name = getTranslatedName('💡', 'fr');

    expect(name).toBe('ampoule');
  });

  it('getTranslatedName returns null when locale not loaded', async () => {
    const { getTranslatedName } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const name = getTranslatedName('💡', 'fr');

    expect(name).toBeNull();
  });

  it('getTranslatedName returns null when emoji not in locale data', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: MOCK_FR_DATA,
    }));

    const { loadEmojiLocale, getTranslatedName } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    await loadEmojiLocale('fr');
    const name = getTranslatedName('🦄', 'fr');

    expect(name).toBeNull();
  });

  it('getTranslatedKeywords returns translated keywords when available', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: MOCK_FR_DATA,
    }));

    const { loadEmojiLocale, getTranslatedKeywords } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    await loadEmojiLocale('fr');
    const keywords = getTranslatedKeywords('💡', 'fr');

    expect(keywords).toEqual(['idée', 'lumière']);
  });

  it('getTranslatedKeywords returns null when locale not loaded', async () => {
    const { getTranslatedKeywords } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const keywords = getTranslatedKeywords('💡', 'fr');

    expect(keywords).toBeNull();
  });
});

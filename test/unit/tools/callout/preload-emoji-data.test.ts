// test/unit/tools/callout/preload-emoji-data.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loaders = vi.hoisted(() => ({
  loadEmojiData: vi.fn(),
  loadEmojiLocale: vi.fn(),
}));

vi.mock('../../../../src/components/utils/emoji/emoji-data', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadEmojiData: loaders.loadEmojiData,
}));

vi.mock('../../../../src/components/utils/emoji/emoji-locale', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadEmojiLocale: loaders.loadEmojiLocale,
}));

describe('preloadEmojiData on the ./tools entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaders.loadEmojiData.mockResolvedValue([]);
    loaders.loadEmojiLocale.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warms the emoji dataset only, for the default English locale', async () => {
    const { preloadEmojiData } = await import('../../../../src/tools/index');

    preloadEmojiData();

    expect(loaders.loadEmojiData).toHaveBeenCalledTimes(1);
    expect(loaders.loadEmojiLocale).not.toHaveBeenCalled();
  });

  it('also warms the emoji names of the given locale', async () => {
    const { preloadEmojiData } = await import('../../../../src/tools/index');

    preloadEmojiData('ru');

    expect(loaders.loadEmojiData).toHaveBeenCalledTimes(1);
    expect(loaders.loadEmojiLocale).toHaveBeenCalledWith('ru');
  });
});

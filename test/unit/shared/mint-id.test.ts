// @vitest-environment node
import { urlAlphabet } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintId } from '../../../src/shared/mint-id';

const ALPHABET = '57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mintId', () => {
  it('defaults to ten URL-safe characters and honors the requested length', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(mintId()).toBe('5555555555');
    expect(mintId(12)).toBe('555555555555');
    expect(mintId(0)).toBe('');
  });

  it('maps crypto bytes through all 64 installed nanoid alphabet characters', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array): Uint8Array => {
      bytes.set(Array.from({ length: bytes.length }, (_, index) => index));

      return bytes;
    });

    vi.stubGlobal('crypto', { getRandomValues });
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Crypto must not fall back to Math.random');
    });

    expect(mintId(64)).toBe(ALPHABET);
    expect(urlAlphabet).toBe(ALPHABET);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(64);
  });

  it('masks high crypto byte bits to stay inside the URL-safe alphabet', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array): Uint8Array => {
        bytes.set([0, 1, 63, 64, 127, 128, 191, 255]);

        return bytes;
      },
    });

    expect(mintId(8)).toBe('57959599');
  });

  it('uses Math.random without crypto or a Uint8Array global', () => {
    let index = 0;

    vi.stubGlobal('crypto', undefined);
    vi.stubGlobal('Uint8Array', undefined);
    vi.spyOn(Math, 'random').mockImplementation(() => (index++ % 64) / 64);

    expect(mintId(64)).toBe(ALPHABET);
    expect(mintId()).toBe('57X6y3wQZN');
  });

  it('falls back when crypto has no callable getRandomValues', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1 - Number.EPSILON);
    vi.stubGlobal('crypto', {});

    expect(mintId(3)).toBe('999');

    vi.stubGlobal('crypto', { getRandomValues: undefined });

    expect(mintId(3)).toBe('999');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokConfig } from '../../../types';
import { Core } from '../../../src/components/core';

const createCore = (extra: Partial<BlokConfig>): Core =>
  new Core({ holder: 'tab-sync-holder', logLevel: 'ERROR', ...extra } as BlokConfig);

/**
 * The boot error, or null when boot got through.
 * @param core - the editor under test
 */
const bootError = async (core: Core): Promise<string | null> => {
  try {
    await core.isReady;

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe('Core tab sync config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('refuses a non-string documentId', async () => {
    await expect(createCore({ documentId: 42 as unknown as string }).isReady)
      .rejects.toThrow('documentId must be a non-empty string');
  });

  it('refuses an empty documentId', async () => {
    await expect(createCore({ documentId: '' }).isReady)
      .rejects.toThrow('documentId must be a non-empty string');
  });

  it('refuses a tabSync that is neither boolean nor object', async () => {
    await expect(createCore({ tabSync: 'yes' as unknown as boolean }).isReady)
      .rejects.toThrow('tabSync must be a boolean or an object');
  });

  it('accepts a string documentId with an object or boolean tabSync', async () => {
    const objectForm = await bootError(createCore({ documentId: 'acme:42', tabSync: { settings: false } }));
    const booleanForm = await bootError(createCore({ documentId: 'acme:42', tabSync: false }));

    expect(objectForm ?? '').not.toMatch(/documentId must|tabSync must/);
    expect(booleanForm ?? '').not.toMatch(/documentId must|tabSync must/);
  });
});

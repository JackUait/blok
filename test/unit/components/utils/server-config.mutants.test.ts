import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spies = vi.hoisted(() => ({
  passCalls: [] as unknown[],
  uploaderCalls: [] as { baseUrl: string; headers?: unknown }[],
  pass: async (): Promise<Record<string, string>> => ({ Authorization: 'pass' }),
}));

vi.mock('../../../../src/components/utils/access-pass', () => ({
  createPassSource: (options: unknown): unknown => {
    spies.passCalls.push(options);

    return spies.pass;
  },
}));

vi.mock('../../../../src/components/utils/fetch-uploader', () => ({
  createFetchUploader: (options: { baseUrl: string; headers?: unknown }): unknown => {
    spies.uploaderCalls.push(options);

    return { uploadByFile: async (): Promise<never> => { throw new Error('unused'); } };
  },
}));

import { expandServerConfig } from '../../../../src/components/utils/server-config';
import type { BlokConfig } from '../../../../types';

class Bookmark {}

const config = (shape: Record<string, unknown>): BlokConfig => shape;

const bookmarkOf = (expanded: BlokConfig): Record<string, unknown> => {
  const entry = expanded.tools?.bookmark;

  if (typeof entry !== 'object' || entry === null) {
    throw new Error('bookmark was not rewritten into settings');
  }

  return entry as unknown as Record<string, unknown>;
};

const bookmarkConfigOf = (expanded: BlokConfig): Record<string, unknown> => {
  const nested = bookmarkOf(expanded).config;

  if (typeof nested !== 'object' || nested === null) {
    throw new Error('bookmark carries no nested config');
  }

  return nested as Record<string, unknown>;
};

/**
 * Four survivors are equivalent, all on the "is this entry an object" test in
 * withConfig. Forcing either operand true, or joining them with `||`, only ever
 * lets `undefined` or `null` reach the spread — and spreading either of those
 * produces exactly the bare `{ config }` the fallback returns. No tool entry the
 * config type admits is anything but a constructable, settings, or absent.
 */
describe('server config expansion mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spies.passCalls.length = 0;
    spies.uploaderCalls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves a config with no server shorthand exactly as it was', () => {
    const original = config({ tools: {} });

    expect(expandServerConfig(original)).toBe(original);
  });

  it('builds an uploader on the trimmed base and points bookmark at unfurl', () => {
    const expanded = expandServerConfig(config({ server: 'https://api.example.com//' }));

    expect(expanded.uploader).toBeDefined();
    expect(spies.uploaderCalls).toStrictEqual([{ baseUrl: 'https://api.example.com', headers: undefined }]);
    expect(bookmarkConfigOf(expanded)).toStrictEqual({ endpoint: 'https://api.example.com/unfurl' });
  });

  // With no ticket there is no pass to hand out, so the bookmark config must
  // not gain a headers key at all.
  it('mints no pass source without a ticket', () => {
    const expanded = expandServerConfig(config({ server: 'https://api.example.com' }));

    expect(spies.passCalls).toStrictEqual([]);
    expect('headers' in bookmarkConfigOf(expanded)).toBe(false);
  });

  it('mints one pass source and gives it to the uploader and the bookmark', () => {
    const expanded = expandServerConfig(config({
      server: 'https://api.example.com',
      ticket: 'https://api.example.com/ticket',
    }));

    expect(spies.passCalls).toStrictEqual([{ endpoint: 'https://api.example.com/ticket' }]);
    expect(spies.uploaderCalls[0].headers).toBe(spies.pass);
    expect(bookmarkConfigOf(expanded).headers).toBe(spies.pass);
  });

  it('keeps every key of a bookmark registered as settings', () => {
    const expanded = expandServerConfig(config({
      server: 'https://api.example.com',
      tools: { bookmark: { class: Bookmark, shortcut: 'CMD+B' } },
    }));

    expect(bookmarkOf(expanded)).toStrictEqual({
      class: Bookmark,
      shortcut: 'CMD+B',
      config: { endpoint: 'https://api.example.com/unfurl' },
    });
  });

  it('moves a bare constructable under class to make room for the config', () => {
    const expanded = expandServerConfig(config({
      server: 'https://api.example.com',
      tools: { bookmark: Bookmark },
    }));

    expect(bookmarkOf(expanded)).toStrictEqual({
      class: Bookmark,
      config: { endpoint: 'https://api.example.com/unfurl' },
    });
  });

  // A null entry is the one value that is typeof "object" and cannot be read
  // from, so the null half of every guard is what keeps this from throwing.
  it('tolerates a bookmark registered as null', () => {
    const expanded = expandServerConfig(config({
      server: 'https://api.example.com',
      tools: { bookmark: null },
    }));

    expect(bookmarkOf(expanded)).toStrictEqual({
      config: { endpoint: 'https://api.example.com/unfurl' },
    });
  });

  it('leaves the tools untouched when the bookmark already has an endpoint', () => {
    const original = config({
      server: 'https://api.example.com',
      tools: { bookmark: { class: Bookmark, config: { endpoint: 'https://mine.example.com/unfurl' } } },
    });
    const expanded = expandServerConfig(original);

    expect(expanded.tools).toBe(original.tools);
  });
});

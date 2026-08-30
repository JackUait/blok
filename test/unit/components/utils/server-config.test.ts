import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandServerConfig } from '../../../../src/components/utils/server-config';
import type { BlokConfig } from '../../../../types';

/**
 * `tools` values are `ToolConstructable | ToolSettings`, so the settings side
 * has to be narrowed before its `config` is readable.
 * @param config - the expanded configuration under test
 * @param toolName - which tool's settings to read
 */
const toolConfig = (config: BlokConfig, toolName: string): Record<string, unknown> | undefined => {
  const settings = config.tools?.[toolName];

  if (typeof settings !== 'object' || settings === null || !('config' in settings)) {
    return undefined;
  }

  return settings.config;
};

describe('expandServerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves a config without `server` untouched', () => {
    const config: BlokConfig = { holder: 'app' };

    expect(expandServerConfig(config)).toEqual(config);
  });

  it('fills in an uploader and the bookmark endpoint from one key', () => {
    const result = expandServerConfig({ server: 'https://blok.example.com' });

    expect(result.uploader?.uploadByFile).toBeTypeOf('function');
    expect(toolConfig(result, 'bookmark')?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  it('strips a trailing slash so the endpoint has no double slash', () => {
    const result = expandServerConfig({ server: 'https://blok.example.com/' });

    expect(toolConfig(result, 'bookmark')?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  it('normalizes a long internal slash run without polynomial backtracking', () => {
    const server = `https://blok.example.com/${'/'.repeat(16_000)}x`;
    const startedAt = performance.now();

    const result = expandServerConfig({ server });
    const elapsed = performance.now() - startedAt;

    expect(elapsed).toBeLessThan(1_000);
    expect(toolConfig(result, 'bookmark')?.endpoint).toBe(`${server}/unfurl`);
  });

  // The spec's precedence rule: paths mix. "Service for previews, own S3 for
  // files" must work without any bridging code.
  it('keeps an explicit uploader and still fills the bookmark endpoint', () => {
    const uploader = { uploadByFile: vi.fn() };

    const result = expandServerConfig({ server: 'https://blok.example.com', uploader });

    expect(result.uploader).toBe(uploader);
    expect(toolConfig(result, 'bookmark')?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  it('keeps an explicit bookmark endpoint and still fills the uploader', () => {
    const result = expandServerConfig({
      server: 'https://blok.example.com',
      tools: { bookmark: { config: { endpoint: 'https://unfurl.mine.example.com' } } },
    });

    expect(toolConfig(result, 'bookmark')?.endpoint).toBe('https://unfurl.mine.example.com');
    expect(result.uploader?.uploadByFile).toBeTypeOf('function');
  });

  it('preserves unrelated tool config while filling the bookmark endpoint', () => {
    const result = expandServerConfig({
      server: 'https://blok.example.com',
      tools: { image: { config: { types: 'image/png' } } },
    });

    expect(toolConfig(result, 'image')?.types).toBe('image/png');
    expect(toolConfig(result, 'bookmark')?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  // A tool may be registered as a bare constructable. Filling its endpoint must
  // not throw away the class the consumer registered.
  it('keeps a bookmark tool registered as a constructable', () => {
    class CustomBookmark {}

    const result = expandServerConfig({
      server: 'https://blok.example.com',
      tools: { bookmark: CustomBookmark as unknown as NonNullable<BlokConfig['tools']>[string] },
    });

    const settings = result.tools?.bookmark;

    expect(typeof settings === 'object' && settings !== null && settings.class).toBe(CustomBookmark);
    expect(toolConfig(result, 'bookmark')?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  describe('with a ticket endpoint', () => {
    const PASS = `x.${btoa(JSON.stringify({ exp: 4102444800 })).replace(/=+$/, '')}.y`;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticket: PASS }) });
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('gives the bookmark tool a headers function rather than a frozen object', async () => {
      const result = expandServerConfig({
        server: 'https://blok.example.com',
        ticket: '/api/blok-ticket',
      });
      const headers = toolConfig(result, 'bookmark')?.headers;

      expect(headers).toBeTypeOf('function');
      await expect((headers as () => Promise<Record<string, string>>)())
        .resolves.toEqual({ Authorization: `Bearer ${PASS}` });
    });

    // Uploads and previews must share one pass. Two sources would mint two
    // passes on load and double the traffic to the host's minting route.
    it('feeds uploads and previews from one cached pass', async () => {
      const result = expandServerConfig({
        server: 'https://blok.example.com',
        ticket: '/api/blok-ticket',
      });
      const headers = toolConfig(result, 'bookmark')?.headers as () => Promise<Record<string, string>>;

      await headers();
      await result.uploader?.uploadByUrl?.('https://elsewhere.example.net/i.png', { kind: 'image' })
        .catch(() => undefined);

      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/blok-ticket')).toHaveLength(1);
    });

    it('keeps headers the consumer set on the bookmark tool', () => {
      const result = expandServerConfig({
        server: 'https://blok.example.com',
        ticket: '/api/blok-ticket',
        tools: { bookmark: { config: { headers: { Authorization: 'Bearer mine' } } } },
      });

      expect(toolConfig(result, 'bookmark')?.headers).toEqual({ Authorization: 'Bearer mine' });
    });

    it('ignores a ticket endpoint when there is no server to point it at', () => {
      const config: BlokConfig = { ticket: '/api/blok-ticket' };

      expect(expandServerConfig(config)).toEqual(config);
    });
  });

  it('does not mutate the config it was given', () => {
    const config: BlokConfig = { server: 'https://blok.example.com' };

    expandServerConfig(config);

    expect(config.uploader).toBeUndefined();
    expect(config.tools).toBeUndefined();
  });
});

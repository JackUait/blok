import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('does not mutate the config it was given', () => {
    const config: BlokConfig = { server: 'https://blok.example.com' };

    expandServerConfig(config);

    expect(config.uploader).toBeUndefined();
    expect(config.tools).toBeUndefined();
  });
});

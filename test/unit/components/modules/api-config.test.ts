import { describe, it, expect, beforeEach, vi } from 'vitest';
import { API } from '../../../../src/components/modules/api';
import type { BlokConfig } from '../../../../types';

const makeApi = (config: Partial<BlokConfig>): API => {
  const api = new API({
    config: config as BlokConfig,
    eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as never,
  });

  // Each `methods` getter reads a sibling API namespace off `this.Blok`; back it
  // with a Proxy so every namespace resolves to a stub and only `config` matters.
  const blokStub = new Proxy(
    {},
    { get: () => ({ methods: {}, classes: {} }) }
  );

  api.state = blokStub as never;

  return api;
};

describe('API.config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the linkPaste config slice', () => {
    const api = makeApi({ linkPaste: { menu: true, allowGenericEmbed: true } });

    expect(api.methods.config.linkPaste?.allowGenericEmbed).toBe(true);
    expect(api.methods.config.linkPaste?.menu).toBe(true);
  });

  it('returns undefined linkPaste when unset', () => {
    const api = makeApi({});

    expect(api.methods.config.linkPaste).toBeUndefined();
  });
});

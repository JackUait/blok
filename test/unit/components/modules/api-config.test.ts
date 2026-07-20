import { describe, it, expect, beforeEach, vi } from 'vitest';
import { API } from '../../../../src/components/modules/api';
import type { BlokConfig } from '../../../../types';

const makeApi = (config: Partial<BlokConfig>): API => {
  const api = new API({
    config: config,
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
    const api = makeApi({ linkPaste: { allowGenericEmbed: true } });

    expect(api.methods.config.linkPaste?.allowGenericEmbed).toBe(true);
  });

  it('returns undefined linkPaste when unset', () => {
    const api = makeApi({});

    expect(api.methods.config.linkPaste).toBeUndefined();
  });

  it('exposes the link config slice', () => {
    const transformHref = (href: string): string => href;
    const api = makeApi({ link: { target: '_self', rel: 'noopener', transformHref } });

    expect(api.methods.config.link?.target).toBe('_self');
    expect(api.methods.config.link?.rel).toBe('noopener');
    expect(api.methods.config.link?.transformHref).toBe(transformHref);
  });

  it('returns undefined link when unset', () => {
    const api = makeApi({});

    expect(api.methods.config.link).toBeUndefined();
  });
});

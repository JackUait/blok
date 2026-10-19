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

  it('exposes the media config slice', () => {
    const convert = async (): Promise<null> => null;
    const api = makeApi({ media: { formats: { image: ['avif', 'jpeg'] }, convert } });

    expect(api.methods.config.media?.formats?.image).toEqual(['avif', 'jpeg']);
    expect(api.methods.config.media?.convert).toBe(convert);
  });

  it('returns undefined media when unset', () => {
    const api = makeApi({});

    expect(api.methods.config.media).toBeUndefined();
  });

  it('exposes the user a new block is stamped with, undefined when unset', () => {
    expect(makeApi({ user: { id: 'u-ada' } }).methods.config.user?.id).toBe('u-ada');
    expect(makeApi({}).methods.config.user).toBeUndefined();
  });

  it('exposes the agent config slice, so a tool can tell whether an assistant is set', () => {
    const model = async (): Promise<{ content: []; stop_reason: null }> => ({ content: [], stop_reason: null });
    const api = makeApi({ agent: { assistant: { model } } });

    expect(api.methods.config.agent?.assistant?.model).toBe(model);
  });

  it('returns undefined agent when unset', () => {
    const api = makeApi({});

    expect(api.methods.config.agent).toBeUndefined();
  });
});

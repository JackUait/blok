import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import type { API, BlockToolConstructorOptions } from '../../../../types';

interface LinkPaste {
  allowGenericEmbed?: boolean;
  allowedEmbedOrigins?: string[];
  hostAliases?: string[];
}

const mount = (source: string, linkPaste: LinkPaste): HTMLElement => {
  const options = {
    api: {
      i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
      blocks: { delete: (): void => undefined },
      config: { linkPaste },
    } as unknown as API,
    block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
    config: {},
    readOnly: true,
    data: { service: '', source, embed: source, kind: 'iframe' },
  } as BlockToolConstructorOptions<EmbedData>;

  return new Embed(options).render();
};

const pageHost = (): string => window.location.hostname;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Embed — never frames the host\'s own site', () => {
  it('shows a link card for the page\'s own host, even when allowlisted', () => {
    const source = `https://${pageHost()}/settings`;

    for (const root of [
      mount(source, { allowGenericEmbed: true }),
      mount(source, { allowedEmbedOrigins: [pageHost()] }),
    ]) {
      expect(root.querySelector('iframe')).toBeNull();
      expect(root.querySelector('[data-role="embed-link-card-anchor"]')?.getAttribute('href')).toBe(source);
    }
  });

  it.each([
    ['the alias itself', 'https://app.example.com/admin'],
    ['a subdomain of an alias', 'https://uploads.app.example.com/x.html'],
    ['a parent domain of an alias', 'https://example.com/'],
  ])('shows a link card for %s', (_name, source) => {
    const root = mount(source, {
      allowGenericEmbed: true,
      allowedEmbedOrigins: ['*.example.com', 'example.com'],
      hostAliases: ['app.example.com'],
    });

    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('[data-blok-testid="embed-link-card"]')).not.toBeNull();
  });

  it('still frames a lookalike host that is not the same site', () => {
    const root = mount('https://evilexample.com/x', { allowGenericEmbed: true, hostAliases: ['app.example.com'] });

    expect(root.querySelector('iframe')?.getAttribute('src')).toBe('https://evilexample.com/x');
  });

  it('still frames a registry provider whatever the host is', () => {
    const options = {
      api: {
        i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
        blocks: { delete: (): void => undefined },
        config: { linkPaste: { hostAliases: ['youtube.com'] } },
      } as unknown as API,
      block: { id: 'b', dispatchChange: (): void => undefined } as never,
      config: {},
      readOnly: true,
      data: {
        service: 'youtube',
        source: 'https://youtu.be/dQw4w9WgXcQ',
        embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      },
    } as BlockToolConstructorOptions<EmbedData>;

    expect(new Embed(options).render().querySelector('iframe')).not.toBeNull();
  });
});

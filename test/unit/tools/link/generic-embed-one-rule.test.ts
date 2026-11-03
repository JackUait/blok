import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { pageHosts } from '../../../../src/tools/link/host-pattern';
import { buildPasteMenuOptions } from '../../../../src/tools/link/paste-menu/options';
import type { API, BlockToolConstructorOptions } from '../../../../types';

interface LinkPaste {
  allowGenericEmbed?: boolean;
  allowedEmbedOrigins?: string[];
  hostAliases?: string[];
}

const toolFrames = (source: string, linkPaste: LinkPaste): boolean => {
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

  return new Embed(options).render().querySelector('[data-blok-testid="embed-link-card"]') === null;
};

const menuOffersEmbed = (url: string, linkPaste: LinkPaste): boolean =>
  buildPasteMenuOptions(url, {
    hasSelection: false,
    allowGenericEmbed: linkPaste.allowGenericEmbed === true,
    allowedEmbedOrigins: linkPaste.allowedEmbedOrigins ?? [],
    ownHosts: pageHosts(linkPaste.hostAliases),
  }).some((option) => option.type === 'embed');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generic embeds — the paste menu offers exactly what the tool frames', () => {
  it.each<[string, string, LinkPaste]>([
    ['an alias written with a trailing dot', 'https://example.com/x', { allowGenericEmbed: true, hostAliases: ['example.com.'] }],
    ['a subdomain of a trailing-dot alias', 'https://app.example.com/x', { allowGenericEmbed: true, hostAliases: ['example.com.'] }],
    ['a wildcard alias', 'https://a.example.com/x', { allowGenericEmbed: true, hostAliases: ['*.example.com'] }],
    ['a parent domain of an alias', 'https://example.com/', { allowGenericEmbed: true, hostAliases: ['app.example.com'] }],
    ['a child domain of an alias', 'https://cdn.app.example.com/', { allowGenericEmbed: true, hostAliases: ['app.example.com'] }],
    ['a url with a trailing-dot host', 'https://app.example.com./', { allowGenericEmbed: true, hostAliases: ['app.example.com'] }],
    ['plain http', 'http://other.test/', { allowGenericEmbed: true }],
    ['a port on an allowed origin', 'https://dash.test:8443/', { allowedEmbedOrigins: ['dash.test'] }],
    ['a host off the allow list', 'https://other.test/', { allowedEmbedOrigins: ['dash.test'] }],
    ['an unrelated host with generic embeds on', 'https://other.test/', { allowGenericEmbed: true }],
    ['the page host', `https://${window.location.hostname}/`, { allowGenericEmbed: true }],
  ])('agrees for %s', (_name, url, linkPaste) => {
    expect(menuOffersEmbed(url, linkPaste)).toBe(toolFrames(url, linkPaste));
  });
});

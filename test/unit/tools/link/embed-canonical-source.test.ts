import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { buildPasteMenuOptions } from '../../../../src/tools/link/paste-menu/options';
import { isHttpUrl, isHttpsUrl, setSafeLinkHref } from '../../../../src/tools/link/registry';
import type { API, BlockToolConstructorOptions, PatternPasteEvent } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const OWN = 'app.example.com';

const make = (data: Partial<EmbedData>, linkPaste: LinkPaste, readOnly = true): Embed => new Embed({
  api: {
    i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
    blocks: { delete: (): void => undefined },
    config: { linkPaste },
    events: { on: (): void => undefined, off: (): void => undefined },
  } as unknown as API,
  block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
  config: {},
  readOnly,
  data,
} as BlockToolConstructorOptions<EmbedData>);

const generic = (source: string): Partial<EmbedData> => ({ service: '', source, embed: source, kind: 'iframe' });

/** Every URL the rendered block would load or link to, resolved the way the browser does. */
const resolvedUrls = (root: HTMLElement): string[] => [
  ...[...root.querySelectorAll('iframe')].map((frame) => frame.src),
  ...[...root.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
];

let base: HTMLBaseElement;

beforeEach(() => {
  vi.clearAllMocks();
  // The page is https, so a non-`//` https value resolves against it.
  base = document.createElement('base');
  base.href = `https://${OWN}/docs/page`;
  document.head.appendChild(base);
});

afterEach(() => {
  base.remove();
  vi.restoreAllMocks();
});

describe('Embed — a generic source must be an absolute https:// URL', () => {
  it.each([
    ['https:/admin/delete', { allowGenericEmbed: true }],
    ['https:good.com', { allowGenericEmbed: true }],
    ['HTTPS:\\settings', { allowGenericEmbed: true }],
    ['https:/allowed.com/../admin/delete', { allowedEmbedOrigins: ['allowed.com'] }],
  ])('never loads or links the own site for %s', (source, linkPaste) => {
    for (const clickToLoad of [false, true]) {
      const root = make(generic(source), { ...linkPaste, hostAliases: [OWN], genericEmbedClickToLoad: clickToLoad }).render();

      expect(root.querySelector('iframe')).toBeNull();
      expect(root.querySelector('button[data-role="embed-load"]')).toBeNull();
      expect(resolvedUrls(root).filter((url) => new URL(url).hostname === OWN)).toEqual([]);
    }
  });

  it('frames and saves the canonical href, never the raw string', () => {
    const tool = make(generic('https://Allowed.COM/a/../b'), {
      allowedEmbedOrigins: ['allowed.com'],
      genericEmbedClickToLoad: false,
    });
    const root = tool.render();

    expect(root.querySelector('iframe')?.getAttribute('src')).toBe('https://allowed.com/b');
    expect(tool.save()).toMatchObject({ source: 'https://allowed.com/b', embed: 'https://allowed.com/b' });
  });

  it('gives the link card the canonical href', () => {
    const root = make(generic('https://Other.test/x/../y'), {}).render();

    expect(root.querySelector('[data-role="embed-link-card-anchor"]')?.getAttribute('href')).toBe('https://other.test/y');
  });

  it('stores the canonical href when a URL is pasted', () => {
    const tool = make({}, { allowedEmbedOrigins: ['allowed.com'] }, false);

    tool.render();
    tool.onPaste({ type: 'pattern', detail: { key: 'embed', data: 'https://ALLOWED.com/p' } } as PatternPasteEvent);

    expect(tool.save()).toMatchObject({ source: 'https://allowed.com/p', embed: 'https://allowed.com/p' });
  });

  it('keeps a saved block whose source has no `//` instead of dropping it', () => {
    const tool = make(generic('https:good.com'), { allowGenericEmbed: true });

    tool.render();
    const saved = tool.save();

    expect(saved.source).toBe('https:good.com');
    expect(tool.validate(saved)).toBe(true);
  });
});

describe('URL helpers — only absolute `scheme://` URLs count', () => {
  it.each(['https:/admin', 'https:good.com', 'HTTPS:\\settings', 'http:/x', 'http:host.com'])('rejects %s', (value) => {
    expect(isHttpUrl(value)).toBe(false);
    expect(isHttpsUrl(value)).toBe(false);
  });

  it.each(['https://a.test/x', 'HTTPS://A.test', '  https://a.test'])('accepts %s', (value) => {
    expect(isHttpsUrl(value)).toBe(true);
  });

  it('writes the canonical href on an anchor', () => {
    const anchor = document.createElement('a');

    setSafeLinkHref(anchor, 'HTTPS://Example.COM/a/../b');

    expect(anchor.getAttribute('href')).toBe('https://example.com/b');
  });

  it('offers only a plain link for a pasted non-`//` URL', () => {
    expect(buildPasteMenuOptions('https:/admin/delete', { hasSelection: false, allowGenericEmbed: true, ownHosts: [OWN] }))
      .toEqual([{ type: 'plain' }]);
  });
});

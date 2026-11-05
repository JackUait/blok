import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { genericEmbedPolicy } from '../../../../src/tools/link/generic-embed-policy';
import { buildPasteMenuOptions } from '../../../../src/tools/link/paste-menu/options';
import type { API, BlockToolConstructorOptions, PatternPasteEvent } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const make = (data: Partial<EmbedData>, linkPaste: LinkPaste, readOnly: boolean): Embed => new Embed({
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

/** The src the stored block frames, or null. */
const storedSrc = (url: string, linkPaste: LinkPaste): string | null =>
  make({ service: '', source: url, embed: 'https://other.example.net/', kind: 'iframe' }, linkPaste, true)
    .render().querySelector('iframe')?.getAttribute('src') ?? null;

/** The src after the URL input / a pattern paste, or null. */
const pastedSrc = (url: string, linkPaste: LinkPaste): string | null => {
  const tool = make({}, linkPaste, false);
  const root = tool.render();

  tool.onPaste({ type: 'pattern', detail: { key: 'embed', data: url } } as PatternPasteEvent);

  return root.querySelector('iframe')?.getAttribute('src') ?? null;
};

const menuOffers = (url: string, linkPaste: LinkPaste): boolean => {
  const policy = genericEmbedPolicy(linkPaste);

  return buildPasteMenuOptions(url, {
    hasSelection: false,
    allowGenericEmbed: policy.allowGeneric,
    allowedEmbedOrigins: policy.allowedOrigins,
    blockedEmbedOrigins: policy.blockedOrigins,
    ownHosts: policy.ownHosts,
  }).some((option) => option.type === 'embed');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CONFIG: LinkPaste = {
  allowGenericEmbed: true,
  genericEmbedClickToLoad: false,
  hostAliases: ['app.example.com'],
  blockedEmbedOrigins: ['evil.com', '10.0.0.1'],
};

describe('paste menu, URL input and stored data apply one gate', () => {
  it.each([
    'https://EXAMPLE.com./x',
    'https://app.example.com@evil.com/',
    'https://evil.com@app.example.com/',
    'https://EVIL.com:8443/',
    'https://ev%69l.com/',
    'https://evil。com/',
    'https://ex\tample.com/',
    '\thttps://good.org/a b',
    'HTTPS://good.org/',
    'https:/\\good.org/',
    'https:good.org',
    'http://good.org/',
    'javascript:alert(1)',
    'data:text/html,x',
    'https://good.org/\n<x>',
    'https://[::ffff:10.0.0.1]/',
  ])('%j', (url) => {
    const stored = storedSrc(url, CONFIG);
    const pasted = pastedSrc(url, CONFIG);
    const offered = menuOffers(url, CONFIG);

    expect(pasted).toBe(stored);
    expect(offered).toBe(stored !== null);

    // Whatever is framed is the canonical https href, never the raw string.
    if (stored !== null) {
      expect(stored).toBe(new URL(url.trim()).href);
      expect(new URL(stored).protocol).toBe('https:');
    }
  });

  it('a stored `embed` field never moves the frame off `source`', () => {
    const src = make({ service: '', source: 'https://good.org/', embed: 'https://evil.com/', kind: 'iframe' }, CONFIG, true)
      .render().querySelector('iframe')?.getAttribute('src');

    expect(src).toBe('https://good.org/');
  });

  it('a stored registry service name that is an Object.prototype key renders nothing', () => {
    for (const service of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const root = make({ service, source: 'https://evil.com/', embed: 'https://evil.com/', kind: 'iframe' }, CONFIG, true).render();

      expect(root.querySelector('iframe')).toBeNull();
    }
  });
});

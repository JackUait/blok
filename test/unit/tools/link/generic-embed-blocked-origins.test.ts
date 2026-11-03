import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Embed, type EmbedData } from '../../../../src/tools/link/embed';
import { canFrameGeneric, genericEmbedPolicy } from '../../../../src/tools/link/generic-embed-policy';
import { buildPasteMenuOptions } from '../../../../src/tools/link/paste-menu/options';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkPaste = NonNullable<BlokConfig['linkPaste']>;

const mount = (data: Partial<EmbedData>, linkPaste: LinkPaste): HTMLElement => {
  const options = {
    api: {
      i18n: { t: (key: string) => key, has: () => false, getLocale: () => 'en' },
      blocks: { delete: (): void => undefined },
      config: { linkPaste },
    } as unknown as API,
    block: { id: 'embed-block', dispatchChange: (): void => undefined } as never,
    config: {},
    readOnly: true,
    data,
  } as BlockToolConstructorOptions<EmbedData>;

  return new Embed(options).render();
};

const generic = (source: string): Partial<EmbedData> => ({ service: '', source, embed: source, kind: 'iframe' });

const frames = (url: string, linkPaste: LinkPaste): boolean => canFrameGeneric(url, genericEmbedPolicy(linkPaste));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('linkPaste.blockedEmbedOrigins', () => {
  it('beats allowGenericEmbed and allowedEmbedOrigins', () => {
    const linkPaste = {
      allowGenericEmbed: true,
      allowedEmbedOrigins: ['evil.test'],
      blockedEmbedOrigins: ['evil.test'],
    };

    expect(frames('https://evil.test/x', linkPaste)).toBe(false);
    expect(frames('https://fine.test/x', linkPaste)).toBe(true);
  });

  it('matches a wildcard on subdomains but not the bare domain', () => {
    const linkPaste = { allowGenericEmbed: true, blockedEmbedOrigins: ['*.evil.test'] };

    expect(frames('https://a.b.evil.test/', linkPaste)).toBe(false);
    expect(frames('https://evil.test/', linkPaste)).toBe(true);
  });

  it('is not dodged by a trailing dot, letter case or a port', () => {
    const linkPaste = { allowGenericEmbed: true, blockedEmbedOrigins: ['evil.test', 'Other.Test.'] };

    expect(frames('https://evil.test./', linkPaste)).toBe(false);
    expect(frames('https://EVIL.test:8443/', linkPaste)).toBe(false);
    expect(frames('https://other.test/', linkPaste)).toBe(false);
  });

  it('matches an entry written in Unicode against the punycode host', () => {
    const linkPaste = { allowGenericEmbed: true, blockedEmbedOrigins: ['пример.рф', '*.bücher.test'] };

    expect(frames('https://пример.рф/', linkPaste)).toBe(false);
    expect(frames('https://xn--e1afmkfd.xn--p1ai/', linkPaste)).toBe(false);
    expect(frames('https://shop.bücher.test/', linkPaste)).toBe(false);
  });

  it('renders a stored generic embed of a blocked host as a link card', () => {
    const root = mount(generic('https://evil.test/x'), {
      allowGenericEmbed: true,
      blockedEmbedOrigins: ['evil.test'],
    });

    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('[data-blok-testid="embed-link-card"]')).not.toBeNull();
  });

  it('keeps "Embed" out of the paste menu for a blocked host', () => {
    const offered = buildPasteMenuOptions('https://evil.test/x', {
      hasSelection: false,
      allowGenericEmbed: true,
      blockedEmbedOrigins: ['evil.test'],
    }).map((option) => option.type);

    expect(offered).not.toContain('embed');
    expect(offered).toContain('bookmark');
  });

  it('leaves registry providers alone', () => {
    const source = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const root = mount({ service: 'youtube', source, embed: '' }, { blockedEmbedOrigins: ['*.youtube.com', 'youtube.com'] });

    expect(root.querySelector('iframe')).not.toBeNull();
  });
});

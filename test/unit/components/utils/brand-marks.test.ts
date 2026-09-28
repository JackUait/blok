import { describe, it, expect } from 'vitest';
import { BRAND_MARK_HOST_SLUGS, BRAND_MARK_SERVICES, brandMarkSlug, brandMarkSlugForUrl } from '../../../../src/components/utils/brand-mark-services';
import { brandMarkSvg } from '../../../../src/components/utils/brand-marks';
import { EMBED_SERVICES } from '../../../../src/tools/link/registry';

describe('brand mark library', () => {
  it('only holds marks for providers in the embed registry', () => {
    expect(BRAND_MARK_SERVICES.filter((service) => !(service in EMBED_SERVICES))).toEqual([]);
  });

  it('covers providers across every kind of embed, not only media', () => {
    const sample = ['youtube', 'spotify', 'figma', 'googledocs', 'reddit', 'twitter', 'calendly', 'codesandbox', 'openstreetmap', 'airtable'];

    expect(sample.filter((service) => brandMarkSlug(service) === null)).toEqual([]);
    expect(BRAND_MARK_SERVICES.length).toBeGreaterThanOrEqual(78);
  });

  it('has a drawing behind every mark it names', () => {
    const missing = BRAND_MARK_SERVICES.filter((service) => {
      const slug = brandMarkSlug(service);
      return slug === null || brandMarkSvg(slug) === null;
    });

    expect(missing).toEqual([]);
  });

  it('draws near-black marks in the text colour so they read in both themes, and keeps brand colours', () => {
    expect(brandMarkSvg('tiktok')).toContain('fill="currentColor"');
    expect(brandMarkSvg('x')).toContain('fill="currentColor"');
    expect(brandMarkSvg('youtube')).toContain('fill="#FF0000"');
  });
});

describe('brand mark for a site address', () => {
  const slugFor = (href: string): string | null => brandMarkSlugForUrl(new URL(href));

  it('knows a provider by its bare site address', () => {
    expect(slugFor('https://youtube.com/')).toBe('youtube');
    expect(slugFor('https://www.spotify.com/')).toBe('spotify');
    expect(slugFor('https://figma.com')).toBe('figma');
    expect(slugFor('https://t.me/')).toBe('telegram');
  });

  it('knows a provider by any of its subdomains', () => {
    expect(slugFor('https://music.youtube.com/')).toBe('youtube');
    expect(slugFor('https://acme.typeform.com/')).toBe('typeform');
    expect(slugFor('https://someone.substack.com/')).toBe('substack');
  });

  it('tells apart products that share one host by their first path segment', () => {
    expect(slugFor('https://docs.google.com/spreadsheets/u/0/')).toBe('googlesheets');
    expect(slugFor('https://docs.google.com/presentation/')).toBe('googleslides');
    expect(slugFor('https://docs.google.com/forms/')).toBe('googleforms');
    expect(slugFor('https://docs.google.com/')).toBe('googledocs');
    expect(slugFor('https://drive.google.com/')).toBe('googledrive');
  });

  it('never gives a shared parent domain one product\'s mark', () => {
    expect(slugFor('https://google.com/')).toBeNull();
    expect(slugFor('https://www.apple.com/')).toBeNull();
    expect(slugFor('https://mit.edu/')).toBeNull();
    expect(slugFor('https://163.com/')).toBeNull();
  });

  it('knows every provider with a mark by each site address its embed pattern names', () => {
    // docs.google.com products are told apart by path (tested above).
    const unknown = BRAND_MARK_SERVICES.flatMap((service) =>
      [...EMBED_SERVICES[service].regex.source.matchAll(/[a-z0-9-]+(?:\\\.[a-z0-9-]+)+/g)]
        .map((match) => match[0].replace(/\\\./g, '.'))
        .filter((host) => !host.endsWith('.php') && host !== 'docs.google.com')
        .filter((host) => slugFor(`https://${host}/`) !== brandMarkSlug(service))
        .map((host) => `${service}: ${host}`)
    );

    expect(unknown).toEqual([]);
  });

  it('knows the providers whose embed pattern spells the domain as an alternation', () => {
    expect(slugFor('https://pinterest.com/')).toBe('pinterest');
    expect(slugFor('https://threads.net/')).toBe('threads');
    expect(slugFor('https://twitter.com/')).toBe('x');
    expect(slugFor('https://x.com/')).toBe('x');
    expect(slugFor('https://fast.wistia.net/')).toBe('wistia');
  });

  it('knows nothing of other sites, even ones that end like a provider', () => {
    expect(slugFor('https://example.com/')).toBeNull();
    expect(slugFor('https://notyoutube.com/')).toBeNull();
  });

  it('has a drawing behind every mark a site address can name', () => {
    expect(BRAND_MARK_HOST_SLUGS.filter((slug) => brandMarkSvg(slug) === null)).toEqual([]);
  });
});

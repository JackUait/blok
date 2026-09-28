import { describe, it, expect } from 'vitest';
import { BRAND_MARK_HOST_SLUGS, BRAND_MARK_SERVICES, brandMarkSlug, brandMarkSlugForUrl } from '../../../../src/components/utils/brand-mark-services';
import { BRAND_MARK_SLUGS, brandMarkSvg } from '../../../../src/components/utils/brand-marks';
import { EMBED_SERVICES } from '../../../../src/tools/link/registry';

const slugFor = (href: string): string | null => brandMarkSlugForUrl(new URL(href));

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

describe('brand marks drawn from other sources', () => {
  it('names the providers Simple Icons lacks with their own marks', () => {
    const services = ['codepen', 'linkedin', 'tunein', 'rutube', 'soop', 'buzzsprout', 'transistor', 'tally', 'jotform', 'genially'];

    expect(services.filter((service) => {
      const slug = brandMarkSlug(service);
      return slug === null || brandMarkSvg(slug) === null;
    })).toEqual([]);
    expect(slugFor('https://codepen.io/')).toBe('codepen');
    expect(slugFor('https://www.linkedin.com/')).toBe('linkedin');
    expect(slugFor('https://tunein.com/')).toBe('tunein');
    expect(slugFor('https://rutube.ru/')).toBe('rutube');
    expect(slugFor('https://vod.afreecatv.com/')).toBe('soop');
    expect(slugFor('https://www.buzzsprout.com/')).toBe('buzzsprout');
    expect(slugFor('https://share.transistor.fm/')).toBe('transistor');
    expect(slugFor('https://tally.so/')).toBe('tally');
    expect(slugFor('https://form.jotform.com/')).toBe('jotform');
    expect(slugFor('https://view.genial.ly/')).toBe('genially');
  });

  it('holds only inert shapes, so a bundled drawing can never run code or load anything', () => {
    const allowedTags = new Set(['path', 'g', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath']);
    const allowedAttrs = new Set(['d', 'fill', 'fill-rule', 'clip-rule', 'transform', 'opacity', 'fill-opacity', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'id', 'clip-path', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
    const bad = BRAND_MARK_SLUGS.flatMap((slug) => {
      const svg = new DOMParser().parseFromString(brandMarkSvg(slug) ?? '', 'image/svg+xml').documentElement;
      return [...svg.querySelectorAll('*')].flatMap((el) => [
        ...(allowedTags.has(el.tagName) ? [] : [`${slug}: <${el.tagName}>`]),
        ...[...el.attributes].filter((a) => !allowedAttrs.has(a.name)).map((a) => `${slug}: ${el.tagName}[${a.name}]`),
        ...[...el.attributes].filter((a) => /url\((?!#)/.test(a.value)).map((a) => `${slug}: external ${a.name}`),
      ]);
    });

    expect(bad).toEqual([]);
  });

  it('keeps element ids unique to their mark, so two marks on one page never share a gradient', () => {
    const ids = BRAND_MARK_SLUGS.flatMap((slug) => [...(brandMarkSvg(slug) ?? '').matchAll(/\sid="([^"]+)"/g)].map((m) => [slug, m[1]]));

    expect(ids.filter(([slug, id]) => !id.startsWith(`blok-brand-${slug}-`))).toEqual([]);
  });
});

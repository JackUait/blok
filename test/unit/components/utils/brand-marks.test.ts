import { describe, it, expect } from 'vitest';
import { BRAND_MARK_SERVICES, brandMarkSlug } from '../../../../src/components/utils/brand-mark-services';
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

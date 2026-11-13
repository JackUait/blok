import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);

  return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('embed window logo as an app icon', () => {
  it('fills the tile with the brand colour stamped on the mark', () => {
    expect(rule('.blok-embed-window__brand [data-brand-tone]')).toMatch(/background:\s*var\(--blok-brand-mark-color,/);
  });

  it('draws the mark white on a brand tile, dark on a light one, and paper on an ink one', () => {
    expect(rule('.blok-embed-window__brand [data-brand-tone] svg path')).toMatch(/fill:\s*var\(--blok-text-on-dark\)/);
    expect(rule(".blok-embed-window__brand [data-brand-tone='light'] svg path")).toMatch(/fill:\s*var\(--blok-dark\)/);
    expect(rule(".blok-embed-window__brand [data-brand-tone='ink'] svg path")).toMatch(/fill:\s*var\(--blok-bg-primary\)/);
  });

  it('drops the plain white tile under a brand tile, and keeps it for full-colour artwork', () => {
    expect(rule('.blok-embed-window__brand:has([data-brand-tone])')).toMatch(/background:\s*none/);
    expect(rule('.blok-embed-window__brand')).toMatch(/background:\s*var\(--blok-bg-primary\)/);
  });
});

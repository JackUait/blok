import { describe, it, expect } from 'vitest';
import { renderImage } from '../../../../src/tools/image/ui';

describe('renderImage', () => {
  it('returns figure with <img> carrying url, alt, and width style', () => {
    const fig = renderImage({ url: 'https://x/y.png', alt: 'photo', width: 60, alignment: 'center' });
    const img = fig.querySelector('img');
    expect(img).not.toBeNull();
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/y.png');
    expect(img.getAttribute('alt')).toBe('photo');
    expect(img.style.width).toBe('60%');
  });

  it('defaults width to 100% when omitted', () => {
    const fig = renderImage({ url: 'https://x/y.png' });
    const img = fig.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.style.width).toBe('100%');
  });

  it('applies alignment via wrapper justify-content', () => {
    const fig = renderImage({ url: 'u', alignment: 'right' });
    expect(fig.style.justifyContent).toBe('flex-end');
  });

  it('renders alt as empty string when missing', () => {
    const fig = renderImage({ url: 'u' });
    const img = fig.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('alt')).toBe('');
  });
});

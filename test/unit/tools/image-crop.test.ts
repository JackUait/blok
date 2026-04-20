import { describe, it, expect } from 'vitest';
import { renderImage } from '../../../src/tools/image/ui';

describe('renderImage with crop', () => {
  it('flat structure when crop absent', () => {
    const figure = renderImage({ url: 'x.png' });
    const img = figure.querySelector('img');
    expect(img?.parentElement).toBe(figure);
    expect(figure.querySelector('.blok-image-crop')).toBeNull();
  });

  it('wraps img in .blok-image-crop when crop present', () => {
    const figure = renderImage({
      url: 'x.png',
      crop: { x: 10, y: 20, w: 50, h: 40 },
    });
    const wrapper = figure.querySelector<HTMLElement>('.blok-image-crop');
    expect(wrapper).not.toBeNull();
    const img = wrapper!.querySelector<HTMLImageElement>('img');
    expect(img).not.toBeNull();
    expect(wrapper!.style.aspectRatio).toBe('50 / 40');
    expect(img!.style.width).toBe('200%');
    expect(img!.style.height).toBe('250%');
    expect(img!.style.marginLeft).toBe('-20%');
    expect(img!.style.marginTop).toBe('-50%');
  });
});

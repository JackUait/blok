import { afterEach, describe, expect, it } from 'vitest';
import { openLightbox } from '../../../src/tools/image/ui';

afterEach(() => {
  document.body.replaceChildren();
});

const dialog = (): HTMLElement =>
  document.body.querySelector('.blok-image-lightbox') as HTMLElement;

describe('openLightbox with crop', () => {
  it('wraps the image in a crop element that carries the lightbox image class', () => {
    const close = openLightbox({
      url: 'https://example.com/pic.jpg',
      crop: { x: 10, y: 20, w: 50, h: 40 },
    });

    const wrapper = dialog().querySelector('.blok-image-lightbox__crop');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.classList.contains('blok-image-lightbox__image')).toBe(true);
    expect((wrapper as HTMLElement).style.overflow).toBe('hidden');
    expect((wrapper as HTMLElement).style.aspectRatio.replace(/\s+/g, '')).toBe('50/40');

    const img = wrapper?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.classList.contains('blok-image-lightbox__image')).toBe(false);
    close();
  });

  it('scales and translates the inner image so only the cropped region is visible', () => {
    const close = openLightbox({
      url: 'https://example.com/pic.jpg',
      crop: { x: 10, y: 20, w: 50, h: 40 },
    });

    const img = dialog().querySelector<HTMLImageElement>('.blok-image-lightbox__crop img')!;
    expect(img.style.width).toBe('200%');
    // Height intentionally unset — img keeps its natural aspect inside the wrapper clip.
    expect(img.style.height).toBe('');
    expect(img.style.transform).toBe('translate(-10%, -20%)');
    expect(img.style.maxWidth).toBe('none');
    close();
  });

  it('applies a circular mask on the wrapper when crop shape is circle', () => {
    const close = openLightbox({
      url: 'https://example.com/pic.jpg',
      crop: { x: 0, y: 0, w: 100, h: 100, shape: 'circle' },
    });

    const wrapper = dialog().querySelector<HTMLElement>('.blok-image-lightbox__crop')!;
    expect(wrapper.style.borderRadius).toBe('50%');
    expect(wrapper.getAttribute('data-shape')).toBe('circle');
    close();
  });

  it('applies zoom/pan transform to the wrapper, leaving the inner crop translate intact', () => {
    const close = openLightbox({
      url: 'https://example.com/pic.jpg',
      crop: { x: 10, y: 20, w: 50, h: 40 },
    });

    const wrapper = dialog().querySelector<HTMLElement>('.blok-image-lightbox__crop')!;
    const img = wrapper.querySelector<HTMLImageElement>('img')!;
    expect(wrapper.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(img.style.transform).toBe('translate(-10%, -20%)');
    close();
  });

  it('keeps plain image behavior when no crop is provided', () => {
    const close = openLightbox({ url: 'https://example.com/pic.jpg' });

    expect(dialog().querySelector('.blok-image-lightbox__crop')).toBeNull();
    const img = dialog().querySelector<HTMLImageElement>('img.blok-image-lightbox__image')!;
    expect(img).not.toBeNull();
    expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
    close();
  });
});

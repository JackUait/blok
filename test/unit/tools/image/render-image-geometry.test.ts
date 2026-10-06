import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageData, ImageMarkup } from '../../../../types/tools/image';
import { openLightbox, renderImage } from '../../../../src/tools/image/ui';
import { planeImageStyle } from '../../../../src/tools/image/geometry';

const N = { w: 400, h: 300 };
const sized = { naturalWidth: 400, naturalHeight: 300 };
const VARIANTS: ImageData['variants'] = [{ url: 'x.avif', mimeType: 'image/avif' }, { url: 'x.png', mimeType: 'image/png' }];

const MARKUP: ImageMarkup[] = [{ id: 'p', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.9, 0.9, 0.5], size: 0.012 }];
const layer = (root: HTMLElement): SVGSVGElement | null => root.querySelector<SVGSVGElement>('svg[data-role="image-markup"]');

const ratio = (el: HTMLElement | null | undefined): string => (el?.style.aspectRatio ?? '').replace(/\s+/g, '');
const parts = (root: HTMLElement): { frame: HTMLElement | null; plane: HTMLElement | null; img: HTMLImageElement | null } => ({
  frame: root.querySelector<HTMLElement>('[data-role="image-crop"], [data-role="lightbox-crop"]'),
  plane: root.querySelector<HTMLElement>('[data-role="image-plane"]'),
  img: root.querySelector<HTMLImageElement>('img'),
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('renderImage geometry', () => {
  it('keeps the identity geometry unchanged, cropped or not', () => {
    expect(renderImage({ url: 'x.png', alt: 'a' }).outerHTML).toBe(
      '<figure class="blok-image-inner" data-role="image-figure" style="margin: 0px; text-align: center; position: relative;">'
      + '<img data-blok-block-context-menu="" src="x.png" alt="a" draggable="false"></figure>'
    );
    expect(renderImage({ url: 'x.png', crop: { x: 10, y: 20, w: 50, h: 40 } }).outerHTML).toBe(
      '<figure class="blok-image-inner" data-role="image-figure" style="margin: 0px; text-align: center; position: relative;">'
      + '<div class="blok-image-crop" data-role="image-crop" style="overflow: hidden; position: relative; aspect-ratio: 50 / 40; width: 100%;">'
      + '<img data-blok-block-context-menu="" src="x.png" alt="" draggable="false" style="display: block; max-width: none; width: 200%; transform: translate(-10%, -20%);"></div></figure>'
    );
  });

  it('builds frame > plane > img with the swapped aspect for a 90° turn without crop', () => {
    const g = { rotation: 90 as const, flipX: false, straighten: 0 };
    const { frame, plane, img } = parts(renderImage({ url: 'x.png', rotation: 90, ...sized }));
    const st = planeImageStyle(N, g);

    expect(frame?.classList.contains('blok-image-crop')).toBe(true);
    expect(frame?.style.overflow).toBe('hidden');
    expect(frame?.style.width).toBe('100%');
    expect(ratio(frame)).toBe('30000/40000');
    expect(plane?.parentElement).toBe(frame);
    expect(ratio(plane)).toBe('300/400');
    expect(plane?.style.width).toBe('100%');
    expect(img?.parentElement).toBe(plane);
    expect(img?.style.transform).toBe(st.transform);
    expect(img?.style.width).toBe(st.width);
    expect(img?.style.visibility).toBe('');
  });

  it('crops in the oriented box when turned', () => {
    const { frame, plane } = parts(renderImage({
      url: 'x.png',
      rotation: 270,
      crop: { x: 10, y: 20, w: 50, h: 40, shape: 'ellipse' },
      ...sized,
    }));

    expect(ratio(frame)).toBe('15000/16000');
    expect(frame?.getAttribute('data-shape')).toBe('ellipse');
    expect(plane?.style.width).toBe('200%');
    expect(plane?.style.transform).toBe('translate(-10%, -20%)');
  });

  it('mirrors and straightens the img', () => {
    expect(parts(renderImage({ url: 'x.png', flipX: true, ...sized })).img?.style.transform).toBe('rotate(0deg) scaleX(-1)');
    expect(parts(renderImage({
      url: 'x.png',
      straighten: -4,
      crop: { x: 10, y: 10, w: 80, h: 80 },
      ...sized,
    })).img?.style.transform).toBe('rotate(-4deg)');
  });

  it('measures the natural size on load when it is not cached', () => {
    const { frame, plane, img } = parts(renderImage({ url: 'x.png', rotation: 90 }));

    expect(img?.style.visibility).toBe('hidden');
    if (!img) throw new Error('no img');
    Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 300, configurable: true });
    img.dispatchEvent(new Event('load'));

    expect(img.style.visibility).toBe('');
    expect(ratio(plane)).toBe('300/400');
    expect(ratio(frame)).toBe('30000/40000');
  });

  it('keeps the img positioned inside the plane when variants wrap it in <picture>', () => {
    const { plane, img } = parts(renderImage({ url: 'x.png', rotation: 90, variants: VARIANTS, ...sized }));
    const picture = img?.parentElement;

    expect(picture?.tagName).toBe('PICTURE');
    expect(picture?.style.display).toBe('contents');
    expect(picture?.parentElement).toBe(plane);
    expect(img?.style.position).toBe('absolute');
  });

  it('puts the filter on the img in every branch', () => {
    const want = 'sepia(0.75) contrast(1.1)';
    const cases: Array<Partial<ImageData>> = [
      {},
      { crop: { x: 10, y: 10, w: 50, h: 50 } },
      { rotation: 90, ...sized },
      { variants: VARIANTS },
      { variants: VARIANTS, rotation: 180, ...sized },
    ];

    for (const extra of cases) {
      const img = renderImage({ url: 'x.png', filter: 'sepia', adjust: { contrast: 20 }, ...extra }).querySelector('img');

      expect(img?.style.filter).toBe(want);
    }
  });
});

describe('renderImage markup', () => {
  it('frames an unturned image to draw its marks over it', () => {
    const root = renderImage({ url: 'x.png', markup: MARKUP, ...sized });
    const { frame, plane, img } = parts(root);

    expect(frame?.style.width).toBe('100%');
    expect(ratio(frame)).toBe('40000/30000');
    expect(img?.parentElement).toBe(plane);
    expect(layer(root)?.parentElement).toBe(plane);
    expect(layer(root)?.getAttribute('viewBox')).toBe('0 0 400 300');
    expect(layer(root)?.querySelector('[data-markup-id="p"]')).not.toBeNull();
  });

  it('crops an unturned marked image to the same window the flat crop wrapper shows', () => {
    const crop = { x: 10, y: 20, w: 50, h: 40 };
    const { frame, plane } = parts(renderImage({ url: 'x.png', crop, markup: MARKUP, ...sized }));

    expect(frame?.getAttribute('data-role')).toBe('image-crop');
    expect(ratio(frame)).toBe('20000/12000');
    expect(plane?.style.width).toBe('200%');
    expect(plane?.style.transform).toBe('translate(-10%, -20%)');
  });

  it('ignores marks that do not validate and keeps the flat DOM', () => {
    const flat = renderImage({ url: 'x.png', alt: 'a' }).outerHTML;

    expect(renderImage({ url: 'x.png', alt: 'a', markup: [] }).outerHTML).toBe(flat);
    expect(renderImage({ url: 'x.png', alt: 'a', markup: [{ id: 'x', type: 'pen', color: 'red', points: [], size: 1 }] }).outerHTML).toBe(flat);
  });
});

describe('openLightbox geometry parity', () => {
  const dialog = (): HTMLElement => {
    const el = document.body.querySelector<HTMLElement>('.blok-image-lightbox');

    if (!el) throw new Error('no lightbox');

    return el;
  };

  it('mirrors the block: same plane, img styles and filter', () => {
    const data = {
      url: 'x.png',
      rotation: 90 as const,
      flipX: true,
      straighten: 3,
      crop: { x: 10, y: 20, w: 50, h: 40 },
      filter: 'warm' as const,
      adjust: { brightness: -10 },
      ...sized,
    };
    const block = parts(renderImage(data));
    const close = openLightbox(data);
    const box = parts(dialog());

    expect(box.frame?.classList.contains('blok-image-lightbox__image')).toBe(true);
    expect(box.frame?.classList.contains('blok-image-lightbox__crop')).toBe(true);
    expect(ratio(box.frame)).toBe(ratio(block.frame));
    expect(box.plane?.getAttribute('style')).toBe(block.plane?.getAttribute('style'));
    expect(box.img?.getAttribute('style')).toBe(block.img?.getAttribute('style'));
    // The frame takes zoom/pan, so the plane's crop shift is untouched.
    expect(box.frame?.style.transform).toBe('translate(0px, 0px) scale(1)');
    close();
  });

  it('gives the turned frame a definite size, since the absolute img adds none', () => {
    const close = openLightbox({ url: 'x.png', rotation: 90, ...sized });
    const { frame } = parts(dialog());

    // Crop px width in O is 300.
    expect(frame?.style.width).toBe('min(95vw, 95vh * var(--blok-image-frame-ratio), var(--blok-image-frame-width))');
    expect(frame?.style.getPropertyValue('--blok-image-frame-width')).toBe('300px');
    expect(frame?.style.getPropertyValue('--blok-image-frame-ratio')).toBe('0.75');
    close();
  });

  it('filters the plain img when only a filter is set', () => {
    const close = openLightbox({ url: 'x.png', filter: 'mono' });
    const img = dialog().querySelector<HTMLImageElement>('img.blok-image-lightbox__image');

    expect(img?.style.filter).toBe('grayscale(1)');
    close();
  });

  it('applies the navigated item edits', () => {
    const close = openLightbox({
      url: 'a.png',
      navigation: {
        items: [{ url: 'a.png' }, { url: 'b.png', rotation: 180, filter: 'noir', ...sized }],
        startIndex: 0,
      },
    });

    expect(parts(dialog()).plane).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const { plane, img } = parts(dialog());

    expect(plane).not.toBeNull();
    expect(img?.style.transform).toBe('rotate(180deg)');
    expect(img?.style.filter).toBe('grayscale(1) contrast(1.4) brightness(0.9)');
    close();
  });

  it('draws the marks on an unturned image', () => {
    const close = openLightbox({ url: 'x.png', markup: MARKUP, ...sized });
    const { frame, plane } = parts(dialog());

    expect(frame?.getAttribute('data-role')).toBe('lightbox-crop');
    expect(frame?.style.getPropertyValue('--blok-image-frame-width')).toBe('400px');
    expect(layer(dialog())?.parentElement).toBe(plane);
    expect(layer(dialog())?.getAttribute('viewBox')).toBe('0 0 400 300');
    close();
  });
});

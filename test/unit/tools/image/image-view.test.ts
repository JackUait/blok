import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageData, ImageMarkup, ImageRotation } from '../../../../types/tools/image';
import {
  applyImageFilter,
  buildFrame,
  buildPlane,
  pickEdits,
} from '../../../../src/tools/image/image-view';
import { planeImageStyle, type Geometry } from '../../../../src/tools/image/geometry';

const N = { w: 400, h: 300 };
const ROTATIONS: ImageRotation[] = [0, 90, 180, 270];

const makeImg = (): HTMLImageElement => {
  const img = document.createElement('img');

  img.setAttribute('src', 'x.png');

  return img;
};

const setNatural = (img: HTMLImageElement, w: number, h: number, complete: boolean): void => {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
  Object.defineProperty(img, 'complete', { value: complete, configurable: true });
};

const ratio = (el: HTMLElement): string => el.style.aspectRatio.replace(/\s+/g, '');

const MARKUP: ImageMarkup[] = [
  { id: 'r', type: 'rect', color: '#ff3b30', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, size: 0.012 },
];

const layerOf = (root: Element): SVGSVGElement | null => root.querySelector<SVGSVGElement>('svg[data-role="image-markup"]');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildPlane', () => {
  it('sizes the plane to the oriented image and places the img for every rotation and flip', () => {
    for (const rotation of ROTATIONS) {
      for (const flipX of [false, true]) {
        const g: Geometry = { rotation, flipX, straighten: 0 };
        const img = makeImg();
        const plane = buildPlane(img, N, g);
        const st = planeImageStyle(N, g);

        expect(ratio(plane)).toBe(rotation % 180 === 0 ? '400/300' : '300/400');
        expect(plane.getAttribute('data-role')).toBe('image-plane');
        expect(plane.style.position).toBe('relative');
        expect(img.parentElement).toBe(plane);
        expect(img.style.position).toBe('absolute');
        expect(img.style.width).toBe(st.width);
        expect(img.style.height).toBe(st.height);
        expect(img.style.left).toBe(st.left);
        expect(img.style.top).toBe(st.top);
        expect(img.style.transform).toBe(st.transform);
        // The global img max-width preflight would squash a turned landscape img.
        expect(img.style.maxWidth).toBe('none');
        expect(img.style.visibility).toBe('');
      }
    }
  });

  it('puts straighten into the img transform', () => {
    const img = makeImg();

    buildPlane(img, N, { rotation: 90, flipX: false, straighten: 7.5 });

    expect(img.style.transform).toBe('rotate(97.5deg)');
  });

  it('hides the img until its natural size is known, then sizes and reveals it on load', () => {
    const img = makeImg();
    const onNatural = vi.fn();
    const g: Geometry = { rotation: 90, flipX: false, straighten: 0 };
    const plane = buildPlane(img, null, g, { onNatural });

    expect(img.style.visibility).toBe('hidden');
    expect(onNatural).not.toHaveBeenCalled();

    setNatural(img, 400, 300, true);
    img.dispatchEvent(new Event('load'));

    expect(img.style.visibility).toBe('');
    expect(ratio(plane)).toBe('300/400');
    expect(img.style.width).toBe(planeImageStyle(N, g).width);
    expect(onNatural).toHaveBeenCalledWith({ w: 400, h: 300 });
  });

  it('sizes at once when the img has already loaded', () => {
    const img = makeImg();

    setNatural(img, 400, 300, true);
    const plane = buildPlane(img, null, { rotation: 270, flipX: false, straighten: 0 });

    expect(img.style.visibility).toBe('');
    expect(ratio(plane)).toBe('300/400');
  });

  it('mounts the given content, so a <picture> wraps the img inside the plane', () => {
    const img = makeImg();
    const picture = document.createElement('picture');

    picture.appendChild(img);
    const plane = buildPlane(img, N, { rotation: 90, flipX: false, straighten: 0 }, { content: picture });

    expect(picture.parentElement).toBe(plane);
    expect(img.parentElement).toBe(picture);
    expect(img.style.position).toBe('absolute');
  });
});

describe('buildFrame', () => {
  it('clips the full image when there is no crop, with the oriented aspect', () => {
    const img = makeImg();
    const frame = buildFrame(img, { natural: N, geometry: { rotation: 90, flipX: false, straighten: 0 } });
    const plane = frame.querySelector<HTMLElement>('[data-role="image-plane"]');

    expect(frame.style.overflow).toBe('hidden');
    expect(ratio(frame)).toBe('30000/40000');
    expect(plane?.style.width).toBe('100%');
    expect(plane?.style.transform).toBe('translate(-0%, -0%)');
  });

  it('scales and shifts the plane to the crop and uses the crop pixel aspect in the oriented box', () => {
    const img = makeImg();
    const frame = buildFrame(img, {
      natural: N,
      geometry: { rotation: 90, flipX: false, straighten: 0 },
      crop: { x: 10, y: 20, w: 50, h: 40, shape: 'circle' },
    });
    const plane = frame.querySelector<HTMLElement>('[data-role="image-plane"]');

    // O is 300x400: (50*300)/(40*400).
    expect(ratio(frame)).toBe('15000/16000');
    expect(plane?.style.width).toBe('200%');
    expect(plane?.style.transform).toBe('translate(-10%, -20%)');
    expect(frame.getAttribute('data-shape')).toBe('circle');
  });

  it('refines the frame aspect once the natural size loads', () => {
    const img = makeImg();
    const frame = buildFrame(img, {
      natural: null,
      geometry: { rotation: 90, flipX: false, straighten: 0 },
      crop: { x: 0, y: 0, w: 50, h: 50 },
    });

    expect(ratio(frame)).toBe('50/50');
    setNatural(img, 400, 300, true);
    img.dispatchEvent(new Event('load'));
    expect(ratio(frame)).toBe('15000/20000');
  });
});

describe('markup layer', () => {
  it('puts the marks after the img inside the plane, sized to the oriented box', () => {
    const img = makeImg();
    const plane = buildPlane(img, N, { rotation: 90, flipX: false, straighten: 0 }, { markup: MARKUP });
    const svg = layerOf(plane);

    expect(svg?.parentElement).toBe(plane);
    expect(plane.lastElementChild).toBe(svg);
    expect(img.nextElementSibling).toBe(svg);
    expect(svg?.getAttribute('viewBox')).toBe('0 0 300 400');
    expect(svg?.querySelector('[data-markup-id="r"]')).not.toBeNull();
  });

  it('puts the marks after a <picture> wrapper, not inside it', () => {
    const img = makeImg();
    const picture = document.createElement('picture');

    picture.appendChild(img);
    const plane = buildPlane(img, N, { rotation: 0, flipX: false, straighten: 0 }, { content: picture, markup: MARKUP });

    expect(picture.nextElementSibling).toBe(layerOf(plane));
    expect(layerOf(picture)).toBeNull();
  });

  it('adds no layer without marks', () => {
    for (const markup of [undefined, []]) {
      const plane = buildPlane(makeImg(), N, { rotation: 90, flipX: false, straighten: 0 }, { markup });

      expect(plane.children).toHaveLength(1);
    }
  });

  it('draws the marks once the natural size loads', () => {
    const img = makeImg();
    const plane = buildPlane(img, null, { rotation: 0, flipX: false, straighten: 0 }, { markup: MARKUP });
    const svg = layerOf(plane);

    expect(svg?.hasAttribute('viewBox')).toBe(false);
    setNatural(img, 400, 300, true);
    img.dispatchEvent(new Event('load'));
    expect(svg?.getAttribute('viewBox')).toBe('0 0 400 300');
    expect(svg?.querySelector('[data-markup-id="r"]')).not.toBeNull();
  });

  it('stands in a 1000 px long side with the rendered aspect for an image with no natural size', () => {
    const img = makeImg();
    const onNatural = vi.fn();

    Object.defineProperty(img, 'width', { value: 200, configurable: true });
    Object.defineProperty(img, 'height', { value: 100, configurable: true });
    const plane = buildPlane(img, null, { rotation: 0, flipX: false, straighten: 0 }, { markup: MARKUP, onNatural });

    setNatural(img, 0, 0, true);
    img.dispatchEvent(new Event('load'));

    expect(ratio(plane)).toBe('1000/500');
    expect(img.style.visibility).toBe('');
    expect(layerOf(plane)?.getAttribute('viewBox')).toBe('0 0 1000 500');
    expect(onNatural).toHaveBeenCalledWith({ w: 1000, h: 500 });
  });

  it('stands in a square when the sizeless image has no rendered box either', () => {
    const img = makeImg();

    setNatural(img, 0, 0, true);
    const plane = buildPlane(img, null, { rotation: 90, flipX: false, straighten: 0 }, { markup: MARKUP });

    expect(ratio(plane)).toBe('1000/1000');
    expect(layerOf(plane)?.getAttribute('viewBox')).toBe('0 0 1000 1000');
  });

  it('buildFrame with identity geometry and a crop clips like the flat crop wrapper and keeps the marks in the plane', () => {
    const img = makeImg();
    const frame = buildFrame(img, {
      natural: N,
      geometry: { rotation: 0, flipX: false, straighten: 0 },
      crop: { x: 10, y: 20, w: 50, h: 40 },
      markup: MARKUP,
    });
    const plane = frame.querySelector<HTMLElement>('[data-role="image-plane"]');

    expect(frame.getAttribute('data-role')).toBe('image-crop');
    expect(frame.className).toBe('blok-image-crop');
    // Same visible window as the flat wrapper: img width 200%, shifted by x/y percent of itself.
    expect(plane?.style.width).toBe('200%');
    expect(plane?.style.transform).toBe('translate(-10%, -20%)');
    expect(ratio(frame)).toBe('20000/12000');
    expect(img.style.width).toBe('100%');
    expect(img.style.height).toBe('100%');
    expect(img.style.transform).toBe('rotate(0deg)');
    expect(layerOf(frame)?.parentElement).toBe(plane);
    expect(layerOf(frame)?.getAttribute('viewBox')).toBe('0 0 400 300');
  });
});

describe('applyImageFilter', () => {
  it('sets the CSS filter for a preset and adjustments', () => {
    const img = makeImg();

    applyImageFilter(img, 'mono', { brightness: 20 });

    expect(img.style.filter).toBe('grayscale(1) brightness(1.1)');
  });

  it('clears a filter that no longer applies', () => {
    const img = makeImg();

    applyImageFilter(img, 'sepia', {});
    applyImageFilter(img, 'none', {});

    expect(img.style.filter).toBe('');
  });

  it('leaves an unfiltered img without a style attribute', () => {
    const img = makeImg();

    applyImageFilter(img, 'none', { brightness: 0 });

    expect(img.hasAttribute('style')).toBe(false);
  });
});

describe('pickEdits', () => {
  it('keeps only the fields the renderers read', () => {
    const data: ImageData = {
      url: 'x.png',
      rotation: 90,
      flipX: true,
      straighten: 3,
      filter: 'warm',
      adjust: { contrast: 10 },
      naturalWidth: 10,
      naturalHeight: 20,
      markup: MARKUP,
      alt: 'a',
    };

    expect(pickEdits(data)).toEqual({
      rotation: 90,
      flipX: true,
      straighten: 3,
      filter: 'warm',
      adjust: { contrast: 10 },
      naturalWidth: 10,
      naturalHeight: 20,
      markup: MARKUP,
    });
  });

  it('drops absent fields', () => {
    const data: ImageData = { url: 'x.png' };

    expect(pickEdits(data)).toEqual({});
  });
});

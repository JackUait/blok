import type { ImageAdjust, ImageCrop, ImageData, ImageMarkup } from '../../../types/tools/image';
import type { Size } from './darkroom/camera';
import { cssFilter, type FilterSet } from './adjust';
import { orientedSize, planeImageStyle, type Geometry } from './geometry';
import { createMarkupLayer, updateMarkupLayer } from './markup/render';

/** The saved fields every renderer needs beyond url and crop. */
export type ImageEdits = Pick<
  ImageData,
  'rotation' | 'flipX' | 'straighten' | 'filter' | 'filterStrength' | 'adjust' | 'naturalWidth' | 'naturalHeight' | 'markup'
>;

const EDIT_KEYS = ['rotation', 'flipX', 'straighten', 'filter', 'filterStrength', 'adjust', 'naturalWidth', 'naturalHeight', 'markup'] as const;

export function pickEdits(data: ImageEdits): ImageEdits {
  const out: ImageEdits = {};

  for (const key of EDIT_KEYS) {
    if (data[key] !== undefined) {
      Object.assign(out, { [key]: data[key] });
    }
  }

  return out;
}

export function naturalOf(data: Pick<ImageData, 'naturalWidth' | 'naturalHeight'>): Size | null {
  const { naturalWidth: w, naturalHeight: h } = data;

  return w !== undefined && h !== undefined && w > 0 && h > 0 ? { w, h } : null;
}

export function applyImageFilter(
  img: HTMLImageElement,
  filter: string,
  adjust: ImageAdjust,
  strength?: number,
  filters?: FilterSet
): void {
  const css = cssFilter(filter, adjust, strength, filters);

  if (css !== '') {
    img.style.setProperty('filter', css);
  } else if (img.style.filter !== '') {
    img.style.removeProperty('filter');
  }
}

/** The marks drawn in each plane; sizePlane redraws them at the plane's box. */
const planeMarkup = new WeakMap<HTMLElement, { svg: SVGSVGElement; markup: ImageMarkup[] }>();

/** Size the plane and place the img once the natural size is known. */
export function sizePlane(plane: HTMLElement, img: HTMLImageElement, n: Size, g: Geometry): void {
  const o = orientedSize(n, g);
  const st = planeImageStyle(n, g);
  const marks = planeMarkup.get(plane);

  plane.style.setProperty('aspect-ratio', `${o.w} / ${o.h}`);
  img.style.setProperty('width', st.width);
  img.style.setProperty('height', st.height);
  img.style.setProperty('left', st.left);
  img.style.setProperty('top', st.top);
  img.style.setProperty('transform', st.transform);
  img.style.removeProperty('visibility');
  if (marks) updateMarkupLayer(marks.svg, marks.markup, o);
}

/** Long side of the stand-in natural size for an image that reports none (an SVG without width/height). */
const STAND_IN_LONG_SIDE = 1000;

/** Reads the img's layout box, not its client rect: the rect would include a transform. */
const standIn = (img: HTMLImageElement): Size => {
  const aspect = img.width > 0 && img.height > 0 ? img.width / img.height : 1;

  return aspect >= 1
    ? { w: STAND_IN_LONG_SIDE, h: Math.round(STAND_IN_LONG_SIDE / aspect) }
    : { w: Math.round(STAND_IN_LONG_SIDE * aspect), h: STAND_IN_LONG_SIDE };
};

export interface PlaneOptions {
  /** What goes in the plane: the img itself (default) or a `<picture style="display:contents">` around it. */
  content?: HTMLElement;
  /** Drawn over the img, in the plane's box. */
  markup?: ImageMarkup[];
  /**
   * Called once the natural size is measured on load (not when it was passed in).
   * An image that loads without one gets a stand-in, which is never worth saving.
   */
  onNatural?(n: Size): void;
}

/**
 * An O-sized box with the turned img inside. The caller sizes and moves the plane.
 * The img is absolute, so the plane must be its containing block: content may only add
 * boxless wrappers (display:contents).
 */
export function buildPlane(img: HTMLImageElement, natural: Size | null, g: Geometry, opts: PlaneOptions = {}): HTMLElement {
  const plane = document.createElement('div');

  plane.setAttribute('data-role', 'image-plane');
  plane.style.position = 'relative';
  img.style.setProperty('display', 'block');
  img.style.setProperty('position', 'absolute');
  // Opt out of the global `img { max-width: 100% }`: a turned img can be wider than the plane.
  img.style.setProperty('max-width', 'none');
  plane.appendChild(opts.content ?? img);
  if (opts.markup && opts.markup.length > 0) {
    // After the content: the layer paints over the img.
    const svg = createMarkupLayer(opts.markup, null);

    plane.appendChild(svg);
    planeMarkup.set(plane, { svg, markup: opts.markup });
  }

  if (natural) {
    sizePlane(plane, img, natural, g);

    return plane;
  }

  // A turned img stretched into an unknown box would flash distorted.
  img.style.setProperty('visibility', 'hidden');
  const measure = (): void => {
    const n = img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : standIn(img);

    sizePlane(plane, img, n, g);
    opts.onNatural?.(n);
  };

  if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    measure();

    return plane;
  }
  // An img with no src is complete too (the darkroom sets it later), and a fetching one reports 0 x 0.
  if (img.complete && img.getAttribute('src')) measure();
  img.addEventListener('load', measure, { once: true });

  return plane;
}

export interface FrameOptions {
  natural: Size | null;
  geometry: Geometry;
  /** Defaults to the full image. */
  crop?: ImageCrop;
  content?: HTMLElement;
  markup?: ImageMarkup[];
  className?: string;
  role?: string;
  /** Called with the natural size, whether passed in or measured on load. */
  onNatural?(n: Size, frame: HTMLElement): void;
}

const FULL_CROP: ImageCrop = { x: 0, y: 0, w: 100, h: 100 };

/**
 * The clipping frame for a non-identity geometry or for marks: frame > plane > img.
 * Identity geometry without marks must not use this; renderers keep their flat DOM for it.
 */
export function buildFrame(img: HTMLImageElement, opts: FrameOptions): HTMLElement {
  const { x, y, w, h, shape } = opts.crop ?? FULL_CROP;
  const frame = document.createElement('div');

  frame.className = opts.className ?? 'blok-image-crop';
  frame.setAttribute('data-role', opts.role ?? 'image-crop');
  frame.style.overflow = 'hidden';
  frame.style.position = 'relative';
  if (shape) frame.setAttribute('data-shape', shape);

  const setAspect = (n: Size): void => {
    const o = orientedSize(n, opts.geometry);

    frame.style.aspectRatio = `${w * o.w} / ${h * o.h}`;
    opts.onNatural?.(n, frame);
  };

  // Fallback until the natural size is known.
  frame.style.aspectRatio = `${w} / ${h}`;
  const plane = buildPlane(img, opts.natural, opts.geometry, { content: opts.content, markup: opts.markup, onNatural: setAspect });

  plane.style.width = `${(100 / w) * 100}%`;
  // Percent translate resolves against the plane's own box, so x/y are percent of O.
  plane.style.transform = `translate(-${x}%, -${y}%)`;
  if (opts.natural) setAspect(opts.natural);
  frame.appendChild(plane);

  return frame;
}

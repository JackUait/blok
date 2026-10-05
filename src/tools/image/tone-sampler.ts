import type { ImageData } from '../../../types/tools/image';
import { cssFilter, readAdjust, type FilterSet } from './adjust';
import { orientedSize, readGeometry } from './geometry';
import { flatten, luminanceGrid, pickTone, regionLuminance, type Rgb, type Rgba, type ToneGrid } from './tone';

/** Long side of the sampling canvas. A few hundred cells tell light from dark. */
const GRID_LONG_SIDE = 24;
const TONED = '[data-role="image-overlay"], [data-action="alt-edit"], [data-role="resize-handle"]';
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export function isReadableInPlace(src: string, base: string = location.href): boolean {
  const url = new URL(src, base);

  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;

  return url.origin === new URL(base).origin;
}

/**
 * An <img> without crossOrigin taints the canvas for EVERY cross-origin image, even a CORS one.
 * The visible img must not get crossOrigin: hosts without CORS would stop loading it.
 * So a cross-origin picture is read through a separate CORS copy.
 */
export function loadSampleSource(img: HTMLImageElement): Promise<HTMLImageElement | null> {
  const src = img.currentSrc || img.src;

  if (src === '') return Promise.resolve(null);
  if (isReadableInPlace(src)) return Promise.resolve(img);

  return new Promise((resolve) => {
    const copy = new Image();

    copy.crossOrigin = 'anonymous';
    copy.addEventListener('load', () => resolve(copy), { once: true });
    copy.addEventListener('error', () => resolve(null), { once: true });
    copy.src = src;
  });
}

/** Mirrors renderImage: the crop is percent of the oriented plane; the img is centred, turned, then mirrored. */
export function readToneGrid(
  source: HTMLImageElement,
  data: Partial<ImageData>,
  filters: FilterSet | undefined,
  backdrop: Rgb
): ToneGrid | null {
  const n = { w: source.naturalWidth, h: source.naturalHeight };

  if (n.w <= 0 || n.h <= 0) return null;
  const g = readGeometry(data);
  const o = orientedSize(n, g);
  const crop = data.crop ?? { x: 0, y: 0, w: 100, h: 100 };
  const cw = (crop.w / 100) * o.w;
  const ch = (crop.h / 100) * o.h;
  const k = GRID_LONG_SIDE / Math.max(cw, ch);
  const canvas = document.createElement('canvas');

  canvas.width = Math.max(1, Math.round(cw * k));
  canvas.height = Math.max(1, Math.round(ch * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) return null;
  const { filter, strength, adjust } = readAdjust(data);
  const css = cssFilter(filter, adjust, strength, filters);

  if (css !== '') ctx.filter = css;
  ctx.scale(k, k);
  ctx.translate(-(crop.x / 100) * o.w, -(crop.y / 100) * o.h);
  ctx.translate(o.w / 2, o.h / 2);
  ctx.rotate(((g.rotation + g.straighten) * Math.PI) / 180);
  if (g.flipX) ctx.scale(-1, 1);
  try {
    ctx.drawImage(source, -n.w / 2, -n.h / 2, n.w, n.h);

    return luminanceGrid(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, backdrop);
  } catch {
    return null;
  }
}

/**
 * Any CSS colour as RGBA, by painting one pixel. Computed styles keep oklch(), color(srgb …)
 * and friends as written, so a regex over rgb() would miss them.
 */
export function cssColor(css: string): Rgba | null {
  const canvas = document.createElement('canvas');

  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) return null;
  // An invalid colour leaves fillStyle as it was, so start from transparent.
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;

  return { r, g, b, a: a / 255 };
}

/** Painted backgrounds from `el` up, innermost first, stopping at the first opaque one. */
const backgroundLayers = (el: Element | null): Rgba[] => {
  if (!el) return [];
  const c = cssColor(getComputedStyle(el).backgroundColor);

  if (c && c.a >= 1) return [c];

  return c && c.a > 0 ? [c, ...backgroundLayers(el.parentElement)] : backgroundLayers(el.parentElement);
};

/** What shows where no element paints: the root's Canvas colour, which follows color-scheme. */
const canvasColor = (): Rgb => {
  const probe = document.createElement('span');

  probe.style.cssText = 'position:absolute;width:0;height:0;background:Canvas';
  document.documentElement.appendChild(probe);
  const c = cssColor(getComputedStyle(probe).backgroundColor);

  probe.remove();

  return c && c.a > 0 ? c : WHITE;
};

/** The colour a transparent pixel shows: every painted layer up the tree, over the page canvas. */
export function pageBackdrop(el: Element): Rgb {
  return flatten(backgroundLayers(el), canvasColor());
}

export async function sampleToneGrid(
  img: HTMLImageElement,
  data: Partial<ImageData>,
  filters: FilterSet | undefined
): Promise<ToneGrid | null> {
  const source = await loadSampleSource(img);

  return source ? readToneGrid(source, data, filters, pageBackdrop(img)) : null;
}

const toneUnder = (el: HTMLElement, grid: ToneGrid | null, box: DOMRect | undefined): number | null => {
  const r = el.getBoundingClientRect();

  if (!grid || !box || box.width <= 0 || box.height <= 0 || r.width <= 0 || r.height <= 0) return null;

  return regionLuminance(grid, {
    x: (r.left - box.left) / box.width,
    y: (r.top - box.top) / box.height,
    w: r.width / box.width,
    h: r.height / box.height,
  });
};

/** No grid, or a control with no box: drop data-tone so CSS falls back to the theme. */
export function applyTones(figure: HTMLElement, grid: ToneGrid | null): void {
  const media = figure.querySelector<HTMLElement>('.blok-image-crop') ?? figure.querySelector<HTMLElement>('img');
  const box = media?.getBoundingClientRect();

  figure.querySelectorAll<HTMLElement>(TONED).forEach((el) => {
    const l = toneUnder(el, grid, box);

    if (l === null) el.removeAttribute('data-tone');
    else el.setAttribute('data-tone', pickTone(l));
  });
}

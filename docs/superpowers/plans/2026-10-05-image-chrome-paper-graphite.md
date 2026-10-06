# Image chrome: paper and graphite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the image block's island/split chrome with one calm bar, thin inside handles and an ALT tag, each painted paper or graphite from the pixels under it.

**Architecture:** Pure tone math lives in `tone.ts` (luminance grid → region average → tone). `tone-sampler.ts` gets readable pixels (the visible `<img>` when same-origin, else a hidden `crossOrigin="anonymous"` copy), draws the visible picture (crop, rotation, flip, CSS filter) into a ~24 px canvas, and stamps `data-tone` on the toolbar, alt tag and handles. CSS maps `data-tone` onto the existing `--blok-overlay-*` tokens; no `data-tone` falls back to the theme.

**Tech Stack:** TypeScript, plain CSS (`src/styles/image.css`, `src/styles/main.css`, `src/styles/colors.css`), Vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-image-chrome-paper-graphite-design.md`

## Global Constraints

- Every `data-action` name stays, including the hidden `delete` alias.
- `data-island="layout|edit|view"` wrappers stay (tier CSS keys off them); they lose their cards.
- Tier thresholds unchanged: `OVERLAY_MEDIUM_THRESHOLD` 360, `OVERLAY_COMPACT_THRESHOLD` 230, `OVERLAY_COMPACT_HEIGHT_THRESHOLD` 80.
- The visible `<img>` NEVER gets `crossOrigin`.
- Paper card `#ffffff`; graphite card `#252525`. Nothing blue (CLAUDE.md "No blue selected states").
- Tone rule: pick the tone with LESS WCAG contrast against the area (switch at relative luminance ≈ 0.218).
- Toolbar 8 px inside the top edge, centred. Handles 3 × 32 px, 8 px inside each edge, 16 px wide hit area.
- Motion: opacity only, ~120 ms. Nothing moves, so no tooltip re-anchor. Reduced motion: no transition.
- Not BREAKING: islands, split and alt pill landed after v1.15.2. Release note is owed.
- No `cqw` in image.css (`image-control-tiers.test.ts`).
- Tests: scoped runs only while iterating (`yarn test <file>`, `yarn e2e <file>`); never the full suite (memory: run-only-related-tests).
- Commits: stage explicit paths only; other sessions have WIP in this tree (memory: concurrent-session-reverts-working-tree).

## Review Focus

1. A transparent PNG on a dark editor page — expect the transparent area to read as the PAGE colour (graphite), not white. Pinned in Task 1 (`luminanceGrid` backdrop) and Task 2 (`pageBackdrop`).
2. A re-render (edit, replace) while a sample is in flight — the old promise must not stamp tones on the new figure. Pinned in Task 7.
3. Hidden handles — they must keep a real box while hidden (opacity only, no `scale(0)`), or they get no tone until a resize. Pinned in Task 5 (CSS) + Task 8 (e2e reads tone before hover).
4. Medium tier — a divider must not appear at the bar's left edge when `layout` is hidden. Pinned in Task 4.
5. Alt tag accessible name — label and text must be separated by a real space ("Alt Pink yarn mascot", not "AltPink…"). Pinned in Task 6.

---

### Task 1: Tone math (`tone.ts`)

**Files:**
- Create: `src/tools/image/tone.ts`
- Test: `test/unit/tools/image/tone.test.ts`

**Interfaces:**
- Produces:
  - `type Tone = 'paper' | 'graphite'`
  - `interface Rgb { r: number; g: number; b: number }`
  - `interface ToneGrid { width: number; height: number; luminance: Float32Array }`
  - `interface Region { x: number; y: number; w: number; h: number }` (fractions of the visible picture)
  - `relativeLuminance(c: Rgb): number`
  - `luminanceGrid(pixels: Uint8ClampedArray, width: number, height: number, backdrop: Rgb): ToneGrid`
  - `regionLuminance(grid: ToneGrid, region: Region): number | null`
  - `pickTone(luminance: number): Tone`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { luminanceGrid, pickTone, regionLuminance, relativeLuminance, type Rgb } from '../../../../src/tools/image/tone';

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

const pixels = (rows: Array<Array<[number, number, number, number]>>): Uint8ClampedArray =>
  new Uint8ClampedArray(rows.flat().flat());

describe('tone', () => {
  it('a light area gets paper and a dark one graphite', () => {
    expect(pickTone(relativeLuminance({ r: 240, g: 240, b: 240 }))).toBe('paper');
    expect(pickTone(relativeLuminance({ r: 20, g: 20, b: 20 }))).toBe('graphite');
  });

  it('switches where paper and graphite have equal contrast', () => {
    const paper = relativeLuminance(WHITE);
    const graphite = relativeLuminance({ r: 0x25, g: 0x25, b: 0x25 });
    const t = Math.sqrt((paper + 0.05) * (graphite + 0.05)) - 0.05;

    expect(t).toBeCloseTo(0.218, 3);
    expect(pickTone(t + 0.001)).toBe('paper');
    expect(pickTone(t - 0.001)).toBe('graphite');
  });

  it('a transparent pixel takes the colour of the page behind it', () => {
    const clear = pixels([[[255, 255, 255, 0]]]);

    expect(luminanceGrid(clear, 1, 1, BLACK).luminance[0]).toBeCloseTo(0, 5);
    expect(luminanceGrid(clear, 1, 1, WHITE).luminance[0]).toBeCloseTo(1, 5);
  });

  it('sky over ground: the top strip and the bottom corner read differently', () => {
    const W: [number, number, number, number] = [255, 255, 255, 255];
    const K: [number, number, number, number] = [10, 10, 10, 255];
    const grid = luminanceGrid(pixels([[W, W, W, W], [W, W, W, W], [K, K, K, K], [K, K, K, K]]), 4, 4, WHITE);

    const top = regionLuminance(grid, { x: 0.25, y: 0, w: 0.5, h: 0.2 });
    const corner = regionLuminance(grid, { x: 0, y: 0.8, w: 0.3, h: 0.2 });

    expect(top === null ? null : pickTone(top)).toBe('paper');
    expect(corner === null ? null : pickTone(corner)).toBe('graphite');
  });

  it('averages every cell the region covers', () => {
    const W: [number, number, number, number] = [255, 255, 255, 255];
    const K: [number, number, number, number] = [0, 0, 0, 255];
    const grid = luminanceGrid(pixels([[W, K]]), 2, 1, WHITE);

    expect(regionLuminance(grid, { x: 0, y: 0, w: 1, h: 1 })).toBeCloseTo(0.5, 5);
    expect(regionLuminance(grid, { x: 0, y: 0, w: 0.5, h: 1 })).toBeCloseTo(1, 5);
    expect(regionLuminance(grid, { x: 0.5, y: 0, w: 0.5, h: 1 })).toBeCloseTo(0, 5);
  });

  it('a region with no size or outside the picture reads nothing', () => {
    const grid = luminanceGrid(pixels([[[255, 255, 255, 255]]]), 1, 1, WHITE);

    expect(regionLuminance(grid, { x: 0, y: 0, w: 0, h: 1 })).toBeNull();
    expect(regionLuminance(grid, { x: 1.2, y: 0, w: 0.1, h: 1 })).toBeNull();
    expect(regionLuminance(grid, { x: 0, y: -0.5, w: 1, h: 0.4 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image/tone.test.ts`
Expected: FAIL — cannot resolve `src/tools/image/tone`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type Tone = 'paper' | 'graphite';
export interface Rgb { r: number; g: number; b: number }
export interface ToneGrid { width: number; height: number; luminance: Float32Array }
/** Fractions of the visible picture: 0..1 from its left/top edge. */
export interface Region { x: number; y: number; w: number; h: number }

const channel = (v: number): number => {
  const s = v / 255;

  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export const relativeLuminance = ({ r, g, b }: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Must match --blok-image-paper-surface and --blok-image-graphite-surface in colors.css.
const PAPER = relativeLuminance({ r: 255, g: 255, b: 255 });
const GRAPHITE = relativeLuminance({ r: 0x25, g: 0x25, b: 0x25 });

/** `pixels` is unpremultiplied RGBA, as getImageData returns it. */
export function luminanceGrid(pixels: Uint8ClampedArray, width: number, height: number, backdrop: Rgb): ToneGrid {
  const luminance = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const a = pixels[i * 4 + 3] / 255;

    luminance[i] = relativeLuminance({
      r: pixels[i * 4] * a + backdrop.r * (1 - a),
      g: pixels[i * 4 + 1] * a + backdrop.g * (1 - a),
      b: pixels[i * 4 + 2] * a + backdrop.b * (1 - a),
    });
  }

  return { width, height, luminance };
}

const span = (start: number, size: number, cells: number): [number, number] | null => {
  const from = Math.max(0, start);
  const to = Math.min(1, start + size);

  if (size <= 0 || to <= from) return null;

  return [Math.min(cells - 1, Math.floor(from * cells)), Math.max(0, Math.ceil(to * cells) - 1)];
};

export function regionLuminance(grid: ToneGrid, region: Region): number | null {
  const xs = span(region.x, region.w, grid.width);
  const ys = span(region.y, region.h, grid.height);

  if (!xs || !ys) return null;
  let sum = 0;
  let count = 0;

  for (let y = ys[0]; y <= ys[1]; y++) {
    for (let x = xs[0]; x <= xs[1]; x++) {
      sum += grid.luminance[y * grid.width + x];
      count++;
    }
  }

  return sum / count;
}

/** The tone closer to the area wins, so the chrome sits in the picture instead of on it. */
export const pickTone = (luminance: number): Tone =>
  contrast(luminance, PAPER) <= contrast(luminance, GRAPHITE) ? 'paper' : 'graphite';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/image/tone.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/tools/image/tone.ts test/unit/tools/image/tone.test.ts
git add src/tools/image/tone.ts test/unit/tools/image/tone.test.ts
git commit -m "feat(image): tone math for paper and graphite chrome"
```

---

### Task 2: Pixel source, canvas draw and tone stamping (`tone-sampler.ts`)

**Files:**
- Create: `src/tools/image/tone-sampler.ts`
- Test: `test/unit/tools/image/tone-sampler.test.ts`

**Interfaces:**
- Consumes (Task 1): `luminanceGrid`, `regionLuminance`, `pickTone`, `Rgb`, `ToneGrid`.
- Consumes (existing): `cssFilter`, `readAdjust`, `FilterSet` from `./adjust`; `orientedSize`, `readGeometry` from `./geometry`.
- Produces:
  - `isReadableInPlace(src: string, base?: string): boolean`
  - `loadSampleSource(img: HTMLImageElement): Promise<HTMLImageElement | null>`
  - `readToneGrid(source: HTMLImageElement, data: Partial<ImageData>, filters: FilterSet | undefined, backdrop: Rgb): ToneGrid | null`
  - `pageBackdrop(el: Element): Rgb`
  - `sampleToneGrid(img: HTMLImageElement, data: Partial<ImageData>, filters: FilterSet | undefined): Promise<ToneGrid | null>`
  - `applyTones(figure: HTMLElement, grid: ToneGrid | null): void`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTones, isReadableInPlace, loadSampleSource, pageBackdrop, readToneGrid,
} from '../../../../src/tools/image/tone-sampler';
import { luminanceGrid } from '../../../../src/tools/image/tone';

const WHITE = { r: 255, g: 255, b: 255 };

const fakeImg = (w: number, h: number): HTMLImageElement => {
  const img = document.createElement('img');

  Object.defineProperty(img, 'naturalWidth', { value: w });
  Object.defineProperty(img, 'naturalHeight', { value: h });

  return img;
};

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe('tone-sampler', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('reads same-origin, data: and blob: images in place, and nothing else', () => {
    const base = 'http://localhost:4444/page.html';

    expect(isReadableInPlace('/a.png', base)).toBe(true);
    expect(isReadableInPlace('data:image/png;base64,AAAA', base)).toBe(true);
    expect(isReadableInPlace('blob:http://localhost:4444/1', base)).toBe(true);
    expect(isReadableInPlace('http://127.0.0.1:4444/a.png', base)).toBe(false);
    expect(isReadableInPlace('https://cdn.example/a.png', base)).toBe(false);
  });

  it('a cross-origin image is read through a CORS copy; the visible img is untouched', async () => {
    const img = document.createElement('img');

    img.src = 'https://cdn.example/a.png';
    const created: HTMLImageElement[] = [];
    const RealImage = window.Image;

    // A function, not an arrow: the code under test calls it with `new`.
    vi.spyOn(window, 'Image').mockImplementation(function () {
      const copy = new RealImage();

      created.push(copy);

      return copy;
    });
    const pending = loadSampleSource(img);

    expect(created).toHaveLength(1);
    expect(created[0].crossOrigin).toBe('anonymous');
    expect(created[0].src).toBe('https://cdn.example/a.png');
    expect(img.hasAttribute('crossorigin')).toBe(false);
    created[0].dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe(created[0]);
  });

  it('a copy that fails to load (no CORS on the host) gives no source', async () => {
    const img = document.createElement('img');

    img.src = 'https://cdn.example/a.png';
    const RealImage = window.Image;
    let copy: HTMLImageElement | null = null;

    vi.spyOn(window, 'Image').mockImplementation(function () {
      copy = new RealImage();

      return copy;
    });
    const pending = loadSampleSource(img);

    copy?.dispatchEvent(new Event('error'));
    await expect(pending).resolves.toBeNull();
  });

  it('a same-origin image is read in place, with no second request', async () => {
    const img = document.createElement('img');

    img.src = `${location.origin}/a.png`;
    const spy = vi.spyOn(window, 'Image');

    await expect(loadSampleSource(img)).resolves.toBe(img);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a tainted canvas read gives no grid', () => {
    const getImageData = vi.fn(() => {
      throw new DOMException('tainted', 'SecurityError');
    });
    const ctx = { scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(), getImageData, filter: 'none' };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);

    expect(readToneGrid(fakeImg(800, 600), {}, undefined, WHITE)).toBeNull();
  });

  it('draws only the crop, turned and filtered like the picture', () => {
    const data = new Uint8ClampedArray(24 * 12 * 4).fill(255);
    const ctx = {
      scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data })), filter: 'none',
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);

    const grid = readToneGrid(fakeImg(800, 600), { crop: { x: 0, y: 0, w: 100, h: 50 }, rotation: 0, adjust: { brightness: -40, contrast: 0, saturation: 0 } }, undefined, WHITE);

    expect(grid?.width).toBe(24);
    // Crop 800x300 of an 800x600 picture, long side 24: 24 x 9.
    expect(grid?.height).toBe(9);
    expect(ctx.filter).toContain('brightness(');
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -400, -300, 800, 600);
  });

  it('the page colour is the first ancestor with a painted background, white if none', () => {
    const page = document.createElement('div');
    const inner = document.createElement('div');

    page.style.backgroundColor = 'rgb(25, 25, 25)';
    page.appendChild(inner);
    document.body.appendChild(page);

    expect(pageBackdrop(inner)).toEqual({ r: 25, g: 25, b: 25 });
    page.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    expect(pageBackdrop(inner)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('stamps each control with the tone under it, and clears tones without a grid', () => {
    const figure = document.createElement('figure');
    const img = document.createElement('img');
    const overlay = document.createElement('div');
    const alt = document.createElement('button');

    overlay.setAttribute('data-role', 'image-overlay');
    alt.setAttribute('data-action', 'alt-edit');
    figure.append(img, overlay, alt);
    document.body.appendChild(figure);
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 400));
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(rect(150, 8, 100, 34));
    vi.spyOn(alt, 'getBoundingClientRect').mockReturnValue(rect(8, 360, 120, 24));
    const W = [255, 255, 255, 255];
    const K = [10, 10, 10, 255];
    const grid = luminanceGrid(new Uint8ClampedArray([...W, ...W, ...K, ...K]), 2, 2, WHITE);

    applyTones(figure, grid);
    expect(overlay.getAttribute('data-tone')).toBe('paper');
    expect(alt.getAttribute('data-tone')).toBe('graphite');

    applyTones(figure, null);
    expect(overlay.hasAttribute('data-tone')).toBe(false);
    expect(alt.hasAttribute('data-tone')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image/tone-sampler.test.ts`
Expected: FAIL — cannot resolve `src/tools/image/tone-sampler`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ImageData } from '../../../types/tools/image';
import { cssFilter, readAdjust, type FilterSet } from './adjust';
import { orientedSize, readGeometry } from './geometry';
import { luminanceGrid, pickTone, regionLuminance, type Rgb, type ToneGrid } from './tone';

/** Long side of the sampling canvas. A few hundred cells tell light from dark. */
const GRID_LONG_SIDE = 24;
const TONED = '[data-role="image-overlay"], [data-action="alt-edit"], [data-role="resize-handle"]';
const RGBA = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?\s*\)/;
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export function isReadableInPlace(src: string, base: string = location.href): boolean {
  const url = new URL(src, base);

  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;

  return url.origin === new URL(base).origin;
}

/**
 * An <img> without crossOrigin taints the canvas for EVERY cross-origin image, even a CORS one
 * (measured in Chromium). The visible img must not get crossOrigin: hosts without CORS would stop
 * loading it. So a cross-origin picture is read through a separate CORS copy.
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

/** Mirrors renderImage: the crop is percent of the oriented plane, the img is centred, turned, then mirrored. */
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

export function pageBackdrop(el: Element): Rgb {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const m = RGBA.exec(getComputedStyle(node).backgroundColor);

    if (m && (m[4] === undefined || parseFloat(m[4]) > 0)) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }

  return WHITE;
}

export async function sampleToneGrid(
  img: HTMLImageElement,
  data: Partial<ImageData>,
  filters: FilterSet | undefined
): Promise<ToneGrid | null> {
  const source = await loadSampleSource(img);

  return source ? readToneGrid(source, data, filters, pageBackdrop(img)) : null;
}

/** No grid, or a control with no box: drop data-tone so CSS falls back to the theme. */
export function applyTones(figure: HTMLElement, grid: ToneGrid | null): void {
  const media = figure.querySelector<HTMLElement>('.blok-image-crop') ?? figure.querySelector<HTMLElement>('img');
  const box = media?.getBoundingClientRect();

  figure.querySelectorAll<HTMLElement>(TONED).forEach((el) => {
    const r = el.getBoundingClientRect();
    const l = grid && box && box.width > 0 && box.height > 0 && r.width > 0 && r.height > 0
      ? regionLuminance(grid, {
        x: (r.left - box.left) / box.width,
        y: (r.top - box.top) / box.height,
        w: r.width / box.width,
        h: r.height / box.height,
      })
      : null;

    if (l === null) el.removeAttribute('data-tone');
    else el.setAttribute('data-tone', pickTone(l));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/image/tone-sampler.test.ts`
Expected: PASS (8 tests). If jsdom's `getComputedStyle` reports `rgba(0, 0, 0, 0)` for `body` by default, the "white if none" case passes; if it reports something else, read the value and adjust `RGBA`'s alpha handling — do not change the expectation.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/tools/image/tone-sampler.ts test/unit/tools/image/tone-sampler.test.ts
git add src/tools/image/tone-sampler.ts test/unit/tools/image/tone-sampler.test.ts
git commit -m "feat(image): read the picture under each control through a CORS-safe source"
```

---

### Task 3: Paper and graphite tokens and the tone CSS

**Files:**
- Modify: `src/styles/colors.css` (root block near line 254; dark blocks near lines 684 and 884)
- Modify: `src/styles/image.css` (append a tone section after the toolbar rules)
- Modify: `test/unit/styles/image-chrome-tokens.test.ts`

**Interfaces:**
- Produces CSS: `--blok-image-{paper,graphite}-{surface,ring,fg,fg-strong,fg-hover,divider,handle}` (once), `--blok-image-handle-ink` (three times), and `[data-tone]` overrides of `--blok-overlay-surface|ring|fg|fg-strong|fg-hover|divider`, `--blok-image-handle-ink`, `--blok-icon-active-bg|text`.

- [ ] **Step 1: Write the failing test** (append to `image-chrome-tokens.test.ts`)

```ts
const imageCss = readFileSync(resolve(__dirname, '../../../src/styles/image.css'), 'utf-8');
const TONE_PARTS = ['surface', 'ring', 'fg', 'fg-strong', 'fg-hover', 'divider', 'handle'];

describe('paper and graphite tones', () => {
  it.each(['paper', 'graphite'])('every %s token is defined once: the picture picks it, not the theme', (tone) => {
    for (const part of TONE_PARTS) {
      expect(css.split(`--blok-image-${tone}-${part}:`).length - 1).toBe(1);
    }
  });

  it('the cards are #fff and #252525, matching pickTone in tone.ts', () => {
    expect(css).toMatch(/--blok-image-paper-surface:\s*#ffffff;/);
    expect(css).toMatch(/--blok-image-graphite-surface:\s*#252525;/);
  });

  it('handle ink follows the theme when no tone is known', () => {
    expect(css.split('--blok-image-handle-ink:').length - 1).toBe(3);
  });

  it('no tone value is blue', () => {
    const values = css.match(/--blok-image-(?:paper|graphite)-[a-z-]+:\s*[^;]+;/g) ?? [];

    expect(values.length).toBe(TONE_PARTS.length * 2);
    for (const v of values) expect(v).not.toMatch(/accent|#2383e2|blue/i);
  });

  it.each(['paper', 'graphite'])('data-tone="%s" repaints the overlay tokens', (tone) => {
    const rule = imageCss.match(new RegExp(`\\[data-tone="${tone}"\\] \\{([^}]*)\\}`));

    expect(rule).not.toBeNull();
    for (const token of ['surface', 'ring', 'fg', 'fg-strong', 'fg-hover', 'divider']) {
      expect(rule?.[1]).toContain(`--blok-overlay-${token}: var(--blok-image-${tone}-${token})`);
    }
    expect(rule?.[1]).toContain(`--blok-image-handle-ink: var(--blok-image-${tone}-handle)`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/styles/image-chrome-tokens.test.ts`
Expected: FAIL on the new tone tests (tokens missing).

- [ ] **Step 3: Implement**

In `colors.css`, after `--blok-image-handle-shadow` in the root block (line ~260), add:

```css
  /* Image chrome tones. Theme-independent: the picture under a control picks them (tone-sampler.ts).
     The surfaces must match PAPER and GRAPHITE in src/tools/image/tone.ts. */
  --blok-image-paper-surface: #ffffff;
  --blok-image-paper-ring: rgba(15, 15, 14, 0.06);
  --blok-image-paper-fg: rgba(15, 15, 14, 0.62);
  --blok-image-paper-fg-strong: #1d1d1d;
  --blok-image-paper-fg-hover: rgba(15, 15, 14, 0.06);
  --blok-image-paper-divider: rgba(15, 15, 14, 0.1);
  --blok-image-paper-handle: rgba(55, 53, 47, 0.55);
  --blok-image-graphite-surface: #252525;
  --blok-image-graphite-ring: rgba(255, 255, 255, 0.08);
  --blok-image-graphite-fg: rgba(255, 255, 255, 0.86);
  --blok-image-graphite-fg-strong: #ffffff;
  --blok-image-graphite-fg-hover: rgba(255, 255, 255, 0.14);
  --blok-image-graphite-divider: rgba(255, 255, 255, 0.14);
  --blok-image-graphite-handle: rgba(255, 255, 255, 0.85);
  --blok-image-handle-ink: rgba(55, 53, 47, 0.55);
```

In BOTH dark blocks (after their `--blok-image-handle-shadow`), add:

```css
    --blok-image-handle-ink: rgba(255, 255, 255, 0.85);
```

(The forced-dark block at ~884 is not nested; match its indentation.)

In `image.css`, after the compact-tier rules (~line 427), add:

```css
/* Paper or graphite, picked per control from the pixels under it (tone-sampler.ts).
   No data-tone: the theme's overlay tokens apply. */
[data-blok-tool="image"] [data-tone="paper"] {
  --blok-overlay-surface: var(--blok-image-paper-surface);
  --blok-overlay-ring: var(--blok-image-paper-ring);
  --blok-overlay-fg: var(--blok-image-paper-fg);
  --blok-overlay-fg-strong: var(--blok-image-paper-fg-strong);
  --blok-overlay-fg-hover: var(--blok-image-paper-fg-hover);
  --blok-overlay-divider: var(--blok-image-paper-divider);
  --blok-image-handle-ink: var(--blok-image-paper-handle);
  --blok-icon-active-bg: var(--blok-image-paper-fg-hover);
  --blok-icon-active-text: var(--blok-image-paper-fg-strong);
}
[data-blok-tool="image"] [data-tone="graphite"] {
  --blok-overlay-surface: var(--blok-image-graphite-surface);
  --blok-overlay-ring: var(--blok-image-graphite-ring);
  --blok-overlay-fg: var(--blok-image-graphite-fg);
  --blok-overlay-fg-strong: var(--blok-image-graphite-fg-strong);
  --blok-overlay-fg-hover: var(--blok-image-graphite-fg-hover);
  --blok-overlay-divider: var(--blok-image-graphite-divider);
  --blok-image-handle-ink: var(--blok-image-graphite-handle);
  --blok-icon-active-bg: var(--blok-image-graphite-fg-hover);
  --blok-icon-active-text: var(--blok-image-graphite-fg-strong);
}
```

- [ ] **Step 4: Run tests**

Run: `yarn test test/unit/styles/image-chrome-tokens.test.ts`, then each of `test/unit/styles/host-customization-tokens.test.ts`, `test/unit/styles/css-vars-extraction.test.ts`, `test/unit/styles/selected-state-neutral.test.ts` (one file per run — memory: multi-path vitest skips files).
Expected: PASS. If a token-parity test demands a dark value for every root token, read its rule; add the paper/graphite names to its documented exemption list with the reason "theme-independent: the picture picks it". Do not duplicate the values into dark blocks.

- [ ] **Step 5: Commit**

```bash
git add src/styles/colors.css src/styles/image.css test/unit/styles/image-chrome-tokens.test.ts
git commit -m "feat(image): paper and graphite tokens for the image chrome"
```

---

### Task 4: One bar instead of islands

**Files:**
- Modify: `src/tools/image/ui.ts` (remove `reanchorTooltipAfterSplit` at ~1331-1345 and its call in `renderOverlay`)
- Modify: `src/styles/main.css:767-779` (toolbar base)
- Modify: `src/styles/image.css:236-391` (island cards, necks, merged bar, show rules, keyframes, resizing rule) and the reduced-motion list at ~1008
- Modify: `test/unit/tools/image/ui.test.ts:522-552` (re-anchor and divider tests)
- Modify: `test/unit/styles/image-control-tiers.test.ts:73-140` (islands describe)
- Possibly modify: `test/unit/styles/css-split-equivalence.test.ts` (`IMAGE_CHROME_ISLANDS_BYTES`), `test/unit/styles/__snapshots__/main-css-*.snap.txt`

**Interfaces:** none new. DOM keeps `[data-island]` groups and every `data-action`.

- [ ] **Step 1: Write the failing tests**

In `ui.test.ts`, replace the two re-anchor tests and the "draws no dividers" test with:

```ts
  it('never re-shows a tooltip when an animation ends: nothing moves, so nothing needs re-anchoring', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    const crop = overlay.querySelector<HTMLElement>('[data-action="crop"]');
    if (!crop) throw new Error('crop missing');
    crop.dispatchEvent(new MouseEvent('mouseenter'));
    vi.mocked(tooltip.show).mockClear();

    overlay.dispatchEvent(new Event('animationend'));

    expect(tooltip.show).not.toHaveBeenCalled();
  });

  it('draws dividers in CSS, not as elements', () => {
    const overlay = renderOverlay(makeOverlayOpts());

    expect(overlay.querySelector('.blok-image-toolbar__divider')).toBeNull();
  });
```

In `image-control-tiers.test.ts`, replace the whole `describe('image islands (frame and islands design)', …)` block with:

```ts
describe('image toolbar (one bar)', () => {
  it('the toolbar itself is the card; groups have none', () => {
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*background: var\(--blok-overlay-surface\)/);
    expect(findRuleBody('[data-blok-tool="image"] .blok-image-toolbar__island')).not.toContain('background');
    expect(css).not.toContain('.blok-image-toolbar::after');
    expect(css).not.toContain('.blok-image-toolbar__island::after');
    expect(css).not.toContain('blok-image-islands');
  });

  it('sits 8px inside the top of the picture', () => {
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*top: 8px/);
    expect(mainCss).not.toMatch(/\.blok-image-toolbar \{[^}]*bottom:/);
  });

  it('fades in by opacity only, so a placed tooltip never ends up off its button', () => {
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*transition: opacity 120ms ease/);
    const animated = (css.match(/\.blok-image-toolbar[^{]*\{[^}]*animation:[^;]*/g) ?? [])
      .filter((rule) => !rule.includes('animation: none'));

    expect(animated).toHaveLength(0);
  });

  it('a divider opens a group only after the first visible one', () => {
    expect(css).toContain('.blok-image-toolbar:not([data-tier="medium"]):not([data-compact="true"]) [data-island="edit"]::before');
    expect(css).toContain('.blok-image-toolbar:not([data-compact="true"]) [data-island="view"]::before');
    expect(css).not.toMatch(/\[data-island\] \+ \[data-island\]/);
  });

  it('medium tier shows only the edit group and more', () => {
    expect(css).toMatch(/\.blok-image-toolbar\[data-tier="medium"\] \[data-island="layout"\] \{\s*display: none/);
    expect(css).toMatch(/\.blok-image-toolbar\[data-tier="medium"\] \[data-island="view"\] > :not\(\[data-action="more"\]\)/);
  });

  it('compact tier keeps only the more button', () => {
    expect(css).toMatch(/\.blok-image-toolbar\[data-compact="true"\] \[data-island="layout"\],\s*\[data-blok-tool="image"\] \.blok-image-toolbar\[data-compact="true"\] \[data-island="edit"\]/);
  });

  it('selection is read from the block holder, not the dead data-selected', () => {
    expect(css).toContain('[data-blok-selected="true"] [data-blok-tool="image"] [data-role="image-selection-ring"]');
    expect(css).toContain('[data-blok-selected="true"] [data-blok-tool="image"] [data-role="resize-handle"]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/image/ui.test.ts` then `yarn test test/unit/styles/image-control-tiers.test.ts`
Expected: FAIL — `tooltip.show` IS called on `animationend`; toolbar still transparent, `blok-image-islands` keyframes present.

- [ ] **Step 3: Implement**

`ui.ts`: delete the `reanchorTooltipAfterSplit` function and the `reanchorTooltipAfterSplit(root);` line in `renderOverlay`. Remove `tooltipShow` from the import ONLY if lint reports it unused (the alt hint still uses it).

`main.css` toolbar base becomes:

```css
[data-blok-tool="image"] .blok-image-toolbar {
  position: absolute;
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  padding: var(--blok-space-0-75);
  border-radius: var(--blok-radius-surface);
  --blok-radius-inner: max(var(--blok-radius-floor), calc(var(--blok-radius-surface) - var(--blok-space-0-75)));
  background: var(--blok-overlay-surface);
  box-shadow:
    inset 0 0 0 1px var(--blok-overlay-ring),
    var(--blok-image-shadow-toolbar);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  z-index: 2;
}
```

`image.css`: replace everything from `[data-blok-tool="image"] .blok-image-toolbar__island {` (line ~238) through the end of `@keyframes blok-image-islands-split` (line ~378) with:

```css
[data-blok-tool="image"] .blok-image-toolbar__island {
  display: inline-flex;
  align-items: center;
  gap: var(--blok-space-0-25);
}
/* Tiers hide whole groups, so a plain `+` rule would draw a divider at the bar's edge. */
[data-blok-tool="image"] .blok-image-toolbar:not([data-tier="medium"]):not([data-compact="true"]) [data-island="edit"]::before,
[data-blok-tool="image"] .blok-image-toolbar:not([data-compact="true"]) [data-island="view"]::before {
  content: '';
  width: 1px;
  height: 14px;
  margin-inline: var(--blok-space-0-75);
  background: var(--blok-overlay-divider);
}
[data-blok-tool="image"] .blok-image-inner:hover .blok-image-toolbar,
[data-blok-selected="true"] [data-blok-tool="image"] .blok-image-toolbar,
[data-blok-tool="image"][data-settings-open="true"] .blok-image-toolbar,
[data-blok-tool="image"][data-align-open="true"] .blok-image-toolbar,
[data-blok-tool="image"][data-alt-open="true"] .blok-image-toolbar {
  opacity: 1;
  pointer-events: auto;
}
```

Then edit the resizing rule (was ~380) to:

```css
[data-blok-tool="image"][data-resizing="true"] .blok-image-inner .blok-image-toolbar {
  opacity: 0;
  pointer-events: none;
}
```

In the reduced-motion list (~1008), delete the lines `.blok-image-toolbar::after`, `.blok-image-toolbar__island::before`, `.blok-image-toolbar__island::after`.

- [ ] **Step 4: Run tests**

Run, one file each: `test/unit/tools/image/ui.test.ts`, `test/unit/tools/image/ui.mutants.test.ts`, `test/unit/styles/image-control-tiers.test.ts`, `test/unit/styles/css-split-equivalence.test.ts`, `test/unit/architecture/radius-law.test.ts`, and every `test/unit/styles/*.test.ts` that reads `main.css` (find them with `grep -l "main.css" test/unit/styles/*.test.ts`).
Expected: PASS, except possibly:
- snapshot tests over `main.css` rules/keyframes: re-run that file with `-u`, then read the snapshot diff — it must show ONLY the removed `blok-image-islands-*` keyframes and the changed toolbar rules.
- `css-split-equivalence.test.ts` byte budget: measure the new net size the way the test's comment describes and update `IMAGE_CHROME_ISLANDS_BYTES` (rename the comment to "Image chrome (paper and graphite)", note "measured against <this commit's parent>").

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts src/styles/main.css src/styles/image.css test/unit/tools/image/ui.test.ts test/unit/styles/image-control-tiers.test.ts
# plus any snapshot / budget file changed in Step 4, by explicit path
git commit -m "feat(image): one calm toolbar instead of splitting islands"
```

---

### Task 5: Thin bar handles inside the picture

**Files:**
- Modify: `src/styles/image.css` (resize-handle rules ~475-516; table-cell handle insets at lines 145-146)
- Modify: `test/unit/styles/image-control-tiers.test.ts` (the "handles are 9px dots" test)

- [ ] **Step 1: Write the failing test** (replace "handles are 9px dots, not 6px bars")

```ts
  it('handles are 3x32 bars 8px inside the picture, in the handle ink', () => {
    const body = findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]');

    expect(body).not.toBeNull();
    expect(body).toContain('width: 3px');
    expect(body).toContain('height: 32px');
    expect(body).toContain('background: var(--blok-image-handle-ink)');
    expect(findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"][data-edge="left"]')).toContain('left: var(--blok-space-2)');
    expect(findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"][data-edge="right"]')).toContain('right: var(--blok-space-2)');
  });

  it('a hidden handle keeps its box, so tone-sampler can read what is under it', () => {
    const body = findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]');

    expect(body).toContain('transform: translateY(-50%)');
    expect(css).not.toMatch(/\[data-role="resize-handle"\][^{]*\{[^}]*scale\(/);
  });

  it('the hit area is 16px wide', () => {
    expect(findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]::before')).toContain('inset: -4px -6.5px');
  });

  it('a table cell needs no handle override: the handles are already inside', () => {
    expect(css).not.toMatch(/\[data-blok-table-cell\][^{]*\[data-role="resize-handle"\]/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/styles/image-control-tiers.test.ts`
Expected: FAIL — handle is still `width: 9px`, uses `scale(0)`, has table-cell insets.

- [ ] **Step 3: Implement**

Delete lines 145-146 (the two `[data-blok-table-cell] … resize-handle` insets). Replace the resize-handle block (from the `/* resize handles —` comment through the `:active { transition-duration: 0s; }` rule) with:

```css
/* resize handles — bars inside the picture, so a table cell's overflow never clips them.
   Hidden is opacity only: tone-sampler.ts reads each handle's box while it is hidden. */
[data-blok-tool="image"] [data-role="resize-handle"] {
  position: absolute;
  top: calc(var(--blok-image-media-height, 100%) / 2);
  width: 3px;
  height: 32px;
  border-radius: var(--blok-radius-pill);
  background: var(--blok-image-handle-ink);
  box-shadow: var(--blok-image-handle-shadow);
  cursor: ew-resize;
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 120ms ease, height 120ms ease, box-shadow 120ms ease;
  z-index: 2;
}
[data-blok-tool="image"] [data-role="resize-handle"]::before {
  content: '';
  position: absolute;
  inset: -4px -6.5px;
}
[data-blok-tool="image"] [data-role="resize-handle"][data-edge="left"]  { left: var(--blok-space-2); }
[data-blok-tool="image"] [data-role="resize-handle"][data-edge="right"] { right: var(--blok-space-2); }
[data-blok-tool="image"] .blok-image-inner:hover [data-role="resize-handle"],
[data-blok-selected="true"] [data-blok-tool="image"] [data-role="resize-handle"],
[data-blok-tool="image"][data-alt-open="true"] [data-role="resize-handle"],
[data-blok-tool="image"][data-settings-open="true"] [data-role="resize-handle"],
[data-blok-tool="image"][data-align-open="true"] [data-role="resize-handle"],
[data-blok-tool="image"][data-resizing="true"] [data-role="resize-handle"] {
  opacity: 1;
}
/* Stronger ink while grabbed: a ring of the same ink makes the bar read thicker. */
[data-blok-tool="image"] [data-role="resize-handle"]:hover,
[data-blok-tool="image"] [data-role="resize-handle"]:active {
  height: 40px;
  box-shadow:
    0 0 0 1px var(--blok-image-handle-ink),
    var(--blok-image-handle-shadow);
}
```

- [ ] **Step 4: Run tests**

Run one file each: `test/unit/styles/image-control-tiers.test.ts`, `test/unit/styles/css-split-equivalence.test.ts`, `test/unit/architecture/radius-law.test.ts`, `test/unit/tools/image/resizer.test.ts`.
Expected: PASS (update the byte budget as in Task 4 if it moves).

- [ ] **Step 5: Commit**

```bash
git add src/styles/image.css test/unit/styles/image-control-tiers.test.ts
git commit -m "feat(image): thin resize bars inside the picture"
```

---

### Task 6: ALT tag

**Files:**
- Modify: `src/tools/image/ui.ts:209-245` (`renderAltPill` markup)
- Modify: `src/styles/image.css:148-234` (alt pill rules)
- Modify: `test/unit/tools/image/ui.test.ts:197-219`

- [ ] **Step 1: Write the failing tests** (replace the two existing alt-pill render tests)

```ts
  it('reads "Add alt text" when alt is missing, with no tag and no extra marks', () => {
    const pill = renderAltPill({ onOpen: noopFn, isEditorOpen: () => false });

    expect(pill.getAttribute('data-action')).toBe('alt-edit');
    expect(pill.getAttribute('data-state')).toBe('missing');
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    // Named by its visible text, so a voice user saying "click Add alt text" hits it.
    expect(pill.hasAttribute('aria-label')).toBe(false);
    expect(pill.textContent).toBe('Add alt text');
    expect(pill.querySelector('.blok-image-alt-pill__label')).toBeNull();
    expect(pill.querySelector('.blok-image-alt-pill__help, .blok-image-alt-pill__mark')).toBeNull();
  });

  it('shows the Alt tag then the text, with a real space between them', () => {
    const pill = renderAltPill({ alt: 'Pink yarn mascot', onOpen: noopFn, isEditorOpen: () => false });

    expect(pill.textContent).toBe('Alt Pink yarn mascot');
    expect(pill.getAttribute('data-state')).toBe('set');
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(pill.querySelector('.blok-image-alt-pill__label')?.textContent).toBe('Alt');
    expect(pill.querySelector('.blok-image-alt-pill__text')?.textContent).toBe('Pink yarn mascot');
    expect(pill.querySelector('svg')).toBeNull();
  });
```

(If the English fallback of `tools.image.altButton` is not "Alt", read it from `src/tools/image/i18n.ts` and use that value; the test is about the separating space.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image/ui.test.ts`
Expected: FAIL — textContent is `"AltPink yarn mascot"` and the mark/help spans exist.

- [ ] **Step 3: Implement**

In `renderAltPill`, replace the mark / text / help construction (from `const mark = …` through the `if (!hasAlt) { … help … }` block) with:

```ts
  if (hasAlt) {
    const label = document.createElement('span');
    label.className = 'blok-image-alt-pill__label';
    label.textContent = tr(opts.i18n, 'tools.image.altButton');
    // A real space, not a CSS gap: the accessible name is built from text, and it read "AltPink…".
    btn.append(label, ' ');
  }
  const text = document.createElement('span');
  text.className = 'blok-image-alt-pill__text';
  text.textContent = hasAlt ? opts.alt ?? '' : tr(opts.i18n, 'tools.image.altAdd');
  btn.appendChild(text);
```

Remove `IconCheck` from the icons import only if lint reports it unused.

In `image.css`, replace the alt pill block (from `/* alt pill — sits on the figure` through the `.blok-image-alt-pill__help { … }` rule) with:

```css
/* alt tag — sits on the picture, bottom inline-start */
[data-blok-tool="image"] .blok-image-alt-pill {
  position: absolute;
  top: calc(var(--blok-image-media-height, 100%) - var(--blok-space-2));
  inset-inline-start: var(--blok-space-2);
  translate: 0 -100%;
  display: inline-flex;
  align-items: center;
  max-width: min(calc(100% - 16px), 240px);
  padding: var(--blok-space-1-25) var(--blok-space-2);
  border: 0;
  border-radius: var(--blok-radius-control);
  background: var(--blok-overlay-surface);
  box-shadow:
    inset 0 0 0 1px var(--blok-overlay-ring),
    var(--blok-image-shadow-toolbar);
  color: var(--blok-overlay-fg-strong);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  white-space: pre;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
}
[data-blok-tool="image"] .blok-image-alt-pill:focus-visible {
  outline: 2px solid var(--blok-focus-ring);
  outline-offset: 2px;
}
[data-blok-tool="image"] .blok-image-inner:hover .blok-image-alt-pill,
[data-blok-selected="true"] [data-blok-tool="image"] .blok-image-alt-pill,
[data-blok-tool="image"][data-alt-open="true"] .blok-image-alt-pill,
[data-blok-tool="image"][data-settings-open="true"] .blok-image-alt-pill,
[data-blok-tool="image"] .blok-image-alt-pill:focus-visible {
  opacity: 1;
}
[data-blok-tool="image"] .blok-image-inner[data-loading="true"] .blok-image-alt-pill {
  display: none;
}
[data-blok-tool="image"] .blok-image-alt-pill__label {
  flex: none;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
[data-blok-tool="image"] .blok-image-alt-pill__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--blok-overlay-fg);
}
[data-blok-tool="image"] .blok-image-alt-pill[data-state="missing"] .blok-image-alt-pill__text {
  color: var(--blok-overlay-fg);
}
```

Check the focus-ring rule against memory "no-focus-ring-on-click": if the old rule gated the ring on a modality attribute elsewhere, keep that gate exactly as it was — copy the old `:focus-visible` rule verbatim rather than the one above if they differ.

- [ ] **Step 4: Run tests**

Run one file each: `test/unit/tools/image/ui.test.ts`, `test/unit/tools/image/ui.mutants.test.ts`, `test/unit/tools/image/alt-popover.mutants.test.ts`, `test/unit/tools/image/index.test.ts`, `test/unit/styles/css-split-equivalence.test.ts`, `test/unit/architecture/radius-law.test.ts`.
Expected: PASS. Any test still asserting `__mark`/`__help` describes the removed design — update it to the new markup, never re-add the spans.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts src/styles/image.css test/unit/tools/image/ui.test.ts
git commit -m "feat(image): the alt control is a quiet ALT tag"
```

---

### Task 7: Wire the sampler into the image tool

**Files:**
- Modify: `src/tools/image/index.ts` (imports; field near line 100; render method around 1120-1145; `observeOverlayWidth` at ~1245)
- Test: `test/unit/tools/image/index.test.ts` (new `describe` + a `vi.mock` at the top)

**Interfaces:**
- Consumes (Task 2): `sampleToneGrid(img, data, filters)`, `applyTones(figure, grid)`.

- [ ] **Step 1: Write the failing test**

At the top of `index.test.ts`, next to the other `vi.mock` calls:

```ts
vi.mock('../../../../src/tools/image/tone-sampler', () => ({
  sampleToneGrid: vi.fn(async () => ({ width: 1, height: 1, luminance: new Float32Array([1]) })),
  applyTones: vi.fn(),
}));
import { applyTones, sampleToneGrid } from '../../../../src/tools/image/tone-sampler';
```

New describe at the end of the file:

```ts
describe('ImageTool — paper and graphite', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('reads the picture once it loads and tones the chrome', async () => {
    const { root } = renderRenderedImage();
    const img = root.querySelector('img');
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    if (!img || !figure) throw new Error('image missing');

    img.dispatchEvent(new Event('load'));
    await flush();

    expect(sampleToneGrid).toHaveBeenCalledWith(img, expect.objectContaining({ url: 'https://x/y.png' }), expect.anything());
    expect(applyTones).toHaveBeenLastCalledWith(figure, expect.objectContaining({ width: 1 }));
  });

  it('read-only has no chrome, so it reads nothing', async () => {
    const { root } = renderRenderedImage({}, { readOnly: true });

    root.querySelector('img')?.dispatchEvent(new Event('load'));
    await flush();

    expect(sampleToneGrid).not.toHaveBeenCalled();
  });

  it('a sample that lands after a re-render does not tone the new figure', async () => {
    let resolve: (g: { width: number; height: number; luminance: Float32Array }) => void = () => undefined;

    vi.mocked(sampleToneGrid).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { root, tool } = renderRenderedImage();

    root.querySelector('img')?.dispatchEvent(new Event('load'));
    tool.setData?.({ caption: 'again' });
    // Any re-render path works; if setData is not public, toggle the caption via its button instead.
    vi.mocked(applyTones).mockClear();
    resolve({ width: 1, height: 1, luminance: new Float32Array([0]) });
    await flush();

    const stale = vi.mocked(applyTones).mock.calls.filter(([fig]) => !fig.isConnected);

    expect(stale).toHaveLength(0);
  });
});
```

(Before writing the third test, check how other tests in this file force a re-render — e.g. clicking `[data-action="caption-toggle"]` or calling a public method — and use that same path instead of `setData` if `setData` is not on `ImageTool`. The assertion stays: no `applyTones` call on a detached figure.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image/index.test.ts -t "paper and graphite"`
Expected: FAIL — `sampleToneGrid` never called.

- [ ] **Step 3: Implement**

Imports:

```ts
import { applyTones, sampleToneGrid } from './tone-sampler';
import type { ToneGrid } from './tone';
```

Field next to `overlayResizeObserver`:

```ts
  private toneGrid: ToneGrid | null = null;
```

In the render method, right before `const figure = renderImage(this.data, this.filters);`:

```ts
    // A grid read from the previous picture must not tone this one.
    this.toneGrid = null;
```

Inside the existing `imgEl.addEventListener('load', () => { … })`, after `this.cacheNaturalDimensions(imgEl);`:

```ts
        if (!this.readOnly) this.refreshTone(imgEl, figure);
```

New private method (next to `observeOverlayWidth`):

```ts
  private refreshTone(img: HTMLImageElement, figure: HTMLElement): void {
    void sampleToneGrid(img, this.data, this.filters).then((grid) => {
      // A re-render replaced this figure while the copy loaded.
      if (!figure.isConnected) return;
      this.toneGrid = grid;
      applyTones(figure, grid);
    });
  }
```

In `observeOverlayWidth`'s `sync`, after `syncMediaHeight(figure);`:

```ts
      // Tier and size change where each control sits over the picture.
      if (this.toneGrid) applyTones(figure, this.toneGrid);
```

- [ ] **Step 4: Run tests**

Run: `yarn test test/unit/tools/image/index.test.ts`, then `yarn test test/unit/tools/image/index.mutants.test.ts`.
Expected: PASS. Then `npx eslint src/tools/image/index.ts test/unit/tools/image/index.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/index.ts test/unit/tools/image/index.test.ts
git commit -m "feat(image): tone the chrome from the loaded picture"
```

---

### Task 8: E2E — the chrome in a real browser

**Files:**
- Modify: `test/playwright/tests/tools/image-chrome.spec.ts` (rewrite the islands tests; add tone tests)

Pixel fixtures are drawn in the page and served through `page.route`, so no binary fixture is added. `localhost:4444` is the test page's origin; `127.0.0.1:4444` is cross-origin.

- [ ] **Step 1: Write the failing tests**

Add helpers below `box`:

```ts
type Fill = { top: string; bottom: string };

// Draws an 800x600 PNG in the page: top half one colour, bottom half another.
const pngBytes = async (page: Page, fill: Fill): Promise<Buffer> => {
  const base64 = await page.evaluate(({ top, bottom }) => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, 800, 300);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 300, 800, 300);

    return c.toDataURL('image/png').split(',')[1];
  }, fill);

  return Buffer.from(base64, 'base64');
};

const servePicture = async (page: Page, url: string, fill: Fill, cors: boolean): Promise<void> => {
  const body = await pngBytes(page, fill);

  await page.route(url, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body,
    headers: cors ? { 'Access-Control-Allow-Origin': '*' } : {},
  }));
};

const SAME = 'http://localhost:4444/tone-fixture/picture.png';
const CROSS = 'http://127.0.0.1:4444/tone-fixture/picture.png';
const DARK: Fill = { top: '#111111', bottom: '#111111' };
const LIGHT: Fill = { top: '#fafafa', bottom: '#fafafa' };
const SKY: Fill = { top: '#fafafa', bottom: '#111111' };

const toned = (page: Page, selector: string): Locator => imageBlock(page).locator(selector);

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
```

Tone tests:

```ts
test('a dark picture gets graphite chrome and light handles, before any hover', async ({ page }) => {
  await servePicture(page, SAME, DARK, false);
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { url: SAME, naturalWidth: 800, naturalHeight: 600, alt: 'Night' } }] });

  await expect(toned(page, '[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'graphite');
  await expect(toned(page, '[data-action="alt-edit"]')).toHaveAttribute('data-tone', 'graphite');
  await expect(toned(page, '[data-role="resize-handle"][data-edge="left"]')).toHaveAttribute('data-tone', 'graphite');
  await hoverLoadedFigure(page);
  await expect(toned(page, '[data-role="image-overlay"]')).toHaveCSS('background-color', 'rgb(37, 37, 37)');
  await expect(toned(page, '[data-role="resize-handle"][data-edge="right"]')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.85)');
});

test('a bright picture gets paper chrome', async ({ page }) => {
  await servePicture(page, SAME, LIGHT, false);
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { url: SAME, naturalWidth: 800, naturalHeight: 600 } }] });

  await expect(toned(page, '[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'paper');
  await hoverLoadedFigure(page);
  await expect(toned(page, '[data-role="image-overlay"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('sky over ground: the toolbar is paper and the alt tag graphite', async ({ page }) => {
  await servePicture(page, SAME, SKY, false);
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { url: SAME, naturalWidth: 800, naturalHeight: 600, alt: 'Dusk' } }] });

  await expect(toned(page, '[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'paper');
  await expect(toned(page, '[data-action="alt-edit"]')).toHaveAttribute('data-tone', 'graphite');
});

test('a cross-origin picture whose host sends CORS is still read', async ({ page }) => {
  await servePicture(page, CROSS, DARK, true);
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { url: CROSS, naturalWidth: 800, naturalHeight: 600 } }] });

  await expect(toned(page, '[data-role="image-overlay"]')).toHaveAttribute('data-tone', 'graphite');
  await expect(imageBlock(page).locator('img')).not.toHaveAttribute('crossorigin');
});

test('a cross-origin picture without CORS still shows, and its chrome follows the editor theme', async ({ page }) => {
  await servePicture(page, CROSS, DARK, false);
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: { url: CROSS, naturalWidth: 800, naturalHeight: 600 } }] });
  await hoverLoadedFigure(page);

  const loaded = await imageBlock(page).locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth);

  expect(loaded).toBe(800);
  // Give the failed CORS copy time to settle, then check nothing was stamped.
  await page.evaluate(() => new Promise((r) => { setTimeout(r, 300); }));
  await expect(toned(page, '[data-role="image-overlay"]')).not.toHaveAttribute('data-tone');
  const themeSurface = await page.evaluate(() => getComputedStyle(document.querySelector('[data-blok-interface]') ?? document.body).getPropertyValue('--blok-overlay-surface').trim());
  const surface = await toned(page, '[data-role="image-overlay"]').evaluate((el) => getComputedStyle(el).getPropertyValue('--blok-overlay-surface').trim());

  expect(surface).toBe(themeSurface);
});
```

Replace the old islands tests:
- "hover shows the islands …" → rename to `'hover shows the toolbar inside the image even with room above; selecting adds the ring'`, and change `[data-island="edit"]` to `[data-role="image-overlay"]` in it.
- Delete `'the islands split without sliding a button sideways…'` and add:

```ts
test('buttons hold still while the toolbar fades in', async ({ page }) => {
  await createBlok(page, { blocks: [...ROOM_ABOVE, { id: 'img', type: 'image', data: IMAGE }] });
  await expect(figure(page)).not.toHaveAttribute('data-loading');
  const crop = imageBlock(page).locator('[data-action="crop"]');
  const before = await box(crop, 'crop at rest');

  await figure(page).hover();
  const early = await box(crop, 'crop early');

  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('opacity', '1');
  const after = await box(crop, 'crop shown');

  expect(early.x).toBeCloseTo(before.x, 1);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
});
```

- "an image in a table cell keeps its islands…" → rename `'…keeps its toolbar and handles inside the cell, where they can be clicked'`, and add after the `more` hit check:

```ts
  const handle = await box(imageBlock(page).locator('[data-role="resize-handle"][data-edge="right"]'), 'right handle');
  const handleHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-role'), { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 });

  expect(handleHit).toBe('resize-handle');
```

- "an image as the first block puts its islands inside" → rename `'…puts its toolbar inside'`; use `[data-role="image-overlay"]`.
- "reduced motion shows the islands without animating" → rename `'reduced motion shows the toolbar with no fade'`:

```ts
  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('transition-duration', '0s');
  await expect(imageBlock(page).locator('[data-role="image-overlay"]')).toHaveCSS('opacity', '1');
```

- "the alt pill stays when the caption is hidden" → rename "alt tag"; body unchanged.

- [ ] **Step 2: Run to verify the new tone tests fail on the pre-Task-7 build, or pass now**

If executing in order, Tasks 1-7 are already in, so run: `yarn e2e test/playwright/tests/tools/image-chrome.spec.ts`
Expected: PASS. To prove the tone tests can fail, temporarily comment out the `refreshTone` call in `index.ts`, re-run, see the four tone tests FAIL on `data-tone`, then restore it and re-run to PASS. Do not commit the commented-out state.

- [ ] **Step 3: Run neighbouring image e2e specs**

Run, one at a time: `test/playwright/tests/tools/image.spec.ts`, `image-crop.spec.ts`, `image-settings-hides-toggler.spec.ts`, `test/playwright/tests/accessibility/semantic-contracts.spec.ts`, `test/playwright/tests/accessibility/keyboard-and-focus.spec.ts`.
Expected: PASS. A failure that names islands, the alt pill's old text, or circle handles is this change's to fix; anything else, sample clean main twice before blaming the change (memory: flaky-and-known-red-index).

- [ ] **Step 4: Commit**

```bash
git add test/playwright/tests/tools/image-chrome.spec.ts
git commit -m "test(image): paper and graphite chrome in a real browser"
```

---

### Task 9: Runtime check, measurements, final gates, push

**Files:** none in `src/` unless the checks find a defect (then: failing test first, then fix, as its own commit).

- [ ] **Step 1: Real-browser look at DPR 2** — use the `verify` skill (built bundles + playwright-cli, reuse an open session per CLAUDE.md). Load: the Blok logo (`public/blok-logo.png`, transparent) and a dark picture, each in light and in `data-blok-theme="dark"`. Screenshot hovered and selected. Read the screenshots. Check: one bar, divider only between visible groups in full and medium tiers, bars inside the edges, ALT tag text separated, tones as expected (logo on white → paper; logo on the dark page → graphite, because transparency takes the page colour).

- [ ] **Step 2: WebKit `ctx.filter`** — in a WebKit playwright-cli session, run `(() => { const c = document.createElement('canvas').getContext('2d'); c.filter = 'brightness(0.5)'; return c.filter; })()`. Record the answer in the spec's "Unverified" line (replace it with the measured result). If WebKit ignores it, nothing breaks; say so in the release note draft.

- [ ] **Step 3: Sampling-copy cost** — with DevTools network logging in a Chromium session (`playwright-cli` network capture), load a cross-origin CORS image and record whether the `crossOrigin` copy hits the network or the cache. Write the measured answer into the spec ("Whether the copy is served from the HTTP cache is unverified" → the result).

- [ ] **Step 4: Final gates** — follow memory "run-only-related-tests": run every unit file touched in Tasks 1-7 plus files that reference changed symbols (`grep -rl "renderAltPill\|renderOverlay\|resize-handle\|blok-image-toolbar\|alt-pill" test/unit test/playwright`), one file per run; `npx eslint` on every changed source/test file; `npx tsc --noEmit -p tsconfig.json` with `NODE_OPTIONS=--max-old-space-size=8192` (memory: tsc 8GB).

- [ ] **Step 5: Commit the spec updates and push**

```bash
git add -f docs/superpowers/specs/2026-10-05-image-chrome-paper-graphite-design.md docs/superpowers/plans/2026-10-05-image-chrome-paper-graphite.md
git commit -m "docs(image): record measured WebKit filter and sampling-copy cache results"
git pull --rebase   # only if the tree has no unstaged changes of yours; never autostash peers' WIP
git push
git status          # must say "up to date with origin"
```

- [ ] **Step 6: Release note memory** — update `~/.claude/projects/-Users-jackuait-Packages-blok/memory/image-chrome-islands-shipped.md` (or add `image-chrome-paper-graphite-shipped.md` and link it from MEMORY.md "Active Work") with: the shipping commit, "release note owed (not BREAKING)", the sampling-copy design and the measured cache/WebKit results.

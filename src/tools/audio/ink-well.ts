import { renderMediaEmptyState, type MediaEmptyStateLabels } from '../../components/utils/media-empty-state';
import { createSafeObjectUrl } from '../../shared/safe-object-url';
import { safeImageSrc } from '../../shared/sanitize-url';

/**
 * The audio cover picker's surface: the ink drop sits in a square well beside
 * the shared uploader. The drop leans toward the pointer and reaches for a
 * dragged file. Given a picture, it floods the well and opens up onto it.
 */

export type WellMode = 'idle' | 'flood' | 'open' | 'done';

/** Lengths are fractions of the well's side. */
export interface WellShape {
  mode: WellMode;
  /** The drop's radius; while flooding, how far the ink has spread. */
  radius: number;
  /** 0 standing straight, 1 reaching fully for the pointer. */
  lean: number;
  /** Radius of the hole the picture shows through while opening. */
  hole: number;
  /** 0..1 through the opening; the hole's edge calms as it nears 1. */
  opened: number;
}

export interface WellInput {
  /** A file is being dragged over the picker. */
  dragging: boolean;
  /** The pointer is over the well. */
  near: boolean;
}

export interface WellMotion {
  step(nowMs: number, input: WellInput): WellShape;
  /** A picture arrived: flood, then open onto it. */
  take(nowMs: number): void;
  /** Show the picture with no motion. */
  show(): void;
  /** Back to the drop. */
  reset(): void;
  /** True from the take until the picture is fully open. */
  busy(): boolean;
}

export const WELL_FLOOD_MS = 340;
export const WELL_OPEN_MS = 700;
/** How long the opened picture stays up before `settle()` lets the picker close. */
export const WELL_HOLD_MS = 280;

const REST_RADIUS = 0.19;
const DRAG_RADIUS = 0.25;
/** Past the corners, so the flood and the hole cover the whole square. */
const FAR_RADIUS = 0.78;
const NEAR_LEAN = 0.35;
/** Share of the gap closed per 60Hz frame. */
const RADIUS_EASE = 0.16;
const LEAN_EASE = 0.14;

const easeOver = (perFrame: number, dtSec: number): number => 1 - (1 - perFrame) ** (dtSec * 60);

export function createWellMotion(): WellMotion {
  const state = { mode: 'idle' as WellMode, radius: 0, lean: 0, hole: 0, opened: 0, startedAt: 0, from: 0, last: -1 };
  const leanFor = (input: WellInput): number => {
    if (input.dragging) return 1;

    return input.near ? NEAR_LEAN : 0;
  };

  const advance: Record<WellMode, (nowMs: number, input: WellInput, dtSec: number) => void> = {
    idle: (_now, input, dtSec) => {
      const target = input.dragging ? DRAG_RADIUS : REST_RADIUS;

      state.radius += (target - state.radius) * easeOver(RADIUS_EASE, dtSec);
    },
    flood: (nowMs) => {
      const through = Math.min(1, (nowMs - state.startedAt) / WELL_FLOOD_MS);

      state.radius = state.from + (FAR_RADIUS - state.from) * through * through;
      if (through >= 1) Object.assign(state, { mode: 'open', startedAt: nowMs, hole: 0, opened: 0 });
    },
    open: (nowMs) => {
      const through = Math.min(1, (nowMs - state.startedAt) / WELL_OPEN_MS);

      state.opened = 1 - (1 - through) ** 3;
      state.hole = FAR_RADIUS * state.opened;
      if (through >= 1) Object.assign(state, { mode: 'done', radius: 0 });
    },
    done: () => undefined,
  };

  return {
    step(nowMs: number, input: WellInput): WellShape {
      const dtSec = state.last < 0 ? 0 : Math.max(0, (nowMs - state.last) / 1000);
      const drawn = state.mode;

      state.last = nowMs;
      state.lean += (leanFor(input) - state.lean) * easeOver(LEAN_EASE, dtSec);
      advance[drawn](nowMs, input, dtSec);

      // The frame that ends a phase is still drawn as that phase.
      return { mode: drawn, radius: state.radius, lean: state.lean, hole: state.hole, opened: state.opened };
    },
    take(nowMs: number): void {
      Object.assign(state, { from: state.mode === 'idle' ? state.radius : 0, mode: 'flood', startedAt: nowMs });
    },
    show(): void {
      Object.assign(state, { mode: 'done', radius: 0 });
    },
    reset(): void {
      Object.assign(state, { mode: 'idle', radius: 0 });
    },
    busy: () => state.mode === 'flood' || state.mode === 'open',
  };
}

interface WellPaint {
  size: number;
  shape: WellShape;
  /** Pointer inside the well, in px. */
  pointer: { x: number; y: number };
  timeSec: number;
  /** The picture being opened onto or shown. */
  image: HTMLImageElement | null;
  /** The picture that was there before; the flood rises over it. */
  previous: HTMLImageElement | null;
  ink: string;
  sheen: string;
}

const BLOB_POINTS = 72;
const TURN = Math.PI * 2;

/** A wobbling drop. `reach` stretches it toward `toward`; `wobble` scales the ripple on its edge. */
function traceBlob(ctx: CanvasRenderingContext2D, at: { x: number; y: number; radius: number }, timeSec: number, toward: number, reach: number, wobble: number): void {
  ctx.beginPath();
  Array.from({ length: BLOB_POINTS + 1 }, (_, i) => (i / BLOB_POINTS) * TURN).forEach((angle) => {
    const stretch = Math.max(0, Math.cos(angle - toward)) ** 3;
    const ripple = 0.06 * Math.sin(3 * angle + timeSec * 1.3) + 0.04 * Math.sin(5 * angle - timeSec * 1.9);
    const radius = at.radius * (1 + wobble * ripple + reach * 0.55 * stretch);

    ctx.lineTo(at.x + Math.cos(angle) * radius, at.y + Math.sin(angle) * radius);
  });
  ctx.closePath();
}

/** Centre-crops the picture to the square. */
function drawPicture(ctx: CanvasRenderingContext2D, image: HTMLImageElement, size: number): void {
  const side = Math.min(image.width, image.height);

  ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
}

function paintIdle(context: CanvasRenderingContext2D, paint: WellPaint): void {
  const ctx = context;
  const { size, shape, pointer, timeSec } = paint;
  const centre = size / 2;
  const toward = Math.atan2(pointer.y - centre, pointer.x - centre);
  const radius = shape.radius * size;
  const nudge = shape.lean * size * 0.07;

  traceBlob(ctx, { x: centre + Math.cos(toward) * nudge, y: centre + Math.sin(toward) * nudge, radius }, timeSec, toward, shape.lean, 1);
  ctx.fillStyle = paint.ink;
  ctx.fill();
  ctx.fillStyle = paint.sheen;
  ctx.beginPath();
  ctx.ellipse(centre - radius * 0.32, centre - radius * 0.36, radius * 0.26, radius * 0.15, -0.6, 0, TURN);
  ctx.fill();
}

function paintFlood(context: CanvasRenderingContext2D, paint: WellPaint): void {
  const ctx = context;
  const { size, shape, timeSec } = paint;

  if (paint.previous) drawPicture(ctx, paint.previous, size);
  traceBlob(ctx, { x: size / 2, y: size / 2, radius: shape.radius * size }, timeSec * 6, 0, 0, 1.6);
  ctx.fillStyle = paint.ink;
  ctx.fill();
}

function paintOpen(context: CanvasRenderingContext2D, paint: WellPaint): void {
  const ctx = context;
  const { size, shape, timeSec } = paint;
  const centre = size / 2;
  const calm = 1 - shape.opened;

  if (paint.image) drawPicture(ctx, paint.image, size);
  // Ink over everything but a hole: the square one way round, the hole the other.
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  Array.from({ length: BLOB_POINTS + 1 }, (_, i) => ((BLOB_POINTS - i) / BLOB_POINTS) * TURN).forEach((angle) => {
    const ripple = 0.1 * Math.sin(4 * angle + timeSec * 5) + 0.06 * Math.sin(7 * angle - timeSec * 3);
    const radius = shape.hole * size * (1 + ripple * calm);

    ctx.lineTo(centre + Math.cos(angle) * radius, centre + Math.sin(angle) * radius);
  });
  ctx.fillStyle = paint.ink;
  ctx.fill('evenodd');
}

function paintDone(context: CanvasRenderingContext2D, paint: WellPaint): void {
  const ctx = context;
  const { size, shape, pointer, timeSec } = paint;

  if (paint.image) drawPicture(ctx, paint.image, size);
  // A small drop follows the pointer: the well still takes a new picture.
  if (shape.lean <= 0.02) return;
  ctx.globalAlpha = shape.lean * 0.85;
  traceBlob(ctx, { x: pointer.x, y: pointer.y, radius: size * 0.1 * shape.lean }, timeSec, 0, 0, 1);
  ctx.fillStyle = paint.ink;
  ctx.fill();
  ctx.globalAlpha = 1;
}

const PAINTERS: Record<WellMode, (ctx: CanvasRenderingContext2D, paint: WellPaint) => void> = {
  idle: paintIdle,
  flood: paintFlood,
  open: paintOpen,
  done: paintDone,
};

export interface InkWellLabels extends MediaEmptyStateLabels {
  wellAria: string;
}

export interface InkWellOptions {
  acceptTypes: string[];
  labels: InkWellLabels;
  /** The cover the track has now, shown in the well from the start. */
  current?: string;
  onFile(file: File): void;
  onUrl(url: string): void;
}

export interface InkWellElement extends HTMLElement {
  setError(message: string | null): void;
  /** Resolves once no picture is loading or opening. */
  settle(): Promise<void>;
  destroy(): void;
}

const MAX_PIXEL_RATIO = 2;
/** A linked picture slower than this is set without the opening. */
const LOAD_TIMEOUT_MS = 3000;

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, role: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  el.className = className;
  el.setAttribute('data-role', role);

  return el;
}

export function renderInkWell(opts: InkWellOptions): InkWellElement {
  const { labels } = opts;
  const root = make('div', 'blok-ink-well', 'ink-well-surface');

  const well = make('div', 'blok-ink-well__well', 'ink-well');
  well.setAttribute('role', 'button');
  well.tabIndex = 0;
  well.setAttribute('aria-label', labels.wellAria);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-role', 'ink-well-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  well.append(canvas);

  // The well is the drawing, so the uploader brings none of its own.
  const side = renderMediaEmptyState({
    acceptTypes: opts.acceptTypes,
    labels,
    onFile: (file) => takeFile(file),
    onUrl: (url) => takeUrl(url),
  });
  const fileInput = side.querySelector<HTMLInputElement>('input[type="file"]');

  root.append(well, side);

  const motion = createWellMotion();
  const state = {
    destroyed: false,
    rafId: 0,
    // Counted, not a flag: dragenter and dragleave fire for every child crossed.
    dragDepth: 0,
    near: false,
    pointer: { x: 0, y: 0 },
    image: null as HTMLImageElement | null,
    previous: null as HTMLImageElement | null,
    // The picture still loading. A newer take, an error or destroy ends it.
    loading: null as { url: string; owned: boolean; timer: ReturnType<typeof setTimeout> } | null,
    waiting: [] as Array<() => void>,
    // Frame clock, and the frame time the opened picture is held until.
    now: 0,
    holdUntil: 0,
  };

  const busy = (): boolean => state.loading !== null || motion.busy() || state.now < state.holdUntil;
  const release = (): void => {
    if (!busy()) state.waiting.splice(0).forEach((resolve) => resolve());
  };

  const paint = (shape: WellShape, now: number): void => {
    const size = canvas.clientWidth;

    if (size <= 0) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const pixels = Math.round(size * ratio);

    // Resizing clears the backing store, so only do it when the box changed.
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    const ctx = canvas.getContext('2d');

    if (!ctx) return;
    const styles = getComputedStyle(canvas);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    PAINTERS[shape.mode](ctx, {
      size,
      shape,
      pointer: state.pointer,
      timeSec: now / 1000,
      image: state.image,
      previous: state.previous,
      ink: styles.getPropertyValue('--blok-audio-well-ink').trim() || '#0b0b0c',
      sheen: styles.getPropertyValue('--blok-audio-well-sheen').trim() || 'rgba(255, 255, 255, 0.2)',
    });
  };

  const input = (): WellInput => ({ dragging: state.dragDepth > 0, near: state.near });

  const frame = (now: number): void => {
    const shape = motion.step(now, input());

    state.now = now;
    paint(shape, now);
    if (shape.mode === 'open' && !motion.busy()) {
      state.previous = state.image;
      state.holdUntil = now + WELL_HOLD_MS;
    }
    release();
    state.rafId = requestAnimationFrame(frame);
  };

  /** One still frame, for when no loop runs. */
  const paintStill = (): void => {
    const now = globalThis.performance?.now?.() ?? 0;

    paint(motion.step(now, input()), 0);
  };

  const endLoading = (): void => {
    const loading = state.loading;

    if (!loading) return;
    clearTimeout(loading.timer);
    if (loading.owned) URL.revokeObjectURL(loading.url);
    state.loading = null;
  };

  /** Loads the picture, then floods and opens onto it. `owned` blob URLs are freed once read. */
  const reveal = (url: string, owned: boolean, still = false): void => {
    endLoading();
    const image = new Image();
    const loading = { url, owned, timer: setTimeout(() => { if (state.loading === loading) { endLoading(); release(); } }, LOAD_TIMEOUT_MS) };

    state.loading = loading;
    image.onload = (): void => {
      if (state.loading !== loading || state.destroyed) return;
      endLoading();
      state.image = image;
      if (still || prefersReducedMotion()) {
        state.previous = image;
        motion.show();
        paintStill();
        release();

        return;
      }
      motion.take(globalThis.performance?.now?.() ?? 0);
    };
    image.onerror = (): void => {
      if (state.loading !== loading) return;
      endLoading();
      release();
    };
    image.src = url;
  };

  function takeFile(file: File): void {
    side.setError(null);
    reveal(createSafeObjectUrl(file), true);
    opts.onFile(file);
  }
  function takeUrl(url: string): void {
    side.setError(null);
    const safe = safeImageSrc(url);

    if (safe !== null) reveal(safe, false);
    opts.onUrl(url);
  }

  const openChooser = (): void => fileInput?.click();
  const onWellKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openChooser();
  };
  const trackPointer = (event: { clientX: number; clientY: number }): void => {
    const box = well.getBoundingClientRect();

    state.pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const onPointerMove = (event: PointerEvent): void => {
    state.near = true;
    trackPointer(event);
  };
  const onPointerLeave = (): void => {
    state.near = false;
  };

  const carriesFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') ?? false;
  const setDragDepth = (depth: number): void => {
    state.dragDepth = Math.max(0, depth);
    well.classList.toggle('is-dragover', state.dragDepth > 0);
  };
  const onDragEnter = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragDepth(state.dragDepth + 1);
    trackPointer(event);
  };
  const onDragOver = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    trackPointer(event);
  };
  const onDragLeave = (): void => setDragDepth(state.dragDepth - 1);
  const onDrop = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragDepth(0);
    // The uploader hands over a file dropped on it; taking it here too would send it twice.
    if (event.target instanceof Node && side.contains(event.target)) return;
    const file = event.dataTransfer?.files?.[0];

    if (file) takeFile(file);
  };

  well.addEventListener('click', openChooser);
  well.addEventListener('keydown', onWellKey);
  well.addEventListener('pointermove', onPointerMove);
  well.addEventListener('pointerleave', onPointerLeave);
  root.addEventListener('dragenter', onDragEnter);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);

  // The canvas has no box until the picker is in the page.
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (!state.rafId) paintStill();
  });

  resizeObserver?.observe(canvas);
  if (opts.current) {
    const safe = safeImageSrc(opts.current);

    if (safe !== null) reveal(safe, false, true);
  }
  if (!prefersReducedMotion()) state.rafId = requestAnimationFrame(frame);

  const setError = (message: string | null): void => {
    side.setError(message);
    if (!message) return;
    // The picture did not make it: back to what was there.
    endLoading();
    state.holdUntil = 0;
    state.image = state.previous;
    if (state.previous) motion.show();
    else motion.reset();
    if (!state.rafId) paintStill();
    release();
  };
  const settle = (): Promise<void> => new Promise((resolve) => {
    state.waiting.push(resolve);
    release();
  });
  const destroy = (): void => {
    state.destroyed = true;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    endLoading();
    resizeObserver?.disconnect();
    well.removeEventListener('click', openChooser);
    well.removeEventListener('keydown', onWellKey);
    well.removeEventListener('pointermove', onPointerMove);
    well.removeEventListener('pointerleave', onPointerLeave);
    root.removeEventListener('dragenter', onDragEnter);
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragleave', onDragLeave);
    root.removeEventListener('drop', onDrop);
    // Nothing will open now: let anyone waiting go on.
    state.waiting.splice(0).forEach((resolve) => resolve());
  };

  return Object.assign(root, { setError, settle, destroy });
}

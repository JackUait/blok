import { prefersReducedMotion } from '../../../components/utils/reduced-motion';
import type { ErrorScene, SceneColors, ScenePointer } from './types';

/** How long the whole card must be on screen before its object breaks. */
export const BREAK_DELAY_MS = 500;

/** Below this card width the object sits above the words. audio.css switches the card's layout at the same width. */
const NARROW_BELOW = 520;
/** Height of that strip. The card's top padding in audio.css leaves room for it. */
const NARROW_SCENE_HEIGHT = 172;
/** Share of a wide card kept for the words. audio.css gives them a little less. */
const WORDS_SHARE = 0.47;
const MAX_SCALE = 2;
const MAX_FRAME_S = 0.033;
const FIRST_FRAME_S = 1 / 60;
/** Fifteen simulated seconds: enough for every scene to come to rest. */
const SETTLE_STEPS = 900;
const SETTLE_DT = 1 / 60;
/** Just under 1: a card on a half-pixel edge never reports exactly 1. */
const FULL_VIEW = 0.99;
const POINTER_FADE = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';

const made = { filters: 0 };

export interface ErrorStageHandle {
  destroy(): void;
}

const readColors = (canvas: HTMLCanvasElement): SceneColors => {
  const style = getComputedStyle(canvas);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;

  return {
    ink: read('--blok-audio-scene-ink', '#000000'),
    card: read('--blok-audio-scene-card', '#ffffff'),
    muted: read('--blok-audio-scene-muted', '#a3a39e'),
  };
};

/** Blur then a hard alpha cut: nearby blobs of ink join into one wet shape. */
const addGoo = (card: HTMLElement, canvas: HTMLCanvasElement): HTMLCanvasElement => {
  made.filters += 1;
  const id = `blok-audio-error-goo-${made.filters}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  const filter = document.createElementNS(SVG_NS, 'filter');
  const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
  const cut = document.createElementNS(SVG_NS, 'feColorMatrix');
  const overlay = document.createElement('canvas');

  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-role', 'audio-error-goo');
  filter.id = id;
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  blur.setAttribute('in', 'SourceGraphic');
  blur.setAttribute('stdDeviation', '2.5');
  cut.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7');
  filter.append(blur, cut);
  svg.append(filter);
  overlay.className = canvas.className;
  overlay.setAttribute('data-role', 'audio-error-gloss');
  overlay.setAttribute('aria-hidden', 'true');
  canvas.style.setProperty('filter', `url(#${id})`);
  canvas.after(overlay);
  card.append(svg);

  return overlay;
};

/**
 * Runs one scene on the error card's canvas. The object stays whole until the
 * card has been fully on screen for BREAK_DELAY_MS, then breaks once and can be
 * touched. Frames are only asked for while something moves and the card is on
 * screen.
 *
 * @param canvas - fills the card; the scene is drawn on it
 * @param card - the error card; its size sets the layout
 * @param scene - the object to show
 */
export function mountErrorStage(canvas: HTMLCanvasElement, card: HTMLElement, scene: ErrorScene): ErrorStageHandle {
  if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
    return { destroy: () => undefined };
  }

  const pointer: ScenePointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, down: false };
  const idle: ScenePointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, down: false };
  const overlay = scene.goo ? addGoo(card, canvas) : null;
  const state: {
    width: number;
    height: number;
    scale: number;
    played: boolean;
    /** The scene still wants frames. */
    moving: boolean;
    visible: boolean;
    destroyed: boolean;
    frame: number | null;
    last: number | null;
    timer: ReturnType<typeof setTimeout> | null;
    movedAt: number;
  } = { width: 0, height: 0, scale: 1, played: false, moving: false, visible: false, destroyed: false, frame: null, last: null, timer: null, movedAt: 0 };

  if (scene.drag) canvas.setAttribute('data-drag', 'true');

  const paintOn = (target: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D, colors: SceneColors) => void, colors: SceneColors): void => {
    const ctx = target.getContext('2d');

    if (!ctx) return;
    ctx.setTransform(state.scale, 0, 0, state.scale, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);
    draw(ctx, colors);
  };

  const paint = (): void => {
    if (state.width === 0) return;
    const colors = readColors(canvas);

    paintOn(canvas, (ctx, inks) => scene.paint(ctx, inks), colors);
    if (overlay) paintOn(overlay, (ctx, inks) => scene.paintOverlay?.(ctx, inks), colors);
  };

  const settle = (): void => {
    Array.from({ length: SETTLE_STEPS }).some(() => !scene.step(SETTLE_DT, idle));
    state.moving = false;
  };

  const stop = (): void => {
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    state.last = null;
  };

  const onFrame = (now: number): void => {
    state.frame = null;
    if (state.destroyed) return;
    const dt = state.last === null ? FIRST_FRAME_S : Math.min(MAX_FRAME_S, (now - state.last) / 1000);
    const fade = Math.exp(-POINTER_FADE * dt);

    state.last = now;
    state.moving = scene.step(dt, pointer);
    pointer.vx *= fade;
    pointer.vy *= fade;
    paint();
    if (state.moving) state.frame = requestAnimationFrame(onFrame);
  };

  const run = (): void => {
    if (!state.played || !state.moving || !state.visible || state.frame !== null || state.destroyed) return;
    state.frame = requestAnimationFrame(onFrame);
  };

  const rouse = (): void => {
    if (!state.played || prefersReducedMotion()) return;
    state.moving = true;
    run();
  };

  const play = (): void => {
    state.timer = null;
    if (state.destroyed || state.played) return;
    state.played = true;
    if (prefersReducedMotion()) {
      settle();
      paint();

      return;
    }
    rouse();
  };

  const measure = (): void => {
    const width = Math.round(card.clientWidth);
    const height = Math.round(card.clientHeight);

    if (width === 0 || height === 0 || (width === state.width && height === state.height)) return;
    const scale = Math.min(globalThis.devicePixelRatio || 1, MAX_SCALE);
    const narrow = width < NARROW_BELOW;
    const left = Math.round(width * WORDS_SHARE);

    state.width = width;
    state.height = height;
    state.scale = scale;
    [canvas, overlay].forEach((target) => {
      target?.setAttribute('width', String(Math.round(width * scale)));
      target?.setAttribute('height', String(Math.round(height * scale)));
    });
    scene.layout({
      width,
      height,
      scale,
      zone: narrow
        ? { x: 0, y: 0, width, floor: NARROW_SCENE_HEIGHT }
        : { x: left, y: 0, width: width - left, floor: height },
    });
    scene.reset();
    stop();
    if (state.played) settle();
    paint();
  };

  const clearTimer = (): void => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  };

  const watchView = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];

    if (!entry) return;
    state.visible = entry.isIntersecting;
    if (state.visible) run();
    else stop();
    if (state.played) return;
    if (entry.intersectionRatio < FULL_VIEW) {
      clearTimer();

      return;
    }
    if (state.timer === null) state.timer = setTimeout(play, BREAK_DELAY_MS);
  }, { threshold: [0, FULL_VIEW, 1] });
  const watchSize = new ResizeObserver(measure);

  const track = (event: PointerEvent | MouseEvent): void => {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const dt = Math.max(0.004, (event.timeStamp - state.movedAt) / 1000);

    if (pointer.inside && dt < 0.2) {
      pointer.vx = pointer.vx * 0.5 + ((x - pointer.x) / dt) * 0.5;
      pointer.vy = pointer.vy * 0.5 + ((y - pointer.y) / dt) * 0.5;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    state.movedAt = event.timeStamp;
  };
  const onMove = (event: PointerEvent): void => {
    track(event);
    rouse();
  };
  const onDown = (event: PointerEvent): void => {
    track(event);
    pointer.down = true;
    if (scene.drag && typeof event.pointerId === 'number') canvas.setPointerCapture?.(event.pointerId);
    if (state.played) scene.press?.(pointer);
    rouse();
  };
  const onUp = (): void => {
    pointer.down = false;
    if (state.played) scene.release?.();
    rouse();
  };
  const onCancel = (): void => {
    pointer.inside = false;
    onUp();
  };
  const onLeave = (): void => {
    if (!pointer.down) pointer.inside = false;
    rouse();
  };
  const repaintAtRest = (): void => {
    if (state.frame === null) paint();
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);

  // The colours follow the theme, and a theme change sends the canvas no event.
  const watchTheme = typeof MutationObserver === 'undefined' ? null : new MutationObserver(repaintAtRest);
  const scheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

  watchTheme?.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-blok-theme'] });
  scheme?.addEventListener?.('change', repaintAtRest);
  watchView.observe(card);
  watchSize.observe(card);
  measure();

  return {
    destroy(): void {
      state.destroyed = true;
      stop();
      clearTimer();
      watchView.disconnect();
      watchSize.disconnect();
      watchTheme?.disconnect();
      scheme?.removeEventListener?.('change', repaintAtRest);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}

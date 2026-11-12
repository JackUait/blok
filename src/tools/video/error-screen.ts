import { prefersReducedMotion } from '../../components/utils/reduced-motion';

const WIDTH = 480;
const HEIGHT = 272;
/** One macroblock. WIDTH and HEIGHT are multiples of it. */
const BLOCK = 16;
const COLUMNS = WIDTH / BLOCK;
const ROWS = HEIGHT / BLOCK;
const TICK = 1 / 60;
/** Seconds the clean frame stands before it starts to melt. */
const HOLD = 0.6;
const KEYFRAME_EVERY = 8;
const KEYFRAME_LASTS = 0.35;
const COPIES_PER_TICK = 46;
/** How far from the pointer a block still follows it, in canvas pixels. */
const POINTER_REACH = 110;
const STILL_TICKS = 240;

const BAR_FALLBACKS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
const BLACK = '#131313';
const BOTTOM_ROW = ['#00214c', '#ffffff', '#32006a', BLACK, '#090909', '#1d1d1d'];
const GLITCH_INKS = ['#ff00c8', '#00ff9d', '#1b00ff'];

const hash = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;

  return s - Math.floor(s);
};

const randomCell = (cells: number): number => Math.floor(Math.random() * cells) * BLOCK;

/** The broadcast test pattern: seven bars, a reversed strip, a dark bottom row. */
const paintBars = (target: HTMLCanvasElement, bars: string[]): boolean => {
  const ctx = target.getContext('2d');

  if (!ctx) return false;

  const rows: Array<[string[], number, number]> = [
    [bars, 0, HEIGHT * 0.66],
    [[bars[6], BLACK, bars[4], BLACK, bars[2], BLACK, bars[0]], HEIGHT * 0.66, HEIGHT * 0.08],
    [BOTTOM_ROW, HEIGHT * 0.74, HEIGHT * 0.26 + 1],
  ];

  rows.forEach(([colors, y, height]) => colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(i * WIDTH / colors.length), y, Math.ceil(WIDTH / colors.length), height);
  }));

  return true;
};

const sized = (): HTMLCanvasElement => {
  const el = document.createElement('canvas');

  el.width = WIDTH;
  el.height = HEIGHT;

  return el;
};

/**
 * The failed player's picture: colour bars that melt like a video stream that
 * lost its keyframe. It runs only while on screen and stops by itself once the
 * canvas leaves the page, so the tool has nothing to tear down.
 *
 * @param canvas - the picture
 * @param host - the element whose pointer drags the melting blocks
 */
export function mountErrorScreen(canvas: HTMLCanvasElement, host: HTMLElement): void {
  if (typeof IntersectionObserver === 'undefined') return;

  const pointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false };
  const columnSpeed = Array.from({ length: COLUMNS }, (_, i) => 1 + hash(i, 3) * 3);
  const state: {
    ctx: CanvasRenderingContext2D | null;
    source: HTMLCanvasElement | null;
    frame: number | null;
    last: number | null;
    time: number;
    owed: number;
    still: boolean;
  } = { ctx: null, source: null, frame: null, last: null, time: 0, owed: 0, still: false };

  const prepare = (): boolean => {
    if (state.ctx) return true;

    const source = sized();

    canvas.setAttribute('width', String(WIDTH));
    canvas.setAttribute('height', String(HEIGHT));

    const ctx = canvas.getContext('2d');
    const style = getComputedStyle(canvas);
    const bars = BAR_FALLBACKS.map((fallback, i) =>
      style.getPropertyValue(`--blok-video-error-bar-${i + 1}`).trim() || fallback);

    if (!ctx || !paintBars(source, bars)) return false;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0);
    state.ctx = ctx;
    state.source = source;

    return true;
  };

  const copyBlock = (ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, keyframe: boolean): void => {
    const x = randomCell(COLUMNS);
    const y = randomCell(ROWS);

    if (keyframe) {
      if (Math.random() < 0.5) ctx.drawImage(source, x, y, BLOCK, BLOCK, x, y, BLOCK, BLOCK);

      return;
    }

    const near = pointer.inside && Math.hypot(x - pointer.x, y - pointer.y) < POINTER_REACH;
    const dx = (hash(y, 7) - 0.5) * 2 + (near ? pointer.vx * 1.6 : 0);
    const dy = columnSpeed[x / BLOCK] + (near ? pointer.vy * 1.6 : 0);

    ctx.drawImage(canvas, x, y, BLOCK, BLOCK, x + dx, y + dy, BLOCK, BLOCK);
  };

  /** Rare faults: a run of clean blocks in the wrong place, a torn row, a dead block. */
  const glitch = (source: HTMLCanvasElement): void => {
    const ctx = state.ctx;

    if (!ctx) return;
    if (Math.random() < 0.05) {
      const run = BLOCK * (2 + Math.floor(Math.random() * 8));

      ctx.drawImage(source, randomCell(COLUMNS), randomCell(ROWS), run, BLOCK, randomCell(COLUMNS), randomCell(ROWS), run, BLOCK);
    }
    if (Math.random() < 0.03) {
      const y = randomCell(ROWS);
      const height = BLOCK * (1 + Math.floor(Math.random() * 2));

      ctx.drawImage(canvas, 0, y, WIDTH, height, (Math.random() - 0.5) * 90, y, WIDTH, height);
    }
    if (Math.random() < 0.02) {
      ctx.fillStyle = GLITCH_INKS[Math.floor(Math.random() * GLITCH_INKS.length)];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(randomCell(COLUMNS), randomCell(ROWS), BLOCK * (1 + Math.floor(Math.random() * 3)), BLOCK);
      ctx.globalAlpha = 1;
    }
  };

  const tick = (ctx: CanvasRenderingContext2D, source: HTMLCanvasElement): void => {
    state.time += TICK;
    if (state.time < HOLD) return;

    const keyframe = state.time % KEYFRAME_EVERY < KEYFRAME_LASTS;

    Array.from({ length: COPIES_PER_TICK }).forEach(() => copyBlock(ctx, source, keyframe));
    if (!keyframe) glitch(source);
    pointer.vx *= 0.9;
    pointer.vy *= 0.9;
  };

  const stop = (): void => {
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    state.last = null;
  };

  const onFrame = (now: number): void => {
    state.frame = null;
    if (!canvas.isConnected) {
      observer.disconnect();

      return;
    }
    if (!state.ctx || !state.source) return;

    // capped, so a long pause between frames does not replay as one burst
    state.owed += Math.min(0.05, (now - (state.last ?? now)) / 1000);
    state.last = now;
    while (state.owed >= TICK) {
      state.owed -= TICK;
      tick(state.ctx, state.source);
    }
    state.frame = requestAnimationFrame(onFrame);
  };

  const start = (): void => {
    if (state.frame !== null || state.still || !prepare() || !state.ctx || !state.source) return;

    if (prefersReducedMotion()) {
      state.still = true;
      state.time = HOLD;
      const ctx = state.ctx;
      const source = state.source;

      Array.from({ length: STILL_TICKS }).forEach(() => tick(ctx, source));
      observer.disconnect();

      return;
    }
    state.frame = requestAnimationFrame(onFrame);
  };

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) start();
    else stop();
  });

  observer.observe(canvas);

  host.addEventListener('pointermove', (event) => {
    const box = host.getBoundingClientRect();

    if (box.width === 0 || box.height === 0) return;

    const x = (event.clientX - box.left) / box.width * WIDTH;
    const y = (event.clientY - box.top) / box.height * HEIGHT;

    if (pointer.inside) {
      pointer.vx = pointer.vx * 0.6 + (x - pointer.x) * 0.4;
      pointer.vy = pointer.vy * 0.6 + (y - pointer.y) * 0.4;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
  });
  host.addEventListener('pointerleave', () => {
    pointer.inside = false;
    pointer.vx = 0;
    pointer.vy = 0;
  });
}

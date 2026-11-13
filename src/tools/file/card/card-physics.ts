/** What moves besides the lift: the pointer value drives the strip and the gloss, the record spins. */
export type CardFx =
  | 'pdf' | 'text' | 'document' | 'spreadsheet' | 'presentation' | 'code'
  | 'image' | 'video' | 'audio' | 'archive' | 'generic';

/** Where the smoothed pointer value sits while the card is not hovered. */
export const REST_POINTER: Partial<Record<CardFx, number>> & { video: number } = { video: 0.2 };

const REST_TILT = -3;
const LIFT = -12;
/** Degrees the object leans across the card's width. */
const LEAN = 5;
/** Record speed while hovered, in degrees per second. */
const SPIN = 300;

interface Layer {
  el: HTMLElement;
  /** Stiffness and damping. */
  k: number;
  d: number;
  /** Tilt offset from the top object, and how much of the lift it takes. */
  ro: number;
  ys: number;
  y: number;
  vy: number;
  r: number;
  vr: number;
}

export interface Springs {
  hover: boolean;
  /** Pointer position across the card, 0 to 1. */
  px: number;
  readonly stage: HTMLElement;
  readonly fx: CardFx;
  readonly columns: number;
  readonly layers: Layer[];
  p: number;
  vp: number;
  spin: number;
  angle: number;
}

export interface SpringParts {
  /** Gets the pointer, column and angle values. */
  stage: HTMLElement;
  top: HTMLElement;
  /** Sheets under the top object, nearest first; at most two. */
  unders: HTMLElement[];
  fx: CardFx;
  /** Columns the spreadsheet shows. Default 4. */
  columns?: number;
  /** Start this many px below rest, so a new object rises into place. */
  enterFrom?: number;
}

// The top object is stiffest; each sheet under it is softer, so it follows a beat later.
const LAYERS = [
  { k: 260, d: 17, ro: 0, ys: 1 },
  { k: 170, d: 14, ro: 3.2, ys: 0.5 },
  { k: 120, d: 12, ro: -3.4, ys: 0.2 },
];

export function createSprings(parts: SpringParts): Springs {
  const rest = REST_POINTER[parts.fx] ?? 0.5;
  const layers = [parts.top, ...parts.unders.slice(0, 2)].map((el, index): Layer => ({
    el,
    ...LAYERS[index],
    y: parts.enterFrom ?? 0,
    vy: 0,
    r: REST_TILT + LAYERS[index].ro,
    vr: 0,
  }));

  return {
    hover: false,
    px: 0.5,
    stage: parts.stage,
    fx: parts.fx,
    columns: parts.columns ?? 4,
    layers,
    p: rest,
    vp: 0,
    spin: 0,
    angle: 0,
  };
}

/** Pushes the object down, as if the file dropped out of the card. */
export function kickSprings(state: Springs): void {
  state.layers.forEach((layer, index) => {
    // eslint-disable-next-line no-param-reassign -- the spring state is the thing being driven
    layer.vy += 760 - index * 200;
  });
}

/* eslint-disable no-param-reassign -- one integration step writes the spring state it was given */
function stepLayer(layer: Layer, targetY: number, targetR: number, dt: number): boolean {
  layer.vy += (-layer.k * (layer.y - targetY) - layer.d * layer.vy) * dt;
  layer.y += layer.vy * dt;
  layer.vr += (-layer.k * (layer.r - targetR) - layer.d * layer.vr) * dt;
  layer.r += layer.vr * dt;
  const moving = Math.abs(layer.vy) + Math.abs(layer.vr) > 0.05
    || Math.abs(layer.y - targetY) + Math.abs(layer.r - targetR) > 0.02;
  if (!moving) {
    layer.y = targetY;
    layer.r = targetR;
    layer.vy = 0;
    layer.vr = 0;
  }
  layer.el.style.setProperty('--blok-file-y', `${layer.y.toFixed(2)}px`);
  layer.el.style.setProperty('--blok-file-r', `${layer.r.toFixed(2)}deg`);

  return moving;
}

/**
 * Advances the springs by `dt` seconds and writes the result as CSS variables.
 * @returns true while anything still moves
 */
export function stepSprings(state: Springs, dt: number): boolean {
  const { hover, px } = state;
  const targetY = hover ? LIFT : 0;
  const targetR = REST_TILT + (hover ? (px - 0.5) * LEAN : 0);
  const layersMoving = state.layers
    .map((layer) => stepLayer(layer, targetY * layer.ys, targetR + layer.ro * (hover ? 1.8 : 1), dt))
    .some(Boolean);

  const targetP = hover ? px : (REST_POINTER[state.fx] ?? 0.5);
  state.vp += (-140 * (state.p - targetP) - 15 * state.vp) * dt;
  state.p += state.vp * dt;
  const pointerMoving = Math.abs(state.vp) > 0.002 || Math.abs(state.p - targetP) > 0.001;
  if (!pointerMoving) {
    state.p = targetP;
    state.vp = 0;
  }
  state.stage.style.setProperty('--blok-file-p', Math.max(0, Math.min(1, state.p)).toFixed(3));

  if (state.fx === 'spreadsheet') {
    const last = Math.max(0, state.columns - 1);
    const column = hover ? Math.min(last, Math.floor(px * state.columns)) : Math.min(1, last);
    state.stage.style.setProperty('--blok-file-col', String(column));
  }

  if (state.fx !== 'audio') {
    return layersMoving || pointerMoving;
  }
  state.spin += ((hover ? SPIN : 0) - state.spin) * 1.8 * dt;
  state.angle += state.spin * dt;
  state.stage.style.setProperty('--blok-file-a', state.angle.toFixed(1));

  return layersMoving || pointerMoving || Math.abs(state.spin) > 1;
}
/* eslint-enable no-param-reassign */

const loop: { live: Set<Springs>; frame: number; last: number } = { live: new Set(), frame: 0, last: 0 };

function tick(now: number): void {
  // A background tab can hand back a long gap; a big step would throw the springs.
  const dt = Math.min(0.032, (now - loop.last) / 1000);
  loop.last = now;
  loop.live.forEach((state) => {
    if (!stepSprings(state, dt)) {
      loop.live.delete(state);
    }
  });
  loop.frame = loop.live.size > 0 ? requestAnimationFrame(tick) : 0;
}

/** True when the reader asked for less motion; nothing springs then. */
export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Runs the springs until they rest. With reduced motion nothing moves: the object stays at rest. */
export function wakeSprings(state: Springs): void {
  if (reducedMotion()) {
    return;
  }
  loop.live.add(state);
  if (loop.frame === 0) {
    loop.last = performance.now();
    loop.frame = requestAnimationFrame(tick);
  }
}

/** Takes the springs out of the frame loop; call when the card is thrown away. */
export function stopSprings(state: Springs): void {
  loop.live.delete(state);
  if (loop.live.size === 0 && loop.frame !== 0) {
    cancelAnimationFrame(loop.frame);
    loop.frame = 0;
  }
}

import {
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PEGS,
  SPEED_SLIDER_STEP,
  rateToFraction,
  resolveDrag,
  snapRate,
} from './speed-scale';

export interface SpeedWire {
  element: HTMLElement;
  /** The real range input. It takes the keyboard; the wire takes the pointer. */
  slider: HTMLInputElement;
  /** Show this speed. A change that did not come from a drag plucks the wire. */
  sync(rate: number): void;
  /** The card is showing the wire: run the bead in from the start. */
  enter(): void;
  /** The card is hidden: drop any drag, stop drawing, follow the speed silently. */
  rest(): void;
  destroy(): void;
}

export interface SpeedWireOptions {
  label: string;
  reducedMotion: boolean;
  onRate(rate: number): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// viewBox units. video.css places the preset buttons from the same numbers.
const WIDTH = 240;
const HEIGHT = 62;
const PAD = 26;
const SPAN = WIDTH - PAD * 2;
const MID = HEIGHT / 2;
const TAIL = 22;
const BEAD = 8;
const PEG = 4.5;

const MAX_BEND = 22;
const WHEEL_STEP_PX = 9;
/** Physics sub-step. The hum spring is stiff; a whole frame at once would blow up. */
const TICK = 0.004;

const SPRING = {
  bead: { stiffness: 1100, damping: 40 },
  hum: { stiffness: 1500, damping: 6 },
  twang: { stiffness: 2600, damping: 14 },
};
const KICK = { pluck: 150, twang: 260, enter: 260 };
const SWELL = { size: 3.5, held: 1.5, decay: 3.2 };

const ids = { next: 0 };

const svg = (name: string, attrs: Record<string, string | number>, role?: string): SVGElement => {
  const node = document.createElementNS(SVG_NS, name);

  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (role) {
    node.setAttribute('data-role', role);
    node.setAttribute('class', `blok-video-controls__${role}`);
  }

  return node;
};

/** A fade along a horizontal line. userSpaceOnUse: a flat line has no box to fade across. */
const fade = (id: string, from: number, to: number, stops: Array<[number, number]>): SVGElement => {
  const gradient = svg('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: from, y1: 0, x2: to, y2: 0 });

  stops.forEach(([offset, opacity]) => {
    gradient.appendChild(svg('stop', { offset, 'stop-color': 'currentColor', 'stop-opacity': opacity }));
  });

  return gradient;
};

/**
 * The speed control: a bead on a wire with a peg at each preset. The bead follows
 * the pointer, pegs grab it, and the wire bends and hums like a plucked string.
 */
export const createSpeedWire = ({ label, reducedMotion, onRate }: SpeedWireOptions): SpeedWire => {
  const element = document.createElement('div');

  element.className = 'blok-video-controls__speed-wire';
  element.setAttribute('data-role', 'speed-wire');
  // Every slider in the player reads left to right, in RTL too.
  element.dir = 'ltr';

  const uid = `blok-speed-wire-${ids.next++}`;
  const art = svg('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, 'aria-hidden': 'true', focusable: 'false' });

  art.setAttribute('class', 'blok-video-controls__speed-wire-art');

  const defs = svg('defs', {});

  defs.append(
    fade(`${uid}-start`, PAD - TAIL, PAD, [[0, 0], [0.55, 0.75], [1, 1]]),
    fade(`${uid}-end`, WIDTH - PAD, WIDTH - PAD + TAIL, [[0, 1], [0.45, 0.73], [1, 0]])
  );

  const tailStart = svg('line', { x1: PAD - TAIL, y1: MID, x2: PAD, y2: MID, stroke: `url(#${uid}-start)` }, 'wire-tail-start');
  const tailEnd = svg('line', { x1: WIDTH - PAD, y1: MID, x2: WIDTH - PAD + TAIL, y2: MID, stroke: `url(#${uid}-end)` }, 'wire-tail-end');
  const ghost = svg('polyline', { points: '' }, 'wire-ghost');
  const dim = svg('line', { x1: PAD, y1: MID, x2: WIDTH - PAD, y2: MID }, 'wire-dim');
  const glow = svg('line', { x1: PAD, y1: MID, x2: PAD, y2: MID }, 'wire-glow');
  const lit = svg('line', { x1: PAD, y1: MID, x2: PAD, y2: MID }, 'wire-lit');
  const pegs = SPEED_PEGS.map((rate) => {
    const peg = svg('circle', { cx: PAD + rateToFraction(rate) * SPAN, cy: MID, r: PEG }, 'wire-peg');

    return { rate, peg, at: rateToFraction(rate) };
  });
  const bead = svg('circle', { cx: PAD, cy: MID, r: BEAD }, 'wire-bead');

  art.append(defs, tailStart, tailEnd, ghost, dim, glow, lit, ...pegs.map(({ peg }) => peg), bead);

  const slider = document.createElement('input');

  slider.type = 'range';
  slider.dir = 'ltr';
  slider.className = 'blok-video-controls__speed-slider';
  slider.setAttribute('data-role', 'speed-slider');
  slider.min = String(SPEED_MIN);
  slider.max = String(SPEED_MAX);
  slider.step = String(SPEED_SLIDER_STEP);
  slider.setAttribute('aria-label', label);

  element.append(art, slider);

  const state = {
    rate: 1,
    /** Bead position along the wire, 0 to 1, and its speed. */
    pos: rateToFraction(1),
    vel: 0,
    target: rateToFraction(1),
    /** How far the wire is pulled off its line at the bead, and how fast that moves. */
    bend: 0,
    bendVel: 0,
    twang: 0,
    twangVel: 0,
    swell: 0,
    held: null as number | null,
    dragging: false,
    pull: 0,
    resting: true,
    synced: false,
    frame: 0,
    last: 0,
    wheel: 0,
    dead: false,
  };

  const paint = (): void => {
    const x = PAD + Math.min(1.02, Math.max(-0.02, state.pos)) * SPAN;
    const y = MID + state.bend + state.twang;
    const set = (node: SVGElement, attrs: Record<string, number>): void => {
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(Math.round(value * 1000) / 1000)));
    };

    set(lit, { x2: x, y2: y });
    set(glow, { x2: x, y2: y });
    set(dim, { x1: x, y1: y });
    set(bead, { cx: x, cy: y, r: BEAD + SWELL.size * state.swell + (state.held === null || reducedMotion ? 0 : SWELL.held) });
    pegs.forEach(({ peg, at }) => peg.toggleAttribute('data-passed', at <= state.pos + 0.003));

    // The blur of a humming wire: a faint copy on the other side of rest.
    const humming = !state.dragging && Math.abs(state.bend) > 0.6;

    ghost.toggleAttribute('data-active', humming);
    ghost.setAttribute('points', humming ? `${PAD},${MID} ${x.toFixed(2)},${(MID - state.bend * 0.8).toFixed(2)} ${WIDTH - PAD},${MID}` : '');
  };

  const settled = (): boolean =>
    !state.dragging &&
    state.swell === 0 &&
    Math.abs(state.pos - state.target) < 0.0002 && Math.abs(state.vel) < 0.002 &&
    Math.abs(state.bend) < 0.03 && Math.abs(state.bendVel) < 0.5 &&
    Math.abs(state.twang) < 0.03 && Math.abs(state.twangVel) < 0.5;

  const land = (): void => {
    Object.assign(state, { pos: state.target, vel: 0, bend: 0, bendVel: 0, twang: 0, twangVel: 0, swell: 0 });
  };

  const advance = (dt: number): void => {
    const steps = Math.max(1, Math.ceil(dt / TICK));
    const h = dt / steps;

    Array.from({ length: steps }).forEach(() => {
      state.vel += (-(state.pos - state.target) * SPRING.bead.stiffness - state.vel * SPRING.bead.damping) * h;
      state.pos += state.vel * h;
      state.twangVel += (-state.twang * SPRING.twang.stiffness - state.twangVel * SPRING.twang.damping) * h;
      state.twang += state.twangVel * h;
      if (state.dragging) return;
      state.bendVel += (-state.bend * SPRING.hum.stiffness - state.bendVel * SPRING.hum.damping) * h;
      state.bend += state.bendVel * h;
    });
    if (state.dragging) {
      state.bend += (state.pull - state.bend) * Math.min(1, dt * 30);
      state.bendVel = 0;
    }
    state.swell = Math.max(0, state.swell - dt * SWELL.decay);
  };

  const step = (): void => {
    // Not the frame's own timestamp: it may count from another origin than `last`.
    const now = performance.now();

    advance(Math.min(0.05, Math.max(0, now - state.last) / 1000));
    state.last = now;
    if (settled()) {
      land();
      state.frame = 0;
    } else {
      state.frame = requestAnimationFrame(step);
    }
    paint();
  };

  const run = (): void => {
    if (reducedMotion || state.resting || state.dead) {
      land();
      paint();

      return;
    }
    if (state.frame !== 0) return;
    state.last = performance.now();
    state.frame = requestAnimationFrame(step);
  };

  const halt = (): void => {
    cancelAnimationFrame(state.frame);
    state.frame = 0;
  };

  const endDrag = (): void => {
    if (!state.dragging) return;
    Object.assign(state, { dragging: false, held: null, pull: 0 });
    element.removeAttribute('data-dragging');
    run();
  };

  const sync = (rate: number): void => {
    const changed = state.synced && rate !== state.rate;
    const rising = rate > state.rate;

    state.rate = rate;
    state.synced = true;
    state.target = rateToFraction(rate);
    slider.value = String(rate);
    slider.setAttribute('aria-valuetext', `${rate}×`);

    if (changed && !reducedMotion && !state.resting) {
      // A change the pointer did not make plucks the wire.
      if (!state.dragging) state.bendVel += (rising ? -1 : 1) * KICK.pluck;
      if (SPEED_PEGS.includes(rate)) {
        state.swell = 1;
        state.twangVel += (rising ? 1 : -1) * KICK.twang;
      }
    }
    run();
  };

  const dragTo = (event: MouseEvent): void => {
    const box = element.getBoundingClientRect();

    if (!box.width || !box.height) return;

    const scale = box.width / WIDTH;
    const fraction = (event.clientX - box.left - PAD * scale) / (SPAN * scale);
    const off = (event.clientY - box.top) / (box.height / HEIGHT) - MID;
    const next = resolveDrag(fraction, state.held);

    state.held = next.held;
    state.pull = Math.min(MAX_BEND, Math.max(-MAX_BEND, off));
    if (next.rate !== state.rate) onRate(next.rate);
    run();
  };

  const onDown = (event: MouseEvent): void => {
    if (event.button > 0 || state.dead) return;
    event.preventDefault();
    // Focus the range so arrow keys carry on. Chrome counts this scripted focus as
    // :focus-visible, so data-pointer-focus hides the ring until a key is pressed.
    element.setAttribute('data-pointer-focus', '');
    slider.focus({ preventScroll: true });
    if ('pointerId' in event) element.setPointerCapture?.((event as PointerEvent).pointerId);
    state.dragging = true;
    element.setAttribute('data-dragging', 'true');
    dragTo(event);
  };
  const onMove = (event: MouseEvent): void => {
    if (state.dragging) dragTo(event);
  };
  // Wheel and trackpad: the larger axis wins, one step per WHEEL_STEP_PX of travel.
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    state.wheel += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    const steps = Math.trunc(state.wheel / WHEEL_STEP_PX);

    if (!steps) return;
    state.wheel -= steps * WHEEL_STEP_PX;
    onRate(snapRate(state.rate + steps * SPEED_SLIDER_STEP));
  };
  const onSliderInput = (): void => onRate(Number(slider.value));
  const dropPointerFocus = (): void => element.removeAttribute('data-pointer-focus');

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('lostpointercapture', endDrag);
  element.addEventListener('wheel', onWheel, { passive: false });
  slider.addEventListener('input', onSliderInput);
  slider.addEventListener('keydown', dropPointerFocus);
  slider.addEventListener('blur', dropPointerFocus);

  paint();

  return {
    element,
    slider,
    sync,
    enter(): void {
      state.resting = false;
      if (reducedMotion) { run(); return; }
      Object.assign(state, { pos: 0, vel: 0, bendVel: state.bendVel - KICK.enter });
      run();
    },
    rest(): void {
      state.resting = true;
      endDrag();
      halt();
      state.wheel = 0;
      land();
      paint();
    },
    destroy(): void {
      state.dead = true;
      endDrag();
      halt();
    },
  };
};

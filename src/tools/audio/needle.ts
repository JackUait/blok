/**
 * Hardware-feeling motion for the no-cover vinyl tonearm.
 *
 * A real stylus is never still while a record plays: it shivers in the groove
 * and jolts now and then on dust or a scratch — at irregular moments, never on
 * a beat. Pure CSS keyframes loop on a fixed period and read as scripted, so the
 * life here is driven imperatively with the Web Animations API instead:
 *
 *   - a constant sub-degree **tremor** (the groove buzz), and
 *   - occasional **bumps** fired at random delays, in a random variant, at a
 *     random intensity, so no two feel alike.
 *
 * Every animation uses `composite: 'add'`, so it layers on top of the CSS
 * parked/engaged swing (and the JS inward-tracking transform) rather than
 * overwriting it. All of it is gated on prefers-reduced-motion.
 */

interface NeedleHandle {
  /** Begin the tremor + schedule random bumps (no-op if reduced-motion or no arm). */
  start(): void;
  /** Cancel the tremor, any in-flight bumps and the pending timer. */
  stop(): void;
  /** Permanent teardown (alias of stop). */
  destroy(): void;
}

/** A bump is a quick rotation impulse around the pivot, scaled by `amp` (deg). */
type BumpBuilder = (amp: number) => { keyframes: Keyframe[]; options: KeyframeAnimationOptions };

const rot = (deg: number): string => `rotate(${deg.toFixed(3)}deg)`;

/**
 * Three distinct jolt "feels", each scaled by a per-fire random amplitude so
 * repeats never line up: a sharp single tick, a dust-speck double stutter, and
 * a softer wobble that overshoots and settles.
 */
const BUMP_BUILDERS: BumpBuilder[] = [
  // sharp single tick
  (a) => ({
    keyframes: [
      { transform: rot(0) },
      { transform: rot(a), offset: 0.18 },
      { transform: rot(-a * 0.18), offset: 0.5 },
      { transform: rot(0) },
    ],
    options: { duration: 240, easing: 'cubic-bezier(.18,.85,.25,1)', composite: 'add' },
  }),
  // dust-speck double stutter
  (a) => ({
    keyframes: [
      { transform: rot(0) },
      { transform: rot(a * 0.7), offset: 0.14 },
      { transform: rot(0), offset: 0.34 },
      { transform: rot(a * 0.55), offset: 0.55 },
      { transform: rot(-a * 0.12), offset: 0.8 },
      { transform: rot(0) },
    ],
    options: { duration: 470, easing: 'ease-out', composite: 'add' },
  }),
  // soft wobble with a spring overshoot
  (a) => ({
    keyframes: [
      { transform: rot(0) },
      { transform: rot(a), offset: 0.3 },
      { transform: rot(-a * 0.4), offset: 0.62 },
      { transform: rot(a * 0.14), offset: 0.84 },
      { transform: rot(0) },
    ],
    options: { duration: 640, easing: 'cubic-bezier(.3,1.5,.5,1)', composite: 'add' },
  }),
];

/** The always-on groove tremor — a tight, fast shiver, alternated so it breathes. */
const TREMOR: Keyframe[] = [
  { transform: rot(-0.22) },
  { transform: rot(0.16) },
  { transform: rot(-0.1) },
  { transform: rot(0.24) },
];

const BUMP_MIN_DELAY_MS = 2400;
const BUMP_MAX_EXTRA_MS = 6200;
/** Peak bump rotation lands in [0.55, 1.0] × this — visible at the needle tip, not flung. */
const BUMP_AMP_DEG = 2.1;

function prefersReduced(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function createNeedleLife(figure: HTMLElement): NeedleHandle {
  // Mutable state lives on a const record (the repo bans `let`).
  const state: {
    tremor: Animation | null;
    timer: ReturnType<typeof globalThis.setTimeout> | null;
    running: boolean;
  } = { tremor: null, timer: null, running: false };
  const bumps = new Set<Animation>();

  const arm = (): HTMLElement | null => figure.querySelector('.blok-audio-cover__arm');
  const canAnimate = (el: HTMLElement | null): el is HTMLElement =>
    el !== null && typeof el.animate === 'function';

  const fireBump = (el: HTMLElement): void => {
    const builder = BUMP_BUILDERS[Math.floor(Math.random() * BUMP_BUILDERS.length)];
    const amp = BUMP_AMP_DEG * (0.55 + Math.random() * 0.45);
    const { keyframes, options } = builder(amp);
    const anim = el.animate(keyframes, options);
    bumps.add(anim);
    const cleanup = (): void => { bumps.delete(anim); };
    anim.addEventListener('finish', cleanup);
    anim.addEventListener('cancel', cleanup);
  };

  const scheduleBump = (): void => {
    const delay = BUMP_MIN_DELAY_MS + Math.random() * BUMP_MAX_EXTRA_MS;
    state.timer = globalThis.setTimeout(() => {
      const el = arm();
      if (state.running && canAnimate(el)) fireBump(el);
      if (state.running) scheduleBump();
    }, delay);
  };

  const start = (): void => {
    if (state.running || prefersReduced()) return;
    const el = arm();
    if (!canAnimate(el)) return;
    state.running = true;
    state.tremor = el.animate(TREMOR, {
      duration: 170,
      iterations: Infinity,
      direction: 'alternate',
      easing: 'ease-in-out',
      composite: 'add',
    });
    scheduleBump();
  };

  const stop = (): void => {
    state.running = false;
    if (state.timer !== null) { globalThis.clearTimeout(state.timer); state.timer = null; }
    state.tremor?.cancel();
    state.tremor = null;
    bumps.forEach((a) => a.cancel());
    bumps.clear();
  };

  return { start, stop, destroy: stop };
}

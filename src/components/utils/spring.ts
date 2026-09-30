export interface SpringClock {
  now(): number;
  request(cb: () => void): number;
  cancel(id: number): void;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Critically damped: 2·√380 ≈ 39. */
export const SPRING_SNAPPY: SpringConfig = { stiffness: 380, damping: 39 };

/** Damping ratio ≈ 0.88, a hint of overshoot for flights. */
export const SPRING_SOFT: SpringConfig = { stiffness: 220, damping: 26 };

export interface SpringOptions<K extends string> {
  from: Record<K, number>;
  config?: SpringConfig;
  onUpdate(values: Readonly<Record<K, number>>): void;
  onSettle?(): void;
  clock?: SpringClock;
  reducedMotion?: () => boolean;
}

export interface Spring<K extends string> {
  to(target: Partial<Record<K, number>>): void;
  jump(values: Partial<Record<K, number>>): void;
  values(): Readonly<Record<K, number>>;
  isSettled(): boolean;
  stop(): void;
}

// Fixed 4 ms substeps keep the result identical at any frame rate.
const STEP_MS = 4;
// A stalled tab must not fling values on its first frame back.
const MAX_FRAME_MS = 64;
const EPSILON = 1e-3;

const rafClock: SpringClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (id) => cancelAnimationFrame(id),
};

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createSpring<K extends string>(opts: SpringOptions<K>): Spring<K> {
  const clock = opts.clock ?? rafClock;
  const config = opts.config ?? SPRING_SNAPPY;
  const reduced = opts.reducedMotion ?? prefersReducedMotion;
  const keys = Object.keys(opts.from) as K[];
  const pos: Record<K, number> = { ...opts.from };
  const target: Record<K, number> = { ...opts.from };
  const vel = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const run = { frame: 0, last: 0, active: false };

  const assign = (into: Record<K, number>, from: Partial<Record<K, number>>): void => {
    Object.assign(into, Object.fromEntries(keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]])));
  };

  const atRest = (): boolean => keys.every((k) => {
    const tol = EPSILON * Math.max(1, Math.abs(target[k]));

    return Math.abs(pos[k] - target[k]) < tol && Math.abs(vel[k]) < tol;
  });

  const finish = (): void => {
    for (const k of keys) {
      pos[k] = target[k];
      vel[k] = 0;
    }
    run.active = false;
    opts.onUpdate(pos);
    opts.onSettle?.();
  };

  const tick = (): void => {
    const now = clock.now();
    const elapsed = Math.min(MAX_FRAME_MS, now - run.last);

    run.last = now;
    const sub = { t: 0 };

    while (sub.t < elapsed) {
      const dt = Math.min(STEP_MS, elapsed - sub.t) / 1000;

      sub.t += STEP_MS;

      for (const k of keys) {
        const force = -config.stiffness * (pos[k] - target[k]) - config.damping * vel[k];

        vel[k] += force * dt;
        pos[k] += vel[k] * dt;
      }
    }
    if (atRest()) {
      finish();

      return;
    }
    opts.onUpdate(pos);
    run.frame = clock.request(tick);
  };

  return {
    to(next) {
      assign(target, next);
      if (reduced()) {
        clock.cancel(run.frame);
        finish();

        return;
      }
      if (run.active) return;
      run.active = true;
      run.last = clock.now();
      run.frame = clock.request(tick);
    },
    jump(next) {
      assign(pos, next);
      assign(target, next);
      for (const k of keys) {
        if (next[k] !== undefined) vel[k] = 0;
      }
      opts.onUpdate(pos);
    },
    values: () => pos,
    isSettled: () => !run.active,
    stop() {
      clock.cancel(run.frame);
      run.active = false;
    },
  };
}

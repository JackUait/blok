/**
 * Inertial platter spin for the no-cover vinyl record.
 *
 * With the tonearm gone, the disc is the whole show — so it shouldn't just snap
 * on and off. A real platter has mass: it spins UP when the motor engages and
 * COASTS DOWN when power is cut. We model that with an angular velocity that
 * eases toward a target (full speed while playing, 0 when stopped) and integrate
 * it into an accumulated angle each animation frame, driving the disc's
 * `transform: rotate()` directly. Spin-up is brisk; the wind-down uses a longer
 * time constant, so pausing reads as a heavy record slowing to rest rather than
 * stopping dead.
 *
 * The velocity easing is exponential (frame-rate independent — see stepPlatter),
 * so it behaves identically on a 60Hz or 120Hz display. All of it is gated on
 * prefers-reduced-motion: the record simply holds still.
 */

/** Platter motion state: accumulated angle (deg, wrapped) + angular speed (deg/s). */
export interface PlatterState {
  angle: number;
  velocity: number;
}

/** Target speed at a 33⅓-feel — one full turn every ~4s. */
export const PLATTER_FULL_DPS = 90;
/** Time constant (s) for the motor coming up to speed — brisk. */
export const PLATTER_SPINUP_TAU = 0.5;
/** Time constant (s) for the platter coasting to rest — heavier, slower. */
export const PLATTER_SPINDOWN_TAU = 1.2;
/** Below this speed (deg/s) the coast is over — snap to rest and park the loop. */
const PLATTER_REST_DPS = 0.5;
/** Clamp per-frame dt so a backgrounded tab doesn't fling the disc on return. */
const MAX_FRAME_S = 0.05;

/**
 * Advance the platter one frame (pure). Velocity eases toward `targetDps` with an
 * exponential approach over `tauSec`, then the angle integrates that velocity.
 *
 * The approach uses `1 - e^(-dt/tau)`, which composes exactly across substeps
 * (one step of 2·dt equals two steps of dt), so the spin speed is frame-rate
 * independent. A non-positive dt is treated as a no-op.
 */
export function stepPlatter(
  state: PlatterState,
  dtSec: number,
  targetDps: number,
  tauSec: number,
): PlatterState {
  if (dtSec <= 0) return { angle: state.angle, velocity: state.velocity };
  const approach = 1 - Math.exp(-dtSec / tauSec);
  const velocity = state.velocity + (targetDps - state.velocity) * approach;
  const angle = ((state.angle + velocity * dtSec) % 360 + 360) % 360;
  return { angle, velocity };
}

export interface PlatterHandle {
  /** Engage the motor — the disc spins up to full speed. */
  start(): void;
  /** Cut the motor — the disc coasts down to rest. */
  stop(): void;
  /** Permanent teardown — cancels the frame loop. */
  destroy(): void;
}

function prefersReduced(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Drive the no-cover record's spin with inertia. `start()`/`stop()` set the
 * target speed; a single rAF loop eases velocity toward it and writes the disc's
 * rotation each frame, parking itself once the platter has fully coasted to rest.
 */
export function createPlatterSpin(figure: HTMLElement): PlatterHandle {
  // Mutable state on a const record (the repo bans `let`).
  const state: {
    angle: number;
    velocity: number;
    target: number;
    raf: number | null;
    last: number;
  } = { angle: 0, velocity: 0, target: 0, raf: null, last: 0 };

  const disc = (): HTMLElement | null => figure.querySelector('.blok-audio-cover__disc');

  const tick = (now: number): void => {
    const dt = state.last ? Math.min((now - state.last) / 1000, MAX_FRAME_S) : 0;
    state.last = now;
    // Spin-up while accelerating toward the target; the heavier coast on the way down.
    const tau = state.target > state.velocity ? PLATTER_SPINUP_TAU : PLATTER_SPINDOWN_TAU;
    const next = stepPlatter({ angle: state.angle, velocity: state.velocity }, dt, state.target, tau);
    state.angle = next.angle;
    state.velocity = next.velocity;

    const el = disc();
    if (el) el.style.transform = `rotate(${state.angle.toFixed(2)}deg)`;

    // Coasted to a halt — snap clean and let the loop sleep until the next start().
    if (state.target === 0 && state.velocity < PLATTER_REST_DPS) {
      state.velocity = 0;
      state.raf = null;
      return;
    }
    state.raf = globalThis.requestAnimationFrame(tick);
  };

  const ensureRunning = (): void => {
    if (state.raf !== null) return;
    state.last = 0; // first frame measures dt=0, so no jump from a stale timestamp
    state.raf = globalThis.requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (prefersReduced()) return; // reduced motion: the record holds still
    if (!disc()) return; // cover image shown (no placeholder disc) — nothing to spin
    state.target = PLATTER_FULL_DPS;
    ensureRunning();
  };

  const stop = (): void => {
    state.target = 0;
    // Keep the loop alive to animate the wind-down; if it's already at rest
    // (or never spun up under reduced motion) there's nothing to coast.
    if (state.velocity > 0) ensureRunning();
  };

  const destroy = (): void => {
    if (state.raf !== null) {
      globalThis.cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    state.velocity = 0;
    state.target = 0;
  };

  return { start, stop, destroy };
}

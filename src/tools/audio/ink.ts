/**
 * The liquid ink drop on the default audio cover: a ring of springs for the
 * edge, a sprung centre, and droplets that leave the body and fall back in.
 * Pure maths, no DOM. `ink-paint.ts` draws the result.
 */

import type { InkSignals } from './motion';

/** The drop lives in a square this many units wide. */
export const INK_TILE = 44;
export const INK_POINTS = 96;

export interface InkBall { x: number; y: number; r: number; glint: boolean }

export interface InkShape { radii: Float32Array; cx: number; cy: number; balls: InkBall[] }

export interface InkDrop {
  step(signals: InkSignals, dtSec: number): void;
  /** `radii` is the live buffer: copy it to keep a frame. */
  shape(): InkShape;
  /** True when the edge is round and still, the centre is home and no droplets are out. The caller stops its frame loop then. */
  atRest(): boolean;
}

const TAU = Math.PI * 2;
const N = INK_POINTS;
const HOME = INK_TILE / 2;
const REST_RADIUS = 11.5;

const MAX_FRAME_S = 0.05;
const SUBSTEP_S = 1 / 240;

const EDGE_TENSION = 12000;
const EDGE_SPRING = 70;
const EDGE_DAMPING = 4.4;
const CENTRE_SPRING = 150;
const CENTRE_DAMPING = 9;
const CENTRE_LIMIT = 2;

/** How much of the mean bulge is taken out, so a dent does not shrink the whole drop. */
const MEAN_REMOVED = 0.7;
const EDGE_IN_MAX = -5.5;
const EDGE_OUT_MAX = 6;
/** The edge never comes closer than this to the tile side. */
const BODY_REACH = 20.6;
const BALL_REACH = 20.2;
const MIN_BASE_SQ = 60;
const MASS_LOSS = 1.3;
const LEVEL_SWELL = 1.9;
const BASS_SWELL = 3.2;

const KICK_TURN = 2.4;
const KICK_TURN_JITTER = 0.8;
const KICK_DENT = 86.8;
const KICK_WIDTH = 7;
const KICK_PUSH = 26;
const KICK_DROPLET_MIN = 0.26;
const KICK_SPREAD = 0.6;
const KICK_SATELLITE_MIN = 0.6;
const SATELLITE_SPREAD = 0.08;
const SATELLITE_SPEED = 0.8;
const SATELLITE_SIZE = 0.45;

const SNARE_BUMP = 57.8;
const SNARE_WIDTH = 3.5;
const HAT_BUMP = 28.6;
const HAT_WIDTH = 1.8;
const MID_FLOOR = 0.02;
const MID_BUMP = 12;
const MID_WIDTH = 2.5;
const MID_BUMPS = [0, 1];

const DROPLET_GRAVITY = 46;
const DROPLET_DRIFT = 0.6;
const DROPLET_START = -1.2;
const DROPLET_BOUNCE = 0.2;
const DROPLET_SUNK = -1.3;
const TAIL_LAG_S = 0.13;
const TAIL_SIZE = 0.5;
const NECK_SIZE = 0.72;
const NECK_STRETCH = 0.9;
const GLINT_MIN_RADIUS = 0.9;

const REST_EDGE = 0.02;
const REST_EDGE_SPEED = 0.1;
const REST_CENTRE = 0.02;
const REST_CENTRE_SPEED = 0.1;

interface Droplet {
  /** Angle of the head and of the tail that lags behind it. */
  a: number;
  ta: number;
  /** Height of the head and tail above the body edge. */
  d: number;
  tail: number;
  vd: number;
  va: number;
  r: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const wrapAngle = (a: number): number => ((a % TAU) + TAU) % TAU;
const indexOf = (a: number): number => Math.round(wrapAngle(a) / TAU * N) % N;

export function createInkDrop(random: () => number = Math.random): InkDrop {
  const between = (min: number, max: number): number => min + random() * (max - min);
  const sign = (): number => (random() < 0.5 ? 1 : -1);

  const radii = new Float32Array(N).fill(REST_RADIUS);
  const u = new Float32Array(N);
  const v = new Float32Array(N);
  const centre = { ox: 0, oy: 0, vx: 0, vy: 0 };
  const state: { kickAngle: number; droplets: Droplet[]; balls: InkBall[] } = {
    kickAngle: between(0, TAU),
    droplets: [],
    balls: [],
  };

  /** Push the edge speed in (-1) or out (+1) around angle `a`, `width` points wide. */
  const hit = (a: number, strength: number, width: number, dir: number): void => {
    const at = wrapAngle(a) / TAU * N;

    const cursor = { i: 0 };

    while (cursor.i < N) {
      const i = cursor.i;
      const raw = Math.abs(i - at) % N;
      const away = raw > N / 2 ? N - raw : raw;

      v[i] += dir * strength * Math.exp(-((away / width) ** 2));
      cursor.i = i + 1;
    }
  };

  const spawn = (a: number, speed: number, r: number, va: number): void => {
    state.droplets.push({ a, ta: a, d: DROPLET_START * r, tail: DROPLET_START * r, vd: speed, va, r });
  };

  const kick = (s: number): void => {
    state.kickAngle = (state.kickAngle + KICK_TURN + between(-KICK_TURN_JITTER, KICK_TURN_JITTER)) % TAU;
    const a = state.kickAngle;

    hit(a, KICK_DENT * s, KICK_WIDTH, -1);
    centre.vx -= Math.cos(a) * KICK_PUSH * s;
    centre.vy -= Math.sin(a) * KICK_PUSH * s;
    if (s <= KICK_DROPLET_MIN) return;

    const out = a + Math.PI + between(-KICK_SPREAD, KICK_SPREAD);
    const r = (0.8 + 1.5 * s) * between(0.8, 1.1);
    const speed = (17 + 11 * s) * between(0.9, 1.1);

    spawn(out, speed, r, between(-DROPLET_DRIFT, DROPLET_DRIFT));
    if (s > KICK_SATELLITE_MIN) spawn(out + between(-SATELLITE_SPREAD, SATELLITE_SPREAD), speed * SATELLITE_SPEED, r * SATELLITE_SIZE, 0);
  };

  const snare = (s: number): void => {
    const a = between(0, TAU);

    hit(a, SNARE_BUMP * s, SNARE_WIDTH, 1);
    spawn(a, 15 + 8 * s, between(0.6, 0.9), 0);
  };

  const simmer = (mid: number, dt: number): void => {
    const energy = 3 * mid;

    if (energy <= MID_FLOOR) return;
    const strength = MID_BUMP * energy * Math.sqrt(dt * 60);

    MID_BUMPS.forEach(() => hit(between(0, TAU), strength, MID_WIDTH, sign()));
  };

  const substep = (h: number, damp: number, centreDamp: number): void => {
    const cursor = { i: 0 };

    while (cursor.i < N) {
      const i = cursor.i;
      const pull = u[(i + N - 1) % N] + u[(i + 1) % N] - 2 * u[i];

      v[i] = (v[i] + (EDGE_TENSION * pull - EDGE_SPRING * u[i]) * h) * damp;
      cursor.i = i + 1;
    }
    cursor.i = 0;
    while (cursor.i < N) {
      u[cursor.i] += v[cursor.i] * h;
      cursor.i += 1;
    }
    centre.vx = (centre.vx - CENTRE_SPRING * centre.ox * h) * centreDamp;
    centre.vy = (centre.vy - CENTRE_SPRING * centre.oy * h) * centreDamp;
    centre.ox += centre.vx * h;
    centre.oy += centre.vy * h;
  };

  const stepRing = (dt: number): void => {
    const count = Math.max(1, Math.ceil(dt / SUBSTEP_S));
    const h = dt / count;
    const damp = Math.exp(-EDGE_DAMPING * h);
    const centreDamp = Math.exp(-CENTRE_DAMPING * h);

    const done = { n: 0 };

    while (done.n < count) {
      substep(h, damp, centreDamp);
      done.n += 1;
    }
  };

  /** The body thins while droplets are out, so the ink looks conserved. */
  const massBase = (): number => {
    const lost = state.droplets.reduce((sum, q) => (q.d > 0 ? sum + q.r * q.r : sum), 0);

    return Math.sqrt(Math.max(MIN_BASE_SQ, REST_RADIUS * REST_RADIUS - lost * MASS_LOSS));
  };

  const reshape = (base: number): void => {
    const mean = u.reduce((sum, offset) => sum + offset, 0) / N;
    const room = BODY_REACH - Math.max(
      Math.abs(clamp(centre.ox, -CENTRE_LIMIT, CENTRE_LIMIT)),
      Math.abs(clamp(centre.oy, -CENTRE_LIMIT, CENTRE_LIMIT))
    );

    const cursor = { i: 0 };

    while (cursor.i < N) {
      radii[cursor.i] = Math.min(room, base + clamp(u[cursor.i] - mean * MEAN_REMOVED, EDGE_IN_MAX, EDGE_OUT_MAX));
      cursor.i += 1;
    }
  };

  /** Move one droplet. Returns null once it has sunk back into the body. */
  const fly = (q: Droplet, dt: number, lag: number): Droplet | null => {
    const fallen = q.vd - DROPLET_GRAVITY * dt;
    const risen = q.d + fallen * dt;
    const a = q.a + q.va * dt;
    const tail = q.tail + (risen - q.tail) * lag;
    const ta = q.ta + (a - q.ta) * lag;
    const ceiling = BALL_REACH - q.r - radii[indexOf(a)];
    const capped = risen > ceiling;
    const d = capped ? ceiling : risen;
    const vd = capped ? -Math.abs(fallen) * DROPLET_BOUNCE : fallen;

    if (d < DROPLET_SUNK * q.r && vd < 0) {
      hit(a, 5 + q.r * 5, 2.5 + q.r, 1);

      return null;
    }

    return { a, ta, d, tail, vd, va: q.va, r: q.r };
  };

  const ballsOf = (q: Droplet): InkBall[] => {
    const head = radii[indexOf(q.a)] + q.d;
    // The tail follows the head's uncapped height, so it needs its own cap.
    const end = Math.min(radii[indexOf(q.ta)] + q.tail, BALL_REACH - q.r * TAIL_SIZE);
    const balls: InkBall[] = [
      { x: Math.cos(q.a) * head, y: Math.sin(q.a) * head, r: q.r, glint: q.d > q.r * 0.9 && q.r > GLINT_MIN_RADIUS },
      { x: Math.cos(q.ta) * end, y: Math.sin(q.ta) * end, r: q.r * TAIL_SIZE, glint: false },
    ];

    if (Math.abs(q.d - q.tail) <= q.r * NECK_STRETCH) return balls;
    const a = (q.a + q.ta) / 2;
    const mid = (head + end) / 2;

    return [...balls, { x: Math.cos(a) * mid, y: Math.sin(a) * mid, r: q.r * NECK_SIZE, glint: false }];
  };

  const stepDroplets = (dt: number): void => {
    const lag = 1 - Math.exp(-dt / TAIL_LAG_S);
    // Newest first: the smooth union in the painter depends on ball order.
    const moved = state.droplets.map((q) => fly(q, dt, lag)).filter((q): q is Droplet => q !== null);

    state.droplets = moved;
    state.balls = moved.slice().reverse().flatMap(ballsOf);
  };

  const step = (signals: InkSignals, dtSec: number): void => {
    const dt = dtSec > 0 ? Math.min(dtSec, MAX_FRAME_S) : 0;

    if (signals.kick) kick(signals.kick);
    if (signals.snare) snare(signals.snare);
    if (signals.hat) hit(between(0, TAU), HAT_BUMP * signals.hat, HAT_WIDTH, sign());
    simmer(signals.mid, dt);
    stepRing(dt);
    reshape(massBase() + signals.level * LEVEL_SWELL + signals.bass * BASS_SWELL);
    stepDroplets(dt);
  };

  const shape = (): InkShape => ({
    radii,
    cx: HOME + clamp(centre.ox, -CENTRE_LIMIT, CENTRE_LIMIT),
    cy: HOME + clamp(centre.oy, -CENTRE_LIMIT, CENTRE_LIMIT),
    balls: state.balls,
  });

  const atRest = (): boolean => state.droplets.length === 0
    && Math.abs(centre.ox) < REST_CENTRE
    && Math.abs(centre.oy) < REST_CENTRE
    && Math.abs(centre.vx) < REST_CENTRE_SPEED
    && Math.abs(centre.vy) < REST_CENTRE_SPEED
    && u.every((offset) => Math.abs(offset) < REST_EDGE)
    && v.every((speed) => Math.abs(speed) < REST_EDGE_SPEED);

  return { step, shape, atRest };
}

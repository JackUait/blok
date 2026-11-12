import type { ErrorScene, SceneColors, SceneFactory, SceneLayout, ScenePointer } from './types';

/** A point in CSS pixels from the canvas's top-left corner. */
export interface PlugPoint { x: number; y: number }

/** The pulled-plug scene, with read-only views of its state. */
export interface PulledPlugScene extends ErrorScene {
  /** True while the plug sits in the amp's socket. */
  seated(): boolean;
  /** The plug's two ends: the handle the cable enters, and the metal tip. */
  plug(): { handle: PlugPoint; tip: PlugPoint };
  /** The cable's points, from the top edge down to the plug's handle. */
  cable(): PlugPoint[];
}

const TAU = Math.PI * 2;
/** Cable points. Point N - 1 is the plug's handle, point N its tip. */
const N = 14;
const PLUG = 52;
const GRAVITY = 1900;
const DAMPING = 0.992;
const FLOOR_FRICTION = 0.82;
const GRAB_RADIUS = 26;
const SNAP_RADIUS = 16;
/** The tip may pass through the amp's top this close to the socket's centre. */
const HOLE = 9;
/** A grabbed handle stops short of the cable's full length, so the solver is never asked to stretch it. */
const REACH = 0.97;
/** The tip is lighter than a cable point, so the plug swings from its handle. */
const TIP_WEIGHT = 0.6;
const REST_ENERGY = 40;
/** Seconds the plug must stay slow before it counts as at rest: a swing is slow at each end. */
const CALM_S = 0.5;
/** A plug pulled out of the socket cannot snap back until its tip is this far away. */
const REARM_DISTANCE = 22;
const PRESETTLE_STEPS = 180;
const PRESETTLE_DT = 1 / 60;
const AMP_WIDTH = 92;
const SAG = 30;

const PASSES = Array.from({ length: 16 }, (_, i) => i);
const POINTS = Array.from({ length: N + 1 }, (_, i) => i);
const LINKS = POINTS.slice(1);
const CURVE = Array.from({ length: N - 2 }, (_, i) => i + 1);

const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v));

/**
 * A guitar amp with a jack plug on a cable. The plug pops out of the socket on
 * the first step, swings and hangs beside the amp. It can be carried back and
 * lowered into the socket.
 */
export const createPulledPlug = ((): PulledPlugScene => {
  const xs = new Float64Array(N + 1);
  const ys = new Float64Array(N + 1);
  const pxs = new Float64Array(N + 1);
  const pys = new Float64Array(N + 1);
  const vxs = new Float64Array(N + 1);
  const vys = new Float64Array(N + 1);
  const geo = { zoneFloor: 0, floor: 0, sockX: 0, sockY: 0, anchorX: 0, anchorY: 0, boxL: 0, boxR: 0, boxT: 0, seg: 0 };
  const state = { plugged: true, grab: false, primed: false, armed: true, calm: 0 };
  const target = { x: 0, y: 0 };

  const pinned = (i: number): boolean =>
    i === 0 || (state.plugged && i >= N - 1) || (state.grab && i === N - 1);

  const seat = (): void => {
    xs[N - 1] = geo.sockX;
    ys[N - 1] = geo.sockY + 14 - PLUG;
    xs[N] = geo.sockX;
    ys[N] = geo.sockY + 14;
    vxs[N - 1] = 0;
    vys[N - 1] = 0;
    vxs[N] = 0;
    vys[N] = 0;
  };

  const pop = (): void => {
    state.primed = false;
    state.plugged = false;
    vxs[N - 1] = 190;
    vys[N - 1] = -560;
    vxs[N] = 120;
    vys[N] = -470;
  };

  const aim = (pointer: ScenePointer): void => {
    target.x = pointer.x;
    target.y = Math.min(pointer.y, geo.floor - 6);
    if (!state.grab) return;
    const dx = target.x - geo.anchorX;
    const dy = target.y - geo.anchorY;
    const d = Math.hypot(dx, dy);
    const max = geo.seg * (N - 1) * REACH;

    if (d <= max) return;
    target.x = geo.anchorX + dx / d * max;
    target.y = geo.anchorY + dy / d * max;
  };

  const fall = (dt: number): void => {
    POINTS.forEach((i) => {
      pxs[i] = xs[i];
      pys[i] = ys[i];
      if (pinned(i)) return;
      vys[i] += GRAVITY * dt;
      xs[i] += vxs[i] * dt;
      ys[i] += vys[i] * dt;
    });
    xs[0] = geo.anchorX;
    ys[0] = geo.anchorY;
  };

  const link = (i: number): void => {
    const wa = pinned(i - 1) ? 0 : 1;
    const free = i === N ? TIP_WEIGHT : 1;
    const wb = pinned(i) ? 0 : free;

    if (wa + wb === 0) return;
    const dx = xs[i] - xs[i - 1];
    const dy = ys[i] - ys[i - 1];
    const d = Math.hypot(dx, dy) || 1;
    const diff = (d - (i === N ? PLUG : geo.seg)) / d / (wa + wb);

    xs[i - 1] += dx * diff * wa;
    ys[i - 1] += dy * diff * wa;
    xs[i] -= dx * diff * wb;
    ys[i] -= dy * diff * wb;
  };

  const collide = (i: number): void => {
    if (pinned(i)) return;
    if (ys[i] > geo.floor - 3) ys[i] = geo.floor - 3;
    if (i === N && Math.abs(xs[i] - geo.sockX) < HOLE) return;
    if (!(xs[i] > geo.boxL && xs[i] < geo.boxR && ys[i] > geo.boxT)) return;
    const left = xs[i] - geo.boxL;
    const right = geo.boxR - xs[i];
    const up = ys[i] - geo.boxT;

    if (up <= left && up <= right) {
      ys[i] = geo.boxT;

      return;
    }
    xs[i] = right < left ? geo.boxR : geo.boxL;
  };

  const solve = (): void => {
    PASSES.forEach(() => {
      if (state.grab) {
        xs[N - 1] = target.x;
        ys[N - 1] = target.y;
      }
      LINKS.forEach(link);
      POINTS.forEach(collide);
    });
  };

  /** @returns the summed squared speed of the free points */
  const speeds = (dt: number): number => POINTS.reduce((energy, i) => {
    if (pinned(i)) {
      vxs[i] = 0;
      vys[i] = 0;

      return energy;
    }
    vxs[i] = (xs[i] - pxs[i]) / dt * DAMPING;
    vys[i] = (ys[i] - pys[i]) / dt * DAMPING;
    if (ys[i] >= geo.floor - 3.5) vxs[i] *= FLOOR_FRICTION;

    return energy + vxs[i] * vxs[i] + vys[i] * vys[i];
  }, 0);

  /** The tip is at the socket and the plug points down into it. */
  const overSocket = (): boolean =>
    Math.hypot(xs[N] - geo.sockX, ys[N] - geo.sockY) < SNAP_RADIUS && ys[N - 1] < ys[N] - PLUG * 0.5;

  const traceCable = (ctx: CanvasRenderingContext2D): void => {
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    CURVE.forEach((i) => ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2));
    ctx.lineTo(xs[N - 1], ys[N - 1]);
  };

  const paintCable = (ctx: CanvasRenderingContext2D, colors: SceneColors): void => {
    const c = ctx;

    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.22)';
    c.shadowBlur = 5;
    c.shadowOffsetY = 3;
    traceCable(c);
    c.lineWidth = 4;
    c.strokeStyle = colors.ink;
    c.stroke();
    c.restore();
    c.save();
    c.translate(-0.9, -0.9);
    traceCable(c);
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.stroke();
    c.restore();
  };

  /** Drawn along +x from the handle; the caller has moved and turned the context. */
  const paintPlugMetal = (ctx: CanvasRenderingContext2D): void => {
    const c = ctx;
    const metal = c.createLinearGradient(0, -3, 0, 3);

    metal.addColorStop(0, '#fbfbfc');
    metal.addColorStop(0.45, '#b9bac0');
    metal.addColorStop(0.7, '#8b8c93');
    metal.addColorStop(1, '#d9dade');
    c.fillStyle = metal;
    c.beginPath();
    c.moveTo(30, -2.7);
    c.lineTo(47.5, -2.7);
    c.quadraticCurveTo(49, -3.4, 50.5, -2.2);
    c.quadraticCurveTo(52.4, 0, 50.5, 2.2);
    c.quadraticCurveTo(49, 3.4, 47.5, 2.7);
    c.lineTo(30, 2.7);
    c.closePath();
    c.fill();
    c.fillStyle = '#17171a';
    c.fillRect(38.2, -2.9, 1.4, 5.8);
    c.fillRect(43.4, -2.9, 1.4, 5.8);
    c.fillStyle = metal;
    c.fillRect(27.5, -5, 3.2, 10);
  };

  const paintPlugBody = (ctx: CanvasRenderingContext2D, colors: SceneColors): void => {
    const c = ctx;

    c.save();
    c.shadowColor = 'rgba(0,0,0,0.25)';
    c.shadowBlur = 5;
    c.shadowOffsetY = 2;
    c.fillStyle = colors.ink;
    c.beginPath();
    c.moveTo(-1, -2);
    c.lineTo(8, -3.8);
    c.lineTo(8, -6.5);
    c.arcTo(28, -6.5, 28, 0, 2.2);
    c.arcTo(28, 6.5, 8, 6.5, 2.2);
    c.lineTo(8, 6.5);
    c.lineTo(8, 3.8);
    c.lineTo(-1, 2);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.fillRect(9, -5.2, 18, 1.3);
    c.fillStyle = colors.card;
    c.globalAlpha = 0.28;
    [13, 16.5, 20, 23.5].forEach((x) => c.fillRect(x, -6.5, 1.1, 13));
  };

  const paintPlug = (ctx: CanvasRenderingContext2D, colors: SceneColors): void => {
    ctx.save();
    ctx.translate(xs[N - 1], ys[N - 1]);
    ctx.rotate(Math.atan2(ys[N] - ys[N - 1], xs[N] - xs[N - 1]));
    paintPlugMetal(ctx);
    paintPlugBody(ctx, colors);
    ctx.restore();
  };

  const paintAmpCase = (ctx: CanvasRenderingContext2D, bx: number, top: number, bh: number): void => {
    const c = ctx;

    c.save();
    c.shadowColor = 'rgba(0,0,0,0.35)';
    c.shadowBlur = 14;
    c.shadowOffsetY = 4;
    const body = c.createLinearGradient(0, top, 0, top + bh);

    body.addColorStop(0, '#303034');
    body.addColorStop(1, '#151517');
    c.fillStyle = body;
    c.beginPath();
    // 8px taller than the zone: the case runs past the floor, so no bottom corners show.
    c.roundRect(bx, top, AMP_WIDTH, bh + 8, 7);
    c.fill();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(bx + 0.5, top + 0.5, AMP_WIDTH - 1, bh + 8, 6.5);
    c.stroke();
  };

  const paintAmpPanel = (ctx: CanvasRenderingContext2D, bx: number, top: number): void => {
    const c = ctx;
    const plate = c.createLinearGradient(0, top + 5, 0, top + 17);

    plate.addColorStop(0, '#e9e9ec');
    plate.addColorStop(1, '#a9aab0');
    c.fillStyle = plate;
    c.beginPath();
    c.roundRect(bx + 6, top + 5, AMP_WIDTH - 12, 12, 2.5);
    c.fill();
    [18, 32, 46].forEach((x) => {
      c.fillStyle = '#1b1b1d';
      c.beginPath();
      c.arc(bx + x, top + 11, 3.6, 0, TAU);
      c.fill();
      c.fillStyle = '#e9e9ec';
      c.fillRect(bx + x - 0.5, top + 7.6, 1, 3);
    });
    c.fillStyle = '#5a1512';
    c.beginPath();
    c.arc(bx + AMP_WIDTH - 15, top + 11, 2, 0, TAU);
    c.fill();
  };

  const paintAmpGrille = (ctx: CanvasRenderingContext2D, bx: number, top: number, bh: number): void => {
    const c = ctx;
    const at = { x: 0, y: top + 26 };

    c.fillStyle = '#0b0b0c';
    c.beginPath();
    c.roundRect(bx + 6, top + 22, AMP_WIDTH - 12, bh - 22, 3);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.16)';
    while (at.y < geo.zoneFloor - 2) {
      at.x = bx + 10 + ((at.y - top) % 8 ? 0 : 2);
      while (at.x < bx + AMP_WIDTH - 9) {
        c.fillRect(at.x, at.y, 1.1, 1.1);
        at.x += 4;
      }
      at.y += 4;
    }
  };

  const paintSocket = (ctx: CanvasRenderingContext2D): void => {
    const c = ctx;
    const nut = c.createLinearGradient(geo.sockX - 13, 0, geo.sockX + 13, 0);

    nut.addColorStop(0, '#76777d');
    nut.addColorStop(0.3, '#f4f4f6');
    nut.addColorStop(0.62, '#a3a4aa');
    nut.addColorStop(1, '#5f6066');
    c.fillStyle = nut;
    c.beginPath();
    c.roundRect(geo.sockX - 12, geo.sockY, 24, 8, 1.6);
    c.fill();
    c.fillStyle = '#131315';
    c.beginPath();
    c.roundRect(geo.sockX - 3.6, geo.sockY - 0.6, 7.2, 2.6, 1.2);
    c.fill();
  };

  const paintAmp = (ctx: CanvasRenderingContext2D): void => {
    const bx = geo.sockX - AMP_WIDTH / 2;
    const top = geo.sockY + 7;
    const bh = geo.zoneFloor - top;

    paintAmpCase(ctx, bx, top, bh);
    paintAmpPanel(ctx, bx, top);
    paintAmpGrille(ctx, bx, top, bh);
    paintSocket(ctx);
  };

  return {
    drag: true,

    layout({ zone }: SceneLayout): void {
      geo.zoneFloor = zone.floor;
      geo.floor = zone.floor - 4;
      geo.sockX = zone.x + zone.width * 0.38;
      geo.sockY = zone.floor - 77;
      geo.anchorX = geo.sockX + Math.min(80, zone.width * 0.19);
      geo.anchorY = zone.y - 4;
      geo.boxL = geo.sockX - 50;
      geo.boxR = geo.sockX + 50;
      geo.boxT = geo.sockY + 4;
      // Long enough to reach the socket, short enough that the plug hangs clear of the floor.
      geo.seg = (geo.floor - PLUG - 14 - geo.anchorY) / (N - 1);
    },

    reset(): void {
      POINTS.forEach((i) => {
        const f = Math.min(1, i / (N - 1));

        xs[i] = geo.anchorX + (geo.sockX - geo.anchorX) * f;
        ys[i] = geo.anchorY + (geo.sockY + 14 - PLUG - geo.anchorY) * f + Math.sin(f * Math.PI) * SAG;
        vxs[i] = 0;
        vys[i] = 0;
      });
      state.plugged = true;
      state.grab = false;
      state.primed = true;
      state.armed = true;
      state.calm = 0;
      seat();
      // Let the cable hang under its own weight, so nothing jumps when the plug pops.
      Array.from({ length: PRESETTLE_STEPS }).forEach(() => {
        fall(PRESETTLE_DT);
        solve();
        speeds(PRESETTLE_DT);
      });
    },

    press(pointer: ScenePointer): void {
      const ax = xs[N - 1];
      const ay = ys[N - 1];
      const bx = xs[N];
      const by = ys[N];
      const f = clamp(((pointer.x - ax) * (bx - ax) + (pointer.y - ay) * (by - ay)) / (PLUG * PLUG), 0, 1);

      if (Math.hypot(pointer.x - (ax + (bx - ax) * f), pointer.y - (ay + (by - ay) * f)) >= GRAB_RADIUS) return;
      state.armed = !state.plugged;
      state.grab = true;
      state.plugged = false;
      state.primed = false;
    },

    release(): void {
      state.grab = false;
    },

    step(dt: number, pointer: ScenePointer): boolean {
      // Speeds are distance over dt: a zero dt would turn every point into NaN.
      if (!(dt > 0)) return state.grab || state.primed;
      if (state.primed) pop();
      aim(pointer);
      fall(dt);
      solve();
      const energy = speeds(dt);

      if (!state.armed && Math.hypot(xs[N] - geo.sockX, ys[N] - geo.sockY) > REARM_DISTANCE) state.armed = true;
      if (state.grab && state.armed && overSocket()) {
        state.plugged = true;
        state.grab = false;
        seat();
      }
      state.calm = energy > REST_ENERGY ? 0 : state.calm + dt;

      return state.grab || state.calm < CALM_S;
    },

    paint(ctx: CanvasRenderingContext2D, colors: SceneColors): void {
      paintCable(ctx, colors);
      paintPlug(ctx, colors);
      // The amp is drawn last: the plug's shaft goes behind its socket.
      paintAmp(ctx);
    },

    seated: (): boolean => state.plugged,

    plug: () => ({ handle: { x: xs[N - 1], y: ys[N - 1] }, tip: { x: xs[N], y: ys[N] } }),

    cable: () => POINTS.slice(0, N).map((i) => ({ x: xs[i], y: ys[i] })),
  };
}) satisfies SceneFactory;

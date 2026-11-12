/**
 * Shattered: a vinyl record that cracks from one hit point. The pieces slide
 * apart and stay where they stop. The pointer pushes them around.
 */
import type { ErrorScene, SceneLayout, ScenePointer } from './types';

/** One piece of the record, in canvas pixels. */
export interface ShatteredPiece {
  /** Where the piece's centre is now. */
  x: number;
  y: number;
  /** How far it has moved from its place in the whole record. */
  dx: number;
  dy: number;
  /** Its turn in radians. */
  angle: number;
  /** Its collision radius. */
  radius: number;
}

export interface ShatteredScene extends ErrorScene {
  /** A read-only copy of every piece's current state. */
  pieces(): ShatteredPiece[];
}

interface Point { x: number; y: number }

interface Shard {
  /** Outline, relative to the record's centre. */
  poly: Point[];
  /** Centroid, relative to the record's centre. */
  cx: number;
  cy: number;
  rr: number;
  /** 0 at the hit point, 2 at the rim. */
  band: number;
  id: number;
  dx: number;
  dy: number;
  a: number;
  vx: number;
  vy: number;
  va: number;
}

const TAU = Math.PI * 2;

/** Record radius as a share of the zone's height and of its width; the smaller wins. */
const RADIUS_OF_HEIGHT = 0.4;
const RADIUS_OF_WIDTH = 0.3;
/** Below this the record is not drawn: its arcs would get a negative radius. */
const MIN_RADIUS = 2;

/** Cracks that run from the hit point to the rim. */
const RAYS = 10;
const RAY_JITTER = 0.42;
/** The hit point, as a share of the radius from the centre. */
const HIT_X = 0.2;
const HIT_Y = -0.14;
/** Where the two ring cracks cut each ray, as a share of its length. */
const INNER_CUT = 0.3;
const INNER_CUT_JITTER = 0.14;
const OUTER_CUT = 0.63;
const OUTER_CUT_JITTER = 0.16;
/** Points along the rim of each outer piece, between its two corners. */
const RIM_POINTS = 7;
/** Collision radius as a share of the piece's farthest corner. */
const BODY_SHARE = 0.72;

/** How far a piece is thrown, before the distance from the hit scales it. */
const THROW_MIN = 7;
const THROW_SPREAD = 22;
const THROW_NEAR = 0.45;
const THROW_SPEED = 3.4;
const THROW_SPIN = 4.2;

/** Pieces closer than this share of their summed radii push each other apart. */
const OVERLAP = 0.8;
const OVERLAP_PUSH = 26;
/** How far past a piece's radius the pointer is felt. */
const POINTER_REACH = 18;
const POINTER_PUSH = 620;
const POINTER_DRAG = 5;
const POINTER_SPIN = 0.0009;
const POINTER_SPIN_MAX = 6;
const POINTER_SPIN_GAIN = 8;
const FRICTION = 3.4;
/** A piece's centre stays this share of its radius inside the zone. */
const WALL_MARGIN = 0.5;
const WALL_BOUNCE = 0.4;
/** Weight of spin in the energy sum, and the sum under which the scene rests. */
const SPIN_ENERGY = 40;
const REST_ENERGY = 3;

/** Texture pixels per CSS pixel. */
const TEXTURE_SCALE = 2;
const GROOVE_FROM = 0.37;
const GROOVE_TO = 0.975;
const GROOVE_STEP = 1.35;
/** Every 13th groove is a dark gap between tracks. */
const TRACK_GROOVES = 13;
/** Three lines of small print on the label: x, y, width as shares of the radius. */
const LABEL_LINES: ReadonlyArray<readonly [number, number, number]> = [[-0.17, 0.11, 0.34], [-0.12, 0.165, 0.24], [-0.08, 0.215, 0.16]];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Stable 0..1 noise: the record cracks the same way every time. */
const hash = (a: number, b = 0): number => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;

  return x - Math.floor(x);
};

const disc = (ctx: CanvasRenderingContext2D, radius: number): void => {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
};

const paintGrooves = (ctx: CanvasRenderingContext2D, R: number): void => {
  const c = ctx;
  const count = Math.max(0, Math.ceil((R * GROOVE_TO - R * GROOVE_FROM) / GROOVE_STEP));

  Array.from({ length: count }, (_, i) => i).forEach((i) => {
    const gap = i % TRACK_GROOVES === TRACK_GROOVES - 1;

    disc(c, R * GROOVE_FROM + i * GROOVE_STEP);
    c.lineWidth = gap ? 1.6 : 0.6;
    c.strokeStyle = gap ? 'rgba(0,0,0,0.6)' : `rgba(255,255,255,${0.035 + 0.05 * hash(i, 3)})`;
    c.stroke();
  });
};

/** Two soft streaks of light across the grooves. */
const paintSheen = (ctx: CanvasRenderingContext2D, R: number): void => {
  const c = ctx;

  if (!('createConicGradient' in c)) return;
  const sheen = c.createConicGradient(-2.3, 0, 0);

  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.07, 'rgba(255,255,255,0.3)');
  sheen.addColorStop(0.16, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.58, 'rgba(255,255,255,0.16)');
  sheen.addColorStop(0.68, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sheen;
  disc(c, R * 0.985);
  c.fill();
};

const paintLabel = (ctx: CanvasRenderingContext2D, R: number): void => {
  const c = ctx;
  const paper = c.createRadialGradient(-R * 0.08, -R * 0.1, 1, 0, 0, R * 0.34);

  paper.addColorStop(0, '#f0604c');
  paper.addColorStop(1, '#cf3f2e');
  c.fillStyle = paper;
  disc(c, R * 0.335);
  c.fill();
  disc(c, R * 0.29);
  c.lineWidth = 0.8;
  c.strokeStyle = 'rgba(255,240,225,0.55)';
  c.stroke();
  c.fillStyle = 'rgba(40,10,6,0.6)';
  LABEL_LINES.forEach(([x, y, w]) => c.fillRect(R * x, R * y, R * w, 1.3));
  c.fillStyle = 'rgba(255,240,225,0.9)';
  c.fillRect(-R * 0.13, -R * 0.2, R * 0.26, 2.2);
};

/** The whole record, drawn once. Null where the canvas has no 2D context. */
const makeTexture = (R: number): HTMLCanvasElement | null => {
  const canvas = document.createElement('canvas');
  const size = Math.ceil(R * 2 * TEXTURE_SCALE);

  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');

  if (!c) return null;
  c.scale(TEXTURE_SCALE, TEXTURE_SCALE);
  c.translate(R, R);
  const base = c.createRadialGradient(0, 0, R * 0.2, 0, 0, R);

  base.addColorStop(0, '#26262a');
  base.addColorStop(0.62, '#141416');
  base.addColorStop(1, '#060607');
  c.fillStyle = base;
  disc(c, R);
  c.fill();
  paintGrooves(c, R);
  paintSheen(c, R);
  disc(c, R - 0.6);
  c.lineWidth = 1;
  c.strokeStyle = 'rgba(255,255,255,0.2)';
  c.stroke();
  paintLabel(c, R);
  // The spindle hole goes last: it cuts through everything drawn before it.
  c.globalCompositeOperation = 'destination-out';
  disc(c, R * 0.04);
  c.fill();

  return canvas;
};

/** Four points along one crack: the hit point, the two ring cuts, the rim. */
const crackRay = (i: number, R: number): Point[] => {
  const hitX = R * HIT_X;
  const hitY = R * HIT_Y;
  const angle = i * TAU / RAYS + (hash(i, 1) - 0.5) * RAY_JITTER;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const along = hitX * ux + hitY * uy;
  const length = -along + Math.sqrt(along * along - (hitX * hitX + hitY * hitY) + R * R);
  const at = (share: number): Point => ({ x: hitX + ux * length * share, y: hitY + uy * length * share });

  return [
    at(0),
    at(INNER_CUT + INNER_CUT_JITTER * (hash(i, 2) - 0.5)),
    at(OUTER_CUT + OUTER_CUT_JITTER * (hash(i, 4) - 0.5)),
    at(1),
  ];
};

const shardOf = (poly: Point[], id: number, band: number): Shard => {
  const cx = poly.reduce((sum, p) => sum + p.x / poly.length, 0);
  const cy = poly.reduce((sum, p) => sum + p.y / poly.length, 0);
  const rr = Math.max(...poly.map((p) => Math.hypot(p.x - cx, p.y - cy))) * BODY_SHARE;

  return { poly, cx, cy, rr, band, id, dx: 0, dy: 0, a: 0, vx: 0, vy: 0, va: 0 };
};

/** Cuts the disc into three rings of pieces between neighbouring cracks. */
const buildShards = (R: number): Shard[] => {
  const rays = Array.from({ length: RAYS }, (_, i) => crackRay(i, R));

  return rays.flatMap((ray, i) => {
    const next = rays[(i + 1) % RAYS];
    const from = Math.atan2(ray[3].y, ray[3].x);
    const raw = Math.atan2(next[3].y, next[3].x);
    const to = raw < from ? raw + TAU : raw;
    const rim = Array.from({ length: RIM_POINTS }, (_, j) => {
      const angle = from + (to - from) * (j + 1) / (RIM_POINTS + 1);

      return { x: Math.cos(angle) * R, y: Math.sin(angle) * R };
    });

    return [
      [ray[0], ray[1], next[1]],
      [ray[1], ray[2], next[2], next[1]],
      [ray[2], ray[3], ...rim, next[3], next[2]],
    ].map((poly, band) => shardOf(poly, i * 3 + band, band));
  });
};

const castShadow = (ctx: CanvasRenderingContext2D): void => {
  const c = ctx;

  c.shadowColor = 'rgba(0,0,0,0.38)';
  c.shadowBlur = 9;
  c.shadowOffsetY = 3;
};

/**
 * The record is whole after reset() and breaks on the first step().
 * The crack pattern comes from a fixed hash, so `random` is not read.
 */
export const createShattered: (random?: () => number) => ShatteredScene = () => {
  const zone = { x: 0, y: 0, width: 0, floor: 0 };
  const state: {
    radius: number;
    cx: number;
    cy: number;
    broken: boolean;
    shards: Shard[];
    /** Paint order: inner bands first, so rim pieces lie on top. */
    order: Shard[];
    texture: HTMLCanvasElement | null;
    /** The radius the texture was drawn for; -1 before the first try. */
    textureRadius: number;
  } = { radius: 0, cx: 0, cy: 0, broken: false, shards: [], order: [], texture: null, textureRadius: -1 };

  const texture = (): HTMLCanvasElement | null => {
    if (state.textureRadius !== state.radius) {
      state.texture = makeTexture(state.radius);
      state.textureRadius = state.radius;
    }

    return state.texture;
  };

  const crack = (): void => {
    const hitX = state.radius * HIT_X;
    const hitY = state.radius * HIT_Y;

    state.broken = true;
    state.shards.forEach((_, i) => {
      const s = state.shards[i];
      const ox = s.cx - hitX;
      const oy = s.cy - hitY;
      const d = Math.hypot(ox, oy) || 1;
      const speed = (THROW_MIN + THROW_SPREAD * hash(s.id, 9)) * (THROW_NEAR + d / state.radius) * THROW_SPEED;

      s.vx = ox / d * speed;
      s.vy = oy / d * speed;
      s.va = (hash(s.id, 11) - 0.5) * THROW_SPIN;
    });
  };

  const repel = (a: Shard, b: Shard, dt: number): void => {
    const first = a;
    const second = b;
    const ox = b.cx + b.dx - (a.cx + a.dx);
    const oy = b.cy + b.dy - (a.cy + a.dy);
    const d = Math.hypot(ox, oy) || 1;
    const min = (a.rr + b.rr) * OVERLAP;

    if (d >= min) return;
    const f = (min - d) * OVERLAP_PUSH * dt;

    first.vx -= ox / d * f;
    first.vy -= oy / d * f;
    second.vx += ox / d * f;
    second.vy += oy / d * f;
  };

  const push = (shard: Shard, pointer: ScenePointer, dt: number): void => {
    const s = shard;
    const ox = state.cx + s.cx + s.dx - pointer.x;
    const oy = state.cy + s.cy + s.dy - pointer.y;
    const d = Math.hypot(ox, oy) || 1;
    const reach = s.rr + POINTER_REACH;

    if (d >= reach) return;
    const f = 1 - d / reach;

    s.vx += (ox / d * POINTER_PUSH + pointer.vx * POINTER_DRAG) * f * dt;
    s.vy += (oy / d * POINTER_PUSH + pointer.vy * POINTER_DRAG) * f * dt;
    s.va += clamp((ox * pointer.vy - oy * pointer.vx) * POINTER_SPIN, -POINTER_SPIN_MAX, POINTER_SPIN_MAX)
      * f * dt * POINTER_SPIN_GAIN;
  };

  /** Slows a piece, moves it, and turns it back at the zone's edges. */
  const move = (shard: Shard, friction: number, dt: number): void => {
    const s = shard;

    s.vx *= friction;
    s.vy *= friction;
    s.va *= friction;
    s.dx += s.vx * dt;
    s.dy += s.vy * dt;
    s.a += s.va * dt;
    const x = state.cx + s.cx + s.dx;
    const y = state.cy + s.cy + s.dy;
    const margin = s.rr * WALL_MARGIN;
    const left = zone.x + margin;
    const right = zone.x + zone.width - margin;
    const top = zone.y + margin;
    const bottom = zone.floor - margin;

    if (x < left) {
      s.dx += left - x;
      s.vx = Math.abs(s.vx) * WALL_BOUNCE;
    }
    if (x > right) {
      s.dx -= x - right;
      s.vx = -Math.abs(s.vx) * WALL_BOUNCE;
    }
    if (y < top) {
      s.dy += top - y;
      s.vy = Math.abs(s.vy) * WALL_BOUNCE;
    }
    if (y > bottom) {
      s.dy -= y - bottom;
      s.vy = -Math.abs(s.vy) * WALL_BOUNCE;
    }
  };

  const paintWhole = (ctx: CanvasRenderingContext2D): void => {
    const c = ctx;
    const { radius, cx, cy } = state;
    const image = texture();

    c.save();
    castShadow(c);
    c.fillStyle = '#111';
    c.beginPath();
    c.arc(cx, cy, radius - 1, 0, TAU);
    c.arc(cx, cy, radius * 0.05, 0, TAU, true);
    c.fill();
    c.restore();
    if (image) c.drawImage(image, cx - radius, cy - radius, radius * 2, radius * 2);
  };

  const paintShard = (ctx: CanvasRenderingContext2D, s: Shard, image: HTMLCanvasElement | null): void => {
    const c = ctx;
    const { radius } = state;

    c.save();
    c.translate(state.cx + s.cx + s.dx, state.cy + s.cy + s.dy);
    c.rotate(s.a);
    c.translate(-s.cx, -s.cy);
    c.beginPath();
    s.poly.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
    c.closePath();
    c.save();
    castShadow(c);
    c.fillStyle = '#101012';
    c.fill();
    c.restore();
    c.clip();
    if (image) c.drawImage(image, -radius, -radius, radius * 2, radius * 2);
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.stroke();
    c.restore();
  };

  return {
    layout({ zone: next }: SceneLayout): void {
      const height = next.floor - next.y;

      zone.x = next.x;
      zone.y = next.y;
      zone.width = next.width;
      zone.floor = next.floor;
      state.radius = Math.max(0, Math.round(Math.min(height * RADIUS_OF_HEIGHT, next.width * RADIUS_OF_WIDTH)));
      state.cx = next.x + next.width * 0.5;
      state.cy = next.y + height * 0.5;
      state.shards = buildShards(state.radius);
      state.order = [...state.shards].sort((a, b) => a.band - b.band);
    },

    reset(): void {
      state.broken = false;
      state.shards.forEach((_, i) => {
        Object.assign(state.shards[i], { dx: 0, dy: 0, a: 0, vx: 0, vy: 0, va: 0 });
      });
    },

    step(dt: number, pointer: ScenePointer): boolean {
      if (!state.broken) {
        crack();

        return true;
      }
      const { shards } = state;

      shards.forEach((a, i) => {
        const at = { j: i + 1 };

        while (at.j < shards.length) {
          repel(a, shards[at.j], dt);
          at.j += 1;
        }
        if (pointer.inside) push(a, pointer, dt);
      });
      const friction = Math.exp(-FRICTION * dt);

      shards.forEach((s) => move(s, friction, dt));
      const energy = shards.reduce((sum, s) => sum + s.vx * s.vx + s.vy * s.vy + s.va * s.va * SPIN_ENERGY, 0);

      return pointer.inside || energy > REST_ENERGY;
    },

    paint(ctx: CanvasRenderingContext2D): void {
      if (state.radius < MIN_RADIUS) return;
      if (!state.broken) {
        paintWhole(ctx);

        return;
      }
      const image = texture();

      state.order.forEach((s) => paintShard(ctx, s, image));
    },

    pieces(): ShatteredPiece[] {
      return state.shards.map((s) => ({
        x: state.cx + s.cx + s.dx,
        y: state.cy + s.cy + s.dy,
        dx: s.dx,
        dy: s.dy,
        angle: s.a,
        radius: s.rr,
      }));
    },
  };
};

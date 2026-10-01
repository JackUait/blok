/** Pressure 0.5 is the nominal width; 0 and 1 scale it by these ends. */
const MIN_WIDTH_SCALE = 0.35;
const WIDTH_SCALE_RANGE = 1.3;
/** Simulated mouse pressure: slow → SLOW_PRESSURE, one width per sample or faster → FAST_PRESSURE. */
const SLOW_PRESSURE = 0.68;
const FAST_PRESSURE = 0.32;
const PRESSURE_EASE = 0.35;
/** How much an edge may widen per unit of length, so a pressure jump becomes a slope, not a step. */
const MAX_EDGE_SLOPE = 0.35;
/** A turn sharper than this (cosine) is a corner: the outline splits and round caps form the join. */
const CORNER_COS = 0.2;
/** Bending allowed in one outline piece. More, and a piece could loop over itself. */
const PIECE_TURN = Math.PI / 2;
const TAPER_WIDTHS = 2.5;
const TAPER_SHARE = 0.4;
const TAPER_MIN = 0.3;
/** Spline spacing in nominal radii; dense enough that the offset edge reads as a curve. */
const RESAMPLE_STEP = 1;
const MAX_RESAMPLED = 6000;
/** Curves get a sample at least every this many radians, straights stay sparse. */
const MAX_SAMPLE_TURN = Math.PI / 12;
/** Samples this far apart along the line are enough to catch a fold; the window keeps it linear. */
const BURY_WINDOW = 12;

interface Sample { x: number; y: number; p: number }
interface Vec { x: number; y: number }
interface Node { x: number; y: number; r: number }

const fmt = (n: number): string => String(Math.round(n * 100) / 100 + 0);
const pt = (v: Vec): string => `${fmt(v.x)} ${fmt(v.y)}`;

const dist = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);

const unit = (a: Vec, b: Vec): Vec => {
  const d = dist(a, b);

  return d === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);

const readSamples = (points: number[]): Sample[] =>
  range(0, Math.floor(points.length / 3) - 1).flatMap((k) => {
    const x = points[k * 3];
    const y = points[k * 3 + 1];
    const p = points[k * 3 + 2];

    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return [];

    return [{ x, y, p: p !== undefined && Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5 }];
  });

/**
 * Centred 1-2-1 low-pass over x, y and pressure. No lag, so the line never trails the pointer;
 * the ends stay put. A turn sharper than 90° is a corner the hand meant, so it is left alone.
 */
export function smoothStroke(points: number[]): number[] {
  const s = readSamples(points);

  if (s.length < 3) return s.flatMap((v) => [v.x, v.y, v.p]);

  return s.flatMap((v, i) => {
    const a = s[i - 1];
    const b = s[i + 1];

    if (a === undefined || b === undefined || (v.x - a.x) * (b.x - v.x) + (v.y - a.y) * (b.y - v.y) < 0) return [v.x, v.y, v.p];

    return [(a.x + 2 * v.x + b.x) / 4, (a.y + 2 * v.y + b.y) / 4, (a.p + 2 * v.p + b.p) / 4];
  });
}

/** A mouse reports 0.5 everywhere; make pressure from speed (sample spacing), eased so width never jumps. */
const simulatePressure = (s: Sample[], width: number): number[] =>
  s.reduce<number[]>((out, v, i) => {
    const prev = s[i - 1] ?? s[i + 1] ?? v;
    const speed = Math.min(1, dist(prev, v) / width);
    const target = SLOW_PRESSURE + (FAST_PRESSURE - SLOW_PRESSURE) * speed;
    const was = out[i - 1] ?? 0.5;

    out.push(was + (target - was) * PRESSURE_EASE);

    return out;
  }, []);

const pressures = (s: Sample[], width: number, usePressure: boolean): number[] => {
  if (!usePressure) return s.map(() => 0.5);
  if (s.every((v) => Math.abs(v.p - 0.5) < 1e-3)) return simulatePressure(s, width);

  return s.map((v) => v.p);
};

const radiusFor = (width: number, p: number): number => (width / 2) * (MIN_WIDTH_SCALE + WIDTH_SCALE_RANGE * p);

const dot = (c: Vec, r: number): string => {
  const a = { x: c.x - r, y: c.y };
  const b = { x: c.x + r, y: c.y };

  return `M${pt(a)}A${fmt(r)} ${fmt(r)} 0 1 0 ${pt(b)}A${fmt(r)} ${fmt(r)} 0 1 0 ${pt(a)}Z`;
};

/** Drops samples closer than `min` to the last kept one (slow-hand jitter), always keeping the last sample. */
const thin = (s: Sample[], r: number[], min: number): Node[] => {
  const out: Node[] = [];

  s.forEach((v, i) => {
    const last = out[out.length - 1];
    const node = { x: v.x, y: v.y, r: r[i] ?? 0 };

    if (last === undefined || dist(last, v) >= min) {
      out.push(node);
    } else if (i === s.length - 1 && out.length > 1) {
      out[out.length - 1] = node;
    }
  });

  return out;
};

const taper = (c: Node[], width: number): Node[] => {
  const s: number[] = [0];

  c.forEach((v, i) => {
    if (i > 0) s.push((s[i - 1] ?? 0) + dist(c[i - 1] ?? v, v));
  });

  const total = s[s.length - 1] ?? 0;
  const span = Math.min(width * TAPER_WIDTHS, total * TAPER_SHARE);

  if (span <= 0) return c;

  const ease = (d: number): number => TAPER_MIN + (1 - TAPER_MIN) * Math.sin((Math.min(1, d / span) * Math.PI) / 2);

  return c.map((v, i) => ({ ...v, r: v.r * ease(s[i] ?? 0) * ease(total - (s[i] ?? 0)) }));
};

/** Limits how fast the radius may grow between neighbours, in both directions. */
const limitSlope = (c: Node[]): Node[] => {
  const r = c.map((v) => v.r);
  const pull = (from: number, to: number): void => {
    const a = c[from];
    const b = c[to];

    if (a !== undefined && b !== undefined) r[to] = Math.min(r[to] ?? 0, (r[from] ?? 0) + MAX_EDGE_SLOPE * dist(a, b));
  };

  for (const i of range(1, c.length - 1)) pull(i - 1, i);
  for (const i of range(0, c.length - 2).reverse()) pull(i + 1, i);

  return c.map((v, i) => ({ ...v, r: r[i] ?? v.r }));
};

const turnAt = (a: Vec, b: Vec, c: Vec): { cos: number; angle: number } => {
  const u = unit(a, b);
  const v = unit(b, c);
  const cos = u.x * v.x + u.y * v.y;

  return { cos, angle: Math.abs(Math.atan2(u.x * v.y - u.y * v.x, cos)) };
};

/** Splits where `cut` says so; neighbouring pieces share the split node. */
const splitWhere = (c: Node[], cut: (a: Node, b: Node, n: Node) => boolean): Node[][] => {
  const pieces: Node[][] = [[]];

  c.forEach((v, i) => {
    pieces[pieces.length - 1]?.push(v);

    const a = c[i - 1];
    const n = c[i + 1];

    if (a !== undefined && n !== undefined && cut(a, v, n)) pieces.push([v]);
  });

  return pieces;
};

/** Centripetal Catmull-Rom through the nodes: no cusps, no overshoot loops; the radius follows linearly. */
const resample = (c: Node[], step: number): Node[] => {
  const first = c[0];
  const last = c[c.length - 1];

  if (first === undefined || last === undefined || c.length < 2) return c;

  const second = c[1] ?? last;
  const beforeLast = c[c.length - 2] ?? first;
  // Mirrored end points give the spline a natural start and end tangent.
  const ext: Node[] = [
    { x: 2 * first.x - second.x, y: 2 * first.y - second.y, r: first.r },
    ...c,
    { x: 2 * last.x - beforeLast.x, y: 2 * last.y - beforeLast.y, r: last.r },
  ];
  const total = c.reduce((sum, v, i) => sum + (i > 0 ? dist(c[i - 1] ?? v, v) : 0), 0);
  const spacing = Math.max(step, total / MAX_RESAMPLED);
  const span = (i: number): Node[] => {
    const p0 = ext[i - 1] ?? first;
    const p1 = ext[i] ?? first;
    const p2 = ext[i + 1] ?? first;
    const p3 = ext[i + 2] ?? first;
    const t1 = Math.sqrt(dist(p0, p1)) || 1;
    const t2 = t1 + (Math.sqrt(dist(p1, p2)) || 1);
    const t3 = t2 + (Math.sqrt(dist(p2, p3)) || 1);
    const bend = turnAt(p0, p1, p2).angle + turnAt(p1, p2, p3).angle;
    const steps = Math.max(1, Math.ceil(dist(p1, p2) / spacing), Math.ceil(bend / MAX_SAMPLE_TURN));

    return range(1, steps).map((k) => {
      const t = t1 + ((t2 - t1) * k) / steps;
      const mix = (a: Vec, b: Vec, ta: number, tb: number): Vec => ({
        x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
        y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
      });
      const a1 = mix(p0, p1, 0, t1);
      const a2 = mix(p1, p2, t1, t2);
      const a3 = mix(p2, p3, t2, t3);
      const p = mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2);

      return { x: p.x, y: p.y, r: p1.r + ((p2.r - p1.r) * k) / steps };
    });
  };

  return [first, ...range(1, ext.length - 3).flatMap(span)];
};

/**
 * Direction at node i from nodes about one radius behind and ahead, so a noisy
 * neighbour cannot tilt the normal and wobble the edge.
 */
const tangent = (c: Node[], i: number): Vec => {
  const here = c[i] ?? { x: 0, y: 0, r: 0 };
  // Walks a handful of nodes at most: they are RESAMPLE_STEP radii apart.
  const walk = (j: number, step: number): number => {
    const next = j + step;

    return next < 0 || next >= c.length || dist(c[j] ?? here, here) >= here.r ? j : walk(next, step);
  };

  return unit(c[walk(i, -1)] ?? here, c[walk(i, 1)] ?? here);
};

const buried = (o: Vec, c: Node[], i: number): boolean =>
  range(Math.max(0, i - BURY_WINDOW), Math.min(c.length - 1, i + BURY_WINDOW)).some((j) => {
    const q = c[j];

    return j !== i && q !== undefined && dist(q, o) < q.r * 0.98;
  });

/** False when an offset point folds back against the centreline or sits inside a nearby node's disc. */
const sideIsClean = (off: Vec[], c: Node[]): boolean =>
  off.every((o, i) => {
    if (i === 0 || i === off.length - 1) return true;

    const prev = off[i - 1] ?? o;
    const a = c[i - 1] ?? o;
    const b = c[i] ?? o;

    return (o.x - prev.x) * (b.x - a.x) + (o.y - prev.y) * (b.y - a.y) > 0 && !buried(o, c, i);
  });

/** Quadratic curves through the midpoints, so the edge has no corners. */
const side = (pts: Vec[]): string => {
  const curves = range(1, pts.length - 2).map((i) => {
    const p = pts[i] ?? { x: 0, y: 0 };
    const n = pts[i + 1] ?? p;

    return `Q${pt(p)} ${pt({ x: (p.x + n.x) / 2, y: (p.y + n.y) / 2 })}`;
  });
  const last = pts[pts.length - 1];

  return curves.join('') + (last === undefined ? '' : `L${pt(last)}`);
};

/*
 * Every closed shape below winds the same way on screen (caps sweep 0), so under the default
 * nonzero fill rule overlapping shapes union instead of cancelling into holes.
 */

/** Hull of two discs: the exact stroke of one segment with round ends. */
const capsule = (a: Node, b: Node): string => {
  const d = dist(a, b);

  if (d <= Math.abs(a.r - b.r)) return dot(a.r >= b.r ? a : b, Math.max(a.r, b.r));

  const u = unit(a, b);
  const phi = Math.acos((a.r - b.r) / d);
  const turn = (r: number, angle: number, c: Vec): Vec => ({
    x: c.x + r * (u.x * Math.cos(angle) - u.y * Math.sin(angle)),
    y: c.y + r * (u.x * Math.sin(angle) + u.y * Math.cos(angle)),
  });
  const bigFront = phi > Math.PI / 2 ? 1 : 0;

  return `M${pt(turn(a.r, phi, a))}L${pt(turn(b.r, phi, b))}`
    + `A${fmt(b.r)} ${fmt(b.r)} 0 ${bigFront} 0 ${pt(turn(b.r, -phi, b))}`
    + `L${pt(turn(a.r, -phi, a))}A${fmt(a.r)} ${fmt(a.r)} 0 ${1 - bigFront} 0 ${pt(turn(a.r, phi, a))}Z`;
};

/** One piece: a smooth outline, or a union of capsules where a curve is tighter than the stroke. */
const piece = (c: Node[]): string => {
  const left: Vec[] = [];
  const right: Vec[] = [];

  c.forEach((here, i) => {
    const t = tangent(c, i);

    left.push({ x: here.x - t.y * here.r, y: here.y + t.x * here.r });
    right.push({ x: here.x + t.y * here.r, y: here.y - t.x * here.r });
  });

  if (!sideIsClean(left, c) || !sideIsClean(right, c)) {
    return c.slice(1).map((b, i) => capsule(c[i] ?? b, b)).join('');
  }

  const back = [...right].reverse();
  const start = left[0] ?? { x: 0, y: 0 };
  const end = back[0] ?? { x: 0, y: 0 };
  const rEnd = fmt(c[c.length - 1]?.r ?? 0);
  const rStart = fmt(c[0]?.r ?? 0);

  return `M${pt(start)}${side(left)}A${rEnd} ${rEnd} 0 0 0 ${pt(end)}${side(back)}A${rStart} ${rStart} 0 0 0 ${pt(start)}Z`;
};

const bentPieces = (c: Node[]): Node[][] => {
  const state = { bent: 0 };

  return splitWhere(c, (a, b, n) => {
    state.bent += turnAt(a, b, n).angle;
    if (state.bent <= PIECE_TURN) return false;
    state.bent = 0;

    return true;
  });
};

/**
 * SVG path `d` of a filled, round-capped outline around x, y, pressure triples.
 * Pressure 0.5 is the nominal `width`; with every pressure at 0.5 (a mouse) speed stands in for it.
 */
export function strokeOutline(points: number[], width: number, opts?: { taper?: boolean; pressure?: boolean }): string {
  const s = readSamples(points);
  const first = s[0];

  if (first === undefined || !(width > 0)) return '';

  const nominal = width / 2;
  const usePressure = opts?.pressure !== false;
  const radii = pressures(s, width, usePressure).map((p) => radiusFor(width, p));
  const nodes = thin(s, radii, nominal * 0.75);

  if (nodes.length < 2) {
    const real = usePressure && Math.abs(first.p - 0.5) >= 1e-3;

    return dot(first, real ? radiusFor(width, first.p) : nominal);
  }

  const shaped = limitSlope(opts?.taper === false ? nodes : taper(nodes, width));

  return splitWhere(shaped, (a, b, n) => turnAt(a, b, n).cos < CORNER_COS)
    .flatMap((run) => bentPieces(resample(run, nominal * RESAMPLE_STEP)))
    .map(piece)
    .join('');
}

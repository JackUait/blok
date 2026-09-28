/**
 * Real 3D tilt for the media preview, drawn as vectors.
 *
 * A CSS 3D transform on the element around the SVG makes the browser tilt a
 * bitmap, and the lines turn jagged. So this does the browser's maths itself:
 * every shape is sampled into points, rotated and put through the same
 * perspective divide, and written back as a path each frame. Each depth layer
 * (`--d` on `.blok-media-preview__layer`) sits at its own distance.
 */

const CENTER_X = 100;
const CENTER_Y = 60;
const PERSPECTIVE = 700;
const MAX_TILT_X = (7 * Math.PI) / 180;
const MAX_TILT_Y = (9 * Math.PI) / 180;
const DEPTH_UNIT = 4;
const SAMPLE_STEP = 1.5;
const GEOMETRY_ATTRIBUTES = new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'd', 'x1', 'y1', 'x2', 'y2', 'points']);

// Spring for the tilt: underdamped, so it swings past rest and settles.
const STIFFNESS = 180;
const DAMPING = 12;
const SETTLED = 0.0005;

/**
 * Projects one point of the 200x120 drawing. `leanX`/`leanY` run from -1 to 1
 * (pointer at the left/top edge to the right/bottom edge). A layer keeps its
 * size at rest; depth only shows once it tilts.
 */
export function projectPoint(x: number, y: number, z: number, leanX: number, leanY: number): [number, number] {
  const ay = -leanX * MAX_TILT_Y;
  const ax = -leanY * MAX_TILT_X;
  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  const x1 = dx * Math.cos(ay) + z * Math.sin(ay);
  const z1 = -dx * Math.sin(ay) + z * Math.cos(ay);
  const y2 = dy * Math.cos(ax) - z1 * Math.sin(ax);
  const z2 = dy * Math.sin(ax) + z1 * Math.cos(ax);
  const scale = (PERSPECTIVE - z) / (PERSPECTIVE - z2);

  return [CENTER_X + x1 * scale, CENTER_Y + y2 * scale];
}

interface Shape {
  path: SVGPathElement;
  points: Array<[number, number]>;
  z: number;
  closed: boolean;
}

type Lean = (leanX: number, leanY: number) => void;

const depths = new WeakMap<HTMLElement, Lean | null>();

const layerDepth = (el: Element): number => {
  const layer = el.closest<SVGElement>('.blok-media-preview__layer');
  return layer ? (parseFloat(layer.style.getPropertyValue('--d')) || 0) * DEPTH_UNIT : 0;
};

// A clip shape lives in <defs>; it must sit at the depth of whatever it clips.
const depthOf = (el: Element, svg: SVGSVGElement): number => {
  const clip = el.closest('clipPath');
  const user = clip ? svg.querySelector(`[clip-path="url(#${clip.id})"]`) : null;
  return layerDepth(user ?? el);
};

function toShapes(svg: SVGSVGElement): Shape[] | null {
  const elements = Array.from(svg.querySelectorAll<SVGGeometryElement>('rect, circle, ellipse, path, line, polygon, polyline'));
  if (elements.some((el) => typeof el.getTotalLength !== 'function')) return null;

  return elements.map((el) => {
    const length = el.getTotalLength();
    const count = Math.max(12, Math.min(160, Math.ceil(length / SAMPLE_STEP)));
    const points = Array.from({ length: count + 1 }, (_, i): [number, number] => {
      const point = el.getPointAtLength((length * i) / count);
      return [point.x, point.y];
    });
    const closed = !['path', 'line', 'polyline'].includes(el.tagName) || /z\s*$/i.test(el.getAttribute('d') ?? '');
    const z = depthOf(el, svg);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const attribute of Array.from(el.attributes)) {
      if (!GEOMETRY_ATTRIBUTES.has(attribute.name)) path.setAttribute(attribute.name, attribute.value);
    }
    el.replaceWith(path);
    return { path, points, z, closed };
  });
}

function draw(shapes: Shape[], leanX: number, leanY: number): void {
  for (const shape of shapes) {
    const d = shape.points
      .map(([x, y], i) => {
        const [px, py] = projectPoint(x, y, shape.z, leanX, leanY);
        return `${i ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)}`;
      })
      .join('');
    shape.path.setAttribute('d', shape.closed ? `${d}Z` : d);
  }
}

// Springs the tilt toward the latest target and redraws; the frame loop runs
// only until it settles. The live tilt goes out as --tilt-x/--tilt-y so the
// shadows in media-empty.css move with the light.
function springTilt(shapes: Shape[], stage: HTMLElement): Lean {
  const tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, frame: 0, last: 0 };

  const step = (now: number): void => {
    const dt = Math.min(1 / 30, tilt.last ? (now - tilt.last) / 1000 : 1 / 60);
    tilt.last = now;
    tilt.vx += (STIFFNESS * (tilt.tx - tilt.x) - DAMPING * tilt.vx) * dt;
    tilt.vy += (STIFFNESS * (tilt.ty - tilt.y) - DAMPING * tilt.vy) * dt;
    tilt.x += tilt.vx * dt;
    tilt.y += tilt.vy * dt;

    const settled = Math.abs(tilt.tx - tilt.x) < SETTLED && Math.abs(tilt.ty - tilt.y) < SETTLED
      && Math.abs(tilt.vx) < SETTLED && Math.abs(tilt.vy) < SETTLED;
    if (settled) {
      tilt.x = tilt.tx;
      tilt.y = tilt.ty;
    }
    draw(shapes, tilt.x, tilt.y);
    stage.style.setProperty('--tilt-x', String(Math.round(tilt.x * 1000) / 1000));
    stage.style.setProperty('--tilt-y', String(Math.round(tilt.y * 1000) / 1000));
    tilt.frame = settled ? 0 : requestAnimationFrame(step);
  };

  return (leanX, leanY) => {
    tilt.tx = leanX;
    tilt.ty = leanY;
    if (tilt.frame) return;
    tilt.last = 0;
    tilt.frame = requestAnimationFrame(step);
  };
}

/**
 * Tilts the preview toward `leanX`/`leanY` (each -1 to 1) on a spring. The
 * drawing is converted to projected paths on the first real lean, and the
 * frame loop stops once the tilt settles.
 */
export function leanPreview(stage: HTMLElement, leanX: number, leanY: number): void {
  if (!depths.has(stage)) {
    if (leanX === 0 && leanY === 0) return;
    const svg = stage.querySelector('svg');
    const shapes = svg ? toShapes(svg) : null;
    depths.set(stage, shapes ? springTilt(shapes, stage) : null);
  }
  depths.get(stage)?.(leanX, leanY);
}

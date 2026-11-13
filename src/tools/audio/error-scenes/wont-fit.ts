import type { ErrorScene, SceneLayout, ScenePointer } from './types';

const TAU = Math.PI * 2;
/** The record's size before it swells, as a share of its final size. */
const SMALL = 0.34;
/** Final radius as a share of the zone's height: more than half, so the card cuts it off. */
const RADIUS_SHARE = 1.05;
const CENTER_X = 0.6;
/** The record's biggest size on the way to rest, as a share of its final size. It follows from the swell spring. */
const PEAK = 1.08;
/** Room kept between the record and the words, and between its label and the card's edge. */
const EDGE = 8;
const CENTER_Y = 0.56;
/** Label radius as a share of the record's. The centre is placed so the label stays in view. */
const LABEL = 0.335;
const SWELL_STIFFNESS = 95;
const SWELL_DAMPING = 10.5;
const START_ANGLE = -0.3;
/** Radians per second the record turns as it starts to swell. */
const START_SPIN = 1.5;
const SPIN_FRICTION = 1.5;
const TEXTURE_SCALE = 1.5;
const SHEEN_STOPS: Array<[number, number]> = [[0, 0], [0.07, 0.3], [0.16, 0], [0.5, 0], [0.58, 0.15], [0.68, 0], [1, 0]];

const hash = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;

  return s - Math.floor(s);
};

/** The two lines printed on the record's label. */
export interface WontFitLabel {
  /** The file's size, already formatted: "84 MB". */
  size: string;
  /** The limit, already worded: "max 50 MB". Printed in capitals. */
  limit: string;
}

export interface WontFitScene extends ErrorScene {
  /** Where the record is now. */
  disc(): { x: number; y: number; radius: number; angle: number };
}

/** The record's face. Grooves are broken arcs, so a turn shows in them. */
const drawRecord = (ctx: CanvasRenderingContext2D, radius: number, label: WontFitLabel, family: string): void => {
  const c = ctx;
  const base = c.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);

  base.addColorStop(0, '#242428');
  base.addColorStop(0.62, '#131315');
  base.addColorStop(1, '#050506');
  c.fillStyle = base;
  c.beginPath();
  c.arc(0, 0, radius, 0, TAU);
  c.fill();

  const rings = Math.floor((radius * 0.978 - radius * 0.37) / 2.1);

  Array.from({ length: rings }).forEach((_, i) => {
    const gap = i % 15 === 14;

    c.lineWidth = gap ? 2.4 : 0.8;
    [0, 1, 2].forEach((j) => {
      const from = hash(i, j) * TAU;

      c.beginPath();
      c.arc(0, 0, radius * 0.37 + i * 2.1, from, from + TAU / 3 + 0.02);
      c.strokeStyle = gap ? 'rgba(0,0,0,0.6)' : `rgba(255,255,255,${0.02 + 0.075 * hash(i, j + 5)})`;
      c.stroke();
    });
  });
  c.beginPath();
  c.arc(0, 0, radius - 0.8, 0, TAU);
  c.lineWidth = 1.4;
  c.strokeStyle = 'rgba(255,255,255,0.2)';
  c.stroke();

  const paper = c.createRadialGradient(-radius * 0.08, -radius * 0.1, 1, 0, 0, radius * 0.34);

  paper.addColorStop(0, '#f0604c');
  paper.addColorStop(1, '#cf3f2e');
  c.fillStyle = paper;
  c.beginPath();
  c.arc(0, 0, radius * LABEL, 0, TAU);
  c.fill();
  c.beginPath();
  c.arc(0, 0, radius * 0.3, 0, TAU);
  c.lineWidth = 1;
  c.strokeStyle = 'rgba(255,240,225,0.55)';
  c.stroke();

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(255,244,232,0.97)';
  c.font = `700 ${radius * 0.115}px ${family}`;
  c.fillText(label.size, 0, -radius * 0.13, radius * 0.52);
  c.fillStyle = 'rgba(60,14,8,0.78)';
  c.font = `600 ${radius * 0.044}px ${family}`;
  c.fillText(label.limit.toLocaleUpperCase(), 0, radius * 0.15, radius * 0.46);

  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.arc(0, 0, radius * 0.028, 0, TAU);
  c.fill();
};

/**
 * The "too large" picture: a record that swells until the card cuts it off,
 * with the file's size printed on its label. It can be spun by dragging.
 *
 * @param label - the size and the limit to print
 */
export function createWontFit(label: WontFitLabel): WontFitScene {
  const state: {
    zone: SceneLayout['zone'];
    radius: number;
    x: number;
    y: number;
    size: number;
    growth: number;
    angle: number;
    spin: number;
    started: boolean;
    held: boolean;
    grip: number;
    texture: HTMLCanvasElement | null;
    textureRadius: number;
  } = {
    zone: { x: 0, y: 0, width: 0, floor: 0 },
    radius: 0,
    x: 0,
    y: 0,
    size: SMALL,
    growth: 0,
    angle: START_ANGLE,
    spin: 0,
    started: false,
    held: false,
    grip: 0,
    texture: null,
    textureRadius: -1,
  };

  const angleTo = (pointer: ScenePointer): number => Math.atan2(pointer.y - state.y, pointer.x - state.x);

  /** Built on first paint and again only when the size changes. Stays null where there is no 2D canvas. */
  const texture = (family: string): HTMLCanvasElement | null => {
    if (state.textureRadius === state.radius) return state.texture;
    state.textureRadius = state.radius;
    state.texture = null;
    if (state.radius < 2) return null;

    const canvas = document.createElement('canvas');
    const pixels = Math.ceil(state.radius * 2 * TEXTURE_SCALE);

    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;
    ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
    ctx.translate(state.radius, state.radius);
    drawRecord(ctx, state.radius, label, family);
    state.texture = canvas;

    return canvas;
  };

  return {
    drag: true,

    layout(layout: SceneLayout): void {
      const height = layout.zone.floor - layout.zone.y;

      state.zone = layout.zone;
      // The record at its biggest stays clear of the words, and its label stays in view.
      state.radius = Math.round(Math.max(0, Math.min(height * RADIUS_SHARE, (layout.zone.width - EDGE * 2) / (PEAK + LABEL))));
      state.x = layout.zone.x + Math.max(layout.zone.width * CENTER_X, EDGE + state.radius * PEAK);
      state.y = layout.zone.y + height * CENTER_Y;
    },

    reset(): void {
      state.size = SMALL;
      state.growth = 0;
      state.angle = START_ANGLE;
      state.spin = 0;
      state.started = false;
      state.held = false;
    },

    press(pointer: ScenePointer): void {
      state.held = true;
      state.grip = angleTo(pointer);
      state.spin = 0;
    },

    release(): void {
      state.held = false;
    },

    step(dt: number, pointer: ScenePointer): boolean {
      if (!state.started) {
        state.started = true;
        state.spin = START_SPIN;
      }
      state.growth += ((1 - state.size) * SWELL_STIFFNESS - state.growth * SWELL_DAMPING) * dt;
      state.size += state.growth * dt;

      if (state.held && pointer.down) {
        const now = angleTo(pointer);
        const raw = now - state.grip;
        // The short way round when the pointer crosses the -PI/PI seam.
        const turn = raw - TAU * Math.round(raw / TAU);

        state.grip = now;
        state.angle += turn;
        state.spin = dt > 0 ? state.spin * 0.6 + (turn / dt) * 0.4 : state.spin;
      } else {
        state.angle += state.spin * dt;
        state.spin *= Math.exp(-SPIN_FRICTION * dt);
      }

      return state.held
        || Math.abs(state.spin) > 0.01
        || Math.abs(1 - state.size) > 0.001
        || Math.abs(state.growth) > 0.01;
    },

    paint(ctx: CanvasRenderingContext2D): void {
      const c = ctx;
      const r = state.radius * state.size;
      const { zone, x, y } = state;

      if (r < 2) return;
      const face = texture(c.canvas instanceof Element ? getComputedStyle(c.canvas).fontFamily || 'sans-serif' : 'sans-serif');

      c.save();
      c.beginPath();
      c.rect(zone.x, zone.y, zone.width, zone.floor - zone.y);
      c.clip();

      c.save();
      c.shadowColor = 'rgba(0,0,0,0.4)';
      c.shadowBlur = 18;
      c.shadowOffsetY = 5;
      c.fillStyle = '#0c0c0d';
      c.beginPath();
      c.arc(x, y, r - 1, 0, TAU);
      c.arc(x, y, r * 0.035, 0, TAU, true);
      c.fill();
      c.restore();

      if (face) {
        c.save();
        c.translate(x, y);
        c.rotate(state.angle);
        c.drawImage(face, -r, -r, r * 2, r * 2);
        c.restore();
      }

      // The light stays put while the grooves turn under it.
      if (typeof c.createConicGradient === 'function') {
        const sheen = c.createConicGradient(-2.25, x, y);

        SHEEN_STOPS.forEach(([stop, alpha]) => sheen.addColorStop(stop, `rgba(255,255,255,${alpha})`));
        c.fillStyle = sheen;
        c.beginPath();
        c.arc(x, y, r * 0.985, 0, TAU);
        c.arc(x, y, r * (LABEL + 0.01), 0, TAU, true);
        c.fill();
      }
      c.restore();
    },

    disc: () => ({ x: state.x, y: state.y, radius: state.radius * state.size, angle: state.angle }),
  };
}

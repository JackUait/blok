import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPulledPlug } from '../../../../../src/tools/audio/error-scenes/pulled-plug';
import type { SceneColors, SceneLayout, ScenePointer } from '../../../../../src/tools/audio/error-scenes/types';

type Scene = ReturnType<typeof createPulledPlug>;
interface Point { x: number; y: number }

const DT = 1 / 60;
const PLUG = 52;
const WIDE: SceneLayout = { width: 768, height: 216, zone: { x: 361, y: 0, width: 407, floor: 216 }, scale: 2 };
const NARROW: SceneLayout = { width: 380, height: 420, zone: { x: 0, y: 0, width: 380, floor: 172 }, scale: 2 };
const COLORS: SceneColors = { ink: 'rgb(1, 2, 3)', card: 'rgb(250, 251, 252)', muted: 'rgb(120, 120, 120)' };

/** The lab's numbers, worked out again here so the scene cannot grade itself. */
const geometry = ({ zone }: SceneLayout): {
  socket: Point; anchor: Point; floor: number; rope: number; box: { left: number; right: number; top: number };
} => {
  const socket = { x: zone.x + zone.width * 0.38, y: zone.floor - 77 };
  const anchor = { x: socket.x + Math.min(80, zone.width * 0.19), y: zone.y - 4 };
  const floor = zone.floor - 4;

  return {
    socket,
    anchor,
    floor,
    rope: floor - PLUG - 14 - anchor.y,
    box: { left: socket.x - 50, right: socket.x + 50, top: socket.y + 4 },
  };
};

const at = (x: number, y: number, down = false, inside = true): ScenePointer => ({ x, y, vx: 0, vy: 0, inside, down });
const AWAY = at(-500, -500, false, false);
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const staged = (layout: SceneLayout): Scene => {
  const scene = createPulledPlug();

  scene.layout(layout);
  scene.reset();

  return scene;
};

/** @returns frames stepped before the scene said it was at rest, or -1 */
const settle = (scene: Scene, pointer: ScenePointer = AWAY, limit = 900): number =>
  Array.from({ length: limit }).findIndex(() => !scene.step(DT, pointer));

/** Stepped until the scene first says it is at rest: where the stage stops asking for frames. */
const rested = (layout: SceneLayout): Scene => {
  const scene = staged(layout);

  settle(scene);

  return scene;
};

/** The first rest comes at the end of a swing. This runs on until the swing has died. */
const still = (scene: Scene, pointer: ScenePointer = AWAY): Scene => {
  Array.from({ length: 1500 }).forEach(() => scene.step(DT, pointer));

  return scene;
};

/** Moves a held pointer in a straight line, one step per frame. */
const drag = (scene: Scene, from: Point, to: Point, each: () => void = () => undefined, speed = 3): void => {
  const frames = Math.max(1, Math.ceil(dist(from, to) / speed));

  Array.from({ length: frames }, (_, i) => (i + 1) / frames).forEach((f) => {
    scene.step(DT, at(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, true));
    each();
  });
};

const hold = (scene: Scene, where: Point, frames: number, each: () => void = () => undefined): void => {
  Array.from({ length: frames }).forEach(() => {
    scene.step(DT, at(where.x, where.y, true));
    each();
  });
};

/**
 * The lab's gesture: grab, lift up and over the amp, lower straight down onto the socket.
 * A calm hand: 180px a second across, half a second for the swing to ease, 120px a second down.
 */
const plugIn = (scene: Scene, layout: SceneLayout, each: () => void = () => undefined): void => {
  const { socket } = geometry(layout);
  const start = scene.plug().handle;
  const lifted = { x: start.x, y: socket.y - 70 };
  const over = { x: socket.x, y: socket.y - 70 };

  scene.press?.(at(start.x, start.y, true));
  drag(scene, start, lifted, each);
  drag(scene, lifted, over, each);
  hold(scene, over, 30, each);
  drag(scene, over, { x: socket.x, y: socket.y + 14 - PLUG }, each, 2);
};

const cableLength = (scene: Scene): number =>
  scene.cable().reduce((sum, point, i, all) => sum + (i === 0 ? 0 : dist(all[i - 1], point)), 0);

const recorder = (): { ctx: CanvasRenderingContext2D; fills: string[]; strokes: string[]; calls: string[]; moves: Point[] } => {
  const fills: string[] = [];
  const strokes: string[] = [];
  const calls: string[] = [];
  const moves: Point[] = [];
  const state: { fill: unknown; stroke: unknown } = { fill: '', stroke: '' };
  const gradient = (): { addColorStop: () => void } => ({ addColorStop: (): void => undefined });
  const note = (name: string) => (): void => { calls.push(name); };
  const ctx = {
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    get fillStyle(): unknown { return state.fill; },
    set fillStyle(v: unknown) { state.fill = v; },
    get strokeStyle(): unknown { return state.stroke; },
    set strokeStyle(v: unknown) { state.stroke = v; },
    save: note('save'),
    restore: note('restore'),
    beginPath: note('beginPath'),
    closePath: note('closePath'),
    moveTo: note('moveTo'),
    lineTo: note('lineTo'),
    quadraticCurveTo: note('quadraticCurveTo'),
    arcTo: note('arcTo'),
    arc: note('arc'),
    roundRect: note('roundRect'),
    rotate: note('rotate'),
    translate: (x: number, y: number): void => { moves.push({ x, y }); },
    createLinearGradient: gradient,
    fill: (): void => { fills.push(String(state.fill)); },
    fillRect: (): void => { fills.push(String(state.fill)); },
    stroke: (): void => { strokes.push(String(state.stroke)); },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes, calls, moves };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPulledPlug', () => {
  it('asks the stage to capture the pointer', () => {
    expect(createPulledPlug().drag).toBe(true);
  });

  it('paints before any layout without throwing', () => {
    const rec = recorder();

    expect(() => createPulledPlug().paint(rec.ctx, COLORS)).not.toThrow();
  });
});

describe.each([
  ['wide', WIDE],
  ['narrow', NARROW],
])('pulled plug at rest, %s card', (_name, layout) => {
  const { socket, floor, box, rope, anchor } = geometry(layout);

  it('starts seated in the socket', () => {
    const scene = staged(layout);

    expect(scene.seated()).toBe(true);
    expect(scene.plug().tip.x).toBeCloseTo(socket.x, 6);
    expect(scene.plug().tip.y).toBeCloseTo(socket.y + 14, 6);
    expect(scene.plug().handle.x).toBeCloseTo(socket.x, 6);
    expect(scene.plug().handle.y).toBeCloseTo(socket.y + 14 - PLUG, 6);
  });

  it('hangs the cable from the top edge to the seated plug with a sag', () => {
    const cable = staged(layout).cable();
    const middle = cable[Math.floor(cable.length / 2)];
    const chordY = anchor.y + (socket.y + 14 - PLUG - anchor.y) * 0.5;

    expect(middle.y).toBeGreaterThan(chordY + 20);
    expect(cable[0]).toEqual(anchor);
    expect(cable).toHaveLength(14);
  });

  it('pops out on the very first step', () => {
    const scene = staged(layout);
    const awake = scene.step(DT, AWAY);

    expect(scene.seated()).toBe(false);
    expect(awake).toBe(true);
    expect(scene.plug().handle.y).toBeLessThan(socket.y + 14 - PLUG);
    expect(scene.plug().handle.x).toBeGreaterThan(socket.x);
  });

  it('throws the plug up and away from the amp', () => {
    const scene = staged(layout);

    Array.from({ length: 8 }).forEach(() => scene.step(DT, AWAY));

    expect(scene.plug().tip.y).toBeLessThan(socket.y + 14 - 15);
    expect(scene.plug().handle.x).toBeGreaterThan(socket.x + 2);
  });

  it('comes to rest with the pointer outside', () => {
    const frames = settle(staged(layout));

    expect(frames).toBeGreaterThan(30);
    expect(frames).toBeLessThan(720);
  });

  it('rests hanging tip-down beside the amp, clear of the floor', () => {
    const { handle, tip } = rested(layout).plug();

    expect(tip.y - handle.y).toBeGreaterThan(PLUG * 0.95);
    expect(Math.abs(tip.x - handle.x)).toBeLessThan(8);
    expect(tip.x).toBeGreaterThan(box.right);
    expect(handle.x).toBeGreaterThan(box.right);
    expect(tip.y).toBeLessThan(floor - 3);
  });

  it('stops for good once a woken swing has died', () => {
    const scene = still(rested(layout));
    const before = scene.plug();
    const awake = Array.from({ length: 120 }).filter(() => scene.step(DT, AWAY));

    expect(awake).toHaveLength(0);
    expect(dist(scene.plug().tip, before.tip)).toBeLessThan(0.5);
    expect(Math.abs(scene.plug().tip.x - scene.plug().handle.x)).toBeLessThan(8);
    expect(scene.plug().tip.x).toBeGreaterThan(box.right);
    expect(scene.plug().tip.y).toBeLessThan(floor - 3);
  });

  it('never stretches the cable or the plug while it swings', () => {
    const scene = staged(layout);
    const worst = { pop: 0, swing: 0, plug: 0 };

    Array.from({ length: 600 }).forEach((_, frame) => {
      scene.step(DT, AWAY);
      const zone = frame < 10 ? 'pop' : 'swing';

      worst[zone] = Math.max(worst[zone], cableLength(scene));
      worst.plug = Math.max(worst.plug, dist(scene.plug().handle, scene.plug().tip));
    });

    // The pop's kick outruns the solver for a few frames; after that it holds within 6%.
    expect(worst.swing).toBeLessThan(rope * 1.06);
    expect(worst.pop).toBeLessThan(rope * 1.12);
    expect(worst.plug).toBeCloseTo(PLUG, 3);
  });

  it('settles the cable near its rope length', () => {
    const length = cableLength(still(rested(layout))) / rope;

    expect(length).toBeGreaterThan(0.99);
    expect(length).toBeLessThan(1.04);
  });

  it('ignores a step with no time in it', () => {
    const scene = rested(layout);
    const before = scene.plug();

    scene.step(0, AWAY);

    expect(scene.plug()).toEqual(before);
  });

  it('keeps every free point above the floor and out of the amp', () => {
    const scene = staged(layout);
    const inside = { amp: 0, floor: 0 };

    Array.from({ length: 600 }).forEach(() => {
      scene.step(DT, AWAY);
      [...scene.cable().slice(1), scene.plug().tip].forEach((point, i, all) => {
        const inHole = i === all.length - 1 && Math.abs(point.x - socket.x) < 9;
        const inAmp = point.x > box.left + 0.01 && point.x < box.right - 0.01 && point.y > box.top + 0.01;

        inside.amp += inAmp && !inHole ? 1 : 0;
        inside.floor += point.y > floor - 3 + 0.01 ? 1 : 0;
      });
    });

    expect(inside).toEqual({ amp: 0, floor: 0 });
  });
});

describe.each([
  ['wide', WIDE],
  ['narrow', NARROW],
])('pulled plug in the hand, %s card', (_name, layout) => {
  const { socket, floor, rope, anchor, box } = geometry(layout);

  it('a press near the plug grabs it and the handle follows the pointer', () => {
    const scene = rested(layout);
    const start = scene.plug().handle;
    const to = { x: start.x - 12, y: start.y - 30 };

    scene.press?.(at(start.x + 10, start.y + 20, true));
    drag(scene, start, to);

    expect(scene.plug().handle.x).toBeCloseTo(to.x, 6);
    expect(scene.plug().handle.y).toBeCloseTo(to.y, 6);
    expect(scene.step(DT, at(to.x, to.y, true))).toBe(true);
  });

  it('clamps a grabbed handle to the reach of the cable', () => {
    const scene = rested(layout);
    const start = scene.plug().handle;
    const far = { x: anchor.x - 300, y: anchor.y + 20 };

    scene.press?.(at(start.x, start.y, true));
    hold(scene, far, 30);

    const { handle } = scene.plug();
    const reach = rope * 0.97;
    const away = dist(far, anchor);

    expect(dist(handle, anchor)).toBeCloseTo(reach, 6);
    expect(handle.x).toBeCloseTo(anchor.x + (far.x - anchor.x) / away * reach, 6);
    expect(handle.y).toBeCloseTo(anchor.y + (far.y - anchor.y) / away * reach, 6);
  });

  it('never lets a grabbed handle go under the floor', () => {
    const scene = rested(layout);
    const start = scene.plug().handle;

    scene.press?.(at(start.x, start.y, true));
    hold(scene, { x: start.x, y: floor + 80 }, 30);

    expect(scene.plug().handle.y).toBeLessThanOrEqual(floor - 6);
  });

  it('a press far from the plug does nothing', () => {
    const scene = still(rested(layout));
    const before = scene.plug();
    const far = { x: before.handle.x - 60, y: before.handle.y - 40 };

    scene.press?.(at(far.x, far.y, true));

    expect(scene.step(DT, at(far.x, far.y, true))).toBe(false);
    expect(dist(scene.plug().handle, before.handle)).toBeLessThan(0.5);
    expect(dist(scene.plug().tip, before.tip)).toBeLessThan(0.5);
  });

  it('grabs within 26px of the plug and not beyond', () => {
    const near = still(rested(layout));
    const beyond = still(rested(layout));
    const { handle, tip } = near.plug();
    const middle = { x: (handle.x + tip.x) / 2, y: (handle.y + tip.y) / 2 };
    const to = { x: handle.x - 30, y: handle.y - 30 };

    near.press?.(at(middle.x - 24, middle.y, true));
    beyond.press?.(at(middle.x - 29, middle.y, true));
    near.step(DT, at(to.x, to.y, true));
    beyond.step(DT, at(to.x, to.y, true));

    expect(near.plug().handle).toEqual(to);
    expect(dist(beyond.plug().handle, handle)).toBeLessThan(0.5);
  });

  it('lets go on release and the plug falls back to rest', () => {
    const scene = rested(layout);
    const start = scene.plug().handle;
    const to = { x: start.x - 20, y: start.y - 40 };

    scene.press?.(at(start.x, start.y, true));
    drag(scene, start, to);
    scene.release?.();
    scene.step(DT, at(to.x, to.y));

    expect(dist(scene.plug().handle, to)).toBeGreaterThan(0.01);
    expect(settle(scene, at(to.x, to.y))).toBeGreaterThan(-1);
    expect(scene.seated()).toBe(false);
  });

  it('lowering a grabbed plug onto the socket seats it and ends the grab', () => {
    const scene = rested(layout);

    plugIn(scene, layout);

    expect(scene.seated()).toBe(true);
    expect(scene.plug().tip.x).toBeCloseTo(socket.x, 6);
    expect(scene.plug().tip.y).toBeCloseTo(socket.y + 14, 6);
    expect(scene.plug().handle.y).toBeCloseTo(socket.y + 14 - PLUG, 6);

    hold(scene, { x: socket.x + 60, y: socket.y - 60 }, 10);

    expect(scene.plug().handle.x).toBeCloseTo(socket.x, 6);
  });

  it('seats the plug on the way down, before the pointer reaches the seat', () => {
    const scene = rested(layout);
    const seatedAt: number[] = [];

    plugIn(scene, layout, () => {
      if (scene.seated() && seatedAt.length === 0) seatedAt.push(scene.plug().tip.y);
    });

    expect(seatedAt).toEqual([socket.y + 14]);
  });

  it('never stretches the cable while the plug is carried to the socket', () => {
    const scene = rested(layout);
    const worst = { cable: 0 };

    plugIn(scene, layout, () => {
      worst.cable = Math.max(worst.cable, cableLength(scene));
    });

    // The amp pushes the cable out of its box after the links are solved.
    expect(worst.cable).toBeLessThan(rope * 1.2);
  });

  it('a seated plug stays seated across more steps and after release', () => {
    const scene = rested(layout);

    plugIn(scene, layout);
    scene.release?.();
    const frames = settle(scene);
    const unseated = Array.from({ length: 1500 }).filter(() => {
      scene.step(DT, AWAY);

      return !scene.seated();
    });

    expect(unseated).toHaveLength(0);
    expect(frames).toBeGreaterThan(-1);
    expect(scene.plug().tip).toEqual({ x: socket.x, y: socket.y + 14 });
    expect(scene.plug().handle).toEqual({ x: socket.x, y: socket.y + 14 - PLUG });
    expect(scene.step(DT, AWAY)).toBe(false);
  });

  it('pressing a seated plug pulls it out, and it falls back beside the amp', () => {
    const scene = rested(layout);
    const where = { x: socket.x + 3, y: socket.y - 20 };

    plugIn(scene, layout);
    scene.release?.();
    settle(scene);
    scene.press?.(at(where.x, where.y, true));

    expect(scene.seated()).toBe(false);

    hold(scene, where, 3);
    scene.release?.();
    const frames = settle(scene, at(where.x, where.y));

    expect(scene.seated()).toBe(false);
    expect(frames).toBeGreaterThan(-1);
    expect(scene.plug().tip.x).toBeGreaterThan(box.right);
  });

  it('a quick pull takes a seated plug away with the pointer', () => {
    const scene = rested(layout);
    const to = { x: socket.x + 40, y: socket.y - 98 };

    plugIn(scene, layout);
    scene.release?.();
    scene.press?.(at(socket.x, socket.y - 20, true));
    hold(scene, to, 2);

    expect(scene.seated()).toBe(false);
    expect(scene.plug().handle.x).toBeCloseTo(to.x, 6);
    expect(scene.plug().handle.y).toBeCloseTo(to.y, 6);
  });

  it('a press on the plug before the first step grabs it instead of popping it', () => {
    const scene = staged(layout);
    const to = { x: socket.x + 40, y: socket.y - 98 };

    scene.press?.(at(socket.x, socket.y - 20, true));
    scene.step(DT, at(to.x, to.y, true));

    expect(scene.plug().handle).toEqual(to);
    expect(scene.seated()).toBe(false);
  });

  it('reset puts a pulled plug back in the socket', () => {
    const scene = rested(layout);

    scene.reset();

    expect(scene.seated()).toBe(true);
    expect(scene.plug().tip).toEqual({ x: socket.x, y: socket.y + 14 });
  });
});

describe('pulled plug paint', () => {
  it('draws the cable and plug body in the card ink', () => {
    const scene = staged(WIDE);
    const rec = recorder();

    scene.paint(rec.ctx, COLORS);

    expect(rec.strokes).toContain(COLORS.ink);
    expect(rec.fills).toContain(COLORS.ink);
    expect(rec.fills).toContain(COLORS.card);
  });

  it('keeps the amp and the metal in their own fixed colours', () => {
    const scene = staged(WIDE);
    const rec = recorder();

    scene.paint(rec.ctx, COLORS);

    expect(rec.fills).toEqual(expect.arrayContaining(['#17171a', '#1b1b1d', '#e9e9ec', '#5a1512', '#0b0b0c', '#131315']));
    expect(rec.calls.filter((name) => name === 'roundRect')).toHaveLength(6);
  });

  it('draws the plug at the handle, seated before the first step', () => {
    const { socket } = geometry(WIDE);
    const scene = staged(WIDE);
    const rec = recorder();

    scene.paint(rec.ctx, COLORS);

    expect(rec.moves).toContainEqual({ x: socket.x, y: socket.y + 14 - PLUG });
  });

  it('paints the same things after the plug has come to rest', () => {
    const scene = rested(NARROW);
    const rec = recorder();

    expect(() => scene.paint(rec.ctx, COLORS)).not.toThrow();
    expect(rec.fills.length).toBeGreaterThan(20);
    expect(rec.strokes).toHaveLength(3);
  });
});

describe('pulled plug: rest, pull-out and the pose before the pop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([['wide', WIDE], ['narrow', NARROW]])('is truly still once it says it is at rest (%s)', (_name, layout) => {
    const scene = rested(layout);
    const before = scene.plug().tip;

    Array.from({ length: 600 }).forEach(() => scene.step(DT, AWAY));

    expect(dist(scene.plug().tip, before)).toBeLessThan(1.5);
  });

  it('a slow, straight pull takes a seated plug out with the pointer', () => {
    const scene = staged(WIDE);
    const start = scene.plug().handle;
    const grip = { x: start.x, y: start.y + 10 };

    scene.press?.(at(grip.x, grip.y, true));
    drag(scene, grip, { x: grip.x, y: grip.y - 70 }, undefined, 2);

    expect(scene.seated()).toBe(false);
    expect(scene.plug().handle.y).toBeLessThan(start.y - 50);
  });

  it('a plug pulled out can be lowered back in', () => {
    const scene = staged(WIDE);
    const { socket } = geometry(WIDE);
    const start = scene.plug().handle;
    const up = { x: start.x, y: socket.y - 90 };

    scene.press?.(at(start.x, start.y, true));
    drag(scene, start, up, undefined, 2);
    hold(scene, up, 30);
    drag(scene, up, { x: socket.x, y: socket.y + 14 - PLUG }, undefined, 2);

    expect(scene.seated()).toBe(true);
  });

  it.each([['wide', WIDE], ['narrow', NARROW]])('shows the cable at its real length before the pop (%s)', (_name, layout) => {
    const scene = staged(layout);

    expect(Math.abs(cableLength(scene) / geometry(layout).rope - 1)).toBeLessThan(0.03);
    expect(scene.seated()).toBe(true);
  });
});

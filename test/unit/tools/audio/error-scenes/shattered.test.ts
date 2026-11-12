import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShattered } from '../../../../../src/tools/audio/error-scenes/shattered';
import type { ShatteredPiece, ShatteredScene } from '../../../../../src/tools/audio/error-scenes/shattered';
import type { SceneColors, SceneFactory, SceneLayout, ScenePointer } from '../../../../../src/tools/audio/error-scenes/types';

const WIDE: SceneLayout = { width: 768, height: 216, zone: { x: 361, y: 0, width: 407, floor: 216 }, scale: 2 };
const NARROW: SceneLayout = { width: 380, height: 420, zone: { x: 0, y: 0, width: 380, floor: 172 }, scale: 2 };
const COLORS: SceneColors = { ink: '#111', card: '#fff', muted: '#888' };
const FRAME = 1 / 60;
const AWAY: ScenePointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, down: false };

const staged = (layout: SceneLayout, random?: () => number): ShatteredScene => {
  const scene = createShattered(random);

  scene.layout(layout);
  scene.reset();

  return scene;
};

const run = (scene: ShatteredScene, frames: number, pointer: ScenePointer = AWAY): boolean[] =>
  Array.from({ length: frames }, () => scene.step(FRAME, pointer));

/** Steps until the scene says it is at rest. Returns the seconds it took, or -1. */
const settle = (scene: ShatteredScene, seconds: number): number => {
  const frames = Math.round(seconds / FRAME);
  const at = Array.from({ length: frames }).findIndex(() => !scene.step(FRAME, AWAY));

  return at < 0 ? -1 : (at + 1) * FRAME;
};

const moved = (piece: ShatteredPiece): number => Math.hypot(piece.dx, piece.dy);

const METHODS = [
  'save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'arc', 'fill', 'stroke', 'clip', 'fillRect', 'drawImage',
] as const;

type Recorder = Record<(typeof METHODS)[number], ReturnType<typeof vi.fn>>;

const fakeContext = (): { ctx: CanvasRenderingContext2D; calls: Recorder } => {
  const calls = Object.fromEntries(METHODS.map((name) => [name, vi.fn()])) as Recorder;
  const gradient = (): { addColorStop: ReturnType<typeof vi.fn> } => ({ addColorStop: vi.fn() });
  const ctx = {
    ...calls,
    createRadialGradient: vi.fn(gradient),
    createConicGradient: vi.fn(gradient),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    globalCompositeOperation: 'source-over',
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
};

describe('createShattered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fits the scene factory contract', () => {
    const factory: SceneFactory = createShattered;
    const scene = factory();

    expect(scene.drag).toBeUndefined();
    expect(scene.goo).toBeUndefined();
  });

  it('is whole before the break: no piece is displaced until the first step', () => {
    const scene = staged(WIDE);

    expect(scene.pieces().map((piece) => [piece.dx, piece.dy, piece.angle])).toEqual(
      scene.pieces().map(() => [0, 0, 0])
    );
    expect(scene.pieces()).toHaveLength(30);
  });

  it('breaks on the very first step, with no hold of its own, and every piece moves', () => {
    const scene = staged(WIDE);
    const awake = run(scene, 2);

    expect(scene.pieces().filter((piece) => moved(piece) > 0)).toHaveLength(30);
    expect(awake).toEqual([true, true]);

    run(scene, 20);

    expect(scene.pieces().filter((piece) => moved(piece) > 0.5)).toHaveLength(30);
    expect(scene.pieces().some((piece) => piece.angle !== 0)).toBe(true);
  });

  it('throws pieces away from the hit point, off centre to the upper right', () => {
    const scene = staged(WIDE);
    const start = scene.pieces();
    const hit = { x: 361 + 407 / 2 + 86 * 0.2, y: 108 - 86 * 0.14 };

    run(scene, 4);

    const outward = scene.pieces().filter((piece, i) => {
      const before = Math.hypot(start[i].x - hit.x, start[i].y - hit.y);

      return Math.hypot(piece.x - hit.x, piece.y - hit.y) > before;
    });

    expect(outward).toHaveLength(30);
  });

  it('comes to rest within a few seconds with the pointer outside', () => {
    const scene = staged(WIDE);
    const took = settle(scene, 5);

    expect(took).toBeGreaterThan(0.2);
    expect(took).toBeLessThan(5);
  });

  it.each([
    ['wide', WIDE],
    ['narrow', NARROW],
  ])('keeps every piece inside the zone on a %s layout', (_name, layout) => {
    const scene = staged(layout);
    const { zone } = layout;
    const outside = Array.from({ length: 360 }).flatMap(() => {
      scene.step(FRAME, AWAY);

      return scene.pieces().filter((piece) => {
        const margin = piece.radius * 0.5 - 1e-6;

        return piece.x < zone.x + margin || piece.x > zone.x + zone.width - margin
          || piece.y < zone.y + margin || piece.y > zone.floor - margin;
      });
    });

    expect(outside).toEqual([]);
    expect(scene.pieces().every((piece) => moved(piece) > 0.5)).toBe(true);
  });

  it('starts as a disc centred in the zone that fits inside it', () => {
    const scene = staged(NARROW);
    const reach = Math.max(...scene.pieces().map((piece) => Math.hypot(piece.x - 190, piece.y - 86) + piece.radius / 0.72));

    expect(reach).toBeLessThanOrEqual(69 * 1.5);
    expect(Math.max(...scene.pieces().map((piece) => Math.hypot(piece.x - 190, piece.y - 86)))).toBeLessThan(69);
  });

  it('lets a moving pointer push a piece, and the piece stays where it was pushed', () => {
    const scene = staged(WIDE);

    settle(scene, 5);
    const before = scene.pieces()[4];
    const pointer: ScenePointer = { x: before.x - 3, y: before.y, vx: 420, vy: 0, inside: true, down: false };
    const awake = run(scene, 8, pointer);
    const pushed = scene.pieces()[4];

    expect(pushed.x - before.x).toBeGreaterThan(2);
    expect(awake.every(Boolean)).toBe(true);

    expect(settle(scene, 5)).toBeGreaterThan(0);
    const rested = scene.pieces()[4];

    run(scene, 60);
    const later = scene.pieces()[4];

    expect(rested.x - before.x).toBeGreaterThan(2);
    expect(Math.hypot(later.x - rested.x, later.y - rested.y)).toBeLessThan(0.5);
  });

  it('stays awake while the pointer is inside, even when nothing moves', () => {
    const scene = staged(WIDE);

    settle(scene, 5);

    expect(scene.step(FRAME, { ...AWAY, x: 2, y: 2, inside: true })).toBe(true);
  });

  it('is whole again after reset(), and the break plays again', () => {
    const scene = staged(WIDE);

    settle(scene, 5);
    scene.reset();

    expect(scene.pieces().map((piece) => [piece.dx, piece.dy, piece.angle])).toEqual(
      scene.pieces().map(() => [0, 0, 0])
    );

    run(scene, 20);

    expect(scene.pieces().every((piece) => moved(piece) > 0.5)).toBe(true);
  });

  it('gives the same result for the same random source', () => {
    const first = staged(WIDE, () => 0.25);
    const second = staged(WIDE, () => 0.25);

    run(first, 120);
    run(second, 120);

    expect(first.pieces()).toEqual(second.pieces());
  });

  it('paints the whole record: one shadowed disc with a spindle hole, then the texture', () => {
    const texture = fakeContext();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(texture.ctx);
    const scene = staged(WIDE);
    const { ctx, calls } = fakeContext();

    scene.paint(ctx, COLORS);

    expect(calls.arc.mock.calls).toEqual([
      [564.5, 108, 85, 0, Math.PI * 2],
      [564.5, 108, 86 * 0.05, 0, Math.PI * 2, true],
    ]);
    expect(calls.fill).toHaveBeenCalledTimes(1);
    expect(calls.drawImage).toHaveBeenCalledTimes(1);
    expect(calls.drawImage.mock.calls[0].slice(1)).toEqual([564.5 - 86, 108 - 86, 172, 172]);
    expect(calls.clip).not.toHaveBeenCalled();
  });

  it('paints every broken piece clipped to its own outline, inner bands first', () => {
    const texture = fakeContext();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(texture.ctx);
    const scene = staged(WIDE);
    const { ctx, calls } = fakeContext();

    run(scene, 20);
    scene.paint(ctx, COLORS);

    expect(calls.clip).toHaveBeenCalledTimes(30);
    expect(calls.drawImage).toHaveBeenCalledTimes(30);
    expect(calls.stroke).toHaveBeenCalledTimes(30);
    expect(calls.fill).toHaveBeenCalledTimes(30);
    // Inner pieces are triangles, the rim pieces carry the arc points.
    expect(calls.lineTo.mock.calls.length).toBe(10 * 2 + 10 * 3 + 10 * 10);
    expect(calls.moveTo.mock.calls.length).toBe(30);
  });

  it('draws the vinyl texture once per radius', () => {
    const texture = fakeContext();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(texture.ctx);
    const scene = staged(WIDE);
    const { ctx } = fakeContext();

    expect(getContext).not.toHaveBeenCalled();

    scene.paint(ctx, COLORS);
    scene.paint(ctx, COLORS);
    scene.layout(WIDE);
    scene.reset();
    scene.paint(ctx, COLORS);

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(texture.calls.arc.mock.calls[0]).toEqual([0, 0, 86, 0, Math.PI * 2]);

    scene.layout(NARROW);
    scene.reset();
    scene.paint(ctx, COLORS);

    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it('still paints the pieces when the texture canvas has no 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const scene = staged(WIDE);
    const { ctx, calls } = fakeContext();

    expect(() => scene.paint(ctx, COLORS)).not.toThrow();
    expect(calls.fill).toHaveBeenCalledTimes(1);
    expect(calls.drawImage).not.toHaveBeenCalled();

    run(scene, 20);

    expect(() => scene.paint(ctx, COLORS)).not.toThrow();
    expect(calls.clip).toHaveBeenCalledTimes(30);
    expect(calls.drawImage).not.toHaveBeenCalled();
  });
});

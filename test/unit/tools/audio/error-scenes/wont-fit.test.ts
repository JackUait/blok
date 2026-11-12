import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createWontFit } from '../../../../../src/tools/audio/error-scenes/wont-fit';
import type { SceneLayout, ScenePointer } from '../../../../../src/tools/audio/error-scenes/types';

const WIDE: SceneLayout = { width: 768, height: 216, scale: 2, zone: { x: 361, y: 0, width: 407, floor: 216 } };
const NARROW: SceneLayout = { width: 380, height: 420, scale: 2, zone: { x: 0, y: 0, width: 380, floor: 172 } };
const AWAY: ScenePointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, down: false };
const COLORS = { ink: '#000', card: '#fff', muted: '#999' };
const DT = 1 / 60;

const make = (layout: SceneLayout = WIDE): ReturnType<typeof createWontFit> => {
  const scene = createWontFit({ size: '84 MB', limit: 'max 50 MB' });

  scene.layout(layout);
  scene.reset();

  return scene;
};

/** Step until the scene reports rest. Returns the simulated seconds it took. */
const settle = (scene: ReturnType<typeof createWontFit>, pointer: ScenePointer = AWAY): number => {
  const steps = Array.from({ length: 1200 }).findIndex(() => !scene.step(DT, pointer));

  return steps === -1 ? Infinity : steps * DT;
};

const at = (scene: ReturnType<typeof createWontFit>, angle: number, down: boolean): ScenePointer => {
  const { x, y } = scene.disc();

  return { x: x + Math.cos(angle) * 60, y: y + Math.sin(angle) * 60, vx: 0, vy: 0, inside: true, down };
};

const fakeContext = (): { ctx: CanvasRenderingContext2D; texts: string[]; images: number } => {
  const record = { texts: [] as string[], images: 0 };
  const gradient = { addColorStop: vi.fn() };
  const target = {
    fillText: (text: string) => { record.texts.push(text); },
    drawImage: () => { record.images += 1; },
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
  };
  const ctx = new Proxy(target, {
    get: (obj, key): unknown => (key in obj ? Reflect.get(obj, key) : vi.fn()),
    set: () => true,
  });

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    get texts() { return record.texts; },
    get images() { return record.images; },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWontFit', () => {
  it('starts as a record small enough to sit inside the card', () => {
    const scene = make();
    const { radius } = scene.disc();

    expect(radius * 2).toBeLessThan(WIDE.zone.floor - WIDE.zone.y);
  });

  it.each([['wide', WIDE], ['narrow', NARROW]])('swells until it is taller than its %s zone', (_name, layout) => {
    const scene = make(layout);

    settle(scene);

    expect(scene.disc().radius * 2).toBeGreaterThan((layout.zone.floor - layout.zone.y) * 2);
  });

  it('keeps its label inside the zone when it has swollen', () => {
    const scene = make();

    settle(scene);
    const { x, y, radius } = scene.disc();
    const label = radius * 0.335;

    expect(x - label).toBeGreaterThan(WIDE.zone.x);
    expect(x + label).toBeLessThan(WIDE.zone.x + WIDE.zone.width);
    expect(y - label).toBeGreaterThan(WIDE.zone.y);
    expect(y + label).toBeLessThan(WIDE.zone.floor);
  });

  it('overshoots its final size on the way, like something heavy landing', () => {
    const scene = make();
    const sizes = Array.from({ length: 240 }, () => {
      scene.step(DT, AWAY);

      return scene.disc().radius;
    });
    const final = sizes[sizes.length - 1];

    expect(Math.max(...sizes)).toBeGreaterThan(final * 1.02);
  });

  it('comes to rest within six seconds', () => {
    const scene = make();

    expect(settle(scene)).toBeLessThan(6);
    expect(scene.step(DT, AWAY)).toBe(false);
  });

  it('turns a little as it swells, then stops', () => {
    const scene = make();
    const before = scene.disc().angle;

    settle(scene);

    expect(scene.disc().angle).toBeGreaterThan(before);
  });

  it('turns with the pointer while it is held', () => {
    const scene = make();

    settle(scene);
    const start = scene.disc().angle;

    scene.press?.(at(scene, 0, true));
    Array.from({ length: 30 }, (_, i) => scene.step(DT, at(scene, ((i + 1) / 30) * (Math.PI / 2), true)));

    expect(scene.disc().angle - start).toBeCloseTo(Math.PI / 2, 2);
  });

  it('keeps turning after a flick and slows to a stop', () => {
    const scene = make();

    settle(scene);
    scene.press?.(at(scene, 0, true));
    Array.from({ length: 10 }, (_, i) => scene.step(DT, at(scene, (i + 1) * 0.1, true)));
    scene.release?.();
    const released = scene.disc().angle;

    scene.step(DT, AWAY);
    expect(scene.disc().angle).toBeGreaterThan(released);
    expect(settle(scene)).toBeLessThan(8);
  });

  it('does not turn for a pointer that only hovers', () => {
    const scene = make();

    settle(scene);
    const start = scene.disc().angle;

    Array.from({ length: 30 }, (_, i) => scene.step(DT, at(scene, i * 0.1, false)));

    expect(Math.abs(scene.disc().angle - start)).toBeLessThan(0.01);
  });

  it('is small again after a reset', () => {
    const scene = make();
    const small = scene.disc().radius;

    settle(scene);
    scene.reset();

    expect(scene.disc().radius).toBe(small);
  });

  it('prints the file size and the limit on its label', () => {
    const texture = fakeContext();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => texture.ctx);
    const scene = make();
    const screen = fakeContext();

    scene.paint(screen.ctx, COLORS);

    expect(texture.texts).toEqual(['84 MB', 'MAX 50 MB']);
    expect(screen.images).toBe(1);
  });

  it('paints without a texture where the browser gives no canvas context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const scene = make();
    const screen = fakeContext();

    expect(() => scene.paint(screen.ctx, COLORS)).not.toThrow();
    expect(screen.images).toBe(0);
  });
});

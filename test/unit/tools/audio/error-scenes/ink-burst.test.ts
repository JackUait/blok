import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInkBurst } from '../../../../../src/tools/audio/error-scenes/ink-burst';
import type { InkBurstScene } from '../../../../../src/tools/audio/error-scenes/ink-burst';
import type { SceneColors, SceneLayout, ScenePointer } from '../../../../../src/tools/audio/error-scenes/types';

const TAU = Math.PI * 2;
const FRAME = 1 / 60;

const WIDE: SceneLayout = { width: 768, height: 216, zone: { x: 361, y: 0, width: 407, floor: 216 }, scale: 2 };
const NARROW: SceneLayout = { width: 380, height: 420, zone: { x: 0, y: 0, width: 380, floor: 172 }, scale: 2 };
const COLORS: SceneColors = { ink: 'rgb(20, 20, 20)', card: 'rgb(255, 255, 255)', muted: 'rgb(120, 120, 120)' };
const AWAY: ScenePointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, down: false };

const centreOf = (layout: SceneLayout): { x: number; y: number } => ({
  x: layout.zone.x + layout.zone.width * 0.5,
  y: layout.zone.y + (layout.zone.floor - layout.zone.y) * 0.4,
});

const at = (x: number, y: number): ScenePointer => ({ x, y, vx: 0, vy: 0, inside: true, down: false });

/** Small seeded 0..1 source. */
const seeded = (seed: number): (() => number) => {
  const state = { a: seed };

  return () => {
    state.a = (state.a + 0x6D2B79F5) | 0;
    const mixed = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
    const out = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((out ^ (out >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * With every draw at 0.5 the splat is easy to reason about: lobes reach 34.5px
 * from the centre, all droplets fly left, drips run down. Right of it is clean.
 */
const half = (): number => 0.5;

const mounted = (layout: SceneLayout, random: () => number): InkBurstScene => {
  const scene = createInkBurst(random);

  scene.layout(layout);
  scene.reset();

  return scene;
};

/** Steps with the pointer away until the scene rests. Returns the simulated seconds it took. */
const settle = (scene: InkBurstScene, limit = 20): number => {
  const clock = { t: 0, awake: true };

  while (clock.awake && clock.t < limit) {
    clock.awake = scene.step(FRAME, AWAY);
    clock.t += FRAME;
  }

  return clock.t;
};

/** Every whole-pixel point of the canvas that holds ink. */
const wetPoints = (scene: InkBurstScene, layout: SceneLayout): Array<{ x: number; y: number }> =>
  Array.from({ length: layout.width * layout.height }, (_, i) => ({ x: (i % layout.width) + 0.5, y: Math.floor(i / layout.width) + 0.5 }))
    .filter((p) => scene.isWet(p.x, p.y));

const inZone = (layout: SceneLayout, p: { x: number; y: number }): boolean =>
  p.x >= layout.zone.x && p.x <= layout.zone.x + layout.zone.width && p.y >= layout.zone.y && p.y <= layout.zone.floor;

/** Drags the pointer in a straight line, one step per frame. */
const drag = (scene: InkBurstScene, from: { x: number; y: number }, dx: number, dy: number, steps: number): void => {
  Array.from({ length: steps + 1 }, (_, i) => i).forEach((i) => {
    scene.step(FRAME, at(from.x + dx * i, from.y + dy * i));
  });
};

type Call = [name: string, ...args: unknown[]];

/** A context that records every call and every property write, in order. */
const recorder = (): { ctx: CanvasRenderingContext2D; calls: Call[] } => {
  const calls: Call[] = [];
  const ctx = new Proxy<Record<string, unknown>>({}, {
    get: (_target, key) => (...args: unknown[]): void => {
      calls.push([String(key), ...args]);
    },
    set: (_target, key, value) => {
      calls.push([`set ${String(key)}`, value]);

      return true;
    },
  });

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
};

const named = (calls: Call[], name: string): Call[] => calls.filter((call) => call[0] === name);

describe('createInkBurst', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no 2D canvas: the scene must run without one.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the stage for its goo filter', () => {
    expect(createInkBurst().goo).toBe(true);
  });

  describe('before the break', () => {
    it('is one round drop with no ink anywhere else', () => {
      const scene = mounted(WIDE, seeded(1));
      const rec = recorder();
      const centre = centreOf(WIDE);

      scene.paint(rec.ctx, COLORS);

      expect(named(rec.calls, 'arc')).toEqual([['arc', centre.x, centre.y, 27, 0, TAU]]);
      expect(named(rec.calls, 'fill')).toHaveLength(1);
      expect(named(rec.calls, 'drawImage')).toHaveLength(0);
      expect(rec.calls[0]).toEqual(['set fillStyle', COLORS.ink]);
      expect(scene.droplets()).toHaveLength(0);
      expect(scene.drips()).toHaveLength(0);
      expect(wetPoints(scene, WIDE)).toHaveLength(0);
    });
  });

  describe('the burst', () => {
    it('happens on the first step, with no hold of its own', () => {
      const scene = mounted(WIDE, seeded(1));
      const awake = scene.step(FRAME, AWAY);

      expect(scene.droplets()).toHaveLength(56);
      expect(scene.drips()).toHaveLength(5);
      expect(awake).toBe(true);
    });

    it('throws droplets out from the centre, on a 20px ring, at the lab speeds', () => {
      const scene = mounted(WIDE, seeded(2));
      const centre = centreOf(WIDE);

      scene.step(FRAME, AWAY);
      const droplets = scene.droplets();
      const outward = droplets.map((d) => (d.x - centre.x) * d.vx + (d.y - centre.y) * d.vy);
      const speeds = droplets.map((d) => Math.hypot(d.vx, d.vy));

      expect(outward.every((dot) => dot > 0)).toBe(true);
      droplets.forEach((d) => expect(Math.hypot(d.x - centre.x, d.y - centre.y)).toBeCloseTo(20, 6));
      expect(Math.min(...speeds)).toBeGreaterThanOrEqual(260 * 0.45);
      expect(Math.max(...speeds)).toBeLessThanOrEqual(1500 * 1.15);
      expect(Math.max(...speeds)).toBeGreaterThan(700);
      droplets.forEach((d) => {
        expect(d.r).toBeGreaterThanOrEqual(1.6);
        expect(d.r).toBeLessThanOrEqual(7.1);
      });
      expect(droplets.some((d) => d.streak)).toBe(true);
      expect(droplets.some((d) => !d.streak)).toBe(true);
    });

    it('leaves a splat at the centre: a 27px core with lobes around it', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      scene.step(FRAME, AWAY);

      // With half(), lobe 0 sits 23px right of the centre with an 11.5px radius.
      expect(scene.isWet(centre.x + 32, centre.y)).toBe(true);
      expect(scene.isWet(centre.x + 38, centre.y)).toBe(false);
      expect(scene.isWet(centre.x, centre.y)).toBe(true);
      expect(scene.isWet(centre.x, centre.y - 25)).toBe(true);
    });

    it('slows the droplets down as they fly', () => {
      const scene = mounted(WIDE, seeded(2));

      scene.step(FRAME, AWAY);
      const before = scene.droplets().map((d) => Math.hypot(d.vx, d.vy));

      scene.step(FRAME, AWAY);
      const after = scene.droplets().map((d) => Math.hypot(d.vx, d.vy));

      expect(after).toHaveLength(56);
      after.forEach((speed, i) => expect(speed).toBeCloseTo(before[i] * Math.exp(-7.5 * FRAME), 6));
    });

    it('lands ink away from the centre', () => {
      const scene = mounted(WIDE, seeded(3));
      const centre = centreOf(WIDE);

      settle(scene);
      // Above the drips, so only flown droplets count.
      const far = wetPoints(scene, WIDE).filter((p) => p.y < centre.y + 10 && Math.hypot(p.x - centre.x, p.y - centre.y) > 70);

      expect(far.length).toBeGreaterThan(20);
      expect(scene.droplets()).toHaveLength(0);
    });

    it('draws a streak behind a fast droplet and only a dot where a slow one lands', () => {
      // A fixed draw sends every droplet one way. Below 0.45 they are streaks, above they are not.
      // Both land about 110px out, and the lobes end within 35px: 55px out is mid-flight.
      const midFlight = (draw: number): boolean => {
        const scene = mounted(WIDE, () => draw);
        const centre = centreOf(WIDE);
        const x = centre.x + Math.cos(draw * TAU) * 55;
        const y = centre.y + Math.sin(draw * TAU) * 55;

        settle(scene);

        return [-2, 0, 2].some((dx) => [-2, 0, 2].some((dy) => scene.isWet(x + dx, y + dy)));
      };

      expect(midFlight(0.4)).toBe(true);
      expect(midFlight(0.46)).toBe(false);
    });
  });

  describe('drips', () => {
    it('start below the centre and run downward, never past the floor', () => {
      const scene = mounted(WIDE, seeded(4));
      const centre = centreOf(WIDE);

      scene.step(FRAME, AWAY);
      const start = scene.drips();
      const seen = { last: start.map((d) => d.y), rising: false, lowest: 0, steps: 0 };

      while (scene.drips().length > 0 && seen.steps < 1200) {
        const earlier = scene.drips();

        scene.step(FRAME, AWAY);
        const now = scene.drips();

        // Finished drips leave the list from any place: match by x, which never changes.
        seen.rising = seen.rising || now.some((d) => {
          const was = earlier.find((e) => e.x === d.x);

          return was !== undefined && d.y < was.y;
        });
        seen.lowest = Math.max(seen.lowest, ...earlier.map((d) => d.y), ...now.map((d) => d.y));
        seen.steps += 1;
      }

      expect(seen.rising).toBe(false);
      expect(seen.lowest).toBeLessThanOrEqual(WIDE.zone.floor);
      expect(seen.lowest).toBeGreaterThan(centre.y + 26);
      start.forEach((d) => {
        expect(d.y).toBeGreaterThanOrEqual(centre.y + 18);
        expect(d.y).toBeLessThanOrEqual(centre.y + 26);
        expect(Math.abs(d.x - centre.x)).toBeLessThanOrEqual(26);
      });
      expect(scene.drips()).toHaveLength(0);
    });

    it('wait their own time before they run', () => {
      const scene = mounted(WIDE, half);

      scene.step(FRAME, AWAY);
      const start = scene.drips().map((d) => d.y);

      // With half() every drip waits 0.725s.
      Array.from({ length: 40 }).forEach(() => scene.step(FRAME, AWAY));
      const held = scene.drips().map((d) => d.y);

      Array.from({ length: 10 }).forEach(() => scene.step(FRAME, AWAY));
      const running = scene.drips().map((d) => d.y);

      expect(held).toEqual(start);
      running.forEach((y, i) => expect(y).toBeGreaterThan(start[i]));
    });

    it('stop a head short of the floor, so the round end stays inside the zone', () => {
      // Every draw at its top: the drips start lowest, run longest and are widest (r just under 6).
      const scene = mounted(WIDE, () => 0.999);
      const seen = { lowest: 0, steps: 0 };

      scene.step(FRAME, AWAY);
      while (scene.drips().length > 0 && seen.steps < 1200) {
        scene.step(FRAME, AWAY);
        seen.lowest = Math.max(seen.lowest, ...scene.drips().map((d) => d.y));
        seen.steps += 1;
      }

      // They stop once past floor - r - 3. Their length alone would carry them to floor - 4.
      expect(seen.lowest).toBeLessThan(WIDE.zone.floor - 6);
      expect(seen.lowest).toBeGreaterThan(WIDE.zone.floor - 12);
    });

    it('leave a trail of ink under the splat', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      scene.step(FRAME, AWAY);
      const before = scene.isWet(centre.x, centre.y + 60);

      settle(scene);

      // With half() the middle drip starts 22px under the centre and runs 0.65 of the room.
      expect(scene.isWet(centre.x, centre.y + 60)).toBe(true);
      expect(before).toBe(false);
    });
  });

  describe('rest', () => {
    it('comes to rest within a few seconds with the pointer outside', () => {
      const times = [1, 2, 3, 4, 5].map((seed) => settle(mounted(WIDE, seeded(seed))));
      const scene = mounted(WIDE, seeded(1));

      settle(scene);

      expect(Math.max(...times)).toBeLessThan(10);
      expect(scene.step(FRAME, AWAY)).toBe(false);
      expect(scene.droplets()).toHaveLength(0);
      expect(scene.drips()).toHaveLength(0);
    });

    it('stays awake while the pointer is over the canvas', () => {
      const scene = mounted(WIDE, seeded(1));

      settle(scene);

      expect(scene.step(FRAME, at(700, 20))).toBe(true);
    });
  });

  describe.each([
    ['wide', WIDE],
    ['narrow', NARROW],
  ])('the zone, %s layout', (_name, layout) => {
    it('holds all the ink, from the burst and from a smear dragged across its edges', () => {
      const scene = mounted(layout, seeded(7));
      const centre = centreOf(layout);

      settle(scene);
      drag(scene, centre, -12, 0, 30);
      drag(scene, centre, 0, 12, 20);
      const wet = wetPoints(scene, layout);

      expect(wet.filter((p) => !inZone(layout, p))).toHaveLength(0);
      expect(wet.length).toBeGreaterThan(1000);
    });

    it('clips the stain canvas to the zone', () => {
      const stain = recorder();

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stain.ctx);
      mounted(layout, seeded(7));
      const { zone, scale } = layout;
      const names = stain.calls.map((call) => call[0]);

      expect(named(stain.calls, 'rect')).toEqual([['rect', zone.x, zone.y, zone.width, zone.floor - zone.y]]);
      expect(names.indexOf('clip')).toBeGreaterThan(names.indexOf('rect'));
      expect(stain.calls).toContainEqual(['setTransform', scale, 0, 0, scale, 0, 0]);
    });
  });

  describe('a zone that ends before the canvas does', () => {
    it('keeps a smear dragged over its right edge inside', () => {
      const layout: SceneLayout = { width: 400, height: 200, zone: { x: 0, y: 0, width: 200, floor: 200 }, scale: 1 };
      const scene = mounted(layout, half);
      const centre = centreOf(layout);

      settle(scene);
      drag(scene, centre, 10, 0, 20);
      const wet = wetPoints(scene, layout);

      expect(wet.filter((p) => !inZone(layout, p))).toHaveLength(0);
      expect(scene.isWet(centre.x + 90, centre.y)).toBe(true);
    });
  });

  describe('the stain canvas', () => {
    it('is sized to the backing store', () => {
      const scene = mounted(WIDE, seeded(1));
      const rec = recorder();

      scene.step(FRAME, AWAY);
      scene.paint(rec.ctx, COLORS);
      const stain = named(rec.calls, 'drawImage')[0][1];

      expect(stain).toBeInstanceOf(HTMLCanvasElement);
      expect(stain).toMatchObject({ width: 1536, height: 432 });
    });

    it('gets every stamp, in one opaque colour', () => {
      const stain = recorder();

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stain.ctx);
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      scene.step(FRAME, AWAY);
      const arcs = named(stain.calls, 'arc');

      // The core, then 11 lobes.
      expect(arcs).toHaveLength(12);
      expect(arcs[0]).toEqual(['arc', centre.x, centre.y, 27, 0, TAU]);
      expect(arcs[1]).toEqual(['arc', centre.x + 23, centre.y, 11.5, 0, TAU]);
      expect(named(stain.calls, 'fill')).toHaveLength(12);
      expect(named(stain.calls, 'set fillStyle')).toEqual([['set fillStyle', '#000']]);
      expect(named(stain.calls, 'getImageData')).toHaveLength(0);
    });

    it('is wiped by reset()', () => {
      const stain = recorder();

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stain.ctx);
      const scene = mounted(WIDE, half);

      settle(scene);
      stain.calls.length = 0;
      scene.reset();

      expect(stain.calls.slice(0, 2)).toEqual([
        ['setTransform', 1, 0, 0, 1, 0, 0],
        ['clearRect', 0, 0, 1536, 432],
      ]);
    });
  });

  describe('smear', () => {
    it('drags ink out of the wet centre along the pointer path, until the finger runs dry', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      settle(scene);
      const before = [60, 100, 160].map((dx) => scene.isWet(centre.x + dx, centre.y));

      // 10px a frame. The last wet read is 30px out, so the lab's 150px of ink ends near 180px.
      drag(scene, centre, 10, 0, 20);

      expect([60, 100, 140, 160].map((dx) => scene.isWet(centre.x + dx, centre.y))).toEqual([true, true, true, true]);
      expect([192, 196, 200].map((dx) => scene.isWet(centre.x + dx, centre.y))).toEqual([false, false, false]);
      expect(before).toEqual([false, false, false]);
    });

    it('thins the smear as the finger dries', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      settle(scene);
      drag(scene, centre, 10, 0, 20);

      // Radius is 1.4 + 6.5 * wetness: about 6px at 60px out, about 2px at 160px.
      expect(scene.isWet(centre.x + 60, centre.y + 5)).toBe(true);
      expect(scene.isWet(centre.x + 160, centre.y + 5)).toBe(false);
    });

    it('leaves nothing when the pointer never touched ink', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      settle(scene);
      const before = wetPoints(scene, WIDE).length;

      drag(scene, { x: centre.x + 60, y: centre.y - 40 }, 10, 0, 12);

      expect(wetPoints(scene, WIDE)).toHaveLength(before);
    });

    it('dries the finger when the pointer leaves', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      settle(scene);
      drag(scene, centre, 10, 0, 5);
      scene.step(FRAME, AWAY);
      drag(scene, { x: centre.x + 60, y: centre.y - 40 }, 10, 0, 10);

      expect(scene.isWet(centre.x + 100, centre.y - 40)).toBe(false);
      expect(scene.isWet(centre.x + 45, centre.y)).toBe(true);
    });

    it('does not take the pointer on the frame of the break as a first touch', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      scene.step(FRAME, at(centre.x, centre.y));
      scene.step(FRAME, at(centre.x + 60, centre.y));

      expect(scene.isWet(centre.x + 50, centre.y)).toBe(false);
    });
  });

  describe('reset()', () => {
    it('clears everything and plays the break again', () => {
      const scene = mounted(WIDE, seeded(5));
      const rec = recorder();
      const centre = centreOf(WIDE);

      scene.step(FRAME, AWAY);
      scene.step(FRAME, AWAY);
      scene.reset();
      scene.paint(rec.ctx, COLORS);

      expect(wetPoints(scene, WIDE)).toHaveLength(0);
      expect(scene.droplets()).toHaveLength(0);
      expect(scene.drips()).toHaveLength(0);
      expect(named(rec.calls, 'arc')).toEqual([['arc', centre.x, centre.y, 27, 0, TAU]]);

      scene.step(FRAME, AWAY);

      expect(scene.droplets()).toHaveLength(56);
    });

    it('dries the finger', () => {
      const scene = mounted(WIDE, half);
      const centre = centreOf(WIDE);

      settle(scene);
      drag(scene, centre, 10, 0, 5);
      scene.reset();
      // The pointer never leaves: only reset() can dry the finger and forget its last place.
      drag(scene, { x: centre.x + 60, y: centre.y - 40 }, 10, 0, 10);

      expect(scene.isWet(centre.x + 55, centre.y - 20)).toBe(false);
      expect(scene.isWet(centre.x + 100, centre.y - 40)).toBe(false);
    });
  });

  describe('random', () => {
    it('gives the same scene for the same source', () => {
      const one = mounted(NARROW, seeded(9));
      const two = mounted(NARROW, seeded(9));
      const other = mounted(NARROW, seeded(10));

      [one, two, other].forEach((scene) => Array.from({ length: 12 }).forEach(() => scene.step(FRAME, AWAY)));

      expect(one.droplets()).toEqual(two.droplets());
      expect(one.drips()).toEqual(two.drips());
      expect(one.droplets()).not.toEqual(other.droplets());

      [one, two].forEach((scene) => settle(scene));

      expect(wetPoints(one, NARROW)).toEqual(wetPoints(two, NARROW));
    });

    it('never calls Math.random when a source is passed', () => {
      const spy = vi.spyOn(Math, 'random');
      const scene = mounted(WIDE, seeded(1));

      settle(scene);

      expect(spy).not.toHaveBeenCalled();
    });

    it('falls back to Math.random', () => {
      const spy = vi.spyOn(Math, 'random');
      const scene = createInkBurst();

      scene.layout(WIDE);
      scene.reset();
      scene.step(FRAME, AWAY);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('paint()', () => {
    it('draws the stain in the ink colour, then the flying droplets', () => {
      const scene = mounted(WIDE, half);
      const rec = recorder();

      scene.step(FRAME, AWAY);
      scene.paint(rec.ctx, COLORS);
      const names = rec.calls.map((call) => call[0]);

      expect(rec.calls.slice(0, 5)).toEqual([
        ['set fillStyle', COLORS.ink],
        ['drawImage', expect.any(HTMLCanvasElement), 0, 0, 768, 216],
        ['set globalCompositeOperation', 'source-in'],
        ['fillRect', 0, 0, 768, 216],
        ['set globalCompositeOperation', 'source-over'],
      ]);
      // With half() all drips still wait, so only the 56 droplets are drawn.
      expect(named(rec.calls, 'arc')).toHaveLength(56);
      expect(named(rec.calls, 'arc')[0].slice(3)).toEqual([2.975, 0, TAU]);
      expect(names.filter((name) => name === 'fill')).toHaveLength(56);
    });

    it('draws a drip head only once the drip runs', () => {
      const scene = mounted(WIDE, half);
      const waiting = recorder();
      const running = recorder();

      scene.step(FRAME, AWAY);
      // Droplets land within 0.7s; with half() the drips start at 0.725s.
      Array.from({ length: 43 }).forEach(() => scene.step(FRAME, AWAY));
      scene.paint(waiting.ctx, COLORS);
      Array.from({ length: 5 }).forEach(() => scene.step(FRAME, AWAY));
      scene.paint(running.ctx, COLORS);

      expect(named(running.calls, 'arc')).toHaveLength(5);
      expect(named(running.calls, 'arc')[0][3]).toBeCloseTo(4.8, 6);
      expect(named(waiting.calls, 'arc')).toHaveLength(0);
    });

    it('repaints in a new ink colour after a theme change', () => {
      const scene = mounted(WIDE, half);
      const rec = recorder();

      settle(scene);
      scene.paint(rec.ctx, { ...COLORS, ink: 'rgb(240, 240, 240)' });

      expect(rec.calls[0]).toEqual(['set fillStyle', 'rgb(240, 240, 240)']);
      expect(named(rec.calls, 'fillRect')).toEqual([['fillRect', 0, 0, 768, 216]]);
    });
  });

  describe('paintOverlay()', () => {
    it('draws the glint up and left of the centre', () => {
      const scene = mounted(WIDE, half);
      const rec = recorder();
      const centre = centreOf(WIDE);

      scene.paintOverlay(rec.ctx, COLORS);

      expect(rec.calls).toEqual([
        ['set fillStyle', 'rgba(255, 255, 255, 0.5)'],
        ['save'],
        ['translate', centre.x - 9, centre.y - 13],
        ['rotate', -0.7],
        ['beginPath'],
        ['ellipse', 0, 0, 7.5, 2.6, 0, 0, TAU],
        ['fill'],
        ['restore'],
      ]);
    });
  });
});

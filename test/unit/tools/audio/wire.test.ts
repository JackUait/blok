import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listener = { read: vi.fn<() => { bytes: Uint8Array; hzPerBin: number } | null>(() => null), destroy: vi.fn() };
const core = { step: vi.fn(() => ({ level: 0.9, bass: 0, mid: 0, kick: 1, snare: 0, hat: 0 })) };
const motionReader = { read: vi.fn(() => ({ level: 0.5, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 })) };
const peaksReader = { read: vi.fn(() => ({ level: 0.2, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 })) };

vi.mock('../../../../src/tools/audio/listen', () => ({ createListener: vi.fn(() => listener) }));
vi.mock('../../../../src/tools/audio/motion', () => ({
  bandsFromSpectrum: vi.fn(() => [0, 0, 0, 0, 0, 0, 0]),
  createSignalCore: vi.fn(() => core),
  decodeMotion: vi.fn((encoded: string) => (encoded === 'bad' ? null : { events: [], bass: [], mid: [], level: [] })),
  createMotionReader: vi.fn(() => motionReader),
  createPeaksReader: vi.fn(() => peaksReader),
}));

import { attachWire, createWireMotion, paintWire, wireOffset, WIRE_BEAD_RADIUS, WIRE_INSET } from '../../../../src/tools/audio/wire';

interface Call { name: string; args: number[]; stroke: string; fill: string }

/** Records the calls the painter makes, with the colours set at that moment. */
const fakeContext = (): { ctx: CanvasRenderingContext2D; calls: Call[] } => {
  const calls: Call[] = [];
  const state = { strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '', lineJoin: '' };
  const record = (name: string) => (...args: number[]): void => {
    calls.push({ name, args, stroke: state.strokeStyle, fill: state.fillStyle });
  };
  const ctx = Object.assign(state, {
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    rect: record('rect'),
    clip: record('clip'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    fill: record('fill'),
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
  });

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
};

const REST = { hum: 0, swing: 0, ripple: 0, slowPhase: 0, finePhase: 0 };
const LOUD = { hum: 1, swing: 1, ripple: 1, slowPhase: 3.7, finePhase: 1.3 };
const FRAME = 1 / 60;
const QUIET = { level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 };
const tallest = (motion: Parameters<typeof wireOffset>[1]): number =>
  Math.max(...Array.from({ length: 121 }, (_, i) => Math.abs(wireOffset(i / 120, motion))));

describe('wireOffset', () => {
  it('is flat at every point while nothing plays', () => {
    const offsets = Array.from({ length: 21 }, (_, i) => wireOffset(i / 20, REST));

    expect(offsets.every((y) => y === 0)).toBe(true);
  });

  it('is pinned at both ends however hard the track hits', () => {
    expect(Math.abs(wireOffset(0, LOUD))).toBeLessThan(1e-9);
    expect(Math.abs(wireOffset(1, LOUD))).toBeLessThan(1e-9);
  });

  it('moves in the middle on a full hit, within 12px', () => {
    expect(tallest(LOUD)).toBeGreaterThan(4);
    expect(tallest(LOUD)).toBeLessThanOrEqual(12);
  });
});

describe('createWireMotion', () => {
  /** Runs `seconds` of frames; `at(i)` gives the signals of frame i. */
  const run = (motion: ReturnType<typeof createWireMotion>, seconds: number, at: (frame: number) => typeof QUIET | null): ReturnType<ReturnType<typeof createWireMotion>['step']> => {
    const frames = Math.round(seconds / FRAME);

    return Array.from({ length: frames }, (_, i) => motion.step(at(i), FRAME))[frames - 1];
  };
  const hit = (kick: number) => (frame: number): typeof QUIET => ({ ...QUIET, level: 1, kick: frame === 0 ? kick : 0 });

  it('a loud track with no hits only hums: the line stays within 2px', () => {
    const motion = createWireMotion();
    const after = run(motion, 3, () => ({ ...QUIET, level: 1 }));

    expect(tallest(after)).toBeGreaterThan(0.5);
    expect(tallest(after)).toBeLessThanOrEqual(2);
  });

  it('a strong hit swings the line, and it calms before a second passes', () => {
    const motion = createWireMotion();
    const struck = run(motion, 0.1, hit(0.75));
    const later = run(motion, 0.8, () => ({ ...QUIET, level: 1 }));

    expect(struck.swing).toBeGreaterThan(0.5);
    expect(later.swing).toBeLessThan(struck.swing * 0.2);
  });

  it('a weak hit moves the line far less than a strong one', () => {
    const strong = run(createWireMotion(), 0.1, hit(0.75)).swing;
    const weak = run(createWireMotion(), 0.1, hit(0.45)).swing;

    expect(weak).toBeLessThan(strong / 3);
  });

  it('the wave runs faster on a hit than between hits', () => {
    const motion = createWireMotion();
    const start = run(motion, 0.5, () => ({ ...QUIET, level: 1 })).slowPhase;
    const idle = run(motion, 0.2, () => ({ ...QUIET, level: 1 })).slowPhase - start;
    const before = motion.step({ ...QUIET, level: 1, kick: 0.8 }, FRAME).slowPhase;
    const onHit = run(motion, 0.2, () => ({ ...QUIET, level: 1 })).slowPhase - before;

    expect(onHit).toBeGreaterThan(idle * 2);
  });

  it('snares and hats ripple the line without swinging it', () => {
    const motion = createWireMotion();
    const after = run(motion, 0.1, (frame) => ({ ...QUIET, level: 1, snare: frame === 0 ? 0.8 : 0 }));

    expect(after.ripple).toBeGreaterThan(0.3);
    expect(after.swing).toBeLessThan(0.01);
  });

  it('lies exactly flat once the track stops', () => {
    const motion = createWireMotion();

    run(motion, 0.2, hit(0.9));
    expect(motion.atRest()).toBe(false);

    const after = run(motion, 4, () => null);

    expect(motion.atRest()).toBe(true);
    expect(tallest(after)).toBe(0);
  });
});

describe('paintWire', () => {
  const paint = (progress: number, signals = REST): Call[] => {
    const { ctx, calls } = fakeContext();

    paintWire(ctx, { width: 208, height: 40, progress, ...signals, ink: 'INK', rest: 'REST' });

    return calls;
  };

  it('puts the bead on the line at the playhead', () => {
    const arc = paint(0.25).find((c) => c.name === 'arc');

    expect(arc?.args.slice(0, 3)).toEqual([WIRE_INSET + 0.25 * (208 - 2 * WIRE_INSET), 20, WIRE_BEAD_RADIUS]);
    expect(arc?.fill).toBe('INK');
  });

  it('draws the part after the playhead in the rest colour and the played part in ink', () => {
    const calls = paint(0.5);
    const headX = WIRE_INSET + 0.5 * 200;
    const clips = calls.filter((c) => c.name === 'rect').map((c) => c.args);
    const strokes = calls.filter((c) => c.name === 'stroke').map((c) => c.stroke);

    expect(clips).toEqual([[headX, 0, 208 - headX, 40], [0, 0, headX, 40]]);
    expect(strokes).toEqual(['REST', 'INK']);
  });

  it('runs the line from inset to inset, flat at rest', () => {
    const points = paint(0).filter((c) => c.name === 'lineTo').map((c) => c.args);

    expect(points[0]).toEqual([WIRE_INSET, 20]);
    expect(points.every(([, y]) => y === 20)).toBe(true);
    expect(Math.max(...points.map(([x]) => x))).toBe(208 - WIRE_INSET);
  });

  it('lifts the bead with the line on a hit', () => {
    const arc = paint(0.4, LOUD).find((c) => c.name === 'arc');

    expect(arc?.args[1]).toBeCloseTo(20 + wireOffset(0.4, LOUD), 6);
  });
});

const frames: FrameRequestCallback[] = [];
const runFrame = (now: number): void => {
  const next = frames.shift();

  if (next) next(now);
};

describe('attachWire', () => {
  const contexts: Array<ReturnType<typeof fakeContext>> = [];

  const setup = (opts: { motion?: string; peaks?: number[] } = {}): { mount: HTMLElement; media: HTMLAudioElement; canvas: HTMLCanvasElement; destroy(): void; beadY(): number | undefined } => {
    const mount = document.createElement('div');
    const media = document.createElement('audio');

    document.body.append(mount);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const made = fakeContext();

      contexts.push(made);

      return made.ctx;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(208);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
    Object.defineProperties(media, {
      duration: { configurable: true, get: () => 100 },
      currentTime: { configurable: true, writable: true, value: 25 },
    });

    const handle = attachWire({ mount, media, ...opts });
    const canvas = mount.querySelector('canvas');

    if (!canvas) throw new Error('no wire canvas');

    return {
      mount,
      media,
      canvas,
      destroy: handle.destroy,
      beadY: () => contexts.flatMap((c) => c.calls).filter((c) => c.name === 'arc').pop()?.args[1],
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    frames.length = 0;
    contexts.length = 0;
    listener.read.mockReturnValue(null);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('mounts a decorative canvas and paints the flat line with the bead at the playhead', () => {
    const { canvas } = setup();
    const arc = contexts.flatMap((c) => c.calls).find((c) => c.name === 'arc');

    expect(canvas.getAttribute('data-role')).toBe('audio-wire');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.width).toBe(416);
    expect(canvas.height).toBe(80);
    expect(arc?.args.slice(0, 2)).toEqual([WIRE_INSET + 0.25 * 200, 20]);
    expect(frames).toHaveLength(0);
  });

  it('hums while the track plays', () => {
    const { media, beadY } = setup({ peaks: [0.5, 0.9] });

    media.dispatchEvent(new Event('play'));
    runFrame(1000);
    runFrame(1016);
    runFrame(1032);

    expect(peaksReader.read).toHaveBeenCalled();
    expect(beadY()).not.toBe(20);
    expect(frames).toHaveLength(1);
  });

  it('prefers saved motion over peaks, and live listening over both', () => {
    const { media } = setup({ motion: 'ok', peaks: [0.5] });

    media.dispatchEvent(new Event('play'));
    runFrame(1000);
    runFrame(1016);
    expect(motionReader.read).toHaveBeenCalled();
    expect(peaksReader.read).not.toHaveBeenCalled();

    motionReader.read.mockClear();
    listener.read.mockReturnValue({ bytes: new Uint8Array(4), hzPerBin: 20 });
    runFrame(1032);
    expect(core.step).toHaveBeenCalled();
    expect(motionReader.read).not.toHaveBeenCalled();
  });

  it('settles flat after pause, then stops asking for frames', () => {
    const { media, beadY } = setup({ peaks: [0.5] });

    media.dispatchEvent(new Event('play'));
    runFrame(1000);
    runFrame(1016);
    media.dispatchEvent(new Event('pause'));
    // Still moving right after the pause.
    runFrame(1032);
    expect(frames).toHaveLength(1);

    Array.from({ length: 200 }, (_, i) => runFrame(1048 + i * 16));

    expect(frames).toHaveLength(0);
    expect(beadY()).toBe(20);
  });

  it('follows the playhead while paused', () => {
    const { media } = setup();

    media.currentTime = 50;
    media.dispatchEvent(new Event('timeupdate'));

    const arc = contexts.flatMap((c) => c.calls).filter((c) => c.name === 'arc').pop();

    expect(arc?.args[0]).toBe(WIRE_INSET + 0.5 * 200);
  });

  it('never animates under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { media } = setup({ peaks: [0.5] });

    media.dispatchEvent(new Event('play'));

    expect(frames).toHaveLength(0);
  });

  it('destroy removes the canvas, stops the loop and stops listening', () => {
    const { mount, media, destroy } = setup({ peaks: [0.5] });

    media.dispatchEvent(new Event('play'));
    destroy();
    media.dispatchEvent(new Event('play'));

    expect(mount.querySelector('canvas')).toBeNull();
    expect(frames).toHaveLength(0);
    expect(listener.destroy).toHaveBeenCalledTimes(1);
  });
});

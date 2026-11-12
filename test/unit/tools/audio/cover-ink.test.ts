import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const drop = { step: vi.fn(), shape: vi.fn(() => ({ radii: new Float32Array(96), cx: 22, cy: 22, balls: [] })), atRest: vi.fn(() => true) };
const listener = { read: vi.fn<() => { bytes: Uint8Array; hzPerBin: number } | null>(() => null), destroy: vi.fn() };
const core = { step: vi.fn(() => ({ level: 0.9, bass: 0, mid: 0, kick: 1, snare: 0, hat: 0 })) };
const motionReader = { read: vi.fn(() => ({ level: 0.5, bass: 0, mid: 0, kick: 0, snare: 1, hat: 0 })) };
const peaksReader = { read: vi.fn(() => ({ level: 0.2, bass: 0, mid: 0, kick: 0, snare: 0, hat: 1 })) };

vi.mock('../../../../src/tools/audio/ink', () => ({ createInkDrop: vi.fn(() => drop) }));
vi.mock('../../../../src/tools/audio/ink-paint', () => ({ paintInk: vi.fn() }));
vi.mock('../../../../src/tools/audio/listen', () => ({ createListener: vi.fn(() => listener) }));
vi.mock('../../../../src/tools/audio/motion', () => ({
  bandsFromSpectrum: vi.fn(() => [0, 0, 0, 0, 0, 0, 0]),
  createSignalCore: vi.fn(() => core),
  decodeMotion: vi.fn((encoded: string) => (encoded === 'bad' ? null : { events: [], bass: [], mid: [], level: [] })),
  createMotionReader: vi.fn(() => motionReader),
  createPeaksReader: vi.fn(() => peaksReader),
}));

import { attachInkCover } from '../../../../src/tools/audio/cover-ink';
import { paintInk } from '../../../../src/tools/audio/ink-paint';

const frames: FrameRequestCallback[] = [];
const runFrame = (now: number): void => {
  const next = frames.shift();

  if (next) next(now);
};

const setup = (opts: { motion?: string; peaks?: number[] } = {}): { canvas: HTMLCanvasElement; media: HTMLAudioElement; destroy(): void } => {
  const canvas = document.createElement('canvas');

  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 44 });
  vi.spyOn(canvas, 'getContext').mockReturnValue({} as unknown as CanvasRenderingContext2D);
  document.body.append(canvas);
  const media = document.createElement('audio');
  const handle = attachInkCover({ canvas, media, ...opts });

  return { canvas, media, destroy: handle.destroy };
};

describe('attachInkCover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames.length = 0;
    drop.atRest.mockReturnValue(true);
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

  it('paints the resting drop at the canvas size times the pixel ratio', () => {
    const { canvas } = setup();

    expect(paintInk).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(88);
    expect(canvas.height).toBe(88);
    expect(frames).toHaveLength(0);
  });

  it('feeds the drop from the live sound when the listener hears it', () => {
    const { media } = setup({ motion: 'ok', peaks: [0.5] });

    listener.read.mockReturnValue({ bytes: new Uint8Array(4), hzPerBin: 20 });
    media.dispatchEvent(new Event('play'));
    runFrame(1000);
    runFrame(1016);

    expect(drop.step).toHaveBeenLastCalledWith(expect.objectContaining({ kick: 1 }), expect.any(Number));
    expect(motionReader.read).not.toHaveBeenCalled();
  });

  it('falls back to saved motion when it cannot listen', () => {
    const { media } = setup({ motion: 'ok', peaks: [0.5] });

    media.dispatchEvent(new Event('play'));
    runFrame(1000);
    runFrame(1016);

    expect(drop.step).toHaveBeenLastCalledWith(expect.objectContaining({ snare: 1 }), expect.any(Number));
    expect(peaksReader.read).not.toHaveBeenCalled();
  });

  it('falls back to the stored loudness when the saved motion is missing or broken', () => {
    const { media } = setup({ motion: 'bad', peaks: [0.5] });

    media.dispatchEvent(new Event('play'));
    runFrame(1000);
    runFrame(1016);

    expect(drop.step).toHaveBeenLastCalledWith(expect.objectContaining({ hat: 1 }), expect.any(Number));
  });

  it('gives the drop silence when there is nothing to read', () => {
    const { media } = setup();

    media.dispatchEvent(new Event('play'));
    runFrame(1000);

    expect(drop.step).toHaveBeenLastCalledWith({ level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 }, expect.any(Number));
  });

  it('keeps drawing after pause until the drop has settled, then stops', () => {
    const { media } = setup({ motion: 'ok' });

    drop.atRest.mockReturnValue(false);
    media.dispatchEvent(new Event('play'));
    runFrame(1000);
    media.dispatchEvent(new Event('pause'));
    runFrame(1016);

    expect(drop.step).toHaveBeenLastCalledWith({ level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 }, expect.any(Number));
    expect(frames).toHaveLength(1);

    drop.atRest.mockReturnValue(true);
    runFrame(1032);

    expect(frames).toHaveLength(0);
  });

  it('holds still under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { media } = setup({ motion: 'ok' });

    media.dispatchEvent(new Event('play'));

    expect(frames).toHaveLength(0);
    expect(drop.step).not.toHaveBeenCalled();
  });

  it('stops everything on destroy', () => {
    const { media, destroy } = setup({ motion: 'ok' });

    drop.atRest.mockReturnValue(false);
    media.dispatchEvent(new Event('play'));
    destroy();
    media.dispatchEvent(new Event('play'));

    expect(frames).toHaveLength(0);
    expect(listener.destroy).toHaveBeenCalledTimes(1);
  });
});

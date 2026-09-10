import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  attachWaveform,
  computePeaks,
  decodePeaks,
  peaksFromAudioBuffer,
  ratioFromPointer,
  type WaveformHandle,
} from '../../../../src/tools/audio/waveform';
import { entranceEase, headColorBlend, liveAmplitude } from '../../../../src/tools/audio/liveliness';

/**
 * Fixture rules this file depends on — change one and the arithmetic mutants
 * below stop being observable:
 *  - PEAKS is asymmetric and its length (7) does not divide the sample counts
 *    used for computePeaks, so bucket boundaries and the last partial bucket
 *    are visible.
 *  - LEFT is non-zero, so `clientX - rect.left` differs from `clientX + rect.left`.
 *  - DPR is 2, so `rect.width * dpr` differs from `rect.width / dpr`.
 *  - DURATION/CURRENT put the playhead exactly on bar 3, so `<` and `<=` split
 *    the played/unplayed colours differently.
 */
const PEAKS = [0.125, 0.5, 1, 0.25, 0.75, 0.375, 0.625];
const WIDTH = 70;
const HEIGHT = 40;
const LEFT = 12;
const DPR = 2;
const DURATION = 70;
const CURRENT = 30;
const PLAYHEAD = 3;
const SLOT = 10;
const BAR_W = 8;
const RADIUS = 2;
const SETTLE_MS = 420;
const ENTRANCE_MS = 650;
const PLAYED = '#0a0b0c';
const BASE = '#f1f2f3';
const HEAD = '#445566';

interface Paint {
  shape: 'roundRect' | 'fillRect';
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number | null;
  fillStyle: string;
  alpha: number;
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  paints: Paint[];
  calls: string[];
  transforms: number[][];
  clears: number[][];
}

interface FakeContext {
  fillStyle: string;
  globalAlpha: number;
  setTransform: (...args: number[]) => void;
  clearRect: (...args: number[]) => void;
  beginPath: () => void;
  fill: () => void;
  save: () => void;
  restore: () => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  roundRect?: (x: number, y: number, w: number, h: number, radius: number) => void;
}

/**
 * save()/restore() model a real stack: a dropped restore leaks the head tint's
 * alpha into the next bar's record, which is what makes the missing-restore
 * mutant visible as data rather than as a "was called" spy.
 */
const createRecorder = (withRoundRect: boolean): Recorder => {
  const paints: Paint[] = [];
  const calls: string[] = [];
  const transforms: number[][] = [];
  const clears: number[][] = [];
  const stack: Array<{ fillStyle: string; alpha: number }> = [];
  const state = { fillStyle: '', alpha: 1 };
  const record = (shape: Paint['shape'], x: number, y: number, w: number, h: number, radius: number | null): void => {
    paints.push({ shape, x, y, w, h, radius, fillStyle: state.fillStyle, alpha: state.alpha });
  };
  const impl: FakeContext = {
    get fillStyle(): string { return state.fillStyle; },
    set fillStyle(value: string) { state.fillStyle = value; },
    get globalAlpha(): number { return state.alpha; },
    set globalAlpha(value: number) { state.alpha = value; },
    setTransform: (...args: number[]): void => { calls.push('setTransform'); transforms.push(args); },
    clearRect: (...args: number[]): void => { calls.push('clearRect'); clears.push(args); },
    beginPath: (): void => { calls.push('beginPath'); },
    fill: (): void => { calls.push('fill'); },
    save: (): void => { calls.push('save'); stack.push({ ...state }); },
    restore: (): void => {
      calls.push('restore');
      const previous = stack.pop();
      if (previous !== undefined) {
        state.fillStyle = previous.fillStyle;
        state.alpha = previous.alpha;
      }
    },
    fillRect: (x: number, y: number, w: number, h: number): void => {
      calls.push('fillRect');
      record('fillRect', x, y, w, h, null);
    },
    roundRect: (x: number, y: number, w: number, h: number, radius: number): void => {
      calls.push('roundRect');
      record('roundRect', x, y, w, h, radius);
    },
  };
  if (!withRoundRect) {
    delete impl.roundRect;
  }

  return { ctx: impl as unknown as CanvasRenderingContext2D, paints, calls, transforms, clears };
};

const makeRect = (width: number, height: number, left = LEFT): DOMRect => ({
  x: left,
  y: 0,
  left,
  top: 0,
  width,
  height,
  right: left + width,
  bottom: height,
  toJSON: () => ({}),
});

interface ObserverEntry {
  cb: ResizeObserverCallback;
  observed: Element[];
  disconnects: number;
}

let observers: ObserverEntry[] = [];

class StubResizeObserver {
  private entry: ObserverEntry;

  public constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, observed: [], disconnects: 0 };
    observers.push(this.entry);
  }

  public observe(target: Element): void { this.entry.observed.push(target); }
  public unobserve(): void { /* unused by the waveform */ }
  public disconnect(): void { this.entry.disconnects += 1; }
}

let rect: DOMRect;
let frames: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextFrameId = 1;
let scheduled = 0;
let cancelled: number[] = [];
let cancelDequeues = true;
let reduced = false;
let cssVars: Record<string, string> = {};
let recorder: Recorder;
let contextAvailable = true;
let clock = 0;
let handles: WaveformHandle[] = [];

const flush = (now: number): void => {
  const batch = frames.splice(0, frames.length);
  for (const frame of batch) frame.cb(now);
};

const observerFor = (target: Element): ObserverEntry => {
  const entry = observers.find((candidate) => candidate.observed.includes(target));
  if (entry === undefined) throw new Error('the canvas was never observed');

  return entry;
};

interface Attached {
  mount: HTMLDivElement;
  media: HTMLAudioElement;
  handle: WaveformHandle;
  canvas: HTMLCanvasElement;
}

const attach = (options: { peaks?: number[]; duration?: number; currentTime?: number } = {}): Attached => {
  const mount = document.createElement('div');
  const media = document.createElement('audio');
  if (options.duration !== undefined) {
    Object.defineProperty(media, 'duration', { value: options.duration, configurable: true });
  }
  if (options.currentTime !== undefined) media.currentTime = options.currentTime;
  const handle = attachWaveform({ mount, media, peaks: options.peaks ?? PEAKS });
  handles.push(handle);
  const canvas = mount.querySelector('canvas');
  if (canvas === null) throw new Error('no canvas was mounted');

  return { mount, media, handle, canvas };
};

/** The bar the waveform paints when nothing is animating: the raw cached peak. */
const staticBar = (peak: number, index: number, playhead = PLAYHEAD): Paint => {
  const h = Math.max(2, peak * HEIGHT * 0.92);

  return {
    shape: 'roundRect',
    x: index * SLOT,
    y: (HEIGHT - h) / 2,
    w: BAR_W,
    h,
    radius: RADIUS,
    fillStyle: index < playhead ? PLAYED : BASE,
    alpha: 1,
  };
};

const staticFrame = (playhead = PLAYHEAD): Paint[] => PEAKS.map((peak, index) => staticBar(peak, index, playhead));

/**
 * The exact paint sequence for an animating frame. It calls the liveliness
 * functions with the arguments waveform.ts is supposed to pass, so a mutant
 * that passes the wrong index, playhead, time, energy or entrance shows up as
 * a different height or a different head-tint alpha.
 */
const liveFrame = (options: { now: number; entranceStart: number; energy: number; playhead?: number }): Paint[] => {
  const playhead = options.playhead ?? PLAYHEAD;
  const timeSeconds = options.now / 1000;
  const entrance = entranceEase((options.now - options.entranceStart) / ENTRANCE_MS);
  const out: Paint[] = [];
  PEAKS.forEach((peak, index) => {
    const amp = liveAmplitude({
      basePeak: peak,
      index,
      playheadIndex: playhead,
      timeSeconds,
      reduced: false,
      energy: options.energy,
    });
    const h = Math.max(2, amp * HEIGHT * 0.92);
    const geometry = { shape: 'roundRect' as const, x: index * SLOT, y: (HEIGHT - h) / 2, w: BAR_W, h, radius: RADIUS };
    out.push({ ...geometry, fillStyle: index < playhead ? PLAYED : BASE, alpha: 1 });
    const blend = headColorBlend({ distance: index - playhead, energy: options.energy, entrance });
    if (blend > 0.001) out.push({ ...geometry, fillStyle: HEAD, alpha: Math.min(1, blend) });
  });

  return out;
};

const pointer = (type: string, clientX: number): MouseEvent =>
  new MouseEvent(type, { clientX, bubbles: true });

beforeEach(() => {
  vi.clearAllMocks();
  observers = [];
  frames = [];
  nextFrameId = 1;
  scheduled = 0;
  cancelled = [];
  cancelDequeues = true;
  reduced = false;
  clock = 0;
  handles = [];
  contextAvailable = true;
  rect = makeRect(WIDTH, HEIGHT);
  recorder = createRecorder(true);
  cssVars = {
    '--blok-audio-bar-played': `  ${PLAYED}  `,
    '--blok-audio-bar': `  ${BASE}  `,
    '--blok-audio-bar-head': `  ${HEAD}  `,
  };

  vi.stubGlobal('devicePixelRatio', DPR);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    scheduled += 1;
    const id = nextFrameId;
    nextFrameId += 1;
    frames.push({ id, cb });

    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    cancelled.push(id);
    if (!cancelDequeues) return;
    const index = frames.findIndex((frame) => frame.id === id);
    if (index >= 0) frames.splice(index, 1);
  });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }));
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string): string => cssVars[name] ?? '',
  }));
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((id: string) => (id === '2d' && contextAvailable ? recorder.ctx : null)) as HTMLCanvasElement['getContext'],
  );
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  for (const handle of handles) {
    try {
      handle.destroy();
    } catch {
      // A mutant can break destroy(); the remaining cleanup still has to run.
    }
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('computePeaks bucket boundaries', () => {
  it('slices each bucket at index x step, so a bucket count that does not divide the channel still walks forward', () => {
    // 7 samples over 3 buckets: step 2.333, boundaries at 0, 2, 4 and a last
    // bucket that runs to the end. Dividing by step instead would pin every
    // start at 0 and make bucket 2 see the global maximum.
    const channel = new Float32Array([0.125, 0.25, 0.5, 0.375, 0.25, 0.0625, 0.1875]);

    expect(computePeaks(channel, 3)).toEqual([0.5, 1, 0.5]);
  });

  it('the trailing partial bucket keeps the samples past the last whole step', () => {
    // The loudest sample sits in the FIRST bucket, so a second bucket that
    // reached back over the whole channel would read 1 instead of 0.5.
    const channel = new Float32Array([1, 0.25, 0.25, 0.25, 0.5]);

    expect(computePeaks(channel, 2)).toEqual([1, 0.5]);
  });
});

describe('peaksFromAudioBuffer channel selection', () => {
  it('a mono buffer is read straight from channel 0, not rebuilt through buffer.length', () => {
    // buffer.length is deliberately shorter than the channel: the mono fast
    // path must bypass the averaging buffer entirely.
    const data = new Float32Array([0.25, 0.125, 0.0625, 0.5, 0.375]);
    const buffer = { numberOfChannels: 1, length: 2, getChannelData: (): Float32Array => data };

    expect(peaksFromAudioBuffer(buffer, 2)).toEqual([0.5, 1]);
  });

  it('a channel-less buffer still reads channel 0 rather than averaging nothing', () => {
    const data = new Float32Array([0.25, 0.125, 0.0625, 0.5, 0.375]);
    const buffer = { numberOfChannels: 0, length: 5, getChannelData: (): Float32Array => data };

    expect(peaksFromAudioBuffer(buffer, 2)).toEqual([0.5, 1]);
  });

  it('keeps the mix at the samples own scale, so full-scale channels cannot overflow it', () => {
    // Float32 tops out at 3.4e38, so two full-scale channels already fill it.
    // Dividing each contribution keeps the mix representable; multiplying turns
    // it into Infinity, and the global-max divide then yields NaN for every
    // bucket instead of a normalised waveform.
    const loud = new Float32Array([3e38, 1e38, 2e38, 3e38]);
    const buffer = {
      numberOfChannels: 2,
      length: 4,
      getChannelData: (): Float32Array => loud,
    };

    expect(peaksFromAudioBuffer(buffer, 2)).toEqual([1, 1]);
  });
});

describe('ratioFromPointer', () => {
  it('maps the offset inside the box, measured from its left edge', () => {
    expect(ratioFromPointer(LEFT + WIDTH / 2, { left: LEFT, width: WIDTH })).toBe(0.5);
  });

  it('a box with no width maps every pointer to the start instead of dividing by zero', () => {
    expect(ratioFromPointer(50, { left: 0, width: 0 })).toBe(0);
  });

  it('clamps to the ends of the box', () => {
    expect(ratioFromPointer(-500, { left: LEFT, width: WIDTH })).toBe(0);
    expect(ratioFromPointer(5000, { left: LEFT, width: WIDTH })).toBe(1);
  });
});

describe('decodePeaks', () => {
  const buffer = {
    numberOfChannels: 1,
    length: 4,
    duration: 12.5,
    getChannelData: (): Float32Array => new Float32Array([0.25, 0.5, 1, 0.125]),
  };
  const file = (): File => new File([new Uint8Array([1, 2, 3, 4])], 'a.mp3', { type: 'audio/mpeg' });

  const fakeContextClass = (decode: () => Promise<unknown>, closes: string[]): unknown =>
    class {
      public decodeAudioData(): Promise<unknown> { return decode(); }
      public close(): Promise<void> { closes.push('close'); return Promise.resolve(); }
    };

  it('decodes through the standard AudioContext and always closes it', async () => {
    const closes: string[] = [];
    vi.stubGlobal('AudioContext', fakeContextClass(() => Promise.resolve(buffer), closes));

    const decoded = await decodePeaks(file());

    expect(decoded?.duration).toBe(12.5);
    expect(decoded?.peaks).toHaveLength(300);
    expect(Math.max(...(decoded?.peaks ?? []))).toBe(1);
    expect(closes).toEqual(['close']);
  });

  it('falls back to the prefixed webkit constructor', async () => {
    const closes: string[] = [];
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', fakeContextClass(() => Promise.resolve(buffer), closes));

    const decoded = await decodePeaks(file());

    expect(decoded?.duration).toBe(12.5);
    expect(closes).toEqual(['close']);
  });

  it('resolves to null when decoding throws, after closing the context', async () => {
    const closes: string[] = [];
    vi.stubGlobal('AudioContext', fakeContextClass(() => Promise.reject(new Error('bad frame')), closes));

    await expect(decodePeaks(file())).resolves.toBeNull();
    expect(closes).toEqual(['close']);
  });

  it('resolves to null when the environment has no AudioContext at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);

    await expect(decodePeaks(file())).resolves.toBeNull();
  });
});

describe('attachWaveform mounting', () => {
  it('mounts a tagged, classed canvas inside the given host', () => {
    const { mount, canvas } = attach({ duration: DURATION, currentTime: CURRENT });

    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.getAttribute('data-role')).toBe('audio-waveform-canvas');
    expect(canvas.className).toBe('blok-audio-waveform__canvas');
    expect(canvas.parentElement).toBe(mount);
  });
});

describe('attachWaveform first paint', () => {
  it('paints every bar at its own slot, split at the playhead', () => {
    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.paints).toEqual(staticFrame());
  });

  it('draws rounded bars: one path per bar, filled once', () => {
    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.calls.filter((call) => call === 'beginPath')).toHaveLength(PEAKS.length);
    expect(recorder.calls.filter((call) => call === 'roundRect')).toHaveLength(PEAKS.length);
    expect(recorder.calls.filter((call) => call === 'fill')).toHaveLength(PEAKS.length);
    expect(recorder.calls).not.toContain('fillRect');
  });

  it('falls back to square bars when the context has no roundRect', () => {
    recorder = createRecorder(false);

    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.paints).toEqual(staticFrame().map((paint) => ({ ...paint, shape: 'fillRect' as const, radius: null })));
    expect(recorder.calls).not.toContain('beginPath');
  });

  it('scales the transform and clears the whole box in CSS pixels', () => {
    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.transforms).toEqual([[DPR, 0, 0, DPR, 0, 0]]);
    expect(recorder.clears).toEqual([[0, 0, WIDTH, HEIGHT]]);
  });

  it('sizes the backing store to the box times the device pixel ratio', () => {
    const { canvas } = attach({ duration: DURATION, currentTime: CURRENT });

    expect(canvas.width).toBe(WIDTH * DPR);
    expect(canvas.height).toBe(HEIGHT * DPR);
  });

  it('paints nothing while the canvas has no box', () => {
    rect = makeRect(0, HEIGHT);
    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.paints).toEqual([]);
  });

  it('paints nothing while the canvas box has no height', () => {
    rect = makeRect(WIDTH, 0);
    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.paints).toEqual([]);
  });

  it('survives a canvas that hands back no 2d context', () => {
    contextAvailable = false;

    expect(() => attach({ duration: DURATION, currentTime: CURRENT })).not.toThrow();
    expect(recorder.paints).toEqual([]);
  });

  it('treats a media element with no duration as unplayed', () => {
    attach({});

    expect(recorder.paints).toEqual(staticFrame(0));
  });

  it('reads the bar colours from custom properties, trimmed', () => {
    cssVars = {
      '--blok-audio-bar-played': ' rgb(1, 2, 3) ',
      '--blok-audio-bar': ' rgb(4, 5, 6) ',
      '--blok-audio-bar-head': ' rgb(7, 8, 9) ',
    };
    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.paints.map((paint) => paint.fillStyle))
      .toEqual(['rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'rgb(4, 5, 6)', 'rgb(4, 5, 6)', 'rgb(4, 5, 6)', 'rgb(4, 5, 6)']);
  });

  it('falls back to built-in greys when the custom properties are unset', () => {
    cssVars = {};
    attach({ duration: DURATION, currentTime: CURRENT });

    expect(recorder.paints.map((paint) => paint.fillStyle))
      .toEqual(['#222', '#222', '#222', '#ccc', '#ccc', '#ccc', '#ccc']);
  });

  it('narrow slots shrink the gap and the corner radius with the bar', () => {
    // A slot under ~5.9px puts `slot * 0.34` below the 2px gap cap and pulls
    // barW / 2 below the 2px radius cap, so both caps stop hiding the maths.
    rect = makeRect(60, HEIGHT);
    const narrowPeaks = Array.from({ length: 24 }, (_, index) => (index + 1) / 24);
    attach({ peaks: narrowPeaks, duration: DURATION, currentTime: CURRENT });

    const slot = 60 / 24;
    expect(recorder.paints).toHaveLength(24);
    expect(recorder.paints[0].w).toBeCloseTo(slot - slot * 0.34, 10);
    expect(recorder.paints[0].radius ?? 0).toBeCloseTo((slot - slot * 0.34) / 2, 10);
    expect(recorder.paints[5].x).toBeCloseTo(5 * slot, 10);
  });
});

describe('attachWaveform backing store', () => {
  const sizeWrites = (canvas: HTMLCanvasElement): { width: number; height: number } => {
    const counts = { width: 0, height: 0 };
    for (const prop of ['width', 'height'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
      const read = descriptor?.get;
      const write = descriptor?.set;
      if (read === undefined || write === undefined) throw new Error('canvas size accessors are missing');
      Object.defineProperty(canvas, prop, {
        configurable: true,
        get: (): number => Number(read.call(canvas)),
        set: (value: number): void => { counts[prop] += 1; write.call(canvas, value); },
      });
    }

    return counts;
  };

  it('does not touch the backing store when the box has not changed', () => {
    const { media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });
    const writes = sizeWrites(canvas);

    media.dispatchEvent(new Event('timeupdate'));
    media.dispatchEvent(new Event('timeupdate'));

    expect(writes).toEqual({ width: 0, height: 0 });
  });

  it('resizes when only the height changed, and again when only the width changed', () => {
    const { media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });

    rect = makeRect(WIDTH, 60);
    media.dispatchEvent(new Event('timeupdate'));
    expect(canvas.height).toBe(60 * DPR);
    expect(canvas.width).toBe(WIDTH * DPR);

    rect = makeRect(100, 60);
    media.dispatchEvent(new Event('timeupdate'));
    expect(canvas.width).toBe(100 * DPR);
    expect(canvas.height).toBe(60 * DPR);
  });
});

describe('attachWaveform seeking', () => {
  it('a pointerdown maps the x offset inside the box to a time', () => {
    const { media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });

    canvas.dispatchEvent(pointer('pointerdown', LEFT + WIDTH / 2));

    expect(media.currentTime).toBe(DURATION / 2);
  });

  it('publishes the seek percentage on the host and repaints', () => {
    const { mount, media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });
    recorder.paints.length = 0;

    canvas.dispatchEvent(pointer('pointerdown', LEFT + WIDTH / 2));

    expect(mount.style.getPropertyValue('--blok-audio-seek-pct')).toBe('50');
    expect(media.currentTime).toBe(DURATION / 2);
    expect(recorder.paints).toEqual(staticFrame(PEAKS.length / 2));
  });

  it('keeps seeking while the pointer is down and stops after it is released', () => {
    const { media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });

    canvas.dispatchEvent(pointer('pointerdown', LEFT + WIDTH / 2));
    globalThis.dispatchEvent(pointer('pointermove', LEFT + WIDTH));
    expect(media.currentTime).toBe(DURATION);

    globalThis.dispatchEvent(pointer('pointerup', 0));
    globalThis.dispatchEvent(pointer('pointermove', LEFT));
    expect(media.currentTime).toBe(DURATION);
  });

  it('a pointermove with no pointer down does not seek', () => {
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });

    globalThis.dispatchEvent(pointer('pointermove', LEFT));

    expect(media.currentTime).toBe(CURRENT);
  });

  it('ignores a seek while the media has no duration', () => {
    const { mount, media, canvas } = attach({});

    canvas.dispatchEvent(pointer('pointerdown', LEFT + WIDTH / 2));

    expect(media.currentTime).toBe(0);
    expect(mount.style.getPropertyValue('--blok-audio-seek-pct')).toBe('');
  });

  it('a zero-length track drops the seek instead of publishing a 0% position', () => {
    // A real duration of 0 is falsy exactly like the NaN an unloaded element
    // reports, so the guard has to cover it too: with nothing to seek to there
    // is no position to publish and no frame to repaint.
    const { mount, canvas } = attach({ duration: 0, currentTime: 0 });
    recorder.paints.length = 0;

    canvas.dispatchEvent(pointer('pointerdown', LEFT + WIDTH / 2));

    expect(mount.style.getPropertyValue('--blok-audio-seek-pct')).toBe('');
    expect(recorder.paints).toEqual([]);
  });

  it('does not repaint on a seek while the animation loop is already running', () => {
    const { media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    recorder.paints.length = 0;

    canvas.dispatchEvent(pointer('pointerdown', LEFT + WIDTH / 2));

    expect(recorder.paints).toEqual([]);
  });
});

describe('attachWaveform media events', () => {
  it('timeupdate republishes the seek percentage and repaints while paused', () => {
    const { mount, media } = attach({ duration: DURATION, currentTime: 0 });
    media.currentTime = CURRENT;
    recorder.paints.length = 0;

    media.dispatchEvent(new Event('timeupdate'));

    expect(mount.style.getPropertyValue('--blok-audio-seek-pct')).toBe(String((CURRENT / DURATION) * 100));
    expect(recorder.paints).toEqual(staticFrame());
  });

  it('loadedmetadata refreshes the same way', () => {
    const { mount, media } = attach({ duration: DURATION, currentTime: 0 });
    media.currentTime = CURRENT;
    recorder.paints.length = 0;

    media.dispatchEvent(new Event('loadedmetadata'));

    expect(mount.style.getPropertyValue('--blok-audio-seek-pct')).toBe(String((CURRENT / DURATION) * 100));
    expect(recorder.paints).toEqual(staticFrame());
  });

  it('does not repaint on timeupdate while the loop already owns the frame', () => {
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    recorder.paints.length = 0;

    media.dispatchEvent(new Event('timeupdate'));

    expect(recorder.paints).toEqual([]);
  });

  it('play publishes the seek percentage and starts one loop', () => {
    const { mount, media } = attach({ duration: DURATION, currentTime: CURRENT });

    media.dispatchEvent(new Event('play'));

    expect(mount.style.getPropertyValue('--blok-audio-seek-pct')).toBe(String((CURRENT / DURATION) * 100));
    expect(scheduled).toBe(1);
  });

  it('a playing frame boosts every bar and blooms the head tint in', () => {
    clock = 1000;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    recorder.paints.length = 0;

    flush(1325);

    expect(recorder.paints).toEqual(liveFrame({ now: 1325, entranceStart: 1000, energy: 1 }));
    expect(scheduled).toBe(2);
  });

  it('a head blend that lands exactly on the 0.001 threshold paints no tint', () => {
    // The tint is gated on `blend > 0.001`, and the blend is
    // `headFocus(distance) * energy * entrance`. These three numbers put the
    // product on the threshold exactly (a single bar 0.619 behind the playhead,
    // playing, with 0.4337ms of the entrance ramp elapsed), so the bar is the
    // one case where the strictness of the comparison decides the paint.
    const played = 0.6189999999557707;
    const now = 0.4336780805117677;
    const { media } = attach({ peaks: [0.5], duration: 1, currentTime: played });
    media.dispatchEvent(new Event('play'));
    recorder.paints.length = 0;

    flush(now);

    const amp = liveAmplitude({
      basePeak: 0.5,
      index: 0,
      playheadIndex: played,
      timeSeconds: now / 1000,
      reduced: false,
      energy: 1,
    });
    const height = Math.max(2, amp * HEIGHT * 0.92);
    expect(recorder.paints).toEqual([
      {
        shape: 'roundRect',
        x: 0,
        y: (HEIGHT - height) / 2,
        w: WIDTH - 2,
        h: height,
        radius: 2,
        fillStyle: PLAYED,
        alpha: 1,
      },
    ]);
    expect(headColorBlend({ distance: -played, energy: 1, entrance: entranceEase(now / ENTRANCE_MS) })).toBe(0.001);
  });

  it('pause ramps the boost down over the settle window and then stops the loop', () => {
    clock = 1000;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    flush(1000);
    media.dispatchEvent(new Event('pause'));
    recorder.paints.length = 0;

    // Half way through the settle: the boost is at half energy and the loop
    // still has a reason to keep running.
    flush(1000 + SETTLE_MS / 2);
    expect(recorder.paints).toEqual(liveFrame({ now: 1000 + SETTLE_MS / 2, entranceStart: 1000, energy: 0.5 }));

    // Past the settle: the boost is gone and no further frame is asked for.
    recorder.paints.length = 0;
    const before = scheduled;
    flush(1000 + SETTLE_MS * 2);
    expect(recorder.paints).toEqual(staticFrame());
    expect(scheduled).toBe(before);
  });

  it('ended winds the loop down the same way pause does', () => {
    clock = 1000;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    flush(1000);
    media.dispatchEvent(new Event('ended'));
    recorder.paints.length = 0;

    flush(1000 + SETTLE_MS / 2);

    expect(recorder.paints).toEqual(liveFrame({ now: 1000 + SETTLE_MS / 2, entranceStart: 1000, energy: 0.5 }));
  });

  it('the wound-down loop hands the frame back and disarms the settle', () => {
    clock = 1000;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    flush(1000);
    media.dispatchEvent(new Event('pause'));
    flush(1000 + SETTLE_MS * 2);
    recorder.paints.length = 0;

    // The loop released the frame, so a timeupdate owns the repaint again, and
    // what it repaints is the resting waveform rather than a settle left armed.
    media.dispatchEvent(new Event('timeupdate'));

    expect(recorder.paints).toEqual(staticFrame());
  });

  it('a stop after the loop has already wound down does not restart it', () => {
    clock = 1000;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    flush(1000);
    media.dispatchEvent(new Event('pause'));
    flush(1000 + SETTLE_MS * 2);

    media.dispatchEvent(new Event('pause'));
    const after = scheduled;
    media.dispatchEvent(new Event('pause'));

    expect(scheduled).toBe(after);
  });

  it('a stop with no frame in flight cancels nothing and still repaints', () => {
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    recorder.paints.length = 0;

    media.dispatchEvent(new Event('pause'));

    expect(cancelled).toEqual([]);
    expect(recorder.paints).toEqual(staticFrame());
  });

  it('reduced motion keeps play from starting a loop at all', () => {
    reduced = true;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });

    media.dispatchEvent(new Event('play'));

    expect(scheduled).toBe(0);
  });

  it('reduced motion turned on mid-playback makes the next stop cancel the frame outright', () => {
    clock = 1000;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    expect(scheduled).toBe(1);
    reduced = true;
    recorder.paints.length = 0;

    media.dispatchEvent(new Event('pause'));

    expect(cancelled).toEqual([1]);
    expect(scheduled).toBe(1);
    expect(recorder.paints).toEqual(staticFrame());
  });

  it('works when the environment has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);

    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    expect(recorder.paints).toEqual(staticFrame());

    media.dispatchEvent(new Event('play'));
    expect(scheduled).toBe(1);
  });

  it.each([
    ['a performance object with no now()', {}],
    ['no performance object at all', undefined],
  ])('starts the loop with %s', (_label, stub) => {
    vi.stubGlobal('performance', stub);

    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));

    expect(scheduled).toBe(1);
  });

  it.each([
    ['a performance object with no now()', {}],
    ['no performance object at all', undefined],
  ])('arms the settle with %s', (_label, stub) => {
    vi.stubGlobal('performance', stub);
    // Reduced motion at play time leaves no frame in flight, so the settle
    // branch is the one that has to ask for the loop.
    reduced = true;
    const { media } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    expect(scheduled).toBe(0);
    reduced = false;

    media.dispatchEvent(new Event('pause'));

    expect(scheduled).toBe(1);
  });
});

describe('attachWaveform resize', () => {
  it('paints as soon as the canvas gains a box, with no media event', () => {
    rect = makeRect(0, 0);
    const { canvas } = attach({ duration: DURATION, currentTime: CURRENT });
    expect(recorder.paints).toEqual([]);

    rect = makeRect(WIDTH, HEIGHT);
    observerFor(canvas).cb([], {} as ResizeObserver);

    expect(recorder.paints).toEqual(staticFrame());
  });

  it('does not double-paint on a resize while the loop is running', () => {
    const { media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    recorder.paints.length = 0;

    observerFor(canvas).cb([], {} as ResizeObserver);

    expect(recorder.paints).toEqual([]);
  });

  it('stamps the resize repaint with the current clock', () => {
    // Reduced motion at play time leaves `playing` set with no loop running, so
    // the resize repaint is the one that draws the animating frame — and the
    // frame it draws must be the one for *now*, not for time zero.
    reduced = true;
    clock = 1000;
    const { media, canvas } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    reduced = false;
    clock = 1325;
    recorder.paints.length = 0;

    observerFor(canvas).cb([], {} as ResizeObserver);

    expect(recorder.paints).toEqual(liveFrame({ now: 1325, entranceStart: 1000, energy: 1 }));
  });

  it.each([
    ['a performance object with no now()', {}],
    ['no performance object at all', undefined],
  ])('repaints on resize with %s', (_label, stub) => {
    vi.stubGlobal('performance', stub);
    rect = makeRect(0, 0);
    const { canvas } = attach({ duration: DURATION, currentTime: CURRENT });
    rect = makeRect(WIDTH, HEIGHT);

    observerFor(canvas).cb([], {} as ResizeObserver);

    expect(recorder.paints).toEqual(staticFrame());
  });

  it('runs without a ResizeObserver in the environment', () => {
    vi.stubGlobal('ResizeObserver', undefined);

    const { handle, canvas } = attach({ duration: DURATION, currentTime: CURRENT });

    expect(canvas.getAttribute('data-role')).toBe('audio-waveform-canvas');
    expect(() => handle.destroy()).not.toThrow();
  });
});

describe('attachWaveform destroy', () => {
  it('disconnects the observer, cancels the pending frame and takes the canvas out', () => {
    const { media, canvas, handle } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    const observer = observerFor(canvas);

    handle.destroy();

    expect(observer.disconnects).toBe(1);
    expect(cancelled).toEqual([1]);
    expect(canvas.parentElement).toBeNull();
  });

  it('cancels nothing when no frame is in flight', () => {
    const { handle } = attach({ duration: DURATION, currentTime: CURRENT });

    handle.destroy();

    expect(cancelled).toEqual([]);
  });

  it('stops responding to every media and pointer event it was listening for', () => {
    const { mount, media, canvas, handle } = attach({ duration: DURATION, currentTime: CURRENT });
    canvas.dispatchEvent(pointer('pointerdown', LEFT + WIDTH / 2));
    const seeked = media.currentTime;
    mount.style.removeProperty('--blok-audio-seek-pct');

    handle.destroy();
    recorder.paints.length = 0;
    scheduled = 0;

    canvas.dispatchEvent(pointer('pointerdown', LEFT));
    globalThis.dispatchEvent(pointer('pointermove', LEFT));
    expect(media.currentTime).toBe(seeked);

    media.dispatchEvent(new Event('play'));
    expect(scheduled).toBe(0);

    media.dispatchEvent(new Event('pause'));
    media.dispatchEvent(new Event('ended'));
    media.dispatchEvent(new Event('timeupdate'));
    media.dispatchEvent(new Event('loadedmetadata'));

    expect(recorder.paints).toEqual([]);
    expect(mount.style.getPropertyValue('--blok-audio-seek-pct')).toBe('');
  });

  it('hands back every window listener it took, under the name it took it under', () => {
    const added: Array<{ type: string; fn: unknown }> = [];
    const removed: Array<{ type: string; fn: unknown }> = [];
    vi.spyOn(globalThis, 'addEventListener').mockImplementation((type: string, fn: unknown) => {
      added.push({ type, fn });
    });
    vi.spyOn(globalThis, 'removeEventListener').mockImplementation((type: string, fn: unknown) => {
      removed.push({ type, fn });
    });

    const { handle } = attach({ duration: DURATION, currentTime: CURRENT });
    handle.destroy();

    expect(added.map((entry) => entry.type)).toEqual(['pointermove', 'pointerup']);
    expect(removed.map((entry) => entry.type)).toEqual(['pointermove', 'pointerup']);
    expect(removed.map((entry) => entry.fn)).toEqual(added.map((entry) => entry.fn));
  });

  it('leaves the animation state stopped even if a queued frame still fires', () => {
    // A frame the browser already dequeued cannot be cancelled; destroy has to
    // make the loop a dead end on its own. The timestamp is inside the settle
    // window, so a leftover `playing` or `settling` flag would still have
    // energy and would both boost the bars and ask for another frame.
    cancelDequeues = false;
    clock = 1000;
    const { media, handle } = attach({ duration: DURATION, currentTime: CURRENT });
    media.dispatchEvent(new Event('play'));
    handle.destroy();
    const before = scheduled;
    recorder.paints.length = 0;

    flush(SETTLE_MS - 120);

    expect(scheduled).toBe(before);
    expect(recorder.paints).toEqual(staticFrame());
  });
});

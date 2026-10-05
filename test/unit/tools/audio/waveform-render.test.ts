import { describe, it, expect, vi, afterEach } from 'vitest';
import { ratioFromPointer, decodePeaks, attachWaveform } from '../../../../src/tools/audio/waveform';

afterEach(() => vi.restoreAllMocks());

describe('ratioFromPointer', () => {
  it('maps the left edge to 0 and right edge to 1', () => {
    expect(ratioFromPointer(100, { left: 100, width: 200 })).toBe(0);
    expect(ratioFromPointer(300, { left: 100, width: 200 })).toBe(1);
    expect(ratioFromPointer(200, { left: 100, width: 200 })).toBeCloseTo(0.5, 5);
  });
  it('clamps out-of-bounds pointers', () => {
    expect(ratioFromPointer(0, { left: 100, width: 200 })).toBe(0);
    expect(ratioFromPointer(9999, { left: 100, width: 200 })).toBe(1);
  });
});

describe('decodePeaks', () => {
  it('returns null when AudioContext is unavailable (jsdom)', async () => {
    const file = new File([new Uint8Array(4)], 'a.mp3', { type: 'audio/mpeg' });
    await expect(decodePeaks(file)).resolves.toBeNull();
  });
});

describe('attachWaveform', () => {
  it('mounts a canvas and seeks on click', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const mount = document.createElement('div');
    const media = document.createElement('audio');
    Object.defineProperty(media, 'duration', { value: 100, configurable: true });
    // jsdom gives a zero rect; stub a real one so seek math runs.
    const handle = attachWaveform({ mount, media, peaks: [0.1, 0.5, 1, 0.5] });
    const canvas = mount.querySelector('[data-role="audio-waveform-canvas"]') as HTMLElement;
    expect(canvas).not.toBeNull();
    canvas.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 40, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    expect(media.currentTime).toBeCloseTo(50, 0);
    handle.destroy();
  });

  it('paints once the canvas gains a box, even with no media events', () => {
    // The canvas is always detached (zero-sized) when attachWaveform runs — the
    // figure is only appended to the block afterwards — so the attach-time paint
    // is a no-op. Nothing else must be required to get the bars on screen.
    const observers: Array<{ cb: ResizeObserverCallback; targets: Element[] }> = [];
    class StubResizeObserver {
      private entry: { cb: ResizeObserverCallback; targets: Element[] };
      public constructor(cb: ResizeObserverCallback) {
        this.entry = { cb, targets: [] };
        observers.push(this.entry);
      }
      public observe(target: Element): void { this.entry.targets.push(target); }
      public unobserve(): void {}
      public disconnect(): void { this.entry.targets = []; }
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    const mount = document.createElement('div');
    const media = document.createElement('audio');
    const handle = attachWaveform({ mount, media, peaks: [0.1, 0.5, 1, 0.5] });
    const canvas = mount.querySelector<HTMLCanvasElement>('[data-role="audio-waveform-canvas"]');
    if (!canvas) throw new Error('canvas was not mounted');
    expect(canvas.width).toBe(300); // untouched default — nothing painted yet

    // The block is mounted and the canvas finally has a layout box.
    canvas.getBoundingClientRect = (): DOMRect =>
      ({ left: 0, width: 200, top: 0, height: 40, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
    const observer = observers.find((o) => o.targets.includes(canvas));
    expect(observer).toBeDefined();
    observer?.cb([], {} as ResizeObserver);

    // A paint sized the backing store to the box it now occupies.
    expect(canvas.width).toBe(200 * (globalThis.devicePixelRatio || 1));
    handle.destroy();
  });

  describe('feeding the cover', () => {
    const frames: FrameRequestCallback[] = [];
    // Frame times must share performance.now()'s origin, as rAF's do in a browser:
    // the pause settle is timed from performance.now().
    const origin = { t: 0 };
    const step = (ms: number): void => {
      const pending = frames.splice(0);
      pending.forEach((cb) => cb(origin.t + ms));
    };
    const level = (el: HTMLElement): number => Number(el.style.getPropertyValue('--blok-audio-level') || 0);
    const kick = (el: HTMLElement): number => Number(el.style.getPropertyValue('--blok-audio-kick') || 0);

    const setup = (peaks: number[], reduced = false): { stage: HTMLElement; media: HTMLAudioElement; destroy: () => void } => {
      frames.length = 0;
      origin.t = performance.now();
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
      vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce') }));
      const stage = document.createElement('figure');
      const mount = document.createElement('div');
      const media = document.createElement('audio');
      Object.defineProperty(media, 'duration', { value: peaks.length, configurable: true });
      const handle = attachWaveform({ mount, media, peaks, stage });
      return { stage, media, destroy: () => handle.destroy() };
    };

    afterEach(() => vi.unstubAllGlobals());

    it('glows with the loudness under the playhead while playing, then settles to zero', () => {
      const { stage, media, destroy } = setup(new Array<number>(40).fill(0.9));
      media.currentTime = 10;
      media.dispatchEvent(new Event('play'));
      [0, 16, 32, 48, 64, 80, 96, 112].forEach(step);

      expect(level(stage)).toBeGreaterThan(0.5);

      media.dispatchEvent(new Event('pause'));
      Array.from({ length: 120 }, (_, k) => 128 + k * 16).forEach(step);

      expect(level(stage)).toBe(0);
      expect(frames).toHaveLength(0);
      destroy();
    });

    it('kicks when the playhead crosses a beat', () => {
      const peaks = [...new Array<number>(10).fill(0.1), 1, ...new Array<number>(10).fill(0.1)];
      const { stage, media, destroy } = setup(peaks);
      media.currentTime = 9.8;
      media.dispatchEvent(new Event('play'));
      step(0);
      expect(kick(stage)).toBe(0);

      media.currentTime = 10.1;
      step(16);

      expect(kick(stage)).toBeGreaterThan(0.5);
      destroy();
    });

    it('leaves the cover alone under reduced motion', () => {
      const { stage, media, destroy } = setup(new Array<number>(40).fill(0.9), true);
      media.currentTime = 10;
      media.dispatchEvent(new Event('play'));
      [0, 16, 32].forEach(step);

      expect(stage.style.getPropertyValue('--blok-audio-level')).toBe('');
      expect(stage.style.getPropertyValue('--blok-audio-kick')).toBe('');
      destroy();
    });
  });

  it('glows the playhead in played ink, never the accent-mixed head tint', () => {
    const glows: string[] = [];
    const ctx = new Proxy({}, {
      get: (_t, key) => (key === 'roundRect' ? undefined : () => undefined),
      set: (_t, key, value) => {
        if (key === 'shadowColor' && value) glows.push(String(value));
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const mount = document.createElement('div');
    const media = document.createElement('audio');
    Object.defineProperty(media, 'duration', { value: 40, configurable: true });
    const handle = attachWaveform({ mount, media, peaks: new Array<number>(40).fill(0.5) });
    const canvas = mount.querySelector<HTMLCanvasElement>('[data-role="audio-waveform-canvas"]');
    if (!canvas) throw new Error('canvas was not mounted');
    canvas.style.setProperty('--blok-audio-bar-played', 'rgb(1, 2, 3)');
    canvas.style.setProperty('--blok-audio-bar-head', 'rgb(0, 0, 255)');
    canvas.getBoundingClientRect = (): DOMRect =>
      ({ left: 0, width: 200, top: 0, height: 40, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
    media.currentTime = 20;
    const t0 = performance.now();
    media.dispatchEvent(new Event('play'));
    [700, 716, 732].forEach((ms) => frames.splice(0).forEach((cb) => cb(t0 + ms)));

    expect(glows.length).toBeGreaterThan(0);
    expect(new Set(glows)).toEqual(new Set(['rgb(1, 2, 3)']));
    handle.destroy();
    vi.unstubAllGlobals();
  });
});

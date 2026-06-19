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
});

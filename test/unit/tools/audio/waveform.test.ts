import { describe, it, expect, vi, afterEach } from 'vitest';
import { computePeaks, decodePeaks, peaksFromAudioBuffer } from '../../../../src/tools/audio/waveform';
import { decodeMotion } from '../../../../src/tools/audio/motion';

describe('computePeaks', () => {
  it('returns the requested number of buckets', () => {
    const samples = new Float32Array(1000).fill(0.5);
    expect(computePeaks(samples, 10)).toHaveLength(10);
  });

  it('normalizes the loudest bucket to 1', () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < 50; i++) samples[i] = 0.2;
    for (let i = 50; i < 100; i++) samples[i] = 0.8;
    const peaks = computePeaks(samples, 2);
    expect(peaks[1]).toBeCloseTo(1, 5);
    expect(peaks[0]).toBeCloseTo(0.25, 5);
  });

  it('treats negative amplitudes by absolute value', () => {
    const samples = new Float32Array([-0.9, 0.1, -0.1, 0.1]);
    const peaks = computePeaks(samples, 1);
    expect(peaks[0]).toBeCloseTo(1, 5);
  });

  it('returns all zeros for pure silence', () => {
    expect(computePeaks(new Float32Array(64), 8)).toEqual(new Array(8).fill(0));
  });

  it('handles empty input by returning a zero-filled array', () => {
    expect(computePeaks(new Float32Array(0), 4)).toEqual([0, 0, 0, 0]);
  });

  it('peaksFromAudioBuffer averages channels then reduces', () => {
    const left = new Float32Array([1, 1, 0, 0]);
    const right = new Float32Array([0, 0, 1, 1]);
    const buffer = {
      numberOfChannels: 2,
      length: 4,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    };
    const peaks = peaksFromAudioBuffer(buffer, 2);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeCloseTo(1, 5);
    expect(peaks[1]).toBeCloseTo(1, 5);
  });
});

describe('decodePeaks — saved motion', () => {
  const fakeContext = (samples: Float32Array, sampleRate: number): void => {
    class FakeAudioContext {
      public decodeAudioData(): Promise<unknown> {
        return Promise.resolve({
          numberOfChannels: 1,
          length: samples.length,
          duration: samples.length / sampleRate,
          sampleRate,
          getChannelData: () => samples,
        });
      }

      public close(): Promise<void> {
        return Promise.resolve();
      }
    }

    vi.stubGlobal('AudioContext', FakeAudioContext);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('works out the motion of the track and packs it with the peaks', async () => {
    const sampleRate = 8000;
    const samples = Float32Array.from({ length: sampleRate * 2 }, (_, i) => {
      const sinceHit = (i % (sampleRate / 2)) / sampleRate;

      return Math.sin(2 * Math.PI * 60 * (i / sampleRate)) * Math.exp(-sinceHit * 18);
    });

    fakeContext(samples, sampleRate);
    const decoded = await decodePeaks(new File(['x'], 'a.wav'));
    const track = decodeMotion(decoded?.motion ?? '');

    expect(track).not.toBeNull();
    expect(track?.events.some((event) => event.kind === 0)).toBe(true);
    expect(decoded?.peaks).toHaveLength(300);
  });

  it('keeps the peaks when the motion cannot be worked out', async () => {
    fakeContext(new Float32Array(4000), Number.NaN);
    const decoded = await decodePeaks(new File(['x'], 'a.wav'));

    expect(decoded?.peaks).toHaveLength(300);
    expect(decoded?.motion).toBeUndefined();
  });
});

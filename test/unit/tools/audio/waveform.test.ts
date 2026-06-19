import { describe, it, expect } from 'vitest';
import { computePeaks, peaksFromAudioBuffer } from '../../../../src/tools/audio/waveform';

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

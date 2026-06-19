import { WAVEFORM_BUCKETS } from './constants';

/**
 * Reduce raw mono samples to `buckets` peak values normalized to 0..1.
 * Each bucket holds the max absolute amplitude across its slice; the whole
 * array is then divided by the global max so the loudest bucket is 1.
 */
export function computePeaks(channel: Float32Array, buckets = WAVEFORM_BUCKETS): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (channel.length === 0) return out;

  const step = channel.length / buckets;
  let globalMax = 0;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step);
    const end = Math.min(channel.length, Math.floor((b + 1) * step));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const amp = Math.abs(channel[i]);
      if (amp > peak) peak = amp;
    }
    out[b] = peak;
    if (peak > globalMax) globalMax = peak;
  }

  if (globalMax > 0) {
    for (let b = 0; b < buckets; b++) out[b] /= globalMax;
  }
  return out;
}

interface ChannelSource {
  numberOfChannels: number;
  length: number;
  getChannelData(ch: number): Float32Array;
}

/** Average all channels into one mono track, then reduce to peaks. */
export function peaksFromAudioBuffer(buffer: ChannelSource, buckets = WAVEFORM_BUCKETS): number[] {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels <= 1) return computePeaks(buffer.getChannelData(0), buckets);

  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / numberOfChannels;
  }
  return computePeaks(mono, buckets);
}

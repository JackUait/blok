import { WAVEFORM_BUCKETS } from './constants';

/**
 * Reduce raw mono samples to `buckets` peak values normalized to 0..1.
 * Each bucket holds the max absolute amplitude across its slice; the whole
 * array is then divided by the global max so the loudest bucket is 1.
 */

function bucketPeak(channel: Float32Array, start: number, end: number): number {
  return channel.slice(start, end).reduce((max, v) => Math.max(max, Math.abs(v)), 0);
}

export function computePeaks(channel: Float32Array, buckets = WAVEFORM_BUCKETS): number[] {
  if (channel.length === 0) return new Array<number>(buckets).fill(0);

  const step = channel.length / buckets;
  const out = Array.from({ length: buckets }, (_, b) => {
    const start = Math.floor(b * step);
    const end = Math.min(channel.length, Math.floor((b + 1) * step));
    return bucketPeak(channel, start, end);
  });

  const globalMax = Math.max(0, ...out);
  if (globalMax <= 0) return out;
  return out.map((v) => v / globalMax);
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
  Array.from({ length: numberOfChannels }, (_, ch) => buffer.getChannelData(ch)).forEach((data) => {
    data.forEach((v, i) => { mono[i] += v / numberOfChannels; });
  });
  return computePeaks(mono, buckets);
}

export function ratioFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return 0;
  const r = (clientX - rect.left) / rect.width;
  return Math.min(1, Math.max(0, r));
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const w = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export async function decodePeaks(file: File): Promise<number[] | null> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    try {
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      return peaksFromAudioBuffer(buffer);
    } finally {
      void ctx.close();
    }
  } catch {
    return null;
  }
}

export interface WaveformHandle {
  destroy(): void;
}

export function attachWaveform(opts: {
  mount: HTMLElement;
  media: HTMLAudioElement;
  peaks: number[];
}): WaveformHandle {
  const { mount, media, peaks } = opts;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-role', 'audio-waveform-canvas');
  canvas.className = 'blok-audio-waveform__canvas';
  mount.appendChild(canvas);

  const draw = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const played = media.duration ? media.currentTime / media.duration : 0;
    const barW = rect.width / peaks.length;
    const styles = getComputedStyle(canvas);
    const playedColor = styles.getPropertyValue('--blok-audio-bar-played').trim() || '#222';
    const baseColor = styles.getPropertyValue('--blok-audio-bar').trim() || '#ccc';
    peaks.forEach((peak, i) => {
      const h = Math.max(2, peak * rect.height);
      const x = i * barW;
      const y = (rect.height - h) / 2;
      ctx.fillStyle = i / peaks.length < played ? playedColor : baseColor;
      ctx.fillRect(x, y, Math.max(1, barW - 1), h);
    });
  };

  const rafState = { id: 0 };
  const onTime = (): void => {
    if (rafState.id) return;
    rafState.id = requestAnimationFrame(() => {
      rafState.id = 0;
      mount.style.setProperty(
        '--blok-audio-seek-pct',
        String(media.duration ? (media.currentTime / media.duration) * 100 : 0),
      );
      draw();
    });
  };

  const seek = (clientX: number): void => {
    if (!media.duration) return;
    media.currentTime = ratioFromPointer(clientX, canvas.getBoundingClientRect()) * media.duration;
    draw();
  };
  const drag = { active: false };
  const onDown = (e: PointerEvent): void => { drag.active = true; seek(e.clientX); };
  const onMove = (e: PointerEvent): void => { if (drag.active) seek(e.clientX); };
  const onUp = (): void => { drag.active = false; };

  canvas.addEventListener('pointerdown', onDown);
  globalThis.addEventListener('pointermove', onMove);
  globalThis.addEventListener('pointerup', onUp);
  media.addEventListener('timeupdate', onTime);
  media.addEventListener('loadedmetadata', draw);
  draw();

  return {
    destroy(): void {
      if (rafState.id) cancelAnimationFrame(rafState.id);
      canvas.removeEventListener('pointerdown', onDown);
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('loadedmetadata', draw);
      canvas.remove();
    },
  };
}

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

export function ratioFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return 0;
  const r = (clientX - rect.left) / rect.width;
  return r < 0 ? 0 : r > 1 ? 1 : r;
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
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(2, peaks[i] * rect.height);
      const x = i * barW;
      const y = (rect.height - h) / 2;
      ctx.fillStyle = i / peaks.length < played ? playedColor : baseColor;
      ctx.fillRect(x, y, Math.max(1, barW - 1), h);
    }
  };

  let raf = 0;
  const onTime = (): void => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
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
  let dragging = false;
  const onDown = (e: PointerEvent): void => { dragging = true; seek(e.clientX); };
  const onMove = (e: PointerEvent): void => { if (dragging) seek(e.clientX); };
  const onUp = (): void => { dragging = false; };

  canvas.addEventListener('pointerdown', onDown);
  globalThis.addEventListener('pointermove', onMove);
  globalThis.addEventListener('pointerup', onUp);
  media.addEventListener('timeupdate', onTime);
  media.addEventListener('loadedmetadata', draw);
  draw();

  return {
    destroy(): void {
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('loadedmetadata', draw);
      canvas.remove();
    },
  };
}

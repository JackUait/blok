import { WAVEFORM_BUCKETS } from './constants';
import { liveAmplitude } from './liveliness';

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

export interface DecodedAudio {
  peaks: number[];
  duration: number;
}

export async function decodePeaks(file: File): Promise<DecodedAudio | null> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    try {
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      return { peaks: peaksFromAudioBuffer(buffer), duration: buffer.duration };
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

  const prefersReducedMotion = (): boolean =>
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // Animation state. `playing` is true between play and pause/ended and pins the
  // boost energy at full. On pause we keep the loop alive briefly with `settling`
  // so the bars glide back to their resting peaks (energy ramps 1→0) instead of
  // snapping. `energy` reflects the current boost multiplier.
  const SETTLE_MS = 420;
  const anim = { playing: false, settling: false, settleStart: 0, rafId: 0 };

  const energyAt = (now: number): number => {
    if (anim.playing) return 1;
    if (!anim.settling) return 0;
    return Math.min(1, Math.max(0, 1 - (now - anim.settleStart) / SETTLE_MS));
  };

  const draw = (now: number): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    // Resizing the backing store clears it; only pay that cost when the box
    // actually changed (every frame of the loop would otherwise reallocate).
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const played = media.duration ? media.currentTime / media.duration : 0;
    const playheadIndex = played * peaks.length;
    const reduced = prefersReducedMotion();
    const timeSeconds = now / 1000;
    const energy = reduced ? 0 : energyAt(now);
    const live = energy > 0;

    const slot = rect.width / peaks.length;
    const gap = Math.min(2, slot * 0.34);
    const barW = Math.max(1, slot - gap);
    const radius = Math.min(barW / 2, 2);
    const styles = getComputedStyle(canvas);
    const playedColor = styles.getPropertyValue('--blok-audio-bar-played').trim() || '#222';
    const baseColor = styles.getPropertyValue('--blok-audio-bar').trim() || '#ccc';
    peaks.forEach((peak, i) => {
      const amp = live
        ? liveAmplitude({ basePeak: peak, index: i, playheadIndex, timeSeconds, reduced, energy })
        : peak;
      const h = Math.max(2, amp * rect.height * 0.92);
      const x = i * slot;
      const y = (rect.height - h) / 2;
      ctx.fillStyle = i < playheadIndex ? playedColor : baseColor;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, barW, h, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barW, h);
      }
    });
  };

  const setSeekVar = (): void => {
    mount.style.setProperty(
      '--blok-audio-seek-pct',
      String(media.duration ? (media.currentTime / media.duration) * 100 : 0),
    );
  };

  const loop = (now: number): void => {
    draw(now);
    // Keep looping while playing, or while the post-pause settle still has energy.
    const keepGoing = anim.playing || (anim.settling && energyAt(now) > 0);
    if (keepGoing) {
      anim.rafId = requestAnimationFrame(loop);
    } else {
      anim.settling = false;
      anim.rafId = 0;
    }
  };

  const onPlay = (): void => {
    setSeekVar();
    anim.playing = true;
    anim.settling = false;
    // No continuous loop under reduced motion — timeupdate alone advances the
    // played boundary, with no dancing bars.
    if (!anim.rafId && !prefersReducedMotion()) anim.rafId = requestAnimationFrame(loop);
  };
  const onStop = (): void => {
    // Hand off to the settle ramp so the bars glide down rather than snap. Under
    // reduced motion there's no loop/boost to settle, so just stop.
    if (anim.playing && !prefersReducedMotion()) {
      anim.playing = false;
      anim.settling = true;
      anim.settleStart = globalThis.performance?.now?.() ?? 0;
      if (!anim.rafId) anim.rafId = requestAnimationFrame(loop);
    } else {
      anim.playing = false;
      anim.settling = false;
      if (anim.rafId) { cancelAnimationFrame(anim.rafId); anim.rafId = 0; }
      draw(0);
    }
  };

  // Keeps the played boundary + seek var current while paused-seeking or when
  // the continuous loop is off (reduced motion). The loop owns drawing while it
  // runs, so skip the redundant paint then.
  const onTime = (): void => {
    setSeekVar();
    if (!anim.rafId) draw(0);
  };

  const seek = (clientX: number): void => {
    if (!media.duration) return;
    media.currentTime = ratioFromPointer(clientX, canvas.getBoundingClientRect()) * media.duration;
    setSeekVar();
    if (!anim.rafId) draw(0);
  };
  const drag = { active: false };
  const onDown = (e: PointerEvent): void => { drag.active = true; seek(e.clientX); };
  const onMove = (e: PointerEvent): void => { if (drag.active) seek(e.clientX); };
  const onUp = (): void => { drag.active = false; };

  canvas.addEventListener('pointerdown', onDown);
  globalThis.addEventListener('pointermove', onMove);
  globalThis.addEventListener('pointerup', onUp);
  media.addEventListener('play', onPlay);
  media.addEventListener('pause', onStop);
  media.addEventListener('ended', onStop);
  media.addEventListener('timeupdate', onTime);
  media.addEventListener('loadedmetadata', onTime);
  draw(0);

  return {
    destroy(): void {
      if (anim.rafId) cancelAnimationFrame(anim.rafId);
      anim.playing = false;
      canvas.removeEventListener('pointerdown', onDown);
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onStop);
      media.removeEventListener('ended', onStop);
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('loadedmetadata', onTime);
      canvas.remove();
    },
  };
}

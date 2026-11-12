/**
 * Live listening for the audio block: taps the playing <audio> element with a
 * Web Audio analyser, but only when the tap cannot mute the track.
 */

export interface LiveSpectrum {
  bytes: Uint8Array;
  hzPerBin: number;
}

export interface Listener {
  /** Frequency data for this frame, or null while not listening (not allowed, not ready, not started). */
  read(): LiveSpectrum | null;
  destroy(): void;
}

type AudioContextCtor = new () => AudioContext;

interface Tap {
  ctx: AudioContext;
  analyser: AnalyserNode;
  bytes: Uint8Array<ArrayBuffer>;
}

const FFT_SIZE = 2048;
const SMOOTHING = 0.3;
const HAVE_NOTHING = 0;
const NETWORK_IDLE = 1;

const shared: { ctx: AudioContext | null } = { ctx: null };

// createMediaElementSource throws on a second call for one element.
const taps = new WeakMap<HTMLMediaElement, Tap>();

const DEAF: Listener = {
  read: () => null,
  destroy: () => undefined,
};

function getAudioContextCtor(): AudioContextCtor | null {
  const w = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };

  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** blob: and data: URLs can never be cross-origin tainted. */
export function isAlwaysClean(url: string): boolean {
  return /^(?:blob|data):/i.test(url);
}

/** Throws when Web Audio refuses; the caller treats that as "cannot listen". */
function buildTap(Ctor: AudioContextCtor, media: HTMLAudioElement): Tap {
  shared.ctx ??= new Ctor();

  const ctx = shared.ctx;
  const analyser = ctx.createAnalyser();

  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = SMOOTHING;

  // Last step that can throw before wiring: a source that is made but not
  // connected to the destination plays silently.
  const source = ctx.createMediaElementSource(media);

  source.connect(analyser);
  analyser.connect(ctx.destination);

  return { ctx, analyser, bytes: new Uint8Array(analyser.frequencyBinCount) };
}

export function createListener(audioEl: HTMLAudioElement): Listener {
  const Ctor = getAudioContextCtor();

  if (!Ctor) return DEAF;

  // `media` aliases the param so property writes below are not flagged by no-param-reassign.
  const media = audioEl;
  const probe = new AbortController();
  const bound: Array<[string, () => void]> = [];
  const state = {
    destroyed: false,
    // True only when the element is known to load untainted. Tapping a tainted
    // element reads zeros AND mutes its sound.
    safe: false,
    // Play was asked for while the CORS load was still unconfirmed.
    playWanted: false,
  };

  const on = (type: string, handler: () => void): void => {
    media.addEventListener(type, handler);
    bound.push([type, handler]);
  };

  const off = (handler: () => void): void => {
    bound
      .filter(([, h]) => h === handler)
      .forEach(([type]) => media.removeEventListener(type, handler));
    bound.splice(0, bound.length, ...bound.filter(([, h]) => h !== handler));
  };

  const srcOf = (): string => media.currentSrc || media.src;

  const tap = (): void => {
    if (taps.has(media)) return;
    try {
      taps.set(media, buildTap(Ctor, media));
    } catch {
      state.safe = false;
    }
  };

  const onPlay = (): void => {
    state.playWanted = true;
    if (state.safe) tap();
    // A suspended context silences every tapped element.
    taps.get(media)?.ctx.resume().catch(() => undefined);
  };

  const onPause = (): void => {
    state.playWanted = false;
  };

  const onReady = (): void => {
    off(onReady);
    off(onError);
    off(onPause);
    state.safe = true;
    if (!media.paused) onPlay();
  };

  // The CORS load failed: give the sound back.
  function onError(): void {
    off(onReady);
    off(onError);
    off(onPause);
    media.removeAttribute('crossorigin');
    // Removing the attribute does not clear the error; only a reload does.
    media.load();
    if (state.playWanted) media.play().catch(() => undefined);
  }

  const switchToCors = (): void => {
    // Only an element that has fetched nothing picks the new mode up on its own.
    // Any other state keeps its no-CORS data until load().
    const untouched = media.readyState === HAVE_NOTHING && media.networkState === NETWORK_IDLE;

    on('loadedmetadata', onReady);
    on('error', onError);
    on('pause', onPause);
    media.crossOrigin = 'anonymous';
    if (!untouched) media.load();
  };

  const runProbe = (url: string): void => {
    fetch(url, { mode: 'cors', credentials: 'same-origin', signal: probe.signal })
      .then((response) => {
        // Headers are enough; do not download the body.
        probe.abort();

        const atRest = media.paused && media.currentTime === 0;

        if (!response.ok || state.destroyed || !atRest || srcOf() !== url) return;
        switchToCors();
      })
      .catch(() => undefined);
  };

  const start = (): void => {
    const url = srcOf();

    on('play', onPlay);
    if (taps.has(media) || url === '') return;
    if (isAlwaysClean(url)) {
      state.safe = true;

      return;
    }
    runProbe(url);
  };

  start();

  return {
    read(): LiveSpectrum | null {
      const live = state.destroyed ? undefined : taps.get(media);

      if (!live) return null;
      live.analyser.getByteFrequencyData(live.bytes);

      return { bytes: live.bytes, hzPerBin: live.ctx.sampleRate / live.analyser.fftSize };
    },
    destroy(): void {
      state.destroyed = true;
      probe.abort();
      bound.splice(0).forEach(([type, handler]) => media.removeEventListener(type, handler));
    },
  };
}

import { IconPlayerVolume, IconPlayerVolumeMute } from '../icons';

interface WaveSpec {
  /** Chord x, half chord height and radius of the full wave in IconPlayerVolume. */
  x: number;
  half: number;
  radius: number;
  /** Radius and half sweep (degrees) the wave starts from. */
  startRadius: number;
  startSweep: number;
}

// Full sizes mirror the two wave paths of IconPlayerVolume. Change them together.
const WAVES: WaveSpec[] = [
  { x: 12, half: 2.5, radius: 3.5, startRadius: 2.4, startSweep: 30 },
  { x: 14.5, half: 4.5, radius: 6.5, startRadius: 5.5, startSweep: 22 },
];

/** A wave is fully opaque once it is this far into its own range. */
const FADE_IN = 1 / 6;

const round = (value: number): number => Math.round(value * 100) / 100;

const wavePath = (spec: WaveSpec, grown: number): string => {
  const centerX = spec.x - Math.sqrt(spec.radius ** 2 - spec.half ** 2);
  const fullSweep = Math.asin(spec.half / spec.radius);
  const startSweep = (spec.startSweep * Math.PI) / 180;
  const radius = spec.startRadius + (spec.radius - spec.startRadius) * grown;
  const sweep = startSweep + (fullSweep - startSweep) * grown;
  const x = round(centerX + radius * Math.cos(sweep));
  const dy = radius * Math.sin(sweep);
  const r = round(radius);
  const opacity = grown < FADE_IN ? ` opacity="${round(grown / FADE_IN)}"` : '';

  return `  <path d="M${x} ${round(10 - dy)}A${r} ${r} 0 0 1 ${x} ${round(10 + dy)}" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`;
};

/**
 * The speaker icon for a volume from 0 to 1. Each wave is a whole arc that grows
 * outward: the inner one over the first half of the range, the outer one over
 * the second. At 1 it is the IconPlayerVolume drawing. `muted` adds the cross,
 * so level 0 muted is the IconPlayerVolumeMute drawing.
 */
export const volumeLevelIcon = (level: number, muted = false): string => {
  const volume = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
  const [open, body] = IconPlayerVolume.trim().split('\n');
  const cross = muted ? [IconPlayerVolumeMute.trim().split('\n')[2]] : [];
  const waves = WAVES
    .map((spec, index) => ({ spec, grown: Math.min(1, volume * WAVES.length - index) }))
    .filter(({ grown }) => grown > 0)
    .map(({ spec, grown }) => wavePath(spec, grown));

  return ['', open, body, ...waves, ...cross, '</svg>', ''].join('\n');
};

export interface VolumeIcon {
  /** Draws the icon for this volume. `muted` shows the cross. */
  paint(level: number, muted: boolean): void;
  destroy(): void;
}

/** Share of the remaining distance covered per 60 Hz frame. */
const GLIDE = 0.25;
const FRAME_MS = 1000 / 60;
const SETTLED = 0.004;

const reducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

/**
 * Keeps the speaker icon inside `host` in step with the volume. The waves glide
 * to a new level, so mute, unmute and a click on the slider track do not jump.
 */
export const createVolumeIcon = (host: HTMLElement): VolumeIcon => {
  const state = { shown: 0, target: 0, muted: false, frame: 0, last: 0, painted: false };

  const draw = (): void => {
    const svg = host.querySelector('svg');
    const markup = volumeLevelIcon(state.shown, state.muted);

    // Reuse the svg: the video player animates it, and a new node restarts that.
    if (svg === null) {
      host.replaceChildren();
      host.insertAdjacentHTML('beforeend', markup);

      return;
    }
    svg.innerHTML = markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</svg>'));
  };

  const step = (): void => {
    // Not the frame's own timestamp: it may count from another origin than `last`.
    const now = performance.now();
    const gap = state.target - state.shown;
    const share = 1 - (1 - GLIDE) ** (Math.max(0, now - state.last) / FRAME_MS);

    state.last = now;
    state.shown = Math.abs(gap) < SETTLED ? state.target : state.shown + gap * share;
    draw();
    state.frame = state.shown === state.target ? 0 : requestAnimationFrame(step);
  };

  return {
    paint(level, muted): void {
      state.target = muted ? 0 : Math.min(1, Math.max(0, level));
      state.muted = muted;
      if (!state.painted || reducedMotion()) {
        state.painted = true;
        state.shown = state.target;
      }
      draw();
      if (state.shown !== state.target && state.frame === 0) {
        state.last = performance.now();
        state.frame = requestAnimationFrame(step);
      }
    },
    destroy(): void {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    },
  };
};

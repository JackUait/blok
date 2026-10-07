import { createPreview, h } from '../../components/utils/block-preview';

import { attachControls } from './controls';
import { renderNowPlaying } from './ui';
import { attachWaveform } from './waveform';

const TITLE = 'Late Night Drive';
const ARTIST = 'Nova Lane';
const DURATION = 228;
const START = 72;

// One loop of the card, in ms: rest, press play, play, pause and let the record coast.
const PLAY_AT = 900;
const PAUSE_AT = 8400;
const LOOP = 11000;
// Each loop resumes where the last stopped; after this many the track seeks back to START.
const LOOPS_PER_RUN = 12;

/** 300 buckets like a decoded upload: a soft intro, a verse, then a four-on-the-floor chorus. */
const PEAKS = Array.from({ length: 300 }, (_, i) => {
  const section = [
    [ 18, 0.08 + i * 0.018 ],
    [ 70, 0.42 ],
    [ 76, 0.3 ],
    [ 240, 0.78 ],
    [ 290, 0.62 ],
  ].find(([ end ]) => i < end);
  const base = section?.[1] ?? 0.6 - (i - 290) * 0.055;
  const onBeat = i >= 76 && i < 290;
  const kick = onBeat && i % 6 === 0 ? 0.16 : 0;
  const dip = onBeat && i % 6 === 5 ? 0.08 : 0;
  const grain = (Math.sin(i * 12.9898) * 43758.5453) % 1 * 0.12;

  return Math.max(0.03, Math.min(1, base + grain + kick - dip));
});

const NO_STORAGE = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

const reducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Track position `elapsed` ms into the preview: it only moves while "playing". */
const positionAt = (elapsed: number): number => {
  const loop = Math.floor(elapsed / LOOP) % LOOPS_PER_RUN;
  const intoLoop = elapsed % LOOP;
  const played = Math.min(Math.max(intoLoop - PLAY_AT, 0), PAUSE_AT - PLAY_AT);

  return START + (loop * (PAUSE_AT - PLAY_AT) + played) / 1000;
};

/**
 * The real audio block with no cover art, run by its own waveform, controls and
 * record spin. A stand-in player clock plays a stretch of the track on a loop.
 */
export const renderAudioPreview = (): HTMLElement => {
  const { figure, audio, waveformMount, body } = renderNowPlaying(
    { url: '', title: TITLE, artist: ARTIST },
    { editable: false }
  );
  const clock = { time: START };

  // The <audio> has no source; the block's modules read time from it and listen for its events.
  Object.defineProperties(audio, {
    currentTime: { configurable: true, get: () => clock.time, set: (value: number) => { clock.time = value; } },
    duration: { configurable: true, get: () => DURATION },
  });

  const waveform = attachWaveform({ mount: waveformMount, media: audio, peaks: PEAKS, stage: figure });
  const controls = attachControls({ media: audio, figure, data: { url: '' }, storage: NO_STORAGE, restoreLoop: false });

  body.appendChild(controls.element);
  audio.dispatchEvent(new Event('loadedmetadata'));

  // audio.css styles everything under this attribute; "rendered" runs its mount entrance.
  const block = h('div', { 'data-blok-tool': 'audio', 'data-state': 'rendered' }, figure);
  const run = { start: -1, playing: false };
  const still = reducedMotion();

  const frame = (now: number): void => {
    // The card swaps or hides the drawing without telling it: stop with it.
    if (!block.isConnected || block.closest('[hidden]') !== null) {
      waveform.destroy();
      controls.destroy();

      return;
    }

    if (!still) {
      run.start = run.start < 0 ? now : run.start;

      const elapsed = now - run.start;
      const intoLoop = elapsed % LOOP;
      const playing = intoLoop >= PLAY_AT && intoLoop < PAUSE_AT;

      clock.time = positionAt(elapsed);

      if (playing !== run.playing) {
        run.playing = playing;
        audio.dispatchEvent(new Event(playing ? 'play' : 'pause'));
      }

      audio.dispatchEvent(new Event('timeupdate'));
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);

  return createPreview('audio', block);
};

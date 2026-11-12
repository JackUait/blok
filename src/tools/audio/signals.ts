import { createListener } from './listen';
import {
  bandsFromSpectrum,
  createMotionReader,
  createPeaksReader,
  createSignalCore,
  decodeMotion,
  type InkSignals,
  type SignalReader,
} from './motion';

export interface TrackSignals {
  /** This frame's signals at the media's current time. Silence when nothing can be read. */
  read(dtSec: number): InkSignals;
  destroy(): void;
}

export const SILENCE: InkSignals = { level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 };

/** Saved motion first, then the coarse stored loudness, then nothing. */
const savedReader = (media: HTMLAudioElement, motion?: string, peaks?: number[]): SignalReader | null => {
  const track = motion ? decodeMotion(motion) : null;

  if (track) return createMotionReader(track);
  if (peaks?.length) return createPeaksReader(peaks, () => media.duration);

  return null;
};

/**
 * What the track is doing right now. It listens live where the browser allows
 * it, and otherwise reads what was saved with the block.
 */
export function createTrackSignals(opts: { media: HTMLAudioElement; motion?: string; peaks?: number[] }): TrackSignals {
  const { media } = opts;
  const listener = createListener(media);
  const core = createSignalCore();
  const reader = savedReader(media, opts.motion, opts.peaks);

  return {
    read(dtSec: number): InkSignals {
      const live = listener.read();

      if (live) return core.step(bandsFromSpectrum(live.bytes, live.hzPerBin), dtSec);

      return reader ? reader.read(media.currentTime, dtSec) : SILENCE;
    },
    destroy(): void {
      listener.destroy();
    },
  };
}

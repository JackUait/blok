import {
  IconMinus,
  IconPlayerLoop,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSettings,
  IconPlayerSpeed,
  IconPlayerVolume,
  IconPlayerVolumeMute,
  IconPlus,
} from '../../components/icons';
import { createPlatterSpin } from './disc';
import type { AudioData } from '../../../types/tools/audio';

/** Minimal storage seam (localStorage-shaped) for volume + position persistence. */
export interface AudioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AttachControlsOptions {
  media: HTMLAudioElement;
  figure: HTMLElement;
  data: Pick<AudioData, 'url'>;
  /** Defaults to globalThis.localStorage; pass a custom object for tests. */
  storage?: AudioStorage;
  onLoopChange?(loop: boolean): void;
}

export interface ControlsHandle {
  element: HTMLElement;
  destroy(): void;
}

/** Format a seconds value into `MM:SS` (e.g. 125 → "02:05"). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function button(role: string, label: string, icon: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-role', role);
  btn.setAttribute('aria-label', label);
  btn.innerHTML = icon;
  return btn;
}

/**
 * Build a custom transport control bar for an `<audio>` element and wire it
 * to the media. The waveform (Task 6) serves as the scrubber — this bar does
 * NOT render its own seek track.
 *
 * Returns `{ element, destroy }`. Call `destroy()` to remove every listener
 * and clear all timers.
 */
export function attachControls({
  media: audioEl,
  figure,
  data,
  storage,
  onLoopChange,
}: AttachControlsOptions): ControlsHandle {
  // `media` aliases the destructured param so property writes below are not
  // flagged as parameter reassignment (mirrors the video controls pattern).
  const media = audioEl;

  // ----- fallback storage -----
  const noopStorage: AudioStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const resolvedStorage: AudioStorage = (() => {
    if (storage !== undefined) return storage;
    try {
      return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : noopStorage;
    } catch {
      return noopStorage;
    }
  })();

  const safeGet = (key: string): string | null => {
    try { return resolvedStorage.getItem(key); } catch { return null; }
  };
  const safeSet = (key: string, value: string): void => {
    try { resolvedStorage.setItem(key, value); } catch { /* private mode / quota */ }
  };

  // ----- root element -----
  const root = document.createElement('div');
  root.className = 'blok-audio-controls';
  root.setAttribute('data-role', 'audio-controls');

  // ----- play/pause -----
  const playToggle = button('audio-play', 'Play', IconPlayerPlay);

  const state = { playing: false, selectedRate: 1 };

  // Inertial spin for the no-cover vinyl record (no-op when a cover image is
  // shown — the disc only exists in the placeholder). Spins up on play, coasts
  // down on pause.
  const platter = createPlatterSpin(figure);

  const setPlaying = (next: boolean): void => {
    state.playing = next;
    figure.setAttribute('data-playing', String(next));
    playToggle.innerHTML = next ? IconPlayerPause : IconPlayerPlay;
    playToggle.setAttribute('aria-label', next ? 'Pause' : 'Play');
    if (next) platter.start(); else platter.stop();
  };
  setPlaying(false);

  // ----- time readout -----
  const timeEl = document.createElement('span');
  timeEl.className = 'blok-audio-controls__time';
  timeEl.setAttribute('data-role', 'audio-time');
  timeEl.textContent = '0:00 / 0:00';

  const renderTime = (): void => {
    timeEl.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
  };

  // ----- volume + mute -----
  const muteToggle = button('audio-mute', 'Mute', IconPlayerVolume);
  muteToggle.setAttribute('aria-pressed', 'false');

  const volumeInput = document.createElement('input');
  volumeInput.type = 'range';
  volumeInput.min = '0';
  volumeInput.max = '1';
  volumeInput.step = '0.05';
  volumeInput.value = '1';
  volumeInput.className = 'blok-audio-controls__volume';
  volumeInput.setAttribute('data-role', 'audio-volume');
  volumeInput.setAttribute('aria-label', 'Volume');

  const isMuted = (): boolean => media.muted || media.volume === 0;

  const syncMuteUI = (): void => {
    const muted = isMuted();
    muteToggle.setAttribute('aria-pressed', String(muted));
    muteToggle.innerHTML = muted ? IconPlayerVolumeMute : IconPlayerVolume;
    muteToggle.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    volumeInput.value = muted ? '0' : String(media.volume);
    // audio.css paints the filled track from --blok-audio-vol-pct (same naming
    // as the speed slider's --blok-audio-speed-pct); writing any other name
    // freezes the fill at its 100% default, so muted looks identical to full.
    volumeInput.style.setProperty('--blok-audio-vol-pct', `${Number(volumeInput.value) * 100}%`);
  };

  // ----- persistence -----
  const VOL_KEY = 'blok:audio:volume';
  const posKey = (): string => `blok:audio:pos:${media.currentSrc || data.url}`;

  const persistVolume = (): void => {
    safeSet(VOL_KEY, JSON.stringify({ volume: media.volume, muted: media.muted }));
  };

  const persistState = { lastTime: 0 };
  const persistPosition = (): void => {
    const now = Date.now();
    if (now - persistState.lastTime < 1000) return;
    persistState.lastTime = now;
    safeSet(posKey(), String(media.currentTime));
  };

  // Restore volume immediately on attach; position restored on loadedmetadata.
  const restoreVolume = (): void => {
    const raw = safeGet(VOL_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { volume?: number; muted?: boolean };
      if (typeof parsed.volume === 'number') {
        media.volume = parsed.volume;
        volumeInput.value = String(parsed.volume);
      }
      if (typeof parsed.muted === 'boolean') media.muted = parsed.muted;
      syncMuteUI();
    } catch { /* corrupt entry */ }
  };
  restoreVolume();

  const restorePosition = (): void => {
    const raw = safeGet(posKey());
    if (raw === null) return;
    const target = Number(raw);
    const dur = Number.isFinite(media.duration) ? media.duration : 0;
    if (Number.isFinite(target) && target > 0 && dur > 5 && target < dur - 5) {
      media.currentTime = target;
    }
  };

  // ----- speed gear menu -----
  const SPEED_PRESETS = [0.5, 1, 1.5, 2];
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 2;
  const SPEED_SLIDER_STEP = 0.05;
  const clampRate = (rate: number): number =>
    Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(rate * 100) / 100));
  const speedLabel = (rate: number): string => `${rate}×`;

  const gearBtn = button('audio-speed', 'Playback speed', IconPlayerSettings || IconPlayerSpeed);
  gearBtn.setAttribute('aria-haspopup', 'menu');
  gearBtn.setAttribute('aria-expanded', 'false');

  const speedMenu = document.createElement('div');
  speedMenu.className = 'blok-audio-controls__speed-menu';
  speedMenu.setAttribute('role', 'menu');
  speedMenu.hidden = true;

  const speedReadout = document.createElement('div');
  speedReadout.className = 'blok-audio-controls__speed-readout';
  speedReadout.setAttribute('aria-hidden', 'true');
  speedReadout.textContent = speedLabel(state.selectedRate);

  // − [slider] ＋ — flat steppers flank the track, mirroring the video player.
  // Identified by class only (no data-role) so the generic button[data-role]
  // control-button rule doesn't size them into 30px pills.
  const speedStepper = (icon: string, label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blok-audio-controls__speed-step';
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon;
    return btn;
  };
  const speedDec = speedStepper(IconMinus, 'Decrease playback speed');
  const speedInc = speedStepper(IconPlus, 'Increase playback speed');

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.className = 'blok-audio-controls__speed-slider';
  speedSlider.min = String(SPEED_MIN);
  speedSlider.max = String(SPEED_MAX);
  speedSlider.step = String(SPEED_SLIDER_STEP);
  speedSlider.value = String(state.selectedRate);
  speedSlider.setAttribute('aria-label', 'Playback speed');

  // Drive the elapsed-fill gradient from JS so the painted track tracks the
  // native knob exactly (same approach as the volume + video sliders).
  const speedFillPct = (rate: number): string =>
    `${((rate - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%`;
  speedSlider.style.setProperty('--blok-audio-speed-pct', speedFillPct(state.selectedRate));

  const setRate = (rate: number): void => {
    const next = clampRate(rate);
    state.selectedRate = next;
    media.playbackRate = next;
    speedReadout.textContent = speedLabel(next);
    speedSlider.value = String(next);
    speedSlider.setAttribute('aria-valuetext', speedLabel(next));
    speedSlider.style.setProperty('--blok-audio-speed-pct', speedFillPct(next));
    speedDec.disabled = next <= SPEED_MIN;
    speedInc.disabled = next >= SPEED_MAX;
  };

  const onSpeedSliderInput = (): void => setRate(Number(speedSlider.value));
  speedSlider.addEventListener('input', onSpeedSliderInput);
  speedDec.addEventListener('click', () => setRate(state.selectedRate - SPEED_SLIDER_STEP));
  speedInc.addEventListener('click', () => setRate(state.selectedRate + SPEED_SLIDER_STEP));
  speedDec.disabled = state.selectedRate <= SPEED_MIN;
  speedInc.disabled = state.selectedRate >= SPEED_MAX;

  const speedSliderRow = document.createElement('div');
  speedSliderRow.className = 'blok-audio-controls__speed-slider-row';
  speedSliderRow.append(speedDec, speedSlider, speedInc);

  // Quiet quick-jump presets (mirrors the video player): every chip reads the
  // same muted weight, lifting only on hover. The live rate is communicated by
  // the readout + slider knob, not a filled "selected" chip.
  const speedChipRow = document.createElement('div');
  speedChipRow.className = 'blok-audio-controls__speed-chips';
  SPEED_PRESETS.forEach((rate) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'blok-audio-controls__speed-chip';
    chip.textContent = `${rate}×`;
    // Apply the preset but leave the menu open so the user can keep nudging the
    // rate (slider/steppers/other presets) without re-opening it each time.
    chip.addEventListener('click', () => setRate(rate));
    speedChipRow.appendChild(chip);
  });

  speedMenu.append(speedReadout, speedSliderRow, speedChipRow);

  // Gear + menu share a positioned wrapper so the menu anchors directly above
  // the gear button (rather than the card corner).
  const speedWrap = document.createElement('div');
  speedWrap.className = 'blok-audio-controls__speed-wrap';
  speedWrap.append(gearBtn, speedMenu);

  const openSpeedMenu = (): void => {
    if (!speedMenu.hidden) return;
    speedMenu.hidden = false;
    gearBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onSpeedMenuOutside);
  };
  const closeSpeedMenu = (): void => {
    if (speedMenu.hidden) return;
    speedMenu.hidden = true;
    gearBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onSpeedMenuOutside);
  };
  const onSpeedMenuOutside = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && (gearBtn.contains(target) || speedMenu.contains(target))) return;
    closeSpeedMenu();
  };

  const onGearClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (speedMenu.hidden) openSpeedMenu();
    else closeSpeedMenu();
  };
  gearBtn.addEventListener('click', onGearClick);

  // ----- loop -----
  const loopBtn = button('audio-loop', 'Loop', IconPlayerLoop);
  loopBtn.setAttribute('aria-pressed', String(media.loop));

  // ----- assemble bar -----
  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'blok-audio-controls__volume-wrap';
  volumeWrap.append(muteToggle, volumeInput);

  root.append(playToggle, timeEl, volumeWrap, speedWrap, loopBtn);

  // ----- intent handlers -----
  const togglePlay = (): void => {
    if (state.playing) media.pause();
    else void media.play();
  };

  const onMuteClick = (): void => {
    media.muted = !media.muted;
    syncMuteUI();
    persistVolume();
  };

  const onVolumeInput = (): void => {
    const v = Number(volumeInput.value);
    media.volume = v;
    media.muted = v === 0;
    syncMuteUI();
    persistVolume();
  };

  const onLoopClick = (): void => {
    media.loop = !media.loop;
    loopBtn.setAttribute('aria-pressed', String(media.loop));
    onLoopChange?.(media.loop);
  };

  // ----- media event handlers -----
  const onPlay = (): void => setPlaying(true);
  const onPause = (): void => setPlaying(false);
  const onTimeUpdate = (): void => {
    renderTime();
    persistPosition();
  };
  const onLoadedMetadata = (): void => {
    renderTime();
    restorePosition();
  };
  const onVolumeChange = (): void => syncMuteUI();

  // ----- keyboard handler on figure -----
  const SEEK_STEP = 5;
  const VOL_STEP = 0.05;

  const onFigureKeydown = (event: KeyboardEvent): void => {
    // Ignore events originating from contenteditable targets.
    if ((event.target as Element | null)?.matches?.('[contenteditable="true"]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const dur = Number.isFinite(media.duration) ? media.duration : 0;

    switch (event.key) {
      case ' ':
      case 'Spacebar':
      case 'k':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        media.currentTime = Math.max(0, media.currentTime - SEEK_STEP);
        break;
      case 'ArrowRight':
        event.preventDefault();
        media.currentTime = Math.min(dur || media.currentTime, media.currentTime + SEEK_STEP);
        break;
      case 'm':
        event.preventDefault();
        onMuteClick();
        break;
      case 'ArrowUp':
        event.preventDefault();
        media.volume = Math.min(1, media.volume + VOL_STEP);
        syncMuteUI();
        persistVolume();
        break;
      case 'ArrowDown':
        event.preventDefault();
        media.volume = Math.max(0, media.volume - VOL_STEP);
        syncMuteUI();
        persistVolume();
        break;
      default:
        if (event.key.length === 1 && event.key >= '0' && event.key <= '9' && dur > 0) {
          event.preventDefault();
          media.currentTime = (dur * Number(event.key)) / 10;
        }
    }
  };

  // ----- wire up all listeners -----
  playToggle.addEventListener('click', togglePlay);
  muteToggle.addEventListener('click', onMuteClick);
  volumeInput.addEventListener('input', onVolumeInput);
  loopBtn.addEventListener('click', onLoopClick);

  media.addEventListener('play', onPlay);
  media.addEventListener('pause', onPause);
  media.addEventListener('timeupdate', onTimeUpdate);
  media.addEventListener('loadedmetadata', onLoadedMetadata);
  media.addEventListener('volumechange', onVolumeChange);

  figure.addEventListener('keydown', onFigureKeydown);

  // ----- destroy -----
  const destroy = (): void => {
    platter.destroy();
    closeSpeedMenu();

    playToggle.removeEventListener('click', togglePlay);
    muteToggle.removeEventListener('click', onMuteClick);
    volumeInput.removeEventListener('input', onVolumeInput);
    loopBtn.removeEventListener('click', onLoopClick);
    gearBtn.removeEventListener('click', onGearClick);
    speedSlider.removeEventListener('input', onSpeedSliderInput);

    media.removeEventListener('play', onPlay);
    media.removeEventListener('pause', onPause);
    media.removeEventListener('timeupdate', onTimeUpdate);
    media.removeEventListener('loadedmetadata', onLoadedMetadata);
    media.removeEventListener('volumechange', onVolumeChange);

    figure.removeEventListener('keydown', onFigureKeydown);

    speedMenu.remove();
    root.remove();
  };

  return { element: root, destroy };
}

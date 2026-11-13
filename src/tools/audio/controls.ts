import {
  IconMinus,
  IconPlayerLoop,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSettings,
  IconPlayerSpeed,
  IconPlayerVolume,
  IconPlus,
} from '../../components/icons';
import { createVolumeIcon } from '../../components/utils/volume-icon';
import { tr } from './i18n';
import { SPEED_MAX, SPEED_MIN, SPEED_PEGS, SPEED_SLIDER_STEP, clampRate, rateToFraction, snapRate } from '../video/speed-scale';
import { createSpeedWire } from '../video/speed-wire';
import type { I18nInstance } from '../../components/utils/tools';
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
  /**
   * Whether the stored loop preference overrides the element's seed. Pass false
   * when the block is rebuilt from its data (undo/redo): the data is the truth then.
   * Defaults to true.
   */
  restoreLoop?: boolean;
  /** Editor i18n instance used to translate control labels. */
  i18n?: I18nInstance;
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
 * to the media: play, time, a seek slider, volume, speed and loop.
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
  restoreLoop = true,
  i18n,
}: AttachControlsOptions): ControlsHandle {
  // `media` aliases the destructured param so property writes below are not
  // flagged as parameter reassignment (mirrors the video controls pattern).
  const media = audioEl;
  // Resolve a control label through i18n with an English fallback.
  const i18nLabel = (key: string, fallback: string): string => tr(i18n, `tools.audio.${key}`, fallback);

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
  const playToggle = button('audio-play', i18nLabel('play', 'Play'), IconPlayerPlay);

  const state = { playing: false, selectedRate: 1 };

  const setPlaying = (next: boolean): void => {
    state.playing = next;
    figure.setAttribute('data-playing', String(next));
    playToggle.innerHTML = next ? IconPlayerPause : IconPlayerPlay;
    playToggle.setAttribute('aria-label', next ? i18nLabel('pause', 'Pause') : i18nLabel('play', 'Play'));
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

  // ----- seek -----
  const seekInput = document.createElement('input');
  seekInput.type = 'range';
  // Native ranges reverse in RTL; the fill gradient runs LTR.
  seekInput.dir = 'ltr';
  seekInput.min = '0';
  seekInput.max = '1';
  // A stepped range snaps the thumb, so it would not glide.
  seekInput.step = 'any';
  seekInput.value = '0';
  seekInput.className = 'blok-audio-controls__seek';
  seekInput.setAttribute('data-role', 'audio-seek');
  seekInput.setAttribute('aria-label', i18nLabel('seek', 'Seek'));

  const trackLength = (): number => (Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0);

  const placeSeek = (): void => {
    const length = trackLength();
    const ratio = length ? Math.min(1, media.currentTime / length) : 0;

    seekInput.value = String(ratio);
    seekInput.style.setProperty('--blok-audio-seek-pct', `${Number((ratio * 100).toFixed(3))}%`);
  };

  const syncSeek = (): void => {
    placeSeek();
    seekInput.setAttribute('aria-valuetext', timeEl.textContent ?? '');
  };

  // `timeupdate` fires only a few times a second, so the thumb follows the
  // track on every frame while it plays.
  const seekFollow = { raf: 0 };

  const stopSeekFollow = (): void => {
    if (seekFollow.raf) globalThis.cancelAnimationFrame(seekFollow.raf);
    seekFollow.raf = 0;
  };

  const followSeek = (): void => {
    placeSeek();
    seekFollow.raf = globalThis.requestAnimationFrame(followSeek);
  };

  const startSeekFollow = (): void => {
    stopSeekFollow();
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    seekFollow.raf = globalThis.requestAnimationFrame(followSeek);
  };

  const onSeekInput = (): void => {
    const length = trackLength();

    if (length) media.currentTime = Number(seekInput.value) * length;
    renderTime();
    syncSeek();
  };

  // ----- volume + mute -----
  const muteToggle = button('audio-mute', i18nLabel('mute', 'Mute'), IconPlayerVolume);
  muteToggle.setAttribute('aria-pressed', 'false');

  const volumeInput = document.createElement('input');
  volumeInput.type = 'range';
  // Native ranges reverse in RTL; the fill gradient and pointer math run LTR.
  volumeInput.dir = 'ltr';
  volumeInput.min = '0';
  volumeInput.max = '1';
  volumeInput.step = '0.05';
  volumeInput.value = '1';
  volumeInput.className = 'blok-audio-controls__volume';
  volumeInput.setAttribute('data-role', 'audio-volume');
  volumeInput.setAttribute('aria-label', i18nLabel('volume', 'Volume'));

  const isMuted = (): boolean => media.muted || media.volume === 0;
  const volumeIcon = createVolumeIcon(muteToggle);

  const syncMuteUI = (): void => {
    const muted = isMuted();
    muteToggle.setAttribute('aria-pressed', String(muted));
    volumeIcon.paint(media.volume, muted);
    muteToggle.setAttribute('aria-label', muted ? i18nLabel('unmute', 'Unmute') : i18nLabel('mute', 'Mute'));
    volumeInput.value = muted ? '0' : String(media.volume);
    // audio.css paints the filled track from --blok-audio-vol-pct; writing any other
    // name freezes the fill at its 100% default, so muted looks identical to full.
    volumeInput.style.setProperty('--blok-audio-vol-pct', `${Number(volumeInput.value) * 100}%`);
  };

  // ----- persistence -----
  // Volume, rate and loop are shared across every audio block; position is per-track.
  const VOL_KEY = 'blok:audio:volume';
  const RATE_KEY = 'blok:audio:rate';
  const LOOP_KEY = 'blok:audio:loop';
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
  const restoreVolume = (raw: string | null = safeGet(VOL_KEY)): void => {
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
  // The first paint never glides, so it must follow the restore.
  volumeIcon.paint(media.volume, isMuted());

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
  // The video player's speed card: a big value between − and +, a bead on a wire
  // with a peg per preset, and one plain button under each peg.
  const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const gearBtn = button('audio-speed', i18nLabel('playbackSpeed', 'Playback speed'), IconPlayerSettings || IconPlayerSpeed);
  gearBtn.setAttribute('aria-haspopup', 'menu');
  gearBtn.setAttribute('aria-expanded', 'false');

  const speedMenu = document.createElement('div');
  speedMenu.className = 'blok-audio-controls__speed-menu';
  speedMenu.setAttribute('role', 'menu');
  speedMenu.hidden = true;

  const speedSpan = (className: string, text = ''): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  };

  // The live value. The range input inside the wire carries it for assistive tech.
  const speedReadout = document.createElement('div');
  speedReadout.className = 'blok-audio-controls__speed-readout';
  speedReadout.setAttribute('aria-hidden', 'true');
  const readoutDigits = speedSpan('blok-audio-controls__speed-readout-digits');
  speedReadout.append(readoutDigits, speedSpan('blok-audio-controls__speed-readout-unit', '×'));

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
  const speedDec = speedStepper(IconMinus, i18nLabel('speedDecrease', 'Decrease playback speed'));
  const speedInc = speedStepper(IconPlus, i18nLabel('speedIncrease', 'Increase playback speed'));

  const speedStepperRow = document.createElement('div');
  speedStepperRow.className = 'blok-audio-controls__speed-stepper';
  speedStepperRow.append(speedDec, speedReadout, speedInc);

  // setRate is declared just below; the wire only calls back on interaction.
  const speedWire = createSpeedWire({
    label: i18nLabel('playbackSpeed', 'Playback speed'),
    reducedMotion,
    classPrefix: 'blok-audio-controls',
    onRate: (rate) => setRate(rate),
  });

  // Only the characters that changed roll in: up for a faster speed, down for a slower one.
  const readout = { text: '' };
  const paintReadout = (rate: number, rising: boolean): void => {
    const text = String(rate);
    if (text === readout.text) return;
    const digits = [...text].map((char, i) => {
      const digit = speedSpan('blok-audio-controls__speed-digit', char);
      if (readout.text !== '' && readout.text[i] !== char) digit.setAttribute('data-roll', rising ? 'up' : 'down');
      return digit;
    });
    readoutDigits.replaceChildren(...digits);
    readout.text = text;
  };

  const syncSpeedUi = (rate: number, previous: number): void => {
    paintReadout(rate, rate > previous);
    speedDec.disabled = rate <= SPEED_MIN;
    speedInc.disabled = rate >= SPEED_MAX;
    speedWire.sync(rate);
  };
  const setRate = (rate: number): void => {
    const previous = state.selectedRate;
    const next = clampRate(rate);
    state.selectedRate = next;
    media.playbackRate = next;
    syncSpeedUi(next, previous);
    safeSet(RATE_KEY, String(next));
  };
  syncSpeedUi(state.selectedRate, state.selectedRate);

  // Restore the shared playback speed through setRate so the menu UI stays in sync.
  const storedRate = Number(safeGet(RATE_KEY) ?? NaN);
  if (Number.isFinite(storedRate) && storedRate > 0) setRate(storedRate);

  // Minus and plus: one step per press, and a held button keeps stepping.
  const STEP_HOLD_DELAY = 350;
  const STEP_HOLD_EVERY = 70;
  const stepHold = { delay: 0, repeat: 0 };
  const stopStepHold = (): void => {
    window.clearTimeout(stepHold.delay);
    window.clearInterval(stepHold.repeat);
    stepHold.delay = 0;
    stepHold.repeat = 0;
  };
  const stepRate = (delta: number): void => {
    setRate(snapRate(state.selectedRate + delta));
    // A disabled button gets no pointerup, so the end of the range ends the hold.
    if (state.selectedRate <= SPEED_MIN || state.selectedRate >= SPEED_MAX) stopStepHold();
  };
  const wireStep = (step: HTMLButtonElement, delta: number): void => {
    step.addEventListener('pointerdown', (event) => {
      if (event.button > 0) return;
      stopStepHold();
      stepRate(delta);
      stepHold.delay = window.setTimeout(() => {
        stepHold.repeat = window.setInterval(() => stepRate(delta), STEP_HOLD_EVERY);
      }, STEP_HOLD_DELAY);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((type) => step.addEventListener(type, stopStepHold));
    // The pointer already stepped on press. detail 0 is a keyboard or scripted click.
    step.addEventListener('click', (event) => { if (event.detail === 0) stepRate(delta); });
  };
  wireStep(speedDec, -SPEED_SLIDER_STEP);
  wireStep(speedInc, SPEED_SLIDER_STEP);

  // Presets only set a value. They never show a selected state: the bead on the
  // peg above already says which one is current. The card stays open after a pick.
  const speedPresets = document.createElement('div');
  speedPresets.className = 'blok-audio-controls__speed-presets';
  speedPresets.dir = 'ltr';
  SPEED_PEGS.forEach((rate) => {
    const preset = document.createElement('button');
    preset.type = 'button';
    preset.className = 'blok-audio-controls__speed-preset';
    // Where its peg sits along the wire; audio.css centres the button under it.
    preset.style.setProperty('--blok-audio-speed-at', String(rateToFraction(rate)));
    preset.textContent = `${rate}×`;
    preset.addEventListener('click', () => setRate(rate));
    speedPresets.appendChild(preset);
  });

  speedMenu.append(speedStepperRow, speedWire.element, speedPresets);

  // Gear + menu share a positioned wrapper so the menu anchors directly above
  // the gear button (rather than the card corner).
  const speedWrap = document.createElement('div');
  speedWrap.className = 'blok-audio-controls__speed-wrap';
  speedWrap.append(gearBtn, speedMenu);

  // The card opens from the gear's edge and may cross the window's; slide it back in.
  const WINDOW_EDGE_GAP = 8;
  const keepMenuInWindow = (): void => {
    speedMenu.style.removeProperty('translate');
    const box = speedMenu.getBoundingClientRect();
    if (!box.width) return;
    const limit = document.documentElement.clientWidth - WINDOW_EDGE_GAP;
    const shift = box.right > limit ? limit - box.right : Math.max(0, WINDOW_EDGE_GAP - box.left);
    if (shift !== 0) speedMenu.style.setProperty('translate', `${shift}px`);
  };

  const openSpeedMenu = (): void => {
    if (!speedMenu.hidden) return;
    speedMenu.hidden = false;
    gearBtn.setAttribute('aria-expanded', 'true');
    keepMenuInWindow();
    speedWire.enter();
    document.addEventListener('mousedown', onSpeedMenuOutside);
  };
  const closeSpeedMenu = (): void => {
    stopStepHold();
    if (speedMenu.hidden) return;
    speedMenu.hidden = true;
    gearBtn.setAttribute('aria-expanded', 'false');
    speedWire.rest();
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
  // The shared stored preference wins over any seed on the element; restoring is
  // not a user toggle, so it does not notify onLoopChange (block data untouched).
  const storedLoop = restoreLoop ? safeGet(LOOP_KEY) : null;
  if (storedLoop !== null) media.loop = storedLoop === 'true';
  const loopBtn = button('audio-loop', i18nLabel('loop', 'Loop'), IconPlayerLoop);
  loopBtn.setAttribute('aria-pressed', String(media.loop));

  // Another tab changed a shared preference. Exact keys only: position is per-tab.
  // Like the mount-time restore, this never notifies onLoopChange.
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea !== resolvedStorage || event.newValue === null) return;
    if (event.key === VOL_KEY) {
      restoreVolume(event.newValue);
    } else if (event.key === RATE_KEY) {
      const rate = Number(event.newValue);
      if (Number.isFinite(rate) && rate > 0) setRate(rate);
    } else if (event.key === LOOP_KEY) {
      media.loop = event.newValue === 'true';
      loopBtn.setAttribute('aria-pressed', String(media.loop));
    }
  };
  window.addEventListener('storage', onStorage);

  // ----- assemble bar -----
  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'blok-audio-controls__volume-wrap';
  volumeWrap.append(muteToggle, volumeInput);

  root.append(playToggle, timeEl, seekInput, volumeWrap, speedWrap, loopBtn);

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
    safeSet(LOOP_KEY, String(media.loop));
    onLoopChange?.(media.loop);
  };

  // ----- media event handlers -----
  const onPlay = (): void => {
    setPlaying(true);
    startSeekFollow();
  };
  const onPause = (): void => {
    setPlaying(false);
    stopSeekFollow();
  };
  const onTimeUpdate = (): void => {
    renderTime();
    syncSeek();
    persistPosition();
  };
  const onLoadedMetadata = (): void => {
    renderTime();
    restorePosition();
    syncSeek();
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
  seekInput.addEventListener('input', onSeekInput);
  loopBtn.addEventListener('click', onLoopClick);

  media.addEventListener('play', onPlay);
  media.addEventListener('pause', onPause);
  media.addEventListener('timeupdate', onTimeUpdate);
  media.addEventListener('loadedmetadata', onLoadedMetadata);
  media.addEventListener('volumechange', onVolumeChange);

  figure.addEventListener('keydown', onFigureKeydown);

  // ----- destroy -----
  const destroy = (): void => {
    stopSeekFollow();
    closeSpeedMenu();

    playToggle.removeEventListener('click', togglePlay);
    muteToggle.removeEventListener('click', onMuteClick);
    volumeInput.removeEventListener('input', onVolumeInput);
    seekInput.removeEventListener('input', onSeekInput);
    loopBtn.removeEventListener('click', onLoopClick);
    gearBtn.removeEventListener('click', onGearClick);
    speedWire.destroy();

    media.removeEventListener('play', onPlay);
    media.removeEventListener('pause', onPause);
    media.removeEventListener('timeupdate', onTimeUpdate);
    media.removeEventListener('loadedmetadata', onLoadedMetadata);
    media.removeEventListener('volumechange', onVolumeChange);
    volumeIcon.destroy();

    figure.removeEventListener('keydown', onFigureKeydown);
    window.removeEventListener('storage', onStorage);

    speedMenu.remove();
    root.remove();
  };

  return { element: root, destroy };
}

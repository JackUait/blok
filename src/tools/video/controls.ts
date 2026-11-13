import {
  IconChevronLeft,
  IconChevronRight,
  IconExpandFullscreen,
  IconMinus,
  IconPlayerBackward,
  IconPlayerForward,
  IconCollapseFullscreen,
  IconPlayerLoop,
  IconPlayerPause,
  IconPlayerPip,
  IconPlayerPlay,
  IconPlayerSettings,
  IconPlayerSpeed,
  IconPlayerTheater,
  IconPlayerVolume,
  IconPlus,
} from '../../components/icons';
import { promoteToTopLayer, removeFromTopLayer, supportsPopoverAPI } from '../../components/utils/top-layer';
import { isKeyboardModality } from '../../components/utils/input-modality';
import { createVolumeIcon } from '../../components/utils/volume-icon';
import { getElementDirection } from '../../components/utils/direction';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { tr } from './i18n';
import { SPEED_MAX, SPEED_MIN, SPEED_PEGS, SPEED_SLIDER_STEP, clampRate, rateToFraction, snapRate } from './speed-scale';
import { createSpeedEntry } from './speed-entry';
import { createSpeedWire } from './speed-wire';
import type { I18nInstance } from '../../components/utils/tools';
import type { VideoGlow } from '../../../types/tools/video';

/** Minimal storage seam (localStorage-shaped) for volume + position persistence. */
export interface VideoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ControlsOptions {
  video: HTMLVideoElement;
  figure: HTMLElement;
  /** Defaults to window.localStorage; pass null to disable persistence. */
  storage?: VideoStorage | null;
  /** Ambient glow intensity behind the player. Default 'minimal'. */
  glow?: VideoGlow;
  /** Initial loop state (persisted via the block's Loop tune). Default false. */
  loop?: boolean;
  /** Explicit block choice wins over the shared preference on attach. */
  loopOverride?: boolean;
  /** Called when the player changes the shared Loop preference. */
  onLoopChange?: () => void;
  /** Editor i18n instance used to translate control labels. */
  i18n?: I18nInstance;
  readOnly?: boolean;
}

export interface ControlsHandle {
  element: HTMLElement;
  /** Enter/leave theater (cinema) mode programmatically — used by the tool to
   *  re-apply theater after a re-render. */
  setTheater(on: boolean): void;
  toggleStats(): void;
  destroy(): void;
}

/** Format a seconds value into `m:ss` (e.g. 125 → "2:05"). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Buffered-ahead percentage (0..100) for the loaded bar. Picks the buffered
 * range that contains `currentTime`; failing that, the last range ending before
 * it (so a forward gap still shows real progress). Returns 0 for missing/empty
 * ranges or a non-positive/non-finite duration (e.g. a live stream).
 */
export function bufferedPct(buffered: TimeRanges | null, currentTime: number, duration: number): number {
  if (!buffered || buffered.length === 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const ranges = Array.from({ length: buffered.length }, (_, i) => ({
    start: buffered.start(i),
    end: buffered.end(i),
  }));
  // Prefer the range straddling the playhead; else the last range that ended
  // before it (a forward gap still shows real progress).
  const containing = ranges.find((r) => r.start <= currentTime && currentTime <= r.end);
  const before = ranges.filter((r) => r.end <= currentTime).at(-1);
  const end = containing?.end ?? before?.end ?? 0;
  return Math.min(100, Math.max(0, (end / duration) * 100));
}

/** Clamp a 0..1 scrubber ratio to a time, guarding non-finite duration. */
export function timeAtRatio(ratio: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, ratio)) * duration;
}

/** 0..1 ratio of a pointer's x within a track rect; 0 when the rect has no width. */
export function ratioFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

const playedSources = new Set<string>();

function button(action: string, label: string, icon: string, extraClass = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-action', action);
  btn.setAttribute('aria-label', label);
  btn.className = `blok-video-controls__btn ${extraClass}`.trim();
  btn.innerHTML = icon;
  return btn;
}

/**
 * Build an Airbnb-inspired custom control surface for a `<video>` element and
 * wire it to the media. The native `controls` attribute is intentionally
 * absent — this fully replaces it (play/pause, scrubber, time, volume,
 * fullscreen). Returns the control element plus a teardown that detaches every
 * media listener.
 */
export function attachControls({ video, figure, storage, glow = 'minimal', loop = false, loopOverride, onLoopChange, i18n, readOnly = false }: ControlsOptions): ControlsHandle {
  // Resolve a control label through i18n with an English fallback (mirrors the
  // block's tunes). Named `i18nLabel` to avoid shadowing the local `t`/`label`
  // loop variables used by the speed glide + seek-flash helpers below.
  const i18nLabel = (key: string, fallback: string): string => tr(i18n, `tools.video.${key}`, fallback);
  const root = document.createElement('div');
  root.className = 'blok-video-controls';
  root.setAttribute('data-role', 'video-controls');
  if (!readOnly) root.setAttribute(DATA_ATTR.blockContextMenu, '');

  // Momentary centre burst — flashes the action's glyph (à la native players)
  // each time playback toggles, then animates out.
  const burst = document.createElement('div');
  burst.className = 'blok-video-controls__burst';
  burst.setAttribute('data-role', 'play-burst');
  burst.setAttribute('aria-hidden', 'true');
  root.appendChild(burst);

  // Press-and-hold speed badge — surfaces "2×" while the user holds the video
  // down to scrub through at double speed (à la mobile YouTube), then fades.
  const speedBadge = document.createElement('div');
  speedBadge.className = 'blok-video-controls__speed';
  speedBadge.setAttribute('data-role', 'speed-badge');
  speedBadge.setAttribute('aria-hidden', 'true');
  speedBadge.innerHTML = `<span class="blok-video-controls__speed-label">2×</span>${IconPlayerForward}`;
  root.appendChild(speedBadge);

  // Arrow-key seek indicator — a frosted pill that flashes in from the left or
  // right edge when the user nudges playback back/forward with the arrow keys.
  const seekFlash = document.createElement('div');
  seekFlash.className = 'blok-video-controls__seek-flash';
  seekFlash.setAttribute('data-role', 'seek-flash');
  seekFlash.setAttribute('aria-hidden', 'true');
  root.appendChild(seekFlash);

  // Large centre play affordance — shown while paused at the very start (à la
  // native players); a click begins playback.
  const centerPlay = document.createElement('button');
  centerPlay.type = 'button';
  centerPlay.className = 'blok-video-controls__center';
  centerPlay.setAttribute('data-role', 'center-play');
  centerPlay.setAttribute('aria-label', i18nLabel('play', 'Play'));
  centerPlay.innerHTML = IconPlayerPlay;
  root.appendChild(centerPlay);

  // Buffering spinner — toggled by the media's waiting/playing/canplay events.
  const spinner = document.createElement('div');
  spinner.className = 'blok-video-controls__spinner';
  spinner.setAttribute('data-role', 'buffer-spinner');
  spinner.setAttribute('data-active', 'false');
  spinner.setAttribute('aria-hidden', 'true');
  root.appendChild(spinner);

  // Bottom scrim + control bar.
  const bar = document.createElement('div');
  bar.className = 'blok-video-controls__bar';

  const playToggle = button('play-toggle', i18nLabel('play', 'Play'), IconPlayerPlay);

  const seek = document.createElement('input');
  seek.type = 'range';
  // Native ranges reverse in RTL; the fill gradient and pointer math run LTR.
  seek.dir = 'ltr';
  seek.min = '0';
  seek.max = '0';
  seek.step = 'any';
  seek.value = '0';
  seek.className = 'blok-video-controls__seek';
  seek.setAttribute('data-role', 'seek');
  seek.setAttribute('aria-label', i18nLabel('seek', 'Seek'));

  // The range input can't host a child fill, so wrap it: a buffered (loaded)
  // layer sits behind the input's transparent track, and a hover tooltip floats
  // above. The wrap carries the flex-grow the bare input used to.
  const seekWrap = document.createElement('div');
  seekWrap.className = 'blok-video-controls__seek-wrap';
  seekWrap.setAttribute('data-role', 'seek-wrap');

  const seekBuffered = document.createElement('div');
  seekBuffered.className = 'blok-video-controls__buffered';
  seekBuffered.setAttribute('data-role', 'seek-buffered');
  seekBuffered.setAttribute('aria-hidden', 'true');

  const seekTooltip = document.createElement('div');
  seekTooltip.className = 'blok-video-controls__seek-tooltip';
  seekTooltip.setAttribute('data-role', 'seek-tooltip');
  seekTooltip.setAttribute('aria-hidden', 'true');

  // Frame preview — a canvas the hover handler paints with the frame at the
  // pointed-to time, stacked above the timecode label.
  const seekThumb = document.createElement('canvas');
  seekThumb.className = 'blok-video-controls__seek-thumb';
  seekThumb.setAttribute('data-role', 'seek-thumb');
  seekThumb.setAttribute('aria-hidden', 'true');

  const seekTime = document.createElement('span');
  seekTime.className = 'blok-video-controls__seek-time';
  seekTime.setAttribute('data-role', 'seek-time');

  seekTooltip.append(seekThumb, seekTime);
  seekWrap.append(seekBuffered, seek, seekTooltip);

  // A real <button> (not a span+role) so it is natively focusable and
  // keyboard-operable; toggles elapsed ↔ remaining on click/Enter/Space.
  const time = document.createElement('button');
  time.type = 'button';
  time.className = 'blok-video-controls__time';
  time.setAttribute('data-role', 'time');
  // Named by the time it shows: an aria-label would hide it (WCAG 2.5.3).
  time.setAttribute('aria-description', i18nLabel('toggleTimeDisplay', 'Switch between elapsed and remaining time'));
  time.textContent = '0:00 / 0:00';

  const muteToggle = button('mute-toggle', i18nLabel('mute', 'Mute'), IconPlayerVolume);
  muteToggle.setAttribute('aria-pressed', 'false');

  const volume = document.createElement('input');
  volume.type = 'range';
  volume.dir = 'ltr';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = '1';
  volume.className = 'blok-video-controls__volume';
  volume.setAttribute('data-role', 'volume');
  volume.setAttribute('aria-label', i18nLabel('volume', 'Volume'));

  const fullscreen = button('fullscreen', i18nLabel('fullscreen', 'Full screen'), IconExpandFullscreen);

  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'blok-video-controls__volume-wrap';
  volumeWrap.append(muteToggle, volume);

  bar.append(playToggle, volumeWrap, time, seekWrap, fullscreen);
  root.appendChild(bar);

  // Thin elapsed line pinned to the player's bottom edge — reads the shared
  // `--blok-seek-pct` and is revealed by CSS only while the control bar is
  // hidden (the auto-hide bucket sets that state).
  const miniProgress = document.createElement('div');
  miniProgress.className = 'blok-video-controls__mini';
  miniProgress.setAttribute('data-role', 'mini-progress');
  miniProgress.setAttribute('aria-hidden', 'true');
  root.appendChild(miniProgress);

  // Fullscreen title bar — the block's caption surfaced at the top of the
  // immersive surface (à la YouTube), fading in/out with the control bar. Stays
  // `hidden` outside fullscreen, so it never bleeds into the inline player.
  const titleBar = document.createElement('div');
  titleBar.className = 'blok-video-controls__title';
  titleBar.setAttribute('data-role', 'video-title');
  titleBar.hidden = true;
  root.appendChild(titleBar);

  // ----- state sync -----
  // `media` aliases the param so the property writes below are not flagged as
  // parameter reassignment.
  const media = video;
  // Seed the live loop state from the persisted Loop tune so the gear/context
  // menus open already reflecting it (otherwise they'd read "Off" while looping).
  media.loop = loop;
  const state = {
    playing: false,
    selectedRate: 1,
    timeMode: 'elapsed' as 'elapsed' | 'remaining',
    idleTimer: 0,
  };

  const setPlaying = (next: boolean): void => {
    state.playing = next;
    figure.setAttribute('data-playing', String(next));
    const icon = next ? IconPlayerPause : IconPlayerPlay;
    playToggle.innerHTML = icon;
    playToggle.setAttribute('aria-label', next ? i18nLabel('pause', 'Pause') : i18nLabel('play', 'Play'));
    // Shown whenever paused, at any position: a paused video with no play button
    // looks like a picture.
    centerPlay.hidden = next;
  };
  setPlaying(false);

  // Until the user first plays a video, hover shows only the centre play
  // button. The set keeps that across re-renders for the rest of the page load.
  const markPlayed = (): void => {
    figure.setAttribute('data-played', 'true');
    if (video.src) playedSources.add(video.src);
  };
  figure.setAttribute('data-played', String(video.src !== '' && playedSources.has(video.src)));

  // Announce the scrubber as a human-readable "M:SS of M:SS" (it otherwise reads
  // raw seconds). Reads the slider's own value/max so arrow-key seeks announce
  // the target position, and honours a `{current}/{total}` i18n template.
  const setSeekValueText = (): void => {
    const current = formatTime(Number(seek.value));
    const total = formatTime(Number(seek.max));
    const key = 'tools.video.seekValueText';
    seek.setAttribute(
      'aria-valuetext',
      i18n?.has(key) ? i18n.t(key, { current, total }) : `${current} of ${total}`,
    );
  };
  setSeekValueText();

  const renderTime = (): void => {
    setSeekValueText();
    if (state.timeMode === 'remaining') {
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      time.textContent = `-${formatTime(Math.max(0, dur - video.currentTime))}`;
    } else {
      time.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    }
  };
  // Click / Enter / Space on the time label flips elapsed ↔ remaining.
  const toggleTimeMode = (): void => {
    state.timeMode = state.timeMode === 'elapsed' ? 'remaining' : 'elapsed';
    renderTime();
  };

  // Centre play visibility + buffering spinner.
  const updateCenter = (): void => {
    centerPlay.hidden = state.playing;
  };
  const onWaiting = (): void => spinner.setAttribute('data-active', 'true');
  const onPlayingMedia = (): void => { spinner.setAttribute('data-active', 'false'); updateCenter(); };
  const onCanPlay = (): void => spinner.setAttribute('data-active', 'false');

  // Paint the elapsed portion of the scrubber with the accent colour. The prop
  // lives on `root` so both the seek gradient (inherited) and the bottom
  // mini-progress bar read the same value.
  const paintSeek = (): void => {
    const max = Number(seek.max) || 0;
    const pct = max > 0 ? (Number(seek.value) / max) * 100 : 0;
    root.style.setProperty('--blok-seek-pct', `${pct}%`);
  };

  // Paint the buffered-ahead portion behind the elapsed fill.
  const paintBuffered = (): void => {
    const pct = bufferedPct(video.buffered, video.currentTime, video.duration);
    seekBuffered.style.setProperty('--blok-buffered-pct', `${pct}%`);
  };

  const onLoadedMetadata = (): void => {
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    seek.max = String(dur);
    paintSeek();
    paintBuffered();
    renderTime();
  };
  const onTimeUpdate = (): void => {
    seek.value = String(video.currentTime);
    paintSeek();
    paintBuffered();
    renderTime();
  };
  const onProgress = (): void => paintBuffered();

  // The browser fires `timeupdate` only ~4×/s, so painting the scrubber off it
  // makes the fill lurch forward in visible steps. While the video is actually
  // playing we drive the elapsed fill from `requestAnimationFrame` instead, so
  // it glides at the display's refresh rate. `timeupdate` stays the source of
  // truth for the time label and buffered bar; this loop only smooths the fill.
  // We skip the loop's writes while the user is dragging the thumb so a slow
  // seek can't yank it back to a stale `currentTime`.
  const seekLoop = { raf: 0, scrubbing: false };
  const tickSeek = (): void => {
    if (!seekLoop.scrubbing) seek.value = String(video.currentTime);
    paintSeek();
    seekLoop.raf = requestAnimationFrame(tickSeek);
  };
  const startSeekLoop = (): void => {
    if (seekLoop.raf) return;
    seekLoop.raf = requestAnimationFrame(tickSeek);
  };
  const stopSeekLoop = (): void => {
    if (!seekLoop.raf) return;
    cancelAnimationFrame(seekLoop.raf);
    seekLoop.raf = 0;
  };
  const onSeekScrubStart = (): void => { seekLoop.scrubbing = true; };
  const onSeekScrubEnd = (): void => { seekLoop.scrubbing = false; };

  // ----- hover frame preview -----
  // A throwaway second <video>, sharing the source, is seeked to the hovered time
  // and painted into the tooltip canvas — a client-side stand-in for the sprite
  // sheets native players ship. Created lazily on first hover so we don't pull the
  // bytes twice until someone actually scrubs.
  const THUMB_W = 160;
  const preview: {
    el: HTMLVideoElement | null;
    ready: boolean;
    busy: boolean;
    pendingTime: number;
  } = {
    el: null,
    ready: false,
    busy: false,
    pendingTime: -1,
  };
  const drawPreviewFrame = (): void => {
    preview.busy = false;
    const ctx = seekThumb.getContext('2d');
    if (ctx && preview.el && preview.el.videoWidth > 0) {
      seekThumb.width = THUMB_W;
      seekThumb.height = Math.round(THUMB_W * (preview.el.videoHeight / preview.el.videoWidth));
      ctx.drawImage(preview.el, 0, 0, seekThumb.width, seekThumb.height);
      seekThumb.setAttribute('data-ready', 'true');
    }
    // The pointer may have moved on while we were seeking — chase the latest time.
    if (preview.pendingTime >= 0 && preview.el && Math.abs(preview.el.currentTime - preview.pendingTime) > 0.05) {
      seekPreviewTo(preview.pendingTime);
    }
  };
  function seekPreviewTo(time: number): void {
    preview.pendingTime = time;
    if (!preview.el || !preview.ready || preview.busy) return;
    preview.busy = true;
    preview.el.currentTime = time;
  }
  const ensurePreview = (): void => {
    if (preview.el) return;
    const src = video.currentSrc || video.getAttribute('src') || '';
    if (!src) return;
    const el = document.createElement('video');
    el.className = 'blok-video-controls__preview-source';
    el.setAttribute('data-role', 'seek-preview-source');
    el.muted = true;
    el.preload = 'auto';
    if (video.crossOrigin) el.crossOrigin = video.crossOrigin;
    el.src = src;
    el.addEventListener('loadeddata', () => {
      preview.ready = true;
      if (preview.pendingTime >= 0) seekPreviewTo(preview.pendingTime);
    });
    el.addEventListener('seeked', drawPreviewFrame);
    preview.el = el;
    root.appendChild(el);
  };

  // Float the hover tooltip over the scrubber at the cursor, reading the time at
  // that position. jsdom yields a zero rect, so the position is a no-op there
  // but the text wiring still proves out.
  const onSeekHover = (event: MouseEvent): void => {
    const rect = seek.getBoundingClientRect();
    const ratio = ratioFromPointer(event.clientX, rect);
    const time = timeAtRatio(ratio, video.duration);
    seekTime.textContent = formatTime(time);
    seekTooltip.style.setProperty('--blok-tooltip-x', `${ratio * 100}%`);
    seekTooltip.setAttribute('aria-hidden', 'false');
    if (Number.isFinite(video.duration) && video.duration > 0) {
      ensurePreview();
      seekPreviewTo(time);
    }
  };
  const onSeekHoverLeave = (): void => {
    seekTooltip.setAttribute('aria-hidden', 'true');
    preview.pendingTime = -1;
  };
  const onPlay = (): void => { setPlaying(true); markPlayed(); };
  const onPause = (): void => setPlaying(false);
  // Pop the mute glyph when the user flips audible↔muted (à la native players).
  const isMuted = (): boolean => video.muted || video.volume === 0;
  const volumeIcon = createVolumeIcon(muteToggle);
  // The first paint never glides. Paint now so the first mute does.
  volumeIcon.paint(video.volume, isMuted());
  const bumpMute = (): void => {
    muteToggle.classList.remove('is-bumped');
    muteToggle.offsetWidth;
    muteToggle.classList.add('is-bumped');
  };
  const onVolumeChange = (): void => {
    const muted = isMuted();
    muteToggle.setAttribute('aria-pressed', String(muted));
    volumeIcon.paint(video.volume, muted);
    muteToggle.setAttribute('aria-label', muted ? i18nLabel('unmute', 'Unmute') : i18nLabel('mute', 'Mute'));
    // muting parks the slider at the very beginning; unmuted tracks the real volume
    volume.value = muted ? '0' : String(video.volume);
    // paint the filled (already-set) portion to the left of the thumb
    volume.style.setProperty('--blok-vol-pct', `${Number(volume.value) * 100}%`);
  };
  // Run a user-driven sound change, syncing UI and popping the glyph only when the
  // audible↔muted state actually flips. Captures state before the mutation because
  // the media's own volumechange event fires synchronously inside it.
  const withMuteFlip = (mutate: () => void): void => {
    const was = isMuted();
    mutate();
    onVolumeChange();
    if (isMuted() !== was) bumpMute();
  };
  const onMuteBumpEnd = (): void => muteToggle.classList.remove('is-bumped');

  const onFullscreenChange = (): void => {
    const isFull = document.fullscreenElement === figure;
    figure.setAttribute('data-fullscreen', String(isFull));
    fullscreen.innerHTML = isFull ? IconCollapseFullscreen : IconExpandFullscreen;
    fullscreen.setAttribute('aria-label', isFull ? i18nLabel('fullscreenExit', 'Exit full screen') : i18nLabel('fullscreen', 'Full screen'));
    // Lift the live caption into the top title bar on entry; clear it on exit so
    // it can pick up later edits next time. Empty caption → no bar.
    if (isFull) {
      const text = figure.querySelector('[data-role="video-caption"]')?.textContent?.trim() ?? '';
      titleBar.textContent = text;
      titleBar.hidden = text.length === 0;
    } else {
      titleBar.hidden = true;
      titleBar.textContent = '';
    }
  };

  // Flash the just-taken action's glyph in the centre, restarting the CSS
  // animation each call (remove class → force reflow → re-add).
  const flashBurst = (willPlay: boolean): void => {
    burst.innerHTML = willPlay ? IconPlayerPlay : IconPlayerPause;
    burst.classList.remove('is-active');
    burst.offsetWidth;
    burst.classList.add('is-active');
  };
  // Clear on the disc's own animation only — the radiating ring (::after) ends
  // separately and must not cut the disc short. jsdom fires a bare Event with no
  // animationName, so an empty name still clears (keeps the unit test honest).
  const onBurstEnd = (event: AnimationEvent): void => {
    if (event.animationName && event.animationName !== 'blok-video-burst') return;
    burst.classList.remove('is-active');
  };

  // ----- intent -----
  const togglePlay = (): void => {
    const willPlay = !state.playing;
    if (state.playing) media.pause();
    else void media.play();
    flashBurst(willPlay);
  };

  // ----- press-and-hold to play at 2× -----
  // Holding the video past a short threshold ramps playback to double speed and
  // keeps it playing; releasing restores 1×. A press shorter than the threshold
  // stays a plain click (play/pause toggle).
  const HOLD_MS = 220;
  const hold = { timer: 0, active: false, suppressClick: false };

  const engageHold = (): void => {
    hold.active = true;
    if (!state.playing) void media.play();
    media.playbackRate = 2;
    speedBadge.classList.add('is-active');
  };
  // Drop back to 1× and clear any pending threshold timer. Does not, on its own,
  // swallow the trailing click — only a real pointerup release does (below).
  const releaseHold = (): void => {
    if (hold.timer) { clearTimeout(hold.timer); hold.timer = 0; }
    if (!hold.active) return;
    hold.active = false;
    // Restore the gear-menu-selected rate, not a hardcoded 1× — so holding to
    // peek at 2× returns to whatever speed the user actually chose.
    media.playbackRate = state.selectedRate;
    speedBadge.classList.remove('is-active');
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button) return; // primary button only
    // A press that begins while the settings menu is open is a dismiss gesture: the
    // document mousedown closes the menu, and this press must neither toggle playback
    // nor engage press-and-hold. Flag the trailing click for suppression, skip the
    // hold timer, and let the outside-click handler do the closing.
    if (!menu.hidden) { hold.suppressClick = true; return; }
    // A second press (another finger) would orphan the first timer, and it would engage 2× later.
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = window.setTimeout(engageHold, HOLD_MS);
  };
  const onPointerUp = (): void => {
    // A pointerup after an engaged hold is followed by a click — suppress that
    // one click so the gesture doesn't also toggle play/pause.
    if (hold.active) hold.suppressClick = true;
    releaseHold();
  };
  const onVideoClick = (): void => {
    if (hold.suppressClick) { hold.suppressClick = false; return; }
    togglePlay();
  };
  const onSeekInput = (): void => {
    media.currentTime = Number(seek.value);
    paintSeek();
    setSeekValueText();
  };

  // ----- keyboard seeking + control -----
  const SEEK_STEP = 5;
  const BIG_SEEK_STEP = 10;
  const VOL_STEP = 0.05;
  const FRAME = 1 / 30; // assumes ~30fps — the media API exposes no true frame duration
  const SPEED_STEP = 0.25;
  // Flash the seek pill in from the side matching the jump: rewind sits left
  // (icon then label), skip sits right (label then icon). Re-arm per press. The
  // label magnitude is parameterised so ±5s arrows and ±10s j/l read truthfully.
  const flashSeek = (side: 'back' | 'forward', seconds: number = SEEK_STEP): void => {
    const icon = side === 'forward' ? IconPlayerForward : IconPlayerBackward;
    const label = `<span class="blok-video-controls__seek-flash-label">${seconds}s</span>`;
    seekFlash.setAttribute('data-side', side);
    seekFlash.innerHTML = side === 'forward' ? `${label}${icon}` : `${icon}${label}`;
    seekFlash.classList.remove('is-active');
    seekFlash.offsetWidth;
    seekFlash.classList.add('is-active');
  };
  // Clear on the pill's own slide animation only — the glyph marquee (svg) ends
  // separately and must not cut the pill short. jsdom fires a bare Event with no
  // animationName, so an empty name still clears (keeps the unit test honest).
  const onSeekFlashEnd = (event: AnimationEvent): void => {
    if (event.animationName && !event.animationName.startsWith('blok-video-seek-flash-')) return;
    seekFlash.classList.remove('is-active');
  };
  // Absolute clamped scrub — no directional flash (used by %/Home/End/frame step).
  const seekTo = (t: number): void => {
    const dur = Number.isFinite(media.duration) ? media.duration : 0;
    const next = Math.min(dur || Infinity, Math.max(0, t));
    media.currentTime = next;
    seek.value = String(next);
    paintSeek();
    renderTime();
  };
  // Relative nudge with a directional pill reading the jump magnitude.
  const seekBy = (delta: number): void => {
    seekTo(media.currentTime + delta);
    flashSeek(delta < 0 ? 'back' : 'forward', Math.abs(delta));
  };
  const changeVolume = (delta: number): void => {
    withMuteFlip(() => {
      const next = Math.min(1, Math.max(0, media.volume + delta));
      media.volume = next;
      media.muted = next === 0;
      volume.value = String(next);
    });
  };
  // Through setRate (declared with the gear card below) so the card and the stored rate follow.
  const stepSpeed = (delta: number): void => {
    setRate(media.playbackRate + delta);
  };
  const onVideoKeydown = (event: KeyboardEvent): void => {
    // Bail on meta/ctrl/alt chords — but NOT Shift, which `>`/`<` (speed) need.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const dur = Number.isFinite(media.duration) ? media.duration : 0;
    switch (event.key) {
      case 'ArrowRight': event.preventDefault(); seekBy(SEEK_STEP); break;
      case 'ArrowLeft': event.preventDefault(); seekBy(-SEEK_STEP); break;
      case 'l': event.preventDefault(); seekBy(BIG_SEEK_STEP); break;
      case 'j': event.preventDefault(); seekBy(-BIG_SEEK_STEP); break;
      case ' ':
      case 'Spacebar':
      case 'k': event.preventDefault(); togglePlay(); break;
      case 'm': event.preventDefault(); onMuteClick(); break;
      case 'f': event.preventDefault(); onFullscreen(); break;
      case 'c': event.preventDefault(); break; // reserved — captions not implemented yet
      case 'ArrowUp': event.preventDefault(); changeVolume(VOL_STEP); break;
      case 'ArrowDown': event.preventDefault(); changeVolume(-VOL_STEP); break;
      case 'Home': event.preventDefault(); seekTo(0); break;
      case 'End': event.preventDefault(); seekTo(dur || media.currentTime); break;
      case '.': event.preventDefault(); if (!state.playing) seekTo(media.currentTime + FRAME); break;
      case ',': event.preventDefault(); if (!state.playing) seekTo(media.currentTime - FRAME); break;
      case '>': event.preventDefault(); stepSpeed(SPEED_STEP); break;
      case '<': event.preventDefault(); stepSpeed(-SPEED_STEP); break;
      default:
        if (event.key.length === 1 && event.key >= '0' && event.key <= '9' && dur > 0) {
          event.preventDefault();
          seekTo((dur * Number(event.key)) / 10);
        }
    }
  };
  const onMuteClick = (): void => {
    withMuteFlip(() => { media.muted = !media.muted; });
  };
  const onVolumeInput = (): void => {
    withMuteFlip(() => {
      const v = Number(volume.value);
      media.volume = v;
      media.muted = v === 0;
    });
  };
  const onFullscreen = (): void => {
    if (document.fullscreenElement === figure) void document.exitFullscreen?.();
    else void figure.requestFullscreen?.();
  };

  // ----- gear settings card (speed / loop) -----
  // Viewer-accessible in-player popover (the block ☰ menu is editor-only). One card,
  // two panes: a main list (Playback speed, Loop) and the speed submenu it opens.
  // Built here so it shares the player's closure state.
  const SPEED_LABEL = (rate: number): string => `${rate}×`;
  // Honoured by the speed wire and the ambient sampler — both opt out of motion.
  const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const menuIcon = (svg: string, extraClass = ''): HTMLSpanElement => {
    const icon = document.createElement('span');
    icon.className = `blok-video-controls__menu-icon ${extraClass}`.trim();
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = svg;
    return icon;
  };
  const menuText = (className: string, text = ''): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  };
  const menuRow = (action: string): HTMLButtonElement => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'blok-video-controls__menu-row';
    row.setAttribute('data-action', action);
    return row;
  };

  const gear = button('gear', i18nLabel('settings', 'Settings'), IconPlayerSettings);
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'blok-video-controls__menu';
  menu.setAttribute('data-role', 'playback-menu');
  menu.setAttribute('data-pane', 'main');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', i18nLabel('settings', 'Settings'));
  menu.hidden = true;

  const menuWrap = document.createElement('div');
  menuWrap.className = 'blok-video-controls__menu-wrap';
  menuWrap.append(gear);

  // --- main pane: Playback speed (opens the submenu), Loop ---
  const mainPane = document.createElement('div');
  mainPane.className = 'blok-video-controls__menu-pane';
  mainPane.setAttribute('data-role', 'menu-main');

  const speedRow = menuRow('open-speed');
  speedRow.setAttribute('aria-expanded', 'false');
  const speedRowValue = menuText('blok-video-controls__menu-value');
  speedRowValue.setAttribute('data-role', 'speed-value');
  speedRow.append(
    menuIcon(IconPlayerSpeed),
    menuText('blok-video-controls__menu-label', i18nLabel('playbackSpeed', 'Playback speed')),
    speedRowValue,
    menuIcon(IconChevronRight, 'blok-video-controls__menu-chevron')
  );

  const loopRow = menuRow('loop');
  loopRow.setAttribute('role', 'switch');
  loopRow.setAttribute('aria-checked', String(loop));
  const loopSwitch = document.createElement('span');
  loopSwitch.className = 'blok-video-controls__switch';
  loopSwitch.setAttribute('aria-hidden', 'true');
  loopRow.append(menuIcon(IconPlayerLoop), menuText('blok-video-controls__menu-label', i18nLabel('loop', 'Loop')), loopSwitch);
  // setLoop lives in the persistence section below (it also stores the shared
  // preference); the listener only fires after attach, so the late const is safe.
  loopRow.addEventListener('click', () => { setLoop(!media.loop); onLoopChange?.(); });

  mainPane.append(speedRow, loopRow);

  // --- speed pane: back row, step line, the wire, presets ---
  const speedPane = document.createElement('div');
  speedPane.className = 'blok-video-controls__menu-pane';
  speedPane.setAttribute('data-role', 'menu-speed');
  speedPane.setAttribute('role', 'group');
  speedPane.setAttribute('aria-label', i18nLabel('playbackSpeed', 'Playback speed'));

  const backRow = menuRow('menu-back');
  backRow.classList.add('blok-video-controls__menu-back');
  backRow.setAttribute('aria-label', i18nLabel('back', 'Back'));
  const backRowValue = menuText('blok-video-controls__menu-value');
  backRowValue.setAttribute('data-role', 'speed-value');
  backRow.append(
    menuIcon(IconChevronLeft, 'blok-video-controls__menu-chevron'),
    menuText('blok-video-controls__menu-label', i18nLabel('playbackSpeed', 'Playback speed')),
    backRowValue
  );

  const menuDivider = document.createElement('div');
  menuDivider.className = 'blok-video-controls__menu-divider';
  menuDivider.setAttribute('aria-hidden', 'true');

  const stepButton = (action: string, label: string, icon: string): HTMLButtonElement => {
    const step = document.createElement('button');
    step.type = 'button';
    step.className = 'blok-video-controls__speed-step';
    step.setAttribute('data-action', action);
    step.setAttribute('aria-label', label);
    step.innerHTML = icon;
    return step;
  };
  const speedDecrease = stepButton('speed-decrease', i18nLabel('speedDecrease', 'Decrease playback speed'), IconMinus);
  const speedIncrease = stepButton('speed-increase', i18nLabel('speedIncrease', 'Increase playback speed'), IconPlus);

  // The live value. Clicking it opens a field to type any speed from 0.1× to 3×.
  const speedReadout = document.createElement('div');
  speedReadout.className = 'blok-video-controls__speed-readout';
  speedReadout.setAttribute('data-role', 'speed-readout');
  const readoutDigits = menuText('blok-video-controls__speed-readout-digits');
  speedReadout.append(readoutDigits, menuText('blok-video-controls__speed-readout-unit', '×'));
  const speedEntry = createSpeedEntry({
    readout: speedReadout,
    host: speedPane,
    classPrefix: 'blok-video-controls',
    t: i18nLabel,
    rate: () => state.selectedRate,
    onRate: (rate) => setRate(rate),
  });

  const speedStepper = document.createElement('div');
  speedStepper.className = 'blok-video-controls__speed-stepper';
  speedStepper.setAttribute('data-role', 'speed-stepper');
  speedStepper.append(speedDecrease, speedReadout, speedIncrease);

  // setRate is declared just below; the wire only calls back on interaction.
  const speedWire = createSpeedWire({
    label: i18nLabel('playbackSpeed', 'Playback speed'),
    reducedMotion,
    onRate: (rate) => setRate(rate),
  });

  // Presets only set a value. They never show a selected state: the bead on the
  // peg above already says which one is current.
  const speedPresets = document.createElement('div');
  speedPresets.className = 'blok-video-controls__speed-presets';
  speedPresets.setAttribute('data-role', 'speed-presets');
  speedPresets.setAttribute('role', 'group');
  speedPresets.setAttribute('aria-label', i18nLabel('speedPresets', 'Speed presets'));
  speedPresets.dir = 'ltr';
  SPEED_PEGS.forEach((rate) => {
    const preset = document.createElement('button');
    preset.type = 'button';
    preset.className = 'blok-video-controls__speed-preset';
    preset.setAttribute('data-action', `speed-${rate}`);
    // Where its peg sits along the wire; video.css centres the button under it.
    preset.style.setProperty('--blok-speed-at', String(rateToFraction(rate)));
    preset.textContent = SPEED_LABEL(rate);
    preset.addEventListener('click', () => setRate(rate));
    speedPresets.append(preset);
  });
  // While the field is open the presets give way to this line (see the stylesheet).
  speedPresets.append(speedEntry.helpLine);

  speedPane.append(backRow, menuDivider, speedStepper, speedWire.element, speedPresets);
  // A press anywhere else in the card sets a typed speed first, so a step or a drag
  // starts from it. Capture: the stepper acts on its own pointerdown.
  speedPane.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element && event.target.closest('.blok-video-controls__speed-entry'))) speedEntry.commit();
  }, true);
  menu.append(mainPane, speedPane);

  // Only the characters that changed roll in: up for a faster speed, down for a slower one.
  const readout = { text: '' };
  const paintReadout = (rate: number, rising: boolean): void => {
    const text = String(rate);
    if (text === readout.text) return;
    const digits = [...text].map((char, i) => {
      const digit = menuText('blok-video-controls__speed-digit', char);
      if (readout.text !== '' && readout.text[i] !== char) digit.setAttribute('data-roll', rising ? 'up' : 'down');
      return digit;
    });
    readoutDigits.replaceChildren(...digits);
    readout.text = text;
  };

  const syncSpeedUi = (rate: number, previous: number): void => {
    speedRowValue.textContent = rate === 1 ? i18nLabel('speedNormal', 'Normal') : SPEED_LABEL(rate);
    backRowValue.textContent = SPEED_LABEL(rate);
    paintReadout(rate, rate > previous);
    speedDecrease.disabled = rate <= SPEED_MIN;
    speedIncrease.disabled = rate >= SPEED_MAX;
    speedWire.sync(rate);
  };
  const setRate = (rate: number): void => {
    const previous = state.selectedRate;
    const next = clampRate(rate);
    state.selectedRate = next;
    media.playbackRate = next;
    syncSpeedUi(next, previous);
    // RATE_KEY/safeSet live in the persistence section below; setRate only runs
    // on interaction or the restore call there, both after those consts exist.
    safeSet(RATE_KEY, String(next));
  };

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
  wireStep(speedDecrease, -SPEED_SLIDER_STEP);
  wireStep(speedIncrease, SPEED_SLIDER_STEP);

  // The pane on show is in flow, so the card is as tall as it. The other is taken
  // out of flow and slid aside (video.css). `inert` keeps it out of the tab order.
  const menuResize = { timer: 0 };
  const endMenuResize = (): void => {
    window.clearTimeout(menuResize.timer);
    menuResize.timer = 0;
    menu.style.height = '';
    menu.style.width = '';
  };
  const showPane = (pane: 'main' | 'speed', { animate = true, focus = false } = {}): void => {
    const from = { height: menu.offsetHeight, width: menu.offsetWidth };
    const entering = pane === 'speed' && menu.getAttribute('data-pane') !== 'speed';
    endMenuResize();
    speedEntry.commit();
    menu.setAttribute('data-pane', pane);
    speedRow.setAttribute('aria-expanded', String(pane === 'speed'));
    mainPane.inert = pane !== 'main';
    speedPane.inert = pane !== 'speed';
    stopStepHold();
    if (entering) speedWire.enter();
    if (pane === 'main') speedWire.rest();
    if (focus) (pane === 'speed' ? backRow : speedRow).focus({ preventScroll: true });
    // A size cannot animate to or from `auto`: pin the old size, then the new one.
    const to = { height: menu.offsetHeight, width: menu.offsetWidth };
    if (!animate || reducedMotion || !from.height || !to.height || (from.height === to.height && from.width === to.width)) return;
    menu.style.height = `${from.height}px`;
    menu.style.width = `${from.width}px`;
    // Reading the box commits the pinned size before the next one is set.
    menu.getBoundingClientRect();
    menu.style.height = `${to.height}px`;
    menu.style.width = `${to.width}px`;
    // Longer than the CSS transition, so a missed transitionend cannot leave it pinned.
    menuResize.timer = window.setTimeout(endMenuResize, 400);
  };
  speedRow.addEventListener('click', () => showPane('speed', { focus: true }));
  backRow.addEventListener('click', () => showPane('main', { focus: true }));

  syncSpeedUi(state.selectedRate, state.selectedRate);
  showPane('main', { animate: false });
  bar.insertBefore(menuWrap, fullscreen);
  // The menu lives on the figure, NOT inside the overflow:hidden media box, so the
  // card spills outside a short player instead of being clipped to its frame.
  // It is then anchored to the gear by hand on each open / viewport change.
  figure.appendChild(menu);

  const MENU_GAP = 8;
  const positionMenu = (): void => {
    const g = gear.getBoundingClientRect();
    const f = figure.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const width = menu.offsetWidth;
    const gearMiddle = g.left + g.width / 2;
    // The card opens toward the inline end, from the gear's inline-start edge. With no
    // room there it ends at the bar's inline-end edge instead (the player's, with no bar).
    // It is pinned by whichever edge stays put, so a width change moves the other one.
    const place = (edge: 'left' | 'right', offset: number, cardLeft: number): void => {
      menu.style.left = edge === 'left' ? `${offset}px` : '';
      menu.style.right = edge === 'right' ? `${offset}px` : '';
      // The card grows out of the gear, wherever the gear sits under it.
      menu.style.transformOrigin = `${gearMiddle - cardLeft}px 100%`;
    };
    if (getElementDirection(figure) === 'rtl') {
      const limit = b.width ? b.left : f.left;
      if (g.right - width >= limit) place('right', f.right - g.right, g.right - width);
      else place('left', limit - f.left, limit);
    } else {
      const limit = b.width ? b.right : f.right;
      if (g.left + width <= limit) place('left', g.left - f.left, g.left);
      else place('right', f.right - limit, limit - width);
    }
    // Clear the bar, not just the gear: the bar's padding puts its edge above the gear's.
    const top = b.height ? Math.min(g.top, b.top) : g.top;
    menu.style.bottom = `${f.bottom - top + MENU_GAP}px`;
  };

  const onMenuOutside = (event: MouseEvent): void => {
    if (menu.hidden) return;
    const target = event.target as Node | null;
    // Keep open for clicks on the gear (menuWrap) or anywhere inside the menu itself —
    // the menu is not a descendant of menuWrap, so it must be checked separately.
    if (target && (menuWrap.contains(target) || menu.contains(target))) return;
    closeMenu();
  };
  const openMenu = (): void => {
    if (!menu.hidden) return;
    // Every open starts on the main list, whatever was showing when it closed.
    showPane('main', { animate: false });
    menu.hidden = false;
    positionMenu();
    gear.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onMenuOutside);
    window.addEventListener('resize', positionMenu);
  };
  const closeMenu = (): void => {
    if (menu.hidden) return;
    speedEntry.commit();
    menu.hidden = true;
    stopStepHold();
    endMenuResize();
    speedWire.rest();
    gear.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onMenuOutside);
    window.removeEventListener('resize', positionMenu);
  };
  gear.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  // Escape steps back out: submenu to main list, main list to closed.
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (menu.getAttribute('data-pane') === 'speed') {
      showPane('main', { focus: true });
      return;
    }
    closeMenu();
    gear.focus({ preventScroll: true });
  });

  // ----- view modes: ambient glow / theater / picture-in-picture -----
  // Ambient — a blurred canvas behind the figure sampled from the current frame.
  // Off under reduced motion; the pixel sampling itself is live-verify only.
  const ambientCanvas = document.createElement('canvas');
  ambientCanvas.className = 'blok-video-controls__ambient';
  ambientCanvas.setAttribute('data-role', 'video-ambient');
  ambientCanvas.setAttribute('aria-hidden', 'true');
  figure.insertBefore(ambientCanvas, figure.firstChild);

  ambientCanvas.setAttribute('data-ambient', reducedMotion ? 'off' : 'on');
  // `data-glow` is the user's chosen intensity (more / less / none) — drives the
  // peak opacity in CSS; 'none' hides the canvas and skips sampling entirely.
  ambientCanvas.setAttribute('data-glow', glow);
  // `data-active` drives the glow's opacity: it fades in when the video starts
  // and fades back out the instant it pauses, so a frozen frame never lingers.
  ambientCanvas.setAttribute('data-active', 'false');
  const ambient = { raf: 0 };
  const sampleAmbient = (): void => {
    const ctx = ambientCanvas.getContext('2d');
    if (ctx && video.videoWidth) {
      ambientCanvas.width = 32;
      ambientCanvas.height = 18;
      ctx.drawImage(video, 0, 0, 32, 18);
    }
    ambient.raf = requestAnimationFrame(sampleAmbient);
  };
  const startAmbient = (): void => {
    if (reducedMotion || glow === 'none') return;
    ambientCanvas.setAttribute('data-active', 'true');
    if (ambient.raf) return;
    ambient.raf = requestAnimationFrame(sampleAmbient);
  };
  const stopAmbient = (): void => {
    ambientCanvas.setAttribute('data-active', 'false');
    if (!ambient.raf) return;
    cancelAnimationFrame(ambient.raf);
    ambient.raf = 0;
  };

  // Theater — an ephemeral presentation toggle. Promotes the figure into the
  // browser top layer via the Popover API (manual mode) so it sits above all
  // editor chrome, centres in the viewport, and gets a real ::backdrop. Dismiss
  // is driven explicitly — an outside pointer-down or Escape — so it behaves the
  // same with or without the Popover API and never races browser light-dismiss.
  // It never touches the inline width, so the saved resize width is preserved.
  const canPopover = supportsPopoverAPI();
  const theaterBtn = button('theater', i18nLabel('theater', 'Theater mode'), IconPlayerTheater);
  theaterBtn.setAttribute('aria-pressed', 'false');
  // `inlineRect` is the VIDEO's grid-slot rect, captured on enter (before
  // data-theater promotes it to fixed/centre) and reused to land the exit morph.
  const theater = { on: false, inlineRect: null as DOMRect | null };
  const onTheaterKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    // Cancel the browser's own Escape/close-watcher handling for the top-layer
    // popover. Left to run, it disturbs the popover the same tick our dismiss
    // animates, leaving the exit a scale-less slide that snaps small at the end
    // (clicking outside the card has no such handler and morphs cleanly). The
    // listener is on `window` in capture so this fires BEFORE the browser's
    // close-watcher claims the event — a document/bubble listener is too late.
    event.preventDefault();
    event.stopImmediatePropagation();
    // Defer the dismiss out of the keydown tick. Starting the FLIP synchronously
    // inside Escape handling makes Chromium drop the morph's scale (the card
    // slides at full size then snaps small); run a frame later — once the
    // browser's top-layer Escape handling has settled — and it scales cleanly,
    // exactly like dismissing via an outside pointer-down.
    requestAnimationFrame(() => setTheater(false));
  };
  // Click anywhere off the cinema card (the dimmed backdrop) closes it.
  const onTheaterOutside = (event: Event): void => {
    const target = event.target as Node | null;
    if (target && !figure.contains(target)) setTheater(false);
  };
  // The figure jumps from its inline grid slot to the fixed, top-layer centre the
  // instant the popover opens, so a keyframe scale-nudge leaves that big position
  // jump unanimated (reads as a teleport). We FLIP instead: snap the centred card
  // back onto the inline rect, then grow it into the centre, reversing on exit.
  //
  // Driven by the Web Animations API, NOT a CSS transition primed over rAF. The
  // keyframes name the start (inline) and end (centre) explicitly, so the morph
  // never depends on the browser reading a "from" value off the last painted
  // frame. Under load — promoting the whole player to the top layer, decoding the
  // video at the new size — that paint is delayed, so a transition would start
  // from a half-laid-out intermediate: the "snap to a wrong size, hold, then jump"
  // we kept chasing. WAAPI transform animations also run on the compositor, immune
  // to that main-thread jank, which is what made the opening read laggy/stepped.
  const canAnimate = typeof figure.animate === 'function';
  const flip = { anim: null as Animation | null };
  // The bar is laid out at the card's final size and scaled with it, so mid-morph
  // the island reads as a squashed strip. CSS hides it while this mark is up.
  const cancelFlip = (): void => {
    if (flip.anim) { flip.anim.cancel(); flip.anim = null; }
    figure.removeAttribute('data-theater-morphing');
  };
  const collapsed = (from: DOMRect, to: DOMRect): string =>
    `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;
  const morph = (
    from: string,
    to: string,
    opts: { duration: number; easing: string; fill?: FillMode; done?: () => void },
  ): void => {
    cancelFlip();
    const anim = figure.animate(
      [
        { transformOrigin: 'top left', transform: from },
        { transformOrigin: 'top left', transform: to },
      ],
      { duration: opts.duration, easing: opts.easing, fill: opts.fill ?? 'none' },
    );
    flip.anim = anim;
    figure.setAttribute('data-theater-morphing', 'true');
    anim.onfinish = (): void => {
      if (flip.anim === anim) {
        flip.anim = null;
        figure.removeAttribute('data-theater-morphing');
      }
      // Run teardown FIRST (it swaps the figure back to its inline flow position),
      // THEN cancel so the fill:'forwards' transform is dropped in the same frame —
      // no flash to centre, and no collapsed transform left stuck on the figure
      // (which would freeze the inline video shrunk and displaced below its slot).
      opts.done?.();
      anim.cancel();
    };
  };
  const enterTheater = (): void => {
    // Measure the VIDEO, not the figure: the figure is taller inline (the caption
    // sits in-flow) but is pure 16:9 in theater (caption lifted out), so a
    // figure-based FLIP scales x and y by different factors and squishes the video
    // through the whole morph, snapping to true proportions only at the end ("weird
    // at the end"). The video is a clean 16:9 in both states → uniform scale. It
    // shares the figure's top-left (it sits at the figure top), so the transform —
    // still applied to the figure — lands the video exactly on its slot.
    //
    // Measure BEFORE data-theater promotes the figure: the attribute applies
    // position:fixed + full width, so a later read returns the centred rect and the
    // morph collapses to a zero delta.
    const inlineRect = video.getBoundingClientRect();
    theater.inlineRect = inlineRect;
    // Reserve the figure's vacated height on its slot. Promoting the figure to the
    // fixed top layer pulls it out of flow, collapsing the slot to zero — without
    // this the rest of the document shifts up to fill the gap (and back on exit).
    const slot = figure.parentElement;
    if (slot) slot.style.minHeight = `${figure.getBoundingClientRect().height}px`;
    figure.setAttribute('data-theater', 'true');
    if (!canPopover) return; // popover-less fallback: the CSS keyframe owns it
    // Route promotion through the Top-Layer chokepoint so the data-blok-top-layer
    // marker (and its UA-popover CSS reset) is applied centrally. The theater rules
    // keyed on [data-theater="true"] out-specify that generic reset, so the centred
    // fixed layout survives. On failure, unwind the marker/attribute it set.
    if (!figure.matches(':popover-open') && !promoteToTopLayer(figure)) {
      removeFromTopLayer(figure);

      return;
    }
    if (reducedMotion || !canAnimate) return;
    const centre = video.getBoundingClientRect();
    if (!inlineRect.width || !centre.width) return;
    // The grow ends at the natural centred transform (fill: 'none' reverts cleanly).
    morph(collapsed(centre, inlineRect), 'translate(0px, 0px) scale(1, 1)', {
      duration: 480,
      easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
    });
  };
  const leaveTheater = (): void => {
    // Tear down atomically (one paint) so the card never flashes back to centre.
    const finalize = (): void => {
      cancelFlip();
      removeFromTopLayer(figure);
      figure.setAttribute('data-theater', 'false');
      figure.removeAttribute('data-theater-leaving');
      // Release the reserved slot height so it tracks the figure again.
      const slot = figure.parentElement;
      if (slot) slot.style.minHeight = '';
    };
    const to = theater.inlineRect;
    if (!canPopover || reducedMotion || !canAnimate || !to || !figure.matches(':popover-open')) {
      finalize();
      return;
    }
    const from = video.getBoundingClientRect();
    if (!from.width) { finalize(); return; }
    // data-theater-leaving fades the ::backdrop out alongside the card shrink.
    // fill: 'forwards' holds the shrunk transform until finalize hides the popover,
    // so the card never snaps back to centre for a frame before teardown.
    figure.setAttribute('data-theater-leaving', 'true');
    // Ease-OUT (mirrors the entrance) so the shrink starts moving from frame one and
    // decelerates into the slot. An ease-in leaves the card visibly frozen at full
    // size for its first third, then collapses fast — reads as "it suddenly shrinks".
    morph('translate(0px, 0px) scale(1, 1)', collapsed(from, to), {
      duration: 360,
      easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
      fill: 'forwards',
      done: finalize,
    });
  };
  const setTheater = (on: boolean): void => {
    if (on === theater.on) return;
    theater.on = on;
    theaterBtn.setAttribute('aria-pressed', String(on));
    theaterBtn.setAttribute('aria-label', on ? i18nLabel('theaterExit', 'Exit theater mode') : i18nLabel('theater', 'Theater mode'));
    if (on) {
      enterTheater();
      // window + capture: fire before the browser's popover close-watcher claims
      // Escape (it does so between window- and document-capture), so our
      // preventDefault actually suppresses it and only our clean dismiss runs.
      window.addEventListener('keydown', onTheaterKey, true);
      document.addEventListener('pointerdown', onTheaterOutside);
    } else {
      window.removeEventListener('keydown', onTheaterKey, true);
      document.removeEventListener('pointerdown', onTheaterOutside);
      leaveTheater();
    }
    figure.dispatchEvent(new CustomEvent('blok-video-theater', { detail: { on } }));
  };
  theaterBtn.addEventListener('click', () => setTheater(!theater.on));
  bar.insertBefore(theaterBtn, fullscreen);

  // Picture-in-picture — only mounted when the browser supports it.
  const pipSupported = Boolean(document.pictureInPictureEnabled);
  const pipBtn = pipSupported ? button('picture-in-picture', i18nLabel('pip', 'Picture-in-Picture'), IconPlayerPip) : null;
  const onEnterPip = (): void => pipBtn?.setAttribute('aria-pressed', 'true');
  const onLeavePip = (): void => pipBtn?.setAttribute('aria-pressed', 'false');
  if (pipBtn) {
    pipBtn.setAttribute('aria-pressed', 'false');
    pipBtn.addEventListener('click', () => {
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture?.();
      else void video.requestPictureInPicture?.();
    });
    bar.insertBefore(pipBtn, fullscreen);
    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);
  }

  // ----- idle auto-hide -----
  // Fade the control bar + cursor after a few idle seconds of playback; any
  // pointer move or focus brings them back. Never hides while paused.
  const IDLE_MS = 3000;
  figure.setAttribute('data-controls-hidden', 'false');
  const hideControls = (): void => {
    if (state.playing && figure.isConnected) figure.setAttribute('data-controls-hidden', 'true');
  };
  const scheduleHide = (): void => {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = window.setTimeout(hideControls, IDLE_MS);
  };
  const revealControls = (): void => {
    if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = 0; }
    figure.setAttribute('data-controls-hidden', 'false');
    if (state.playing) scheduleHide();
  };
  // Clicking a control focuses it, so focusin fires for the mouse too. Only a
  // keyboard gesture should pull the bar back up.
  const revealOnKeyboardFocus = (): void => {
    if (isKeyboardModality()) revealControls();
  };

  const statsOverlay = document.createElement('div');
  statsOverlay.className = 'blok-video-controls__stats';
  statsOverlay.setAttribute('data-role', 'video-stats');
  statsOverlay.hidden = true;
  root.appendChild(statsOverlay);

  const renderStats = (): void => {
    const quality = video.getVideoPlaybackQuality?.();
    const unavailable = tr(
      i18n,
      'tools.video.statsUnavailable',
      'Not available'
    );
    const dropped = quality
      ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}`
      : unavailable;
    const resolution = video.videoWidth
      ? `${video.videoWidth}×${video.videoHeight}`
      : unavailable;
    const bufferedEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
    const health = Math.max(0, bufferedEnd - video.currentTime).toFixed(1);
    const viewport = `${root.offsetWidth}×${root.offsetHeight}`;
    const lines = [
      tr(i18n, 'tools.video.statsResolution', 'Resolution: {value}', { value: resolution }),
      tr(i18n, 'tools.video.statsDroppedFrames', 'Dropped frames: {value}', { value: dropped }),
      tr(i18n, 'tools.video.statsBufferHealth', 'Buffer health: {seconds} s', { seconds: health }),
      tr(i18n, 'tools.video.statsViewport', 'Viewport: {value}', { value: viewport }),
    ];

    statsOverlay.replaceChildren(...lines.map((line) => {
      const row = document.createElement('div');

      row.textContent = line;

      return row;
    }));
  };
  const toggleStats = (): void => {
    statsOverlay.hidden = !statsOverlay.hidden;
    if (!statsOverlay.hidden) renderStats();
  };
  const refreshStats = (): void => { if (!statsOverlay.hidden) renderStats(); };

  const detachReadOnlyContextMenu = readOnly ? (() => {
    const ctxMenu = document.createElement('div');
    ctxMenu.className = 'blok-video-controls__ctx';
    ctxMenu.setAttribute('data-role', 'video-menu');
    ctxMenu.setAttribute('role', 'menu');
    ctxMenu.hidden = true;
    const ctxItem = (action: string, label: string): HTMLButtonElement => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'blok-video-controls__ctx-item';
      item.setAttribute('data-action', action);
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      return item;
    };
    const ctxLoop = ctxItem('ctx-loop', i18nLabel('loop', 'Loop'));
    ctxLoop.setAttribute('role', 'menuitemcheckbox');
    const ctxCopy = ctxItem('copy-url', i18nLabel('ctxCopyUrl', 'Copy video URL'));
    const ctxCopyAt = ctxItem('copy-url-at-time', i18nLabel('ctxCopyUrlAtTime', 'Copy video URL at current time'));
    const ctxStats = ctxItem('stats', i18nLabel('ctxStats', 'Playback statistics'));
    ctxMenu.append(ctxLoop, ctxCopy, ctxCopyAt, ctxStats);
    root.appendChild(ctxMenu);

    const clipboardWrite = (value: string): void => { void navigator.clipboard?.writeText?.(value); };
    const closeCtxMenu = (): void => {
      ctxMenu.hidden = true;
      document.removeEventListener('mousedown', onCtxOutside);
      document.removeEventListener('keydown', onCtxKeydown);
    };
    const onCtxOutside = (event: MouseEvent): void => {
      if (!ctxMenu.contains(event.target instanceof Node ? event.target : null)) closeCtxMenu();
    };
    const onCtxKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeCtxMenu();
    };
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const rect = root.getBoundingClientRect();
      ctxLoop.setAttribute('aria-checked', String(media.loop));
      ctxMenu.style.setProperty('--blok-ctx-x', `${event.clientX - rect.left}px`);
      ctxMenu.style.setProperty('--blok-ctx-y', `${event.clientY - rect.top}px`);
      ctxMenu.hidden = false;
      document.addEventListener('mousedown', onCtxOutside);
      document.addEventListener('keydown', onCtxKeydown);
    };
    ctxLoop.addEventListener('click', () => { setLoop(!media.loop); onLoopChange?.(); ctxLoop.setAttribute('aria-checked', String(media.loop)); closeCtxMenu(); });
    ctxCopy.addEventListener('click', () => { clipboardWrite(video.currentSrc); closeCtxMenu(); });
    ctxCopyAt.addEventListener('click', () => { clipboardWrite(`${video.currentSrc.split('#', 1)[0]}#t=${Math.floor(video.currentTime)}`); closeCtxMenu(); });
    ctxStats.addEventListener('click', () => { toggleStats(); closeCtxMenu(); });
    video.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('contextmenu', onContextMenu);
    return (): void => {
      document.removeEventListener('mousedown', onCtxOutside);
      document.removeEventListener('keydown', onCtxKeydown);
      video.removeEventListener('contextmenu', onContextMenu);
      root.removeEventListener('contextmenu', onContextMenu);
    };
  })() : undefined;

  // ----- volume / rate / loop / position persistence -----
  // Volume, rate and loop are shared across every video block; position is per-source.
  const store: VideoStorage | null = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const VOL_KEY = 'blok:video:volume';
  const RATE_KEY = 'blok:video:rate';
  const LOOP_KEY = 'blok:video:loop';
  const posKey = (): string | null => (video.currentSrc ? `blok:video:pos:${video.currentSrc}` : null);
  const safeGet = (key: string): string | null => { try { return store?.getItem(key) ?? null; } catch { return null; } };
  const safeSet = (key: string, value: string): void => { try { store?.setItem(key, value); } catch { /* private mode / quota */ } };
  const persistVolume = (): void => safeSet(VOL_KEY, JSON.stringify({ volume: media.volume, muted: media.muted }));
  const persistPosition = (): void => {
    const key = posKey();
    if (key) safeSet(key, String(media.currentTime));
  };
  const applyStoredVolume = (raw: string): void => {
    const parsed = JSON.parse(raw) as { volume?: number; muted?: boolean };
    if (typeof parsed.volume === 'number') { media.volume = parsed.volume; volume.value = String(parsed.volume); }
    if (typeof parsed.muted === 'boolean') media.muted = parsed.muted;
    onVolumeChange();
  };
  const restoreState = (): void => {
    const raw = safeGet(VOL_KEY);
    if (raw) { try { applyStoredVolume(raw); } catch { /* corrupt entry */ } }
    const key = posKey();
    const pos = key ? safeGet(key) : null;
    if (pos !== null) {
      const target = Number(pos);
      const dur = Number.isFinite(media.duration) ? media.duration : 0;
      if (Number.isFinite(target) && target > 0 && (dur === 0 || target < dur - 5)) media.currentTime = target;
    }
  };
  const setLoop = (next: boolean, persist = true): void => {
    media.loop = next;
    loopRow.setAttribute('aria-checked', String(next));
    if (persist) safeSet(LOOP_KEY, String(next));
  };
  // Restore shared preferences before applying this block's Loop edit.
  const storedRate = Number(safeGet(RATE_KEY) ?? NaN);
  if (Number.isFinite(storedRate) && storedRate > 0) setRate(storedRate);
  const storedLoop = safeGet(LOOP_KEY);
  if (storedLoop !== null) setLoop(storedLoop === 'true');
  if (loopOverride !== undefined) setLoop(loopOverride, false);

  // Another tab changed a shared preference. Exact keys only: position is per-tab.
  const onStorage = (event: StorageEvent): void => {
    if (store === null || event.storageArea !== store || event.newValue === null) return;
    if (event.key === VOL_KEY) {
      try { applyStoredVolume(event.newValue); } catch { /* corrupt entry */ }
    } else if (event.key === RATE_KEY) {
      const rate = Number(event.newValue);
      if (Number.isFinite(rate) && rate > 0) setRate(rate);
    } else if (event.key === LOOP_KEY) {
      setLoop(event.newValue === 'true');
    }
  };
  window.addEventListener('storage', onStorage);

  playToggle.addEventListener('click', togglePlay);
  centerPlay.addEventListener('click', () => { void media.play(); });
  // A native <button> already activates on Enter/Space (firing click), so a
  // dedicated keydown handler would double-toggle — the click listener covers all.
  time.addEventListener('click', (event) => { event.stopPropagation(); toggleTimeMode(); });
  // Click anywhere on the video to play/pause (the control bar sits above with
  // its own pointer-events, so its hits never reach the media). A click after a
  // press-and-hold is swallowed by onVideoClick.
  video.addEventListener('click', onVideoClick);
  video.addEventListener('pointerdown', onPointerDown);
  video.addEventListener('pointerup', onPointerUp);
  // Pointer leaving / cancelling restores 1× but is NOT a release, so it must not
  // suppress the next legitimate click.
  video.addEventListener('pointerleave', releaseHold);
  video.addEventListener('pointercancel', releaseHold);
  video.addEventListener('keydown', onVideoKeydown);
  seekFlash.addEventListener('animationend', onSeekFlashEnd);
  burst.addEventListener('animationend', onBurstEnd);
  seek.addEventListener('input', onSeekInput);
  seek.addEventListener('pointermove', onSeekHover);
  seek.addEventListener('pointerleave', onSeekHoverLeave);
  muteToggle.addEventListener('click', onMuteClick);
  muteToggle.addEventListener('animationend', onMuteBumpEnd);
  volume.addEventListener('input', onVolumeInput);
  fullscreen.addEventListener('click', onFullscreen);

  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('progress', onProgress);
  video.addEventListener('play', onPlay);
  video.addEventListener('play', startSeekLoop);
  video.addEventListener('pause', stopSeekLoop);
  seek.addEventListener('pointerdown', onSeekScrubStart);
  document.addEventListener('pointerup', onSeekScrubEnd);
  document.addEventListener('pointercancel', onSeekScrubEnd);
  video.addEventListener('play', startAmbient);
  video.addEventListener('play', updateCenter);
  video.addEventListener('play', scheduleHide);
  video.addEventListener('pause', stopAmbient);
  video.addEventListener('pause', onPause);
  video.addEventListener('pause', updateCenter);
  video.addEventListener('pause', revealControls);
  video.addEventListener('timeupdate', updateCenter);
  video.addEventListener('timeupdate', persistPosition);
  video.addEventListener('timeupdate', refreshStats);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('playing', onPlayingMedia);
  video.addEventListener('canplay', onCanPlay);
  video.addEventListener('volumechange', onVolumeChange);
  video.addEventListener('volumechange', persistVolume);
  video.addEventListener('loadedmetadata', restoreState);
  figure.addEventListener('pointermove', revealControls);
  figure.addEventListener('focusin', revealOnKeyboardFocus);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  updateCenter();

  const destroy = (): void => {
    if (hold.timer) clearTimeout(hold.timer);
    if (state.idleTimer) clearTimeout(state.idleTimer);
    document.removeEventListener('mousedown', onMenuOutside);
    detachReadOnlyContextMenu?.();
    window.removeEventListener('keydown', onTheaterKey, true);
    window.removeEventListener('storage', onStorage);
    stopStepHold();
    endMenuResize();
    speedWire.destroy();
    stopSeekLoop();
    video.removeEventListener('play', startSeekLoop);
    video.removeEventListener('pause', stopSeekLoop);
    seek.removeEventListener('pointerdown', onSeekScrubStart);
    document.removeEventListener('pointerup', onSeekScrubEnd);
    document.removeEventListener('pointercancel', onSeekScrubEnd);
    stopAmbient();
    video.removeEventListener('play', startAmbient);
    video.removeEventListener('play', updateCenter);
    video.removeEventListener('play', scheduleHide);
    video.removeEventListener('pause', stopAmbient);
    video.removeEventListener('pause', updateCenter);
    video.removeEventListener('pause', revealControls);
    video.removeEventListener('timeupdate', updateCenter);
    video.removeEventListener('timeupdate', persistPosition);
    video.removeEventListener('timeupdate', refreshStats);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('playing', onPlayingMedia);
    video.removeEventListener('canplay', onCanPlay);
    video.removeEventListener('volumechange', persistVolume);
    video.removeEventListener('loadedmetadata', restoreState);
    figure.removeEventListener('pointermove', revealControls);
    figure.removeEventListener('focusin', revealOnKeyboardFocus);
    if (pipBtn) {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
    }
    video.removeEventListener('click', onVideoClick);
    video.removeEventListener('pointerdown', onPointerDown);
    video.removeEventListener('pointerup', onPointerUp);
    video.removeEventListener('pointerleave', releaseHold);
    video.removeEventListener('pointercancel', releaseHold);
    video.removeEventListener('keydown', onVideoKeydown);
    seekFlash.removeEventListener('animationend', onSeekFlashEnd);
    seek.removeEventListener('pointermove', onSeekHover);
    seek.removeEventListener('pointerleave', onSeekHoverLeave);
    if (preview.el) {
      preview.el.removeEventListener('seeked', drawPreviewFrame);
      preview.el.removeAttribute('src');
      preview.el.load();
      preview.el.remove();
      preview.el = null;
    }
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('volumechange', onVolumeChange);
    volumeIcon.destroy();
    muteToggle.removeEventListener('animationend', onMuteBumpEnd);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('pointerdown', onTheaterOutside);
    cancelFlip();
    removeFromTopLayer(figure);
    // Drop any slot height reserved for an in-progress theater session.
    const slot = figure.parentElement;
    if (slot) slot.style.minHeight = '';
    closeMenu(); // drop the resize/outside listeners if the menu was open
    menu.remove(); // the menu lives on the figure, so root.remove() won't take it
    root.remove();
  };

  return { element: root, setTheater, toggleStats, destroy };
}

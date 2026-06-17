import {
  IconExpandFullscreen,
  IconPlayerBackward,
  IconPlayerForward,
  IconPlayerFullscreenExit,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerVolume,
  IconPlayerVolumeMute,
} from '../../components/icons';

export interface ControlsOptions {
  video: HTMLVideoElement;
  figure: HTMLElement;
}

export interface ControlsHandle {
  element: HTMLElement;
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
export function attachControls({ video, figure }: ControlsOptions): ControlsHandle {
  const root = document.createElement('div');
  root.className = 'blok-video-controls';
  root.setAttribute('data-role', 'video-controls');

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

  // Bottom scrim + control bar.
  const bar = document.createElement('div');
  bar.className = 'blok-video-controls__bar';

  const playToggle = button('play-toggle', 'Play', IconPlayerPlay);

  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '0';
  seek.step = 'any';
  seek.value = '0';
  seek.className = 'blok-video-controls__seek';
  seek.setAttribute('data-role', 'seek');
  seek.setAttribute('aria-label', 'Seek');

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

  seekWrap.append(seekBuffered, seek, seekTooltip);

  const time = document.createElement('span');
  time.className = 'blok-video-controls__time';
  time.setAttribute('data-role', 'time');
  time.textContent = '0:00 / 0:00';

  const muteToggle = button('mute-toggle', 'Mute', IconPlayerVolume);
  muteToggle.setAttribute('aria-pressed', 'false');

  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = '1';
  volume.className = 'blok-video-controls__volume';
  volume.setAttribute('data-role', 'volume');
  volume.setAttribute('aria-label', 'Volume');

  const fullscreen = button('fullscreen', 'Fullscreen', IconExpandFullscreen);

  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'blok-video-controls__volume-wrap';
  volumeWrap.append(muteToggle, volume);

  bar.append(playToggle, time, seekWrap, volumeWrap, fullscreen);
  root.appendChild(bar);

  // Thin elapsed line pinned to the player's bottom edge — reads the shared
  // `--blok-seek-pct` and is revealed by CSS only while the control bar is
  // hidden (the auto-hide bucket sets that state).
  const miniProgress = document.createElement('div');
  miniProgress.className = 'blok-video-controls__mini';
  miniProgress.setAttribute('data-role', 'mini-progress');
  miniProgress.setAttribute('aria-hidden', 'true');
  root.appendChild(miniProgress);

  // ----- state sync -----
  // `media` aliases the param so the property writes below are not flagged as
  // parameter reassignment.
  const media = video;
  const state = { playing: false };

  const setPlaying = (next: boolean): void => {
    state.playing = next;
    figure.setAttribute('data-playing', String(next));
    const icon = next ? IconPlayerPause : IconPlayerPlay;
    playToggle.innerHTML = icon;
    playToggle.setAttribute('aria-label', next ? 'Pause' : 'Play');
  };
  setPlaying(false);

  const renderTime = (): void => {
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  };

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
  // Float the hover tooltip over the scrubber at the cursor, reading the time at
  // that position. jsdom yields a zero rect, so the position is a no-op there
  // but the text wiring still proves out.
  const onSeekHover = (event: MouseEvent): void => {
    const rect = seek.getBoundingClientRect();
    const ratio = ratioFromPointer(event.clientX, rect);
    seekTooltip.textContent = formatTime(timeAtRatio(ratio, video.duration));
    seekTooltip.style.setProperty('--blok-tooltip-x', `${ratio * 100}%`);
    seekTooltip.setAttribute('aria-hidden', 'false');
  };
  const onSeekHoverLeave = (): void => {
    seekTooltip.setAttribute('aria-hidden', 'true');
  };
  const onPlay = (): void => setPlaying(true);
  const onPause = (): void => setPlaying(false);
  const onVolumeChange = (): void => {
    const muted = video.muted || video.volume === 0;
    muteToggle.setAttribute('aria-pressed', String(muted));
    muteToggle.innerHTML = muted ? IconPlayerVolumeMute : IconPlayerVolume;
    muteToggle.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    if (!video.muted) volume.value = String(video.volume);
  };

  const onFullscreenChange = (): void => {
    const isFull = document.fullscreenElement === figure;
    figure.setAttribute('data-fullscreen', String(isFull));
    fullscreen.innerHTML = isFull ? IconPlayerFullscreenExit : IconExpandFullscreen;
    fullscreen.setAttribute('aria-label', isFull ? 'Exit fullscreen' : 'Fullscreen');
  };

  // Flash the just-taken action's glyph in the centre, restarting the CSS
  // animation each call (remove class → force reflow → re-add).
  const flashBurst = (willPlay: boolean): void => {
    burst.innerHTML = willPlay ? IconPlayerPlay : IconPlayerPause;
    burst.classList.remove('is-active');
    void burst.offsetWidth;
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
    media.playbackRate = 1;
    speedBadge.classList.remove('is-active');
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button) return; // primary button only
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
  };

  // ----- keyboard seeking + control -----
  const SEEK_STEP = 5;
  const BIG_SEEK_STEP = 10;
  const VOL_STEP = 0.05;
  const FRAME = 1 / 30; // assumes ~30fps — the media API exposes no true frame duration
  const SPEED_STEP = 0.25;
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 2;
  // Flash the seek pill in from the side matching the jump: rewind sits left
  // (icon then label), skip sits right (label then icon). Re-arm per press. The
  // label magnitude is parameterised so ±5s arrows and ±10s j/l read truthfully.
  const flashSeek = (side: 'back' | 'forward', seconds: number = SEEK_STEP): void => {
    const icon = side === 'forward' ? IconPlayerForward : IconPlayerBackward;
    const label = `<span class="blok-video-controls__seek-flash-label">${seconds}s</span>`;
    seekFlash.setAttribute('data-side', side);
    seekFlash.innerHTML = side === 'forward' ? `${label}${icon}` : `${icon}${label}`;
    seekFlash.classList.remove('is-active');
    void seekFlash.offsetWidth;
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
    const next = Math.min(1, Math.max(0, media.volume + delta));
    media.volume = next;
    media.muted = next === 0;
    volume.value = String(next);
    onVolumeChange();
  };
  const stepSpeed = (delta: number): void => {
    media.playbackRate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, media.playbackRate + delta));
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
    media.muted = !media.muted;
    onVolumeChange();
  };
  const onVolumeInput = (): void => {
    const v = Number(volume.value);
    media.volume = v;
    media.muted = v === 0;
    onVolumeChange();
  };
  const onFullscreen = (): void => {
    if (document.fullscreenElement === figure) void document.exitFullscreen?.();
    else void figure.requestFullscreen?.();
  };

  playToggle.addEventListener('click', togglePlay);
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
  volume.addEventListener('input', onVolumeInput);
  fullscreen.addEventListener('click', onFullscreen);

  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('progress', onProgress);
  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('volumechange', onVolumeChange);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  const destroy = (): void => {
    if (hold.timer) clearTimeout(hold.timer);
    video.removeEventListener('click', onVideoClick);
    video.removeEventListener('pointerdown', onPointerDown);
    video.removeEventListener('pointerup', onPointerUp);
    video.removeEventListener('pointerleave', releaseHold);
    video.removeEventListener('pointercancel', releaseHold);
    video.removeEventListener('keydown', onVideoKeydown);
    seekFlash.removeEventListener('animationend', onSeekFlashEnd);
    seek.removeEventListener('pointermove', onSeekHover);
    seek.removeEventListener('pointerleave', onSeekHoverLeave);
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('volumechange', onVolumeChange);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    root.remove();
  };

  return { element: root, destroy };
}

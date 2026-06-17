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

  bar.append(playToggle, time, seek, volumeWrap, fullscreen);
  root.appendChild(bar);

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

  // Paint the elapsed portion of the scrubber with the accent colour.
  const paintSeek = (): void => {
    const max = Number(seek.max) || 0;
    const pct = max > 0 ? (Number(seek.value) / max) * 100 : 0;
    seek.style.setProperty('--blok-seek-pct', `${pct}%`);
  };

  const onLoadedMetadata = (): void => {
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    seek.max = String(dur);
    paintSeek();
    renderTime();
  };
  const onTimeUpdate = (): void => {
    seek.value = String(video.currentTime);
    paintSeek();
    renderTime();
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

  // ----- arrow-key seeking -----
  const SEEK_STEP = 5;
  // Flash the seek pill in from the side matching the jump: rewind sits left
  // (icon then label), skip sits right (label then icon). Re-arm per press.
  const flashSeek = (side: 'back' | 'forward'): void => {
    const icon = side === 'forward' ? IconPlayerForward : IconPlayerBackward;
    const label = `<span class="blok-video-controls__seek-flash-label">${SEEK_STEP}s</span>`;
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
  const seekBy = (delta: number): void => {
    const dur = Number.isFinite(media.duration) ? media.duration : 0;
    const next = Math.min(dur || Infinity, Math.max(0, media.currentTime + delta));
    media.currentTime = next;
    seek.value = String(next);
    paintSeek();
    renderTime();
    flashSeek(delta < 0 ? 'back' : 'forward');
  };
  const onVideoKeydown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(SEEK_STEP); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-SEEK_STEP); }
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
  muteToggle.addEventListener('click', onMuteClick);
  volume.addEventListener('input', onVolumeInput);
  fullscreen.addEventListener('click', onFullscreen);

  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('timeupdate', onTimeUpdate);
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
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('volumechange', onVolumeChange);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    root.remove();
  };

  return { element: root, destroy };
}

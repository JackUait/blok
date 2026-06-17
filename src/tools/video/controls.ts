import {
  IconCheck,
  IconExpandFullscreen,
  IconPlayerBackward,
  IconPlayerForward,
  IconPlayerFullscreenExit,
  IconPlayerPause,
  IconPlayerPip,
  IconPlayerPlay,
  IconPlayerSettings,
  IconPlayerTheater,
  IconPlayerVolume,
  IconPlayerVolumeMute,
} from '../../components/icons';

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
export function attachControls({ video, figure, storage }: ControlsOptions): ControlsHandle {
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

  // Large centre play affordance — shown while paused at the very start (à la
  // native players); a click begins playback.
  const centerPlay = document.createElement('button');
  centerPlay.type = 'button';
  centerPlay.className = 'blok-video-controls__center';
  centerPlay.setAttribute('data-role', 'center-play');
  centerPlay.setAttribute('aria-label', 'Play');
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
  time.setAttribute('role', 'button');
  time.setAttribute('tabindex', '0');
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

  // ----- state sync -----
  // `media` aliases the param so the property writes below are not flagged as
  // parameter reassignment.
  const media = video;
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
    playToggle.setAttribute('aria-label', next ? 'Pause' : 'Play');
  };
  setPlaying(false);

  const renderTime = (): void => {
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
    centerPlay.hidden = state.playing || video.currentTime > 0;
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
    // Restore the gear-menu-selected rate, not a hardcoded 1× — so holding to
    // peek at 2× returns to whatever speed the user actually chose.
    media.playbackRate = state.selectedRate;
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

  // ----- gear settings menu (speed / loop) -----
  // Viewer-accessible in-player popover (the block ☰ menu is editor-only). Built
  // here so it shares the player's closure state.
  const menuItem = (action: string, label: string, role: 'menuitemradio' | 'menuitemcheckbox'): HTMLButtonElement => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'blok-video-controls__menu-item';
    item.setAttribute('data-action', action);
    item.setAttribute('role', role);
    item.setAttribute('aria-checked', 'false');
    const text = document.createElement('span');
    text.className = 'blok-video-controls__menu-label';
    text.textContent = label;
    const check = document.createElement('span');
    check.className = 'blok-video-controls__menu-check';
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML = IconCheck;
    item.append(text, check);
    return item;
  };
  const menuSection = (label: string): HTMLElement => {
    const heading = document.createElement('div');
    heading.className = 'blok-video-controls__menu-section';
    heading.textContent = label;
    return heading;
  };

  const gear = button('gear', 'Settings', IconPlayerSettings);
  gear.setAttribute('aria-haspopup', 'menu');
  gear.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'blok-video-controls__menu';
  menu.setAttribute('data-role', 'playback-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const menuWrap = document.createElement('div');
  menuWrap.className = 'blok-video-controls__menu-wrap';
  menuWrap.append(gear, menu);

  // Speeds render as a compact chip grid rather than eight stacked radio rows —
  // a denser, more legible speed picker that the active chip lights up coral.
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const speedItems = SPEEDS.map((rate) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'blok-video-controls__speed-chip';
    chip.setAttribute('data-action', `speed-${rate}`);
    chip.setAttribute('role', 'menuitemradio');
    chip.setAttribute('aria-checked', String(rate === 1));
    chip.textContent = `${rate}×`;
    chip.addEventListener('click', () => setRate(rate));
    return chip;
  });
  const speedGrid = document.createElement('div');
  speedGrid.className = 'blok-video-controls__speed-grid';
  speedGrid.setAttribute('data-role', 'speed-grid');
  speedGrid.append(...speedItems);
  const setRate = (rate: number): void => {
    state.selectedRate = rate;
    media.playbackRate = rate;
    speedItems.forEach((item) => {
      item.setAttribute('aria-checked', String(item.getAttribute('data-action') === `speed-${rate}`));
    });
  };

  const loopItem = menuItem('loop', 'Loop', 'menuitemcheckbox');
  loopItem.addEventListener('click', () => {
    media.loop = !media.loop;
    loopItem.setAttribute('aria-checked', String(media.loop));
  });

  menu.append(
    menuSection('Speed'),
    speedGrid,
    loopItem,
  );
  bar.insertBefore(menuWrap, fullscreen);

  const onMenuOutside = (event: MouseEvent): void => {
    if (menu.hidden) return;
    const target = event.target as Node | null;
    if (target && menuWrap.contains(target)) return;
    closeMenu();
  };
  const openMenu = (): void => {
    if (!menu.hidden) return;
    menu.hidden = false;
    gear.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onMenuOutside);
  };
  const closeMenu = (): void => {
    if (menu.hidden) return;
    menu.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onMenuOutside);
  };
  gear.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  // ----- view modes: ambient glow / theater / picture-in-picture -----
  // Ambient — a blurred canvas behind the figure sampled from the current frame.
  // Off under reduced motion; the pixel sampling itself is live-verify only.
  const ambientCanvas = document.createElement('canvas');
  ambientCanvas.className = 'blok-video-controls__ambient';
  ambientCanvas.setAttribute('data-role', 'video-ambient');
  ambientCanvas.setAttribute('aria-hidden', 'true');
  figure.insertBefore(ambientCanvas, figure.firstChild);

  const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  ambientCanvas.setAttribute('data-ambient', reducedMotion ? 'off' : 'on');
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
    if (reducedMotion || ambient.raf) return;
    ambient.raf = requestAnimationFrame(sampleAmbient);
  };
  const stopAmbient = (): void => {
    if (!ambient.raf) return;
    cancelAnimationFrame(ambient.raf);
    ambient.raf = 0;
  };

  // Theater — an ephemeral presentation toggle. Promotes the figure to a
  // centred, backdrop-dimmed cinema view (CSS) and notifies the tool (which
  // re-applies it across re-renders); it never touches the inline width, so the
  // saved resize width is preserved. Escape backs out, mirroring fullscreen.
  const theaterBtn = button('theater', 'Theater mode', IconPlayerTheater);
  theaterBtn.setAttribute('aria-pressed', 'false');
  const theater = { on: false };
  const onTheaterKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') setTheater(false);
  };
  const setTheater = (on: boolean): void => {
    if (on === theater.on) return;
    theater.on = on;
    figure.setAttribute('data-theater', String(on));
    theaterBtn.setAttribute('aria-pressed', String(on));
    theaterBtn.setAttribute('aria-label', on ? 'Exit theater mode' : 'Theater mode');
    if (on) document.addEventListener('keydown', onTheaterKey);
    else document.removeEventListener('keydown', onTheaterKey);
    figure.dispatchEvent(new CustomEvent('blok-video-theater', { detail: { on } }));
  };
  theaterBtn.addEventListener('click', () => setTheater(!theater.on));
  bar.insertBefore(theaterBtn, fullscreen);

  // Picture-in-picture — only mounted when the browser supports it.
  const pipSupported = Boolean(document.pictureInPictureEnabled);
  const pipBtn = pipSupported ? button('picture-in-picture', 'Picture-in-Picture', IconPlayerPip) : null;
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

  // ----- right-click context menu + stats overlay -----
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
  const ctxLoop = ctxItem('ctx-loop', 'Loop');
  ctxLoop.setAttribute('role', 'menuitemcheckbox');
  const ctxCopy = ctxItem('copy-url', 'Copy video URL');
  const ctxCopyAt = ctxItem('copy-url-at-time', 'Copy video URL at current time');
  const ctxStats = ctxItem('stats', 'Stats for nerds');
  ctxMenu.append(ctxLoop, ctxCopy, ctxCopyAt, ctxStats);
  root.appendChild(ctxMenu);

  const statsOverlay = document.createElement('div');
  statsOverlay.className = 'blok-video-controls__stats';
  statsOverlay.setAttribute('data-role', 'video-stats');
  statsOverlay.hidden = true;
  root.appendChild(statsOverlay);

  const clipboardWrite = (text: string): void => { void navigator.clipboard?.writeText?.(text); };
  const renderStats = (): void => {
    const quality = video.getVideoPlaybackQuality?.();
    const dropped = quality ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}` : 'n/a';
    const res = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : 'n/a';
    const bufferedEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
    const health = Math.max(0, bufferedEnd - video.currentTime).toFixed(1);
    statsOverlay.innerHTML =
      `<div>Resolution: ${res}</div>`
      + `<div>Dropped frames: ${dropped}</div>`
      + `<div>Buffer health: ${health}s</div>`
      + `<div>Viewport: ${root.offsetWidth}×${root.offsetHeight}</div>`;
  };
  const toggleStats = (): void => {
    statsOverlay.hidden = !statsOverlay.hidden;
    if (!statsOverlay.hidden) renderStats();
  };
  const refreshStats = (): void => { if (!statsOverlay.hidden) renderStats(); };

  const onCtxOutside = (event: MouseEvent): void => {
    if (!ctxMenu.contains(event.target as Node)) closeCtxMenu();
  };
  const onCtxKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeCtxMenu();
  };
  const closeCtxMenu = (): void => {
    if (ctxMenu.hidden) return;
    ctxMenu.hidden = true;
    document.removeEventListener('mousedown', onCtxOutside);
    document.removeEventListener('keydown', onCtxKeydown);
  };
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    ctxLoop.setAttribute('aria-checked', String(media.loop));
    ctxMenu.style.setProperty('--blok-ctx-x', `${event.offsetX}px`);
    ctxMenu.style.setProperty('--blok-ctx-y', `${event.offsetY}px`);
    ctxMenu.hidden = false;
    document.addEventListener('mousedown', onCtxOutside);
    document.addEventListener('keydown', onCtxKeydown);
  };
  ctxLoop.addEventListener('click', () => { media.loop = !media.loop; ctxLoop.setAttribute('aria-checked', String(media.loop)); closeCtxMenu(); });
  ctxCopy.addEventListener('click', () => { clipboardWrite(video.currentSrc); closeCtxMenu(); });
  ctxCopyAt.addEventListener('click', () => { clipboardWrite(`${video.currentSrc}#t=${Math.floor(video.currentTime)}`); closeCtxMenu(); });
  ctxStats.addEventListener('click', () => { toggleStats(); closeCtxMenu(); });
  video.addEventListener('contextmenu', onContextMenu);

  // ----- volume + position persistence -----
  const store: VideoStorage | null = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const VOL_KEY = 'blok:video:volume';
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

  playToggle.addEventListener('click', togglePlay);
  centerPlay.addEventListener('click', () => { void media.play(); });
  time.addEventListener('click', (event) => { event.stopPropagation(); toggleTimeMode(); });
  time.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      toggleTimeMode();
    }
  });
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
  figure.addEventListener('focusin', revealControls);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  updateCenter();

  const destroy = (): void => {
    if (hold.timer) clearTimeout(hold.timer);
    if (state.idleTimer) clearTimeout(state.idleTimer);
    document.removeEventListener('mousedown', onMenuOutside);
    document.removeEventListener('mousedown', onCtxOutside);
    document.removeEventListener('keydown', onCtxKeydown);
    document.removeEventListener('keydown', onTheaterKey);
    video.removeEventListener('contextmenu', onContextMenu);
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
    figure.removeEventListener('focusin', revealControls);
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

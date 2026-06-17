import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachControls,
  formatTime,
  bufferedPct,
  timeAtRatio,
  ratioFromPointer,
} from '../../../../src/tools/video/controls';

const fakeRanges = (pairs: [number, number][]): TimeRanges => ({
  length: pairs.length,
  start: (i: number): number => pairs[i][0],
  end: (i: number): number => pairs[i][1],
}) as TimeRanges;

interface Harness {
  figure: HTMLElement;
  video: HTMLVideoElement;
  controls: HTMLElement;
  destroy(): void;
}

const setProp = (el: HTMLElement, key: string, value: unknown): void => {
  Object.defineProperty(el, key, { value, configurable: true, writable: true });
};

const mount = (): Harness => {
  const figure = document.createElement('figure');
  const video = document.createElement('video');
  // jsdom does not implement playback — stub the methods we call.
  setProp(video, 'play', vi.fn().mockResolvedValue(undefined));
  setProp(video, 'pause', vi.fn());
  figure.appendChild(video);
  document.body.appendChild(figure);
  const { element, destroy } = attachControls({ video, figure });
  figure.appendChild(element);
  return { figure, video, controls: element, destroy };
};

const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

describe('video controls — formatTime', () => {
  it('formats seconds into m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(125)).toBe('2:05');
  });

  it('formats NaN/negative as 0:00', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-4)).toBe('0:00');
  });
});

describe('video controls — bufferedPct', () => {
  it('returns 0 for missing or empty ranges', () => {
    expect(bufferedPct(null, 0, 100)).toBe(0);
    expect(bufferedPct(fakeRanges([]), 0, 100)).toBe(0);
  });

  it('uses the range containing currentTime', () => {
    expect(bufferedPct(fakeRanges([[0, 30]]), 10, 100)).toBe(30);
    expect(bufferedPct(fakeRanges([[0, 10], [40, 60]]), 50, 100)).toBe(60);
  });

  it('falls back to the last range ending before currentTime in a gap', () => {
    expect(bufferedPct(fakeRanges([[0, 10], [40, 60]]), 20, 100)).toBe(10);
  });

  it('guards non-positive / non-finite duration and clamps to 100', () => {
    expect(bufferedPct(fakeRanges([[0, 30]]), 10, 0)).toBe(0);
    expect(bufferedPct(fakeRanges([[0, 30]]), 10, NaN)).toBe(0);
    expect(bufferedPct(fakeRanges([[0, 30]]), 10, Infinity)).toBe(0);
    expect(bufferedPct(fakeRanges([[0, 150]]), 10, 100)).toBe(100);
  });
});

describe('video controls — timeAtRatio / ratioFromPointer', () => {
  it('maps a ratio to a time and clamps the ratio', () => {
    expect(timeAtRatio(0.5, 100)).toBe(50);
    expect(timeAtRatio(-0.3, 100)).toBe(0);
    expect(timeAtRatio(1.4, 100)).toBe(100);
  });

  it('returns 0 for non-positive / non-finite duration', () => {
    expect(timeAtRatio(0.5, 0)).toBe(0);
    expect(timeAtRatio(0.5, NaN)).toBe(0);
    expect(timeAtRatio(0.5, Infinity)).toBe(0);
  });

  it('computes the pointer ratio within the track and guards zero width', () => {
    expect(ratioFromPointer(50, { left: 0, width: 100 })).toBe(0.5);
    expect(ratioFromPointer(-10, { left: 0, width: 100 })).toBe(0);
    expect(ratioFromPointer(200, { left: 0, width: 100 })).toBe(1);
    expect(ratioFromPointer(60, { left: 10, width: 100 })).toBe(0.5);
    expect(ratioFromPointer(50, { left: 0, width: 0 })).toBe(0);
  });
});

describe('video controls — structure', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('builds a custom control surface (not native controls)', () => {
    expect(h.controls.getAttribute('data-role')).toBe('video-controls');
    expect(q(h.controls, '[data-action="play-toggle"]')).toBeTruthy();
    expect(q(h.controls, '[data-role="seek"]')).toBeTruthy();
    expect(q(h.controls, '[data-role="time"]')).toBeTruthy();
    expect(q(h.controls, '[data-action="mute-toggle"]')).toBeTruthy();
    expect(q(h.controls, '[data-action="fullscreen"]')).toBeTruthy();
  });

  it('renders a centre play affordance, shown while paused at the start', () => {
    const center = q<HTMLButtonElement>(h.controls, '[data-role="center-play"]');
    expect(center.hidden).toBe(false);
  });

  it('places the sound control on the left — before the scrubber, not in the right group', () => {
    const volumeWrap = q(h.controls, '.blok-video-controls__volume-wrap');
    const seekWrap = q(h.controls, '.blok-video-controls__seek-wrap');
    // seek-wrap is flex:1 and pushes everything after it to the right edge, so
    // "on the left" means the volume control must precede the scrubber in the DOM.
    expect(volumeWrap.compareDocumentPosition(seekWrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('video controls — click-to-toggle', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('clicking the video starts playback while paused', () => {
    h.video.click();
    expect(h.video.play).toHaveBeenCalledTimes(1);
  });

  it('clicking the video pauses it once playing', () => {
    h.video.dispatchEvent(new Event('play'));
    h.video.click();
    expect(h.video.pause).toHaveBeenCalledTimes(1);
  });
});

describe('video controls — centre burst', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('flashes a play burst when starting playback', () => {
    const burst = q(h.controls, '[data-role="play-burst"]');
    expect(burst.classList.contains('is-active')).toBe(false);
    h.video.click();
    expect(burst.classList.contains('is-active')).toBe(true);
    // Play glyph is a single triangle <path>, no <rect> bars.
    expect(burst.querySelector('path')).toBeTruthy();
    expect(burst.querySelectorAll('rect')).toHaveLength(0);
  });

  it('flashes a pause burst when pausing', () => {
    h.video.dispatchEvent(new Event('play'));
    q(h.controls, '[data-role="play-burst"]').classList.remove('is-active');
    h.video.click();
    const burst = q(h.controls, '[data-role="play-burst"]');
    expect(burst.classList.contains('is-active')).toBe(true);
    // Pause glyph is two vertical <rect> bars.
    expect(burst.querySelectorAll('rect')).toHaveLength(2);
  });

  it('clears the burst once its animation ends', () => {
    h.video.click();
    const burst = q(h.controls, '[data-role="play-burst"]');
    expect(burst.classList.contains('is-active')).toBe(true);
    burst.dispatchEvent(new Event('animationend'));
    expect(burst.classList.contains('is-active')).toBe(false);
  });
});

describe('video controls — press-and-hold 2x', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { vi.useRealTimers(); h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('holding the video plays it at 2x speed', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(300);
    expect(h.video.playbackRate).toBe(2);
    expect(h.video.play).toHaveBeenCalled();
  });

  it('labels the speed badge with "2×" and a forward icon', () => {
    const badge = q(h.controls, '[data-role="speed-badge"]');
    expect(badge.textContent).toContain('2×');
    expect(badge.querySelector('svg')).toBeTruthy();
  });

  it('shows the speed badge only while held', () => {
    vi.useFakeTimers();
    const badge = q(h.controls, '[data-role="speed-badge"]');
    expect(badge.classList.contains('is-active')).toBe(false);
    h.video.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(300);
    expect(badge.classList.contains('is-active')).toBe(true);
    h.video.dispatchEvent(new Event('pointerup'));
    expect(badge.classList.contains('is-active')).toBe(false);
  });

  it('releasing the hold restores 1x and suppresses the trailing toggle', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(300);
    const playCalls = (h.video.play as ReturnType<typeof vi.fn>).mock.calls.length;
    h.video.dispatchEvent(new Event('pointerup'));
    expect(h.video.playbackRate).toBe(1);
    // The click the browser fires after the hold must NOT toggle playback.
    h.video.click();
    expect(h.video.play).toHaveBeenCalledTimes(playCalls);
    expect(h.video.pause).not.toHaveBeenCalled();
  });

  it('a quick tap never engages 2x and still toggles playback', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('pointerdown'));
    h.video.dispatchEvent(new Event('pointerup'));
    expect(h.video.playbackRate).toBe(1);
    h.video.click();
    expect(h.video.play).toHaveBeenCalledTimes(1);
  });

  it('leaving the video mid-hold restores 1x without eating the next click', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(300);
    h.video.dispatchEvent(new Event('pointerleave'));
    expect(h.video.playbackRate).toBe(1);
    h.video.click();
    expect(h.video.play).toHaveBeenCalledTimes(2);
  });
});

describe('video controls — arrow-key seek', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); setProp(h.video, 'duration', 100); h.video.dispatchEvent(new Event('loadedmetadata')); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const key = (k: string): void => { h.video.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); };

  it('ArrowRight nudges playback +5s and flashes the forward indicator', () => {
    setProp(h.video, 'currentTime', 10);
    key('ArrowRight');
    expect(h.video.currentTime).toBe(15);
    const flash = q(h.controls, '[data-role="seek-flash"]');
    expect(flash.classList.contains('is-active')).toBe(true);
    expect(flash.getAttribute('data-side')).toBe('forward');
    expect(flash.textContent).toContain('5s');
  });

  it('ArrowLeft nudges playback -5s and flashes the back indicator', () => {
    setProp(h.video, 'currentTime', 10);
    key('ArrowLeft');
    expect(h.video.currentTime).toBe(5);
    const flash = q(h.controls, '[data-role="seek-flash"]');
    expect(flash.classList.contains('is-active')).toBe(true);
    expect(flash.getAttribute('data-side')).toBe('back');
  });

  it('clamps the rewind at the start', () => {
    setProp(h.video, 'currentTime', 3);
    key('ArrowLeft');
    expect(h.video.currentTime).toBe(0);
  });

  it('clamps the skip at the duration', () => {
    setProp(h.video, 'duration', 8);
    setProp(h.video, 'currentTime', 6);
    key('ArrowRight');
    expect(h.video.currentTime).toBe(8);
  });

  it('Space toggles playback (play while paused, pause while playing)', () => {
    key(' ');
    expect(h.video.play).toHaveBeenCalledTimes(1);
    h.video.dispatchEvent(new Event('play'));
    key(' ');
    expect(h.video.pause).toHaveBeenCalledTimes(1);
  });

  it('clears the seek indicator once its animation ends', () => {
    key('ArrowRight');
    const flash = q(h.controls, '[data-role="seek-flash"]');
    expect(flash.classList.contains('is-active')).toBe(true);
    flash.dispatchEvent(new Event('animationend'));
    expect(flash.classList.contains('is-active')).toBe(false);
  });
});

describe('video controls — keyboard navigation', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); setProp(h.video, 'duration', 100); h.video.dispatchEvent(new Event('loadedmetadata')); });
  afterEach(() => {
    h.destroy();
    document.body.innerHTML = '';
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    vi.restoreAllMocks();
  });

  const key = (k: string, init: KeyboardEventInit = {}): void => {
    h.video.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  };

  it('k toggles playback like Space', () => {
    key('k');
    expect(h.video.play).toHaveBeenCalledTimes(1);
    h.video.dispatchEvent(new Event('play'));
    key('k');
    expect(h.video.pause).toHaveBeenCalledTimes(1);
  });

  it('l skips +10s and flashes a "10s" forward indicator', () => {
    setProp(h.video, 'currentTime', 10);
    key('l');
    expect(h.video.currentTime).toBe(20);
    const flash = q(h.controls, '[data-role="seek-flash"]');
    expect(flash.getAttribute('data-side')).toBe('forward');
    expect(flash.textContent).toContain('10s');
  });

  it('j rewinds -10s and flashes a "10s" back indicator', () => {
    setProp(h.video, 'currentTime', 20);
    key('j');
    expect(h.video.currentTime).toBe(10);
    const flash = q(h.controls, '[data-role="seek-flash"]');
    expect(flash.getAttribute('data-side')).toBe('back');
    expect(flash.textContent).toContain('10s');
  });

  it('l clamps at the duration, j clamps at the start', () => {
    setProp(h.video, 'currentTime', 95);
    key('l');
    expect(h.video.currentTime).toBe(100);
    setProp(h.video, 'currentTime', 4);
    key('j');
    expect(h.video.currentTime).toBe(0);
  });

  it('arrow seek still reads "5s" after the flash refactor', () => {
    setProp(h.video, 'currentTime', 10);
    key('ArrowRight');
    expect(q(h.controls, '[data-role="seek-flash"]').textContent).toContain('5s');
  });

  it('m toggles mute', () => {
    key('m');
    expect(h.video.muted).toBe(true);
    expect(q(h.controls, '[data-action="mute-toggle"]').getAttribute('aria-pressed')).toBe('true');
    key('m');
    expect(h.video.muted).toBe(false);
  });

  it('f requests fullscreen, and exits when already fullscreen', () => {
    const request = vi.fn();
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    setProp(h.figure, 'requestFullscreen', request);
    key('f');
    expect(request).toHaveBeenCalledTimes(1);

    const exit = vi.fn();
    Object.defineProperty(document, 'fullscreenElement', { value: h.figure, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true });
    key('f');
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('ArrowUp / ArrowDown change volume by 5% and clamp', () => {
    setProp(h.video, 'volume', 0.5);
    key('ArrowUp');
    expect(h.video.volume).toBeCloseTo(0.55, 5);
    key('ArrowDown');
    expect(h.video.volume).toBeCloseTo(0.5, 5);
    setProp(h.video, 'volume', 0.98);
    key('ArrowUp');
    expect(h.video.volume).toBe(1);
  });

  it('ArrowDown to zero marks the media muted', () => {
    setProp(h.video, 'volume', 0.03);
    key('ArrowDown');
    expect(h.video.volume).toBe(0);
    expect(h.video.muted).toBe(true);
    expect(q(h.controls, '[data-action="mute-toggle"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('volume keys do not flash a directional seek pill', () => {
    setProp(h.video, 'volume', 0.5);
    key('ArrowUp');
    expect(q(h.controls, '[data-role="seek-flash"]').classList.contains('is-active')).toBe(false);
  });

  it('number keys seek to that percentage of the duration', () => {
    key('5');
    expect(h.video.currentTime).toBe(50);
    expect(q<HTMLInputElement>(h.controls, '[data-role="seek"]').value).toBe('50');
    expect(q(h.controls, '[data-role="time"]').textContent).toContain('0:50');
    key('0');
    expect(h.video.currentTime).toBe(0);
    key('9');
    expect(h.video.currentTime).toBe(90);
  });

  it('number keys do not flash a directional pill', () => {
    key('5');
    expect(q(h.controls, '[data-role="seek-flash"]').classList.contains('is-active')).toBe(false);
  });

  it('number keys no-op when the duration is unknown', () => {
    const bare = mount();
    setProp(bare.video, 'currentTime', 7);
    bare.video.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    expect(bare.video.currentTime).toBe(7);
    bare.destroy();
  });

  it('Home seeks to start, End seeks to the duration', () => {
    setProp(h.video, 'currentTime', 40);
    key('Home');
    expect(h.video.currentTime).toBe(0);
    key('End');
    expect(h.video.currentTime).toBe(100);
  });

  it('. and , frame-step ~1/30s while paused', () => {
    setProp(h.video, 'currentTime', 10);
    key('.');
    expect(h.video.currentTime).toBeCloseTo(10 + 1 / 30, 5);
    setProp(h.video, 'currentTime', 10);
    key(',');
    expect(h.video.currentTime).toBeCloseTo(10 - 1 / 30, 5);
  });

  it('frame-step is a no-op while playing', () => {
    h.video.dispatchEvent(new Event('play'));
    setProp(h.video, 'currentTime', 10);
    key('.');
    expect(h.video.currentTime).toBe(10);
    key(',');
    expect(h.video.currentTime).toBe(10);
  });

  it('frame-step clamps at the start', () => {
    setProp(h.video, 'currentTime', 0);
    key(',');
    expect(h.video.currentTime).toBe(0);
  });

  it('Shift+. and Shift+, step playback speed by 0.25, clamped to [0.25, 2]', () => {
    setProp(h.video, 'playbackRate', 1);
    key('>', { shiftKey: true });
    expect(h.video.playbackRate).toBe(1.25);
    key('<', { shiftKey: true });
    expect(h.video.playbackRate).toBe(1);
    setProp(h.video, 'playbackRate', 1.9);
    key('>', { shiftKey: true });
    expect(h.video.playbackRate).toBe(2);
    setProp(h.video, 'playbackRate', 0.25);
    key('<', { shiftKey: true });
    expect(h.video.playbackRate).toBe(0.25);
  });

  it('speed keys do not activate the press-and-hold speed badge', () => {
    setProp(h.video, 'playbackRate', 1);
    key('>', { shiftKey: true });
    expect(q(h.controls, '[data-role="speed-badge"]').classList.contains('is-active')).toBe(false);
  });

  it('c is swallowed as a reserved key but changes nothing yet', () => {
    setProp(h.video, 'currentTime', 10);
    setProp(h.video, 'volume', 0.5);
    setProp(h.video, 'playbackRate', 1);
    key('c');
    expect(h.video.currentTime).toBe(10);
    expect(h.video.volume).toBe(0.5);
    expect(h.video.playbackRate).toBe(1);
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.video.pause).not.toHaveBeenCalled();
  });

  it('Ctrl / Meta / Alt chords do not hijack the player', () => {
    setProp(h.video, 'currentTime', 30);
    key('l', { ctrlKey: true });
    key('l', { metaKey: true });
    key('l', { altKey: true });
    expect(h.video.currentTime).toBe(30);
  });

  it('keydown on a sibling element does not drive the player', () => {
    setProp(h.video, 'currentTime', 30);
    const sibling = document.createElement('div');
    h.figure.appendChild(sibling);
    sibling.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(h.video.currentTime).toBe(30);
    expect(h.video.play).not.toHaveBeenCalled();
  });
});

describe('video controls — playback', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('play-toggle calls video.play() while paused and flips to playing', () => {
    q(h.controls, '[data-action="play-toggle"]').click();
    expect(h.video.play).toHaveBeenCalledTimes(1);
    // tool reflects play via the media "play" event, not the click.
    h.video.dispatchEvent(new Event('play'));
    expect(h.figure.getAttribute('data-playing')).toBe('true');
  });

  it('play-toggle calls video.pause() once the media is playing', () => {
    h.video.dispatchEvent(new Event('play'));
    q(h.controls, '[data-action="play-toggle"]').click();
    expect(h.video.pause).toHaveBeenCalledTimes(1);
  });

  it('the "pause" media event clears the playing flag', () => {
    h.video.dispatchEvent(new Event('play'));
    expect(h.figure.getAttribute('data-playing')).toBe('true');
    h.video.dispatchEvent(new Event('pause'));
    expect(h.figure.getAttribute('data-playing')).toBe('false');
  });
});

describe('video controls — progress + seeking', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('loadedmetadata seeds duration into the time label and seek range', () => {
    setProp(h.video, 'duration', 125);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(q(h.controls, '[data-role="time"]').textContent).toContain('2:05');
    expect(q<HTMLInputElement>(h.controls, '[data-role="seek"]').max).toBe('125');
  });

  it('timeupdate advances the elapsed label and fills the scrubber', () => {
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    setProp(h.video, 'currentTime', 25);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(q(h.controls, '[data-role="time"]').textContent).toContain('0:25');
    expect(q<HTMLInputElement>(h.controls, '[data-role="seek"]').value).toBe('25');
  });

  it('dragging the seek range scrubs the underlying media', () => {
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    const seek = q<HTMLInputElement>(h.controls, '[data-role="seek"]');
    seek.value = '40';
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.video.currentTime).toBe(40);
  });
});

describe('video controls — buffered bar', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); setProp(h.video, 'duration', 100); h.video.dispatchEvent(new Event('loadedmetadata')); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('paints the buffered percentage on a progress event', () => {
    setProp(h.video, 'currentTime', 10);
    setProp(h.video, 'buffered', fakeRanges([[0, 40]]));
    h.video.dispatchEvent(new Event('progress'));
    const buffered = q(h.controls, '[data-role="seek-buffered"]');
    expect(buffered.style.getPropertyValue('--blok-buffered-pct')).toBe('40%');
  });

  it('paints zero when nothing is buffered', () => {
    setProp(h.video, 'buffered', fakeRanges([]));
    h.video.dispatchEvent(new Event('progress'));
    expect(q(h.controls, '[data-role="seek-buffered"]').style.getPropertyValue('--blok-buffered-pct')).toBe('0%');
  });
});

describe('video controls — hover time tooltip', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); setProp(h.video, 'duration', 100); h.video.dispatchEvent(new Event('loadedmetadata')); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('reveals a formatted time on pointermove and hides on leave', () => {
    const tip = q(h.controls, '[data-role="seek-tooltip"]');
    expect(tip.getAttribute('aria-hidden')).toBe('true');
    const seek = q(h.controls, '[data-role="seek"]');
    // jsdom getBoundingClientRect is all-zero → ratio 0 → 0:00 (wiring proof).
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, bubbles: true }));
    expect(tip.textContent).toBe('0:00');
    expect(tip.getAttribute('aria-hidden')).toBe('false');
    seek.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(tip.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('video controls — mini progress', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('exists and reflects elapsed percentage on the controls root', () => {
    expect(q(h.controls, '[data-role="mini-progress"]')).toBeTruthy();
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    setProp(h.video, 'currentTime', 25);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('25%');
  });
});

describe('video controls — volume + fullscreen', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('mute-toggle mutes the media and reflects pressed state', () => {
    const btn = q(h.controls, '[data-action="mute-toggle"]');
    expect(h.video.muted).toBe(false);
    btn.click();
    expect(h.video.muted).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    btn.click();
    expect(h.video.muted).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('fullscreen button requests fullscreen on the figure', () => {
    const request = vi.fn();
    setProp(h.figure, 'requestFullscreen', request);
    q(h.controls, '[data-action="fullscreen"]').click();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('video controls — playback gear menu', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { vi.useRealTimers(); h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const gear = (): HTMLElement => q(h.controls, '[data-action="gear"]');
  const menu = (): HTMLElement => q(h.controls, '[data-role="playback-menu"]');

  it('renders a gear button and a hidden menu', () => {
    expect(gear().getAttribute('aria-haspopup')).toBe('menu');
    expect(gear().getAttribute('aria-expanded')).toBe('false');
    expect((menu() as HTMLElement & { hidden: boolean }).hidden).toBe(true);
  });

  it('opens and closes the menu on gear click', () => {
    gear().click();
    expect((menu() as HTMLElement & { hidden: boolean }).hidden).toBe(false);
    expect(gear().getAttribute('aria-expanded')).toBe('true');
    gear().click();
    expect((menu() as HTMLElement & { hidden: boolean }).hidden).toBe(true);
  });

  it('closes the menu on an outside mousedown', () => {
    gear().click();
    expect((menu() as HTMLElement & { hidden: boolean }).hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect((menu() as HTMLElement & { hidden: boolean }).hidden).toBe(true);
  });

  it('lists eight playback speeds with Normal active by default', () => {
    expect(menu().querySelectorAll('[data-action^="speed-"]')).toHaveLength(8);
    expect(q(h.controls, '[data-action="speed-1"]').getAttribute('aria-checked')).toBe('true');
  });

  it('selecting a speed sets playbackRate and moves the check', () => {
    q(h.controls, '[data-action="speed-1.5"]').click();
    expect(h.video.playbackRate).toBe(1.5);
    expect(q(h.controls, '[data-action="speed-1.5"]').getAttribute('aria-checked')).toBe('true');
    expect(q(h.controls, '[data-action="speed-1"]').getAttribute('aria-checked')).toBe('false');
  });

  it('loop toggles media.loop and reflects the checked state', () => {
    const loop = q(h.controls, '[data-action="loop"]');
    expect(h.video.loop).toBe(false);
    loop.click();
    expect(h.video.loop).toBe(true);
    expect(loop.getAttribute('aria-checked')).toBe('true');
    loop.click();
    expect(h.video.loop).toBe(false);
  });

  it('sleep timer pauses playback only after the chosen duration', () => {
    vi.useFakeTimers();
    q(h.controls, '[data-action="sleep-30"]').click();
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(h.video.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 1000);
    expect(h.video.pause).toHaveBeenCalledTimes(1);
  });

  it('clears a pending sleep timer on destroy', () => {
    vi.useFakeTimers();
    q(h.controls, '[data-action="sleep-60"]').click();
    h.destroy();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(h.video.pause).not.toHaveBeenCalled();
  });

  it('stable volume toggles state without throwing when Web Audio is absent', () => {
    const sv = q(h.controls, '[data-action="stable-volume"]');
    expect(sv.getAttribute('aria-checked')).toBe('false');
    expect(() => sv.click()).not.toThrow();
    expect(sv.getAttribute('aria-checked')).toBe('true');
    sv.click();
    expect(sv.getAttribute('aria-checked')).toBe('false');
  });

  it('releasing a 2× hold restores the menu-selected rate, not 1×', () => {
    vi.useFakeTimers();
    q(h.controls, '[data-action="speed-1.5"]').click();
    expect(h.video.playbackRate).toBe(1.5);
    h.video.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(300);
    expect(h.video.playbackRate).toBe(2);
    h.video.dispatchEvent(new Event('pointerup'));
    expect(h.video.playbackRate).toBe(1.5);
  });
});

describe('video controls — idle auto-hide', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { vi.useRealTimers(); h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('hides the controls after 3s of playback and reveals on pointermove', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(3000);
    expect(h.figure.getAttribute('data-controls-hidden')).toBe('true');
    h.figure.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(h.figure.getAttribute('data-controls-hidden')).toBe('false');
  });

  it('never hides while paused', () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    expect(h.figure.getAttribute('data-controls-hidden')).toBe('false');
  });

  it('reveals immediately on pause', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(3000);
    h.video.dispatchEvent(new Event('pause'));
    expect(h.figure.getAttribute('data-controls-hidden')).toBe('false');
  });

  it('clears the idle timer on destroy', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('play'));
    h.destroy();
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
  });
});

describe('video controls — centre play + buffer spinner', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('hides the centre play once playing and clicking it plays', () => {
    const center = q<HTMLButtonElement>(h.controls, '[data-role="center-play"]');
    center.click();
    expect(h.video.play).toHaveBeenCalledTimes(1);
    h.video.dispatchEvent(new Event('play'));
    expect(center.hidden).toBe(true);
  });

  it('shows the spinner on waiting and clears it on playing', () => {
    const spinner = q(h.controls, '[data-role="buffer-spinner"]');
    h.video.dispatchEvent(new Event('waiting'));
    expect(spinner.getAttribute('data-active')).toBe('true');
    h.video.dispatchEvent(new Event('playing'));
    expect(spinner.getAttribute('data-active')).toBe('false');
  });
});

describe('video controls — time label toggle', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); setProp(h.video, 'duration', 240); h.video.dispatchEvent(new Event('loadedmetadata')); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('clicking the time label switches between elapsed and remaining', () => {
    setProp(h.video, 'currentTime', 60);
    h.video.dispatchEvent(new Event('timeupdate'));
    const time = q(h.controls, '[data-role="time"]');
    expect(time.textContent).toContain('1:00 / 4:00');
    time.click();
    expect(time.textContent).toContain('-3:00');
    setProp(h.video, 'currentTime', 120);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(time.textContent).toContain('-2:00');
    time.click();
    expect(time.textContent).toContain('2:00 / 4:00');
  });
});

describe('video controls — picture-in-picture', () => {
  let h: Harness | undefined;
  const enablePiP = (on: boolean): void => {
    Object.defineProperty(document, 'pictureInPictureEnabled', { value: on, configurable: true });
  };
  afterEach(() => {
    if (h) h.destroy();
    h = undefined;
    document.body.innerHTML = '';
    Object.defineProperty(document, 'pictureInPictureEnabled', { value: false, configurable: true });
    Object.defineProperty(document, 'pictureInPictureElement', { value: null, configurable: true, writable: true });
    vi.restoreAllMocks();
  });

  it('renders a PiP button when picture-in-picture is supported', () => {
    enablePiP(true);
    h = mount();
    expect(q(h.controls, '[data-action="picture-in-picture"]')).toBeTruthy();
  });

  it('omits the PiP button when unsupported', () => {
    enablePiP(false);
    h = mount();
    expect(h.controls.querySelector('[data-action="picture-in-picture"]')).toBeNull();
  });

  it('clicking requests PiP, and exits when already active', () => {
    enablePiP(true);
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'pictureInPictureElement', { value: null, configurable: true, writable: true });
    Object.defineProperty(document, 'exitPictureInPicture', { value: exit, configurable: true });
    h = mount();
    setProp(h.video, 'requestPictureInPicture', vi.fn().mockResolvedValue({}));
    const btn = q(h.controls, '[data-action="picture-in-picture"]');
    btn.click();
    expect(h.video.requestPictureInPicture).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'pictureInPictureElement', { value: h.video, configurable: true, writable: true });
    btn.click();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('reflects active state on enter / leave events', () => {
    enablePiP(true);
    h = mount();
    const btn = q(h.controls, '[data-action="picture-in-picture"]');
    h.video.dispatchEvent(new Event('enterpictureinpicture'));
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    h.video.dispatchEvent(new Event('leavepictureinpicture'));
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('video controls — theater mode', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('toggles figure[data-theater] and aria-pressed on click', () => {
    const btn = q(h.controls, '[data-action="theater"]');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    btn.click();
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('dispatches a blok-video-theater event the tool can observe', () => {
    const seen: boolean[] = [];
    h.figure.addEventListener('blok-video-theater', (e) => seen.push((e as CustomEvent<{ on: boolean }>).detail.on));
    const btn = q(h.controls, '[data-action="theater"]');
    btn.click();
    btn.click();
    expect(seen).toEqual([true, false]);
  });
});

describe('video controls — ambient mode', () => {
  let h: Harness;
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    raf = vi.fn().mockReturnValue(1);
    caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount();
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('renders an ambient canvas scaffold behind the figure', () => {
    const canvas = h.figure.querySelector('[data-role="video-ambient"]');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not sample while paused, starts on play, stops on pause', () => {
    expect(raf).not.toHaveBeenCalled();
    h.video.dispatchEvent(new Event('play'));
    expect(raf).toHaveBeenCalled();
    h.video.dispatchEvent(new Event('pause'));
    expect(caf).toHaveBeenCalled();
  });

  it('never samples under prefers-reduced-motion', () => {
    h.destroy();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    h = mount();
    h.video.dispatchEvent(new Event('play'));
    expect(raf).not.toHaveBeenCalled();
  });

  it('cancels the sampling loop on destroy', () => {
    h.video.dispatchEvent(new Event('play'));
    h.destroy();
    expect(caf).toHaveBeenCalled();
  });
});

describe('video controls — context menu + stats', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const openCtx = (): void => {
    h.video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  };
  const menu = (): HTMLElement & { hidden: boolean } => q(h.controls, '[data-role="video-menu"]');

  it('opens a custom menu on contextmenu and prevents the default', () => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    h.video.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(menu().hidden).toBe(false);
  });

  it('copies the URL and the URL at the current time', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setProp(h.video, 'currentSrc', 'https://x/v.mp4');
    setProp(h.video, 'currentTime', 95);
    openCtx();
    q(h.controls, '[data-action="copy-url"]').click();
    expect(writeText).toHaveBeenCalledWith('https://x/v.mp4');
    openCtx();
    q(h.controls, '[data-action="copy-url-at-time"]').click();
    expect(writeText).toHaveBeenCalledWith('https://x/v.mp4#t=95');
  });

  it('toggles loop from the context menu', () => {
    openCtx();
    q(h.controls, '[data-action="ctx-loop"]').click();
    expect(h.video.loop).toBe(true);
  });

  it('closes the menu on Escape', () => {
    openCtx();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu().hidden).toBe(true);
  });

  it('toggles a stats overlay with readable fields', () => {
    setProp(h.video, 'videoWidth', 1920);
    setProp(h.video, 'videoHeight', 1080);
    setProp(h.video, 'getVideoPlaybackQuality', () => ({ droppedVideoFrames: 3, totalVideoFrames: 300 }));
    setProp(h.video, 'buffered', fakeRanges([[0, 50]]));
    setProp(h.video, 'currentTime', 10);
    openCtx();
    q(h.controls, '[data-action="stats"]').click();
    const stats = q(h.controls, '[data-role="video-stats"]');
    expect(stats.hidden).toBe(false);
    expect(stats.textContent).toContain('1920×1080');
    expect(stats.textContent).toContain('3 / 300');
  });

  it('detaches the document menu listeners on destroy', () => {
    openCtx();
    h.destroy();
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
  });
});

describe('video controls — persistence', () => {
  const makeStore = (): { data: Record<string, string | undefined>; storage: VideoStorageLike } => {
    const data: Record<string, string | undefined> = {};
    return {
      data,
      storage: {
        getItem: (k) => data[k] ?? null,
        setItem: (k, v) => { data[k] = v; },
        removeItem: (k) => { data[k] = undefined; },
      },
    };
  };
  interface VideoStorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
  const mountWith = (storage: VideoStorageLike): Harness => {
    const figure = document.createElement('figure');
    const video = document.createElement('video');
    setProp(video, 'play', vi.fn().mockResolvedValue(undefined));
    setProp(video, 'pause', vi.fn());
    figure.appendChild(video);
    document.body.appendChild(figure);
    const handle = attachControls({ video, figure, storage });
    figure.appendChild(handle.element);
    return { figure, video, controls: handle.element, destroy: handle.destroy };
  };
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('persists volume changes and restores them on a new mount', () => {
    const { data, storage } = makeStore();
    const a = mountWith(storage);
    setProp(a.video, 'volume', 0.3);
    a.video.dispatchEvent(new Event('volumechange'));
    expect(data['blok:video:volume']).toContain('0.3');
    a.destroy();
    const b = mountWith(storage);
    setProp(b.video, 'duration', 100);
    b.video.dispatchEvent(new Event('loadedmetadata'));
    expect(b.video.volume).toBeCloseTo(0.3, 5);
    b.destroy();
  });

  it('restores the saved position for the same source', () => {
    const { data, storage } = makeStore();
    const a = mountWith(storage);
    setProp(a.video, 'currentSrc', 'https://x/v.mp4');
    setProp(a.video, 'duration', 100);
    setProp(a.video, 'currentTime', 40);
    a.video.dispatchEvent(new Event('timeupdate'));
    expect(data['blok:video:pos:https://x/v.mp4']).toBeDefined();
    a.destroy();
    const b = mountWith(storage);
    setProp(b.video, 'currentSrc', 'https://x/v.mp4');
    setProp(b.video, 'duration', 100);
    b.video.dispatchEvent(new Event('loadedmetadata'));
    expect(b.video.currentTime).toBe(40);
    b.destroy();
  });

  it('does not throw when storage access fails', () => {
    const storage: VideoStorageLike = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => {},
    };
    const a = mountWith(storage);
    expect(() => { setProp(a.video, 'volume', 0.5); a.video.dispatchEvent(new Event('volumechange')); }).not.toThrow();
    a.destroy();
  });
});

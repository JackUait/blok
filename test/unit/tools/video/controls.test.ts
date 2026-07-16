import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachControls,
  formatTime,
  bufferedPct,
  timeAtRatio,
  ratioFromPointer,
} from '../../../../src/tools/video/controls';

// Mounts without an explicit storage stub fall back to jsdom's real localStorage,
// which persists across tests — clear it so persisted rate/loop/volume can't leak.
beforeEach(() => localStorage.clear());

const fakeRanges = (pairs: [number, number][]): TimeRanges => ({
  length: pairs.length,
  start: (i: number): number => pairs[i][0],
  end: (i: number): number => pairs[i][1],
}) as TimeRanges;

interface Harness {
  figure: HTMLElement;
  slot: HTMLElement;
  video: HTMLVideoElement;
  controls: HTMLElement;
  setTheater(on: boolean): void;
  destroy(): void;
}

const setProp = (el: HTMLElement, key: string, value: unknown): void => {
  Object.defineProperty(el, key, { value, configurable: true, writable: true });
};

const mount = (opts: Partial<Parameters<typeof attachControls>[0]> = {}): Harness => {
  const figure = document.createElement('figure');
  const video = document.createElement('video');
  // jsdom does not implement playback — stub the methods we call.
  setProp(video, 'play', vi.fn().mockResolvedValue(undefined));
  setProp(video, 'pause', vi.fn());
  figure.appendChild(video);
  // The figure lives in a slot (the block wrapper in the real DOM); theater must
  // reserve that slot's height so promoting the figure to the fixed top layer
  // doesn't collapse it and reflow the rest of the document.
  const slot = document.createElement('div');
  slot.appendChild(figure);
  document.body.appendChild(slot);
  const { element, setTheater, destroy } = attachControls({ video, figure, ...opts });
  figure.appendChild(element);
  return { figure, slot, video, controls: element, setTheater, destroy };
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

describe('video controls — M12 slider a11y + i18n', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const fakeI18n = (map: Record<string, string>) => ({
    has: (k: string): boolean => k in map,
    t: (k: string, vars?: Record<string, string | number>): string => {
      const raw = map[k] ?? k;
      return vars ? raw.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? '')) : raw;
    },
  });

  it('announces the seek slider as a human-readable "M:SS of M:SS" via aria-valuetext', () => {
    setProp(h.video, 'duration', 125);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    const seek = q<HTMLInputElement>(h.controls, '[data-role="seek"]');
    expect(seek.getAttribute('aria-valuetext')).toBe('0:00 of 2:05');

    setProp(h.video, 'currentTime', 65);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(seek.getAttribute('aria-valuetext')).toBe('1:05 of 2:05');
  });

  it('renders the time display as a real <button>, not a span with role=button', () => {
    const time = q(h.controls, '[data-role="time"]');
    expect(time.tagName).toBe('BUTTON');
    expect((time as HTMLButtonElement).type).toBe('button');
    expect(time.getAttribute('role')).toBeNull();
    expect(time.getAttribute('tabindex')).toBeNull();
  });

  it('the real time button still toggles elapsed/remaining on click', () => {
    setProp(h.video, 'duration', 240);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    setProp(h.video, 'currentTime', 60);
    h.video.dispatchEvent(new Event('timeupdate'));
    const time = q(h.controls, '[data-role="time"]');
    expect(time.textContent).toContain('1:00 / 4:00');
    time.click();
    expect(time.textContent).toContain('-3:00');
  });

  it('i18n-translates the control labels when an I18n instance is provided', () => {
    const other = mount({
      i18n: fakeI18n({
        'tools.video.seek': 'Chercher',
        'tools.video.volume': 'Volume FR',
        'tools.video.mute': 'Muet',
      }),
    });
    expect(q(other.controls, '[data-role="seek"]').getAttribute('aria-label')).toBe('Chercher');
    expect(q(other.controls, '[data-role="volume"]').getAttribute('aria-label')).toBe('Volume FR');
    expect(q(other.controls, '[data-action="mute-toggle"]').getAttribute('aria-label')).toBe('Muet');
    other.destroy();
  });

  it('i18n-translates the seek valuetext connector via a template key', () => {
    const other = mount({ i18n: fakeI18n({ 'tools.video.seekValueText': '{current} sur {total}' }) });
    setProp(other.video, 'duration', 60);
    other.video.dispatchEvent(new Event('loadedmetadata'));
    expect(q<HTMLInputElement>(other.controls, '[data-role="seek"]').getAttribute('aria-valuetext'))
      .toBe('0:00 sur 1:00');
    other.destroy();
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

describe('video controls — smooth scrubber', () => {
  let h: Harness;
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    vi.clearAllMocks();
    rafQueue = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { rafQueue.push(cb); return rafQueue.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    h = mount();
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  // Run every animation frame queued so far; reschedules land in a fresh queue.
  const frame = (): void => { const cbs = rafQueue; rafQueue = []; cbs.forEach((cb) => cb(0)); };

  it('advances the scrubber fill between timeupdate events while playing', () => {
    h.video.dispatchEvent(new Event('play'));
    setProp(h.video, 'currentTime', 10);
    frame();
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('10%');
    // No timeupdate event — only the animation frame loop drives this.
    setProp(h.video, 'currentTime', 20);
    frame();
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('20%');
  });

  it('stops driving the scrubber once paused', () => {
    h.video.dispatchEvent(new Event('play'));
    frame();
    h.video.dispatchEvent(new Event('pause'));
    rafQueue = [];
    setProp(h.video, 'currentTime', 50);
    frame();
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('0%');
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

describe('video controls — hover frame preview', () => {
  let h: Harness;
  const wideRect = (width: number): DOMRect => ({
    left: 0, right: width, width, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect;
  beforeEach(() => {
    vi.clearAllMocks();
    h = mount();
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('mounts a frame-preview canvas inside the tooltip', () => {
    const thumb = q(h.controls, '[data-role="seek-thumb"]');
    expect(thumb.tagName).toBe('CANVAS');
    expect(q(h.controls, '[data-role="seek-tooltip"]').contains(thumb)).toBe(true);
  });

  it('seeks a hidden preview video to the hovered time once it is ready', () => {
    const seek = q(h.controls, '[data-role="seek"]');
    h.video.setAttribute('src', 'blob:test');
    setProp(seek, 'getBoundingClientRect', () => wideRect(200));
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));
    const preview = q<HTMLVideoElement>(h.controls, '[data-role="seek-preview-source"]');
    expect(preview.getAttribute('src')).toBe('blob:test');
    // Not yet loaded — no seek issued.
    expect(preview.currentTime).toBe(0);
    preview.dispatchEvent(new Event('loadeddata'));
    expect(preview.currentTime).toBe(50);
  });

  it('skips the preview when the media has no resolvable source', () => {
    const seek = q(h.controls, '[data-role="seek"]');
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, bubbles: true }));
    expect(h.controls.querySelector('[data-role="seek-preview-source"]')).toBeNull();
  });

  it('chases the latest hovered time when a seek lands mid-move', () => {
    const seek = q(h.controls, '[data-role="seek"]');
    h.video.setAttribute('src', 'blob:test');
    setProp(seek, 'getBoundingClientRect', () => wideRect(200));
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));
    const preview = q<HTMLVideoElement>(h.controls, '[data-role="seek-preview-source"]');
    preview.dispatchEvent(new Event('loadeddata'));
    expect(preview.currentTime).toBe(50);
    // Pointer moves on while the first seek is still in flight — gets queued.
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 160, bubbles: true }));
    expect(preview.currentTime).toBe(50);
    // When the in-flight seek lands, the queued time is chased.
    preview.dispatchEvent(new Event('seeked'));
    expect(preview.currentTime).toBe(80);
  });

  it('tears down the preview video on destroy', () => {
    const seek = q(h.controls, '[data-role="seek"]');
    h.video.setAttribute('src', 'blob:test');
    setProp(seek, 'getBoundingClientRect', () => wideRect(200));
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));
    expect(h.controls.querySelector('[data-role="seek-preview-source"]')).toBeTruthy();
    h.destroy();
    expect(h.controls.querySelector('[data-role="seek-preview-source"]')).toBeNull();
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

  it('muting drives the volume slider to the very beginning', () => {
    const slider = q<HTMLInputElement>(h.controls, '[data-role="volume"]');
    setProp(h.video, 'volume', 0.6);
    h.video.dispatchEvent(new Event('volumechange'));
    expect(slider.value).toBe('0.6');
    q(h.controls, '[data-action="mute-toggle"]').click();
    expect(h.video.muted).toBe(true);
    expect(slider.value).toBe('0');
  });

  it('pops the mute icon when the user toggles mute', () => {
    const btn = q(h.controls, '[data-action="mute-toggle"]');
    expect(btn.classList.contains('is-bumped')).toBe(false);
    btn.click();
    expect(btn.classList.contains('is-bumped')).toBe(true);
  });

  it('clears the mute-icon pop once its animation ends', () => {
    const btn = q(h.controls, '[data-action="mute-toggle"]');
    btn.click();
    expect(btn.classList.contains('is-bumped')).toBe(true);
    btn.dispatchEvent(new Event('animationend'));
    expect(btn.classList.contains('is-bumped')).toBe(false);
  });

  it('does not pop the mute icon for a volume change that keeps it audible', () => {
    const btn = q(h.controls, '[data-action="mute-toggle"]');
    const slider = q<HTMLInputElement>(h.controls, '[data-role="volume"]');
    slider.value = '0.4';
    slider.dispatchEvent(new Event('input'));
    expect(btn.classList.contains('is-bumped')).toBe(false);
  });

  it('pops the mute icon when the slider is dragged to zero', () => {
    const btn = q(h.controls, '[data-action="mute-toggle"]');
    const slider = q<HTMLInputElement>(h.controls, '[data-role="volume"]');
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    expect(btn.classList.contains('is-bumped')).toBe(true);
  });

  it('fullscreen button requests fullscreen on the figure', () => {
    const request = vi.fn();
    setProp(h.figure, 'requestFullscreen', request);
    q(h.controls, '[data-action="fullscreen"]').click();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('surfaces the caption as a top title bar in fullscreen, hidden otherwise', () => {
    const cap = document.createElement('div');
    cap.setAttribute('data-role', 'video-caption');
    cap.textContent = 'Big Buck Bunny';
    h.figure.appendChild(cap);

    const title = q(h.controls, '[data-role="video-title"]');
    // No title chrome inline — it only belongs to the fullscreen surface.
    expect(title.hidden).toBe(true);

    Object.defineProperty(document, 'fullscreenElement', { value: h.figure, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(title.hidden).toBe(false);
    expect(title.textContent).toBe('Big Buck Bunny');
    expect(h.figure.getAttribute('data-fullscreen')).toBe('true');

    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(title.hidden).toBe(true);
  });

  it('keeps the fullscreen title bar hidden when the video has no caption', () => {
    const title = q(h.controls, '[data-role="video-title"]');
    Object.defineProperty(document, 'fullscreenElement', { value: h.figure, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(title.hidden).toBe(true);
    expect(title.textContent).toBe('');
  });
});

describe('video controls — playback gear menu', () => {
  let h: Harness;
  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { vi.useRealTimers(); h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const gear = (): HTMLElement => q(h.controls, '[data-action="gear"]');
  // The menu now lives on the figure (outside the clipped controls overlay), so menu
  // elements are queried from h.figure — a superset that still contains the controls.
  const menu = (): HTMLElement => q(h.figure, '[data-role="playback-menu"]');

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

  it('clicking the video while the menu is open just dismisses it without toggling playback', () => {
    gear().click();
    expect((menu() as HTMLElement & { hidden: boolean }).hidden).toBe(false);

    // Replay the real pointer sequence for a click on the video surface while the
    // menu is open: pointerdown (menu still open) → document mousedown (closes the
    // menu via the outside handler) → pointerup → click. The press is a dismiss
    // gesture, so the trailing click must NOT start playback.
    h.video.dispatchEvent(new Event('pointerdown'));
    h.video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    h.video.dispatchEvent(new Event('pointerup'));
    h.video.click();

    expect((menu() as HTMLElement & { hidden: boolean }).hidden).toBe(true);
    expect(h.video.play).not.toHaveBeenCalled();
  });

  // --- YouTube-style speed slider (readout + −/＋ steppers + continuous slider + presets) ---
  const slider = (): HTMLInputElement => q<HTMLInputElement>(h.figure, '[data-role="speed-slider"]');
  const readout = (): HTMLElement => q(h.figure, '[data-role="speed-readout"]');
  const chip = (rate: string): HTMLElement => q(h.figure, `[data-action="speed-${rate}"]`);
  const dragSlider = (value: number): void => {
    const s = slider();
    s.value = String(value);
    s.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('replaces the radio list with a continuous 0.05-step speed slider', () => {
    // No legacy radio rows / speed-option rows remain.
    expect(menu().querySelectorAll('[role="menuitemradio"]')).toHaveLength(0);
    expect(menu().querySelectorAll('.blok-video-controls__speed-option')).toHaveLength(0);
    const s = slider();
    expect(s.type).toBe('range');
    expect(s.min).toBe('0.25');
    expect(s.max).toBe('2');
    expect(s.step).toBe('0.05');
    expect(s.value).toBe('1');
  });

  it('defaults to 1× in the readout and the main-row value', () => {
    expect(readout().textContent).toBe('1×');
    expect(q(h.figure, '[data-role="menu-value-speed"]').textContent).toBe('1×');
  });

  it('dragging the slider sets a fine playbackRate and syncs the readout + main row', () => {
    dragSlider(1.15);
    expect(h.video.playbackRate).toBe(1.15);
    expect(readout().textContent).toBe('1.15×');
    expect(q(h.figure, '[data-role="menu-value-speed"]').textContent).toBe('1.15×');
  });

  it('the ＋ / − steppers nudge by 0.05 and clamp (disabled) at the bounds', () => {
    const inc = q<HTMLButtonElement>(h.figure, '[data-action="speed-inc"]');
    const dec = q<HTMLButtonElement>(h.figure, '[data-action="speed-dec"]');
    inc.click();
    expect(h.video.playbackRate).toBe(1.05);
    dec.click();
    dec.click();
    expect(h.video.playbackRate).toBe(0.95);
    // top bound
    dragSlider(2);
    inc.click();
    expect(h.video.playbackRate).toBe(2);
    expect(inc.disabled).toBe(true);
    // bottom bound
    dragSlider(0.25);
    dec.click();
    expect(h.video.playbackRate).toBe(0.25);
    expect(dec.disabled).toBe(true);
  });

  it('stepping avoids floating-point drift in the rate and readout', () => {
    const inc = q<HTMLButtonElement>(h.figure, '[data-action="speed-inc"]');
    inc.click();
    inc.click();
    inc.click();
    expect(h.video.playbackRate).toBe(1.15);
    expect(readout().textContent).toBe('1.15×');
  });

  it('offers the 0.5× / 1× / 1.5× / 2× presets as plain jump buttons — never a selection', () => {
    expect(h.figure.querySelectorAll('.blok-video-controls__speed-chip')).toHaveLength(4);
    ['0.5', '1', '1.5', '2'].forEach((rate) => {
      const c = chip(rate);
      expect(c).not.toBeNull();
      // Presets are shortcuts, not a radio group — no selected/checked semantics.
      expect(c.getAttribute('role')).not.toBe('radio');
      expect(c.hasAttribute('aria-checked')).toBe(false);
    });
    // The 1× chip reads as plain "1×" — no "Normal" caption.
    expect(chip('1').textContent).toBe('1×');
    expect(h.figure.querySelector('.blok-video-controls__speed-chip-caption')).toBeNull();
  });

  it('a preset chip jumps to its exact rate and keeps the pane open, without marking itself selected', () => {
    gear().click();
    q(h.figure, '[data-action="open-speed"]').click();
    expect(menu().getAttribute('data-view')).toBe('speed');

    chip('1.5').click();
    expect(h.video.playbackRate).toBe(1.5);
    // A preset never lights up as "selected" — it just nudges the slider.
    expect(chip('1.5').hasAttribute('aria-checked')).toBe(false);
    // Picking a preset does NOT auto-return — you stay to fine-tune (unlike the old list).
    expect(menu().getAttribute('data-view')).toBe('speed');
  });

  it('opens the speed submenu from the main row and navigates back', () => {
    // The main pane shows a "Playback speed" row carrying the current value.
    const open = q(h.figure, '[data-action="open-speed"]');
    expect(open.getAttribute('aria-haspopup')).toBe('menu');
    expect(q(h.figure, '[data-role="menu-value-speed"]').textContent).toBe('1×');

    gear().click();
    expect(menu().getAttribute('data-view')).toBe('main');
    open.click();
    expect(menu().getAttribute('data-view')).toBe('speed');
    q(h.figure, '[data-action="speed-back"]').click();
    expect(menu().getAttribute('data-view')).toBe('main');
  });

  it('pins the menu scroll position so focus-into-view cannot defeat the slide', () => {
    gear().click();
    const m = menu();
    // The two panes ride a 200%-wide track, so the overflow:hidden menu is
    // horizontally scrollable. In a real browser, focusing a control that lives
    // in the off-screen right-half pane (entering the speed submenu, picking a
    // rate) makes the browser auto-scroll the menu to reveal it — scrollLeft
    // drifts to a pane width and fights the transform-based slide, leaving the
    // tall speed pane shoved into view beside the card. The slide must be the
    // only thing that moves the panes, so the menu pins its scroll to the origin.
    m.scrollLeft = 210;
    m.scrollTop = 40;
    m.dispatchEvent(new Event('scroll'));
    expect(m.scrollLeft).toBe(0);
    expect(m.scrollTop).toBe(0);
  });

  it('mounts the menu on the figure (outside the clipped controls overlay) so it can overflow a short player', () => {
    const m = q(h.figure, '[data-role="playback-menu"]');
    // The controls overlay box is overflow:hidden in the real DOM (it rounds/clips the
    // player chrome). A tall speed submenu must therefore live on the figure, not inside
    // that overlay, or it gets clipped inside a small video instead of spilling outside.
    expect(h.figure.contains(m)).toBe(true);
    expect(h.controls.contains(m)).toBe(false);
  });

  it('parks the off-screen pane as inert so its clipped controls leave the tab order', () => {
    const speedPane = (): HTMLElement => q(h.figure, '[data-role="menu-speed"]');
    const mainPane = (): HTMLElement => q(h.figure, '[data-role="menu-main"]');

    gear().click();
    // Main view: the speed pane is parked off-screen (clipped by overflow), so its
    // rate buttons must be inert — otherwise keyboard/AT users reach invisible rows.
    expect(menu().getAttribute('data-view')).toBe('main');
    expect(speedPane().hasAttribute('inert')).toBe(true);
    expect(mainPane().hasAttribute('inert')).toBe(false);

    // Sliding to the speed view flips which pane is parked.
    q(h.figure, '[data-action="open-speed"]').click();
    expect(speedPane().hasAttribute('inert')).toBe(false);
    expect(mainPane().hasAttribute('inert')).toBe(true);
  });

  it('sizes the menu to include its own padding + border so the last row is not clipped', () => {
    // jsdom has no layout engine, so stub the pane content height and the menu's
    // chrome. The menu is box-sizing: border-box, so height must add the vertical
    // padding + border on top of the pane's scrollHeight — otherwise the content
    // box is shorter than the pane and the trailing Loop row gets clipped.
    const mainPane = q(h.figure, '[data-role="menu-main"]');
    Object.defineProperty(mainPane, 'scrollHeight', { configurable: true, value: 78 });
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      if (el === menu()) {
        return { paddingTop: '6px', paddingBottom: '6px', borderTopWidth: '1px', borderBottomWidth: '1px' } as CSSStyleDeclaration;
      }
      return realGetComputedStyle(el, pseudo ?? undefined);
    });

    gear().click(); // opens → showView('main')
    // 78 (pane) + 12 (padding) + 2 (border) = 92
    expect(menu().style.height).toBe('92px');
  });

  it('selecting a speed updates the main-row value but stays on the speed view to fine-tune', () => {
    gear().click();
    q(h.figure, '[data-action="open-speed"]').click();
    q(h.figure, '[data-action="speed-1.5"]').click();
    expect(q(h.figure, '[data-role="menu-value-speed"]').textContent).toBe('1.5×');
    // The slider is a live-adjust surface — picking a preset no longer slides back.
    expect(menu().getAttribute('data-view')).toBe('speed');
  });

  it('reopening the gear resets to the main view', () => {
    gear().click();
    q(h.figure, '[data-action="open-speed"]').click();
    expect(menu().getAttribute('data-view')).toBe('speed');
    gear().click(); // close
    gear().click(); // reopen
    expect(menu().getAttribute('data-view')).toBe('main');
  });

  it('loop toggles media.loop and reflects the checked state with On/Off text', () => {
    const loop = q(h.figure, '[data-action="loop"]');
    const value = q(h.figure, '[data-role="menu-value-loop"]');
    expect(h.video.loop).toBe(false);
    expect(value.textContent).toBe('Off');
    loop.click();
    expect(h.video.loop).toBe(true);
    expect(loop.getAttribute('aria-checked')).toBe('true');
    expect(value.textContent).toBe('On');
    loop.click();
    expect(h.video.loop).toBe(false);
    expect(value.textContent).toBe('Off');
  });

  it('does not offer a sleep timer', () => {
    expect(h.figure.querySelectorAll('[data-action^="sleep-"]')).toHaveLength(0);
    expect(h.figure.textContent).not.toContain('Sleep timer');
  });

  it('does not offer a stable-volume toggle', () => {
    expect(h.figure.querySelector('[data-action="stable-volume"]')).toBeNull();
    expect(h.figure.textContent).not.toContain('Stable volume');
  });

  it('releasing a 2× hold restores the menu-selected rate, not 1×', () => {
    vi.useFakeTimers();
    q(h.figure, '[data-action="speed-1.5"]').click();
    expect(h.video.playbackRate).toBe(1.5);
    h.video.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(300);
    expect(h.video.playbackRate).toBe(2);
    h.video.dispatchEvent(new Event('pointerup'));
    expect(h.video.playbackRate).toBe(1.5);
  });

  it('renders a leading icon glyph on each main-pane settings row', () => {
    // Each top-level row carries a leading icon span (speed = gauge, loop = repeat)
    // so the menu reads as a crafted settings panel rather than a bare text list.
    const speedRow = q(h.figure, '[data-action="open-speed"]');
    const loopRow = q(h.figure, '[data-action="loop"]');

    expect(speedRow.querySelector('.blok-video-controls__menu-icon svg')).not.toBeNull();
    expect(loopRow.querySelector('.blok-video-controls__menu-icon svg')).not.toBeNull();
  });
});

describe('video controls — preset glide animation', () => {
  let h: Harness;
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    raf = vi.fn().mockReturnValue(7);
    caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false })); // motion allowed
    h = mount();
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const chip = (rate: string): HTMLElement => q(h.figure, `[data-action="speed-${rate}"]`);
  const slider = (): HTMLInputElement => q<HTMLInputElement>(h.figure, '[data-role="speed-slider"]');

  it('applies the new rate at once but glides the thumb to it from the old position', () => {
    chip('2').click();
    // The rate (and readout) change instantly — only the thumb animates.
    expect(h.video.playbackRate).toBe(2);
    // The glide is scheduled, and the thumb starts back at the prior rate (1×),
    // not snapped to 2× — proof it travels rather than teleporting.
    expect(raf).toHaveBeenCalled();
    expect(Number(slider().value)).toBe(1);
  });

  it('jumps straight to the rate with no animation under prefers-reduced-motion', () => {
    h.destroy();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    raf.mockClear();
    h = mount();
    chip('2').click();
    expect(h.video.playbackRate).toBe(2);
    expect(Number(slider().value)).toBe(2);
    expect(raf).not.toHaveBeenCalled();
  });

  it('does not glide on a small stepper nudge — only presets animate', () => {
    raf.mockClear();
    q(h.figure, '[data-action="speed-inc"]').click();
    expect(h.video.playbackRate).toBe(1.05);
    expect(raf).not.toHaveBeenCalled();
  });

  it('cancels an in-flight glide on destroy', () => {
    chip('2').click();
    caf.mockClear();
    h.destroy();
    expect(caf).toHaveBeenCalledWith(7); // the rAF id the glide is holding
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

  it('exposes a programmatic setTheater the tool can re-apply, idempotently', () => {
    const btn = q(h.controls, '[data-action="theater"]');
    h.setTheater(true);
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // A second enter is a no-op (no thrash, no duplicate listeners).
    h.setTheater(true);
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    h.setTheater(false);
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('closes theater on a pointer-down outside the figure, ignores ones inside', () => {
    const btn = q(h.controls, '[data-action="theater"]');
    btn.click();
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    // A pointer-down inside the cinema card (e.g. on the controls) keeps it open.
    h.controls.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    // A pointer-down on the dimmed backdrop (outside the figure) closes it.
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('detaches the outside-pointer listener after leaving theater', () => {
    const btn = q(h.controls, '[data-action="theater"]');
    btn.click();
    btn.click(); // leave theater
    // A later stray outside pointer-down must not re-toggle anything.
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(h.figure.getAttribute('data-theater')).toBe('false');
  });

  // The Escape dismiss is deferred a frame (so the FLIP scale isn't dropped by
  // running inside the keydown tick); flush it before asserting.
  const nextFrame = (): Promise<void> => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });

  it('exits theater on Escape', async () => {
    const btn = q(h.controls, '[data-action="theater"]');
    btn.click();
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextFrame();
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('exits theater on Escape even when the top layer consumes the event before it bubbles to document', async () => {
    const btn = q(h.controls, '[data-action="theater"]');
    btn.click();
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    // Model the browser's popover/close-watcher: a real Escape is intercepted
    // after the capture phase, so propagation is stopped before the event ever
    // bubbles up to a document-level listener. A window capture-phase handler
    // still fires first — a bubble-phase one would silently never run.
    h.figure.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
    // Focus lives inside the figure in theater, so the event travels
    // capture(window → figure) then bubble(figure ⤬ stopped).
    h.video.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextFrame();
    expect(h.figure.getAttribute('data-theater')).toBe('false');
  });

  it('defers the Escape dismiss out of the keydown tick (so the exit FLIP keeps its scale)', async () => {
    const btn = q(h.controls, '[data-action="theater"]');
    btn.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    // Still in theater synchronously — running leaveTheater inside the Escape
    // event makes Chromium drop the morph's scale; it must start a frame later.
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    await nextFrame();
    expect(h.figure.getAttribute('data-theater')).toBe('false');
  });

  it('detaches the Escape listener after leaving theater and on destroy', () => {
    const btn = q(h.controls, '[data-action="theater"]');
    btn.click();
    btn.click(); // back out of theater
    // A stray Escape now must not re-toggle anything.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    // Re-enter, then destroy — the listener must be gone (no throw / no effect).
    btn.click();
    h.destroy();
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
  });
});

interface FakeAnimation {
  keyframes: Array<Record<string, string>>;
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
}

describe('video controls — theater entrance/exit (FLIP via Web Animations)', () => {
  let h: Harness;
  let showPopover: ReturnType<typeof vi.fn>;
  let hidePopover: ReturnType<typeof vi.fn>;
  let open = false;
  let anims: FakeAnimation[];
  // The VIDEO is a clean 16:9 (320×180 inline, 800×450 centre). The FIGURE is 28px
  // TALLER inline because the caption sits in-flow there (it's lifted out in theater,
  // so the theater figure is pure 16:9). The FLIP must measure the VIDEO, not the
  // figure — measuring the figure's mismatched aspect makes the scale non-uniform
  // (sx≠sy) and squishes the video through the whole morph ("weird at the end").
  const inlineRect = { left: 200, top: 600, width: 320, height: 180, right: 520, bottom: 780, x: 200, y: 600, toJSON() {} } as DOMRect;
  const centreRect = { left: 100, top: 50, width: 800, height: 450, right: 900, bottom: 500, x: 100, y: 50, toJSON() {} } as DOMRect;
  const figureInlineRect = { left: 200, top: 600, width: 320, height: 208, right: 520, bottom: 808, x: 200, y: 600, toJSON() {} } as DOMRect;
  const enter = (): void => q(h.controls, '[data-action="theater"]').click();
  const lastAnim = (): FakeAnimation => anims[anims.length - 1];
  // The morph is composited, not transition-driven: settle it by firing the
  // animation's finish callback (jsdom has no real clock).
  const finishMorph = (): void => lastAnim().onfinish?.();

  beforeEach(() => {
    vi.clearAllMocks();
    open = false;
    anims = [];
    showPopover = vi.fn(() => { open = true; });
    hidePopover = vi.fn(() => { open = false; });
    // Teach jsdom the Popover API + :popover-open matching the FLIP relies on.
    // `popover` must reflect on the prototype too: the controls feature-detect
    // routes through supportsPopoverAPI(), which checks `'popover' in prototype`.
    (HTMLElement.prototype as unknown as { popover: unknown }).popover = null;
    (HTMLElement.prototype as unknown as { showPopover: unknown }).showPopover = showPopover;
    (HTMLElement.prototype as unknown as { hidePopover: unknown }).hidePopover = hidePopover;
    // Stub the Web Animations API: record keyframes/options and expose onfinish so
    // the test drives settle deterministically. Must exist before mount() — the
    // player feature-detects figure.animate when attachControls runs.
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = vi.fn(function (
      this: HTMLElement,
      keyframes: Array<Record<string, string>>,
      options: KeyframeAnimationOptions,
    ): FakeAnimation {
      const anim: FakeAnimation = { keyframes, options, cancel: vi.fn(), onfinish: null };
      anims.push(anim);
      return anim;
    });
    const realMatches = HTMLElement.prototype.matches;
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, sel: string) {
      return sel === ':popover-open' ? open : realMatches.call(this, sel);
    });
    // Model the CSS: data-theater promotes the figure to the centred rect (fixed +
    // full width), as does :popover-open. So measuring AFTER the attribute is set
    // yields the centred rect — the FLIP must measure the inline rect BEFORE it.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const promoted = open || this.getAttribute('data-theater') === 'true';
      if (promoted) return centreRect;
      // Inline, the figure is taller than the video (caption in-flow); the video is
      // a clean 16:9. The FLIP must read the video so the scale stays uniform.
      return this.tagName === 'VIDEO' ? inlineRect : figureInlineRect;
    });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false })); // motion allowed
    h = mount();
  });
  afterEach(() => {
    h.destroy();
    document.body.innerHTML = '';
    delete (HTMLElement.prototype as Partial<{ popover: unknown }>).popover;
    delete (HTMLElement.prototype as Partial<{ showPopover: unknown }>).showPopover;
    delete (HTMLElement.prototype as Partial<{ hidePopover: unknown }>).hidePopover;
    delete (HTMLElement.prototype as Partial<{ animate: unknown }>).animate;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('promotes the figure into the top layer via the Popover API on enter', () => {
    enter();
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(h.figure.getAttribute('popover')).toBe('manual');
  });

  it('morphs from the real inline rect to centre via explicit WAAPI keyframes', () => {
    enter();
    // The start keyframe IS the inline rect (delta of inline(200,600,320×180) →
    // centre(100,50,800×450) = (+100,+550)/0.4), named explicitly — never read off
    // the last painted frame, which under load lags and starts the grow from a
    // half-laid-out intermediate (the "snap to a wrong size, hold, then jump").
    const { keyframes } = lastAnim();
    expect(keyframes[0].transform).toBe('translate(100px, 550px) scale(0.4, 0.4)');
    expect(keyframes[1].transform).toBe('translate(0px, 0px) scale(1, 1)');
    expect(keyframes[0].transformOrigin).toBe('top left');
    expect(keyframes[1].transformOrigin).toBe('top left');
  });

  it('drives the morph on the compositor (WAAPI), not a CSS transition primed over rAF', () => {
    enter();
    // The whole point of the rewrite: one composited animation, and NO inline
    // transition/transform styles (the rAF-primed CSS-transition path that jumped).
    expect(h.figure.animate).toHaveBeenCalledTimes(1);
    expect(h.figure.style.transition).toBe('');
    expect(h.figure.style.transform).toBe('');
  });

  it('morphs with transform only — no opacity keyframe that ghosts the video', () => {
    // A morph is pure geometry. Animating opacity toggles the <video>'s
    // hardware-overlay eligibility mid-flight, leaving a frozen copy at the inline
    // slot ("ghost"). No keyframe may carry opacity.
    enter();
    expect(lastAnim().keyframes.every((k) => !('opacity' in k))).toBe(true);
  });

  it('leaves no inline transform behind once the entrance finishes', () => {
    enter();
    finishMorph();
    expect(h.figure.style.transform).toBe('');
    expect(h.figure.style.transition).toBe('');
  });

  it('reverse-morphs on exit: shrinks centre→inline, holds, then tears down on finish', () => {
    enter();
    finishMorph(); // settle the entrance
    q(h.controls, '[data-action="theater"]').click(); // leave
    // Still promoted + animating: the card shrinks centre→inline, backdrop fading.
    expect(h.figure.getAttribute('data-theater-leaving')).toBe('true');
    expect(hidePopover).not.toHaveBeenCalled();
    const exitAnim = lastAnim();
    const { keyframes, options } = exitAnim;
    expect(keyframes[0].transform).toBe('translate(0px, 0px) scale(1, 1)');
    expect(keyframes[1].transform).toBe('translate(100px, 550px) scale(0.4, 0.4)');
    // fill:forwards holds the shrunk frame until teardown, so no snap-back to centre.
    expect(options.fill).toBe('forwards');
    // Ease-OUT so the shrink moves from frame one and decelerates into the slot —
    // an ease-in holds the card big for the first ~third then collapses fast, which
    // reads as "it suddenly shrinks". Symmetric with the entrance easing.
    expect(options.easing).toBe('cubic-bezier(0.33, 1, 0.68, 1)');
    // The teardown only fires when the shrink finishes.
    finishMorph();
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(h.figure.getAttribute('popover')).toBeNull();
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    expect(h.figure.getAttribute('data-theater-leaving')).toBeNull();
    // The forwards-fill animation MUST be canceled on teardown — otherwise its
    // collapsed transform stays applied after the popover closes, freezing the
    // inline video shrunk and displaced below its slot.
    expect(exitAnim.cancel).toHaveBeenCalledTimes(1);
  });

  it('reserves the slot height on enter and releases it on exit', () => {
    // Promoting the figure to the fixed top layer pulls it out of flow, collapsing
    // its slot to zero so the rest of the document shifts up to fill the gap. Reserve
    // the figure's inline height (208) on the slot so nothing reflows, then release it
    // on teardown so the slot tracks the figure again.
    expect(h.slot.style.minHeight).toBe('');
    enter();
    expect(h.slot.style.minHeight).toBe('208px');
    finishMorph(); // settle entrance — space stays reserved while in theater
    expect(h.slot.style.minHeight).toBe('208px');
    q(h.controls, '[data-action="theater"]').click(); // leave
    expect(h.slot.style.minHeight).toBe('208px'); // still reserved mid-exit
    finishMorph(); // teardown
    expect(h.slot.style.minHeight).toBe('');
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

  it('keeps the glow inactive until the video plays, then fades it out on pause', () => {
    const canvas = h.figure.querySelector('[data-role="video-ambient"]');
    expect(canvas?.getAttribute('data-active')).toBe('false');
    h.video.dispatchEvent(new Event('play'));
    expect(canvas?.getAttribute('data-active')).toBe('true');
    h.video.dispatchEvent(new Event('pause'));
    expect(canvas?.getAttribute('data-active')).toBe('false');
  });

  it('defaults the glow level to "minimal"', () => {
    const canvas = h.figure.querySelector('[data-role="video-ambient"]');
    expect(canvas?.getAttribute('data-glow')).toBe('minimal');
  });

  it('seeds the loop control from the persisted loop option so the gear stays in sync', () => {
    h.destroy();
    h = mount({ loop: true });
    expect(h.video.loop).toBe(true);
    const loopRow = q(h.figure, '[data-action="loop"]');
    expect(loopRow.getAttribute('aria-checked')).toBe('true');
    expect(q(h.figure, '[data-role="menu-value-loop"]').textContent).toBe('On');
  });

  it('reflects an explicit glow level on the ambient canvas', () => {
    h.destroy();
    h = mount({ glow: 'more' });
    const canvas = h.figure.querySelector('[data-role="video-ambient"]');
    expect(canvas?.getAttribute('data-glow')).toBe('more');
  });

  it('never samples when the glow is turned off', () => {
    h.destroy();
    h = mount({ glow: 'none' });
    h.video.dispatchEvent(new Event('play'));
    expect(h.figure.querySelector('[data-role="video-ambient"]')?.getAttribute('data-active')).toBe('false');
  });

  it('never samples under prefers-reduced-motion', () => {
    h.destroy();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    h = mount();
    h.video.dispatchEvent(new Event('play'));
    expect(h.figure.querySelector('[data-role="video-ambient"]')?.getAttribute('data-active')).toBe('false');
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
  const mountWith = (storage: VideoStorageLike, opts: Partial<Parameters<typeof attachControls>[0]> = {}): Harness => {
    const figure = document.createElement('figure');
    const video = document.createElement('video');
    setProp(video, 'play', vi.fn().mockResolvedValue(undefined));
    setProp(video, 'pause', vi.fn());
    figure.appendChild(video);
    const slot = document.createElement('div');
    slot.appendChild(figure);
    document.body.appendChild(slot);
    const handle = attachControls({ video, figure, storage, ...opts });
    figure.appendChild(handle.element);
    return { figure, slot, video, controls: handle.element, setTheater: handle.setTheater, destroy: handle.destroy };
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

  it('persists the playback rate and restores it on a new mount', () => {
    const { data, storage } = makeStore();
    const a = mountWith(storage);
    q(a.figure, '[data-action="speed-1.5"]').click();
    expect(data['blok:video:rate']).toBe('1.5');
    a.destroy();

    const b = mountWith(storage);
    expect(b.video.playbackRate).toBe(1.5);
    expect(q<HTMLInputElement>(b.figure, '[data-role="speed-slider"]').value).toBe('1.5');
    b.destroy();
  });

  it('ignores a corrupt stored playback rate', () => {
    const { storage } = makeStore();
    storage.setItem('blok:video:rate', 'not-a-number');
    const a = mountWith(storage);
    expect(a.video.playbackRate).toBe(1);
    a.destroy();
  });

  it('persists loop toggles and restores them on a new mount', () => {
    const { data, storage } = makeStore();
    const a = mountWith(storage);
    q(a.figure, '[data-action="loop"]').click();
    expect(data['blok:video:loop']).toBe('true');
    a.destroy();

    const b = mountWith(storage);
    expect(b.video.loop).toBe(true);
    expect(q(b.figure, '[data-action="loop"]').getAttribute('aria-checked')).toBe('true');
    b.destroy();
  });

  it('stored loop preference overrides the initial loop option', () => {
    const { storage } = makeStore();
    storage.setItem('blok:video:loop', 'false');
    const a = mountWith(storage, { loop: true });
    expect(a.video.loop).toBe(false);
    expect(q(a.figure, '[data-action="loop"]').getAttribute('aria-checked')).toBe('false');
    a.destroy();
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

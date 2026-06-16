import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachControls, formatTime } from '../../../../src/tools/video/controls';

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

  it('does not render a centre play affordance', () => {
    expect(h.controls.querySelector('[data-role="center-play"]')).toBeNull();
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

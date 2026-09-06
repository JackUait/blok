import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { attachControls, bufferedPct } from '../../../../src/tools/video/controls';
import {
  IconExpandFullscreen,
  IconPlayerBackward,
  IconPlayerForward,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerVolume,
  IconPlayerVolumeMute,
} from '../../../../src/components/icons';
import type { ControlsOptions } from '../../../../src/tools/video/controls';

// Mounts without an explicit storage stub fall back to jsdom's real localStorage,
// which survives between tests — a leaked rate/volume/loop entry silently changes
// what the next mount restores.
beforeEach(() => localStorage.clear());

interface Harness {
  figure: HTMLElement;
  slot: HTMLElement;
  video: HTMLVideoElement;
  controls: HTMLElement;
  setTheater(on: boolean): void;
  destroy(): void;
}

const setProp = <T>(target: T, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
};

const mount = (opts: Partial<ControlsOptions> = {}): Harness => {
  const figure = document.createElement('figure');
  const video = document.createElement('video');

  // jsdom implements no playback — stub the methods the controls drive.
  setProp(video, 'play', vi.fn().mockResolvedValue(undefined));
  setProp(video, 'pause', vi.fn());
  figure.appendChild(video);
  // The figure sits in a slot (the block wrapper in the real DOM); theater reserves
  // that slot's height while the figure is promoted out of flow.
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

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(ev);

  return ev;
};

const animationEnd = (target: EventTarget, name: string): void => {
  // jsdom ships no AnimationEvent, so carry animationName on a plain Event.
  const ev = new Event('animationend', { bubbles: true });

  Object.defineProperty(ev, 'animationName', { value: name });
  target.dispatchEvent(ev);
};

const fakeRanges = (pairs: [number, number][]): TimeRanges => ({
  length: pairs.length,
  start: (i: number): number => pairs[i][0],
  end: (i: number): number => pairs[i][1],
});

// Inline SVG icons carry newlines, so a row's textContent is padded around the
// real copy — collapse it before comparing.
const flatText = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// Round-trips an icon through the DOM so it can be compared to rendered innerHTML.
const iconHtml = (svg: string): string => {
  const holder = document.createElement('div');

  holder.innerHTML = svg;

  return holder.innerHTML;
};

// Every label key the player resolves, each mapped to a value nothing else produces
// so a swapped or emptied key shows up as the English fallback instead.
const I18N_KEYS = [
  'play', 'pause', 'seek', 'toggleTimeDisplay', 'mute', 'unmute', 'volume',
  'fullscreen', 'fullscreenExit', 'settings', 'playbackSpeed', 'back', 'loop',
  'on', 'off', 'speedDecrease', 'speedIncrease', 'speedPresets', 'theater',
  'theaterExit', 'pip', 'ctxCopyUrl', 'ctxCopyUrlAtTime', 'ctxStats',
];

const sentinel = (key: string): string => `i18n:${key}`;

const fakeI18n = (): { has(key: string): boolean; t(key: string): string } => {
  const map = new Map(I18N_KEYS.map((key) => [`tools.video.${key}`, sentinel(key)]));

  return {
    has: (key: string): boolean => map.has(key),
    t: (key: string): string => map.get(key) ?? key,
  };
};

describe('video controls — bufferedPct edges', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('counts a range that begins exactly at the playhead', () => {
    // `start <= currentTime`: a range opening on the playhead is the containing one.
    expect(bufferedPct(fakeRanges([[10, 30]]), 10, 100)).toBe(30);
  });

  it('returns 0 when every buffered range still lies ahead of the playhead', () => {
    // Nothing contains the playhead and nothing ended before it, so the optional
    // chain on the fallback range is what stops this from throwing.
    expect(bufferedPct(fakeRanges([[50, 60]]), 10, 100)).toBe(0);
  });

  it('returns 0 for a zero duration rather than dividing by it', () => {
    // A live stream reports duration 0; dividing would paint the bar 100% full.
    expect(bufferedPct(fakeRanges([[0, 30]]), 10, 0)).toBe(0);
  });
});

describe('video controls — built DOM contract', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const cls = (sel: string): string | null => q(h.figure, sel).getAttribute('class');

  it('names the root and its overlay layers with the classes the stylesheet targets', () => {
    expect(h.controls.getAttribute('class')).toBe('blok-video-controls');
    expect(h.controls.getAttribute('data-role')).toBe('video-controls');
    expect(cls('[data-role="play-burst"]')).toBe('blok-video-controls__burst');
    expect(cls('[data-role="speed-badge"]')).toBe('blok-video-controls__speed');
    expect(cls('[data-role="seek-flash"]')).toBe('blok-video-controls__seek-flash');
    expect(cls('[data-role="center-play"]')).toBe('blok-video-controls__center');
    expect(cls('[data-role="buffer-spinner"]')).toBe('blok-video-controls__spinner');
    expect(cls('[data-role="mini-progress"]')).toBe('blok-video-controls__mini');
    expect(cls('[data-role="video-title"]')).toBe('blok-video-controls__title');
    expect(cls('[data-role="video-ambient"]')).toBe('blok-video-controls__ambient');
    expect(cls('[data-role="video-menu"]')).toBe('blok-video-controls__ctx');
    expect(cls('[data-role="video-stats"]')).toBe('blok-video-controls__stats');
    expect(q(h.controls, '[data-role="play-burst"]').parentElement).toBe(h.controls);
  });

  it('hides the decorative layers from assistive tech', () => {
    for (const role of ['play-burst', 'speed-badge', 'seek-flash', 'buffer-spinner', 'seek-buffered', 'seek-thumb', 'mini-progress']) {
      expect(q(h.figure, `[data-role="${role}"]`).getAttribute('aria-hidden')).toBe('true');
    }
    expect(q(h.figure, '[data-role="video-ambient"]').getAttribute('aria-hidden')).toBe('true');
  });

  it('gives every bar button the single shared button class, with no trailing modifier slot', () => {
    // `button()` trims its optional extra class — an untrimmed or defaulted value
    // would leak a bogus token into the class list every stylesheet rule reads.
    for (const action of ['play-toggle', 'mute-toggle', 'gear', 'theater', 'fullscreen']) {
      const btn = q<HTMLButtonElement>(h.figure, `[data-action="${action}"]`);

      expect(btn.getAttribute('class')).toBe('blok-video-controls__btn');
      expect(btn.type).toBe('button');
    }
    expect(q<HTMLButtonElement>(h.controls, '[data-role="center-play"]').type).toBe('button');
  });

  it('starts the spinner idle and the title bar empty and hidden', () => {
    expect(q(h.controls, '[data-role="buffer-spinner"]').getAttribute('data-active')).toBe('false');
    expect(q(h.controls, '[data-role="video-title"]').hidden).toBe(true);
    expect(q(h.controls, '[data-role="video-menu"]').hidden).toBe(true);
  });

  it('configures the seek slider as a full-range continuous scrubber', () => {
    const seek = q<HTMLInputElement>(h.controls, '[data-role="seek"]');

    expect(seek.type).toBe('range');
    expect(seek.min).toBe('0');
    expect(seek.max).toBe('0');
    expect(seek.step).toBe('any');
    expect(seek.value).toBe('0');
    expect(seek.getAttribute('class')).toBe('blok-video-controls__seek');
    expect(seek.getAttribute('aria-label')).toBe('Seek');
    expect(seek.getAttribute('aria-valuetext')).toBe('0:00 of 0:00');
  });

  it('names the scrubber wrapper layers', () => {
    expect(cls('[data-role="seek-wrap"]')).toBe('blok-video-controls__seek-wrap');
    expect(cls('[data-role="seek-buffered"]')).toBe('blok-video-controls__buffered');
    expect(cls('[data-role="seek-tooltip"]')).toBe('blok-video-controls__seek-tooltip');
    expect(cls('[data-role="seek-thumb"]')).toBe('blok-video-controls__seek-thumb');
    expect(cls('[data-role="seek-time"]')).toBe('blok-video-controls__seek-time');
    expect(q(h.controls, '[data-role="seek-time"]').getAttribute('data-role')).toBe('seek-time');
    expect(q(h.controls, '[data-role="seek-wrap"]').getAttribute('data-role')).toBe('seek-wrap');
  });

  it('renders the time readout as an elapsed / total label', () => {
    const time = q(h.controls, '[data-role="time"]');

    expect(time.getAttribute('class')).toBe('blok-video-controls__time');
    expect(time.textContent).toBe('0:00 / 0:00');
    expect(time.getAttribute('aria-label')).toBe('Switch between elapsed and remaining time');
  });

  it('configures the volume slider as a 0..1 range parked at full volume', () => {
    const volume = q<HTMLInputElement>(h.controls, '[data-role="volume"]');

    expect(volume.type).toBe('range');
    expect(volume.min).toBe('0');
    expect(volume.max).toBe('1');
    expect(volume.step).toBe('0.05');
    expect(volume.value).toBe('1');
    expect(volume.getAttribute('class')).toBe('blok-video-controls__volume');
    expect(volume.getAttribute('aria-label')).toBe('Volume');
  });

  it('starts the mute button unpressed and labelled for muting', () => {
    const mute = q(h.controls, '[data-action="mute-toggle"]');

    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(mute.getAttribute('aria-label')).toBe('Mute');
  });

  it('labels the play affordances for starting playback', () => {
    expect(q(h.controls, '[data-action="play-toggle"]').getAttribute('aria-label')).toBe('Play');
    expect(q(h.controls, '[data-role="center-play"]').getAttribute('aria-label')).toBe('Play');
    expect(q(h.controls, '[data-action="fullscreen"]').getAttribute('aria-label')).toBe('Full screen');
    expect(q(h.figure, '[data-action="theater"]').getAttribute('aria-label')).toBe('Theater mode');
    expect(q(h.figure, '[data-action="gear"]').getAttribute('aria-label')).toBe('Settings');
  });

  it('marks the control bar so the scrim and layout rules apply', () => {
    const bar = q(h.controls, '[data-action="play-toggle"]').parentElement;

    expect(bar?.getAttribute('class')).toBe('blok-video-controls__bar');
  });
});

describe('video controls — label i18n keys', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount({ i18n: fakeI18n() }); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const label = (sel: string): string | null => q(h.figure, sel).getAttribute('aria-label');

  it('resolves every bar control label through its own translation key', () => {
    expect(label('[data-action="play-toggle"]')).toBe(sentinel('play'));
    expect(label('[data-role="center-play"]')).toBe(sentinel('play'));
    expect(label('[data-role="seek"]')).toBe(sentinel('seek'));
    expect(label('[data-role="time"]')).toBe(sentinel('toggleTimeDisplay'));
    expect(label('[data-action="mute-toggle"]')).toBe(sentinel('mute'));
    expect(label('[data-role="volume"]')).toBe(sentinel('volume'));
    expect(label('[data-action="fullscreen"]')).toBe(sentinel('fullscreen'));
    expect(label('[data-action="gear"]')).toBe(sentinel('settings'));
    expect(label('[data-action="theater"]')).toBe(sentinel('theater'));
  });

  it('resolves the pause label through its own key once playing', () => {
    h.video.dispatchEvent(new Event('play'));
    expect(label('[data-action="play-toggle"]')).toBe(sentinel('pause'));
  });

  it('resolves the unmute label through its own key once muted', () => {
    setProp(h.video, 'muted', true);
    h.video.dispatchEvent(new Event('volumechange'));
    expect(label('[data-action="mute-toggle"]')).toBe(sentinel('unmute'));
  });

  it('resolves the exit-fullscreen label through its own key', () => {
    setProp(document, 'fullscreenElement', h.figure);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(label('[data-action="fullscreen"]')).toBe(sentinel('fullscreenExit'));
  });

  it('resolves the exit-theater label through its own key', () => {
    q(h.figure, '[data-action="theater"]').click();
    expect(label('[data-action="theater"]')).toBe(sentinel('theaterExit'));
  });

  it('resolves every settings-menu label through its own key', () => {
    expect(flatText(q(h.figure, '[data-action="open-speed"]'))).toContain(sentinel('playbackSpeed'));
    expect(flatText(q(h.figure, '[data-action="loop"]'))).toContain(sentinel('loop'));
    expect(q(h.figure, '[data-role="menu-value-loop"]').textContent).toBe(sentinel('off'));
    expect(label('[data-action="speed-back"]')).toBe(sentinel('back'));
    expect(flatText(q(h.figure, '[data-action="speed-back"]'))).toBe(sentinel('playbackSpeed'));
    expect(label('[data-role="menu-speed"]')).toBe(sentinel('playbackSpeed'));
    expect(label('[data-role="speed-slider"]')).toBe(sentinel('playbackSpeed'));
    expect(label('[data-action="speed-dec"]')).toBe(sentinel('speedDecrease'));
    expect(label('[data-action="speed-inc"]')).toBe(sentinel('speedIncrease'));
    expect(q(h.figure, '[data-action="speed-0.5"]').parentElement?.getAttribute('aria-label')).toBe(sentinel('speedPresets'));
  });

  it('resolves the loop "on" label through its own key', () => {
    q(h.figure, '[data-action="loop"]').click();
    expect(q(h.figure, '[data-role="menu-value-loop"]').textContent).toBe(sentinel('on'));
  });

  it('resolves every context-menu label through its own key', () => {
    expect(q(h.controls, '[data-action="ctx-loop"]').textContent).toBe(sentinel('loop'));
    expect(q(h.controls, '[data-action="copy-url"]').textContent).toBe(sentinel('ctxCopyUrl'));
    expect(q(h.controls, '[data-action="copy-url-at-time"]').textContent).toBe(sentinel('ctxCopyUrlAtTime'));
    expect(q(h.controls, '[data-action="stats"]').textContent).toBe(sentinel('ctxStats'));
  });
});

describe('video controls — English fallback labels', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('falls back to the canonical English copy for the settings menu', () => {
    expect(flatText(q(h.figure, '[data-action="open-speed"]'))).toBe('Playback speed1×');
    expect(flatText(q(h.figure, '[data-action="loop"]'))).toBe('LoopOff');
    expect(q(h.figure, '[data-action="speed-back"]').getAttribute('aria-label')).toBe('Back');
    expect(flatText(q(h.figure, '[data-action="speed-back"]'))).toBe('Playback speed');
    expect(q(h.figure, '[data-role="menu-speed"]').getAttribute('aria-label')).toBe('Playback speed');
    expect(q(h.figure, '[data-role="speed-slider"]').getAttribute('aria-label')).toBe('Playback speed');
    expect(q(h.figure, '[data-action="speed-dec"]').getAttribute('aria-label')).toBe('Decrease playback speed');
    expect(q(h.figure, '[data-action="speed-inc"]').getAttribute('aria-label')).toBe('Increase playback speed');
    expect(q(h.figure, '[data-action="speed-0.5"]').parentElement?.getAttribute('aria-label')).toBe('Speed presets');
  });

  it('falls back to the canonical English copy for the context menu', () => {
    expect(q(h.controls, '[data-action="ctx-loop"]').textContent).toBe('Loop');
    expect(q(h.controls, '[data-action="copy-url"]').textContent).toBe('Copy video URL');
    expect(q(h.controls, '[data-action="copy-url-at-time"]').textContent).toBe('Copy video URL at current time');
    expect(q(h.controls, '[data-action="stats"]').textContent).toBe('Playback statistics');
  });

  it('falls back to "On" when loop is switched on', () => {
    q(h.figure, '[data-action="loop"]').click();
    expect(q(h.figure, '[data-role="menu-value-loop"]').textContent).toBe('On');
  });

  it('falls back to "Pause" once playing and "Unmute" once muted', () => {
    h.video.dispatchEvent(new Event('play'));
    expect(q(h.controls, '[data-action="play-toggle"]').getAttribute('aria-label')).toBe('Pause');
    setProp(h.video, 'muted', true);
    h.video.dispatchEvent(new Event('volumechange'));
    expect(q(h.controls, '[data-action="mute-toggle"]').getAttribute('aria-label')).toBe('Unmute');
  });

  it('falls back to "Exit full screen" and "Exit theater mode"', () => {
    setProp(document, 'fullscreenElement', h.figure);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(q(h.controls, '[data-action="fullscreen"]').getAttribute('aria-label')).toBe('Exit full screen');
    q(h.figure, '[data-action="theater"]').click();
    expect(q(h.figure, '[data-action="theater"]').getAttribute('aria-label')).toBe('Exit theater mode');
  });
});

describe('video controls — menu structure', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('names the menu shell and its panes', () => {
    expect(q(h.figure, '[data-role="playback-menu"]').getAttribute('class')).toBe('blok-video-controls__menu');
    expect(q(h.figure, '[data-role="playback-menu"]').getAttribute('role')).toBe('menu');
    expect(q(h.figure, '[data-role="playback-menu"]').getAttribute('data-view')).toBe('main');
    expect(q(h.figure, '[data-role="menu-main"]').getAttribute('class')).toBe('blok-video-controls__menu-pane');
    expect(q(h.figure, '[data-role="menu-speed"]').getAttribute('class')).toBe('blok-video-controls__menu-pane');
    expect(q(h.figure, '[data-role="menu-main"]').parentElement?.getAttribute('class')).toBe('blok-video-controls__menu-track');
    expect(q(h.figure, '[data-action="gear"]').parentElement?.getAttribute('class')).toBe('blok-video-controls__menu-wrap');
  });

  it('builds the speed nav row as a menuitem with icon, label, value and chevron', () => {
    const row = q<HTMLButtonElement>(h.figure, '[data-action="open-speed"]');

    expect(row.type).toBe('button');
    expect(row.getAttribute('class')).toBe('blok-video-controls__menu-row');
    expect(row.getAttribute('role')).toBe('menuitem');
    // Four element children and no stray text: an icon span, the label, the value
    // and the chevron, in that order.
    expect(row.childNodes.length).toBe(4);
    expect((row.childNodes[0] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-icon');
    expect((row.childNodes[0] as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    expect((row.childNodes[1] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-label');
    expect((row.childNodes[2] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-value');
    expect((row.childNodes[3] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-chevron');
    expect((row.childNodes[3] as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('builds the loop row as a checkable menu item', () => {
    const row = q<HTMLButtonElement>(h.figure, '[data-action="loop"]');

    expect(row.type).toBe('button');
    expect(row.getAttribute('class')).toBe('blok-video-controls__menu-row');
    expect(row.getAttribute('role')).toBe('menuitemcheckbox');
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(q(h.figure, '[data-role="menu-value-loop"]').getAttribute('class')).toBe('blok-video-controls__menu-value');
    expect((row.childNodes[1] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-label');
    expect((row.childNodes[3] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-chevron');
    expect((row.childNodes[3] as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('builds the speed pane as a labelled group with a back header and readout', () => {
    const back = q<HTMLButtonElement>(h.figure, '[data-action="speed-back"]');

    expect(q(h.figure, '[data-role="menu-speed"]').getAttribute('role')).toBe('group');
    expect(back.type).toBe('button');
    expect(back.getAttribute('class')).toBe('blok-video-controls__menu-row blok-video-controls__menu-back');
    // The chevron and the label are both appended — a dropped append leaves an
    // unreadable, unlabelled back row.
    expect(back.childNodes.length).toBe(2);
    expect((back.childNodes[0] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-chevron');
    expect((back.childNodes[0] as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    expect((back.childNodes[1] as HTMLElement).getAttribute('class')).toBe('blok-video-controls__menu-label');
    expect(q(h.figure, '[data-role="speed-readout"]').getAttribute('class')).toBe('blok-video-controls__speed-readout');
    expect(q(h.figure, '[data-role="speed-readout"]').getAttribute('aria-hidden')).toBe('true');
  });

  it('builds the speed steppers, slider and preset chips', () => {
    expect(q<HTMLButtonElement>(h.figure, '[data-action="speed-dec"]').type).toBe('button');
    expect(q(h.figure, '[data-action="speed-dec"]').getAttribute('class')).toBe('blok-video-controls__speed-step');
    expect(q(h.figure, '[data-action="speed-inc"]').getAttribute('class')).toBe('blok-video-controls__speed-step');
    expect(q(h.figure, '[data-role="speed-slider"]').getAttribute('class')).toBe('blok-video-controls__speed-slider');
    expect(q(h.figure, '[data-action="speed-dec"]').parentElement?.getAttribute('class')).toBe('blok-video-controls__speed-slider-row');
    expect(q<HTMLButtonElement>(h.figure, '[data-action="speed-2"]').type).toBe('button');
    expect(q(h.figure, '[data-action="speed-2"]').parentElement?.getAttribute('class')).toBe('blok-video-controls__speed-chips');
  });

  it('paints the speed slider fill from the rate position inside its range', () => {
    // (1 - 0.25) / (2 - 0.25) — any other arithmetic paints the wrong fill.
    expect(q(h.figure, '[data-role="speed-slider"]').style.getPropertyValue('--blok-speed-pct'))
      .toBe('42.857142857142854%');
  });

  it('builds the context menu items as menu items', () => {
    const copy = q<HTMLButtonElement>(h.controls, '[data-action="copy-url"]');

    expect(copy.type).toBe('button');
    expect(copy.getAttribute('class')).toBe('blok-video-controls__ctx-item');
    expect(copy.getAttribute('role')).toBe('menuitem');
    expect(q(h.controls, '[data-action="ctx-loop"]').getAttribute('role')).toBe('menuitemcheckbox');
    expect(q(h.controls, '[data-role="video-menu"]').getAttribute('role')).toBe('menu');
  });
});

describe('video controls — centre play, spinner and time readout', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const centre = (): HTMLElement => q(h.controls, '[data-role="center-play"]');
  const spinner = (): HTMLElement => q(h.controls, '[data-role="buffer-spinner"]');

  it('hides the centre play once the media has been played into, even while paused', () => {
    setProp(h.video, 'currentTime', 5);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(centre().hidden).toBe(true);
  });

  it('hides the centre play when the media resumes after a buffering stall', () => {
    setProp(h.video, 'currentTime', 5);
    h.video.dispatchEvent(new Event('playing'));
    expect(centre().hidden).toBe(true);
  });

  it('hides the centre play at mount when the media is already part-way through', () => {
    h.destroy();
    const figure = document.createElement('figure');
    const video = document.createElement('video');

    setProp(video, 'play', vi.fn());
    setProp(video, 'pause', vi.fn());
    setProp(video, 'currentTime', 12);
    figure.appendChild(video);
    document.body.appendChild(figure);

    const handle = attachControls({ video, figure });

    figure.appendChild(handle.element);
    expect(q(handle.element, '[data-role="center-play"]').hidden).toBe(true);
    handle.destroy();
    figure.remove();
    h = mount();
  });

  it('shows the centre play again when playback stops back at the start', () => {
    h.video.dispatchEvent(new Event('play'));
    expect(centre().hidden).toBe(true);
    h.video.dispatchEvent(new Event('pause'));
    expect(centre().hidden).toBe(false);
  });

  it('clears the buffering spinner once the media can play again', () => {
    h.video.dispatchEvent(new Event('waiting'));
    expect(spinner().getAttribute('data-active')).toBe('true');
    h.video.dispatchEvent(new Event('canplay'));
    expect(spinner().getAttribute('data-active')).toBe('false');
  });

  it('announces the scrubber position as a spoken time from the first paint', () => {
    const seek = q<HTMLInputElement>(h.controls, '[data-role="seek"]');

    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    seek.value = '40';
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seek.getAttribute('aria-valuetext')).toBe('0:40 of 1:40');
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('40%');
  });

  it('flips the time readout to remaining and back', () => {
    setProp(h.video, 'duration', 100);
    setProp(h.video, 'currentTime', 25);
    h.video.dispatchEvent(new Event('timeupdate'));
    q(h.controls, '[data-role="time"]').click();
    expect(q(h.controls, '[data-role="time"]').textContent).toBe('-1:15');
    q(h.controls, '[data-role="time"]').click();
    expect(q(h.controls, '[data-role="time"]').textContent).toBe('0:25 / 1:40');
  });

  it('keeps the time-label click off the surrounding player', () => {
    // The label sits over the video; without stopPropagation the same click would
    // also reach the player surface and toggle playback.
    const onFigureClick = vi.fn();

    h.figure.addEventListener('click', onFigureClick);
    q(h.controls, '[data-role="time"]').click();
    expect(onFigureClick).not.toHaveBeenCalled();
  });

  it('paints an empty scrubber while the duration is still unknown', () => {
    // Dividing by a zero max would write NaN% into the fill custom property.
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('0%');
  });

  it('paints the scrubber and buffered bar as soon as metadata lands', () => {
    setProp(h.video, 'duration', 100);
    setProp(h.video, 'buffered', fakeRanges([[0, 50]]));
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('0%');
    expect(q(h.controls, '[data-role="seek-buffered"]').style.getPropertyValue('--blok-buffered-pct')).toBe('50%');
  });

  it('repaints the buffered bar on every timeupdate, not only on progress', () => {
    setProp(h.video, 'duration', 100);
    setProp(h.video, 'buffered', fakeRanges([[0, 50]]));
    h.video.dispatchEvent(new Event('loadedmetadata'));
    setProp(h.video, 'buffered', fakeRanges([[0, 80]]));
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(q(h.controls, '[data-role="seek-buffered"]').style.getPropertyValue('--blok-buffered-pct')).toBe('80%');
  });
});

describe('video controls — smooth scrubber frame loop', () => {
  let h: Harness;
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;
  let queue: FrameRequestCallback[];

  beforeEach(() => {
    vi.clearAllMocks();
    queue = [];
    raf = vi.fn((cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
    caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    // Glow off: the ambient sampler owns a second frame loop, and its frames would
    // be indistinguishable from the scrubber's in these counts.
    h = mount({ glow: 'none' });
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const frame = (): void => { const cbs = queue; queue = []; cbs.forEach((cb) => cb(0)); };
  const seek = (): HTMLInputElement => q<HTMLInputElement>(h.controls, '[data-role="seek"]');

  it('keeps a single frame loop when play fires twice', () => {
    h.video.dispatchEvent(new Event('play'));
    h.video.dispatchEvent(new Event('play'));
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('cancels the frame loop it holds when playback pauses', () => {
    h.video.dispatchEvent(new Event('play'));
    h.video.dispatchEvent(new Event('pause'));
    expect(caf).toHaveBeenCalledWith(1);
  });

  it('cancels nothing on a pause that never had a loop running', () => {
    h.video.dispatchEvent(new Event('pause'));
    expect(caf).not.toHaveBeenCalled();
  });

  it('leaves the thumb alone while the user is dragging it', () => {
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    h.video.dispatchEvent(new Event('play'));
    seek().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    seek().value = '40';
    setProp(h.video, 'currentTime', 10);
    frame();
    expect(seek().value).toBe('40');
  });

  it('takes the thumb back over once the drag ends', () => {
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    h.video.dispatchEvent(new Event('play'));
    seek().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    setProp(h.video, 'currentTime', 10);
    frame();
    expect(seek().value).toBe('10');
  });
});

const wideRect = (width: number): DOMRect => ({
  left: 0, right: width, width, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
});

// Replaces the element's clock with a fixed reading, so a "chase the latest time"
// decision can be driven to an exact difference and every write is recorded.
const pinCurrentTime = (el: HTMLVideoElement, value: number): ReturnType<typeof vi.fn> => {
  const writes = vi.fn();

  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => value,
    set: (next: number) => { writes(next); },
  });

  return writes;
};

describe('video controls — hover tooltip and frame preview', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    h = mount();
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const seekEl = (): HTMLElement => q(h.controls, '[data-role="seek"]');
  const hover = (clientX: number): void => {
    setProp(seekEl(), 'getBoundingClientRect', () => wideRect(200));
    seekEl().dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true }));
  };
  const previewEl = (): HTMLVideoElement => q<HTMLVideoElement>(h.controls, '[data-role="seek-preview-source"]');

  it('floats the tooltip at the pointer as a percentage of the track', () => {
    hover(50);
    expect(q(h.controls, '[data-role="seek-tooltip"]').style.getPropertyValue('--blok-tooltip-x')).toBe('25%');
    expect(q(h.controls, '[data-role="seek-time"]').textContent).toBe('0:25');
  });

  it('builds the preview source as a muted, fully preloaded twin of the media', () => {
    h.video.setAttribute('src', 'blob:test');
    hover(100);
    expect(previewEl().getAttribute('class')).toBe('blok-video-controls__preview-source');
    expect(previewEl().muted).toBe(true);
    expect(previewEl().preload).toBe('auto');
    expect(previewEl().crossOrigin).toBeNull();
  });

  it('carries the media cross-origin mode onto the preview so the canvas stays untainted', () => {
    h.video.setAttribute('src', 'blob:test');
    h.video.crossOrigin = 'anonymous';
    hover(100);
    expect(previewEl().crossOrigin).toBe('anonymous');
  });

  it('never opens a second stream while the duration is unknown', () => {
    h.video.setAttribute('src', 'blob:test');
    setProp(h.video, 'duration', NaN);
    hover(100);
    expect(h.controls.querySelector('[data-role="seek-preview-source"]')).toBeNull();
  });

  it('never opens a second stream for an endless (live) duration', () => {
    h.video.setAttribute('src', 'blob:test');
    setProp(h.video, 'duration', Infinity);
    hover(100);
    expect(h.controls.querySelector('[data-role="seek-preview-source"]')).toBeNull();
  });

  it('never opens a second stream for a zero-length media', () => {
    h.video.setAttribute('src', 'blob:test');
    setProp(h.video, 'duration', 0);
    hover(100);
    expect(h.controls.querySelector('[data-role="seek-preview-source"]')).toBeNull();
  });

  it('seeks to a hovered start-of-media time once the preview loads', () => {
    h.video.setAttribute('src', 'blob:test');
    hover(0);
    const writes = pinCurrentTime(previewEl(), 0);

    previewEl().dispatchEvent(new Event('loadeddata'));
    expect(writes).toHaveBeenCalledWith(0);
  });

  it('drops the queued time when the pointer leaves before the preview loads', () => {
    h.video.setAttribute('src', 'blob:test');
    hover(100);
    seekEl().dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    const writes = pinCurrentTime(previewEl(), 0);

    previewEl().dispatchEvent(new Event('loadeddata'));
    expect(writes).not.toHaveBeenCalled();
  });

  it('stops chasing once the preview sits on the requested time', () => {
    h.video.setAttribute('src', 'blob:test');
    hover(100);
    previewEl().dispatchEvent(new Event('loadeddata'));
    const writes = pinCurrentTime(previewEl(), 50);

    previewEl().dispatchEvent(new Event('seeked'));
    expect(writes).not.toHaveBeenCalled();
  });

  it('chases a queued start-of-media time the preview has not reached', () => {
    h.video.setAttribute('src', 'blob:test');
    hover(100);
    previewEl().dispatchEvent(new Event('loadeddata'));
    const writes = pinCurrentTime(previewEl(), 5);

    hover(0);
    writes.mockClear();
    previewEl().dispatchEvent(new Event('seeked'));
    expect(writes).toHaveBeenCalledWith(0);
  });

  it('treats a frame-width miss as close enough and does not chase it', () => {
    h.video.setAttribute('src', 'blob:test');
    hover(100);
    previewEl().dispatchEvent(new Event('loadeddata'));
    // Exactly the 0.05s tolerance: chasing this would loop on rounding noise.
    const writes = pinCurrentTime(previewEl(), 0.05);

    hover(0);
    writes.mockClear();
    previewEl().dispatchEvent(new Event('seeked'));
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('video controls — preview frame painting', () => {
  let h: Harness;
  let drawImage: ReturnType<typeof vi.fn>;
  let context: CanvasRenderingContext2D | null;
  let getContext: ReturnType<typeof vi.fn>;
  const realGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');

  beforeEach(() => {
    vi.clearAllMocks();
    drawImage = vi.fn();
    context = { drawImage } as unknown as CanvasRenderingContext2D;
    getContext = vi.fn(() => context);
    // jsdom ships no canvas backend, so the 2d context is stubbed to observe the paint.
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true, writable: true, value: getContext,
    });
    h = mount();
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    h.video.setAttribute('src', 'blob:test');
  });
  afterEach(() => {
    h.destroy();
    document.body.innerHTML = '';
    // Restore jsdom's own accessor: deleting it would break every later mount that
    // samples the ambient canvas.
    if (realGetContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', realGetContext);
    vi.restoreAllMocks();
  });

  const thumb = (): HTMLCanvasElement => q<HTMLCanvasElement>(h.controls, '[data-role="seek-thumb"]');
  const hover = (): HTMLVideoElement => {
    const seek = q(h.controls, '[data-role="seek"]');

    setProp(seek, 'getBoundingClientRect', () => wideRect(200));
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));

    return q<HTMLVideoElement>(h.controls, '[data-role="seek-preview-source"]');
  };

  it('paints the seeked frame into the tooltip canvas at the preview aspect ratio', () => {
    const preview = hover();

    setProp(preview, 'videoWidth', 320);
    setProp(preview, 'videoHeight', 180);
    preview.dispatchEvent(new Event('seeked'));
    expect(getContext).toHaveBeenCalledWith('2d');
    expect(thumb().width).toBe(160);
    expect(thumb().height).toBe(90);
    expect(drawImage).toHaveBeenCalledWith(preview, 0, 0, 160, 90);
    expect(thumb().getAttribute('data-ready')).toBe('true');
  });

  it('paints nothing while the preview has no frame size yet', () => {
    const preview = hover();

    setProp(preview, 'videoWidth', 0);
    setProp(preview, 'videoHeight', 0);
    preview.dispatchEvent(new Event('seeked'));
    expect(drawImage).not.toHaveBeenCalled();
    expect(thumb().getAttribute('data-ready')).toBeNull();
  });

  it('leaves the canvas untouched when the browser hands back no 2d context', () => {
    const preview = hover();

    context = null;
    setProp(preview, 'videoWidth', 320);
    setProp(preview, 'videoHeight', 180);
    preview.dispatchEvent(new Event('seeked'));
    // 300 is the canvas default — resizing it before the null check would blank it.
    expect(thumb().width).toBe(300);
    expect(thumb().getAttribute('data-ready')).toBeNull();
  });
});

describe('video controls — volume and mute', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const mute = (): HTMLElement => q(h.controls, '[data-action="mute-toggle"]');
  const volume = (): HTMLInputElement => q<HTMLInputElement>(h.controls, '[data-role="volume"]');

  it('reads a zero volume as muted even when the media is not flagged muted', () => {
    h.video.volume = 0;
    h.video.dispatchEvent(new Event('volumechange'));
    expect(mute().getAttribute('aria-pressed')).toBe('true');
    expect(mute().innerHTML).toBe(iconHtml(IconPlayerVolumeMute));
  });

  it('shows the audible glyph while sound is on', () => {
    h.video.volume = 0.5;
    h.video.dispatchEvent(new Event('volumechange'));
    expect(mute().innerHTML).toBe(iconHtml(IconPlayerVolume));
  });

  it('paints the volume slider fill from the current level', () => {
    h.video.volume = 0.5;
    h.video.dispatchEvent(new Event('volumechange'));
    expect(volume().value).toBe('0.5');
    expect(volume().style.getPropertyValue('--blok-vol-pct')).toBe('50%');
  });

  it('updates the button the moment the user clicks mute, without waiting for the media', () => {
    // jsdom fires no volumechange for a scripted `muted` flip, so the click path
    // has to sync the UI itself.
    mute().click();
    expect(h.video.muted).toBe(true);
    expect(mute().getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the media muted when the slider is dragged to silence', () => {
    volume().value = '0';
    volume().dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.video.muted).toBe(true);
  });

  it('leaves the media unmuted when the slider moves to an audible level', () => {
    h.video.muted = true;
    volume().value = '0.4';
    volume().dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.video.muted).toBe(false);
    expect(h.video.volume).toBe(0.4);
  });
});

describe('video controls — keyboard volume', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('keeps the media unmuted when the volume is nudged up from an audible level', () => {
    h.video.volume = 0.5;
    press(h.video, 'ArrowUp');
    expect(h.video.muted).toBe(false);
    expect(h.video.volume).toBeCloseTo(0.55, 5);
  });
});

describe('video controls — fullscreen', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const fullscreenBtn = (): HTMLElement => q(h.controls, '[data-action="fullscreen"]');
  const titleBar = (): HTMLElement => q(h.controls, '[data-role="video-title"]');

  const caption = (text: string): void => {
    const el = document.createElement('figcaption');

    el.setAttribute('data-role', 'video-caption');
    el.textContent = text;
    h.figure.appendChild(el);
  };

  it('swaps the glyph when the player enters and leaves fullscreen', () => {
    setProp(document, 'fullscreenElement', h.figure);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(h.figure.getAttribute('data-fullscreen')).toBe('true');
    setProp(document, 'fullscreenElement', null);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(fullscreenBtn().innerHTML).toBe(iconHtml(IconExpandFullscreen));
  });

  it('trims the caption it lifts into the fullscreen title bar', () => {
    caption('   Sunset over the bay   ');
    setProp(document, 'fullscreenElement', h.figure);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(titleBar().textContent).toBe('Sunset over the bay');
    expect(titleBar().hidden).toBe(false);
  });

  it('empties the title bar on exit so a later caption edit is picked up', () => {
    caption('First caption');
    setProp(document, 'fullscreenElement', h.figure);
    document.dispatchEvent(new Event('fullscreenchange'));
    setProp(document, 'fullscreenElement', null);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(titleBar().textContent).toBe('');
  });

  it('does not throw on a browser without the Fullscreen API', () => {
    const onError = vi.fn();

    window.addEventListener('error', onError);
    fullscreenBtn().click();
    setProp(document, 'fullscreenElement', h.figure);
    fullscreenBtn().click();
    window.removeEventListener('error', onError);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('video controls — burst and seek-flash animations', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const burst = (): HTMLElement => q(h.controls, '[data-role="play-burst"]');
  const flash = (): HTMLElement => q(h.controls, '[data-role="seek-flash"]');

  it('clears the burst when its own disc animation ends', () => {
    h.video.click();
    expect(burst().classList.contains('is-active')).toBe(true);
    animationEnd(burst(), 'blok-video-burst');
    expect(burst().classList.contains('is-active')).toBe(false);
  });

  it('keeps the burst alive when a different animation on it ends', () => {
    // The radiating ring finishes separately and must not cut the disc short.
    h.video.click();
    animationEnd(burst(), 'blok-video-burst-ring');
    expect(burst().classList.contains('is-active')).toBe(true);
  });

  it('flashes the rewind pill with the glyph leading the label', () => {
    setProp(h.video, 'duration', 100);
    setProp(h.video, 'currentTime', 50);
    press(h.video, 'ArrowLeft');
    expect(flash().getAttribute('data-side')).toBe('back');
    expect(flash().innerHTML).toBe(
      `${iconHtml(IconPlayerBackward)}<span class="blok-video-controls__seek-flash-label">5s</span>`,
    );
  });

  it('flashes the skip pill with the label leading the glyph', () => {
    setProp(h.video, 'duration', 100);
    setProp(h.video, 'currentTime', 50);
    press(h.video, 'ArrowRight');
    expect(flash().getAttribute('data-side')).toBe('forward');
    expect(flash().innerHTML).toBe(
      `<span class="blok-video-controls__seek-flash-label">5s</span>${iconHtml(IconPlayerForward)}`,
    );
  });

  it('clears the seek pill when its own slide animation ends', () => {
    press(h.video, 'ArrowRight');
    animationEnd(flash(), 'blok-video-seek-flash-in-right');
    expect(flash().classList.contains('is-active')).toBe(false);
  });

  it('keeps the seek pill alive when a foreign animation on it ends', () => {
    press(h.video, 'ArrowRight');
    animationEnd(flash(), 'some-other-animation');
    expect(flash().classList.contains('is-active')).toBe(true);
  });

  it('shows the pause glyph in the burst when playback stops', () => {
    h.video.dispatchEvent(new Event('play'));
    h.video.click();
    expect(burst().innerHTML).toBe(iconHtml(IconPlayerPause));
    h.video.dispatchEvent(new Event('pause'));
    h.video.click();
    expect(burst().innerHTML).toBe(iconHtml(IconPlayerPlay));
  });
});

describe('video controls — press and hold', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

  const badge = (): HTMLElement => q(h.controls, '[data-role="speed-badge"]');
  const pointerDown = (button = 0): void => {
    h.video.dispatchEvent(new MouseEvent('pointerdown', { button, bubbles: true }));
  };

  it('ignores a press from a non-primary button', () => {
    pointerDown(2);
    vi.advanceTimersByTime(300);
    expect(h.video.playbackRate).toBe(1);
    expect(badge().classList.contains('is-active')).toBe(false);
  });

  it('does not restart playback that is already running when the hold engages', () => {
    h.video.dispatchEvent(new Event('play'));
    pointerDown();
    vi.advanceTimersByTime(300);
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.video.playbackRate).toBe(2);
  });

  it('disarms the pending hold when the press ends before the threshold', () => {
    pointerDown();
    vi.advanceTimersByTime(100);
    h.video.dispatchEvent(new Event('pointerup'));
    vi.advanceTimersByTime(300);
    expect(h.video.playbackRate).toBe(1);
    expect(badge().classList.contains('is-active')).toBe(false);
  });

  it('leaves the playback rate alone when a pointer leaves with no hold engaged', () => {
    h.video.playbackRate = 0.5;
    h.video.dispatchEvent(new Event('pointerleave'));
    expect(h.video.playbackRate).toBe(0.5);
  });

  it('lets the click after a leave-then-release through', () => {
    // Leaving the video ends the 2x peek but is not a release, so the release that
    // follows must not claim a click it never suppressed.
    h.video.dispatchEvent(new Event('play'));
    pointerDown();
    vi.advanceTimersByTime(300);
    h.video.dispatchEvent(new Event('pointerleave'));
    h.video.dispatchEvent(new Event('pointerup'));
    h.video.click();
    expect(h.video.pause).toHaveBeenCalledTimes(1);
  });

  it('swallows only the one click that ends a hold', () => {
    h.video.dispatchEvent(new Event('play'));
    pointerDown();
    vi.advanceTimersByTime(300);
    h.video.dispatchEvent(new Event('pointerup'));
    h.video.click();
    expect(h.video.pause).not.toHaveBeenCalled();
    h.video.click();
    expect(h.video.pause).toHaveBeenCalledTimes(1);
  });

  it('drops back to 1x when the pointer stream is cancelled', () => {
    pointerDown();
    vi.advanceTimersByTime(300);
    expect(h.video.playbackRate).toBe(2);
    h.video.dispatchEvent(new Event('pointercancel'));
    expect(h.video.playbackRate).toBe(1);
  });
});

describe('video controls — keyboard default suppression', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); setProp(h.video, 'duration', 100); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const OWNED_KEYS = [
    'ArrowRight', 'ArrowLeft', 'l', 'j', ' ', 'Spacebar', 'k', 'm', 'f', 'c',
    'ArrowUp', 'ArrowDown', 'Home', 'End', '.', ',', '>', '<', '5',
  ];

  it('claims every key it acts on, so the page never scrolls or scrubs twice', () => {
    for (const key of OWNED_KEYS) {
      expect(press(h.video, key).defaultPrevented).toBe(true);
    }
  });

  it('leaves keys it does not act on to the page', () => {
    expect(press(h.video, 'q').defaultPrevented).toBe(false);
    expect(press(h.video, 'Enter').defaultPrevented).toBe(false);
  });

  it('treats the legacy Spacebar key name as play/pause', () => {
    press(h.video, 'Spacebar');
    expect(h.video.play).toHaveBeenCalledTimes(1);
  });

  it('reserves "c" without moving anything yet', () => {
    setProp(h.video, 'currentTime', 30);
    press(h.video, 'c');
    expect(h.video.currentTime).toBe(30);
    expect(h.video.play).not.toHaveBeenCalled();
  });
});

describe('video controls — keyboard seeking', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    h = mount();
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('repaints the scrubber fill on an absolute jump', () => {
    press(h.video, '5');
    expect(h.video.currentTime).toBe(50);
    expect(h.controls.style.getPropertyValue('--blok-seek-pct')).toBe('50%');
  });

  it('ignores a letter key that sorts above the digits', () => {
    setProp(h.video, 'currentTime', 20);
    press(h.video, 'q');
    expect(h.video.currentTime).toBe(20);
  });

  it('ignores a punctuation key that sorts below the digits', () => {
    setProp(h.video, 'currentTime', 20);
    press(h.video, '!');
    expect(h.video.currentTime).toBe(20);
  });

  it('ignores a multi-character key even when it sorts inside the digit range', () => {
    setProp(h.video, 'currentTime', 20);
    press(h.video, '09');
    expect(h.video.currentTime).toBe(20);
  });
});

describe('video controls — settings menu behaviour', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const gear = (): HTMLElement => q(h.figure, '[data-action="gear"]');
  const menu = (): HTMLElement => q(h.figure, '[data-role="playback-menu"]');
  const rect = (box: Partial<DOMRect>): DOMRect => ({
    left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...box,
  });

  const stubRects = (gearRight: number, gearTop: number, figureRight: number, figureBottom: number): void => {
    setProp(gear(), 'getBoundingClientRect', () => rect({ right: gearRight, top: gearTop }));
    setProp(h.figure, 'getBoundingClientRect', () => rect({ right: figureRight, bottom: figureBottom }));
  };

  it('anchors the card to the gear, growing upward from above it', () => {
    stubRects(500, 380, 600, 400);
    gear().click();
    // Right edge tracks the gear's right edge; the card's bottom sits 8px above it.
    expect(menu().style.right).toBe('100px');
    expect(menu().style.bottom).toBe('28px');
  });

  it('re-anchors the card when the viewport changes under it', () => {
    stubRects(500, 380, 600, 400);
    gear().click();
    stubRects(300, 380, 600, 400);
    window.dispatchEvent(new Event('resize'));
    expect(menu().style.right).toBe('300px');
  });

  it('stops re-anchoring once the card is closed', () => {
    stubRects(500, 380, 600, 400);
    gear().click();
    gear().click();
    stubRects(300, 380, 600, 400);
    window.dispatchEvent(new Event('resize'));
    expect(menu().style.right).toBe('100px');
    expect(gear().getAttribute('aria-expanded')).toBe('false');
  });

  it('hands the card back to CSS transitions once it has snapped open', () => {
    gear().click();
    expect(menu().style.transition).toBe('');
    expect(q(h.figure, '[data-role="menu-main"]').parentElement?.style.transition).toBe('');
  });

  it('keeps the card open for a press on the gear itself', () => {
    gear().click();
    gear().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu().hidden).toBe(false);
  });

  it('keeps the card open for a press inside it', () => {
    gear().click();
    q(h.figure, '[data-action="loop"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu().hidden).toBe(false);
  });

  it('keeps the gear click off the surrounding player', () => {
    const onFigureClick = vi.fn();

    h.figure.addEventListener('click', onFigureClick);
    gear().click();
    expect(onFigureClick).not.toHaveBeenCalled();
  });

  it('leaves the menu scroll alone while it already sits at the origin', () => {
    const writes = vi.fn();

    Object.defineProperty(menu(), 'scrollLeft', { configurable: true, get: () => 0, set: writes });
    Object.defineProperty(menu(), 'scrollTop', { configurable: true, get: () => 0, set: writes });
    menu().dispatchEvent(new Event('scroll'));
    expect(writes).not.toHaveBeenCalled();
  });

  it('sizes the card to whichever pane is on screen', () => {
    const mainPane = q(h.figure, '[data-role="menu-main"]');
    const speedPane = q(h.figure, '[data-role="menu-speed"]');

    Object.defineProperty(mainPane, 'scrollHeight', { configurable: true, value: 80 });
    Object.defineProperty(speedPane, 'scrollHeight', { configurable: true, value: 240 });
    gear().click();
    expect(menu().style.height).toBe('80px');
    q(h.figure, '[data-action="open-speed"]').click();
    expect(menu().style.height).toBe('240px');
  });

  it('sizes nothing while the card is closed', () => {
    const speedPane = q(h.figure, '[data-role="menu-speed"]');

    Object.defineProperty(speedPane, 'scrollHeight', { configurable: true, value: 240 });
    q(h.figure, '[data-action="open-speed"]').click();
    expect(menu().style.height).toBe('');
  });
});

describe('video controls — speed control', () => {
  let h: Harness;
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;
  let queue: FrameRequestCallback[];
  let now: number;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = [];
    now = 1000;
    raf = vi.fn((cb: FrameRequestCallback) => { queue.push(cb); return queue.length + 10; });
    caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount();
  });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const slider = (): HTMLInputElement => q<HTMLInputElement>(h.figure, '[data-role="speed-slider"]');
  const chip = (rate: string): HTMLElement => q(h.figure, `[data-action="speed-${rate}"]`);
  const runFrame = (at: number): void => {
    now = at;
    const cbs = queue;

    queue = [];
    cbs.forEach((cb) => cb(at));
  };

  it('repaints the slider fill for the chosen rate', () => {
    q(h.figure, '[data-action="speed-inc"]').click();
    // (1.05 - 0.25) / 1.75
    expect(slider().style.getPropertyValue('--blok-speed-pct')).toBe('45.714285714285715%');
  });

  it('disables the stepper that would leave the allowed range', () => {
    const dec = q<HTMLButtonElement>(h.figure, '[data-action="speed-dec"]');
    const inc = q<HTMLButtonElement>(h.figure, '[data-action="speed-inc"]');

    expect(dec.disabled).toBe(false);
    expect(inc.disabled).toBe(false);
    chip('0.5').click();
    expect(dec.disabled).toBe(false);
    chip('2').click();
    expect(inc.disabled).toBe(true);
    expect(dec.disabled).toBe(false);
  });

  it('disables the decrease stepper only at the floor', () => {
    for (let i = 0; i < 20; i += 1) q(h.figure, '[data-action="speed-dec"]').click();
    expect(q<HTMLButtonElement>(h.figure, '[data-action="speed-dec"]').disabled).toBe(true);
    expect(h.video.playbackRate).toBe(0.25);
  });

  it('never hands the frame scheduler an undefined id when nothing is gliding', () => {
    q(h.figure, '[data-action="speed-inc"]').click();
    expect(caf).toHaveBeenCalledWith(0);
  });

  it('does not glide when the preset already matches the current rate', () => {
    chip('1').click();
    expect(raf).not.toHaveBeenCalled();
  });

  it('eases the thumb across the gap instead of stepping it', () => {
    chip('2').click();
    // A quarter through the 240ms tween, ease-out-cubic has covered 57.8125%.
    runFrame(1060);
    expect(slider().value).toBe('1.578125');
    expect(slider().style.getPropertyValue('--blok-speed-pct')).toBe('75.89285714285714%');
  });

  it('lands the thumb exactly on the target when the tween completes', () => {
    chip('2').click();
    runFrame(1300);
    expect(slider().value).toBe('2');
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('finishes on the frame that lands exactly on the tween duration', () => {
    chip('2').click();
    runFrame(1240);
    expect(slider().value).toBe('2');
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('keeps re-scheduling while the tween is still running', () => {
    chip('2').click();
    runFrame(1060);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('hands the thumb to the newest glide only', () => {
    chip('2').click();
    const first = raf.mock.results[0].value as number;

    caf.mockClear();
    chip('0.5').click();
    expect(caf).toHaveBeenCalledWith(first);
  });
});

describe('video controls — ambient glow', () => {
  let h: Harness;
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;
  let queue: FrameRequestCallback[];
  let drawImage: ReturnType<typeof vi.fn>;
  let getContext: ReturnType<typeof vi.fn>;
  const realGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');

  beforeEach(() => {
    vi.clearAllMocks();
    queue = [];
    raf = vi.fn((cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
    caf = vi.fn();
    drawImage = vi.fn();
    getContext = vi.fn(() => ({ drawImage } as unknown as CanvasRenderingContext2D));
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true, writable: true, value: getContext,
    });
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
  });
  afterEach(() => {
    h.destroy();
    document.body.innerHTML = '';
    if (realGetContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', realGetContext);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const canvas = (): HTMLCanvasElement => q<HTMLCanvasElement>(h.figure, '[data-role="video-ambient"]');
  const frame = (): void => { const cbs = queue; queue = []; cbs.forEach((cb) => cb(0)); };

  it('samples a low-resolution frame of the video behind the player', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount();
    setProp(h.video, 'videoWidth', 640);
    h.video.dispatchEvent(new Event('play'));
    expect(canvas().getAttribute('data-active')).toBe('true');
    frame();
    expect(getContext).toHaveBeenCalledWith('2d');
    expect(canvas().width).toBe(32);
    expect(canvas().height).toBe(18);
    expect(drawImage).toHaveBeenCalledWith(h.video, 0, 0, 32, 18);
  });

  it('samples nothing until the video reports a frame size', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount();
    setProp(h.video, 'videoWidth', 0);
    h.video.dispatchEvent(new Event('play'));
    frame();
    expect(drawImage).not.toHaveBeenCalled();
    expect(canvas().width).toBe(300);
  });

  it('keeps sampling frame after frame while the video plays', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount();
    setProp(h.video, 'videoWidth', 640);
    h.video.dispatchEvent(new Event('play'));
    frame();
    frame();
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('keeps a single sampler when play fires twice', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount();
    h.video.dispatchEvent(new Event('play'));
    raf.mockClear();
    h.video.dispatchEvent(new Event('play'));
    expect(raf).not.toHaveBeenCalled();
  });

  it('cancels the sampler it holds when playback pauses', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount({ glow: 'more' });
    h.video.dispatchEvent(new Event('play'));
    const samplerId = raf.mock.results[raf.mock.results.length - 1].value as number;

    caf.mockClear();
    h.video.dispatchEvent(new Event('pause'));
    expect(caf).toHaveBeenCalledWith(samplerId);
    expect(canvas().getAttribute('data-active')).toBe('false');
  });

  it('cancels nothing on a pause that never sampled', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount();
    h.video.dispatchEvent(new Event('pause'));
    expect(caf).not.toHaveBeenCalled();
  });

  it('marks the canvas off and never samples under reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })));
    h = mount();
    expect(canvas().getAttribute('data-ambient')).toBe('off');
    h.video.dispatchEvent(new Event('play'));
    frame();
    expect(drawImage).not.toHaveBeenCalled();
    expect(canvas().getAttribute('data-active')).toBe('false');
  });

  it('marks the canvas on when motion is allowed and records the chosen intensity', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    h = mount({ glow: 'more' });
    expect(canvas().getAttribute('data-ambient')).toBe('on');
    expect(canvas().getAttribute('data-glow')).toBe('more');
  });

  it('treats a browser that answers no media query as motion-allowed', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(null));
    h = mount();
    expect(canvas().getAttribute('data-ambient')).toBe('on');
  });
});

describe('video controls — theater without the Popover API', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const theaterBtn = (): HTMLElement => q(h.figure, '[data-action="theater"]');
  const events = (): ReturnType<typeof vi.fn> => {
    const spy = vi.fn();

    h.figure.addEventListener('blok-video-theater', spy);

    return spy;
  };

  it('leaves the top-layer promotion alone on a browser without the Popover API', () => {
    const seen = events();

    theaterBtn().click();
    expect(h.figure.hasAttribute('data-blok-top-layer')).toBe(false);
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('tears theater down in one paint when there is no morph to run', () => {
    theaterBtn().click();
    theaterBtn().click();
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    expect(h.figure.hasAttribute('data-theater-leaving')).toBe(false);
    expect(h.slot.style.minHeight).toBe('');
  });

  it('does nothing when asked to leave a theater it never entered', () => {
    const seen = events();

    h.setTheater(false);
    expect(seen).not.toHaveBeenCalled();
    expect(h.figure.hasAttribute('data-theater')).toBe(false);
  });

  it('enters theater once for a repeated request', () => {
    const seen = events();

    h.setTheater(true);
    h.setTheater(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('reserves the vacated slot height on entry', () => {
    setProp(h.figure, 'getBoundingClientRect', () => wideRect(320));
    theaterBtn().click();
    expect(h.slot.style.minHeight).toBe('0px');
  });

  it('survives a figure that has been lifted out of its slot', () => {
    h.figure.remove();
    // Driven through the handle, not a click: jsdom swallows a listener throw into
    // a window error event, so a click would pass either way.
    expect(() => h.setTheater(true)).not.toThrow();
    expect(() => h.setTheater(false)).not.toThrow();
    document.body.appendChild(h.figure);
  });

  it('claims Escape before the browser close-watcher and defers the dismiss', async () => {
    theaterBtn().click();
    const later = vi.fn();

    window.addEventListener('keydown', later, true);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    window.dispatchEvent(ev);
    window.removeEventListener('keydown', later, true);
    expect(ev.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    // Still open this tick — the dismiss runs a frame later so the exit keeps its scale.
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(h.figure.getAttribute('data-theater')).toBe('false');
  });

  it('ignores any other key while in theater', () => {
    theaterBtn().click();
    const ev = new KeyboardEvent('keydown', { key: 'a', cancelable: true });

    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(h.figure.getAttribute('data-theater')).toBe('true');
  });

  it('stops claiming Escape once theater is closed', () => {
    theaterBtn().click();
    theaterBtn().click();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

interface FakeAnimation {
  keyframes: Array<Record<string, string>>;
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
}

describe('video controls — theater morph', () => {
  let h: Harness;
  let anims: FakeAnimation[];
  let open: boolean;
  let showPopover: ReturnType<typeof vi.fn>;
  let inlineWidth: number;

  const inlineRect = { left: 200, top: 600, width: 320, height: 180, right: 520, bottom: 780, x: 200, y: 600, toJSON: () => ({}) } as DOMRect;
  const centreRect = { left: 100, top: 50, width: 800, height: 450, right: 900, bottom: 500, x: 100, y: 50, toJSON: () => ({}) } as DOMRect;

  const install = (opts: { animate?: boolean; reducedMotion?: boolean } = {}): void => {
    (HTMLElement.prototype as unknown as { popover: unknown }).popover = null;
    (HTMLElement.prototype as unknown as { showPopover: unknown }).showPopover = showPopover;
    (HTMLElement.prototype as unknown as { hidePopover: unknown }).hidePopover = vi.fn(() => { open = false; });
    if (opts.animate !== false) {
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = vi.fn((
        keyframes: Array<Record<string, string>>,
        options: KeyframeAnimationOptions,
      ): FakeAnimation => {
        const anim: FakeAnimation = { keyframes, options, cancel: vi.fn(), onfinish: null };

        anims.push(anim);

        return anim;
      });
    }
    const realMatches = HTMLElement.prototype.matches;

    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, sel: string) {
      return sel === ':popover-open' ? open : realMatches.call(this, sel);
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (open || this.getAttribute('data-theater') === 'true') return centreRect;

      return { ...inlineRect, width: inlineWidth, toJSON: () => ({}) };
    });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: opts.reducedMotion === true }));
    h = mount();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    anims = [];
    open = false;
    inlineWidth = 320;
    showPopover = vi.fn(() => { open = true; });
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

  const enter = (): void => q(h.figure, '[data-action="theater"]').click();
  const last = (): FakeAnimation => anims[anims.length - 1];

  it('grows the card with an explicit eased, non-persisting morph', () => {
    install();
    enter();
    expect(last().options.duration).toBe(480);
    expect(last().options.easing).toBe('cubic-bezier(0.33, 1, 0.68, 1)');
    expect(last().options.fill).toBe('none');
  });

  it('runs no morph when the promotion into the top layer is refused', () => {
    showPopover = vi.fn(() => { throw new Error('already open'); });
    install();
    enter();
    expect(anims).toHaveLength(0);
    expect(h.figure.hasAttribute('data-blok-top-layer')).toBe(false);
    expect(h.figure.hasAttribute('popover')).toBe(false);
  });

  it('runs no morph under reduced motion, entering or leaving', () => {
    install({ reducedMotion: true });
    enter();
    expect(anims).toHaveLength(0);
    enter();
    expect(anims).toHaveLength(0);
    expect(h.figure.getAttribute('data-theater')).toBe('false');
  });

  it('still enters theater on a browser with no Web Animations support', () => {
    install({ animate: false });
    const seen = vi.fn();

    h.figure.addEventListener('blok-video-theater', seen);
    enter();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(h.figure.getAttribute('data-theater')).toBe('true');
  });

  it('runs no morph when the inline slot has no measurable width', () => {
    inlineWidth = 0;
    install();
    enter();
    expect(anims).toHaveLength(0);
  });

  it('shrinks back onto the inline slot and tears down when the morph finishes', () => {
    install();
    enter();
    const grow = last();

    grow.onfinish?.();
    enter();
    const shrink = last();

    expect(shrink.options.fill).toBe('forwards');
    expect(h.figure.getAttribute('data-theater-leaving')).toBe('true');
    expect(h.figure.getAttribute('data-theater')).toBe('true');
    shrink.onfinish?.();
    expect(h.figure.getAttribute('data-theater')).toBe('false');
    expect(h.figure.hasAttribute('data-theater-leaving')).toBe(false);
    expect(h.slot.style.minHeight).toBe('');
  });

  it('cancels the morph already in flight when a new one starts', () => {
    install();
    enter();
    const grow = last();

    enter();
    expect(grow.cancel).toHaveBeenCalled();
  });

  it('keeps the newest morph cancellable after an older one reports finished', () => {
    install();
    enter();
    const grow = last();

    enter();
    const shrink = last();

    // The grow's finish callback lands late; it must not release the shrink.
    grow.onfinish?.();
    shrink.cancel.mockClear();
    h.destroy();
    expect(shrink.cancel).toHaveBeenCalled();
    h = mount();
  });

  it('drops the top-layer promotion on destroy', () => {
    install();
    enter();
    h.destroy();
    expect(h.figure.hasAttribute('popover')).toBe(false);
    expect(h.figure.hasAttribute('data-blok-top-layer')).toBe(false);
    expect(h.slot.style.minHeight).toBe('');
    h = mount();
  });
});

describe('video controls — picture-in-picture', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    setProp(document, 'pictureInPictureEnabled', true);
    h = mount();
  });
  afterEach(() => {
    h.destroy();
    document.body.innerHTML = '';
    delete (document as Partial<{ pictureInPictureEnabled: unknown }>).pictureInPictureEnabled;
    vi.restoreAllMocks();
  });

  const pip = (): HTMLElement => q(h.controls, '[data-action="picture-in-picture"]');

  it('starts the picture-in-picture button unpressed and labelled', () => {
    expect(pip().getAttribute('aria-pressed')).toBe('false');
    expect(pip().getAttribute('aria-label')).toBe('Picture-in-Picture');
  });

  it('reflects the browser entering and leaving picture-in-picture', () => {
    h.video.dispatchEvent(new Event('enterpictureinpicture'));
    expect(pip().getAttribute('aria-pressed')).toBe('true');
    h.video.dispatchEvent(new Event('leavepictureinpicture'));
    expect(pip().getAttribute('aria-pressed')).toBe('false');
  });

  it('does not throw on a browser that advertises but does not implement the API', () => {
    const onError = vi.fn();

    window.addEventListener('error', onError);
    pip().click();
    setProp(document, 'pictureInPictureElement', h.video);
    pip().click();
    window.removeEventListener('error', onError);
    delete (document as Partial<{ pictureInPictureElement: unknown }>).pictureInPictureElement;
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('video controls — idle auto-hide', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); h = mount({ glow: 'none' }); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

  const hidden = (): string | null => h.figure.getAttribute('data-controls-hidden');

  it('never hides the controls of a player that has left the document', () => {
    h.figure.remove();
    h.video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(3000);
    expect(hidden()).toBe('false');
    h.slot.appendChild(h.figure);
  });

  it('restarts the idle countdown on every pointer move', () => {
    h.video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(2000);
    h.figure.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    vi.advanceTimersByTime(2000);
    expect(hidden()).toBe('false');
    vi.advanceTimersByTime(1000);
    expect(hidden()).toBe('true');
  });

  it('restarts the idle countdown when focus enters the player', () => {
    h.video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(3000);
    expect(hidden()).toBe('true');
    h.figure.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(hidden()).toBe('false');
  });

  it('replaces the idle countdown on a repeated play instead of stacking one', () => {
    h.video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(1000);
    h.video.dispatchEvent(new Event('play'));
    // A stale first countdown would hide the bar here, a second into the new one.
    vi.advanceTimersByTime(2000);
    expect(hidden()).toBe('false');
    vi.advanceTimersByTime(1000);
    expect(hidden()).toBe('true');
  });

  it('arms no countdown while the player is paused', () => {
    h.figure.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no countdown armed after destroy', () => {
    h.video.dispatchEvent(new Event('play'));
    h.destroy();
    expect(vi.getTimerCount()).toBe(0);
    h = mount({ glow: 'none' });
  });
});

describe('video controls — context menu', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const ctx = (): HTMLElement => q(h.controls, '[data-role="video-menu"]');
  const openCtx = (clientX = 30, clientY = 40): MouseEvent => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY });

    h.video.dispatchEvent(ev);

    return ev;
  };

  it('opens at the pointer position it was summoned from', () => {
    openCtx(30, 40);
    expect(ctx().hidden).toBe(false);
    expect(ctx().style.getPropertyValue('--blok-ctx-x')).toBe('30px');
    expect(ctx().style.getPropertyValue('--blok-ctx-y')).toBe('40px');
  });

  it('closes on a press outside it', () => {
    openCtx();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ctx().hidden).toBe(true);
  });

  it('stays open for a press on one of its own items', () => {
    openCtx();
    q(h.controls, '[data-action="copy-url"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ctx().hidden).toBe(false);
  });

  it('ignores keys other than Escape while open', () => {
    openCtx();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(ctx().hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ctx().hidden).toBe(true);
  });

  it('closes after every item it offers', () => {
    for (const action of ['ctx-loop', 'copy-url', 'copy-url-at-time', 'stats']) {
      openCtx();
      q(h.controls, `[data-action="${action}"]`).click();
      expect(ctx().hidden).toBe(true);
    }
  });

  it('does not throw on a browser with no clipboard write', () => {
    const onError = vi.fn();

    window.addEventListener('error', onError);
    vi.stubGlobal('navigator', { clipboard: {} });
    openCtx();
    q(h.controls, '[data-action="copy-url"]').click();
    vi.stubGlobal('navigator', {});
    openCtx();
    q(h.controls, '[data-action="copy-url-at-time"]').click();
    window.removeEventListener('error', onError);
    vi.unstubAllGlobals();
    expect(onError).not.toHaveBeenCalled();
    expect(ctx().hidden).toBe(true);
  });
});

describe('video controls — playback statistics', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const stats = (): HTMLElement => q(h.controls, '[data-role="video-stats"]');
  const openStats = (): void => {
    h.video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    q(h.controls, '[data-action="stats"]').click();
  };

  it('refreshes the open overlay as playback advances', () => {
    setProp(h.video, 'buffered', fakeRanges([[0, 30]]));
    setProp(h.video, 'currentTime', 10);
    openStats();
    expect(stats().textContent).toContain('Buffer health: 20.0 s');
    setProp(h.video, 'currentTime', 25);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(stats().textContent).toContain('Buffer health: 5.0 s');
  });

  it('renders nothing into an overlay that was never opened', () => {
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(stats().childElementCount).toBe(0);
  });

  it('stops refreshing once the overlay is closed', () => {
    openStats();
    expect(stats().textContent).toContain('Resolution: Not available');
    setProp(h.video, 'videoWidth', 640);
    setProp(h.video, 'videoHeight', 360);
    h.video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    q(h.controls, '[data-action="stats"]').click();
    expect(stats().hidden).toBe(true);
    expect(stats().textContent).toContain('Resolution: Not available');
  });
});

const memoryStorage = (seed: Record<string, string> = {}): {
  getItem: Mock<(key: string) => string | null>;
  setItem: Mock<(key: string, value: string) => void>;
  removeItem: Mock<(key: string) => void>;
} => {
  const map = new Map(Object.entries(seed));

  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { map.set(key, value); }),
    removeItem: vi.fn((key: string) => { map.delete(key); }),
  };
};

describe('video controls — persistence', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const mute = (): HTMLElement => q(h.controls, '[data-action="mute-toggle"]');

  it('falls back to the browser store when the host passes none', () => {
    h = mount();
    h.video.volume = 0.4;
    h.video.dispatchEvent(new Event('volumechange'));
    h.destroy();
    document.body.innerHTML = '';
    h = mount();
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(h.video.volume).toBe(0.4);
  });

  it('keeps the block loop setting when the store refuses to be read', () => {
    const store = { getItem: (): string => { throw new Error('blocked'); }, setItem: vi.fn(), removeItem: vi.fn() };

    h = mount({ storage: store, loop: true });
    expect(h.video.loop).toBe(true);
  });

  it('persists no position for a media with no resolvable source', () => {
    const store = memoryStorage();

    h = mount({ storage: store });
    setProp(h.video, 'currentTime', 12);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('restores a stored volume and repaints the slider fill', () => {
    const store = memoryStorage({ 'blok:video:volume': '{"volume":0.5,"muted":false}' });

    h = mount({ storage: store });
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(h.video.volume).toBe(0.5);
    expect(q<HTMLInputElement>(h.controls, '[data-role="volume"]').value).toBe('0.5');
    expect(q(h.controls, '[data-role="volume"]').style.getPropertyValue('--blok-vol-pct')).toBe('50%');
  });

  it('restores a stored mute flag with no stored level', () => {
    const store = memoryStorage({ 'blok:video:volume': '{"muted":true}' });

    h = mount({ storage: store });
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(h.video.muted).toBe(true);
    expect(mute().getAttribute('aria-pressed')).toBe('true');
  });

  it('restores a stored mute flag alongside a level', () => {
    const store = memoryStorage({ 'blok:video:volume': '{"volume":0.5,"muted":true}' });

    h = mount({ storage: store });
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(h.video.muted).toBe(true);
  });

  it('leaves the live mute flag alone when the store holds only a level', () => {
    const store = memoryStorage({ 'blok:video:volume': '{"volume":0.4}' });

    h = mount({ storage: store });
    // Assigned without the media's own volumechange, which would overwrite the seed.
    setProp(h.video, 'muted', true);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(h.video.muted).toBe(true);
    expect(h.video.volume).toBe(0.4);
  });

  const positionCase = (
    pos: string,
    duration: number | undefined,
    expected: number,
    startAt = 0,
  ): void => {
    const store = memoryStorage({ 'blok:video:pos:blob:clip': pos });

    h = mount({ storage: store });
    setProp(h.video, 'currentSrc', 'blob:clip');
    setProp(h.video, 'currentTime', startAt);
    if (duration !== undefined) setProp(h.video, 'duration', duration);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(h.video.currentTime).toBe(expected);
  };

  it('resumes a stored position while the duration is still unknown', () => {
    positionCase('30', undefined, 30);
  });

  it('resumes a stored position comfortably inside a known duration', () => {
    positionCase('30', 100, 30);
  });

  it('ignores a stored position within the last five seconds', () => {
    positionCase('95', 100, 0);
  });

  it('ignores a stored position past the end', () => {
    positionCase('99', 100, 0);
  });

  it('ignores a stored position at the very start', () => {
    positionCase('0', undefined, 30, 30);
  });

  it('ignores a negative stored position', () => {
    positionCase('-1', undefined, 0);
  });

  it('restores a stored playback rate', () => {
    const store = memoryStorage({ 'blok:video:rate': '1.5' });

    h = mount({ storage: store });
    expect(h.video.playbackRate).toBe(1.5);
    expect(q(h.figure, '[data-role="speed-readout"]').textContent).toBe('1.5×');
  });

  it('ignores a stored playback rate of zero', () => {
    const store = memoryStorage({ 'blok:video:rate': '0' });

    h = mount({ storage: store });
    expect(h.video.playbackRate).toBe(1);
  });
});

describe('video controls — teardown detaches every listener', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); h = mount(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  const at = (sel: string): HTMLElement => q(h.controls, sel);

  it('takes the controls and the menu off the figure', () => {
    const menu = q(h.figure, '[data-role="playback-menu"]');

    h.destroy();
    expect(h.figure.contains(h.controls)).toBe(false);
    expect(h.figure.contains(menu)).toBe(false);
  });

  it('closes an open settings menu and stops tracking the viewport', () => {
    const gear = q(h.figure, '[data-action="gear"]');
    const menu = q(h.figure, '[data-role="playback-menu"]');
    const rect = (right: number): DOMRect => ({
      left: 0, right, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    });

    setProp(gear, 'getBoundingClientRect', () => rect(500));
    setProp(h.figure, 'getBoundingClientRect', () => rect(600));
    gear.click();
    expect(menu.style.right).toBe('100px');
    h.destroy();
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    setProp(gear, 'getBoundingClientRect', () => rect(300));
    window.dispatchEvent(new Event('resize'));
    expect(menu.style.right).toBe('100px');
  });

  it('stops mirroring media play and pause', () => {
    h.video.dispatchEvent(new Event('play'));
    h.destroy();
    h.video.dispatchEvent(new Event('pause'));
    expect(at('[data-action="play-toggle"]').getAttribute('aria-label')).toBe('Pause');
  });

  it('stops driving the scrubber frame loop', () => {
    const raf = vi.fn().mockReturnValue(1);

    h.destroy();
    vi.stubGlobal('requestAnimationFrame', raf);
    h.video.dispatchEvent(new Event('play'));
    vi.unstubAllGlobals();
    expect(raf).not.toHaveBeenCalled();
  });

  it('stops the ambient sampler', () => {
    const canvas = q(h.figure, '[data-role="video-ambient"]');

    h.destroy();
    h.video.dispatchEvent(new Event('play'));
    expect(canvas.getAttribute('data-active')).toBe('false');
  });

  it('arms no idle countdown after teardown', () => {
    vi.useFakeTimers();
    h.destroy();
    h.video.dispatchEvent(new Event('play'));
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('disarms the countdown that was already running', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('play'));
    h.destroy();
    vi.advanceTimersByTime(3000);
    expect(h.figure.getAttribute('data-controls-hidden')).toBe('false');
    vi.useRealTimers();
  });

  it('disarms a press-and-hold that had not yet engaged', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    h.destroy();
    vi.advanceTimersByTime(300);
    expect(h.video.playbackRate).toBe(1);
    vi.useRealTimers();
  });

  it('cancels the frame loops it still holds', () => {
    const caf = vi.fn();

    h.destroy();
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(9));
    vi.stubGlobal('cancelAnimationFrame', caf);
    h = mount();
    setProp(h.video, 'videoWidth', 640);
    h.video.dispatchEvent(new Event('play'));
    const canvas = q(h.figure, '[data-role="video-ambient"]');

    caf.mockClear();
    h.destroy();
    vi.unstubAllGlobals();
    expect(caf).toHaveBeenCalledWith(9);
    expect(canvas.getAttribute('data-active')).toBe('false');
  });

  it('stops re-evaluating the centre play affordance', () => {
    h.destroy();
    setProp(h.video, 'currentTime', 5);
    h.video.dispatchEvent(new Event('play'));
    h.video.dispatchEvent(new Event('pause'));
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(at('[data-role="center-play"]').hidden).toBe(false);
  });

  it('stops revealing the control bar', () => {
    vi.useFakeTimers();
    h.video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(3000);
    expect(h.figure.getAttribute('data-controls-hidden')).toBe('true');
    h.destroy();
    h.video.dispatchEvent(new Event('pause'));
    h.figure.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    h.figure.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(h.figure.getAttribute('data-controls-hidden')).toBe('true');
    vi.useRealTimers();
  });

  it('stops writing to storage', () => {
    const store = memoryStorage();

    h.destroy();
    h = mount({ storage: store });
    setProp(h.video, 'currentSrc', 'blob:clip');
    h.destroy();
    store.setItem.mockClear();
    store.getItem.mockClear();
    setProp(h.video, 'currentTime', 20);
    h.video.dispatchEvent(new Event('timeupdate'));
    h.video.dispatchEvent(new Event('volumechange'));
    h.video.dispatchEvent(new Event('loadedmetadata'));
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.getItem).not.toHaveBeenCalled();
  });

  it('stops refreshing the statistics overlay', () => {
    setProp(h.video, 'buffered', fakeRanges([[0, 30]]));
    setProp(h.video, 'currentTime', 10);
    h.video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    at('[data-action="stats"]').click();
    h.destroy();
    setProp(h.video, 'currentTime', 25);
    h.video.dispatchEvent(new Event('timeupdate'));
    expect(at('[data-role="video-stats"]').textContent).toContain('Buffer health: 20.0 s');
  });

  it('stops driving the buffering spinner', () => {
    const spinner = at('[data-role="buffer-spinner"]');

    h.destroy();
    h.video.dispatchEvent(new Event('waiting'));
    expect(spinner.getAttribute('data-active')).toBe('false');
    h = mount();
    h.video.dispatchEvent(new Event('waiting'));
    const live = q(h.controls, '[data-role="buffer-spinner"]');

    h.destroy();
    h.video.dispatchEvent(new Event('playing'));
    h.video.dispatchEvent(new Event('canplay'));
    expect(live.getAttribute('data-active')).toBe('true');
  });

  it('stops reading metadata, time and progress off the media', () => {
    setProp(h.video, 'duration', 100);
    setProp(h.video, 'buffered', fakeRanges([[0, 50]]));
    h.video.dispatchEvent(new Event('loadedmetadata'));
    h.destroy();
    setProp(h.video, 'duration', 200);
    setProp(h.video, 'currentTime', 60);
    setProp(h.video, 'buffered', fakeRanges([[0, 90]]));
    h.video.dispatchEvent(new Event('loadedmetadata'));
    h.video.dispatchEvent(new Event('timeupdate'));
    h.video.dispatchEvent(new Event('progress'));
    expect(q<HTMLInputElement>(h.controls, '[data-role="seek"]').max).toBe('100');
    expect(q<HTMLInputElement>(h.controls, '[data-role="seek"]').value).toBe('0');
    expect(at('[data-role="seek-buffered"]').style.getPropertyValue('--blok-buffered-pct')).toBe('50%');
  });

  it('stops mirroring volume changes', () => {
    h.destroy();
    h.video.volume = 0;
    h.video.dispatchEvent(new Event('volumechange'));
    expect(at('[data-action="mute-toggle"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves the mute-icon pop class alone once torn down', () => {
    const mute = at('[data-action="mute-toggle"]');

    mute.click();
    expect(mute.classList.contains('is-bumped')).toBe(true);
    h.destroy();
    animationEnd(mute, 'blok-video-mute-bump');
    expect(mute.classList.contains('is-bumped')).toBe(true);
  });

  it('stops tracking fullscreen changes', () => {
    h.destroy();
    setProp(document, 'fullscreenElement', h.figure);
    document.dispatchEvent(new Event('fullscreenchange'));
    setProp(document, 'fullscreenElement', null);
    expect(h.figure.hasAttribute('data-fullscreen')).toBe(false);
  });

  it('stops claiming the right-click menu', () => {
    h.destroy();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    h.video.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(at('[data-role="video-menu"]').hidden).toBe(true);
  });

  it('leaves an open right-click menu untouched by later document events', () => {
    h.video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    h.destroy();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(at('[data-role="video-menu"]').hidden).toBe(false);
  });

  it('stops answering pointer and keyboard input on the video', () => {
    vi.useFakeTimers();
    h.destroy();
    h.video.click();
    h.video.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(300);
    h.video.dispatchEvent(new Event('pointerup'));
    h.video.dispatchEvent(new Event('pointerleave'));
    h.video.dispatchEvent(new Event('pointercancel'));
    const key = press(h.video, 'ArrowRight');

    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.video.playbackRate).toBe(1);
    expect(key.defaultPrevented).toBe(false);
    vi.useRealTimers();
  });

  it('leaves the seek pill class alone once torn down', () => {
    const flash = at('[data-role="seek-flash"]');

    press(h.video, 'ArrowRight');
    h.destroy();
    animationEnd(flash, 'blok-video-seek-flash-in-right');
    expect(flash.classList.contains('is-active')).toBe(true);
  });

  it('stops answering hover over the scrubber', () => {
    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    h.destroy();
    const seek = at('[data-role="seek"]');

    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, bubbles: true }));
    expect(at('[data-role="seek-tooltip"]').getAttribute('aria-hidden')).toBe('true');
  });

  it('unloads the hidden preview stream it opened', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);

    setProp(h.video, 'duration', 100);
    h.video.dispatchEvent(new Event('loadedmetadata'));
    h.video.setAttribute('src', 'blob:test');
    const seek = at('[data-role="seek"]');

    setProp(seek, 'getBoundingClientRect', () => wideRect(200));
    seek.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, bubbles: true }));
    const preview = q<HTMLVideoElement>(h.controls, '[data-role="seek-preview-source"]');

    setProp(preview, 'videoWidth', 320);
    setProp(preview, 'videoHeight', 180);
    h.destroy();
    expect(preview.getAttribute('src')).toBeNull();
    expect(load).toHaveBeenCalled();
    preview.dispatchEvent(new Event('seeked'));
    expect(at('[data-role="seek-thumb"]').getAttribute('data-ready')).toBeNull();
  });
});

describe('video controls — teardown of optional surfaces', () => {
  let h: Harness;

  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { h.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('stops mirroring picture-in-picture state', () => {
    setProp(document, 'pictureInPictureEnabled', true);
    h = mount();
    const pip = q(h.controls, '[data-action="picture-in-picture"]');

    h.destroy();
    h.video.dispatchEvent(new Event('enterpictureinpicture'));
    expect(pip.getAttribute('aria-pressed')).toBe('false');
    delete (document as Partial<{ pictureInPictureEnabled: unknown }>).pictureInPictureEnabled;
  });

  it('stops listening for the theater dismiss gesture', () => {
    h = mount();
    q(h.figure, '[data-action="theater"]').click();
    h.destroy();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(h.figure.getAttribute('data-theater')).toBe('true');
  });

  it('releases a figure that no longer has a slot', () => {
    h = mount();
    q(h.figure, '[data-action="theater"]').click();
    h.figure.remove();
    expect(() => h.destroy()).not.toThrow();
    document.body.appendChild(h.figure);
  });
});

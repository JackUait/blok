import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachControls, formatTime } from '../../../../src/tools/audio/controls';
import type { AudioStorage, ControlsHandle } from '../../../../src/tools/audio/controls';
import type { I18nInstance } from '../../../../src/components/utils/tools';
import {
  IconMinus,
  IconPlayerLoop,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSettings,
  IconPlayerVolume,
  IconPlayerVolumeMute,
  IconPlus,
} from '../../../../src/components/icons';

const VOL_KEY = 'blok:audio:volume';
const RATE_KEY = 'blok:audio:rate';
const LOOP_KEY = 'blok:audio:loop';
const TRACK_URL = 'track.mp3';
const POS_KEY = `blok:audio:pos:${TRACK_URL}`;

interface MemoryStorage extends AudioStorage {
  entries: Map<string, string>;
}

const memoryStorage = (seed: Record<string, string> = {}): MemoryStorage => {
  const entries = new Map<string, string>(Object.entries(seed));

  return {
    entries,
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
    removeItem: (key: string): void => {
      entries.delete(key);
    },
  };
};

const makeMedia = (options: { duration?: number; currentTime?: number } = {}): HTMLAudioElement => {
  const media = document.createElement('audio');

  Object.defineProperty(media, 'duration', { value: options.duration ?? 200, configurable: true });
  media.currentTime = options.currentTime ?? 0;
  media.play = vi.fn().mockResolvedValue(undefined);
  media.pause = vi.fn();

  return media;
};

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);

  if (found === null) throw new Error(`fixture is missing ${selector}`);

  return found;
};

/** Normalised markup for an icon constant, so innerHTML comparisons survive jsdom's serializer. */
const iconMarkup = (icon: string): string => {
  const holder = document.createElement('div');

  holder.innerHTML = icon;

  return holder.innerHTML;
};

interface MountOptions {
  media: HTMLAudioElement;
  figure?: HTMLElement;
  storage?: AudioStorage;
  i18n?: I18nInstance;
  onLoopChange?: (loop: boolean) => void;
  url?: string;
}

interface Mounted {
  handle: ControlsHandle;
  figure: HTMLElement;
  root: HTMLElement;
  play: HTMLButtonElement;
  time: HTMLElement;
  mute: HTMLButtonElement;
  volume: HTMLInputElement;
  volumeWrap: HTMLElement;
  gear: HTMLButtonElement;
  speedWrap: HTMLElement;
  menu: HTMLElement;
  readout: HTMLElement;
  sliderRow: HTMLElement;
  slider: HTMLInputElement;
  steppers: HTMLButtonElement[];
  chipRow: HTMLElement;
  chips: HTMLButtonElement[];
  loop: HTMLButtonElement;
}

const mount = (options: MountOptions): Mounted => {
  const figure = options.figure ?? document.createElement('figure');

  document.body.appendChild(figure);

  const handle = attachControls({
    media: options.media,
    figure,
    data: { url: options.url ?? TRACK_URL },
    storage: options.storage,
    onLoopChange: options.onLoopChange,
    i18n: options.i18n,
  });

  figure.appendChild(handle.element);

  const root = handle.element;

  return {
    handle,
    figure,
    root,
    play: must<HTMLButtonElement>(root, '[data-role="audio-play"]'),
    time: must<HTMLElement>(root, '[data-role="audio-time"]'),
    mute: must<HTMLButtonElement>(root, '[data-role="audio-mute"]'),
    volume: must<HTMLInputElement>(root, '[data-role="audio-volume"]'),
    volumeWrap: must<HTMLElement>(root, '.blok-audio-controls__volume-wrap'),
    gear: must<HTMLButtonElement>(root, '[data-role="audio-speed"]'),
    speedWrap: must<HTMLElement>(root, '.blok-audio-controls__speed-wrap'),
    menu: must<HTMLElement>(root, '.blok-audio-controls__speed-menu'),
    readout: must<HTMLElement>(root, '.blok-audio-controls__speed-readout'),
    sliderRow: must<HTMLElement>(root, '.blok-audio-controls__speed-slider-row'),
    slider: must<HTMLInputElement>(root, '.blok-audio-controls__speed-slider'),
    steppers: [...root.querySelectorAll<HTMLButtonElement>('.blok-audio-controls__speed-step')],
    chipRow: must<HTMLElement>(root, '.blok-audio-controls__speed-chips'),
    chips: [...root.querySelectorAll<HTMLButtonElement>('.blok-audio-controls__speed-chip')],
    loop: must<HTMLButtonElement>(root, '[data-role="audio-loop"]'),
  };
};

/** Keydowns must be cancelable, or `preventDefault()` cannot be observed at all. */
const pressKeyOn = (
  target: EventTarget,
  key: string,
  modifiers: Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'altKey'> = {},
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });

  target.dispatchEvent(event);

  return event;
};

const fireInput = (element: HTMLInputElement, value: string): void => {
  // Aliased so the write is not read as parameter reassignment; a range input's
  // live value cannot be moved through its attribute once the tool has set it.
  const input = element;

  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const fakeI18n = (map: Record<string, string>): I18nInstance => ({
  has: (key: string): boolean => key in map,
  t: (key: string): string => map[key] ?? key,
});

const FULL_I18N = fakeI18n({
  'tools.audio.play': 'Lire',
  'tools.audio.pause': 'Suspendre',
  'tools.audio.mute': 'Couper',
  'tools.audio.unmute': 'Retablir',
  'tools.audio.volume': 'Niveau',
  'tools.audio.playbackSpeed': 'Vitesse',
  'tools.audio.speedDecrease': 'Ralentir',
  'tools.audio.speedIncrease': 'Accelerer',
  'tools.audio.loop': 'Boucle',
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatTime', () => {
  it('pads both minutes and seconds to two digits', () => {
    expect(formatTime(125)).toBe('02:05');
  });

  it('keeps counting in minutes past the hour mark', () => {
    expect(formatTime(3661)).toBe('61:01');
  });

  it('floors a fractional seconds value', () => {
    expect(formatTime(65.9)).toBe('01:05');
  });

  it('reports 0:00 for zero, negative and non-finite input', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
  });
});

describe('attachControls — rendered contract', () => {
  it('renders the transport root with the class and role audio.css and the tool query on', () => {
    const ui = mount({ media: makeMedia() });

    expect(ui.root.className).toBe('blok-audio-controls');
    expect(ui.root.getAttribute('data-role')).toBe('audio-controls');
    expect([...ui.root.children]).toStrictEqual([ui.play, ui.time, ui.volumeWrap, ui.speedWrap, ui.loop]);
    ui.handle.destroy();
  });

  it('renders the play button paused, as a non-submitting button', () => {
    const ui = mount({ media: makeMedia() });

    expect(ui.play.type).toBe('button');
    expect(ui.play.getAttribute('aria-label')).toBe('Play');
    expect(ui.play.innerHTML).toBe(iconMarkup(IconPlayerPlay));
    expect(ui.figure.getAttribute('data-playing')).toBe('false');
    ui.handle.destroy();
  });

  it('renders the time readout at zero before any media event', () => {
    const ui = mount({ media: makeMedia() });

    expect(ui.time.className).toBe('blok-audio-controls__time');
    expect(ui.time.textContent).toBe('0:00 / 0:00');
    ui.handle.destroy();
  });

  it('renders the volume slider unmuted, at full, with the 0–1 range the handler reads back', () => {
    const ui = mount({ media: makeMedia() });

    expect(ui.volumeWrap.className).toBe('blok-audio-controls__volume-wrap');
    expect([...ui.volumeWrap.children]).toStrictEqual([ui.mute, ui.volume]);
    expect(ui.volume.type).toBe('range');
    expect(ui.volume.min).toBe('0');
    expect(ui.volume.max).toBe('1');
    expect(ui.volume.step).toBe('0.05');
    expect(ui.volume.value).toBe('1');
    expect(ui.volume.className).toBe('blok-audio-controls__volume');
    expect(ui.volume.getAttribute('aria-label')).toBe('Volume');
    expect(ui.mute.getAttribute('aria-pressed')).toBe('false');
    expect(ui.mute.getAttribute('aria-label')).toBe('Mute');
    expect(ui.mute.innerHTML).toBe(iconMarkup(IconPlayerVolume));
    ui.handle.destroy();
  });

  it('renders the gear with the settings glyph and a collapsed menu', () => {
    const ui = mount({ media: makeMedia() });

    expect(ui.speedWrap.className).toBe('blok-audio-controls__speed-wrap');
    expect([...ui.speedWrap.children]).toStrictEqual([ui.gear, ui.menu]);
    expect(ui.gear.getAttribute('aria-haspopup')).toBe('menu');
    expect(ui.gear.getAttribute('aria-expanded')).toBe('false');
    expect(ui.gear.getAttribute('aria-label')).toBe('Playback speed');
    expect(ui.gear.innerHTML).toBe(iconMarkup(IconPlayerSettings));
    expect(ui.menu.className).toBe('blok-audio-controls__speed-menu');
    expect(ui.menu.getAttribute('role')).toBe('menu');
    expect(ui.menu.hidden).toBe(true);
    ui.handle.destroy();
  });

  it('renders the speed menu rows: readout, steppers around the slider, then the presets', () => {
    const ui = mount({ media: makeMedia() });

    expect([...ui.menu.children]).toStrictEqual([ui.readout, ui.sliderRow, ui.chipRow]);
    expect(ui.readout.className).toBe('blok-audio-controls__speed-readout');
    expect(ui.readout.getAttribute('aria-hidden')).toBe('true');
    expect(ui.readout.textContent).toBe('1×');

    expect(ui.sliderRow.className).toBe('blok-audio-controls__speed-slider-row');
    expect([...ui.sliderRow.children]).toStrictEqual([ui.steppers[0], ui.slider, ui.steppers[1]]);
    expect(ui.steppers.map((step) => step.type)).toStrictEqual(['button', 'button']);
    expect(ui.steppers.map((step) => step.className))
      .toStrictEqual(['blok-audio-controls__speed-step', 'blok-audio-controls__speed-step']);
    expect(ui.steppers.map((step) => step.getAttribute('aria-label')))
      .toStrictEqual(['Decrease playback speed', 'Increase playback speed']);
    expect(ui.steppers.map((step) => step.innerHTML))
      .toStrictEqual([iconMarkup(IconMinus), iconMarkup(IconPlus)]);
    expect(ui.steppers.map((step) => step.disabled)).toStrictEqual([false, false]);

    expect(ui.chipRow.className).toBe('blok-audio-controls__speed-chips');
    expect(ui.chips.map((chip) => chip.textContent)).toStrictEqual(['0.5×', '1×', '1.5×', '2×']);
    expect(ui.chips.map((chip) => chip.type)).toStrictEqual(['button', 'button', 'button', 'button']);
    ui.handle.destroy();
  });

  it('renders the speed slider over the clamp range, announcing the rate up front', () => {
    const ui = mount({ media: makeMedia() });

    expect(ui.slider.type).toBe('range');
    expect(ui.slider.min).toBe('0.25');
    expect(ui.slider.max).toBe('2');
    expect(ui.slider.step).toBe('0.05');
    expect(ui.slider.value).toBe('1');
    expect(ui.slider.className).toBe('blok-audio-controls__speed-slider');
    expect(ui.slider.getAttribute('aria-label')).toBe('Playback speed');
    expect(ui.slider.getAttribute('aria-valuetext')).toBe('1×');
    // audio.css paints the elapsed fill from this property; any other name freezes it.
    expect(ui.slider.style.getPropertyValue('--blok-audio-speed-pct')).toBe('42.857142857142854%');
    ui.handle.destroy();
  });

  it('renders the loop button reflecting the element it was handed', () => {
    const media = makeMedia();

    media.loop = true;

    const ui = mount({ media });

    expect(ui.loop.type).toBe('button');
    expect(ui.loop.getAttribute('aria-label')).toBe('Loop');
    expect(ui.loop.innerHTML).toBe(iconMarkup(IconPlayerLoop));
    expect(ui.loop.getAttribute('aria-pressed')).toBe('true');
    ui.handle.destroy();
  });

  it('translates every control label through the editor i18n instance', () => {
    const media = makeMedia();
    const ui = mount({ media, i18n: FULL_I18N });

    expect(ui.play.getAttribute('aria-label')).toBe('Lire');
    expect(ui.mute.getAttribute('aria-label')).toBe('Couper');
    expect(ui.volume.getAttribute('aria-label')).toBe('Niveau');
    expect(ui.gear.getAttribute('aria-label')).toBe('Vitesse');
    expect(ui.slider.getAttribute('aria-label')).toBe('Vitesse');
    expect(ui.steppers.map((step) => step.getAttribute('aria-label'))).toStrictEqual(['Ralentir', 'Accelerer']);
    expect(ui.loop.getAttribute('aria-label')).toBe('Boucle');

    media.dispatchEvent(new Event('play'));
    expect(ui.play.getAttribute('aria-label')).toBe('Suspendre');

    ui.mute.click();
    expect(ui.mute.getAttribute('aria-label')).toBe('Retablir');

    // The unmuted branch of the mute-button resync has its own translation key.
    ui.mute.click();
    expect(ui.mute.getAttribute('aria-label')).toBe('Couper');
    ui.handle.destroy();
  });
});

describe('attachControls — play and pause', () => {
  it('starts playback from the play button', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.play.click();
    expect(media.play).toHaveBeenCalled();
    expect(media.pause).not.toHaveBeenCalled();
    ui.handle.destroy();
  });

  it('repaints the whole transport when the element reports it started playing', () => {
    const media = makeMedia();
    const ui = mount({ media });

    media.dispatchEvent(new Event('play'));

    expect(ui.figure.getAttribute('data-playing')).toBe('true');
    expect(ui.play.getAttribute('aria-label')).toBe('Pause');
    expect(ui.play.innerHTML).toBe(iconMarkup(IconPlayerPause));
    ui.handle.destroy();
  });

  it('pauses — not restarts — once the element reports it is playing', () => {
    const media = makeMedia();
    const ui = mount({ media });

    media.dispatchEvent(new Event('play'));
    ui.play.click();

    expect(media.pause).toHaveBeenCalled();
    expect(media.play).not.toHaveBeenCalled();
    ui.handle.destroy();
  });

  it('repaints the transport back to paused on the element pause event', () => {
    const media = makeMedia();
    const ui = mount({ media });

    media.dispatchEvent(new Event('play'));
    media.dispatchEvent(new Event('pause'));

    expect(ui.figure.getAttribute('data-playing')).toBe('false');
    expect(ui.play.getAttribute('aria-label')).toBe('Play');
    expect(ui.play.innerHTML).toBe(iconMarkup(IconPlayerPlay));
    ui.handle.destroy();
  });
});

describe('attachControls — time readout', () => {
  it('shows elapsed over total once the metadata lands', () => {
    const media = makeMedia({ duration: 200 });
    const ui = mount({ media });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(ui.time.textContent).toBe('0:00 / 03:20');
    ui.handle.destroy();
  });

  it('follows the play head on every timeupdate', () => {
    const media = makeMedia({ duration: 200, currentTime: 125 });
    const ui = mount({ media });

    media.dispatchEvent(new Event('timeupdate'));
    expect(ui.time.textContent).toBe('02:05 / 03:20');
    ui.handle.destroy();
  });
});

describe('attachControls — position persistence', () => {
  it('stores the play head under a key scoped to the track', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000);

    const storage = memoryStorage();
    const media = makeMedia({ currentTime: 42 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('timeupdate'));

    expect([...storage.entries.keys()]).toContain(POS_KEY);
    expect(storage.entries.get(POS_KEY)).toBe('42');
    ui.handle.destroy();
  });

  it('writes at most once a second while the head moves', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5000);
    const storage = memoryStorage();
    const media = makeMedia({ currentTime: 42 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('timeupdate'));

    media.currentTime = 90;
    nowSpy.mockReturnValue(5500);
    media.dispatchEvent(new Event('timeupdate'));
    expect(storage.entries.get(POS_KEY)).toBe('42');

    nowSpy.mockReturnValue(6000);
    media.dispatchEvent(new Event('timeupdate'));
    expect(storage.entries.get(POS_KEY)).toBe('90');
    ui.handle.destroy();
  });

  it('holds the first write back until a second has passed since the epoch seed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(500);

    const storage = memoryStorage();
    const media = makeMedia({ currentTime: 42 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('timeupdate'));
    expect(storage.entries.has(POS_KEY)).toBe(false);
    ui.handle.destroy();
  });
});

describe('attachControls — position restore', () => {
  it('resumes a stored mid-track position on loadedmetadata', () => {
    const storage = memoryStorage({ [POS_KEY]: '100' });
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(100);
    ui.handle.destroy();
  });

  it('ignores a position parked in the last five seconds of the track', () => {
    const storage = memoryStorage({ [POS_KEY]: '195' });
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(7);
    ui.handle.destroy();
  });

  it('ignores a negative stored position', () => {
    const storage = memoryStorage({ [POS_KEY]: '-30' });
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(7);
    ui.handle.destroy();
  });

  it('ignores a stored position of exactly zero', () => {
    const storage = memoryStorage({ [POS_KEY]: '0' });
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(7);
    ui.handle.destroy();
  });

  it('ignores a corrupt stored position', () => {
    const storage = memoryStorage({ [POS_KEY]: 'later' });
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(7);
    ui.handle.destroy();
  });

  it('does not restore a position when the duration is unknown', () => {
    const storage = memoryStorage({ [POS_KEY]: '100' });
    const media = makeMedia({ duration: NaN, currentTime: 7 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(7);
    ui.handle.destroy();
  });

  it('leaves the head alone when nothing was stored for the track', () => {
    const storage = memoryStorage();
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media, storage });

    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(7);
    ui.handle.destroy();
  });
});

describe('attachControls — volume and mute', () => {
  it('mutes the element and repaints the button, slider and fill', () => {
    const storage = memoryStorage();
    const media = makeMedia();
    const ui = mount({ media, storage });

    ui.mute.click();

    expect(media.muted).toBe(true);
    expect(ui.mute.getAttribute('aria-pressed')).toBe('true');
    expect(ui.mute.getAttribute('aria-label')).toBe('Unmute');
    expect(ui.mute.innerHTML).toBe(iconMarkup(IconPlayerVolumeMute));
    expect(ui.volume.value).toBe('0');
    expect(ui.volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('0%');
    expect(storage.entries.get(VOL_KEY)).toBe('{"volume":1,"muted":true}');
    ui.handle.destroy();
  });

  it('unmutes back to the element volume', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.mute.click();
    ui.mute.click();

    expect(media.muted).toBe(false);
    expect(ui.mute.getAttribute('aria-pressed')).toBe('false');
    expect(ui.mute.getAttribute('aria-label')).toBe('Mute');
    expect(ui.mute.innerHTML).toBe(iconMarkup(IconPlayerVolume));
    expect(ui.volume.value).toBe('1');
    ui.handle.destroy();
  });

  it('drives the element volume from the slider and persists it', () => {
    const storage = memoryStorage();
    const media = makeMedia();
    const ui = mount({ media, storage });

    fireInput(ui.volume, '0.5');

    expect(media.volume).toBeCloseTo(0.5, 5);
    expect(media.muted).toBe(false);
    expect(ui.volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('50%');
    expect(storage.entries.get(VOL_KEY)).toBe('{"volume":0.5,"muted":false}');
    ui.handle.destroy();
  });

  it('treats dragging the slider to zero as a mute', () => {
    const media = makeMedia();
    const ui = mount({ media });

    fireInput(ui.volume, '0');

    expect(media.muted).toBe(true);
    expect(ui.mute.getAttribute('aria-pressed')).toBe('true');
    ui.handle.destroy();
  });

  it('repaints the fill even when the drag lands back on the current volume', () => {
    const storage = memoryStorage();
    const media = makeMedia();
    const ui = mount({ media, storage });

    // Same value ⇒ the element fires no volumechange, so only the handler's own
    // resync can paint the track.
    fireInput(ui.volume, '1');

    expect(ui.volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('100%');
    expect(storage.entries.get(VOL_KEY)).toBe('{"volume":1,"muted":false}');
    ui.handle.destroy();
  });

  it('follows a volume change made outside the bar', () => {
    const media = makeMedia();
    const ui = mount({ media });

    media.volume = 0.25;
    media.dispatchEvent(new Event('volumechange'));

    expect(ui.volume.value).toBe('0.25');
    expect(ui.volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('25%');
    ui.handle.destroy();
  });

  it('restores a stored volume on attach', () => {
    const storage = memoryStorage({ [VOL_KEY]: '{"volume":0.5,"muted":false}' });
    const media = makeMedia();
    const ui = mount({ media, storage });

    expect(media.volume).toBeCloseTo(0.5, 5);
    expect(ui.volume.value).toBe('0.5');
    expect(ui.volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('50%');
    ui.handle.destroy();
  });

  it('restores a stored mute without touching the volume', () => {
    const storage = memoryStorage({ [VOL_KEY]: '{"muted":true}' });
    const media = makeMedia();
    const ui = mount({ media, storage });

    expect(media.muted).toBe(true);
    expect(media.volume).toBe(1);
    expect(ui.mute.getAttribute('aria-pressed')).toBe('true');
    ui.handle.destroy();
  });

  it('leaves a muted element muted when the stored entry carries only a volume', () => {
    const storage = memoryStorage({ [VOL_KEY]: '{"volume":0.5}' });
    const media = makeMedia();

    media.muted = true;

    const ui = mount({ media, storage });

    expect(media.muted).toBe(true);
    expect(ui.mute.getAttribute('aria-pressed')).toBe('true');
    ui.handle.destroy();
  });

  it('survives a corrupt stored volume entry', () => {
    const storage = memoryStorage({ [VOL_KEY]: '{oops' });
    const media = makeMedia();
    const ui = mount({ media, storage });

    expect(media.volume).toBe(1);
    expect(ui.volume.value).toBe('1');
    ui.handle.destroy();
  });
});

describe('attachControls — loop', () => {
  it('flips the element loop, the pressed state, storage and the host callback', () => {
    const storage = memoryStorage();
    const onLoopChange = vi.fn();
    const media = makeMedia();
    const ui = mount({ media, storage, onLoopChange });

    ui.loop.click();
    expect(media.loop).toBe(true);
    expect(ui.loop.getAttribute('aria-pressed')).toBe('true');
    expect(storage.entries.get(LOOP_KEY)).toBe('true');
    expect(onLoopChange).toHaveBeenCalledWith(true);

    ui.loop.click();
    expect(media.loop).toBe(false);
    expect(ui.loop.getAttribute('aria-pressed')).toBe('false');
    expect(storage.entries.get(LOOP_KEY)).toBe('false');
    expect(onLoopChange).toHaveBeenLastCalledWith(false);
    ui.handle.destroy();
  });

  it('keeps an element seeded with loop on when nothing is stored', () => {
    const storage = memoryStorage();
    const onLoopChange = vi.fn();
    const media = makeMedia();

    media.loop = true;

    const ui = mount({ media, storage, onLoopChange });

    expect(media.loop).toBe(true);
    expect(ui.loop.getAttribute('aria-pressed')).toBe('true');
    expect(onLoopChange).not.toHaveBeenCalled();
    ui.handle.destroy();
  });

  it('lets a stored loop=false override an element seeded with loop on', () => {
    const storage = memoryStorage({ [LOOP_KEY]: 'false' });
    const media = makeMedia();

    media.loop = true;

    const ui = mount({ media, storage });

    expect(media.loop).toBe(false);
    expect(ui.loop.getAttribute('aria-pressed')).toBe('false');
    ui.handle.destroy();
  });
});

describe('attachControls — storage seam', () => {
  it('falls back to localStorage when the caller passes no storage', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.loop.click();

    expect(localStorage.getItem(LOOP_KEY)).toBe('true');
    ui.handle.destroy();
  });

  it('keeps the element intact when the storage seam throws on read', () => {
    const throwing: AudioStorage = {
      getItem: (): string | null => {
        throw new Error('denied');
      },
      setItem: (): void => {
        throw new Error('denied');
      },
      removeItem: (): void => undefined,
    };
    const media = makeMedia();

    media.loop = true;

    const ui = mount({ media, storage: throwing });

    expect(media.loop).toBe(true);
    expect(ui.loop.getAttribute('aria-pressed')).toBe('true');
    ui.handle.destroy();
  });

  it('keeps the element intact when reading localStorage itself throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: (): Storage => {
        throw new Error('storage disabled');
      },
    });

    try {
      const media = makeMedia();

      media.loop = true;

      const ui = mount({ media });

      expect(media.loop).toBe(true);
      expect(ui.loop.getAttribute('aria-pressed')).toBe('true');
      ui.handle.destroy();
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('attachControls — speed menu', () => {
  it('opens the menu from the gear', () => {
    const ui = mount({ media: makeMedia() });

    ui.gear.click();

    expect(ui.menu.hidden).toBe(false);
    expect(ui.gear.getAttribute('aria-expanded')).toBe('true');
    ui.handle.destroy();
  });

  it('closes the menu on a second gear click', () => {
    const ui = mount({ media: makeMedia() });

    ui.gear.click();
    ui.gear.click();

    expect(ui.menu.hidden).toBe(true);
    expect(ui.gear.getAttribute('aria-expanded')).toBe('false');
    ui.handle.destroy();
  });

  it('does not let the gear click reach the surrounding block', () => {
    const onOuterClick = vi.fn();
    const ui = mount({ media: makeMedia() });

    ui.figure.addEventListener('click', onOuterClick);
    ui.gear.click();

    expect(ui.menu.hidden).toBe(false);
    expect(onOuterClick).not.toHaveBeenCalled();
    ui.handle.destroy();
  });

  it('keeps the menu open while the pointer works inside it, and closes on an outside press', () => {
    const ui = mount({ media: makeMedia() });

    ui.gear.click();

    ui.readout.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ui.menu.hidden).toBe(false);

    ui.gear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ui.menu.hidden).toBe(false);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ui.menu.hidden).toBe(true);
    expect(ui.gear.getAttribute('aria-expanded')).toBe('false');
    ui.handle.destroy();
  });

  it('drops the document listener once the menu closes', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const ui = mount({ media: makeMedia() });

    ui.gear.click();

    const added = addSpy.mock.calls.filter(([type]) => type === 'mousedown');

    expect(added).toHaveLength(1);

    const listener = added[0][1];

    ui.gear.click();

    expect(removeSpy.mock.calls.some(([type, fn]) => type === 'mousedown' && fn === listener)).toBe(true);
    ui.handle.destroy();
  });

  it('closes the menu when the controls are destroyed while it is open', () => {
    const ui = mount({ media: makeMedia() });

    ui.gear.click();
    ui.handle.destroy();

    expect(ui.menu.hidden).toBe(true);
  });
});

describe('attachControls — playback speed', () => {
  it('applies a preset chip to the element, the readout, the slider and storage', () => {
    const storage = memoryStorage();
    const media = makeMedia();
    const ui = mount({ media, storage });

    ui.gear.click();
    ui.chips[3].click();

    expect(media.playbackRate).toBe(2);
    expect(ui.readout.textContent).toBe('2×');
    expect(ui.slider.value).toBe('2');
    expect(ui.slider.getAttribute('aria-valuetext')).toBe('2×');
    expect(ui.slider.style.getPropertyValue('--blok-audio-speed-pct')).toBe('100%');
    expect(ui.steppers[0].disabled).toBe(false);
    expect(ui.steppers[1].disabled).toBe(true);
    expect(storage.entries.get(RATE_KEY)).toBe('2');
    expect(ui.menu.hidden).toBe(false);
    ui.handle.destroy();
  });

  it('applies the slowest chip and paints the fill down the track', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.chips[0].click();

    expect(media.playbackRate).toBe(0.5);
    expect(ui.readout.textContent).toBe('0.5×');
    expect(ui.slider.style.getPropertyValue('--blok-audio-speed-pct')).toBe('14.285714285714285%');
    expect(ui.steppers[0].disabled).toBe(false);
    ui.handle.destroy();
  });

  it('drives the rate from the slider and parks the stepper at the floor', () => {
    const media = makeMedia();
    const ui = mount({ media });

    fireInput(ui.slider, '0.25');

    expect(media.playbackRate).toBe(0.25);
    expect(ui.readout.textContent).toBe('0.25×');
    expect(ui.slider.style.getPropertyValue('--blok-audio-speed-pct')).toBe('0%');
    expect(ui.steppers[0].disabled).toBe(true);
    expect(ui.steppers[1].disabled).toBe(false);
    ui.handle.destroy();
  });

  it('steps the rate down and up by one slider step', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.steppers[0].click();
    expect(media.playbackRate).toBe(0.95);
    expect(ui.readout.textContent).toBe('0.95×');

    ui.steppers[1].click();
    ui.steppers[1].click();
    expect(media.playbackRate).toBe(1.05);
    ui.handle.destroy();
  });

  it('clamps a rate dragged beyond either end of the range', () => {
    const media = makeMedia();
    const ui = mount({ media });

    fireInput(ui.slider, '9');
    expect(media.playbackRate).toBe(2);

    fireInput(ui.slider, '0.01');
    expect(media.playbackRate).toBe(0.25);
    ui.handle.destroy();
  });

  it('restores a shared stored rate through the same path as a click', () => {
    const storage = memoryStorage({ [RATE_KEY]: '1.5' });
    const media = makeMedia();
    const ui = mount({ media, storage });

    expect(media.playbackRate).toBe(1.5);
    expect(ui.slider.value).toBe('1.5');
    expect(ui.readout.textContent).toBe('1.5×');
    expect(ui.slider.getAttribute('aria-valuetext')).toBe('1.5×');
    expect(ui.slider.style.getPropertyValue('--blok-audio-speed-pct')).toBe('71.42857142857143%');
    ui.handle.destroy();
  });

  it('keeps the decrease stepper disabled when the restored rate is the floor', () => {
    const storage = memoryStorage({ [RATE_KEY]: '0.25' });
    const media = makeMedia();
    const ui = mount({ media, storage });

    expect(media.playbackRate).toBe(0.25);
    expect(ui.steppers[0].disabled).toBe(true);
    expect(ui.steppers[1].disabled).toBe(false);
    ui.handle.destroy();
  });

  it('keeps the increase stepper disabled when the restored rate is the ceiling', () => {
    const storage = memoryStorage({ [RATE_KEY]: '2' });
    const media = makeMedia();
    const ui = mount({ media, storage });

    expect(media.playbackRate).toBe(2);
    expect(ui.steppers[0].disabled).toBe(false);
    expect(ui.steppers[1].disabled).toBe(true);
    ui.handle.destroy();
  });

  it.each([['not-a-number'], ['0'], ['-1'], ['Infinity']])('ignores the corrupt stored rate %s', (stored) => {
    const storage = memoryStorage({ [RATE_KEY]: stored });
    const media = makeMedia();
    const ui = mount({ media, storage });

    expect(media.playbackRate).toBe(1);
    expect(ui.slider.value).toBe('1');
    ui.handle.destroy();
  });
});

describe('attachControls — keyboard', () => {
  it.each([[' '], ['Spacebar'], ['k']])('toggles playback on %s', (key) => {
    const media = makeMedia();
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, key);

    expect(media.play).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    ui.handle.destroy();
  });

  it('seeks back five seconds on ArrowLeft', () => {
    const media = makeMedia({ currentTime: 10 });
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, 'ArrowLeft');

    expect(media.currentTime).toBe(5);
    expect(event.defaultPrevented).toBe(true);
    ui.handle.destroy();
  });

  it('clamps a backward seek at the start of the track', () => {
    const media = makeMedia({ currentTime: 2 });
    const ui = mount({ media });

    pressKeyOn(ui.figure, 'ArrowLeft');

    expect(media.currentTime).toBe(0);
    ui.handle.destroy();
  });

  it('seeks forward five seconds on ArrowRight', () => {
    const media = makeMedia({ duration: 200, currentTime: 10 });
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, 'ArrowRight');

    expect(media.currentTime).toBe(15);
    expect(event.defaultPrevented).toBe(true);
    ui.handle.destroy();
  });

  it('clamps a forward seek at the end of the track', () => {
    const media = makeMedia({ duration: 12, currentTime: 10 });
    const ui = mount({ media });

    pressKeyOn(ui.figure, 'ArrowRight');

    expect(media.currentTime).toBe(12);
    ui.handle.destroy();
  });

  it('refuses to seek forward past the head while the duration is unknown', () => {
    const media = makeMedia({ duration: NaN, currentTime: 10 });
    const ui = mount({ media });

    pressKeyOn(ui.figure, 'ArrowRight');

    expect(media.currentTime).toBe(10);
    ui.handle.destroy();
  });

  it('toggles mute on m', () => {
    const media = makeMedia();
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, 'm');

    expect(media.muted).toBe(true);
    expect(ui.mute.getAttribute('aria-pressed')).toBe('true');
    expect(event.defaultPrevented).toBe(true);
    ui.handle.destroy();
  });

  it('raises the volume one step on ArrowUp', () => {
    const storage = memoryStorage();
    const media = makeMedia();
    const ui = mount({ media, storage });

    media.volume = 0.5;

    const event = pressKeyOn(ui.figure, 'ArrowUp');

    expect(media.volume).toBeCloseTo(0.55, 5);
    expect(Number(ui.volume.value)).toBeCloseTo(0.55, 5);
    expect(storage.entries.get(VOL_KEY)).toBe('{"volume":0.55,"muted":false}');
    expect(event.defaultPrevented).toBe(true);
    ui.handle.destroy();
  });

  it('repaints the fill on ArrowUp even when the volume is already at the ceiling', () => {
    const media = makeMedia();
    const ui = mount({ media });

    // Volume unchanged ⇒ no volumechange event, so only the handler's own
    // resync can paint the track.
    pressKeyOn(ui.figure, 'ArrowUp');

    expect(media.volume).toBe(1);
    expect(ui.volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('100%');
    ui.handle.destroy();
  });

  it('lowers the volume one step on ArrowDown', () => {
    const storage = memoryStorage();
    const media = makeMedia();
    const ui = mount({ media, storage });

    media.volume = 0.5;

    const event = pressKeyOn(ui.figure, 'ArrowDown');

    expect(media.volume).toBeCloseTo(0.45, 5);
    expect(Number(ui.volume.value)).toBeCloseTo(0.45, 5);
    expect(storage.entries.get(VOL_KEY)).toBe('{"volume":0.45,"muted":false}');
    expect(event.defaultPrevented).toBe(true);
    ui.handle.destroy();
  });

  it('repaints the fill on ArrowDown even when the volume is already at the floor', () => {
    const media = makeMedia();

    media.volume = 0;

    const ui = mount({ media });

    pressKeyOn(ui.figure, 'ArrowDown');

    expect(media.volume).toBe(0);
    expect(ui.volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('0%');
    expect(ui.mute.getAttribute('aria-pressed')).toBe('true');
    ui.handle.destroy();
  });

  it('jumps to a tenth of the track on a digit', () => {
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, '5');

    expect(media.currentTime).toBe(100);
    expect(event.defaultPrevented).toBe(true);
    ui.handle.destroy();
  });

  it('jumps to the start on 0 and to nine tenths on 9', () => {
    const media = makeMedia({ duration: 200, currentTime: 77 });
    const ui = mount({ media });

    pressKeyOn(ui.figure, '9');
    expect(media.currentTime).toBe(180);

    pressKeyOn(ui.figure, '0');
    expect(media.currentTime).toBe(0);
    ui.handle.destroy();
  });

  it.each([['!'], ['z'], ['12']])('leaves a non-digit key %s to the page', (key) => {
    const media = makeMedia({ duration: 200, currentTime: 7 });
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, key);

    expect(media.currentTime).toBe(7);
    expect(event.defaultPrevented).toBe(false);
    ui.handle.destroy();
  });

  it('does not jump on a digit while the duration is unknown', () => {
    const media = makeMedia({ duration: NaN, currentTime: 7 });
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, '5');

    expect(media.currentTime).toBe(7);
    expect(event.defaultPrevented).toBe(false);
    ui.handle.destroy();
  });

  const MODIFIER_CASES: Array<[string, Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'altKey'>]> = [
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['altKey', { altKey: true }],
  ];

  it.each(MODIFIER_CASES)('leaves a %s shortcut alone', (_name, modifiers) => {
    const media = makeMedia();
    const ui = mount({ media });

    const event = pressKeyOn(ui.figure, ' ', modifiers);

    expect(media.play).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    ui.handle.destroy();
  });

  it('ignores a keypress typed into an editable caption', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const caption = document.createElement('div');

    caption.setAttribute('contenteditable', 'true');
    figure.appendChild(caption);

    const ui = mount({ media, figure });

    const event = pressKeyOn(caption, ' ');

    expect(media.play).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    ui.handle.destroy();
  });

  it('still handles a keypress whose target is a text node, not an element', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const text = document.createTextNode('caption text');

    figure.appendChild(text);

    const ui = mount({ media, figure });

    pressKeyOn(text, 'k');

    expect(media.play).toHaveBeenCalled();
    ui.handle.destroy();
  });
});

describe('attachControls — vinyl platter', () => {
  interface Platter {
    frames: FrameRequestCallback[];
    cancel: ReturnType<typeof vi.fn>;
    figure: HTMLElement;
  }

  const platterFixture = (): Platter => {
    const frames: FrameRequestCallback[] = [];

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((frame: FrameRequestCallback): number => {
      frames.push(frame);

      return frames.length;
    });

    const cancel = vi.fn();

    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(cancel);

    const figure = document.createElement('figure');
    const disc = document.createElement('div');

    disc.className = 'blok-audio-cover__disc';
    figure.appendChild(disc);

    return { frames, cancel, figure };
  };

  it('holds the record still until the element reports playback', () => {
    const { frames, figure } = platterFixture();
    const media = makeMedia();
    const ui = mount({ media, figure });

    expect(frames).toHaveLength(0);

    media.dispatchEvent(new Event('play'));
    expect(frames).toHaveLength(1);
    ui.handle.destroy();
  });

  it('coasts the record to a stop after a pause instead of spinning forever', () => {
    const { frames, figure } = platterFixture();
    const media = makeMedia();
    const ui = mount({ media, figure });
    const cursor = { index: 0, timestamp: 0 };
    const pump = (limit: number): void => {
      while (cursor.index < frames.length && cursor.index < limit) {
        const frame = frames[cursor.index];

        cursor.index += 1;
        cursor.timestamp += 16;
        frame(cursor.timestamp);
      }
    };

    media.dispatchEvent(new Event('play'));
    pump(2);
    media.dispatchEvent(new Event('pause'));
    pump(600);

    expect(frames.length).toBeLessThan(600);
    ui.handle.destroy();
  });

  it('cancels the spin loop on destroy', () => {
    const { cancel, figure } = platterFixture();
    const media = makeMedia();
    const ui = mount({ media, figure });

    media.dispatchEvent(new Event('play'));
    ui.handle.destroy();

    expect(cancel).toHaveBeenCalledWith(1);
  });
});

describe('attachControls — destroy', () => {
  it('detaches the play button', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    ui.play.click();

    expect(media.play).not.toHaveBeenCalled();
  });

  it('detaches the mute button', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    ui.mute.click();

    expect(media.muted).toBe(false);
  });

  it('detaches the volume slider', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    fireInput(ui.volume, '0.2');

    expect(media.volume).toBe(1);
  });

  it('detaches the loop button', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    ui.loop.click();

    expect(media.loop).toBe(false);
  });

  it('detaches the gear button', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    ui.gear.click();

    expect(ui.menu.hidden).toBe(true);
    expect(ui.gear.getAttribute('aria-expanded')).toBe('false');
  });

  it('detaches the speed slider', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    fireInput(ui.slider, '2');

    expect(media.playbackRate).toBe(1);
  });

  it('detaches the element play and pause events', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    media.dispatchEvent(new Event('play'));

    expect(ui.figure.getAttribute('data-playing')).toBe('false');
    expect(ui.play.getAttribute('aria-label')).toBe('Play');

    ui.figure.setAttribute('data-playing', 'true');
    media.dispatchEvent(new Event('pause'));
    expect(ui.figure.getAttribute('data-playing')).toBe('true');
  });

  it('detaches the timeupdate and loadedmetadata events', () => {
    const media = makeMedia({ duration: 200, currentTime: 125 });
    const ui = mount({ media });

    ui.handle.destroy();
    media.dispatchEvent(new Event('timeupdate'));
    media.dispatchEvent(new Event('loadedmetadata'));

    expect(ui.time.textContent).toBe('0:00 / 0:00');
  });

  it('detaches the volumechange event', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    media.volume = 0.3;
    media.dispatchEvent(new Event('volumechange'));

    expect(ui.volume.value).toBe('1');
  });

  it('detaches the figure keyboard handler', () => {
    const media = makeMedia();
    const ui = mount({ media });

    ui.handle.destroy();
    pressKeyOn(ui.figure, ' ');

    expect(media.play).not.toHaveBeenCalled();
  });

  it('takes the bar and the menu out of the document', () => {
    const ui = mount({ media: makeMedia() });

    ui.handle.destroy();

    expect(ui.root.parentNode).toBeNull();
    expect(ui.menu.parentNode).toBeNull();
  });
});
